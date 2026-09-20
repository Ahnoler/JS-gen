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

const bad = results.filter((r) => !r.ok);
console.log(`\ncharacterize-step-number-integrity: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
