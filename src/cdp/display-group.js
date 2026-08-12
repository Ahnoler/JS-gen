/**
 * Human-readable grouping key for ambiguity picker.
 * Prefer region_label / business key / xpath — never bare L1 taxonomy roles
 * (section|main|other|…) which are useless as picker group titles.
 * @param {object|null|undefined} el
 * @returns {string}
 */

const TAXONOMY_ROLES = new Set([
  'section',
  'main',
  'other',
  'overlay',
  'table',
  'page',
  'menu',
  'shell-aside',
  'shell-header',
  'shell-tabs',
]);

export function isTaxonomyRegionToken(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t) return false;
  if (TAXONOMY_ROLES.has(t)) return true;
  if (t.startsWith('custom:')) return true;
  return false;
}

function bizKeyFromText(s) {
  const m = String(s || '').match(/\b(?:PJ|DGSX)\d+\b/);
  return m ? m[0] : '';
}

export function displayGroupOf(el) {
  const label = String(el?.region_label || '').trim();
  if (label && !isTaxonomyRegionToken(label)) return label;

  const smart = String(el?.xpath_smart || '').trim();
  const fromSmart = bizKeyFromText(smart);
  if (fromSmart) return fromSmart;
  if (smart) return smart.slice(0, 64);

  const rid = String(el?.region_id || '').trim();
  if (rid) {
    const rest = rid.includes(':') ? rid.slice(rid.indexOf(':') + 1).trim() : rid;
    const fromId = bizKeyFromText(rest) || rest;
    if (fromId && !isTaxonomyRegionToken(fromId)) return fromId;
  }

  // Do not return bare region_role (e.g. "section") — SPA would show a useless bucket.
  return '';
}

function matchControlLabel(m) {
  const prev = m?.preview;
  const el = m?.element;
  // Prefer form-item / matched label over control visible text — el-select often
  // shares the same selected value (e.g.「否」) across different fields under one region.
  return String(
    prev?.formLabel || el?.formLabel || m?.matchedLabel
      || prev?.text || el?.text || '',
  ).replace(/\s+/g, ' ').trim();
}

/**
 * When multiple matches share the same display_group AND the same control label
 * (e.g. several「处理」/「新增」under one coarse region), append a short xpath/id
 * suffix so the picker stays usable.
 *
 * Same partition + different labels (客户编号 vs 客户名称) must NOT be split —
 * only (region, label) collisions need further disambiguation.
 * Mutates match.preview / match.element in place.
 * @param {Array<{ preview?: object, element?: object, matchedLabel?: string }>} matches
 */
export function uniquifyDisplayGroups(matches) {
  if (!Array.isArray(matches) || matches.length < 1) return matches;

  // Fill empty/taxonomy groups before uniquify (also for single-hit payloads).
  for (const m of matches) {
    const prev = m?.preview;
    const el = m?.element;
    const cur = String(prev?.display_group || el?.display_group || '').trim();
    if (cur && !isTaxonomyRegionToken(cur)) continue;
    const next = displayGroupOf({
      region_label: prev?.region_label || el?.region_label,
      xpath_smart: prev?.xpath_smart || el?.xpath_smart,
      region_id: prev?.region_id || el?.region_id,
      region_role: prev?.region_role || el?.region_role,
    });
    if (next) {
      if (prev) prev.display_group = next;
      if (el) el.display_group = next;
    } else {
      if (prev && isTaxonomyRegionToken(prev.display_group)) delete prev.display_group;
      if (el && isTaxonomyRegionToken(el.display_group)) delete el.display_group;
    }
  }

  if (matches.length < 2) return matches;

  // Collision key = partition (display_group) + control label — not partition alone.
  const collisionKey = (m) => {
    const g = String(m?.preview?.display_group || m?.element?.display_group || '').trim();
    if (!g) return '';
    return `${g}\0${matchControlLabel(m)}`;
  };

  const counts = new Map();
  for (const m of matches) {
    const key = collisionKey(m);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const seen = new Map();
  for (const m of matches) {
    const prev = m?.preview;
    const el = m?.element;
    const key = collisionKey(m);
    const base = String(prev?.display_group || el?.display_group || '').trim();
    if (!key || !base || (counts.get(key) || 0) < 2) continue;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    const smart = String(prev?.xpath_smart || el?.xpath_smart || '').trim();
    const rid = String(prev?.region_id || el?.region_id || '').trim();
    let suffix = '';
    if (smart) {
      const keyM = smart.match(/\b(?:PJ|DGSX)\d+\b/);
      suffix = keyM ? keyM[0] : smart.replace(/\s+/g, ' ').slice(-24);
    } else if (rid) {
      suffix = rid.slice(-24);
    } else {
      suffix = `#${n}`;
    }
    const next = `${base} · ${suffix}`;
    if (prev) prev.display_group = next;
    if (el) el.display_group = next;
  }
  return matches;
}
