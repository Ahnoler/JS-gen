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
 * 判断 umlEcd 是否为建模组件关系码（UML… 前缀）。
 * @param {string} umlEcd 候选编码
 * @returns {boolean} 是否为建模码
 */
export function isModelingUmlEcd(umlEcd) {
  return /^UML/i.test(String(umlEcd || '').trim());
}

/**
 * 从同模块 intermediate 目录为可导航叶挑选应回填的建模 umlEcd。
 * @param {{ name: string, pageId?: string, umlEcd?: string }} nav 可导航叶（name、pdCmptEcd、已有 umlEcd）
 * @param {Array<{ name: string, umlEcd: string, pages?: Array<{ pageId: string, activityUmlEcd?: string }> }>} intermediates 模块下 intermediate 列表
 * @returns {string} 应写入的建模 umlEcd，无则空串
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
