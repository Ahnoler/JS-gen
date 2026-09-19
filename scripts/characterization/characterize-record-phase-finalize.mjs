/**
 * recordPhaseResult finalize sanity (offline source pin).
 * Run: node scripts/characterization/characterize-record-phase-finalize.mjs
 *
 * Real-run incident 2026-09-17 (multi-phase recording died after phase 1 with
 * "Stop requested (cancel_step)"): merge c0cfa03e (PR #45 G3 gate) resolved the
 * recordPhaseResult conflict region into a hybrid — kept the v2/v3 inline
 * zero-step downgrade AND the PR-side `if (gated.rejectedZeroStep)` consumer,
 * dropping `const gated = applyZeroStepFakeSuccessGate(...)`. Every phase
 * finalize then threw `ReferenceError: gated is not defined`, aborting the
 * phase loop (trajectory auto-failed, finally re-sent cancel_step).
 *
 * Pin: the runner must never reference `gated` nor import
 * applyZeroStepFakeSuccessGate (the v2/v3 inline gate owns those semantics),
 * while the downgrade literals and the kept rawDoneText logging stay in place.
 *
 * Second incident (same file, 2026-09-17): 577d322a ("capture phase shots
 * before slow persistence") split captureAndPersistPhaseGroupShot into
 * capturePhaseGroupShot (serial browser capture) + persistPhaseGroupShot
 * (MinIO persistence on its own _phaseShotPersistChain queue) and rewired
 * ensurePhaseGroup — but missed the handlePhaseShotCandidateRequest call
 * site. Every phase_shot_candidate_request then threw ReferenceError inside
 * the try/catch, acked `ok:false`, and pre-submit (click_save) state-group
 * shots were silently lost.
 *
 * Pin: the orphan name must stay gone, and every capture/persist call in the
 * candidate handler must be paired with a definition in this file.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(
  join(root, 'src/services/trajectory/trajectory-recording-runner.js'),
  'utf8',
);

// Ban the merge orphan: any `gated` reference is undefined in this file.
assert.ok(
  !/\bgated\b/.test(src),
  'runner must not reference `gated` (merge c0cfa03e orphan → ReferenceError in recordPhaseResult)',
);
// The gate module stays wired at finalize: aggregate + v3 per-run zero-phase check.
assert.ok(
  src.includes('aggregateTrajectorySuccessful'),
  'aggregateTrajectorySuccessful must stay imported/used at finalize',
);
assert.ok(
  src.includes('applyZeroStepFakeSuccessGate'),
  'applyZeroStepFakeSuccessGate must stay used by the v3 per-run zero-phase downgrade',
);
// The surviving finalize path must keep its raw agent done-text logging.
assert.ok(
  src.includes("appendPhaseDoneLog(phase.id, { text: rawDoneText, source: 'agent' })"),
  'rawDoneText agent done-log append must stay',
);
// v2/v3 zero-step downgrade semantics stay wired in recordPhaseResult
//（Step 1 收敛后：内联判定迁至 gate 模块 evaluatePhaseOutcome，runner 消费 outcome.success）
const gateSrc = readFileSync(join(root, 'src/services/trajectory/phase-done-evidence-gate.js'), 'utf8');
assert.ok(
  src.includes('const phaseOutcome = evaluatePhaseOutcome({ explicitSuccess, phaseStepCount, donePayload })'),
  'recordPhaseResult consumes gate module evaluatePhaseOutcome',
);
assert.ok(
  gateSrc.includes('success: downgraded ? null : explicitSuccess'),
  'zero-step success downgrade (success→null) must stay (in gate module)',
);
assert.ok(
  src.includes('[0步完成]'),
  '[0步完成] done-log marker must stay',
);
// Finalize aggregation still consumes the gate module (single semantic source).
assert.ok(
  src.includes('aggregateTrajectorySuccessful'),
  'aggregateTrajectorySuccessful must stay imported/used at finalize',
);

// ── Phase-shot candidate request wiring (577d322a split orphan) ──
// The renamed-away function must never reappear as a dangling reference.
assert.ok(
  !src.includes('captureAndPersistPhaseGroupShot'),
  'runner must not reference captureAndPersistPhaseGroupShot (577d322a rename orphan → ReferenceError in phase_shot_candidate_request handler)',
);
// The candidate handler must capture serially and queue persistence on the
// dedicated chain — completing 577d322a's intent (capture before slow MinIO).
const handlerStart = src.indexOf('const handlePhaseShotCandidateRequest');
assert.ok(handlerStart >= 0, 'handlePhaseShotCandidateRequest handler must exist');
const handlerEnd = src.indexOf('const handleActionLogSync');
const handler = src.slice(handlerStart, handlerEnd > handlerStart ? handlerEnd : undefined);
assert.ok(
  handler.includes('await capturePhaseGroupShot('),
  'candidate handler must capture via capturePhaseGroupShot (serial _phaseShotChain)',
);
assert.ok(
  handler.includes('queuePhaseGroupPersistence(') && handler.includes('persistPhaseGroupShot('),
  'candidate handler must queue persistence via persistPhaseGroupShot (async _phaseShotPersistChain)',
);
// Reference/definition pairing: every phase-shot call name must be defined in
// this file (prevents another swallowed-ReferenceError orphan in this path).
for (const fn of ['capturePhaseGroupShot', 'persistPhaseGroupShot', 'queuePhaseGroupPersistence']) {
  assert.ok(
    new RegExp(`\\bfunction ${fn}\\(`).test(src),
    `phase-shot function must be defined in runner: ${fn}`,
  );
}

console.log('characterize-record-phase-finalize: all passed');
