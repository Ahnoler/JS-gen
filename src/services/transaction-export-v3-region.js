/**
 * V3 partner transaction export — region_id / key 工具。
 * 从 transaction-export-v3.js 拆出（行为保持重构），原路径继续作为 barrel 导出这些名字。
 */

/** region_id 分层链（'|' 分段，role:label）中含 overlay 段 → 返回该段；否则 null。 */
/**
 * 检查 region_id 分层链中是否包含 overlay 段。
 * @param {string} regionId - region_id 字符串
 * @returns {{role: string, label: string}|null} 如果包含 overlay 段则返回 {role: 'overlay', label: '...'}，否则返回 null
 */
export function isOverlayRegion(regionId) {
  const rid = String(regionId || '').trim();
  if (!rid) return null;
  for (const seg of rid.split('|').map((s) => s.trim()).filter(Boolean)) {
    const i = seg.indexOf(':');
    if (i > 0 && seg.slice(0, i).trim() === 'overlay') {
      return { role: 'overlay', label: seg.slice(i + 1).trim() };
    }
  }
  return null;
}

/** 从 region_id 链提取页面 key（第一段 page:...）。 */
/**
 * 从 region_id 链中提取页面 key（第一段 page:...）。
 * @param {string} regionId - region_id 字符串
 * @returns {string} 提取的页面 key，如果没有则返回空字符串
 */
export function pageKeyFromRegionId(regionId) {
  const rid = String(regionId || '').trim();
  if (!rid) return '';
  const first = rid.split('|').map((s) => s.trim()).filter(Boolean)[0] || '';
  return first.startsWith('page:') ? first : '';
}

/** 从 region_id 链提取弹窗 key（前两段 page:...|dialog:...）。 */
/**
 * 从 region_id 链中提取弹窗 key（前两段 page:...|dialog:...）。
 * @param {string} regionId - region_id 字符串
 * @returns {string} 提取的弹窗 key，如果没有则返回空字符串
 */
export function popupKeyFromRegionId(regionId) {
  const rid = String(regionId || '').trim();
  if (!rid) return '';
  const segs = rid.split('|').map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2 || !segs[0].startsWith('page:') || !segs[1].startsWith('dialog:')) return '';
  return `${segs[0]}|${segs[1]}`;
}

/**
 * 剥掉页面级 key 中 hash 内的易变 query（`#/route?x=1` → `#/route`，截到下一个 `|` 段边界）。
 * 存量数据在 2026-08-20 修复前把 in-fragment query 写进了 level_key / region_id page 前缀，
 * 导出侧用规范化 key 兜底匹配，让新旧两代 key 互相对齐。
 */
/**
 * 剥掉页面级 key 中 hash 内的易变 query（`#/route?x=1` → `#/route`，截到下一个 `|` 段边界）。
 * 用于规范化 key 以兼容新旧两代数据。
 * @param {string} key - 原始 key
 * @returns {string} 规范化后的 key
 */
export function stripVolatileQuery(key) {
  const s = String(key || '');
  const h = s.indexOf('#');
  if (h < 0) return s;
  const rest = s.slice(h + 1);
  const q = rest.indexOf('?');
  if (q < 0) return s;
  const afterQ = rest.slice(q);
  const bar = afterQ.indexOf('|');
  return s.slice(0, h + 1) + rest.slice(0, q) + (bar < 0 ? '' : afterQ.slice(bar));
}
