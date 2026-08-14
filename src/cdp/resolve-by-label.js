/**
 * Resolve Element UI control by label_text / actionType+params via CDP Runtime.evaluate.
 * Returns ElementJson-compatible shape for trajectory_step.element_json.
 *
 * Match order (action-aware when actionType provided):
 * 1) form item by label
 * 2) menu / tab / icon / table / adjacent / close / tree / button by params
 *
 * Responses:
 * - 1 match → { element, matchedLabel }
 * - N matches → { ambiguous: true, matches: [{ matchedLabel, element, preview }] }
 * - 0 → 404
 *
 * Primary xpath is xpath_smart when verified; else xpath_full + strategy.
 */
import { normalizeElementJson } from '../models/helpers.js';
import { PAGE_LOCATOR_HELPERS, enrichLocatorFields } from './locator-candidates.js';
import { normalizeActionName } from '../models/action-name.js';
import { displayGroupOf, uniquifyDisplayGroups } from './display-group.js';
import { prependPageLayer } from './region-layers.js';

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
    region_role: el?.region_role || '',
    region_id: el?.region_id || '',
    region_label: el?.region_label || '',
    region_chrome: el?.region_chrome,
    region_section: el?.region_section || '',
    region_block: el?.region_block || '',
    layers: Array.isArray(el?.layers) ? el.layers : [],
    display_group: displayGroupOf(el),
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
  mode = 'needle',
} = {}) {
  const labelJs = JSON.stringify(String(labelText || '').trim());
  const actionJs = JSON.stringify(String(actionType || '').trim());
  const paramsJs = JSON.stringify(params && typeof params === 'object' ? params : {});
  const modeJs = JSON.stringify(String(mode || 'needle').trim() || 'needle');
  return `(() => {
    const want = ${labelJs};
    const actionType = ${actionJs};
    const params = ${paramsJs};
    const mode = ${modeJs};

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
    function snap(el, matchedLabel, asFormField, kindHint, regionOverride) {
      const abs = xpathOf(el);
      const rawText = cleanVisibleText(el);
      const formLabel = asFormField ? matchedLabel : '';
      const loc = buildLocatorSnap(el, rawText, abs, formLabel, {
        targetKind: kindHint || undefined,
        region: regionOverride || undefined,
      });
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
        region_role: loc.region_role || '',
        region_id: loc.region_id || '',
        region_label: loc.region_label || '',
        region_chrome: loc.region_chrome,
        region_section: loc.region_section || '',
        region_block: loc.region_block || '',
        layers: Array.isArray(loc.layers) ? loc.layers : [],
        feature_card: loc.feature_card || undefined,
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
    function kindForClickable(el) {
      return (el.closest && el.closest('.el-tree-node__content'))
        ? 'tree_node'
        : (el.closest && el.closest('.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, [role="menuitem"]'))
          ? 'menu'
          : 'button';
    }
    /* COLLISION_REFINE */
    function pushHostsRefined(hostList, matchedLabel, asForm, kind) {
      const items = [];
      const seenAbs = {};
      for (let i = 0; i < hostList.length; i++) {
        const host = hostList[i];
        if (!host || !isVisible(host)) continue;
        const root = normalizeTargetRoot(host) || host;
        const abs = absXPath(root);
        if (seenAbs[abs]) continue;
        seenAbs[abs] = true;
        items.push({ el: root, region: assignRegion(root) });
      }
      refineCollidingRegions(items, matchedLabel || needle);
      for (let j = 0; j < items.length; j++) {
        const it = items[j];
        if (out.some((x) => x.xpath_abs === absXPath(it.el))) continue;
        out.push(snap(it.el, matchedLabel || needle, asForm, kind || kindForClickable(it.el), it.region));
      }
    }

    if (mode === 'inventory') {
      var inv = collectInventoryHosts();
      inv = filterInventoryByKind(inv, action);
      inv = filterInventoryByText(inv, needle);
      var truncated = false;
      if (inv.length > INVENTORY_CAP) {
        truncated = true;
        inv = inv.slice(0, INVENTORY_CAP);
      }
      var invGroups = {};
      for (var ii = 0; ii < inv.length; ii++) {
        var it0 = inv[ii];
        var gk = it0.text || '';
        if (!invGroups[gk]) invGroups[gk] = [];
        invGroups[gk].push(it0);
      }
      var gkeys = Object.keys(invGroups);
      for (var gi = 0; gi < gkeys.length; gi++) {
        var gkey = gkeys[gi];
        var gitems = invGroups[gkey];
        var refineItems = [];
        var seenInvAbs = {};
        for (var jj = 0; jj < gitems.length; jj++) {
          var hit = gitems[jj];
          var host = hit.el;
          if (!host || !isVisible(host)) continue;
          var root = normalizeTargetRoot(host) || host;
          var abs0 = absXPath(root);
          if (seenInvAbs[abs0]) continue;
          seenInvAbs[abs0] = true;
          refineItems.push({ el: root, region: assignRegion(root), kind: hit.kind, text: hit.text });
        }
        refineCollidingRegions(refineItems, gkey);
        for (var kk = 0; kk < refineItems.length; kk++) {
          var rit = refineItems[kk];
          var asForm = rit.kind.indexOf('form_') === 0;
          var abs1 = absXPath(rit.el);
          if (out.some(function (x) { return x.xpath_abs === abs1; })) continue;
          out.push(snap(rit.el, rit.text, asForm, rit.kind, rit.region));
        }
      }
      return { matches: out, truncated: truncated };
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

    // Form-only actions: never fall through to menu/generic clickables.
    if (action === 'fill_form_field' || action === 'select_option') {
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
          if (!el) continue;
          let kind = 'form_input';
          if (el.closest && el.closest('.el-date-editor')) kind = 'form_date';
          else if (el.closest && el.closest('.el-select')) kind = 'form_select';
          else if (el.closest && el.closest('.el-radio-group')) kind = 'form_radio';
          else if (el.closest && el.closest('.el-tree-select, .el-cascader')) kind = 'form_tree_select';
          else if (m.item.querySelector && m.item.querySelector('.tsscTree, .tree-popover, .el-tree-select, .el-cascader')) {
            kind = 'form_tree_select';
          }
          if (action === 'select_option') kind = 'form_select';
          pushUnique(el, m.label, true, kind);
        }
      }
      return out;
    }

    // Click-by-index / menu: sidebar + buttons (fixes labelText-only / 点击元素 for 对公客户管理).
    if (action === 'click_element_by_index' || action === 'click_menu_item' || params.menu_text || params.text) {
      const name = String(params.menu_text || params.text || needle || '').trim();
      const nodes = document.querySelectorAll(
        '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"], aside li, nav li, ' +
        '.el-dialog__footer button, .el-dialog__footer .el-button, .el-message-box__btns button, button.el-button, .el-button, button, a, .el-tree-node__content, .todo-item-action'
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
      const matched = exact.length ? exact : fuzzy;
      const hostList = [];
      for (const el of matched) hostList.push(el);
      if (hostList.length >= 2) {
        pushHostsRefined(hostList, name, false, null);
      } else if (hostList.length === 1) {
        pushUnique(hostList[0], name, false, kindForClickable(hostList[0]));
      }
      if (!out.length && exact.length) {
        for (const el of exact) {
          const root = normalizeTargetRoot(el) || el;
          const abs = absXPath(root);
          if (out.some((x) => x.xpath_abs === abs)) continue;
          const kind = (el.closest && el.closest('.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, [role="menuitem"]'))
            ? 'menu'
            : 'button';
          out.push(snap(root, name, false, kind));
        }
      }
      if (out.length) return out;
    }

    // Menu — legacy gate (click_menu_item / menu_text already handled above; keep for empty-action needle menus).
    if (!action && needle) {
      const name = needle;
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
      const matched = exact.length ? exact : fuzzy;
      const hostList = [];
      for (const el of matched) hostList.push(el);
      if (hostList.length >= 2) {
        pushHostsRefined(hostList, name, false, 'menu');
      } else if (hostList.length === 1) {
        pushUnique(hostList[0], name, false, 'menu');
      }
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

    // Form fields by label
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
      // Prefer fields inside the topmost visible drawer/dialog when both list+overlay exist
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

    // Generic clickables by text (includes sidebar menus — defense for {labelText}-only)
    if (needle) {
      const clickables = Array.from(document.querySelectorAll(
        '.menu-item, .submenu-item, .el-menu-item, .el-submenu__title, .el-dropdown-menu__item, [role="menuitem"], aside li, nav li, ' +
        '.el-dialog__footer button, .el-dialog__footer .el-button, .el-message-box__btns button, button.el-button, .el-button, button, a, .el-tree-node__content, .todo-item-action'
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
      const matched = exact.length ? exact : fuzzy;
      const hostList = [];
      for (const el of matched) hostList.push(el);
      if (hostList.length >= 2) {
        pushHostsRefined(hostList, needle, false, null);
      } else if (hostList.length === 1) {
        pushUnique(hostList[0], needle, false, kindForClickable(hostList[0]));
      }
    }

    return out;
  })()`;
}

/**
 * @param {import('./client.js').CdpClient} client
 * @param {{ labelText?: string, actionType?: string, params?: object, mode?: string, pageLabel?: string }} opts
 * @returns {Promise<{ element?: object, matchedLabel?: string, ambiguous?: boolean, matches?: object[], truncated?: boolean }>}
 */
export async function resolveElementByLabel(client, opts = {}) {
  const mode = String(opts.mode || 'needle').trim() || 'needle';
  const labelText = String(opts.labelText || opts.label_text || '').trim();
  const actionType = normalizeActionName(opts.actionType || opts.action || '');
  const params = opts.params && typeof opts.params === 'object' ? opts.params : {};
  const pageLabel = String(opts.pageLabel || opts.page_label || '').trim();

  if (mode !== 'inventory' && !labelText && !actionType && !Object.keys(params).length) {
    const err = new Error('labelText or actionType/params is required');
    err.statusCode = 400;
    throw err;
  }
  if (!client) {
    const err = new Error('CDP client not available — attach BiB stream first');
    err.statusCode = 400;
    throw err;
  }

  const result = await client.send('Runtime.evaluate', {
    expression: buildResolveExpression({ labelText, actionType, params, mode }),
    returnByValue: true,
    awaitPromise: false,
  });
  const value = result?.result?.value;
  let list;
  let pageTruncated = false;
  if (Array.isArray(value)) {
    list = value;
  } else if (value && typeof value === 'object' && Array.isArray(value.matches)) {
    list = value.matches;
    pageTruncated = value.truncated === true;
  } else if (value && typeof value === 'object') {
    list = [value];
  } else {
    list = [];
  }

  if (!list.length) {
    const hint = labelText || params.menu_text || params.tab_name || params.button_text || actionType || 'target';
    const err = new Error(`页上找不到「${hint}」对应的控件（请确认弹窗已打开且目标可见）`);
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
      region_role: raw.region_role || '',
      region_id: raw.region_id || '',
      region_label: raw.region_label || '',
      region_chrome: raw.region_chrome,
      region_section: raw.region_section || '',
      region_block: raw.region_block || '',
      layers: Array.isArray(raw.layers) ? raw.layers : [],
    });
    // Preserve DOM-verified flag from page snap
    if (raw.locator_verified === true && enriched.xpath_smart) {
      enriched.locator_verified = true;
      enriched.locator_strategy = 'xpath_smart';
      enriched.xpath = enriched.xpath_smart;
    }
    const featureCard = raw.feature_card && typeof raw.feature_card === 'object'
      ? raw.feature_card
      : undefined;
    const layers = prependPageLayer(enriched.layers || [], pageLabel);
    enriched.layers = layers;
    const displayGroup = displayGroupOf(enriched);
    const element = normalizeElementJson(enriched);
    element.layers = layers;
    if (displayGroup) element.display_group = displayGroup;
    if (featureCard) element.feature_card = featureCard;
    const preview = toPreview(enriched);
    preview.layers = layers;
    if (featureCard) preview.feature_card = featureCard;
    return {
      matchedLabel: String(raw.matchedLabel || labelText || ''),
      element,
      preview,
    };
  }

  const matches = uniquifyDisplayGroups(list.map(enrichOne));
  const truncated = pageTruncated;
  const forceAmbiguous = mode === 'inventory' && !labelText && matches.length >= 1;
  if (forceAmbiguous) {
    return {
      ambiguous: true,
      matches,
      ...(truncated ? { truncated: true } : {}),
    };
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
    ...(truncated ? { truncated: true } : {}),
  };
}
