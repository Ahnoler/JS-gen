/**
 * @param {string} taskText
 * @returns {true}
 */
export function assertBusinessTaskText(taskText) {
  const text = String(taskText || '').trim();
  if (
    !text.includes('【硬性成功门闩') ||
    text.length < 80 ||
    text.includes('POST /api/v2') ||
    text.includes('curl')
  ) {
    throw new Error('taskText must be the business gate, not the operator runbook');
  }
  return true;
}
