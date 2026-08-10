/**
 * Resolve Element UI control by label_text / actionType+params via CDP Runtime.evaluate.
 * Returns ElementJson-compatible shape for trajectory_step.element_json.
 *
 * Product API (resolveElementByLabel) supports only SUPPORTED_RESOLVE_ACTIONS and returns
 * **only** verified xpath_smart relative locators.
 *
 * Responses:
 * - 1 match → { element, matchedLabel }
 * - N matches → { ambiguous: true, matches: [{ matchedLabel, element, preview }] }
 * - 0 → 404
 */
import { normalizeElementJson } from '../models/helpers.js';
import { PAGE_LOCATOR_HELPERS, enrichLocatorFields } from './locator-candidates.js';
import { normalizeActionName } from '../models/action-name.js';

export const SUPPORTED_RESOLVE_ACTIONS = Object.freeze([
  'fill_form_field',
  'select_option',
  'click_element_by_index',
]);

/**
 * @param {Array<{ matchedLabel?: string, element?: object, preview?: object }>} matches
 * @returns {typeof matches}
 */
export function filterVerifiedRelativeMatches(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const out = [];
  for (const m of list) {
    const el = m?.element && typeof m.element === 'object' ? { ...m.element } : null;
    if (!el) continue;
    const smart = String(el.xpath_smart || '').trim();
    if (!smart || el.locator_verified !== true) continue;
    el.xpath_smart = smart;
    el.xpath = smart;
    el.locator_strategy = 'xpath_smart';
    el.locator_verified = true;
    out.push({
      matchedLabel: m.matchedLabel,
      element: el,
      preview: m.preview
        ? { ...m.preview, xpath_smart: smart, locator_strategy: 'xpath_smart' }
        : toPreview(el),
    });
  }
  return out;
}

/**
 * Sanitize preview (never expose form values / secrets).
 * @param {object} el
 */
function toPreview(el) {
  const attrs = el?.attributes && typeof el.attributes === 'object' ? { ...el.attributes } : {};
  for (const k of Object.keys(attrs)) {
    if (/^(value|password|pwd|token|authorization|cookie)$/i.test(k)) delete attrs[k];
  }
  return {
    tag: el?.tag || '',
    text: el?.text || '',
    formLabel: el?.formLabel || '',
    xpath_smart: el?.xpath_smart || '',
    xpath_full: el?.xpath_full || '',
    locator_strategy: el?.locator_strategy || '',
    target_kind: el?.target_kind || '',
    attributes: attrs,
  };
}

/**
 * Page-side script: find all matching controls.
 * @param {object} opts
 */
export function buildResolveExpression({
  labelText = '',
  actionType = '',
  params = {},
} = {}) {
  const labelJs = JSON.stringify(String(labelText || '').trim());
  const actionJs = JSON.stringify(String(actionType || '').trim());
  const paramsJs = JSON.stringify(params && typeof params === 'object' ? params : {});
  return `(() => {
    const want = ${labelJs};
    const actionType = ${actionJs};
    const params = ${paramsJs};

${PAGE_LOCATOR_HELPERS}

    function normLabel(s) {
      return String(s || '').trim().replace(/[：:*\\s]+$/g, '');
    }
    function formItemLabel(node) {
      const item = node && node.closest && node.closest('.el-form-item');
      if (!item) return '';
      const lbl = item.querySelector('.el-form-item__label');
      return normLabel(lbl && lbl.textContent);
    }
    function xpathOf(node) {
      return absXPath(node);
    }
    function pickControl(item) {
      if (!item) return null;
      const candidates = [
        item.querySelector('.el-tree-select'),
        item.querySelector('.el-cascader'),
        item.querySelector('span.my-popover, .my-popover'),
        item.querySelector('.el-select'),
        item.querySelector('.el-date-editor'),
        item.querySelector('.el-radio-group'),
        item.querySelector('.el-checkbox-group'),
        item.querySelector('.el-textarea__inner'),
        item.querySelector('textarea'),
        // Prefer display input outside tree popover (tsscTree search box lives inside popover)
        Array.from(item.querySelectorAll('.el-input__inner, input:not([type="hidden"])'))
          .find(function (inp) { return !inp.closest('.el-popover, .tree-popover'); }),
        item.querySelector('button'),
        item.querySelector('a'),
      ].filter(Boolean);
      return candidates[0] || item;
    }
    function snap(el, matchedLabel, asFormField, kindHint) {
      const abs = xpathOf(el);
      const rawText = cleanVisibleText(el);
      const formLabel = asFormField ? matchedLabel : '';
      const loc = buildLocatorSnap(el, rawText, abs, formLabel, { targetKind: kindHint || undefined });
      return {
        matchedLabel,
        formLabel: formLabel || loc.formLabel || '',
        tag: loc.tag || (el.tagName ? el.tagName.toLowerCase() : ''),
        xpath: loc.xpath || abs,
        xpath_smart: loc.xpath_smart || '',
        xpath_full: loc.xpath_full || abs,
        xpath_abs: abs,
        cssSelector: loc.cssSelector || '',
        attributes: loc.attributes || {},
        text: loc.text || rawText,
        className: String(el.className || ''),
        candidates: loc.candidates || [],
        target_kind: loc.target_kind || kindHint || '',
        locator_scope: loc.locator_scope,
        locator_occurrence: loc.locator_occurrence,
        locator_verified: loc.locator_verified,
        locator_strategy: loc.locator_strategy,
        locator_fallback_reason: loc.locator_fallback_reason,
      };
    }
    function textExact(a, b) {
      return normLabel(a) === normLabel(b);
    }
    function textFuzzy(a, b) {
      const t = normLabel(a);
      const w = normLabel(b);
      if (!t || !w) return false;
      // Element text may contain the needle (partial user input). Do NOT match
      // when the needle contains the element text — that makes parent menus
      // steal child queries (客户管理 vs 对公客户管理).
      return t === w || t.includes(w);
    }

    const needle = want
      || String(params.label_text || params.menu_text || params.tab_name
        || params.button_text || params.text || params.option_text || '').trim();
    const action = String(actionType || '').trim();
    const out = [];

    function pushUnique(host, matchedLabel, asForm, kind) {
      if (!host || !isVisible(host)) return;
      const root = normalizeTargetRoot(host) || host;
      // de-dupe by absolute xpath
      const abs = absXPath(root);
      if (out.some((x) => x.xpath_abs === abs)) return;
      out.push(snap(root, matchedLabel || needle, asForm, kind));
    }

    function matchFormFieldsByLabel() {
      if (!needle) return;
      const items = Array.from(document.querySelectorAll('.el-form-item'));
      const exactItems = [];
      const fuzzyItems = [];
      for (const item of items) {
        if (!isVisible(item) && item.offsetParent === null) continue;
        const label = formItemLabel(item);
        if (!label) continue;
        if (textExact(label, needle)) exactItems.push({ item, label });
        else if (textFuzzy(label, needle)) fuzzyItems.push({ item, label });
      }
      let chosen = exactItems.length ? exactItems : fuzzyItems;
      const overlays = Array.from(document.querySelectorAll('.el-dialog, .el-drawer')).filter((d) => {
        try {
          const s = getComputedStyle(d);
          return s.display !== 'none' && s.visibility !== 'hidden' && d.getClientRects().length > 0;
        } catch (e) { return false; }
      });
      if (overlays.length && chosen.length > 1) {
        const top = overlays[overlays.length - 1];
        const inOverlay = chosen.filter((m) => top.contains(m.item));
        if (inOverlay.length) chosen = inOverlay;
      }
      for (const m of chosen) {
        const el = pickControl(m.item);
        if (el) {
          let kind = 'form_input';
          if (action === 'select_option' || (el.closest && el.closest('.el-select'))) kind = 'form_select';
          else if (el.closest && el.closest('.el-date-editor')) kind = 'form_date';
          else if (el.closest && el.closest('.el-radio-group')) kind = 'form_radio';
          else if (el.closest && el.closest('.el-tree-select, .el-cascader')) kind = 'form_tree_select';
          else if (m.item.querySelector && m.item.querySelector('.tsscTree, .tree-popover, .el-tree-select, .el-cascader')) {
            kind = 'form_tree_select';
          }
          pushUnique(el, m.label, true, kind);
        }
      }
    }

    // Product actions — form-only (no menu/button fallthrough)
    if (action === 'fill_form_field' || action === 'select_option') {
      matchFormFieldsByLabel();
      return out;
    }

    // Product action — clickables + sidebar/menu (no form-field matching)
    if (action === 'click_element_by_index') {
      const name = String(params.text || needle || '').trim();
      const nodes = document.querySelectorAll(
        '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"], aside li, nav li, ' +
        '.el-dialog__footer button, .el-dialog__footer .el-button, .el-message-box__btns button, button.el-button, .el-button, button, a, .el-tree-node__content'
      );
      const exact = [];
      const fuzzy = [];
      for (const el of nodes) {
        const t = cleanVisibleText(el) || normLabel(el.getAttribute && el.getAttribute('title'));
        if (!t) continue;
        const visible = isVisible(el);
        if (textExact(t, name)) {
          if (visible || el.getAttribute('title') === name || (el.textContent || '').includes(name)) exact.push(el);
        } else if (visible && textFuzzy(t, name)) {
          fuzzy.push(el);
        }
      }
      for (const el of (exact.length ? exact : fuzzy)) {
        const kind = el.closest && el.closest('.el-tree-node__content') ? 'tree_node'
          : (el.closest && (el.closest('.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, aside, nav') || el.matches('.menu-item, .submenu-item, .el-menu-item, .el-submenu__title')))
            ? 'menu' : 'button';
        pushUnique(el, name, false, kind);
      }
      if (!out.length && exact.length) {
        for (const el of exact) {
          const root = normalizeTargetRoot(el) || el;
          const abs = absXPath(root);
          if (out.some((x) => x.xpath_abs === abs)) continue;
          const kind = el.closest && el.closest('.el-tree-node__content') ? 'tree_node' : 'menu';
          out.push(snap(root, name, false, kind));
        }
      }
      return out;
    }

    // Close controls
    if (action === 'close_dialog' || params.target_kind === 'dialog_close') {
      const closes = document.querySelectorAll(
        '.el-dialog__headerbtn, .el-drawer__close-btn, .el-message-box__headerbtn, .el-dialog__close'
      );
      for (const el of closes) pushUnique(el, 'close', false, 'dialog_close');
      return out;
    }

    // Tabs
    if (action === 'switch_tab' || params.tab_name) {
      const name = String(params.tab_name || needle || '').trim();
      const tabs = document.querySelectorAll('.el-tabs__item, [role="tab"]');
      const exact = [];
      const fuzzy = [];
      for (const el of tabs) {
        if (!isVisible(el)) continue;
        const t = cleanVisibleText(el);
        if (textExact(t, name)) exact.push(el);
        else if (textFuzzy(t, name)) fuzzy.push(el);
      }
      for (const el of (exact.length ? exact : fuzzy)) pushUnique(el, name, false, 'tab');
      if (out.length) return out;
    }

    // Menu — include custom sidebar tokens (menu-item / submenu-item), not only Element UI.
    if (action === 'click_menu_item' || params.menu_text) {
      const name = String(params.menu_text || needle || '').trim();
      const nodes = document.querySelectorAll(
        '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"], aside li, nav li'
      );
      const exact = [];
      const fuzzy = [];
      for (const el of nodes) {
        // Sidebar trees keep collapsed items in DOM with offsetParent=null; still
        // allow exact title/text match so resolve can target submenu entries.
        const t = cleanVisibleText(el) || normLabel(el.getAttribute && el.getAttribute('title'));
        if (!t) continue;
        const visible = isVisible(el);
        if (textExact(t, name)) {
          if (visible || el.getAttribute('title') === name || (el.textContent || '').includes(name)) exact.push(el);
        } else if (visible && textFuzzy(t, name)) {
          fuzzy.push(el);
        }
      }
      for (const el of (exact.length ? exact : fuzzy)) pushUnique(el, name, false, 'menu');
      // pushUnique skips invisible — for exact submenu hits, force snap even if collapsed
      if (!out.length && exact.length) {
        for (const el of exact) {
          const root = normalizeTargetRoot(el) || el;
          const abs = absXPath(root);
          if (out.some((x) => x.xpath_abs === abs)) continue;
          out.push(snap(root, name, false, 'menu'));
        }
      }
      if (out.length) return out;
    }

    // Icon
    if (action === 'click_icon_button' || params.button_text && action.includes('icon')) {
      const name = String(params.button_text || needle || '').trim();
      const nodes = document.querySelectorAll('[aria-label], [title]');
      for (const el of nodes) {
        if (!isVisible(el)) continue;
        const t = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        if (textExact(t, name) || textFuzzy(t, name)) pushUnique(el, name, false, 'icon');
      }
      if (out.length) return out;
    }

    // Table row button
    if (action === 'click_table_row_button') {
      const row = String(params.row_text || '').trim();
      const btn = String(params.button_text || needle || '').trim();
      const rows = document.querySelectorAll('.el-table__body .el-table__row, .el-table__body tr');
      for (const tr of rows) {
        if (!isVisible(tr)) continue;
        if (row && !(tr.textContent || '').includes(row)) continue;
        const buttons = tr.querySelectorAll('button, .el-button, a');
        for (const b of buttons) {
          const t = cleanVisibleText(b);
          if (!btn || textExact(t, btn) || textFuzzy(t, btn)) {
            pushUnique(b, btn || t, false, 'table_row_button');
          }
        }
      }
      if (out.length) return out;
    }

    // Form fields by label (legacy callers)
    if (needle) {
      const items = Array.from(document.querySelectorAll('.el-form-item'));
      const exactItems = [];
      const fuzzyItems = [];
      for (const item of items) {
        if (!isVisible(item) && item.offsetParent === null) continue;
        const label = formItemLabel(item);
        if (!label) continue;
        if (textExact(label, needle)) exactItems.push({ item, label });
        else if (textFuzzy(label, needle)) fuzzyItems.push({ item, label });
      }
      let chosen = exactItems.length ? exactItems : fuzzyItems;
      const overlays = Array.from(document.querySelectorAll('.el-dialog, .el-drawer')).filter((d) => {
        try {
          const s = getComputedStyle(d);
          return s.display !== 'none' && s.visibility !== 'hidden' && d.getClientRects().length > 0;
        } catch (e) { return false; }
      });
      if (overlays.length && chosen.length > 1) {
        const top = overlays[overlays.length - 1];
        const inOverlay = chosen.filter((m) => top.contains(m.item));
        if (inOverlay.length) chosen = inOverlay;
      }
      for (const m of chosen) {
        const el = pickControl(m.item);
        if (el) {
          let kind = 'form_input';
          if (el.closest && el.closest('.el-date-editor')) kind = 'form_date';
          else if (el.closest && el.closest('.el-select')) kind = 'form_select';
          else if (el.closest && el.closest('.el-radio-group')) kind = 'form_radio';
          else if (el.closest && el.closest('.el-tree-select, .el-cascader')) kind = 'form_tree_select';
          else if (m.item.querySelector && m.item.querySelector('.tsscTree, .tree-popover, .el-tree-select, .el-cascader')) {
            kind = 'form_tree_select';
          }
          else if (action === 'click_adjacent_button') kind = 'adjacent_button';
          if (action === 'click_adjacent_button') {
            const btn = m.item.querySelector('button, .el-button, a');
            if (btn) pushUnique(btn, m.label, false, 'adjacent_button');
            else pushUnique(el, m.label, true, kind);
          } else {
            pushUnique(el, m.label, true, kind);
          }
        }
      }
      if (out.length) return out;
    }

    // Generic clickables by text
    if (needle) {
      const clickables = Array.from(document.querySelectorAll(
        '.el-dialog__footer button, .el-dialog__footer .el-button, .el-message-box__btns button, button.el-button, .el-button, button, a, .el-tree-node__content'
      ));
      const exact = [];
      const fuzzy = [];
      for (const el of clickables) {
        if (!isVisible(el)) continue;
        const t = cleanVisibleText(el);
        if (!t) continue;
        if (textExact(t, needle)) exact.push(el);
        else if (textFuzzy(t, needle)) fuzzy.push(el);
      }
      for (const el of (exact.length ? exact : fuzzy)) {
        const kind = el.closest && el.closest('.el-tree-node__content') ? 'tree_node' : 'button';
        pushUnique(el, needle, false, kind);
      }
    }

    return out;
  })()`;
}

/**
 * @param {import('./client.js').CdpClient} client
 * @param {{ labelText?: string, actionType?: string, params?: object }} opts
 * @returns {Promise<{ element?: object, matchedLabel?: string, ambiguous?: boolean, matches?: object[] }>}
 */
export async function resolveElementByLabel(client, opts = {}) {
  const labelText = String(opts.labelText || opts.label_text || '').trim();
  const actionType = normalizeActionName(opts.actionType || opts.action || '');
  const params = opts.params && typeof opts.params === 'object' ? opts.params : {};

  if (!SUPPORTED_RESOLVE_ACTIONS.includes(actionType)) {
    const err = new Error(
      `resolve-element requires actionType in ${SUPPORTED_RESOLVE_ACTIONS.join('|')} (got: ${actionType || '(empty)'})`,
    );
    err.statusCode = 400;
    throw err;
  }
  const needle = labelText
    || String(params.label_text || params.text || params.menu_text || params.button_text || '').trim();
  if (!needle) {
    const err = new Error('labelText or params.text / params.label_text is required');
    err.statusCode = 400;
    throw err;
  }
  if (!client) {
    const err = new Error('CDP client not available — attach BiB stream first');
    err.statusCode = 400;
    throw err;
  }

  const result = await client.send('Runtime.evaluate', {
    expression: buildResolveExpression({ labelText, actionType, params }),
    returnByValue: true,
    awaitPromise: false,
  });
  const value = result?.result?.value;
  const rawList = Array.isArray(value) ? value : (value && typeof value === 'object' ? [value] : []);

  if (!rawList.length) {
    const err = new Error(`页上找不到「${needle}」对应的控件（请确认弹窗已打开且目标可见）`);
    err.statusCode = 404;
    throw err;
  }

  function enrichOne(raw) {
    const className = String(raw.className || raw.attributes?.class || '').trim();
    const enriched = enrichLocatorFields({
      tag: raw.tag,
      xpath: raw.xpath,
      xpath_abs: raw.xpath_abs || raw.xpath_full,
      xpath_full: raw.xpath_full,
      xpath_smart: raw.xpath_smart,
      formLabel: raw.formLabel || raw.matchedLabel || labelText,
      matchedLabel: raw.matchedLabel || labelText,
      cssSelector: raw.cssSelector,
      attributes: {
        ...(raw.attributes || {}),
        ...(className ? { class: className } : {}),
      },
      text: raw.text,
      className,
      candidates: raw.candidates,
      target_kind: raw.target_kind,
      locator_scope: raw.locator_scope,
      locator_occurrence: raw.locator_occurrence,
      locator_verified: raw.locator_verified === true,
      locator_strategy: raw.locator_strategy,
      locator_fallback_reason: raw.locator_fallback_reason,
      rowText: params.row_text,
      buttonText: params.button_text,
      menuText: params.menu_text,
      tabName: params.tab_name,
    });
    // Preserve DOM-verified flag from page snap
    if (raw.locator_verified === true && enriched.xpath_smart) {
      enriched.locator_verified = true;
      enriched.locator_strategy = 'xpath_smart';
      enriched.xpath = enriched.xpath_smart;
    }
    return {
      matchedLabel: String(raw.matchedLabel || labelText || ''),
      element: normalizeElementJson(enriched),
      preview: toPreview(enriched),
    };
  }

  const matches = filterVerifiedRelativeMatches(rawList.map(enrichOne));
  if (!matches.length) {
    const err = new Error(
      `页上找到「${needle}」但无可用相对定位（xpath_smart 未通过校验）`,
    );
    err.statusCode = 404;
    throw err;
  }
  if (matches.length === 1) {
    return {
      element: matches[0].element,
      matchedLabel: matches[0].matchedLabel,
    };
  }
  return {
    ambiguous: true,
    matches,
  };
}
