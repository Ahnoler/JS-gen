/**
 * Characterization: 停止回放加固系列 pin（stop-replay hardening series）。
 *
 * 本文件是 2026-09-21「停止回放系统线」缺陷修复系列（Task 1..6）的系列级
 * 固化点，后续任务在本文件追加各自断言（文件名保持不变）。
 *
 * Task 1/6 — Type B 表单结构自愈在用户停止后仍执行不可逆删步：
 * form-structure-heal.js 的 handleFormStructureCheckpoint 此前只在 AI 修复段
 * （runHealStep 内部）收敛 stop，扫描返回后与删除循环（removeById /
 * reorderByTrajectory）完全不读 runtime.abortReplay——用户 stop 后，过时扫描
 * 结果仍会永久删除已录 fill 步骤。本 pin 钉住三个新守卫的存在与位置：
 *
 *   G1  scan（runReplayActions）成功返回后、batchResults 解析前：
 *       runtime.abortReplay 置位 → user-abort 形状返回（makeUserAbortError）
 *   G2  删除循环内 removeById 之前：每轮复核 abort → break（绝不再删）
 *   G3  删除段结束后、插入段（addingLabels）之前：user-abort 返回，
 *       已删条目如实记入 deletedStepIds（不回滚，也不再进入插入/改快照段）
 *
 * Task 2/6 — runHealStep 对 agent_stopped 的 reason 区分 + heal 超时补发：
 * replay-heal-shared.js 的 runHealStep 此前把任何 agent_stopped 一律当用户中断
 * （abortReplay=true + USER_ABORT reject），且 heal 超时后不叫停执行机。本 pin
 * 钉住两处修复（断言组 5/6）：
 *
 *   #3  unsubStopped 回调按 payload?.reason 分流：'new_step_arrived'（新步骤
 *       抢占 heal）不置 abortReplay/sawAgentStopped、以普通 Error reject（走
 *       heal 失败重试路径）；'cancel_step' / 缺失 reason（旧执行机）保持既有
 *       用户中断收敛
 *   #11 超时 reject 之前补发 cancel_step（forwardStdin fire-and-forget + warn，
 *       对齐 replay-actions.js P1-6 模式），避免迟到 phase_done 污染下一轮等待
 *
 * Task 3/6 — #4 超时×stop 竞态终态口径 + #12 中止步无终态事件：
 * replay-batch-runner.js 的单步 catch 此前不读 runtime.abortReplay——stop 与步
 * 超时撞车（runReplayActions 超时补发 cancel_step 后 reject）时，批级终态发
 * replay:finished {error} 而非 aborted 收敛（#4，断言组 7）；步后 abort 检查点
 * 直接丢弃已跑完的那一步且不发任何步终态事件，replay:step running 永久悬挂
 * （#12，断言组 8）。空档核查结论（replay:step 发射点全集）：循环头中止分支
 * 无空档——所有带 running 广播的 continue 路径（Type A 成功/失败、Type B 各
 * 返回路径、heal skip/retry-ok）在 continue 前均已发步终态，循环头补发即死
 * 代码；真实空档仅在步后 abort 检查点（status:'success' 发射点位于该检查之后，
 * 中止时不可达）。故补发落在步后分支，循环头分支 pin 为「批次级收敛、无步级
 * 补发」以固化核查结论、防冗余代码。
 *
 * Task 4/6 — #5 stop 诚实化 + #8 录制期拒绝 + #13 sync busy 泄漏（断言组 9）：
 * stopTrajectoryStepsReplay 此前无条件置 abortReplay + 下发 cancel_step——
 * 无批次时返回 stopped:true 是谎言且留 abortReplay 残留（#5/#16），而
 * session.busy=true 涵盖 AI 录制占用，录制期调 stop 会把 cancel_step 打进
 * 录制 Agent（#8 误杀）。runtime 新增 replayRunning 字段（trajectory-runtime.js
 * 默认 false；runReplayBatch 于 replay:started 后置 true、finally 复位 false，
 * replay-batch-runner.js 纯插两行）：stop 以 replayRunning 为「回放批真正在跑」
 * 判定——false → 早退 { stopped:false, batchWasRunning:false,
 * reason:'no_replay_batch_running' }（不动 abortReplay、不发 cancel_step）；
 * true → 现行为 + 返回 batchWasRunning:true / cancelStepDelivered。
 * #13：sync 路径 replayTrajectorySteps 的 finally 空壳——runReplayBatch 在进入
 * 其主 try 前抛出时（replay:started 广播/计划日志/菜单导航段）自身 finally 不
 * 执行，busy 泄漏；sync 补 catch 复位（字段集对齐 accept 路径 .catch 兜底：
 * suppressStepPersist/isReplay/abortReplay + session.busy=false，另含
 * replayRunning），并补发 replay:finished error 终态（对齐 accept 路径，防前端
 * 悬挂）后原样 rethrow。
 *
 * 全部为 read_text needle + 源码切片断言（零 import 被测模块——该模块 import
 * 副作用面含 ws-server / executor-session-client，无 ESM mock 能力下不做行为
 * 驱动；锚定为「函数名 + 语义行」切片，任一守卫被移除或移位即红）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const FSH = readFileSync(join(ROOT, 'src/services/trajectory/form-structure-heal.js'), 'utf8');

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

// ── 切片定位：scan 段 catch 返回 → batchResults 解析（G1 所在区间） ───────────
const CATCH_RET = 'return { ok: false, aborted: true, error: msg, results, healed };';
const BATCH_PARSE = 'const batchResults = Array.isArray(result?.results) ? result.results : [];';
const catchRetIdx = idx(FSH, CATCH_RET, 'Type B scan catch 返回');
const batchIdx = idx(FSH, BATCH_PARSE, 'batchResults 解析行');
assert.ok(catchRetIdx < batchIdx, 'scan catch 返回应先于 batchResults 解析');
const SCAN_TAIL = FSH.slice(catchRetIdx, batchIdx);

// ── 切片定位：删除循环头 → removeById（G2 所在区间） ──────────────────────────
const LOOP_START = 'for (const r of candidates) {';
const REMOVE = 'await trajectoryStepDao.removeById(sid);';
const loopIdx = idx(FSH, LOOP_START, '删除循环头');
const removeIdx = idx(FSH, REMOVE, 'removeById 调用');
assert.ok(loopIdx < removeIdx, '删除循环头应先于 removeById');
const LOOP_HEAD = FSH.slice(loopIdx, removeIdx);

// ── 切片定位：reorderByTrajectory → addingLabels（G3 所在区间） ───────────────
const REORDER = 'await trajectoryStepDao.reorderByTrajectory(tid);';
const ADDING = 'const addingLabels = [';
const reorderIdx = idx(FSH, REORDER, 'reorderByTrajectory 调用');
const addingIdx = idx(FSH, ADDING, 'addingLabels 声明');
assert.ok(reorderIdx < addingIdx, 'reorderByTrajectory 应先于 addingLabels 段');
const DELETE_TAIL = FSH.slice(reorderIdx, addingIdx);

// ── 1. G1：scan 成功返回后的 user-abort 守卫（进 parse/safety/needsTypeB 之前） ─
record('1a G1 存在：catch 返回与 batchResults 解析之间复核 runtime.abortReplay',
  count(SCAN_TAIL, 'if (runtime.abortReplay)') === 1);
record('1b G1 返回 user-abort 形状：userAbort 标记 + makeUserAbortError（消费方 isUserAbort 可识别）',
  SCAN_TAIL.includes('userAbort: true') && SCAN_TAIL.includes('makeUserAbortError()'));
record('1c G1 不丢已产生结果：results/healed 原样带回',
  SCAN_TAIL.includes('results,') && /\bhealed,\s*\};/.test(SCAN_TAIL));

// ── 2. G2：删除循环内 removeById 之前的 break 守卫 ─────────────────────────────
record('2a G2 存在：removeById 之前每轮复核 runtime.abortReplay',
  count(LOOP_HEAD, 'if (runtime.abortReplay)') === 1);
record('2b G2 置位即 break（不再继续删）',
  count(LOOP_HEAD, 'break;') === 1);
record('2c G2 守卫先于 removeById（切片内序）',
  LOOP_HEAD.indexOf('if (runtime.abortReplay)') < LOOP_HEAD.indexOf('break;')
  && LOOP_HEAD.lastIndexOf('break;') < LOOP_HEAD.length - 1);
record('2d 全文件唯一删步点：removeById 仅出现一次（新增删点须同 commit 补守卫+补 pin）',
  count(FSH, REMOVE) === 1);
record('2e makeUserAbortError 已从 replay-heal-shared 导入（user-abort 构造单源）',
  FSH.includes('makeUserAbortError,') && FSH.includes("} from './replay-heal-shared.js';"));

// ── 3. G3：删除段结束后、插入段之前的 user-abort 返回 ──────────────────────────
record('3a G3 存在：reorder 与 addingLabels 之间复核 runtime.abortReplay',
  count(DELETE_TAIL, 'if (runtime.abortReplay)') === 1);
record('3b G3 已删条目如实入账：deletedStepIds 带回、不回滚',
  DELETE_TAIL.includes('deletedStepIds: deletedIds'));
record('3c G3 返回 user-abort 形状（对齐既有 :userAbort 收敛分支）',
  DELETE_TAIL.includes('userAbort: true') && DELETE_TAIL.includes('makeUserAbortError()'));
record('3d G3 先于插入段（addingLabels 之前拦截，不进入 runHealStep/改快照）',
  DELETE_TAIL.includes('if (runtime.abortReplay)'));

// ── 4. 系列级兜底：本文件 abort 读点数量只增不减（守卫被删即红） ────────────────
record('4a runtime.abortReplay 读点 ≥4（G1/G2/G3 + 既有 AI 修复段收敛）',
  count(FSH, 'runtime.abortReplay') >= 4,
  `count=${count(FSH, 'runtime.abortReplay')}`);

// ══ Task 2/6 — replay-heal-shared.js runHealStep：reason 分流 + 超时补发 ══════
const RHS = readFileSync(join(ROOT, 'src/services/trajectory/replay-heal-shared.js'), 'utf8');

// ── 切片定位：unsubStopped 订阅 → 超时计时器头（#3 reason 分流所在区间） ──────
const STOP_SUB = "const unsubStopped = execSession.onSessionEvent(runtime.sessionId, 'agent_stopped'";
const TIMER_HEAD = 'const timer = setTimeout(() => {';
const stopSubIdx = idx(RHS, STOP_SUB, 'unsubStopped 订阅');
const timerHeadIdx = idx(RHS, TIMER_HEAD, 'heal 超时计时器头');
assert.ok(stopSubIdx >= 0 && timerHeadIdx > stopSubIdx, 'unsubStopped 应先于 heal 超时计时器');
const STOP_SLICE = RHS.slice(stopSubIdx, timerHeadIdx);

// ── 5. #3：unsubStopped 回调按 payload?.reason 分流 ───────────────────────────
const NSA_IF = "if (payload?.reason === 'new_step_arrived') {";
const nsaIfIdx = STOP_SLICE.indexOf(NSA_IF);
const nsaEndIdx = nsaIfIdx >= 0 ? STOP_SLICE.indexOf('sawAgentStopped = true;', nsaIfIdx) : -1;
assert.ok(nsaEndIdx > nsaIfIdx, 'new_step_arrived 分支应先于用户中断收敛段（sawAgentStopped 置位）');
const NSA_SLICE = STOP_SLICE.slice(nsaIfIdx, nsaEndIdx);

record('5a unsubStopped 回调读取 payload?.reason（handler 带 payload 形参，reason 分流入口）',
  STOP_SLICE.includes("'agent_stopped', (payload) => {") && STOP_SLICE.includes('payload?.reason'));
record('5b new_step_arrived 专属分支存在（语义行锚定，非恒真）',
  nsaIfIdx >= 0 && count(STOP_SLICE, NSA_IF) === 1);
record('5c new_step_arrived 分支不置 abortReplay/sawAgentStopped（只 cleanup + 普通 Error reject）',
  !NSA_SLICE.includes('runtime.abortReplay') && !NSA_SLICE.includes('sawAgentStopped')
  && NSA_SLICE.includes('cleanup();') && NSA_SLICE.includes('rejectP(new Error('));
record('5d NSA reject message 含 agent_stopped(new_step_arrived) 且不被 isUserAbort 误判',
  (() => {
    const m = NSA_SLICE.match(/new Error\('([^']+)'\)/);
    return Boolean(m) && m[1].includes('agent_stopped(new_step_arrived)')
      && !/USER_ABORT|Replay aborted/i.test(m[1]) && m[1] !== 'USER_ABORT';
  })());
record('5e 用户中断收敛保留：cancel_step 语义 + sawAgentStopped/abortReplay/USER_ABORT 原样在回调尾部',
  STOP_SLICE.includes("'cancel_step'")
  && STOP_SLICE.includes('sawAgentStopped = true;')
  && STOP_SLICE.includes('runtime.abortReplay = true;')
  && STOP_SLICE.includes('rejectP(makeUserAbortError());'));
record('5f runHealStep 仍是 agent_stopped 唯一监听方（新增监听方须同 commit 补评估）',
  count(RHS, "onSessionEvent(runtime.sessionId, 'agent_stopped'") === 1);

// ── 切片定位：heal 超时回调（#11 超时补发所在区间） ────────────────────────────
const TIMER_TAIL = '}, HEAL_TIMEOUT_MS);';
const timerEndIdx = idx(RHS, TIMER_TAIL, 'heal 超时回调结束');
assert.ok(timerEndIdx > timerHeadIdx, '计时器头应先于其结束标记');
const TIMER_SLICE = RHS.slice(timerHeadIdx, timerEndIdx);

// ── 6. #11：heal 超时 reject 前补发 cancel_step ───────────────────────────────
record('6a 超时回调内补发 cancel_step：forwardStdin 携带 event/data 且指向本会话',
  count(TIMER_SLICE, "event: 'cancel_step'") === 1
  && TIMER_SLICE.includes('execSession.forwardStdin({')
  && TIMER_SLICE.includes('runtime.executorNodeUuid')
  && TIMER_SLICE.includes('runtime.sessionId'));
record('6b 补发先于超时 reject（rejectP 之前下发）',
  TIMER_SLICE.indexOf('execSession.forwardStdin({')
  < TIMER_SLICE.indexOf("rejectP(new Error('Timeout waiting for heal phase_done'))"));
record('6c 补发为 fire-and-forget：try/catch 包裹 + console.warn 降级（下发失败不阻塞 reject）',
  /try \{\s*execSession\.forwardStdin\(\{[\s\S]*?\} catch \(err\) \{\s*console\.warn\(/.test(TIMER_SLICE));
record('6d 超时 reject 语义保持：Timeout waiting for heal phase_done 仍在',
  TIMER_SLICE.includes('Timeout waiting for heal phase_done'));

// ══ Task 3/6 — replay-batch-runner.js：#4 超时×stop 竞态终态 + #12 中止步终态 ══
const RBR = readFileSync(join(ROOT, 'src/services/trajectory/replay-batch-runner.js'), 'utf8');

// ── 切片定位：单步 catch 头 → batchResults 解析（#4 竞态收敛 + #12 步后中止分支） ─
const CATCH_E = '} catch (e) {';
const BATCH_RESULTS = 'const batchResults = Array.isArray(result?.results) ? result.results : [];';
const catchEIdx = idx(RBR, CATCH_E, '单步 catch 头');
const batchResultsIdx = idx(RBR, BATCH_RESULTS, 'batchResults 解析行');
assert.ok(catchEIdx >= 0 && batchResultsIdx > catchEIdx, '单步 catch 应先于 batchResults 解析');
const STEP_CATCH_SLICE = RBR.slice(catchEIdx, batchResultsIdx);

// ── 7. #4：单步 catch 内先查 abortReplay，置位走 aborted 终态收敛 ──────────────
const raceCheckIdx = STEP_CATCH_SLICE.indexOf('if (runtime.abortReplay)');
const firstFinishedIdx = STEP_CATCH_SLICE.indexOf("emitReplay('replay:finished'");
assert.ok(raceCheckIdx >= 0 && firstFinishedIdx > raceCheckIdx,
  'catch 内竞态检查应先于非中止批级终态（replay:finished {error}）');
const RACE_SLICE = STEP_CATCH_SLICE.slice(raceCheckIdx, firstFinishedIdx);

record('7a 竞态检查先于终态判定：catch 内查 runtime.abortReplay 先于 replay:finished {error}',
  raceCheckIdx >= 0 && raceCheckIdx < firstFinishedIdx);
record('7b 竞态置位收敛为 aborted 批级终态：emitReplayAborted + aborted/reason=user_stop',
  RACE_SLICE.includes('emitReplayAborted(tid, { successCount, failedStepIds })')
  && RACE_SLICE.includes('aborted: true,') && RACE_SLICE.includes("reason: 'user_stop',"));
record('7c 落库口径不变：markStepReplayFailed + failedStepIds.push 先于竞态检查（该步仍记失败）',
  STEP_CATCH_SLICE.indexOf('markStepReplayFailed(stepId)') < raceCheckIdx
  && STEP_CATCH_SLICE.indexOf('failedStepIds.push(stepId)') < raceCheckIdx);
record('7d 步级 failed 终态先于批级收敛：running 步在竞态收敛前已有终态事件',
  STEP_CATCH_SLICE.indexOf("status: 'failed'") < raceCheckIdx);

// ── 8. #12：步后 abort 检查点补发当前步终态（真实空档；循环头无空档） ───────────
const postAbortIdx = STEP_CATCH_SLICE.lastIndexOf('if (runtime.abortReplay)');
assert.ok(postAbortIdx > raceCheckIdx, '步后中止分支应在 catch 内竞态检查之后');
const POST_ABORT_SLICE = STEP_CATCH_SLICE.slice(postAbortIdx);
const stepTermIdx = POST_ABORT_SLICE.indexOf("emitReplay('replay:step'");
const batchAbortIdx = POST_ABORT_SLICE.indexOf('emitReplayAborted(');
assert.ok(stepTermIdx >= 0 && batchAbortIdx > stepTermIdx,
  '步后中止分支应先补发步终态再收敛批次终态');
const STEP_TERMINAL_SLICE = POST_ABORT_SLICE.slice(stepTermIdx, batchAbortIdx);

record('8a 步后中止分支补发当前步终态：replay:step failed + error=user_stop',
  STEP_TERMINAL_SLICE.includes("emitReplay('replay:step'")
  && STEP_TERMINAL_SLICE.includes("status: 'failed',")
  && STEP_TERMINAL_SLICE.includes("error: 'user_stop',")
  && STEP_TERMINAL_SLICE.includes('stepId,'));
record('8b 补发带 aborted 标记（前端可区分 user_stop 与真实失败）',
  STEP_TERMINAL_SLICE.includes('aborted: true,'));
record('8c 补发先于批级 aborted 收敛（步终态 → emitReplayAborted → return）',
  stepTermIdx < batchAbortIdx && POST_ABORT_SLICE.includes("reason: 'user_stop',"));
record('8d 成功路径终态保留：步后中止分支之后 status:success 发射点仍在（补发不替代成功终态）',
  RBR.indexOf("status: 'success'", batchResultsIdx) > -1);
record('8e 循环头中止分支无步级补发（空档核查结论固化：continue 路径均已带终态，此处补发即死代码）',
  (() => {
    const loopHeadIdx = idx(RBR, 'for (let i = 0; i < actions.length; i += 1) {', '批循环头');
    const entryIdx = idx(RBR, 'const entry = actions[i];', 'entry 声明');
    assert.ok(entryIdx > loopHeadIdx, 'entry 声明应在循环头之后');
    const LOOP_HEAD_SLICE = RBR.slice(loopHeadIdx, entryIdx);
    return LOOP_HEAD_SLICE.includes('if (runtime.abortReplay)')
      && LOOP_HEAD_SLICE.includes('emitReplayAborted(')
      && !LOOP_HEAD_SLICE.includes("emitReplay('replay:step'");
  })());

// ══ Task 4/6 — #5 stop 诚实化 + #8 录制期拒绝 + #13 sync busy 泄漏 ════════════
const TSR = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-session-replay.js'), 'utf8');
const TRT = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-runtime.js'), 'utf8');

// ── 切片定位：stopTrajectoryStepsReplay 函数体（止于 prepareReplayBatch 的 JSDoc） ─
const STOP_FN = 'export async function stopTrajectoryStepsReplay(trajectoryId) {';
const stopFnIdx = idx(TSR, STOP_FN, 'stopTrajectoryStepsReplay 定义');
const stopEndIdx = TSR.indexOf('/**', stopFnIdx);
assert.ok(stopEndIdx > stopFnIdx, 'stop 函数体后应紧跟 prepareReplayBatch 的 JSDoc');
const STOP_BODY = TSR.slice(stopFnIdx, stopEndIdx);

// ── 切片定位：早退分支（replayRunning 守卫 → 真停 abortReplay 置位） ───────────
const EARLY_GUARD = 'if (!runtime.replayRunning) {';
const earlyIdx = idx(STOP_BODY, EARLY_GUARD, 'stop 早退分支守卫');
const abortSetIdx = STOP_BODY.indexOf('runtime.abortReplay = true;');
assert.ok(abortSetIdx > earlyIdx, '真停分支（abortReplay 置位）应在早退分支之后');
const EARLY_SLICE = STOP_BODY.slice(earlyIdx, abortSetIdx);

// ── 9. #5/#8/#16 stop 诚实化：无批次（含录制期）早退，不碰 abortReplay/cancel_step ─
record('9a stop 早退分支存在：runtime.replayRunning=false → stopped:false + batchWasRunning:false + reason:no_replay_batch_running',
  EARLY_SLICE.includes('stopped: false,')
  && EARLY_SLICE.includes('batchWasRunning: false,')
  && EARLY_SLICE.includes("reason: 'no_replay_batch_running',"));
record('9b 早退分支不置 abortReplay、不下发 cancel_step（#8 录制期不误杀录制 Agent + #16 空闲期无 abortReplay 残留）',
  !EARLY_SLICE.includes('runtime.abortReplay') && !EARLY_SLICE.includes('forwardStdin'));
record('9c 真停分支返回 batchWasRunning:true + cancelStepDelivered（forwardStdin catch 置 false，正常 true）',
  STOP_BODY.includes('let cancelStepDelivered = true;')
  && count(STOP_BODY, 'cancelStepDelivered = false;') === 1
  && /stopped: true,\s*\n\s*batchWasRunning: true,\s*\n\s*cancelStepDelivered,/.test(STOP_BODY));
record('9d runtime 工厂默认字段 replayRunning:false（trajectory-runtime.js，恰一次）',
  count(TRT, 'replayRunning: false,') === 1);
record('9e runReplayBatch 置位 replayRunning=true：replay:started 之后、首个 await runReplayActions 之前（恰一次）',
  count(RBR, 'runtime.replayRunning = true;') === 1
  && (() => {
    const startedIdx = idx(RBR, "emitReplay('replay:started', tid, { stepIds: orderedStepIds });", 'replay:started 发射');
    const setIdx = idx(RBR, 'runtime.replayRunning = true;', 'replayRunning 置位');
    const firstAwaitIdx = idx(RBR, 'await runReplayActions({', '首个 await runReplayActions');
    return startedIdx < setIdx && setIdx < firstAwaitIdx;
  })());
record('9f runReplayBatch finally 复位 replayRunning=false（与 abortReplay 复位 / busy 释放同段）',
  (() => {
    const finIdx = idx(RBR, '  } finally {', 'runReplayBatch finally');
    const busyIdx = idx(RBR, 'if (session) session.busy = false;', 'busy 释放');
    assert.ok(busyIdx > finIdx, 'busy 释放应在 finally 段内');
    const FIN_SLICE = RBR.slice(finIdx, busyIdx);
    return FIN_SLICE.includes('runtime.abortReplay = false;')
      && FIN_SLICE.includes('runtime.replayRunning = false;');
  })());
record('9g #13 sync 路径补 catch 复位：replayTrajectorySteps 内 catch 含 abortReplay 复位 + busy=false（对齐 accept .catch 字段集）+ 补发 replay:finished 后 rethrow',
  (() => {
    const syncFnIdx = idx(TSR, 'export async function replayTrajectorySteps(', 'sync 回放入口');
    const syncEndIdx = TSR.indexOf('/**', syncFnIdx);
    assert.ok(syncEndIdx > syncFnIdx, 'sync 函数体后应紧跟 stop 的 JSDoc');
    const SYNC_BODY = TSR.slice(syncFnIdx, syncEndIdx);
    const awaitIdx = idx(SYNC_BODY, 'return await runReplayBatch({', 'sync await 批执行');
    const syncCatchIdx = SYNC_BODY.indexOf('} catch (err) {', awaitIdx);
    assert.ok(syncCatchIdx > awaitIdx, 'sync catch 应在 await runReplayBatch 之后');
    const SYNC_CATCH = SYNC_BODY.slice(syncCatchIdx);
    return SYNC_CATCH.includes('runtime.suppressStepPersist = false;')
      && SYNC_CATCH.includes('runtime.isReplay = false;')
      && SYNC_CATCH.includes('runtime.abortReplay = false;')
      && SYNC_CATCH.includes('if (session) session.busy = false;')
      && SYNC_CATCH.includes("emitReplay('replay:finished'")
      && SYNC_CATCH.includes('throw err;');
  })());

const bad = results.filter((r) => !r.ok);
console.log(`\ncharacterize-replay-stop-hardening: ${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
