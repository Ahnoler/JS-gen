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
 * 将元素 JSON 归一化为 ElementJson（透传 prepareElementJson）。
 * @param {import('./entities.js').ElementJson|Record<string, unknown>|null|undefined} element 元素 JSON
 * @param {{ actionType?: string, params?: object|null, requireUsable?: boolean }} [opts] 选项
 * @returns {import('./entities.js').ElementJson|null} 规范化后的元素 JSON
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
 * @param {object} step 运行时步骤对象
 * @param {object} [context] 上下文
 * @param {number} [context.trajectoryId] 轨迹 id
 * @param {number} [context.stepNumber] 步骤序号
 * @param {number} [context.phaseNumber] 阶段序号
 * @param {import('./constants.js').StepSource} [context.source] 步骤来源
 * @returns {import('./entities.js').TrajectoryStep} 轨迹步骤实体字段
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
    actionId: step.id || null,
  };
}

export * from './constants.js';
