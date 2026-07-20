/**
 * Helpers for trajectory_step.element_json (ElementInfo + candidates[]).
 */

/**
 * @typedef {Object} LocatorCandidate
 * @property {'css'|'xpath_full'|'xpath_smart'} type
 * @property {string} value
 */

/**
 * @typedef {Object} ElementJson
 * @property {string} [tag]
 * @property {string} [xpath]
 * @property {string} [cssSelector]
 * @property {Object<string,string>} [attributes]
 * @property {string} [text]
 * @property {LocatorCandidate[]} [candidates]
 */

/**
 * Build element_json from runtime element info (ActionEntry / StepEntry shape).
 * @param {Object} element
 * @param {string} [element.tagName]
 * @param {string} [element.tag]
 * @param {string} [element.target]
 * @param {string} [element.xpath]
 * @param {string} [element.cssSelector]
 * @param {Object} [element.attributes]
 * @param {string} [element.text]
 * @param {LocatorCandidate[]} [element.candidates]
 * @returns {ElementJson}
 */
export function toElementJson(element = {}) {
  const json = {
    tag: element.tag || element.tagName || '',
    xpath: element.xpath || element.target || '',
    cssSelector: element.cssSelector || '',
    attributes: element.attributes || {},
    text: element.text || '',
  };
  if (element.candidates?.length) {
    json.candidates = element.candidates.map((c) => ({
      type: c.type,
      value: c.value ?? '',
    }));
  }
  return json;
}

/**
 * Convert a StepEntry-like action log item to TrajectoryStep entity fields (camelCase).
 * @param {Object} entry
 * @param {Object} [context] — trajectoryId, stepNumber, phaseNumber, etc.
 * @returns {import('./entities.js').TrajectoryStep}
 */
export function stepEntryToTrajectoryStep(entry, context = {}) {
  const element = entry.element || {};
  return {
    actionType: entry.action || entry.actionType || '',
    params: entry.params || entry.paramsJson || null,
    element: typeof element === 'object' && !Array.isArray(element)
      ? toElementJson(element)
      : element,
    extractedContent: entry.result ?? entry.extractedContent ?? '',
    description: entry.description || '',
    success: entry.success ?? null,
    error: entry.error ?? null,
    phaseNumber: context.phaseNumber ?? entry.phaseNumber ?? entry.phase ?? 0,
    stepNumber: context.stepNumber ?? entry.stepNumber ?? 0,
    actionIndex: context.actionIndex ?? entry.actionIndex ?? 0,
    trajectoryId: context.trajectoryId ?? entry.trajectoryId,
    trajectoryPhaseId: context.trajectoryPhaseId ?? entry.trajectoryPhaseId ?? null,
    source: context.source ?? entry.source ?? 'agent',
  };
}

/**
 * Map trajectory_step row to action_{ts}.json entry format (for script_assembler).
 * @param {Object} step — camelCase TrajectoryStep from DAO
 * @returns {Object}
 */
export function trajectoryStepToActionEntry(step) {
  let el = step.element ?? step.elementJson ?? {};
  if (typeof el === 'string') {
    try { el = JSON.parse(el); } catch { el = {}; }
  }
  let params = step.params ?? step.paramsJson ?? {};
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch { params = {}; }
  }
  return {
    action: step.actionType || step.action || '',
    params: params || {},
    result: step.extractedContent || '',
    target: el.xpath || el.target || '',
    cssSelector: el.cssSelector || el.css_selector || '',
    tagName: el.tag || el.tagName || '',
    attributes: el.attributes || {},
    // Replay / assembler markers
    id: step.id != null ? String(step.id) : '',
    stepId: step.id != null ? String(step.id) : '',
    phaseId: step.trajectoryPhaseId ?? step.phaseId ?? null,
    phase: step.phaseNumber ?? step.phase ?? 0,
    description: step.description || '',
  };
}
