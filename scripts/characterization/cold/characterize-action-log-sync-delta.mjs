/**
 * Cold pin: action_log_sync delta merge into in-memory copy.
 * Run: node scripts/characterization/cold/characterize-action-log-sync-delta.mjs
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const mod = await import(
  pathToFileURL(join(ROOT, 'src/services/trajectory/action-log-copy.js')).href
);

function testFullOverwrite() {
  mod.clearActionLogCopy(9001);
  mod.applyActionLogSync(9001, {
    syncMode: 'full',
    entries: [{ id: 'a', action: 'click_button' }, { id: 'b', action: 'fill_form_field' }],
  });
  assert.equal(mod.getActionLogCopy(9001).entries.length, 2);
  mod.applyActionLogSync(9001, {
    syncMode: 'full',
    entries: [{ id: 'c', action: 'click_button' }],
  });
  assert.deepEqual(
    mod.getActionLogCopy(9001).entries.map((e) => e.id),
    ['c'],
  );
}

function testDeltaAppendAndRemove() {
  mod.clearActionLogCopy(9002);
  mod.applyActionLogSync(9002, {
    syncMode: 'full',
    entries: [{ id: '1', action: 'click_button' }],
  });
  mod.applyActionLogSync(9002, {
    syncMode: 'delta',
    entries: [{ id: '2', action: 'fill_form_field' }],
    removedIds: [],
  });
  assert.deepEqual(
    mod.getActionLogCopy(9002).entries.map((e) => e.id),
    ['1', '2'],
  );
  mod.applyActionLogSync(9002, {
    syncMode: 'delta',
    entries: [{ id: '3', action: 'fill_form_field' }],
    removedIds: ['2'],
  });
  assert.deepEqual(
    mod.getActionLogCopy(9002).entries.map((e) => e.id),
    ['1', '3'],
  );
}

function testLegacyMissingSyncModeIsFull() {
  mod.clearActionLogCopy(9003);
  mod.applyActionLogSync(9003, {
    entries: [{ id: 'x', action: 'click_button' }],
  });
  assert.equal(mod.getActionLogCopy(9003).entries[0].id, 'x');
}

function testRunnerWiresApply() {
  const src = readFileSync(
    join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'),
    'utf8',
  );
  assert.match(src, /applyActionLogSync/);
  assert.doesNotMatch(
    src,
    /setActionLogCopy\(tid,\s*entries\)/,
    'runner should not raw-overwrite copy with every sync',
  );
}

testFullOverwrite();
testDeltaAppendAndRemove();
testLegacyMissingSyncModeIsFull();
testRunnerWiresApply();
console.log('characterize-action-log-sync-delta: OK');
