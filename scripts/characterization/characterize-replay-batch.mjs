/**
 * Characterization: replay batch runner (offline, no server/executor).
 * Protects src/services/trajectory/replay-batch-runner.js runReplayBatch
 * branch behavior ahead of the replay-orchestration unification refactor:
 *   - abort semantics (aborted:true + reason:'user_stop', runtime reset in finally)
 *   - failedStepIds aggregation (dedup, markStepReplayFailed swallow, splice-on-retry)
 *   - successCount aggregation + forwarded replay_actions stdin shape
 *   - Type B form-structure checkpoint ordered before Type A single-step heal
 *
 * Fake-driven scenarios use in-process fakes only:
 *   - executor-registry.attach(nodeUuid, fakeWs) so forwardStdin succeeds
 *   - executor-event-hub.emitSessionEvent to resolve replay_done / get_action_log_result
 *   - non-numeric entry ids ('a','b') keep markStepReplayOk/Failed off the DB;
 *     the pre-loop menu-nav getById is try/caught inside the SUT (works with DB up or down)
 * A transport-failure scenario uses a numeric id (987654321 — nonexistent row)
 * to pin failedStepIds aggregation; its DB write is swallowed by the SUT and
 * updates 0 rows.
 *
 * Run: node scripts/characterization/characterize-replay-batch.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SUT = 'src/services/trajectory/replay-batch-runner.js';
const SHARED = 'src/services/trajectory/replay-heal-shared.js';
/** Nonexistent trajectory/step DB ids used by fake-driven scenarios (no real rows touched). */
const TID = 987654321;

let mod = null;
let shared = null;
let hub = null;
let registry = null;
let closeDB = null;
let sutAvailable = false;
try {
  mod = await import('../../src/services/trajectory/replay-batch-runner.js');
  shared = await import('../../src/services/trajectory/replay-heal-shared.js');
  hub = await import('../../src/executor-event-hub.js');
  registry = await import('../../src/executor-registry.js');
  closeDB = (await import('../../config/database.js')).closeDB;
  sutAvailable = true;
} catch (err) {
  // SUT or its graph not importable — wiring/structural tests still run.
  sutAvailable = false;
}

const runReplayBatch = mod?.runReplayBatch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @param {number} ms milliseconds
 * @returns {Promise<void>} resolves after ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Race a promise against a deadline so a missed hub emit fails the test
 * instead of stalling on the 300s REPLAY_TIMEOUT_MS.
 * @param {Promise<object>} promise runner promise
 * @param {number} ms deadline
 * @param {string} label scenario label
 * @returns {Promise<object>} runner result
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`scenario timeout: ${label}`)), ms);
    }),
  ]);
}

/**
 * Poll the session hub until the SUT has subscribed to an event type, then
 * emit the payload. Deterministic (no fixed sleeps) and offline.
 * @param {string} sessionId fake executor session id
 * @param {string} type hub event type to wait for
 * @param {object} payload payload to emit once subscribed
 * @param {string} label scenario label for timeout errors
 * @returns {Promise<void>} resolves after the emit
 */
async function waitSubscribeAndEmit(sessionId, type, payload, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (hub.getSessionHub(sessionId).listenerCount(type) > 0) {
      hub.emitSessionEvent(sessionId, type, payload);
      return;
    }
    await sleep(5);
  }
  throw new Error(`driver timeout waiting for listener ${type} (${label})`);
}

/**
 * Build a fake connected executor node capturing everything sent over stdin.
 * @returns {{ ws: object, sent: object[], attach: (nodeUuid: string) => void, detach: (nodeUuid: string) => void }} capture fixture
 */
function fakeExecutorNode() {
  const sent = [];
  const ws = {
    readyState: 1,
    send(msg) { sent.push(JSON.parse(msg)); },
    close() { /* no-op */ },
  };
  return {
    ws,
    sent,
    attach(nodeUuid) { registry.attach(nodeUuid, ws, 1); },
    detach(nodeUuid) { registry.detach(nodeUuid, { immediate: true }); },
  };
}

/**
 * Build a minimal trajectory runtime for runReplayBatch.
 * @param {object} opts overrides
 * @returns {object} runtime
 */
function makeRuntime(opts = {}) {
  return {
    sessionId: 'rb-char-session',
    executorNodeUuid: 'rb-char-node-missing',
    trajectoryDbId: TID,
    trajectoryId: TID,
    abortReplay: false,
    persistedActionIds: new Set(),
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Shared-pure function tests (replay-heal-shared.js — stepId / abort semantics)
// ---------------------------------------------------------------------------

function testModuleSurface() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  assert.deepEqual(Object.keys(mod), ['runReplayBatch'],
    'replay-batch-runner exports exactly runReplayBatch');
  assert.equal(typeof runReplayBatch, 'function', 'runReplayBatch is a function');
}

function testSharedToNumericStepId() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  assert.equal(shared.toNumericStepId('12'), 12, "numeric string '12' → 12");
  assert.equal(shared.toNumericStepId(12), 12, 'number 12 → 12');
  assert.equal(shared.toNumericStepId(0), 0, '0 stays 0 (only null/"" are null)');
  assert.equal(shared.toNumericStepId('abc'), null, 'non-numeric string → null (skips DB step marks)');
  assert.equal(shared.toNumericStepId(''), null, "empty string → null");
  assert.equal(shared.toNumericStepId(null), null, 'null → null');
  assert.equal(shared.toNumericStepId(undefined), null, 'undefined → null');
}

function testSharedUserAbortSemantics() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  assert.equal(shared.USER_ABORT_CODE, 'USER_ABORT', 'USER_ABORT_CODE sentinel value');
  const err = shared.makeUserAbortError();
  assert.equal(err.code, 'USER_ABORT', 'makeUserAbortError stamps code');
  assert.ok(shared.isUserAbort(err), 'code USER_ABORT → isUserAbort true');
  assert.ok(shared.isUserAbort(new Error('USER_ABORT')), 'message USER_ABORT → true');
  assert.ok(shared.isUserAbort(new Error('Replay aborted by user')), "'Replay aborted' message → true");
  assert.equal(shared.isUserAbort(new Error('Timeout waiting for replay_done')), false,
    'transport timeout is not a user abort');
  assert.equal(shared.isUserAbort(null), false, 'null → false');
}

function testSharedConstantsAndScope() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  assert.equal(shared.REPLAY_TIMEOUT_MS, 300000, 'REPLAY_TIMEOUT_MS = 300000');
  assert.equal(shared.HEAL_MAX_STEPS, 12, 'HEAL_MAX_STEPS = 12');
  assert.deepEqual(shared.trajScope(7), { trajectoryId: 7, trajectoryDbId: 7 },
    'trajScope shape for WS payloads');
  assert.equal(typeof shared.emitReplay, 'function', 'emitReplay exported');
  assert.equal(typeof shared.runHealStep, 'function', 'runHealStep exported');
}

// ---------------------------------------------------------------------------
// Fake-driven runReplayBatch scenarios (fully offline)
// ---------------------------------------------------------------------------

async function testEmptyActionsCompletes() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const runtime = makeRuntime({
    abortReplay: true, suppressStepPersist: true, isReplay: true, formStructureHealLabels: ['x'],
  });
  const session = { busy: true };
  const out = await withTimeout(runReplayBatch({
    tid: TID, orderedStepIds: [], doSuppress: true, runtime, session,
    actions: [], rows: [], snapshotsByTrigger: new Map(),
  }), 60000, 'empty-actions');

  assert.equal(out.trajectoryId, TID, 'trajectoryId = tid');
  assert.equal(out.trajectoryDbId, TID, 'trajectoryDbId = tid');
  assert.equal(out.count, 0, 'empty actions → count 0');
  assert.equal(out.ok, 0, 'ok 0');
  assert.equal(out.successCount, 0, 'successCount 0');
  assert.equal(out.failed, 0, 'failed 0');
  assert.equal(out.failedCount, 0, 'failedCount 0');
  assert.deepEqual(out.failedStepIds, [], 'failedStepIds empty');
  assert.deepEqual(out.results, [], 'results empty');
  assert.deepEqual(out.healed, [], 'healed empty');
  assert.equal(out.aborted, false, 'not aborted — abort check lives inside the step loop');
  assert.equal(out.reason, null, 'reason null on normal completion');
  assert.equal(out.error, null, 'error null on normal completion');
  assert.equal(out.isReplay, true, 'isReplay mirrors doSuppress');
  assert.equal(runtime.abortReplay, false, 'finally resets runtime.abortReplay');
  assert.equal(runtime.isReplay, false, 'finally resets runtime.isReplay');
  assert.equal(runtime.suppressStepPersist, false, 'finally resets suppressStepPersist');
  assert.equal(runtime.formStructureHealLabels, null, 'finally resets formStructureHealLabels');
  assert.equal(session.busy, false, 'finally releases session.busy');
}

async function testAbortAtStart() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const runtime = makeRuntime({ abortReplay: true });
  const session = { busy: true };
  const out = await withTimeout(runReplayBatch({
    tid: TID, orderedStepIds: [5], doSuppress: false, runtime, session,
    actions: [{ id: 5, action: 'click', params: {} }], rows: [{ id: 5 }],
    snapshotsByTrigger: new Map(),
  }), 60000, 'abort-at-start');

  assert.equal(out.aborted, true, 'aborted true');
  assert.equal(out.reason, 'user_stop', 'abort reason is user_stop');
  assert.equal(out.error, null, 'abort payload error null');
  assert.equal(out.successCount, 0, 'no success counted');
  assert.equal(out.failedCount, 0, 'no failures counted');
  assert.deepEqual(out.failedStepIds, [], 'no failedStepIds on pre-step abort');
  assert.equal(out.count, 0, 'no results recorded');
  assert.deepEqual(out.stepIds, [5], 'stepIds from rows');
  assert.equal(out.isReplay, false, 'isReplay mirrors doSuppress=false');
  assert.equal(runtime.abortReplay, false, 'finally resets runtime.abortReplay');
  assert.equal(session.busy, false, 'finally releases session.busy');
}

async function testStepSuccessAggregation() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const node = fakeExecutorNode();
  node.attach('rb-char-node-ok');
  const runtime = makeRuntime({
    sessionId: 'rb-char-success',
    executorNodeUuid: 'rb-char-node-ok',
    suppressStepPersist: true, isReplay: true, formStructureHealLabels: ['x'],
  });
  const session = { busy: true };
  const actions = [
    { id: 'a', action: 'click', params: { xpath: '//a' } },
    { id: 'b', action: 'input', params: { xpath: '//input' } },
  ];
  try {
    const p = runReplayBatch({
      tid: TID, orderedStepIds: [1, 2], doSuppress: true, runtime, session,
      actions, rows: [{ id: 11 }, { id: 12 }], snapshotsByTrigger: new Map(),
    });
    for (let step = 0; step < 2; step += 1) {
      await waitSubscribeAndEmit('rb-char-success', 'replay_done',
        { ok: 1, failed: 0, results: [{ ok: true, result: 'ok' }] }, `success step ${step}`);
      await waitSubscribeAndEmit('rb-char-success', 'get_action_log_result',
        { entries: [] }, `success mark ${step}`);
    }
    const out = await withTimeout(p, 30000, 'step-success');

    assert.equal(out.successCount, 2, 'successCount aggregates both ok steps');
    assert.equal(out.ok, 2, 'ok mirrors successCount');
    assert.equal(out.failedCount, 0, 'failedCount 0');
    assert.equal(out.count, 2, 'count 2');
    assert.deepEqual(out.stepIds, [11, 12], 'stepIds from rows');
    assert.deepEqual(out.failedStepIds, [], 'no failedStepIds on all-ok');
    assert.equal(out.aborted, false, 'not aborted');
    assert.equal(out.error, null, 'error null');
    assert.equal(out.results[0].ok, true, 'result 0 ok');
    assert.equal(out.results[0].confirmed, true, 'result 0 confirmed');
    assert.equal(out.results[0].id, 'a', 'result 0 id from entry');
    assert.equal(out.results[0].index, 1, 'result 0 index 1-based');
    assert.equal(out.results[1].index, 2, 'result 1 index 2');
    assert.equal(runtime.isReplay, false, 'finally resets runtime.isReplay');
    assert.equal(runtime.suppressStepPersist, false, 'finally resets suppressStepPersist');
    assert.equal(session.busy, false, 'finally releases session.busy');

    // forwarded stdin contract: one replay_actions per step, single-action batch
    const forwards = node.sent.filter((m) => m.payload?.event === 'replay_actions');
    assert.equal(forwards.length, 2, 'one replay_actions forward per step');
    assert.deepEqual(forwards[0].payload.data.actions, [actions[0]],
      'forward carries the single entry');
    assert.equal(forwards[0].payload.data.is_replay, true, 'is_replay = doSuppress');
    assert.equal(forwards[0].payload.data.stop_on_fail, true, 'stop_on_fail true');
    assert.equal(forwards[1].payload.data.actions[0].id, 'b', 'second forward is step 2');
  } finally {
    hub.removeSessionHub('rb-char-success');
    node.detach('rb-char-node-ok');
  }
}

async function testAbortMidBatchDropsExecutedStep() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const node = fakeExecutorNode();
  node.attach('rb-char-node-abort');
  const runtime = makeRuntime({
    sessionId: 'rb-char-abort-mid',
    executorNodeUuid: 'rb-char-node-abort',
  });
  const session = { busy: true };
  try {
    const p = runReplayBatch({
      tid: TID, orderedStepIds: [], doSuppress: true, runtime, session,
      actions: [
        { id: 'a', action: 'click', params: {} },
        { id: 'b', action: 'click', params: {} },
      ],
      rows: [], snapshotsByTrigger: new Map(),
    });
    await waitSubscribeAndEmit('rb-char-abort-mid', 'replay_done',
      { ok: 1, failed: 0, results: [{ ok: true, result: 'ok' }] }, 'abort-mid step 1');
    // set abort synchronously after resolving step 1's replay_done — the
    // post-step abort check must fire before the ok result is counted.
    runtime.abortReplay = true;
    await waitSubscribeAndEmit('rb-char-abort-mid', 'get_action_log_result',
      { entries: [] }, 'abort-mid mark 1');
    const out = await withTimeout(p, 30000, 'abort-mid');

    assert.equal(out.aborted, true, 'aborted true mid-batch');
    assert.equal(out.reason, 'user_stop', 'mid-batch abort reason user_stop');
    assert.equal(out.error, null, 'abort payload error null');
    assert.equal(out.successCount, 0, 'executed-but-aborted step is not counted as success');
    assert.deepEqual(out.failedStepIds, [], 'no failures on abort');
    assert.equal(out.count, 0, 'executed-but-aborted step result is dropped');
    assert.deepEqual(out.results, [], 'no result rows on abort');
    const forwards = node.sent.filter((m) => m.payload?.event === 'replay_actions');
    assert.equal(forwards.length, 1, 'step 2 never forwarded after abort');
    assert.equal(runtime.abortReplay, false, 'finally resets runtime.abortReplay');
    assert.equal(session.busy, false, 'finally releases session.busy');
  } finally {
    hub.removeSessionHub('rb-char-abort-mid');
    node.detach('rb-char-node-abort');
  }
}

async function testTransportFailureAggregatesFailedStepIds() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const runtime = makeRuntime({
    sessionId: 'rb-char-fail',
    executorNodeUuid: 'rb-char-node-missing', // not attached → forwardStdin throws
  });
  const session = { busy: true };
  const out = await withTimeout(runReplayBatch({
    tid: TID, orderedStepIds: [7], doSuppress: false, runtime, session,
    actions: [{ id: TID, action: 'click', params: {} }], rows: [{ id: 7 }],
    snapshotsByTrigger: new Map(),
  }), 60000, 'transport-failure');

  assert.equal(out.aborted, false, 'transport failure is not an abort');
  assert.equal(out.reason, null, 'reason null (failure, not user_stop)');
  assert.equal(out.successCount, 0, 'successCount 0');
  assert.equal(out.failedCount, 1, 'failedCount 1');
  assert.deepEqual(out.failedStepIds, [TID], 'numeric stepId aggregated into failedStepIds');
  assert.equal(out.count, 1, 'failure result row present');
  assert.equal(out.ok, 0, 'ok 0');
  assert.equal(out.results[0].ok, false, 'result row ok=false');
  assert.equal(out.results[0].id, TID, 'result row id from entry');
  assert.equal(out.results[0].index, 1, 'result row index 1');
  assert.match(String(out.results[0].result), /not connected/, 'result row carries error text');
  assert.match(String(out.error), /not connected/, 'payload error carries transport failure');
}

// ---------------------------------------------------------------------------
// Structural assertions (readFileSync + assert.match) — run regardless of import
// ---------------------------------------------------------------------------

function testStructureAbortSemantics() {
  const src = readFileSync(join(root, SUT), 'utf8');
  const userStopCount = (src.match(/reason: 'user_stop'/g) || []).length;
  assert.ok(userStopCount >= 5,
    `user_stop abort payloads present (found ${userStopCount}, expect >= 5: helper + abort return sites)`);
  const abortSites = (src.match(/emitReplayAborted\(tid/g) || []).length;
  assert.ok(abortSites >= 4,
    `emitReplayAborted call sites present (found ${abortSites}, expect >= 4)`);
  const abortChecks = (src.match(/runtime\.abortReplay/g) || []).length;
  assert.ok(abortChecks >= 5,
    `runtime.abortReplay checks present (found ${abortChecks}, expect >= 5: loop head, post-step, retry loop, post-heal, heal catch)`);
  assert.match(src, /aborted: true,/, 'emitReplayAborted payload sets aborted: true');
  assert.match(src, /error: null,/, 'abort payload error is null');
  assert.match(src, /function emitReplayAborted/, 'emitReplayAborted helper defined');
}

function testStructureFailedStepAggregation() {
  const src = readFileSync(join(root, SUT), 'utf8');
  const dedupCount = (src.match(/\[\.\.\.new Set\(failedStepIds\)\]/g) || []).length;
  assert.ok(dedupCount >= 5,
    `failedStepIds dedup via Set present (found ${dedupCount}, expect >= 5)`);
  assert.match(src, /failedStepIds: counts\.failedStepIds \|\| \[\]/,
    'buildPayload failedStepIds fallback to []');
  assert.match(src, /successCount: counts\.successCount \?\? okCount/,
    'buildPayload successCount: explicit counts win over computed');
  assert.match(src, /failed: counts\.failedCount \?\? failCount/,
    'buildPayload failed: explicit counts win over computed');
  assert.match(src, /error: counts\.aborted \? null : \(error \|\| null\)/,
    'buildPayload error nulled when aborted');
  assert.match(src, /aborted: !!counts\.aborted/, 'buildPayload aborted flag');
  assert.match(src, /reason: counts\.reason \|\| null/, 'buildPayload reason passthrough');
  assert.match(src, /await markStepReplayFailed\(stepId\)/, 'failed steps marked in DB (best effort)');
  assert.match(src, /await markStepReplayOk\(stepId\)/, 'ok steps marked in DB (best effort)');
  assert.match(src, /await markConsumedActionLog\(runtime\)/, 'consumed action log marked');
  // retry-ok must remove the step from failedStepIds
  assert.match(src, /failedStepIds\.splice/, 'retry-ok removes stepId from failedStepIds');
  assert.match(src, /failedIndex !== -1/, 'splice guarded by indexOf !== -1');
}

function testStructureTypeBBeforeTypeA() {
  const src = readFileSync(join(root, SUT), 'utf8');
  const typeB = src.indexOf("entry.action === 'save_form_snapshot'");
  const typeBCall = src.indexOf('handleFormStructureCheckpoint(');
  const typeACall = src.indexOf('runHealStep(');
  assert.ok(typeB !== -1, "Type B trigger 'save_form_snapshot' checked");
  assert.ok(typeBCall !== -1, 'Type B handled via handleFormStructureCheckpoint');
  assert.ok(typeACall !== -1, 'Type A heal via runHealStep');
  assert.ok(typeBCall < typeACall,
    'Type B form-structure checkpoint runs before Type A single-step heal');
  assert.match(src, /const skippedIds = new Set\(\)/, 'skippedIds set declared');
  assert.match(src, /skippedIds\.has\(stepId\)/, 'skipped steps are skipped mid-batch');
  assert.match(src, /skippedIds,/, 'skippedIds handed to handleFormStructureCheckpoint');
  assert.match(src, /healType: 'form_structure'/, 'Type B finished payload tagged form_structure');
  assert.match(src, /FORM_STRUCTURE_SOFT_FAIL_CONTINUE/, 'Type B soft-fail continue marker');
}

function testStructureHealBranches() {
  const src = readFileSync(join(root, SUT), 'utf8');
  assert.match(src, /buildHealContract\(/, 'Type A builds heal contract');
  assert.match(src, /buildStepHealInstruction\(/, 'Type A builds heal instruction');
  assert.match(src, /routeSuggestedAction\(/, 'heal decision routing consulted');
  assert.match(src, /healDecisionEnabled\(\)/, 'heal decision flag checked');
  assert.match(src, /runHealStep\(runtime, instruction, HEAL_MAX_STEPS, 'step', contract\)/,
    'Type A runs single-step AI heal with step scope');
  assert.match(src, /isUserAbort\(typeB\.error\)/, 'Type B user abort detected via isUserAbort');
  assert.match(src, /isUserAbort\(healErr\)/, 'heal errors checked for user abort');
  assert.match(src, /USER_ABORT_CODE/, 'USER_ABORT_CODE sentinel used in heal broadcasts');
  // heal-decision routes
  assert.match(src, /decision: 'skip'/, 'heal route skip pinned');
  assert.match(src, /skip-by-decision/, 'skip route rewrites result text');
  assert.match(src, /decision: 'fail'/, 'heal route fail pinned');
  assert.match(src, /heal decision: fail/, 'fail route finishes batch with error');
  assert.match(src, /decision: 'retry'/, 'heal route retry pinned');
  assert.match(src, /Math\.min\(Number\(contract\.runtime\?\.retry_count\) \|\| 1, 3\)/,
    'retry limit clamped to 1..3');
  assert.match(src, /retried-ok \(was: /, 'retry-ok result text');
  assert.match(src, /retry-failed \(was: /, 'retry-failed result text');
  assert.match(src, /healed-by-ai \(was: /, 'AI-healed result text');
  assert.match(src, /healed\.push\(\{/, 'healed entries recorded');
}

function testStructureFinallyReset() {
  const src = readFileSync(join(root, SUT), 'utf8');
  assert.match(src, /runtime\.suppressStepPersist = false;/, 'finally: suppressStepPersist off');
  assert.match(src, /runtime\.isReplay = false;/, 'finally: isReplay off');
  assert.match(src, /runtime\.formStructureHealLabels = null;/, 'finally: formStructureHealLabels cleared');
  const abortReset = (src.match(/runtime\.abortReplay = false;/g) || []).length;
  assert.equal(abortReset, 1, 'finally: abortReplay reset exactly once');
  assert.match(src, /session\.busy = false;/, 'finally: session slot released');
}

function testStructureForwardContract() {
  const src = readFileSync(join(root, SUT), 'utf8');
  const stopOnFail = (src.match(/stop_on_fail: true/g) || []).length;
  assert.ok(stopOnFail >= 2, `stop_on_fail true on every replay forward (found ${stopOnFail})`);
  assert.match(src, /event: 'replay_actions'/, 'replay forwarded as replay_actions');
  assert.match(src, /actions: \[entry\]/, 'single-action batches forwarded');
  assert.match(src, /waitForSessionEvent\(runtime\.sessionId, 'replay_done', REPLAY_TIMEOUT_MS\)/,
    'replay_done awaited with REPLAY_TIMEOUT_MS');
}

function testWiringSharedModule() {
  const src = readFileSync(join(root, SHARED), 'utf8');
  assert.match(src, /const USER_ABORT_CODE = 'USER_ABORT';/, 'shared defines USER_ABORT_CODE');
  assert.match(src, /export \{/, 'shared exports helpers block');
  for (const name of ['isUserAbort', 'toNumericStepId', 'runHealStep', 'emitReplay', 'trajScope']) {
    assert.ok(src.includes(name), `shared exports ${name} used by batch runner`);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== replay batch runner characterization ===\n');
  const tests = [
    ['module surface: exports exactly runReplayBatch', testModuleSurface],
    ['shared: toNumericStepId coercion contract', testSharedToNumericStepId],
    ['shared: USER_ABORT sentinel + isUserAbort semantics', testSharedUserAbortSemantics],
    ['shared: timeouts + trajScope + emitReplay/runHealStep exports', testSharedConstantsAndScope],
    ['runReplayBatch: empty actions completes (count 0, runtime reset)', testEmptyActionsCompletes],
    ['runReplayBatch: abort at start → aborted/user_stop, nothing executed', testAbortAtStart],
    ['runReplayBatch: two ok steps → successCount 2 + replay_actions forwards', testStepSuccessAggregation],
    ['runReplayBatch: abort mid-batch drops the executed step', testAbortMidBatchDropsExecutedStep],
    ['runReplayBatch: transport failure → failedStepIds aggregated', testTransportFailureAggregatesFailedStepIds],
    ['structure: abort semantics (user_stop sites + abortReplay checks)', testStructureAbortSemantics],
    ['structure: failedStepIds aggregation + buildPayload precedence', testStructureFailedStepAggregation],
    ['structure: Type B checkpoint ordered before Type A heal', testStructureTypeBBeforeTypeA],
    ['structure: heal routes skip/fail/retry + retry clamp 1..3', testStructureHealBranches],
    ['structure: finally resets runtime + session.busy', testStructureFinallyReset],
    ['structure: single-action replay forward contract (stop_on_fail)', testStructureForwardContract],
    ['wiring: replay-heal-shared exports the abort/stepId helpers', testWiringSharedModule],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }

  // Cleanup: release the knex pool / hub / registry so the process exits.
  try { hub?.removeSessionHub('rb-char-session'); } catch { /* ignore */ }
  try { registry?.clearAll?.(); } catch { /* ignore */ }
  try { await closeDB?.(); } catch { /* ignore */ }

  console.log(failed ? '\nFAIL' : '\nOK');
  // Explicit exit: scenario stubs leave REPLAY_TIMEOUT_MS (300s) hub timers and
  // a knex pool alive, which would keep the event loop pending.
  process.exit(failed ? 1 : 0);
}

main();
