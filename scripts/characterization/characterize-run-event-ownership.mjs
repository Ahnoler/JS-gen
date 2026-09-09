/**
 * runId ownership filter (offline, no DB/session).
 * Run: node scripts/characterization/characterize-run-event-ownership.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  phaseEventOwnership,
  waitForSessionEventOwned,
} from '../../src/services/trajectory/run-event-ownership.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function testOwnership() {
  // owned + matching phase → accept
  assert.deepEqual(
    phaseEventOwnership({ runId: 'r1', phase: 2 }, { runId: 'r1', phaseNumber: 2 }),
    { decision: 'accept', reason: '' },
  );
  // runId mismatch → ignore（僵尸 agent 事件）
  assert.equal(
    phaseEventOwnership({ runId: 'stale', phase: 4 }, { runId: 'r1', phaseNumber: 1 }).decision,
    'ignore',
  );
  // phase mismatch（同 run 内等阶段 1 时到了阶段 2 的 done）→ ignore
  assert.equal(
    phaseEventOwnership({ runId: 'r1', phase: 2 }, { runId: 'r1', phaseNumber: 1 }).decision,
    'ignore',
  );
  // payload 无 runId → legacy（兼容旧执行机），phase 匹配时放行
  assert.deepEqual(
    phaseEventOwnership({ phase: 2 }, { runId: 'r1', phaseNumber: 2 }),
    { decision: 'legacy', reason: 'missing_runid' },
  );
  // 终审 M1：phase 校验先于 legacy 放行——旧执行机僵尸 done（无 runId 且阶段错位）必须丢
  assert.equal(
    phaseEventOwnership({ phase: 9 }, { runId: 'r1', phaseNumber: 2 }).decision,
    'ignore',
  );
  // persist 类订阅不传 phaseNumber → 不做阶段校验
  assert.equal(
    phaseEventOwnership({ runId: 'r1', phase: 9 }, { runId: 'r1' }).decision,
    'accept',
  );
  assert.equal(
    phaseEventOwnership({ runId: 'stale' }, { runId: 'r1' }).decision,
    'ignore',
  );
}

async function testOwnedWait() {
  const hub = new EventEmitter();
  const addListener = (type, handler) => {
    hub.on(type, handler);
    return () => hub.off(type, handler);
  };
  const ignored = [];
  const doneP = waitForSessionEventOwned({
    addListener,
    type: 'phase_done',
    runId: 'r1',
    phaseNumber: 1,
    onIgnored: (payload, reason) => ignored.push(reason),
  });
  // 僵尸 done：旧 run 事件、同 run 阶段错位 —— 均忽略
  // （M1 后 phase 校验先行：两例均以 phase_mismatch 命中）
  hub.emit('phase_done', { runId: 'stale', phase: 4 });
  hub.emit('phase_done', { runId: 'r1', phase: 2 });
  // 跨 run canceled（阶段号匹配、runId 不匹配）→ 维持忽略
  hub.emit('phase_done', { runId: 'stale', phase: 1, canceled: true });
  assert.deepEqual(ignored, ['phase_mismatch', 'phase_mismatch', 'runid_mismatch']);
  // P0-2①：own-run canceled → settle（stop 后快速退出；spec 4.3.2 不计入阶段完成）
  hub.emit('phase_done', { runId: 'r1', phase: 1, canceled: true });
  const canceledPayload = await doneP;
  assert.equal(canceledPayload.canceled, true);

  // 真正的本轮阶段 1 done → resolve（新等待）
  const done2 = waitForSessionEventOwned({
    addListener,
    type: 'phase_done',
    runId: 'r1',
    phaseNumber: 1,
    onIgnored: (payload, reason) => ignored.push(reason),
  });
  hub.emit('phase_done', { runId: 'r1', phase: 1, success: true });
  const payload = await done2;
  assert.equal(payload.success, true);

  // legacy（无 runId）canceled → 维持忽略（兼容窗口，spec 4.4）
  const legacyCanceledIgnored = [];
  const legacyCanceledP = waitForSessionEventOwned({
    addListener,
    type: 'phase_done',
    runId: 'r9',
    phaseNumber: 3,
    onIgnored: (payload2, reason) => legacyCanceledIgnored.push(reason),
  });
  hub.emit('phase_done', { phase: 3, canceled: true });
  assert.deepEqual(legacyCanceledIgnored, ['missing_runid', 'canceled']);
  // 随后的 legacy 正常 done 仍放行
  hub.emit('phase_done', { phase: 3, success: false });
  const legacyCanceledPayload = await legacyCanceledP;
  assert.equal(legacyCanceledPayload.success, false);

  // 兼容旧执行机（spec 4.4）：payload 无 runId → legacy 放行（resolve，日志经 onIgnored）
  const legacyIgnored = [];
  const legacyP = waitForSessionEventOwned({
    addListener,
    type: 'phase_done',
    runId: 'r2',
    phaseNumber: 3,
    onIgnored: (payload, reason) => legacyIgnored.push(reason),
  });
  hub.emit('phase_done', { phase: 3, success: false });
  const legacyPayload = await legacyP;
  assert.equal(legacyPayload.success, false);
  assert.deepEqual(legacyIgnored, ['missing_runid']);

  // cancel 语义：cancel 后 await 静默 resolve undefined（不挂起、不 reject）
  const p2 = waitForSessionEventOwned({ addListener, type: 'phase_done', runId: 'rX' });
  p2.cancel();
  assert.equal(await p2, undefined);
}

function testRunnerWiring() {
  // 文本 pin：runner 已接线（Task 2/3 完成后本段通过）
  const runner = readFileSync(
    join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  assert.ok(runner.includes('runtime.currentRunId'), 'runner stores currentRunId');
  assert.ok(runner.includes('stepData.runId'), 'runner sends runId in step data');
  assert.ok(
    runner.includes("waitForSessionEventOwned({") ,
    'phase_done/phase_error waits go through owned filter',
  );
  // 终审 B1 回归 pin：addListener 必须在 runner 内绑定 sessionId（3 参），不能直传
  // execSession.onSessionEvent（错位实参 → TypeError → 所有录制阶段 1 失败）。
  assert.ok(
    /addListener:\s*\(type,\s*handler\)\s*=>\s*execSession\.onSessionEvent\(runtime\.sessionId,\s*type,\s*handler\)/.test(runner),
    'addListener binds sessionId (arity regression pin)',
  );
  assert.ok(!/addListener:\s*execSession\.onSessionEvent\b/.test(runner),
    'addListener must not be passed unbound');
  assert.ok(runner.includes('cancel_step'), 'finally re-sends cancel_step');
}

function testRunnerOwnFilterWiring() {
  const runner = readFileSync(
    join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  // 订阅回调里的落库事件过滤（Task 3）：persist 事件必须先过 ownership 再计数/落库
  const cb = runner.split('subscribeSessionEvents(runtime.sessionId')[1] || '';
  assert.ok(cb.includes('phaseEventOwnership'), 'persist callback filters by ownership');
}

/** Pin: startPhaseWatchdog returns a Promise; must NOT destructure as `{ idleP }`
 *  (that yields undefined → Promise.race resolves immediately → zero-step fake record). */
function testIdleWatchdogNoDestructure() {
  const runner = readFileSync(
    join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  assert.match(runner, /const idleP = startPhaseWatchdog\(phase\)/,
    'idleP assigned from startPhaseWatchdog return value');
  assert.doesNotMatch(runner, /const \{ idleP \} = startPhaseWatchdog/,
    'must not destructure startPhaseWatchdog (returns Promise, not {idleP})');
}

const steps = [testOwnership, testOwnedWait, testRunnerWiring, testRunnerOwnFilterWiring, testIdleWatchdogNoDestructure];
for (const [i, fn] of steps.entries()) {
  try {
    await fn();
  } catch (err) {
    console.error(`FAIL step ${i + 1} (${fn.name}): ${err.message}`);
    process.exit(1);
  }
}
console.log('PASS characterize-run-event-ownership');
