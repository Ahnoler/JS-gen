/**
 * Characterization: consecutive-only dedup (must not remove non-consecutive duplicates).
 */
import { deduplicateByXPath, deduplicateActionFile } from '../src/dedup.js';
import { parseReplayStepMarker, findScreenshotForStep } from '../src/runtime/script-runner.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const entries = [
  { action: 'fill_form_field', params: { label_text: 'A', value: '1' } },
  { action: 'fill_form_field', params: { label_text: 'A', value: '1' } }, // consecutive dup
  { action: 'click_element_by_index', params: { index: 1 } },
  { action: 'fill_form_field', params: { label_text: 'A', value: '1' } }, // non-consecutive — keep
];
const deduped = deduplicateByXPath(entries);
assert(deduped.length === 3, `expected 3 after consecutive dedup, got ${deduped.length}`);

const file = deduplicateActionFile({
  tests: [{ id: 't1', commands: entries }],
});
assert(file._meta.removedCount === 1, 'meta.removedCount should be 1');
assert(file.tests[0].commands.length === 3, 'commands length 3');

const marker = parseReplayStepMarker('__REPLAY_STEP__{"step":2,"ok":true,"id":10}');
assert(marker && marker.step === 2 && marker.id === 10, 'parseReplayStepMarker failed');

const shot = findScreenshotForStep(2, [
  { fileName: 'step-1-x.png', url: '/a', stepNumber: 1 },
  { fileName: 'step-2-y.png', url: '/b', stepNumber: 2 },
]);
assert(shot?.fileName === 'step-2-y.png', 'findScreenshotForStep failed');

console.log('ok: characterization dedup + replay markers');
