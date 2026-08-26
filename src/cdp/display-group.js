/**
 * Human-readable grouping key for the ambiguity picker.
 * Prefer region_label / business key / xpath — never bare L1 taxonomy roles
 * (section|main|other|…) which are useless as picker group titles.
 */

const TAXONOMY_ROLES = new Set([
  'section',
  'tab',
  'wizard',
  'card',
  'main',
  'other',
  'overlay',
  'table',
  'todo',
  'page',
  'menu',
  'shell-aside',
  'shell-header',
  'shell-tabs',
]);

/**
 * Whether a string is a taxonomy region token (role or custom: prefix) that
 * should not be used as a picker group title.
 * @param {string} s Candidate token.
 * @returns {boolean} True if the token is a taxonomy region role or custom: prefix.
 */
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

function isBizKey(s) {
  const t = String(s || '').trim();
  return /^(?:PJ|DGSX)\d+$/i.test(t) || /^[A-Z]{2,}\d{6,}$/i.test(t);
}

function bizKeyFromRegionId(rid) {
  const raw = String(rid || '').trim();
  if (!raw) return '';
  const rest = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).trim() : raw;
  return isBizKey(rest) ? rest : '';
}

/**
 * Compute a human-readable display group for an element, preferring
 * region_label / business key / region_id over bare taxonomy roles.
 * @param {object|null|undefined} el Element meta with region_label / xpath_smart / region_id.
 * @returns {string} Display group title (empty string if none usable).
 */
export function displayGroupOf(el) {
  const label = String(el?.region_label || '').trim();
  if (label && !isTaxonomyRegionToken(label)) return label;

  // Recover a business key from xpath / region_id — never emit xpath fragments
  // as picker group titles (SPA must display display_group as-is).
  const fromSmart = bizKeyFromText(el?.xpath_smart);
  if (fromSmart) return fromSmart;

  const fromId = bizKeyFromRegionId(el?.region_id);
  if (fromId) return fromId;

  const rid = String(el?.region_id || '').trim();
  if (rid) {
    const rest = rid.includes(':') ? rid.slice(rid.indexOf(':') + 1).trim() : rid;
    if (rest && !isTaxonomyRegionToken(rest)) return rest;
  }

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
 * (e.g. several「处理」/「新增」under one coarse region), append a business-key
 * or #n suffix so the picker stays usable.
 *
 * Same partition + different labels (客户编号 vs 客户名称) must NOT be split —
 * only (region, label) collisions need further disambiguation.
 * Mutates match.preview / match.element in place.
 * SPA displays display_group as-is — never emit xpath fragments here.
 * @param {Array<{ preview?: object, element?: object, matchedLabel?: string }>} matches Matches to disambiguate.
 * @returns {Array<{ preview?: object, element?: object, matchedLabel?: string }>} The same matches array (mutated in place).
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
    // Collision suffix is a business key or #n — never an xpath/CSS fragment.
    const suffix = bizKeyFromRegionId(rid) || bizKeyFromText(smart) || `#${n}`;
    const next = `${base} · ${suffix}`;
    if (prev) prev.display_group = next;
    if (el) el.display_group = next;
  }
  return matches;
}
