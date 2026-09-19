/**
 * Characterization: stop 语义三实现差异 + 「stop 路径不 arm 90s 门闩」现状固化。
 *
 * 调研地图 docs/superpowers/reports/2026-09-18-stop-zero-gate-convergence-survey.md
 * Step 0 交付（挂账专项「stop 双实现 / 零步门禁三代」）：在 Step 1（三代门禁收敛进
 * phase-done-evidence-gate.js）与 Step 3（stop 单点化）动刀之前，把当前四方语义钉死：
 *
 *   A  stopTrajectoryRecording        lifecycle 路由级联：无条件覆写终态 + capture off
 *   C  stopTrajectoryRecordingSafe    batch CAS-only：仅 recording 态才写，不降级持久态
 *   D  detachTrajectoryLive           硬停：只置 abort 标志，不写终态不发 cancel_step
 *   B  runner 响应式状态机            abort 检查点抛出 → catch userStopPath 尊重 A 终态
 *
 * 承重钉（#904 P5 假成功的结构性根因）：runner 的 abort 抛出发生在
 * `const finalizeGate = setTimeout` **之前** —— stop 路径 throw 'Recording aborted'
 * 跳过门闩创建，stop(success) 通道因此完全绕过全部零步门禁；且门闩 CAS 谓词
 * `recordStatusIn: ['recorded']` 无法区分「用户显式 stop 落的 recorded」与
 * 「自然走完落的 recorded」（优先级从未被 pin 固化，本文件即固化点）。
 *
 * 全部为 read_text needle + 源码切片断言（零 import 被测模块、零行为驱动）：
 * 上述任一区域被改动，对应断言即红，倒逼改者显式确认语义迁移。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const LIFECYCLE = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-record-lifecycle.js'), 'utf8');
const ATTACH = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-attach-service.js'), 'utf8');
const RUNNER = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
const ROUTE = readFileSync(join(ROOT, 'src/routes/v2/trajectory-record.js'), 'utf8');

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const count = (hay, needle) => hay.split(needle).length - 1;
const idx = (hay, needle, label) => {
  const i = hay.indexOf(needle);
  assert.ok(i >= 0, `源码未命中: ${label}`);
  return i;
};

// ── 切片定位：A / C / D / B(catch+finally) ───────────────────────────────────
const A_START = 'export async function stopTrajectoryRecording(trajectoryId, { success = true } = {}) {';
const C_START = 'export async function stopTrajectoryRecordingSafe(trajectoryId, {';
const D_START = 'export async function detachTrajectoryLive(trajectoryId, { reason = \'manual\' } = {}) {';
const aIdx = idx(LIFECYCLE, A_START, 'A 函数头');
const cIdx = idx(LIFECYCLE, C_START, 'C 函数头');
const dIdx = idx(ATTACH, D_START, 'D 函数头');
const A = LIFECYCLE.slice(aIdx, cIdx);
const C = LIFECYCLE.slice(cIdx);
const C_END_MARK = C.indexOf('\n/**');
const C_BODY = C.slice(0, C_END_MARK > 0 ? C_END_MARK : undefined);
const D_BODY = ATTACH.slice(dIdx, ATTACH.indexOf('\n/**', dIdx));
const CATCH_MARK = 'const userStopPath = !!(runtime.userStop || runtime.abortRecording)';
const catchIdx = idx(RUNNER, CATCH_MARK, 'runner catch userStopPath');
// catch 块从最近的 `} catch (err) {` 起（含归属守卫），finally 到 runner 返回构造前
const catchStart = RUNNER.lastIndexOf('} catch (err) {', catchIdx);
const finStart = RUNNER.indexOf('} finally {', catchIdx);
const B_CATCH = RUNNER.slice(catchStart, finStart);
const B_FINALLY = RUNNER.slice(finStart, RUNNER.indexOf('const tree = await getTrajectoryTree(tid);', finStart));

// ── 1. A：路由级联版（record/stop 的默认实现） ────────────────────────────────
record('1a A 发 cancel_step（无条件、不等 busy 标志）',
  A.includes("event: 'cancel_step'") && A.includes('do not wait for busy flag'));
record('1b A 发 manual_record_stop + capture_screenshots off（C 无后者）',
  A.includes("event: 'manual_record_stop'")
  && A.includes("event: 'capture_screenshots'")
  && A.includes('enabled: false')
  && !C_BODY.includes('capture_screenshots'));
record('1c A 无条件覆写终态：无 CAS 守卫直写 finishTransientRecording',
  A.includes('const recordStatus = await trajectoryDao.finishTransientRecording(')
  && !A.includes("recordStatus === 'recording'"));
record('1d A 覆写 isDone/isSuccessful=!!success 且不查当前态',
  A.includes('isDone: !!success') && A.includes('isSuccessful: !!success'));
record('1e A success 默认 true（函数签名 + 路由双重默认）',
  A_START.includes('{ success = true }')
  && ROUTE.includes("req.body?.success !== false && req.body?.success !== 0")
  && ROUTE.includes('stopTrajectoryRecording(+req.params.id, { success })'));
record('1f A 失败分支记 user_marked_failed（人工标失败留痕）',
  A.includes("failedKind: 'user_marked_failed'"));
record('1f+ A 不消费任何零步门禁（stop(success) 绕过口的直证）',
  !A.includes('applyZeroStepFakeSuccessGate')
  && !A.includes('countBusinessSteps')
  && !A.includes('updateMetaIf'));

// ── 2. C：batch CAS-only 变体 ────────────────────────────────────────────────
record('2a C 发 cancel_step；CAS-only：仅 recording 态写终态',
  C_BODY.includes("event: 'cancel_step'")
  && C_BODY.includes("if (traj.recordStatus === 'recording') {"));
record('2b C 不降级持久态：else 分支原样带回 recordStatus（JSDoc 契约在函数头之上）',
  C_BODY.includes('recordStatus = traj.recordStatus;')
  && LIFECYCLE.includes('Batch-safe stop: never downgrade recorded/completed'));
record('2c C success 默认 false（与 A 相反）+ failedKind 参数化',
  C_BODY.includes('{\n  success = false,\n  failedKind = \'batch_failed\',\n} = {}) {')
  || (C_BODY.includes('success = false') && C_BODY.includes("failedKind = 'batch_failed'")));
record('2d C 与 A 的分叉点唯一：CAS 守卫 + capture off 缺席（A 的参数化候选）',
  count(C_BODY, "event: 'cancel_step'") === 1
  && !C_BODY.includes("event: 'capture_screenshots'"));

// ── 3. D：detach 硬停 ────────────────────────────────────────────────────────
record('3a D 只置 abort 标志且 userStop.success 恒 false',
  D_BODY.includes('runtime.abortRecording = true;')
  && D_BODY.includes('runtime.userStop = { success: false };')
  && D_BODY.includes('detach must not'));
record('3b D 不发 cancel_step、不写终态、不记失败原因（杀进程代替协商）',
  !D_BODY.includes('cancel_step')
  && !D_BODY.includes('finishTransientRecording')
  && !D_BODY.includes('markFailedReason'));
record('3c D 杀全链：closeSession(keepBrowser:false) + 槽位 + runtime 删除',
  D_BODY.includes('execSession.closeSession(')
  && D_BODY.includes('keepBrowser: false')
  && D_BODY.includes('slotLease.releaseByTrajectory(tid);')
  && D_BODY.includes('deleteTrajectoryRuntime(tid);'));

// ── 4. B：runner 响应式状态机 ────────────────────────────────────────────────
record('4a abort 检查点 ×2：置阶段终态后抛 Recording aborted',
  count(RUNNER, "throw new Error('Recording aborted')") === 2
  && count(RUNNER, "runtime.userStop?.success ? 'completed' : 'failed'") === 2);
record('4b catch userStopPath：尊重 A 已写终态，不覆写失败',
  B_CATCH.includes('finalStatus = traj.recordStatus;')
  && B_CATCH.includes("|| /Recording aborted/i.test(String(err?.message || err || ''))"));
record('4c 非用户 stop 才写失败终态（runner_error + 整轨 failed）',
  B_CATCH.includes("await persistFailReason('runner_error');")
  && B_CATCH.indexOf("if (!userStopPath) {") < B_CATCH.indexOf("finalStatus = traj.recordStatus;"));
record('4d finally 幂等补发 cancel_step（防执行机 agent 僵尸）',
  B_FINALLY.includes('runtime._sentStepThisRun')
  && B_FINALLY.includes("event: 'cancel_step'"));
record('4e 归属守卫：stale 循环不写库不砍新 run（catch + finally 双点）',
  count(RUNNER, 'runStillOwnsRuntime()') === 2
  && B_CATCH.includes('stale recording loop exit suppressed')
  && B_FINALLY.includes('stale recording loop cleanup suppressed'));

// ── 5. 承重钉：stop 路径不 arm 90s 门闩（#904 P5 假成功结构性根因） ────────────
const gateCreate = idx(RUNNER, 'const finalizeGate = setTimeout(async () => {', '90s 门闩创建');
const lastAbortThrow = RUNNER.lastIndexOf("throw new Error('Recording aborted')");
const gateEnd = idx(RUNNER, '}, Number(process.env.RECORD_FINALIZE_GATE_MS || 90000));', '门闩回调结束');
const GATE = RUNNER.slice(gateCreate, gateEnd);
const TRY_TAIL = RUNNER.slice(gateCreate, catchStart); // 门闩注册 → catch 之间（v3 同步终局在此）
record('5a 门闩创建在 phase 循环自然走完之后：最后一个 abort 抛出点先于门闩创建',
  lastAbortThrow < gateCreate);
record('5b 门闩创建在 try 块内、catch 之前（stop 抛出即跳过创建）',
  gateCreate < catchStart);
record('5c 门闩 90s 周期 + 三重活性守卫（runtime 替换/session 消失/录制中）',
  GATE.includes('superseded by a newer run')
  && GATE.includes('gateRuntimeReplaced')
  && GATE.includes('gateSessionGone')
  && GATE.includes('await isAiRecordingActive(tid);')
  && RUNNER.includes('Number(process.env.RECORD_FINALIZE_GATE_MS || 90000)'));
record('5d 门闩降级 CAS-only：仅 recorded 可降 failed（recording/draft/completed 不可）',
  count(GATE, "recordStatusIn: ['recorded']") === 2
  && GATE.includes("recordStatus: 'failed', persistentRecordStatus: 'failed'"));
record('5e 门闩判定双源：副本计数 + DB 复核，total==0 为 v1.5 兜底分支',
  GATE.includes('countBusinessSteps(tid)')
  && GATE.includes('} else if (copySteps === 0 && dbSteps === 0) {'));
record('5f 【未固化优先级】门闩无 userStop 感知：无法区分用户显式 recorded 与自然 recorded',
  !GATE.includes('userStop'),
  '门闩 CAS 会把 90s 内用户显式 stop(success) 落的 recorded 同样降级——收敛 Step 3 须裁决');
record('5g 假成功广播四点齐备：v2 按阶段 / v1.5 兜底 / v3 per-run / v3 同步终局',
  count(RUNNER, "broadcast('fake_success_detected'") === 4);
record('5h v3 同步终局在门闩注册之后（try 尾部）：任一阶段显式失败即 failure 收官',
  TRY_TAIL.includes('const trajSuccess = aggregateTrajectorySuccessful(runtime.phaseOutcomes);')
  && count(RUNNER, "finishTransientRecording(tid, 'failure')") >= 2);

const bad = results.filter((r) => !r.ok);
console.log(`\ncharacterize-stop-semantics: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
