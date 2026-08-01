/**
 * Convert a step/action record to trajectory_step.element_json shape.
 */
import { normalizeActionName } from './action-name.js';
import {
  hasUsableLocator,
  isSingleTargetAction,
  prepareElementJson,
  toElementJson,
} from './element.js';

export { normalizeActionName } from './action-name.js';
export {
  hasUsableLocator,
  isSingleTargetAction,
  prepareElementJson,
  toElementJson,
  SINGLE_TARGET_ACTIONS,
  LOCATOR_EXEMPT_ACTIONS,
} from './element.js';

/**
 * @param {import('./entities.js').ElementJson|Record<string, unknown>|null|undefined} element
 * @param {{ actionType?: string, params?: object|null, requireUsable?: boolean }} [opts]
 * @returns {import('./entities.js').ElementJson|null}
 */
export function normalizeElementJson(element, opts = {}) {
  if (!element || typeof element !== 'object') return null;
  return prepareElementJson({
    element,
    actionType: opts.actionType || '',
    params: opts.params || null,
    requireUsable: !!opts.requireUsable,
  });
}

/**
 * Map a runtime step object (from _STEP_LOG / action entry) to TrajectoryStep fields.
 * @param {Object} step
 * @param {Object} [context]
 * @param {number} [context.trajectoryId]
 * @param {number} [context.stepNumber]
 * @param {number} [context.phaseNumber]
 * @param {import('./constants.js').StepSource} [context.source]
 * @returns {import('./entities.js').TrajectoryStep}
 */
export function stepFromActionLog(step, context = {}) {
  const action = normalizeActionName(step.action ?? step.actionType ?? '');
  const params = step.params ?? null;
  const rawElement = step.element ?? {
    tag: step.tagName,
    xpath: step.target,
    cssSelector: step.cssSelector,
    attributes: step.attributes,
    text: step.text,
    xpath_smart: step.xpath_smart,
    xpath_full: step.xpath_full,
    candidates: step.candidates,
  };

  return {
    trajectoryId: context.trajectoryId ?? step.trajectoryId ?? 0,
    stepNumber: context.stepNumber ?? step.stepNumber ?? 0,
    phaseNumber: context.phaseNumber ?? step.phaseNumber ?? step.phase ?? 0,
    actionIndex: step.actionIndex ?? 0,
    actionType: action,
    params,
    element: normalizeElementJson(rawElement, { actionType: action, params }),
    success: step.success ?? null,
    error: step.error ?? null,
    extractedContent: step.result ?? step.extractedContent ?? '',
    trajectoryPhaseId: step.trajectoryPhaseId ?? null,
    source: context.source ?? step.source ?? 'agent',
  };
}

export * from './constants.js';
