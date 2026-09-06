/**
 * CDP DOM inspect helpers: highlight under cursor + resolve element meta for recording.
 */
import { PAGE_LOCATOR_HELPERS } from './locator-candidates.js';
import { BUILD_PAYLOAD_FN } from './inspect-payload-script.js';

const HIGHLIGHT_CONFIG = {
  showInfo: false,
  showRulers: false,
  showExtensionLines: false,
  contentColor: { r: 111, g: 168, b: 220, a: 0.35 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.4 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.7 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.35 },
};

/**
 * Page-side function: build manual-recorder-compatible payload from an element.
 * Optional args: clientX, clientY — used to pierce anonymous body overlays via elementsFromPoint.
 */

/**
 * Enable DOM, Overlay, and Runtime CDP domains for inspect mode.
 * @param {import('./client.js').CdpClient} client CDP client.
 * @returns {Promise<void>}
 */
export async function enableInspect(client) {
  await client.send('DOM.enable');
  await client.send('Overlay.enable');
  await client.send('Runtime.enable');
}

/**
 * Highlight the DOM node at the given CSS coordinates.
 * @param {import('./client.js').CdpClient} client CDP client.
 * @param {number} x CSS px.
 * @param {number} y CSS px.
 * @returns {Promise<{ nodeId: number|null, backendNodeId: number|null, frameId: string|null }|null>} Located node ids, or null if nothing found.
 */
export async function highlightAt(client, x, y) {
  const loc = await client.send('DOM.getNodeForLocation', {
    x: Math.round(x),
    y: Math.round(y),
    includeUserAgentShadowDOM: true,
  });
  const nodeId = loc?.nodeId;
  const backendNodeId = loc?.backendNodeId;
  if (!nodeId && !backendNodeId) {
    try { await client.send('Overlay.hideHighlight'); } catch {}
    return null;
  }
  const highlightConfig = HIGHLIGHT_CONFIG;
  if (nodeId) {
    await client.send('Overlay.highlightNode', { nodeId, highlightConfig });
  } else {
    await client.send('Overlay.highlightNode', { backendNodeId, highlightConfig });
  }
  return { nodeId: nodeId || null, backendNodeId: backendNodeId || null, frameId: loc.frameId || null };
}

/**
 * Hide any active overlay highlight.
 * @param {import('./client.js').CdpClient} client CDP client.
 * @returns {Promise<void>}
 */
export async function hideHighlight(client) {
  try { await client.send('Overlay.hideHighlight'); } catch {}
}

/**
 * Resolve element under (x,y) into a manual_recorder payload.
 * @param {import('./client.js').CdpClient} client CDP client.
 * @param {number} x CSS px.
 * @param {number} y CSS px.
 * @returns {Promise<object|null>} Recorder payload, or null if unresolved.
 */
export async function resolvePayloadAt(client, x, y) {
  const loc = await client.send('DOM.getNodeForLocation', {
    x: Math.round(x),
    y: Math.round(y),
    includeUserAgentShadowDOM: true,
  });
  if (!loc?.backendNodeId && !loc?.nodeId) return null;

  let objectId = null;
  try {
    const resolved = await client.send('DOM.resolveNode', {
      backendNodeId: loc.backendNodeId || undefined,
      nodeId: loc.nodeId || undefined,
    });
    objectId = resolved?.object?.objectId;
  } catch {
    return null;
  }
  if (!objectId) return null;

  const result = await client.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: BUILD_PAYLOAD_FN,
    arguments: [
      { value: Math.round(x) },
      { value: Math.round(y) },
    ],
    returnByValue: true,
  });
  const payload = result?.result?.value;
  if (!payload || typeof payload !== 'object') return null;
  payload.client_x = Math.round(x);
  payload.client_y = Math.round(y);
  return payload;
}

/**
 * Briefly suppress page-injected manual recorder to avoid double-counting BiB clicks.
 * @param {import('./client.js').CdpClient} client CDP client.
 * @param {number} [ms] Suppression window in milliseconds.
 * @returns {Promise<void>}
 */
export async function suppressPageManualRecorder(client, ms = 600) {
  try {
    await client.send('Runtime.evaluate', {
      expression: `window.__jsgenManualSkipUntil = Date.now() + ${Number(ms) || 600}`,
      returnByValue: true,
    });
  } catch {}
}

/**
 * Snapshot the focused input/textarea as a fill / fill_date payload for recording.
 * @param {import('./client.js').CdpClient} client CDP client.
 * @returns {Promise<object|null>} Fill payload, or null if no valid focused input.
 */
export async function resolveFocusedFillPayload(client) {
  try {
    const result = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.activeElement;
        if (!el) return null;
        const tag = (el.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') return null;
        if (el.closest && el.closest('.el-select')) return null;
        // Date values come from picker day clicks, not focus flush (often still empty).
        // TODO(date-leave-backup): 离开日期框点到其他字段时，若 input 已有非空值则补录
        // fill_date（选天路径漏记时的兜底）。等端到端/用户反馈需要再做；注意与打开空选择器、
        // 重复选同一日期的去重配合，避免误记/双记。
        if (el.closest && el.closest('.el-date-editor')) return null;
        const item = el.closest && el.closest('.el-form-item');
        const lbl = item && item.querySelector('.el-form-item__label');
        const phText = (el.getAttribute && el.getAttribute('placeholder')) || '';
        const label = (lbl && lbl.textContent || '').trim().replace(/[：:*\\s]+$/g, '')
          || (phText || '').replace(/^请输入/, '').replace(/[：:*\\s]+$/g, '').trim();
        const value = el.value || '';
        if (!String(value).trim()) return null;
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
        return {
          kind: 'fill',
          label_text: label,
          value: value,
          xpath: xpathOf(el),
          bu_xpath: '',
          xpath_abs: xpathOf(el),
          tag: tag,
          attributes: {},
          text: String(value).slice(0, 80),
          source_channel: 'cdp_bib',
        };
      })()`,
      returnByValue: true,
      awaitPromise: false,
    });
    const payload = result?.result?.value;
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.label_text && !payload.xpath) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Snapshot all visible date editors: [{label, value, xpath}].
 * Used to detect which field changed after a picker day click (multi-date forms).
 * @param {import('./client.js').CdpClient} client CDP client.
 * @returns {Promise<Array<{label: string, value: string, xpath: string, active: boolean}>>} Visible date editor rows (empty on error).
 */
export async function snapshotDateEditorValues(client) {
  try {
    const result = await client.send('Runtime.evaluate', {
      expression: `(() => {
        function formItemLabel(node) {
          const item = node && node.closest && node.closest('.el-form-item');
          if (!item) return '';
          const lbl = item.querySelector('.el-form-item__label');
          return (lbl && lbl.textContent || '').trim().replace(/[：:*\\s]+$/g, '');
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
        const out = [];
        const eds = document.querySelectorAll('.el-date-editor');
        for (const ed of eds) {
          if (ed.offsetParent === null) continue;
          const input = ed.querySelector('input');
          const label = formItemLabel(ed);
          if (!label && !input) continue;
          out.push({
            label: label,
            value: String((input && input.value) || '').trim(),
            xpath: xpathOf(input || ed),
            active: !!(ed.classList.contains('is-active')
              || (input && input.getAttribute('aria-expanded') === 'true')
              || (input && input === document.activeElement)),
          });
        }
        return out;
      })()`,
      returnByValue: true,
      awaitPromise: false,
    });
    const rows = result?.result?.value;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * After a date-picker day click commits, resolve which date field changed.
 * @param {import('./client.js').CdpClient} client CDP client.
 * @param {{ label_text?: string, value?: string } | null} [hint] Picker hint (label/value).
 * @param {Array<{label?: string, value?: string, xpath?: string}> | null} [beforeSnap] Pre-click date-editor snapshot.
 * @returns {Promise<object|null>} fill_date payload, or null if unresolved.
 */
export async function resolveCommittedDateFillPayload(client, hint = null, beforeSnap = null) {
  try {
    const afterSnap = await snapshotDateEditorValues(client);
    const hintLabel = hint?.label_text ? String(hint.label_text).trim() : '';
    const hintValue = hint?.value ? String(hint.value).trim() : '';
    const before = Array.isArray(beforeSnap) ? beforeSnap : [];

    // 1) Prefer the editor whose value changed vs pre-click snapshot
    if (before.length && afterSnap.length) {
      const beforeMap = new Map(before.map((r) => [r.label || r.xpath || '', r]));
      const changed = [];
      for (const row of afterSnap) {
        const key = row.label || row.xpath || '';
        const prev = beforeMap.get(key);
        const prevVal = prev ? String(prev.value || '').trim() : '';
        const nextVal = String(row.value || '').trim();
        if (nextVal && nextVal !== prevVal) {
          changed.push(row);
        }
      }
      // Prefer change that matches constructed picker date when available
      let pick = null;
      if (hintValue) {
        pick = changed.find((r) => r.value === hintValue) || null;
      }
      if (!pick && changed.length === 1) pick = changed[0];
      if (!pick && changed.length > 1) {
        pick = changed.find((r) => r.active) || changed[changed.length - 1];
      }
      if (pick && pick.label && pick.value) {
        return {
          kind: 'fill_date',
          label_text: pick.label,
          value: pick.value,
          xpath: pick.xpath || '',
          bu_xpath: '',
          xpath_abs: pick.xpath || '',
          tag: 'input',
          attributes: {},
          text: String(pick.value).slice(0, 80),
          source_channel: 'cdp_bib',
        };
      }
    }

    // 2) Fallback: live active editor / hint match (never blindly use first editor)
    const hintLabelJs = JSON.stringify(hintLabel);
    const hintValueJs = JSON.stringify(hintValue);
    const result = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const hintLabel = ${hintLabelJs};
        const hintValue = ${hintValueJs};
        function formItemLabel(node) {
          const item = node && node.closest && node.closest('.el-form-item');
          if (!item) return '';
          const lbl = item.querySelector('.el-form-item__label');
          return (lbl && lbl.textContent || '').trim().replace(/[：:*\\s]+$/g, '');
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
        const pool = Array.from(document.querySelectorAll('.el-date-editor')).filter((ed) => ed.offsetParent !== null);
        let editor = document.querySelector('.el-date-editor.is-active');
        if (!editor) {
          for (const ed of pool) {
            const inp = ed.querySelector('input');
            if (inp && inp.getAttribute('aria-expanded') === 'true') { editor = ed; break; }
          }
        }
        if (!editor && hintValue) {
          const matches = pool.filter((ed) => String((ed.querySelector('input') || {}).value || '').trim() === hintValue);
          if (matches.length === 1) editor = matches[0];
          else if (hintLabel) editor = matches.find((ed) => formItemLabel(ed) === hintLabel) || null;
        }
        if (!editor && hintLabel) {
          editor = pool.find((ed) => formItemLabel(ed) === hintLabel) || null;
        }
        if (!editor) {
          try {
            if (window.__jsgenActiveDateEditor && document.contains(window.__jsgenActiveDateEditor)) {
              editor = window.__jsgenActiveDateEditor;
            }
          } catch (e) {}
        }
        if (!editor) return null;
        try { window.__jsgenActiveDateEditor = editor; } catch (e) {}
        const input = editor.querySelector('input');
        const value = String((input && input.value) || hintValue || '').trim();
        const label = formItemLabel(editor) || hintLabel;
        if (!value || !label) return null;
        return {
          kind: 'fill_date',
          label_text: label,
          value: value,
          xpath: xpathOf(input || editor),
          bu_xpath: '',
          xpath_abs: xpathOf(input || editor),
          tag: 'input',
          attributes: {},
          text: value.slice(0, 80),
          source_channel: 'cdp_bib',
        };
      })()`,
      returnByValue: true,
      awaitPromise: false,
    });
    const payload = result?.result?.value;
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.label_text || !payload.value) return null;
    return payload;
  } catch {
    return null;
  }
}
