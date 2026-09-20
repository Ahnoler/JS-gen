const HEADINGS = ['固定参数', '业务目标', '风险预告', '管线步骤', '产出契约'];

/**
 * @param {string} text
 * @returns {true}
 */
export function assertDispatchBrief(text) {
  const body = String(text || '');
  for (const heading of HEADINGS) {
    if (!body.includes(heading)) {
      throw new Error(`dispatch brief missing heading: ${heading}`);
    }
  }
  return true;
}
