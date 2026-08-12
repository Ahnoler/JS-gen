/**
 * Remote-bridge CDP input handling: ack, fill recording flush, mouse/key/text
 * dispatch and viewport resize handling.
 */
import { state } from '../../state.js';
import {
  bridge, pushAgentEvent, broadcastInspect, broadcastStatus,
} from './state.js';
import {
  highlightAt, resolvePayloadAt, suppressPageManualRecorder,
  resolveFocusedFillPayload, resolveCommittedDateFillPayload,
  snapshotDateEditorValues,
} from '../inspect.js';
import {
  restartScreencast, startScreencast, applyViewportOverride,
  syncViewportFromPage, persistViewport,
} from './screencast.js';
import {
  CLIPBOARD_GET_SELECTION_EXPRESSION,
  normalizeClipboardSelectionResult,
} from '../clipboard-selection.js';

/** Drop misclassified focus/open-picker clicks that slipped past BUILD_PAYLOAD. */
function isSpuriousFocusClickPayload(payload) {
  if (!payload || typeof payload !== 'object') return true;
  const kind = payload.kind || '';
  if (kind !== 'click' && kind !== 'click_menu_item') return false;
  const tag = String(payload.tag || '').toLowerCase();
  const text = String(payload.text || payload.menu_text || payload.button_text || '').trim();
  const cls = String(payload.attributes?.class || payload.attributes?.className || '');
  const xp = String(payload.bu_xpath || payload.xpath || payload.xpath_abs || '').trim();

  // Body-level teleport shell — never a real control (even if shortLabel stole a date string)
  if (/^(\/?div\[\d+\]|html\/body\/div\[\d+\])$/i.test(xp)) {
    return true;
  }
  // Date string clicks are reopen/picker noise, not buttons
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && (tag === 'div' || tag === 'span' || !cls)) {
    return true;
  }
  if (tag === 'input' || tag === 'textarea') {
    const type = String(payload.attributes?.type || '').trim().toLowerCase();
    if (!['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image'].includes(type)) {
      return true;
    }
  }
  if (/el-select|el-cascader|el-date-editor|el-time-picker|el-autocomplete|el-input|el-textarea|el-picker|el-popper/i.test(cls)) {
    return true;
  }
  if (/\/(input|textarea)(\[|$)/i.test(xp) && kind === 'click') {
    return true;
  }
  // Empty anonymous div/span with no identifying attrs
  if (!text && (tag === 'div' || tag === 'span') && !cls && !payload.attributes?.id) {
    return true;
  }
  return false;
}

export async function handleAck(payload) {
  // Producer already acks Chrome on receive; client ack is best-effort / legacy.
  if (!bridge.client || !bridge.screencastOn) return;
  const frameId = payload?.frameId ?? payload?.sessionId;
  if (frameId == null) return;
  try {
    await bridge.client.send('Page.screencastFrameAck', { sessionId: Number(frameId) });
  } catch {}
}

export async function flushFillRecord() {
  if (bridge.fillRecordTimer) {
    clearTimeout(bridge.fillRecordTimer);
    bridge.fillRecordTimer = null;
  }
  if (!bridge.client || !state.globalBrowser.manualRecording) return;
  try {
    const payload = await resolveFocusedFillPayload(bridge.client);
    if (payload) {
      pushAgentEvent('manual_dom_event', payload);
      broadcastInspect(payload.label_text || payload.value || 'fill');
    }
  } catch (e) {
    console.warn('[remote-bridge] fill record failed:', e.message);
  }
}

export async function handleInput(payload) {
  const kind = payload?.kind;

  if (kind === 'clipboard') {
    const requestId = payload.requestId || null;
    if (!bridge.client) {
      return {
        ok: false,
        clipboard: true,
        requestId,
        text: '',
        reason: 'not_attached',
      };
    }
    const action = String(payload.action || '');
    if (action !== 'getSelection') {
      return {
        clipboard: true,
        requestId,
        ok: false,
        text: '',
        reason: 'unknown_clipboard_action',
      };
    }
    try {
      const evaluated = await bridge.client.send('Runtime.evaluate', {
        expression: CLIPBOARD_GET_SELECTION_EXPRESSION,
        returnByValue: true,
      });
      const normalized = normalizeClipboardSelectionResult(evaluated?.result?.value);
      return {
        ok: normalized.ok,
        clipboard: true,
        requestId,
        text: normalized.text,
        reason: normalized.reason,
      };
    } catch (e) {
      return {
        clipboard: true,
        requestId,
        ok: false,
        text: '',
        reason: 'evaluate_error',
      };
    }
  }

  if (!bridge.client) return { ok: false, reason: 'not_attached' };

  const gb = state.globalBrowser;

  try {
    if (kind === 'mouse') {
      const x = Math.round((Number(payload.x) || 0) * bridge.viewport.w);
      const y = Math.round((Number(payload.y) || 0) * bridge.viewport.h);
      const type = payload.type || 'mousePressed';
      const button = payload.button || 'left';
      const clickCount = payload.clickCount || 1;

      // Hover highlight — allowed even when agent busy (view-only inspect)
      if (type === 'mouseMoved' && bridge.inspectEnabled && (payload.buttons == null || payload.buttons === 0)) {
        const now = Date.now();
        if (now - bridge.lastHighlightAt >= 80) {
          bridge.lastHighlightAt = now;
          try {
            await highlightAt(bridge.client, x, y);
          } catch {}
        }
        // Hover alone does not require inputEnabled
        if (gb.busy || payload.hoverOnly) return { ok: true, highlighted: true };
      }

      if (gb.busy) return { ok: false, reason: 'agent_busy' };

      // Scroll (waterfall / overflow containers)
      if (type === 'mouseWheel') {
        await bridge.client.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x,
          y,
          deltaX: Number(payload.deltaX) || 0,
          deltaY: Number(payload.deltaY) || 0,
        });
        return { ok: true };
      }

      // Flush pending fill BEFORE click resolves (leave field → one fill with final value)
      if (type === 'mousePressed' && state.globalBrowser.manualRecording) {
        await flushFillRecord();
      }

      // Record on press (before navigation) when manual recording is on
      if (type === 'mousePressed' && gb.manualRecording) {
        try {
          await suppressPageManualRecorder(bridge.client, 900);
          let recPayload = await resolvePayloadAt(bridge.client, x, y);
          if (recPayload && isSpuriousFocusClickPayload(recPayload)) {
            recPayload = null;
          }
          // Date day: confirm after click commits (year/month arrows steal focus → missing label at press)
          if (recPayload && (recPayload.kind === 'fill_date' || recPayload.kind === 'fill_date_pending')) {
            const beforeSnap = await snapshotDateEditorValues(bridge.client);
            bridge.pendingDateDayPick = { hint: recPayload, beforeSnap };
          } else if (recPayload && recPayload.kind !== 'fill') {
            bridge.pendingDateDayPick = null;
            const label = recPayload.text || recPayload.menu_text || recPayload.option_text
              || recPayload.button_text || recPayload.label_text || recPayload.value || recPayload.kind || '';
            broadcastInspect(label);
            pushAgentEvent('manual_dom_event', recPayload);
          }
        } catch (e) {
          console.warn('[remote-bridge] record-at-point failed:', e.message);
        }
      }

      if (type === 'mouseMoved' && payload.hoverOnly) {
        return { ok: true };
      }

      await bridge.client.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button,
        buttons: type === 'mouseReleased' ? 0 : (type === 'mouseMoved' ? (payload.buttons || 0) : 1),
        clickCount,
      });

      if ((type === 'mousePressed' || type === 'mouseReleased')
        && bridge.screencastOn && Date.now() - bridge.lastFrameAt > 800) {
        restartScreencast().catch(() => {});
      }

      // After day cell click applies, read which date field changed (multi-date forms)
      if (type === 'mouseReleased' && gb.manualRecording && bridge.pendingDateDayPick) {
        const pending = bridge.pendingDateDayPick;
        bridge.pendingDateDayPick = null;
        try {
          await new Promise((r) => setTimeout(r, 80));
          const hint = pending.hint || pending;
          const beforeSnap = pending.beforeSnap || null;
          let confirmed = await resolveCommittedDateFillPayload(bridge.client, hint, beforeSnap);
          if (!confirmed && hint.kind === 'fill_date' && hint.label_text && hint.value) {
            confirmed = { ...hint, kind: 'fill_date' };
          }
          if (confirmed && confirmed.kind === 'fill_date' && confirmed.label_text && confirmed.value) {
            broadcastInspect(confirmed.label_text + '=' + confirmed.value);
            pushAgentEvent('manual_dom_event', confirmed);
          }
        } catch (e) {
          console.warn('[remote-bridge] date confirm failed:', e.message);
        }
      }

      return { ok: true };
    }

    if (gb.busy) return { ok: false, reason: 'agent_busy' };

    if (kind === 'navigate') {
      const action = String(payload.action || '');
      if (action === 'reload') {
        await bridge.client.send('Page.reload', { ignoreCache: false });
        return { ok: true };
      }
      if (action === 'back' || action === 'forward') {
        const hist = await bridge.client.send('Page.getNavigationHistory');
        const entries = hist?.entries || [];
        const idx = Number(hist?.currentIndex);
        if (!Number.isFinite(idx) || !entries.length) return { ok: true, noop: true };
        const targetIdx = action === 'back' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= entries.length) return { ok: true, noop: true };
        const entry = entries[targetIdx];
        if (entry?.id == null) return { ok: true, noop: true };
        await bridge.client.send('Page.navigateToHistoryEntry', { entryId: entry.id });
        return { ok: true };
      }
      return { ok: false, reason: 'unknown_navigate_action' };
    }

    if (kind === 'key') {
      const params = {
        type: payload.type || 'keyDown',
        key: payload.key || '',
        code: payload.code || '',
        windowsVirtualKeyCode: payload.keyCode,
        nativeVirtualKeyCode: payload.keyCode,
        modifiers: payload.modifiers || 0,
      };
      await bridge.client.send('Input.dispatchKeyEvent', params);
      // Commit fill on Enter / Tab (leave field)
      if (
        gb.manualRecording
        && (payload.type === 'keyDown' || !payload.type)
        && (payload.key === 'Enter' || payload.key === 'Tab')
      ) {
        await flushFillRecord();
      }
      return { ok: true };
    }
    if (kind === 'text') {
      const text = String(payload.text || '');
      // Allow empty text when replace:true (clear field)
      if (!text && payload.replace !== true) return { ok: true };
      // Dedupe burst duplicates (e.g. double-bound window listeners)
      const now = Date.now();
      const sig = `${payload.replace === true ? 'R' : 'A'}:${text}`;
      if (sig === handleInput._lastTextSig && now - bridge.lastTypedTextAt < 25) {
        return { ok: true, deduped: true };
      }
      handleInput._lastTextSig = sig;
      bridge.lastTypedTextAt = now;

      if (payload.replace === true) {
        try {
          await bridge.client.send('Runtime.evaluate', {
            expression: `(() => {
              const el = document.activeElement;
              if (!el) return 'no-focus';
              if (el.isContentEditable) {
                const sel = window.getSelection();
                if (sel) {
                  const range = document.createRange();
                  range.selectNodeContents(el);
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
                return 'ok';
              }
              const tag = (el.tagName || '').toUpperCase();
              if (tag === 'INPUT' || tag === 'TEXTAREA') {
                el.select();
                return 'ok';
              }
              return 'not-editable';
            })()`,
            returnByValue: true,
          });
        } catch (e) {
          console.warn('[remote-bridge] text replace select failed:', e.message);
        }
      }

      // Single path: insertText only (do NOT also send keyDown with text)
      if (text) {
        await bridge.client.send('Input.insertText', { text });
      } else if (payload.replace === true) {
        // Clear selection via Backspace after select-all
        await bridge.client.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Backspace', code: 'Backspace',
          windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
        });
        await bridge.client.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Backspace', code: 'Backspace',
          windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
        });
      }
      // Mark that this field has pending edits; emit once on leave (click/Enter)
      if (gb.manualRecording) {
        if (bridge.fillRecordTimer) clearTimeout(bridge.fillRecordTimer);
        bridge.fillRecordTimer = setTimeout(() => { /* pending marker */ }, 60_000);
      }
      return { ok: true };
    }
    return { ok: false, reason: 'unknown_kind' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export async function handleViewport(payload) {
  if (!bridge.client) return;
  // Dashboard container resize alone must NOT Emulation-resize Chrome (causes crop + click offset).
  // Only resize when explicitly requested.
  if (payload?.resize === true) {
    const w = Number(payload?.viewportW || payload?.w);
    const h = Number(payload?.viewportH || payload?.h);
    const dpr = Number(payload?.dpr || payload?.deviceScaleFactor) || bridge.viewport.dpr;
    if (Number.isFinite(w) && w > 0) bridge.viewport.w = Math.round(w);
    if (Number.isFinite(h) && h > 0) bridge.viewport.h = Math.round(h);
    bridge.viewport.dpr = dpr;
    try {
      if (bridge.screencastOn) await bridge.client.send('Page.stopScreencast');
    } catch {}
    await applyViewportOverride();
    await startScreencast();
    broadcastStatus();
    return;
  }
  // Soft sync: re-read real page metrics (e.g. user resized Chrome window)
  await syncViewportFromPage();
  await persistViewport();
  broadcastStatus();
}
