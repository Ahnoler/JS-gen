/**
 * Resolve Element UI control by label_text via CDP Runtime.evaluate.
 * Returns ElementJson-compatible shape for trajectory_step.element_json.
 *
 * Match order:
 * 1) .el-form-item by label text (form fields)
 * 2) visible button / .el-button / link by visible text (dialog 取消/确定 etc.)
 *
 * For clickable text controls, primary xpath is xpath_smart (text-anchored).
 */
import { toElementJson } from '../models/element.js';
import { PAGE_LOCATOR_HELPERS, enrichLocatorFields } from './locator-candidates.js';

/**
 * Page-side script: find form control or clickable by label/text.
 * @param {string} labelText
 */
export function buildResolveByLabelExpression(labelText) {
  const labelJs = JSON.stringify(String(labelText || '').trim());
  return `(() => {
    const want = ${labelJs};
    if (!want) return null;

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
    function visible(el) {
      if (!el || el.nodeType !== 1) return false;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function xpathOf(node) {
      if (!node || node.nodeType !== 1) return '';
      if (node.id) return '//*[@id="' + node.id + '"]';
      const parts = [];
      let cur = node;
      while (cur && cur.nodeType === 1 && cur !== document.body) {
        let ix = 1;
        let sib = cur.previousElementSibling;
        while (sib) {
          if (sib.tagName === cur.tagName) ix++;
          sib = sib.previousElementSibling;
        }
        parts.unshift(cur.tagName.toLowerCase() + '[' + ix + ']');
        cur = cur.parentElement;
      }
      return '/' + parts.join('/');
    }
    function pickControl(item) {
      if (!item) return null;
      const candidates = [
        item.querySelector('.el-input__inner'),
        item.querySelector('.el-textarea__inner'),
        item.querySelector('.el-select'),
        item.querySelector('.el-date-editor'),
        item.querySelector('.el-radio-group'),
        item.querySelector('.el-checkbox-group'),
        item.querySelector('.el-cascader'),
        item.querySelector('.el-tree-select'),
        item.querySelector('input:not([type="hidden"])'),
        item.querySelector('textarea'),
        item.querySelector('button'),
        item.querySelector('a'),
      ].filter(Boolean);
      return candidates[0] || item;
    }
    function snap(el, matchedLabel) {
      const attrs = {};
      try {
        for (const a of el.attributes || []) {
          if (a && a.name) attrs[a.name] = a.value;
        }
      } catch {}
      const abs = xpathOf(el);
      const rawText = String(el.innerText || el.value || el.textContent || '').trim().slice(0, 120);
      const loc = buildLocatorSnap(el, rawText, abs);
      return {
        matchedLabel,
        tag: el.tagName ? el.tagName.toLowerCase() : '',
        xpath: loc.xpath || abs,
        xpath_smart: loc.xpath_smart || '',
        xpath_full: loc.xpath_full || abs,
        xpath_abs: abs,
        cssSelector: loc.cssSelector || '',
        attributes: attrs,
        text: loc.text || rawText,
        className: String(el.className || attrs.class || ''),
        candidates: loc.candidates || [],
      };
    }
    function textMatch(elText, needle) {
      const t = normLabel(elText);
      const w = normLabel(needle);
      if (!t || !w) return false;
      return t === w || t.includes(w) || w.includes(t);
    }

    // 1) Form item by label
    const items = Array.from(document.querySelectorAll('.el-form-item'));
    let matched = null;
    for (const item of items) {
      if (!visible(item) && item.offsetParent === null) continue;
      const label = formItemLabel(item);
      if (!label) continue;
      if (label === want || label.includes(want) || want.includes(label)) {
        matched = { item, label };
        if (label === want) break;
      }
    }
    if (matched) {
      const el = pickControl(matched.item);
      if (el) return snap(el, matched.label);
    }

    // 2) Clickable by visible text (dialog footer 取消/确定, plain buttons, links)
    const clickables = Array.from(document.querySelectorAll(
      '.el-dialog__footer button, .el-dialog__footer .el-button, .el-message-box__btns button, .el-message-box__btns .el-button, button.el-button, .el-button, button, a'
    ));
    let exactBtn = null;
    let fuzzyBtn = null;
    for (const el of clickables) {
      if (!visible(el)) continue;
      const t = String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t) continue;
      if (normLabel(t) === normLabel(want)) {
        exactBtn = el;
        break;
      }
      if (!fuzzyBtn && textMatch(t, want)) fuzzyBtn = el;
    }
    const btn = exactBtn || fuzzyBtn;
    if (btn) return snap(btn, want);

    return null;
  })()`;
}

/**
 * @param {import('./client.js').CdpClient} client
 * @param {string} labelText
 * @returns {Promise<{ element: object, matchedLabel: string }>}
 */
export async function resolveElementByLabel(client, labelText) {
  const label = String(labelText || '').trim();
  if (!label) {
    const err = new Error('labelText is required');
    err.statusCode = 400;
    throw err;
  }
  if (!client) {
    const err = new Error('CDP client not available — attach BiB stream first');
    err.statusCode = 400;
    throw err;
  }

  const result = await client.send('Runtime.evaluate', {
    expression: buildResolveByLabelExpression(label),
    returnByValue: true,
    awaitPromise: false,
  });
  const value = result?.result?.value;
  if (!value || typeof value !== 'object') {
    const err = new Error(`页上找不到「${label}」对应的表单项或按钮（请确认弹窗已打开且按钮可见）`);
    err.statusCode = 404;
    throw err;
  }

  const className = String(value.className || value.attributes?.class || '').trim();
  const enriched = enrichLocatorFields({
    tag: value.tag,
    xpath: value.xpath,
    xpath_abs: value.xpath_abs || value.xpath_full,
    xpath_full: value.xpath_full,
    xpath_smart: value.xpath_smart,
    cssSelector: value.cssSelector,
    attributes: {
      ...(value.attributes || {}),
      ...(className ? { class: className } : {}),
    },
    text: value.text,
    className,
    candidates: value.candidates,
  });

  const element = toElementJson(enriched);

  return {
    element,
    matchedLabel: String(value.matchedLabel || label),
  };
}
