/**
 * Characterization: runReplayActions aborts on terminal session events.
 * Offline (no server/executor/DB). Uses the real executor-event-hub to drive
 * replay_done / session.process_exit / session.error events.
 *
 * Run: node scripts/characterization/characterize-replay-terminal-abort.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let runReplayActions = null;
let hub = null;
let sutAvailable = false;
try {
  ({ runReplayActions } = await import('../../src/services/replay-actions.js'));
  hub = await import('../../src/executor-event-hub.js');
  sutAvailable = true;
} catch (err) {
  // Wiring tests still run if the module graph cannot be imported.
  sutAvailable = false;
}

/**
 * @param {number} ms milliseconds
 * @returns {Promise<void>} resolves after ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a fake executor client backed by the real session hub.
 * @returns {{ calls: object[], onSessionEvent: Function, waitForSessionEvent: Function, forwardStdin: Function }} fake
 */
function makeFakeExecSession() {
  const calls = [];
  return {
    calls,
    onSessionEvent: (...args) => hub.onSessionEvent(...args),
    waitForSessionEvent: (...args) => hub.waitForSessionEvent(...args),
    forwardStdin(payload) {
      calls.push(payload);
    },
  };
}

/**
 * Race a promise against a deadline.
 * @param {Promise<unknown>} promise promise
 * @param {number} ms deadline ms
 * @param {string} label label
 * @returns {Promise<unknown>} result
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`scenario timeout: ${label}`)), ms);
    }),
  ]);
}

async function testProcessExitAbortsReplay() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const execSession = makeFakeExecSession();
  const sessionId = 'term-proc-exit';
  const runP = runReplayActions({
    execSession,
    sessionId,
    nodeUuid: 'n1',
    actions: [{ action: 'go_to_url', params: { url: 'http://example.com' } }],
    timeoutMs: 500,
    abortOnSessionTerminal: true,
  });
  await sleep(10);
  hub.emitSessionEvent(sessionId, 'session.process_exit', { code: 1, sessionId, slotIndex: 2 });
  let threw = false;
  try {
    await withTimeout(runP, 1000, 'process_exit abort');
  } catch (err) {
    threw = true;
    assert.equal(err?.isTerminalReplayAbort, true, 'error is terminal abort');
    assert.equal(err?.terminalType, 'session.process_exit', 'terminal type captured');
    assert.equal(err?.terminalPayload?.code, 1, 'exit code captured');
    assert.match(err.message, /session\.process_exit/, 'message names event');
    assert.match(err.message, /exit code=1/, 'message includes exit code');
  }
  assert.equal(threw, true, 'process_exit causes rejection');
  assert.equal(execSession.calls.length, 1, 'exactly one forwardStdin call');
}

async function testSessionErrorUnknownSessionAbortsReplay() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const execSession = makeFakeExecSession();
  const sessionId = 'term-unknown-session';
  const runP = runReplayActions({
    execSession,
    sessionId,
    nodeUuid: 'n1',
    actions: [{ action: 'login', params: {} }],
    timeoutMs: 500,
    abortOnSessionTerminal: true,
  });
  await sleep(10);
  hub.emitSessionEvent(sessionId, 'session.error', {
    sessionId,
    error: 'Unknown session term-unknown-session',
    code: 'unknown_session',
  });
  let threw = false;
  try {
    await withTimeout(runP, 1000, 'session.error abort');
  } catch (err) {
    threw = true;
    assert.equal(err?.isTerminalReplayAbort, true, 'error is terminal abort');
    assert.equal(err?.terminalType, 'session.error', 'terminal type captured');
    assert.equal(err?.terminalPayload?.code, 'unknown_session', 'unknown_session code captured');
  }
  assert.equal(threw, true, 'session.error causes rejection');
}

async function testNormalReplayDoneStillWorks() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const execSession = makeFakeExecSession();
  const sessionId = 'term-normal';
  const runP = runReplayActions({
    execSession,
    sessionId,
    nodeUuid: 'n1',
    actions: [{ action: 'wait_for_loading' }],
    timeoutMs: 500,
    abortOnSessionTerminal: true,
  });
  await sleep(10);
  const replayId = execSession.calls[0]?.data?.replayId;
  assert.ok(replayId, 'forwardStdin carried replayId');
  hub.emitSessionEvent(sessionId, 'replay_done', { replayId, ok: 1, failed: 0, results: [] });
  const result = await withTimeout(runP, 1000, 'normal replay_done');
  assert.equal(result.ok, 1, 'normal path returns ok count');
}

async function testAbortDisabledIgnoresTerminalEvent() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const execSession = makeFakeExecSession();
  const sessionId = 'term-disabled';
  const runP = runReplayActions({
    execSession,
    sessionId,
    nodeUuid: 'n1',
    actions: [{ action: 'click' }],
    timeoutMs: 500,
    abortOnSessionTerminal: false,
  });
  await sleep(10);
  hub.emitSessionEvent(sessionId, 'session.process_exit', { code: 9, sessionId, slotIndex: 0 });
  await sleep(10);
  const replayId = execSession.calls[0]?.data?.replayId;
  hub.emitSessionEvent(sessionId, 'replay_done', { replayId, ok: 0, failed: 0, results: [] });
  const result = await withTimeout(runP, 1000, 'disabled terminal ignored');
  assert.equal(result.ok, 0, 'terminal ignored when disabled');
}

async function testListenersCleanedUp() {
  if (!sutAvailable) { console.log('    (skipped: SUT not importable)'); return; }
  const execSession = makeFakeExecSession();
  const sessionId = 'term-cleanup';
  const runP = runReplayActions({
    execSession,
    sessionId,
    nodeUuid: 'n1',
    actions: [{ action: 'go_to_url' }],
    timeoutMs: 200,
    abortOnSessionTerminal: true,
  });
  await sleep(10);
  const replayId = execSession.calls[0]?.data?.replayId;
  hub.emitSessionEvent(sessionId, 'replay_done', { replayId, ok: 1, failed: 0, results: [] });
  await withTimeout(runP, 1000, 'cleanup normal');
  const sessionHub = hub.getSessionHub(sessionId);
  assert.equal(sessionHub.listenerCount('replay_done'), 0, 'replay_done listener removed');
  assert.equal(sessionHub.listenerCount('session.process_exit'), 0, 'process_exit listener removed');
  assert.equal(sessionHub.listenerCount('session.closed'), 0, 'closed listener removed');
  assert.equal(sessionHub.listenerCount('session.bib_error'), 0, 'bib_error listener removed');
  assert.equal(sessionHub.listenerCount('session.error'), 0, 'error listener removed');
}

function replaySource() {
  return readFileSync(join(root, 'src/services/replay-actions.js'), 'utf8');
}

function callerSource(path) {
  return readFileSync(join(root, path), 'utf8');
}

function testWiringReplayActionsHelper() {
  const src = replaySource();
  assert.match(src, /abortOnSessionTerminal/, 'runReplayActions exposes abortOnSessionTerminal');
  assert.match(src, /TERMINAL_SESSION_EVENTS/, 'terminal event list exists');
  assert.match(src, /session\.process_exit/, 'process_exit in terminal list');
  assert.match(src, /session\.closed/, 'closed in terminal list');
  assert.match(src, /session\.bib_error/, 'bib_error in terminal list');
  assert.match(src, /session\.error/, 'error in terminal list');
  assert.match(src, /isTerminalReplayAbort/, 'terminal errors carry isTerminalReplayAbort');
}

function testWiringPrepareCallers() {
  const pairs = [
    ['trajectory-record-lifecycle probe login', 'src/services/trajectory/trajectory-record-lifecycle.js'],
    ['trajectory-attach-runner settle', 'src/services/trajectory/trajectory-attach-runner.js'],
    ['recording-page-bind read page code', 'src/services/trajectory/recording-page-bind.js'],
    ['menu-navigation nav replay', 'src/services/trajectory/menu-navigation.js'],
  ];
  for (const [label, path] of pairs) {
    const src = callerSource(path);
    assert.match(src, /abortOnSessionTerminal:\s*true/, `${label} enables terminal abort`);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const tests = [
  testProcessExitAbortsReplay,
  testSessionErrorUnknownSessionAbortsReplay,
  testNormalReplayDoneStillWorks,
  testAbortDisabledIgnoresTerminalEvent,
  testListenersCleanedUp,
  testWiringReplayActionsHelper,
  testWiringPrepareCallers,
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  process.stdout.write(`  ${t.name} ... `);
  try {
    await t();
    console.log('ok');
    passed += 1;
  } catch (err) {
    failed += 1;
    console.log(`FAIL\n    ${err?.message || err}`);
    if (err?.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
  }
}

console.log(`\ncharacterize-replay-terminal-abort: ${passed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
