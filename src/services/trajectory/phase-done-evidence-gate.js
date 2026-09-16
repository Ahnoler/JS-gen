/**
 * G3 control-plane helpers: reject zero-step fake phase_done success and
 * aggregate trajectory isSuccessful from per-phase outcomes.
 */
import { META_STEP_ACTIONS } from '../../models/meta-step-actions.js';

/**
 * Count business (non-meta) steps in a step list.
 * @param {Array<{ actionType?: string, action_type?: string }>} steps step rows
 * @param {readonly string[]} [metaActions] meta action names to exclude
 * @returns {number} business step count
 */
export function countBusinessSteps(steps, metaActions = META_STEP_ACTIONS) {
  const meta = new Set(metaActions || []);
  let n = 0;
  for (const s of steps || []) {
    const action = String(s?.actionType || s?.action_type || '').trim();
    if (!action || meta.has(action)) continue;
    n += 1;
  }
  return n;
}

/**
 * If agent claimed success with zero business steps, override to failure.
 * @param {{ stepCount: number, donePayload?: object|null }} args gate inputs
 * @returns {{ success: boolean|null, text: string, rejectedZeroStep: boolean }} gated outcome
 */
export function applyZeroStepFakeSuccessGate({ stepCount, donePayload }) {
  const explicitSuccess = donePayload?.success === true || donePayload?.success === false
    ? donePayload.success
    : null;
  const textFromDone = String(donePayload?.text || donePayload?.summary || '').trim();
  const baseText = textFromDone
    || (explicitSuccess == null ? '见页面当前状态' : String(donePayload?.name || '').trim())
    || '见页面当前状态';

  if (Number(stepCount) === 0 && explicitSuccess === true) {
    return {
      success: false,
      text: `zero_step_rejected: ${baseText}`.slice(0, 500),
      rejectedZeroStep: true,
    };
  }
  return {
    success: explicitSuccess,
    text: baseText,
    rejectedZeroStep: false,
  };
}

/**
 * Aggregate trajectory isSuccessful from phase outcomes.
 * Any explicit false → false; otherwise true (null/unknown does not block success).
 * G3 pin: zero-step fake success is rewritten to false before aggregation.
 * @param {Record<string|number, { success?: boolean|null }>|null|undefined} phaseOutcomes per-phase outcomes
 * @returns {boolean} trajectory isSuccessful
 */
export function aggregateTrajectorySuccessful(phaseOutcomes) {
  const byRef = new Set();
  for (const outcome of Object.values(phaseOutcomes || {})) {
    if (!outcome || typeof outcome !== 'object') continue;
    if (byRef.has(outcome)) continue;
    byRef.add(outcome);
    if (outcome.success === false) return false;
  }
  return true;
}
