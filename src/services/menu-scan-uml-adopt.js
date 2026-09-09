/**
 * 扫描可导航叶 ← 建模 intermediate 的 umlEcd 回填（系统无关，无白名单）。
 *
 * 匹配优先级（同模块下）：
 * 1. 中文名相同 → intermediate 的 umlEcd
 * 2. 可导航叶 pdCmptEcd 唯一命中 activity umlEcd（1:N 跳过）
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
 * @param {{ name: string, pageId?: string, umlEcd?: string }} nav
 * @param {Array<{ name: string, umlEcd: string, pages?: Array<{ pageId: string, activityUmlEcd?: string }>, pageIds?: string[] }>} intermediates
 * @returns {string}
 */
export function pickUmlEcdFromIntermediates(nav, intermediates) {
  const list = Array.isArray(intermediates) ? intermediates : [];
  const navName = String(nav?.name || '').trim();
  const navPageId = String(nav?.pageId || '').trim();
  const existing = String(nav?.umlEcd || '').trim();
  if (isModelingUmlEcd(existing)) return '';

  if (navName) {
    const byName = list.find(
      (i) => String(i.name || '').trim() === navName && isModelingUmlEcd(i.umlEcd),
    );
    if (byName) return String(byName.umlEcd).trim();
  }

  if (navPageId) {
    const codes = [];
    for (const i of list) {
      const pages = Array.isArray(i.pages) ? i.pages : [];
      for (const p of pages) {
        if (String(p.pageId || '').trim() !== navPageId) continue;
        const act = String(p.activityUmlEcd || '').trim();
        if (act) codes.push(act);
      }
    }
    const uniq = [...new Set(codes)];
    if (uniq.length === 1 && isModelingUmlEcd(uniq[0])) return uniq[0];
  }
  return '';
}
