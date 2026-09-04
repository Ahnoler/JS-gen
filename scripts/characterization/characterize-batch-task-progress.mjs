/**
 * Characterization: phase done_logs parse/append + batch row progress formula.
 * Run: node scripts/characterization/characterize-batch-task-progress.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseDoneLogs,
  appendDoneLogEntry,
  DONE_LOG_TEXT_MAX,
} from '../../src/models/phase-done-logs.js';
import {
  computeBatchItemProgress,
  summarizePhases,
} from '../../src/services/trajectory/batch-item-progress.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const phaseSvc = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-phase-service.js'), 'utf-8');
assert.match(phaseSvc, /export async function appendPhaseDoneLog/);
assert.match(phaseSvc, /done_logs: JSON\.stringify\(\[\]\)/);

assert.deepEqual(parseDoneLogs(null), []);
assert.deepEqual(parseDoneLogs('not-json'), []);
assert.deepEqual(parseDoneLogs({ text: 'x' }), []);
assert.equal(parseDoneLogs([{ text: 'ok', at: '2026-08-13T00:00:00.000Z', source: 'agent' }]).length, 1);

const skipped = appendDoneLogEntry([], { text: '  ', source: 'agent' });
assert.equal(skipped.length, 0);
assert.equal(appendDoneLogEntry([], { text: 'hi', source: 'nope' }).length, 0);

const once = appendDoneLogEntry([], {
  text: '已保存',
  source: 'agent',
  at: '2026-08-13T03:12:00.000Z',
});
assert.deepEqual(once, [{
  text: '已保存',
  at: '2026-08-13T03:12:00.000Z',
  source: 'agent',
}]);
const twice = appendDoneLogEntry(once, {
  text: '第二次',
  source: 'agent',
  at: '2026-08-13T04:00:00.000Z',
});
assert.equal(twice.length, 2);
assert.equal(twice[1].text, '第二次');

const long = 'x'.repeat(DONE_LOG_TEXT_MAX + 50);
assert.equal(appendDoneLogEntry([], { text: long, source: 'fail', at: 't' })[0].text.length, DONE_LOG_TEXT_MAX);

const phases = [
  {
    phaseNumber: 1, status: 'completed', description: '登录后进入列表',
    doneLogs: [{ text: '进了列表', at: '2026-08-13T01:00:00.000Z', source: 'agent' }],
  },
  {
    phaseNumber: 2, status: 'running', description: '填写客户信息',
    doneLogs: [],
  },
  { phaseNumber: 3, status: 'pending', description: '保存', doneLogs: [] },
  { phaseNumber: 4, status: 'pending', description: '提交', doneLogs: [] },
];
const sum = summarizePhases(phases);
assert.equal(sum.phaseCompleted, 1);
assert.equal(sum.phaseTotal, 4);
assert.equal(sum.phaseName, '填写客户信息');
assert.equal(sum.lastDoneText, '进了列表');

// Later phases often complete without done().text — do not keep showing phase 1.
const laterDone = summarizePhases([
  phases[0],
  {
    phaseNumber: 2, status: 'completed', description: '新增潜在客户',
    doneLogs: [],
  },
  {
    phaseNumber: 3, status: 'running', description: '填写信贷潜在客户的基本信息，点击保存。',
    doneLogs: [],
  },
  phases[3],
]);
assert.equal(laterDone.phaseCompleted, 2);
assert.equal(laterDone.phaseName, '填写信贷潜在客户的基本信息，点击保存。');
assert.equal(laterDone.lastDoneText, '阶段2已完成');
assert.notEqual(laterDone.lastDoneText, '进了列表');

const laterWithOwnLog = summarizePhases([
  {
    ...phases[0],
    doneLogs: [{ text: '阶段1完成：进了列表', at: '2026-08-13T09:00:00.000Z', source: 'agent' }],
  },
  {
    phaseNumber: 2, status: 'completed', description: '新增潜在客户',
    doneLogs: [{ text: '阶段2完成：已保存潜在客户', at: '2026-08-13T08:00:00.000Z', source: 'agent' }],
  },
]);
assert.equal(laterWithOwnLog.lastDoneText, '阶段2完成：已保存潜在客户');

function pct(partial) {
  return computeBatchItemProgress(partial).progressPercent;
}
assert.equal(pct({ status: 'pending', mode: 'record' }), 0);
assert.equal(pct({ status: 'analyzing', mode: 'record' }), 10);
assert.equal(pct({ status: 'analyzed', mode: 'record' }), 20);
assert.equal(pct({ status: 'queued', mode: 'record' }), 25);
assert.equal(pct({ status: 'waiting_executor', mode: 'record' }), 30);
assert.equal(pct({ status: 'preparing', mode: 'record' }), 40);
assert.equal(pct({
  status: 'recording', mode: 'record', trajectoryId: 1, phases,
}), 53); // 40 + 50 * (1/4) = 52.5 → 53
assert.equal(pct({ status: 'recorded', mode: 'record' }), 100);
assert.equal(pct({ status: 'analyzing', mode: 'draft' }), 40);
assert.equal(pct({ status: 'analyzed', mode: 'draft' }), 70);
assert.equal(pct({ status: 'drafted', mode: 'draft' }), 100);
assert.equal(pct({ status: 'rejected', mode: 'record' }), 0);
assert.equal(pct({ status: 'failed', mode: 'record' }), 10);
assert.equal(pct({ status: 'failed', mode: 'draft' }), 40);
assert.equal(pct({
  status: 'failed', mode: 'record', trajectoryId: 9, phases,
}), 53);
assert.ok(pct({
  status: 'failed', mode: 'record', trajectoryId: 9,
  phases: phases.map((p) => ({ ...p, status: 'completed' })),
}) <= 90);

const runner = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf-8');
assert.match(runner, /appendPhaseDoneLog/);
assert.match(runner, /donePayload\?\.text/);
assert.match(runner, /lockAiRecording/);
assert.match(runner, /session\.aiRecording = true/);
assert.match(runner, /doneP\.cancel/);
assert.doesNotMatch(runner.slice(runner.indexOf('export async function runDefaultLogin')), /appendPhaseDoneLog/);
const sess = readFileSync(join(ROOT, 'src/routes/browser-session/session-message.js'), 'utf-8');
assert.match(sess, /appendPhaseDoneLog/);
assert.match(sess, /session\.aiRecording/);
const attach = readFileSync(join(ROOT, 'src/services/trajectory/trajectory-attach-runner.js'), 'utf-8');
// 4145e23 校准：prepare（开浏览器/推流）≠ 录制——attach-runner 不得把持久状态覆盖为 recording，
// 也不得依赖瞬态 record_status；本地路径保留 single-live 409 门禁。
assert.doesNotMatch(attach, /recordStatus: 'recording'/);
assert.doesNotMatch(attach, /isAiRecordingActive/);
assert.match(attach, /single-live|Local \(non-executor\) mode only supports one live/);
const hub = readFileSync(join(ROOT, 'src/executor-event-hub.js'), 'utf-8');
assert.match(hub, /promise\.cancel = cancel/);

console.log('characterize-batch-task-progress: OK');
