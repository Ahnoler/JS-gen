/**
 * Resolve Element UI form control by label_text via CDP Runtime.evaluate.
 * Returns ElementJson-compatible shape for trajectory_step.element_json.
 */
import { toElementJson } from '../models/element.js';

/**
 * Page-side script: find .el-form-item by label text, return locator snapshot.
 * @param {string} labelText
 */
export function buildResolveByLabelExpression(labelText) {
  const labelJs = JSON.stringify(String(labelText || '').trim());
  return `(() => {
    const want = ${labelJs};
    if (!want) return null;

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
    function cssOf(node) {
      if (!node || node.nodeType !== 1) return '';
      if (node.id) return '#' + CSS.escape(node.id);
      const tag = node.tagName.toLowerCase();
      const cls = String(node.className || '')
        .split(/\\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((c) => '.' + CSS.escape(c))
        .join('');
      return tag + cls;
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

    const items = Array.from(document.querySelectorAll('.el-form-item'));
    let matched = null;
    for (const item of items) {
      if (item.offsetParent === null && getComputedStyle(item).display === 'none') continue;
      const label = formItemLabel(item);
      if (!label) continue;
      if (label === want || label.includes(want) || want.includes(label)) {
        matched = { item, label };
        if (label === want) break;
      }
    }
    if (!matched) return null;

    const el = pickControl(matched.item);
    if (!el) return null;
    const attrs = {};
    try {
      for (const a of el.attributes || []) {
        if (a && a.name) attrs[a.name] = a.value;
      }
    } catch {}
    const text = String(el.innerText || el.value || el.textContent || '').trim().slice(0, 120);
    return {
      matchedLabel: matched.label,
      tag: el.tagName ? el.tagName.toLowerCase() : '',
      xpath: xpathOf(el),
      cssSelector: cssOf(el),
      attributes: attrs,
      text,
      className: String(el.className || attrs.class || ''),
    };
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
    const err = new Error(`No form field found for label: ${label}`);
    err.statusCode = 404;
    throw err;
  }

  const className = String(value.className || value.attributes?.class || '').trim();
  const element = toElementJson({
    tag: value.tag,
    xpath: value.xpath,
    cssSelector: value.cssSelector,
    attributes: {
      ...(value.attributes || {}),
      ...(className ? { class: className } : {}),
    },
    text: value.text,
  });

  return {
    element,
    matchedLabel: String(value.matchedLabel || label),
  };
}
