import assert from 'node:assert/strict';
import { POLL_INTERVAL_MS, RECORD_DEADLINE_MS, phaseDigest, pollSnapshotName } from '../../../tools/recording-coach/src/poll-watch.mjs';
import { assertNumericPhaseIds, cdpPortFromPrepare } from '../../../tools/recording-coach/src/phase-ids.mjs';
import { formatOperatorClose, conclusionFromAssert } from '../../../tools/recording-coach/src/close-contract.mjs';
import { assertDispatchBrief } from '../../../tools/recording-coach/src/dispatch-brief.mjs';
import { assertBusinessTaskText } from '../../../tools/recording-coach/src/task-text.mjs';

assert.equal(POLL_INTERVAL_MS, 60_000);
assert.equal(RECORD_DEADLINE_MS, 2_400_000);
assert.equal(pollSnapshotName(1), 'poll-1.json');

const digest = phaseDigest({
  phases: [
    { id: 2300, phaseNumber: 1, status: 'completed', doneLogs: [{ text: 'x'.repeat(500) }] },
    { id: 2301, phaseNumber: 2, status: 'running', doneLogs: [] },
  ],
});
assert.equal(digest.doneCount, 1);
assert.equal(digest.phaseCount, 2);
assert.equal(digest.phases[0].done, true);
assert.equal(digest.phases[0].tailUnreliable, true);
assert.equal(digest.phases[0].doneLogTexts[0].length, 400);
assert.equal(digest.phases[1].done, false);

assert.deepEqual(assertNumericPhaseIds([2338, '2339']), [2338, 2339]);
assert.throws(
  () => assertNumericPhaseIds(['b01aca42-1dbe-4814-b9af-3a9fb7c993f9']),
  /phaseIds must be database numeric ids/,
);
assert.equal(
  cdpPortFromPrepare({ stages: { browser: { cdpPort: 19243 } } }, 0),
  19243,
);
assert.equal(cdpPortFromPrepare({}, 1), 19243);
assert.throws(
  () => cdpPortFromPrepare({}, null),
  /cdp port missing/,
);

assert.equal(
  conclusionFromAssert({ verdict: 'DONE', pass: true }, 'click_table_row_radio_first'),
  'CREATED_click_table_row_radio_first',
);
assert.match(
  conclusionFromAssert({ verdict: 'REJECTED', rejectExcerpt: '已发起评级流程' }, 'steps'),
  /^REJECTED_/,
);
assert.throws(
  () => formatOperatorClose({ conclusion: 'DONE', reportPath: 'a', evidence: ['1', '2', '3'] }),
  /conclusion/,
);
const text = formatOperatorClose({
  conclusion: 'CREATED_steps',
  reportPath: 'D:/dev/JS-gen/tmp/recording-coach-x/through-report.md',
  evidence: ['traj-final.json id=1', 'row_text=first', 'poll-1.json done=1/4'],
});
assert.equal(text.split('\n').length, 5);
assert.match(text, /^结论：CREATED_steps\n报告：/);
assert.match(text, /证据3：poll-1\.json/);

const brief = ['固定参数', '业务目标', '风险预告', '管线步骤', '产出契约'].join('\n');
assert.equal(assertDispatchBrief(brief), true);
assert.throws(() => assertDispatchBrief('只有业务目标'), /dispatch brief missing heading: 固定参数/);

assert.equal(
  assertBusinessTaskText('【硬性成功门闩——未满足不得 done】\n' + 'x'.repeat(80)),
  true,
);
assert.throws(() => assertBusinessTaskText('STC首行'), /taskText must be the business gate/);
assert.throws(
  () => assertBusinessTaskText('【硬性成功门闩】\n' + 'x'.repeat(80) + '\ncurl http://x'),
  /taskText must be the business gate/,
);

console.log('OK characterize-recording-coach-operator');
