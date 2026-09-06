/**
 * 本模块现仅存 replay-step-marker 解析与截图查找工具函数，供 scripts/characterization 使用。
 */

/**
 * Find screenshot(s) for assembler step N.
 * @param {number} stepNumber step number
 * @param {Array} screenshotList screenshot list
 * @param {'before'|'after'|null} [kind] if set, return that kind only; else return newest match
 * @returns {object|null} 找到的截图对象或null
 */
export function findScreenshotForStep(stepNumber, screenshotList, kind = null) {
  const n = Number(stepNumber);
  let matches = (screenshotList || []).filter((s) => s.stepNumber === n || s.fileName?.startsWith(`step-${n}-`));
  if (kind) matches = matches.filter((s) => s.kind === kind || s.fileName?.includes(`-${kind}-`));
  return matches.length ? matches[matches.length - 1] : null;
}

/**
 * Find both before/after screenshots for assembler step N.
 * @param {number} stepNumber step number
 * @param {Array} screenshotList screenshot list
 * @returns {{ before: object|null, after: object|null }} 包含before和after截图的对象
 */
export function findScreenshotsForStep(stepNumber, screenshotList) {
  return {
    before: findScreenshotForStep(stepNumber, screenshotList, 'before'),
    after: findScreenshotForStep(stepNumber, screenshotList, 'after'),
  };
}

/**
 * Parse __REPLAY_STEP__{...} lines from Playwright stdout.
 * @param {string} line stdout行内容
 * @returns {object|null} 解析结果或null
 */
export function parseReplayStepMarker(line) {
  const idx = line.indexOf('__REPLAY_STEP__');
  if (idx === -1) return null;
  const raw = line.slice(idx + '__REPLAY_STEP__'.length).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
