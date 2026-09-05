/**
 * 扫描可导航叶 ← 建模 intermediate 的 umlEcd 回填（系统无关，无白名单）。
 *
 * 匹配优先级（同模块下）：
 * 1. 中文名相同
 * 2. 可导航叶 pdCmptEcd ∈ intermediate 的 system_page.pageId
 *
 * 仅当候选 umlEcd 为建模码（UML…）时回填；不覆盖叶上已有的 UML… 码。
 */

/**
 * @param {string} umlEcd
 * @returns {boolean}
 */
export function isModelingUmlEcd(umlEcd) {
  return /^UML/i.test(String(umlEcd || '').trim());
}

/**
 * 从同模块 intermediate 候选中为可导航叶挑选 umlEcd。
 * @param {{ name: string, pageId?: string, umlEcd?: string }} nav 可导航叶
 * @param {Array<{ name: string, umlEcd: string, pageIds: string[] }>} intermediates 同模块 intermediate
 * @returns {string} 应写入的建模 umlEcd，无则 ''
 */
export function pickUmlEcdFromIntermediates(nav, intermediates) {
  const list = Array.isArray(intermediates) ? intermediates : [];
  const navName = String(nav?.name || '').trim();
  const navPageId = String(nav?.pageId || '').trim();
  const existing = String(nav?.umlEcd || '').trim();
  if (isModelingUmlEcd(existing)) return ''; // 已有建模码不覆盖

  if (navName) {
    const byName = list.find(
      (i) => String(i.name || '').trim() === navName && isModelingUmlEcd(i.umlEcd),
    );
    if (byName) return String(byName.umlEcd).trim();
  }
  if (navPageId) {
    const byPage = list.find(
      (i) =>
        isModelingUmlEcd(i.umlEcd) &&
        (Array.isArray(i.pageIds) ? i.pageIds : []).includes(navPageId),
    );
    if (byPage) return String(byPage.umlEcd).trim();
  }
  return '';
}
