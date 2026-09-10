/**
 * Cold pin: P1-6 replayId ownership for replay_done + timeout cancel_step.
 *
 * Stale replay_done must not satisfy a newer wait; Node timeout must cancel Python.
 * Run: node scripts/characterization/cold/characterize-replay-id.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const {
  replayDoneOwnership,
  waitForOwnedReplayDone,
} = await import(
  pathToFileURL(join(ROOT, 'src/services/replay-actions.js')).href
);

function testOwnership() {
  assert.deepEqual(
    replayDoneOwnership({ replayId: 'r1', ok: 1 }, 'r1'),
    { decision: 'accept', reason: '' },
  );
  assert.equal(
    replayDoneOwnership({ replayId: 'stale', ok: 2 }, 'r1').decision,
    'ignore',
  );
  assert.deepEqual(
    replayDoneOwnership({ ok: 1 }, 'r1'),
    { decision: 'legacy', reason: 'missing_replayid' },
  );
}

async function testWaitIgnoresStaleThenAccepts() {
  const hub = new EventEmitter();
  const execSession = {
    onSessionEvent(sessionId, type, handler) {
      assert.equal(sessionId, 's1');
      assert.equal(type, 'replay_done');
      hub.on(type, handler);
      return () => hub.off(type, handler);
    },
  };
  const p = waitForOwnedReplayDone(execSession, 's1', 'want', 2000);
  hub.emit('replay_done', { replayId: 'other', ok: 9 });
  hub.emit('replay_done', { replayId: 'want', ok: 1, failed: 0 });
  const got = await p;
  assert.equal(got.ok, 1);
  assert.equal(got.replayId, 'want');
}

function testHelperSourcePins() {
  const helper = readFileSync(join(ROOT, 'src/services/replay-actions.js'), 'utf8');
  assert.match(helper, /replayId/, 'mints/forwards replayId');
  assert.match(helper, /waitForOwnedReplayDone|replayDoneOwnership/, 'owned wait helper');
  assert.match(helper, /cancel_step/, 'timeout path sends cancel_step');
  assert.match(helper, /randomUUID|crypto/, 'replayId from uuid');
  const py = readFileSync(join(ROOT, 'scripts/event_dispatch.py'), 'utf8');
  assert.match(py, /replayId/, 'Python echoes replayId on replay_done');
  const rerun = readFileSync(join(ROOT, 'src/services/rerun-replay-service.js'), 'utf8');
  assert.match(
    rerun,
    /runReplayActions|replayId/,
    'rerun path must not bare-wait replay_done without replayId',
  );
}

async function main() {
  testOwnership();
  console.log('  ✓ ownership accept/ignore/legacy');
  await testWaitIgnoresStaleThenAccepts();
  console.log('  ✓ wait ignores stale then accepts');
  testHelperSourcePins();
  console.log('  ✓ source pins');
  console.log('characterize-replay-id: OK');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
