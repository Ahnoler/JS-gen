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
// v2/v3 zero-step downgrade semantics stay wired in recordPhaseResult.
assert.ok(
  src.includes('zeroStepPhase && explicitSuccess === true ? null : explicitSuccess'),
  'zero-step success downgrade (success→null) must stay',
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

console.log('characterize-record-phase-finalize: all passed');
