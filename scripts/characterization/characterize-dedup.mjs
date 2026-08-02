/**
 * Characterization: consecutive-only element dedup (keep later; must not remove non-consecutive).
 */
import { deduplicateByXPath, deduplicateActionFile, elementDedupKey } from '../../src/dedup.js';
import { parseReplayStepMarker, findScreenshotForStep, findScreenshotsForStep } from '../../src/runtime/script-runner.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const entries = [
  { action: 'fill_form_field', params: { label_text: 'A', value: '1' } },
  { action: 'fill_form_field', params: { label_text: 'A', value: '1' } }, // consecutive identical
  { action: 'click_element_by_index', params: { index: 1 } },
  { action: 'fill_form_field', params: { label_text: 'A', value: '1' } }, // non-consecutive — keep
];
const deduped = deduplicateByXPath(entries);
assert(deduped.length === 3, `expected 3 after consecutive dedup, got ${deduped.length}`);
assert(deduped[0].params.value === '1', 'first remaining fill keeps value');

// Same element, different values → keep later
const refilled = deduplicateByXPath([
  { action: 'fill_form_field', params: { label_text: '名称', value: 'auto' } },
  { action: 'fill_form_field', params: { label_text: '名称', value: 'agent' } },
]);
assert(refilled.length === 1, 'same-label consecutive fills coalesce to 1');
assert(refilled[0].params.value === 'agent', 'keep later fill value');

assert(
  elementDedupKey({ action: 'fill_form_field', params: { label_text: '名称', value: 'x' } })
    === 'field:名称',
  'elementDedupKey uses label',
);

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

const before = findScreenshotForStep(2, [
  { fileName: 'step-2-before-abc.png', url: '/b', stepNumber: 2, kind: 'before' },
  { fileName: 'step-2-after-abc.png', url: '/a', stepNumber: 2, kind: 'after' },
], 'before');
assert(before?.kind === 'before', 'findScreenshotForStep before kind failed');
const after = findScreenshotForStep(2, [
  { fileName: 'step-2-before-abc.png', url: '/b', stepNumber: 2, kind: 'before' },
  { fileName: 'step-2-after-abc.png', url: '/a', stepNumber: 2, kind: 'after' },
], 'after');
assert(after?.kind === 'after', 'findScreenshotForStep after kind failed');

console.log('ok: characterization dedup + replay markers');
