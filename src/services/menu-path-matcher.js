/**
 * KB 流程卡 menu_path ↔ 系统树 匹配器（纯函数，无 IO）。
 * A2（覆盖报表的 kbCards 列）与 A3（变更影响反查/stale 检测）共享。
 * 段名与节点名比较前去除全部空白字符，与 Python 侧 _norm_name 语义一致。
 */

/**
 * 规范化段名/节点名：去除全部空白字符。
 * @param {string} s 原始名称
 * @returns {string} 去空白后的名称
 */
export function normSegName(s) {
  return String(s || '').replace(/\s+/g, '');
}

/**
 * 判断 menu_path 是否为自由文本（非「段/段/段」路径形态）。
 * 含括号说明、「未采到」前缀、或切分后不足 2 段 → 视为自由文本。
 * @param {string} menuPath 卡片 menu_path 原文
 * @returns {boolean} true=自由文本（不算 stale）
 */
export function isFreeTextMenuPath(menuPath) {
  const raw = String(menuPath || '').trim();
  if (!raw) return true;
  if (/[（）()]/.test(raw)) return true;
  if (raw.includes('未采到')) return true;
  return raw.split('/').map((s) => s.trim()).filter(Boolean).length < 2;
}

/**
 * 把「段/段/段」形态的 menu_path 解析到扁平节点列表。
 * 首段在全部节点中精确匹配（兼容「系统/模块/…」与省略系统名的路径），
 * 其后逐段在子节点中精确匹配（空白规范化后）；
 * 允许停在模块层（type=2）；同级同名兄弟取首个并标 ambiguous。
 * @param {string} menuPath 卡片 menu_path 原文
 * @param {Array<{id:number, parentId:number, name:string, type:number}>} flatNodes 扁平节点（systemDao.listAll() 形状）
 * @returns {{ matchStatus: 'matched'|'possibly-stale'|'unparsed', matchedNodeId?: number, matchedNodeType?: number, missingSegment?: string, resolvedPrefix?: string, ambiguous?: boolean }} 解析结果（unparsed 不带其余键）
 */
export function resolveMenuPath(menuPath, flatNodes) {
  const raw = String(menuPath || '').trim();
  if (isFreeTextMenuPath(raw)) {
    return { matchStatus: 'unparsed' };
  }
  const segments = raw.split('/').map((s) => s.trim()).filter(Boolean);
  const childrenOf = new Map();
  for (const n of flatNodes) {
    const key = Number(n.parentId) || 0;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(n);
  }

  let cur = null;
  const resolvedNames = [];
  let ambiguous = false;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = normSegName(segments[i]);
    const pool = cur ? (childrenOf.get(Number(cur.id)) || []) : flatNodes;
    const hits = pool.filter((n) => normSegName(n.name) === seg);
    if (!hits.length) {
      return {
        matchStatus: 'possibly-stale',
        missingSegment: segments[i],
        resolvedPrefix: resolvedNames.join('/'),
      };
    }
    if (hits.length > 1) ambiguous = true;
    cur = hits[0];
    resolvedNames.push(String(cur.name).trim());
  }
  return {
    matchStatus: 'matched',
    matchedNodeId: Number(cur.id),
    matchedNodeType: Number(cur.type),
    ...(ambiguous ? { ambiguous: true } : {}),
  };
}
