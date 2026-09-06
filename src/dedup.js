/**
 * Deduplicate action entries by page-element identity.
 *
 * Only coalesces CONSECUTIVE duplicates — identical targets that appear
 * back-to-back with no different element between them.
 * Keeps the LATER entry (so a later fill value / select wins).
 * Does NOT remove non-consecutive duplicates (e.g. same fill before
 * and after a click), because they represent different semantic steps.
 */

const FIELD_ACTIONS = new Set([
  'fill_form_field',
  'select_option',
  'select_tree_option',
  'click_radio',
]);

function dedupKey(entry) {
  const action = entry?.action || '';
  const params = entry?.params || {};
  const sorted = Object.keys(params).sort().reduce((acc, k) => {
    acc[k] = params[k];
    return acc;
  }, {});
  return action + '|' + JSON.stringify(sorted);
}

/**
 * Same-page-element key; falls back to full action+params key.
 * @param {object} entry action entry with action/params/element fields
 * @returns {string} dedup key string for the entry
 */
export function elementDedupKey(entry) {
  const action = entry?.action || '';
  const params = entry?.params || {};
  const label = String(params.label_text || '').trim();
  if (FIELD_ACTIONS.has(action) && label) return `field:${label}`;

  const el = entry?.element && typeof entry.element === 'object' ? entry.element : {};
  const xpath = String(el.xpath || el.xpath_smart || entry?.target || '').trim();
  if (xpath) return `xpath:${xpath}`;

  if (action === 'click_button') {
    const t = String(params.button_text || '').trim();
    if (t) return `icon:${t}`;
  }
  if (action === 'click_menu_item') {
    const t = String(params.menu_text || '').trim();
    if (t) return `menu:${t}`;
  }
  if (action === 'switch_tab') {
    const t = String(params.tab_name || '').trim();
    if (t) return `tab:${t}`;
  }
  if (action === 'click_adjacent_button' && label) return `adjacent:${label}`;

  return dedupKey(entry);
}

/**
 * Coalesce consecutive duplicate entries by element identity (keeps the later entry).
 * @param {object[]} entries entries
 * @returns {object[]} result
 */
export function deduplicateByXPath(entries) {
  if (!entries || !Array.isArray(entries)) return [];
  const result = [];
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    if (result.length && elementDedupKey(result[result.length - 1]) === elementDedupKey(cur)) {
      result[result.length - 1] = cur; // keep later
      continue;
    }
    result.push(cur);
  }
  return result;
}

/**
 * Deduplicate commands inside an action file JSON (mutates in place) and attach a _meta summary.
 * @param {string|object} jsonContent raw JSON string or parsed object
 * @returns {object} the deduplicated object with `_meta` { originalCount, dedupedCount, removedCount }
 */
export function deduplicateActionFile(jsonContent) {
  const data = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
  const commands = (data?.tests?.[0]?.commands) || data?.actions || [];
  const deduped = deduplicateByXPath(commands);
  if (data?.tests?.[0]) {
    data.tests[0].commands = deduped;
  } else if (data?.actions) {
    data.actions = deduped;
  } else {
    data.tests = [{ id: 't1', name: 'session', commands: deduped }];
  }
  return {
    ...data,
    _meta: {
      originalCount: commands.length,
      dedupedCount: deduped.length,
      removedCount: commands.length - deduped.length,
    },
  };
}
