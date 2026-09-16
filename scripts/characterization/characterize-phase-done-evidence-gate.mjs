#!/usr/bin/env node
/**
 * Characterization for G3 control-plane phase_done evidence gate helpers.
 */
import assert from 'node:assert/strict';
import {
  aggregateTrajectorySuccessful,
  applyZeroStepFakeSuccessGate,
  countBusinessSteps,
} from '../../src/services/trajectory/phase-done-evidence-gate.js';
import { META_STEP_ACTIONS } from '../../src/models/meta-step-actions.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

assert.equal(
  countBusinessSteps([
    { actionType: 'click_element_by_index' },
    { actionType: 'get_page_state' },
    { action_type: 'fill_form_field' },
  ], META_STEP_ACTIONS),
  2,
  'meta get_page_state excluded',
);

const ok = applyZeroStepFakeSuccessGate({
  stepCount: 2,
  donePayload: { success: true, text: 'done' },
});
assert.equal(ok.success, true);
assert.equal(ok.rejectedZeroStep, false);

const z = applyZeroStepFakeSuccessGate({
  stepCount: 0,
  donePayload: { success: true, text: '假完成' },
});
assert.equal(z.success, false);
assert.equal(z.rejectedZeroStep, true);
assert.ok(String(z.text).startsWith('zero_step_rejected:'));

const honestFail = applyZeroStepFakeSuccessGate({
  stepCount: 0,
  donePayload: { success: false, text: 'budget' },
});
assert.equal(honestFail.success, false);
assert.equal(honestFail.rejectedZeroStep, false);

const o1 = { success: true, text: 'a' };
const o2 = { success: false, text: 'b' };
assert.equal(aggregateTrajectorySuccessful({ 1: o1, 101: o1 }), true);
assert.equal(aggregateTrajectorySuccessful({ 1: o1, 101: o1, 2: o2, 102: o2 }), false);
assert.equal(aggregateTrajectorySuccessful({ 1: { success: null } }), true);

const runner = readFileSync(
  join(ROOT, 'src/services/trajectory/trajectory-recording-runner.js'),
  'utf8',
);
assert.ok(runner.includes('applyZeroStepFakeSuccessGate'), 'runner wires zero-step gate');
assert.ok(runner.includes('aggregateTrajectorySuccessful'), 'runner aggregates isSuccessful');
assert.ok(runner.includes('zero_step_rejected') || runner.includes('rejectedZeroStep'), 'zero-step log path');

console.log('characterize-phase-done-evidence-gate: OK');
