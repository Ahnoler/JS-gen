/**
 * Convert a step/action record to trajectory_step.element_json shape.
 * @param {import('./entities.js').ElementJson|Record<string, unknown>|null|undefined} element
 * @returns {import('./entities.js').ElementJson|null}
 */
export function normalizeElementJson(element) {
  if (!element || typeof element !== 'object') return null;

  const el = /** @type {Record<string, unknown>} */ ({ ...element });
  const normalized = {
    tag: el.tag ?? el.tagName ?? '',
    xpath: el.xpath ?? el.target ?? '',
    cssSelector: el.cssSelector ?? el.css_selector ?? '',
    attributes: el.attributes && typeof el.attributes === 'object' ? el.attributes : {},
    text: el.text ?? '',
  };

  if (Array.isArray(el.candidates)) {
    normalized.candidates = el.candidates.map((c) => ({
      type: c.type,
      value: c.value ?? '',
    }));
  }

  return normalized;
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
  const action = step.action ?? step.actionType ?? '';
  const element = step.element ?? {
    tag: step.tagName,
    xpath: step.target,
    cssSelector: step.cssSelector,
    attributes: step.attributes,
  };

  return {
    trajectoryId: context.trajectoryId ?? step.trajectoryId ?? 0,
    stepNumber: context.stepNumber ?? step.stepNumber ?? 0,
    phaseNumber: context.phaseNumber ?? step.phaseNumber ?? step.phase ?? 0,
    actionIndex: step.actionIndex ?? 0,
    actionType: action,
    description: step.description ?? '',
    params: step.params ?? null,
    element: normalizeElementJson(element),
    success: step.success ?? null,
    error: step.error ?? null,
    extractedContent: step.result ?? step.extractedContent ?? '',
    trajectoryPhaseId: step.trajectoryPhaseId ?? null,
    source: context.source ?? step.source ?? 'agent',
  };
}

export * from './constants.js';
