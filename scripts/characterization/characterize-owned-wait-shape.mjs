/**
 * Owned-wait production-shape smoke (offline, real hub, no WS).
 *
 * 2a30fc6c 教训（B1）的护栏补洞：characterize-run-event-ownership 用自造
 * addListener 测 waitForSessionEventOwned，抓不住 onSessionEvent 签名漂移。
 * 本 smoke 改用 runner/heal 的**真实接线形状**——经 executor-session-client
 * 再导出的 onSessionEvent（3 参）注册，经 executor-event-hub.emitSessionEvent
 * 发射——任何 arity/参数序漂移都会在此失败。
 * 同时钉 runHealStep 的 runId 下发 + success=false 拒收接线。
 * Run: node scripts/characterization/characterize-owned-wait-shape.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { onSessionEvent } from '../../src/executor-session-client.js';
import { emitSessionEvent, removeSessionHub } from '../../src/executor-event-hub.js';
import {
  waitForSessionEventOwned,
} from '../../src/services/trajectory/run-event-ownership.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function testArity() {
  // B1 回归：3 参签名（sessionId, type, handler）。Function.length 只数显式参数。
  assert.equal(onSessionEvent.length, 3, `onSessionEvent must take (sessionId, type, handler), got length=${onSessionEvent.length}`);
}

async function testRealHubOwnedWait() {
  const sessionId = `smoke-arity-${Date.now()}`;
  try {
    const ignored = [];
    const doneP = waitForSessionEventOwned({
      // 与 trajectory-recording-runner.js / replay-heal-shared.js 相同的绑定形状：
      addListener: (type, handler) => onSessionEvent(sessionId, type, handler),
      type: 'phase_done',
      runId: 'r-owned',
      onIgnored: (payload, reason) => ignored.push(reason),
    });
    // 旧 run 事件（经真实 hub 发射）→ 丢弃
    emitSessionEvent(sessionId, 'phase_done', { runId: 'stale', phase: 1, success: true });
    // 本轮 canceled 回声 → 丢弃
    emitSessionEvent(sessionId, 'phase_done', { runId: 'r-owned', phase: 1, canceled: true });
    // 本轮真正 done → resolve
    emitSessionEvent(sessionId, 'phase_done', { runId: 'r-owned', phase: 1, success: true });
    const payload = await doneP;
    assert.equal(payload.success, true);
    assert.deepEqual(ignored, ['runid_mismatch', 'canceled']);
  } finally {
    removeSessionHub(sessionId);
  }
}

async function testLegacyPayloadStillPasses() {
  const sessionId = `smoke-arity-legacy-${Date.now()}`;
  try {
    const doneP = waitForSessionEventOwned({
      addListener: (type, handler) => onSessionEvent(sessionId, type, handler),
      type: 'phase_done',
      runId: 'r-legacy',
    });
    // 旧执行机不回带 runId → legacy 放行（spec 4.4）
    emitSessionEvent(sessionId, 'phase_done', { phase: 2, success: true });
    const payload = await doneP;
    assert.equal(payload.success, true);
  } finally {
    removeSessionHub(sessionId);
  }
}

function testHealWiring() {
  const src = readFileSync(
    join(root, 'src/services/trajectory/replay-heal-shared.js'), 'utf8');
  assert.ok(
    src.includes("import { waitForSessionEventOwned } from './run-event-ownership.js';"),
    'heal waits go through owned filter',
  );
  assert.ok(src.includes('runId: healRunId'), 'heal step data carries runId');
  assert.ok(
    src.includes("addListener: (type, handler) => execSession.onSessionEvent(runtime.sessionId, type, handler)"),
    'heal addListener binds sessionId (3-arg, arity regression pin)',
  );
  assert.ok(
    src.includes('donePayload?.success === false'),
    'heal rejects phase_done success=false (no fake healed-by-ai)',
  );
  assert.ok(!/unsubDone\s*=\s*execSession\.onSessionEvent\(runtime\.sessionId, 'phase_done'/.test(src),
    'raw phase_done subscription removed from heal wait');
}

const steps = [testArity, testRealHubOwnedWait, testLegacyPayloadStillPasses, testHealWiring];
let failed = 0;
for (const [i, fn] of steps.entries()) {
  try {
    await fn();
    console.log(`step ${i + 1}/${steps.length} ${fn.name}: OK`);
  } catch (err) {
    failed += 1;
    console.error(`step ${i + 1}/${steps.length} ${fn.name}: FAIL — ${err.message}`);
  }
}
if (failed > 0) {
  console.error(`characterize-owned-wait-shape: FAIL (${failed} steps)`);
  process.exit(1);
}
console.log(`characterize-owned-wait-shape: OK ${steps.length}/${steps.length}`);
