/**
 * Characterization: 步号完整性三修复现状固化（离线，read_text needle + 计数断言）。
 *
 * 钉死 2026-09-20 B-2 gaps 修复后的不变量，任一区域被改动即红，倒逼改者显式确认：
 *   ① coalesce 删除重排后内存步号回补（runner handleActionLogSync 删除成功块内、
 *      removeRecordedStepsByDbIds 之后）——防删除后 _nextStepNumber 与 DB max 脱节留断号缺口
 *   ② save_form_snapshot 快照落库接收调用方步号（appendRecordedStep 透传 stepNumber，
 *      appendRecordedFormSnapshot 有效则用之、否则 max()+1 兜底）——防 fill+snapshot 同号双行
 *   ③ failedReason 带（阶段 N,M）后缀（persistFailReason phaseHint 参数 + 三处带参调用点）；
 *      total 降级与 runner_error 两处保持无参原文
 *   ⑤ persist 事件串行化（#917 根修：生产同号双行 [54,61] + 跳号缺口 [55,62]）——
 *      persist 类事件 body 惰性化（runWork 工厂）并真正串入 _persistDrain 链，
 *      _nextStepNumber 读-改-写因此原子；_persistDrain 链与告警文案防顺手删
 *   ⑥ 快照步号占用回退（#917 纵深防御）：appendRecordedFormSnapshot 收到调用方步号
 *      但该号已被同 trajectory 占用时，在插入事务内回退 max+1（resolveFreeStepNumber）
 *   守卫钉：runner 的 refreshTrajectoryCounts(tid) 恰 2 处（防实现误加，与
 *   characterize-traj-recon-logging.mjs hook4 口径一致）
 *
 * Run: node scripts/characterization/characterize-step-number-integrity.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const RUNNER = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
const FSA = readFileSync(join(ROOT, 'src/services/trajectory/form-snapshot-append.js'), 'utf8');
const API_DOCS = readFileSync(join(ROOT, 'src/dashboard/api-docs/groups/trajectory.js'), 'utf8');

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const count = (hay, needle) => hay.split(needle).length - 1;
const idx = (hay, needle, label, from = 0) => {
  const i = hay.indexOf(needle, from);
  assert.ok(i >= 0, `源码未命中: ${label}`);
  return i;
};

// ── ① coalesce 删除分支：内存步号回补 ────────────────────────────────────────
const REPLENISH = 'runtime._nextStepNumber = (await trajectoryDao.getMaxStepNumber(tid)) + 1;';
const gateIdx = idx(RUNNER, 'if (dbIds.length) {', '删除成功块入口');
const removeIdx = idx(RUNNER, 'await removeRecordedStepsByDbIds(tid, dbIds)', '删除调用');
const replenishIdx = idx(RUNNER, REPLENISH, '步号回补行', removeIdx);
const broadcastIdx = idx(RUNNER, "broadcast('action_removed'", 'action_removed 广播', removeIdx);
record('1a 步号回补行恰 2 处（persist 前 init 懒加载 + coalesce 删除回补）',
  count(RUNNER, REPLENISH) === 2, `count=${count(RUNNER, REPLENISH)}`);
record('1b 回补行在删除成功块内且先于广播：gate < remove < 回补 < broadcast',
  gateIdx < removeIdx && replenishIdx > removeIdx && replenishIdx < broadcastIdx,
  `gate=${gateIdx} remove=${removeIdx} replenish=${replenishIdx} broadcast=${broadcastIdx}`);
record('1c runner 导入 trajectoryDao（回补查询依赖）',
  RUNNER.includes("import * as trajectoryDao from '../../dao/trajectory-dao.js';"));

// ── ② save_form_snapshot：快照步号透传 ───────────────────────────────────────
const SNAP_SIG = 'export async function appendRecordedFormSnapshot(trajectoryDbId, entry, { source, trajectoryPhaseId, stepNumber } = {}) {';
const SNAP_PASS = 'return appendRecordedFormSnapshot(tid, entry, { source, trajectoryPhaseId, stepNumber });';
record('2a appendRecordedFormSnapshot 签名含 stepNumber 参数（恰 1 处）',
  count(FSA, SNAP_SIG) === 1);
record('2b appendRecordedStep 对 save_form_snapshot 透传 caller stepNumber（恰 1 处）',
  count(FSA, SNAP_PASS) === 1);
record('2c 快照步号解析：有效调用方值优先、否则 max()+1 兜底（切片限定快照函数体）',
  (() => {
    const SNAP_BODY = FSA.slice(idx(FSA, SNAP_SIG, 'appendRecordedFormSnapshot 签名'));
    return count(SNAP_BODY, 'const callerStepNumber = Number(stepNumber);') === 1
      && count(SNAP_BODY, ': (await trajectoryDao.getMaxStepNumber(tid)) + 1;') === 1;
  })());
record('2d 两个追加函数 JSDoc 均记载 stepNumber',
  count(FSA, '@param {number} [root0.stepNumber]') === 2);

// ── ③ failedReason 带（阶段 N,M）后缀 ────────────────────────────────────────
record('3a persistFailReason 定义含 phaseHint 可选参（恰 1 处）',
  count(RUNNER, 'const persistFailReason = async (kind, phaseHint) => {') === 1);
record('3b 文案拼装含（阶段 后缀（恰 1 处）',
  count(RUNNER, "'（阶段 ' + phaseHint.join(',') + '）'") === 1);
record('3c 旧单参落库形态已迁移（failedReason 不再直取 failReasonText）',
  count(RUNNER, 'failedReason: failReasonText(kind)') === 0);
record('3d zeroPhase 降级带阶段实参（恰 1 处）',
  count(RUNNER, "persistFailReason('zero_step', zeroStepPhases)") === 1);
record('3e per-run 降级带阶段实参（恰 1 处）',
  count(RUNNER, "persistFailReason('zero_step', perRunPhases)") === 1);
record('3f v3 同步终局两参形态（failKind 后带逗号，恰 1 处；quality 走 phase 列表）',
  count(RUNNER, 'persistFailReason(finalVerdict.failKind,') === 1
  && count(RUNNER, 'qualityFails.map((q) => q.phase).filter(Boolean)') === 1);
record('3g total 降级保持无参原文（恰 1 处）',
  count(RUNNER, "persistFailReason('zero_step')") === 1);
record('3h catch 块 runner_error 保持无参原文（恰 1 处）',
  count(RUNNER, "await persistFailReason('runner_error');") === 1);
record('3i 调用点总数恰 5（3 带参 + total 无参 + runner_error 无参）',
  count(RUNNER, 'persistFailReason(') === 5, `count=${count(RUNNER, 'persistFailReason(')}`);
record('3j failedKind 语义未变：markFailedReason 仍以 kind 为准（恰 1 处）',
  count(RUNNER, 'markFailedReason(tid,') === 1);

// ── ④ 守卫钉 ────────────────────────────────────────────────────────────────
record('4a runner refreshTrajectoryCounts(tid) 恰 2 处（防实现误加）',
  count(RUNNER, 'await refreshTrajectoryCounts(tid)') === 2);
record('4b api-docs failedReason 登记（阶段 N,M）后缀说明',
  API_DOCS.includes('（阶段 N,M）'));

// ── ⑤ persist 事件串行化（#917 根修） ────────────────────────────────────────
// 根因：persist 类事件 body 急切启动，_nextStepNumber 的读取发生在链生效之前，
// 派生快照与主 fill 并发进入双双读到同一号、各自推进计数器 → 同号双行 + 跳号。
// 修复形态：body 惰性化（runWork 工厂），persist 类事件由 _persistDrain 链串行触发。
// 注：find 用不抛错的 indexOf（RED 阶段 needle 未实现时输出 FAIL 行而非崩溃）。
const find = (hay, needle) => hay.indexOf(needle);
const runWorkIdx = find(RUNNER, 'const runWork = () => (async () => {');
const subCbIdx = find(RUNNER, 'execSession.subscribeSessionEvents(runtime.sessionId');
const alsDeclIdx = find(RUNNER, 'const handleActionLogSync = async (payload) => {');
const stepNumReadIdx = find(RUNNER, 'stepNumber: runtime._nextStepNumber');
const alsCallIdx = runWorkIdx >= 0
  ? RUNNER.indexOf('await handleActionLogSync(payload);', runWorkIdx)
  : -1;
record('5a persist 类 body 惰性化（runWork 工厂形态恰 1 处，且位于订阅回调内）',
  count(RUNNER, 'const runWork = () => (async () => {') === 1
  && runWorkIdx > subCbIdx);
record('5b 链内串行触发 .then(() => runWork())（恰 1 处；旧急切引用 .then(() => work) 清零）',
  count(RUNNER, '.then(() => runWork())') === 1 && count(RUNNER, '.then(() => work)') === 0);
// 5c 语义：#917 根因是步号读取早于链生效。步号读取必须只发生在 handleActionLogSync
// 体内（恰 1 处），且 handleActionLogSync 仅由 runWork body 惰性调用（调用点位于
// runWork 定义之后）——读取因此在链串行触发后才执行，与 runWork 同一串行域。
record('5c 步号读取位于惰性执行域（恰 1 处：ALS 声明 < 读取 < 订阅回调；ALS 调用点在 runWork 定义之后）',
  count(RUNNER, 'stepNumber: runtime._nextStepNumber') === 1
  && alsDeclIdx >= 0 && alsDeclIdx < stepNumReadIdx && stepNumReadIdx < subCbIdx
  && alsCallIdx > runWorkIdx);
record('5d runtime._persistDrain 链保留（赋值形态恰 1 处）+ [record] persist drain failed: 告警文案原文',
  count(RUNNER, 'runtime._persistDrain = Promise.resolve(runtime._persistDrain)') === 1
  && count(RUNNER, '[record] persist drain failed:') === 1);
record('5e persist 门改集合判定（PERSIST_EVENT_TYPES 三类型齐全：Set 定义恰 1 处、has 判定恰 1 处）',
  count(RUNNER, "new Set(['action_log_sync', 'step_screenshot', 'page_level_screenshot'])") === 1
  && count(RUNNER, 'PERSIST_EVENT_TYPES.has(type)') === 1);

// ── ⑥ 快照步号占用回退（#917 纵深防御） ──────────────────────────────────────
const HELPER_SIG = 'async function resolveFreeStepNumber(trx, tid, desired) {';
const helperIdx = find(FSA, HELPER_SIG);
const snapSigIdx = find(FSA, SNAP_SIG);
const HELPER_BODY = helperIdx >= 0 && snapSigIdx >= 0 ? FSA.slice(helperIdx, snapSigIdx) : '';
record('6a 占用回退 helper resolveFreeStepNumber 定义于快照函数之前（恰 1 处）',
  count(FSA, HELPER_SIG) === 1 && helperIdx >= 0 && helperIdx < snapSigIdx);
record('6b 占用检测在 helper 查询内（step_number: desired + limit(1) 同现），占用则回退 max(step_number)+1',
  HELPER_BODY.includes('step_number: desired')
  && HELPER_BODY.includes('.limit(1)')
  && /max\(\s*\{\s*maxStep:\s*'step_number'\s*\}\s*\)/.test(HELPER_BODY));
record('6c 占用回退在插入事务内接线（resolveFreeStepNumber(trx, tid, desiredStepNumber) 恰 1 处）',
  count(FSA, 'resolveFreeStepNumber(trx, tid, desiredStepNumber)') === 1);

const bad = results.filter((r) => !r.ok);
console.log(`\ncharacterize-step-number-integrity: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
