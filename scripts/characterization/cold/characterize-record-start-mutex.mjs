/**
 * Cold pin: P1-5 per-tid record/start memory mutex.
 *
 * Concurrent start must claim runtime.aiRecording synchronously before the
 * first real await expression (login window can last minutes while phases are
 * not yet 'running', so isAiRecordingActive alone cannot serialize double-click
 * / batch+manual).
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const runnerPath = join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js');
const src = readFileSync(runnerPath, 'utf8');

const startIdx = src.indexOf('export async function startTrajectoryRecording');
assert.ok(startIdx >= 0, 'startTrajectoryRecording found');
// Slice a bounded prefix of the function (claim must be in the first ~40 lines).
const head = src.slice(startIdx, startIdx + 2500);

// Strip line comments so Chinese/English notes mentioning "await" do not count.
const headCode = head.replace(/^\s*\/\/.*$/gm, '');
const firstAwait = headCode.search(/\bawait\b/);
assert.ok(firstAwait > 0, 'function has await');
const beforeAwait = headCode.slice(0, firstAwait);

assert.ok(
  /runtime\.aiRecording/.test(beforeAwait),
  'must read runtime.aiRecording before first await',
);
assert.ok(
  /Recording already in progress/.test(beforeAwait)
    || /already in progress/i.test(beforeAwait),
  'sync path must 409 with already-in-progress when claimed',
);
assert.ok(
  /runtime\.aiRecording\s*=\s*true/.test(beforeAwait),
  'must assign runtime.aiRecording = true before first await (sync claim)',
);

// Keep DB gate as secondary truth for mid-flight phases.
assert.ok(
  /await isAiRecordingActive\(tid\)/.test(head),
  'DB isAiRecordingActive gate retained',
);

console.log('characterize-record-start-mutex: OK');
