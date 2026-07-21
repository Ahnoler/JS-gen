/**
 * Single-live Remote Browser bridge: CDP screencast + input for Session Chrome.
 */
import { CdpClient } from './client.js';
import { discoverCdpWithRetry } from './discover.js';
import { state } from '../state.js';
import { broadcast, broadcastBinary, onWsMessage } from '../ws-server.js';
import * as remoteSessionService from '../services/remote-session-service.js';
import { USE_EXECUTOR } from '../../config/config.js';
import { sendToExecutor } from '../executor-session-client.js';
import {
  enableInspect, highlightAt, hideHighlight, resolvePayloadAt, suppressPageManualRecorder,
  resolveFocusedFillPayload, resolveCommittedDateFillPayload, snapshotDateEditorValues,
} from './inspect.js';

/** Binary frame magic: Remote ScreenCast Frame */
const MAGIC = Buffer.from('RSCF');

/** Align with Session BrowserContextConfig (session_runner.py) */
const SESSION_VIEWPORT = { w: 1920, h: 1080, dpr: 1 };
const STREAM_MAX_W = 1920;
const STREAM_MAX_H = 1080;

let client = null;
let remoteSession = null;
let screencastOn = false;
let viewport = { ...SESSION_VIEWPORT };
let quality = 75;
/** @type {Set<import('ws').WebSocket>} */
const subscribers = new Set();
let wsHooked = false;
let lastHighlightAt = 0;
let lastInspectLabel = '';
let inspectEnabled = true;
let fillRecordTimer = null;
let lastTypedTextAt = 0;
/** @type {{ hint: object, beforeSnap: Array } | null} */
let pendingDateDayPick = null;
let lastFrameAt = 0;
let lastForwardAt = 0;
let stallTimer = null;
let restartingCast = false;
const MIN_FORWARD_MS = 33;
const STALL_RESTART_MS = 2500;

/** Called when Dashboard toggles manual recording — suppress page inject briefly. */
export function notifyManualRecordingChanged(enabled) {
  if (!enabled) return;
  if (client) {
    suppressPageManualRecorder(client, 1500).catch(() => {});
  }
}

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

export function getRemoteStatus() {
  const gb = state.globalBrowser;
  return {
    attached: !!client && screencastOn,
    remoteSessionId: remoteSession?.id ?? null,
    remoteSessionUuid: remoteSession?.sessionUuid ?? null,
    cdpReady: !!(gb.cdpWsUrl || gb.cdpHttp),
    cdpHttp: gb.cdpHttp || null,
    inputEnabled: !!(client && screencastOn && !gb.busy),
    agentBusy: !!gb.busy,
    manualRecording: !!gb.manualRecording,
    inspectEnabled,
    inspectLabel: lastInspectLabel || null,
    viewportW: viewport.w,
    viewportH: viewport.h,
  };
}

function pushAgentEvent(event, data = {}) {
  const gb = state.globalBrowser;
  if (!gb.stdin || !gb.ready) return false;
  try {
    gb.stdin.write(JSON.stringify({ event, data }) + '\n');
    return true;
  } catch (e) {
    console.warn('[remote-bridge] stdin write failed:', e.message);
    return false;
  }
}

function broadcastInspect(label) {
  lastInspectLabel = label || '';
  broadcast('remote:inspect', {
    label: lastInspectLabel || null,
    manualRecording: !!state.globalBrowser.manualRecording,
  });
}

function broadcastStatus() {
  broadcast('remote:status', getRemoteStatus());
}

/**
 * Refresh CDP endpoints onto globalBrowser (call after Agent ready).
 */
export async function refreshCdpEndpoints() {
  const gb = state.globalBrowser;
  const hit = await discoverCdpWithRetry({ attempts: 10, delayMs: 400 });
  if (hit) {
    gb.cdpHttp = hit.cdpHttp;
    gb.cdpWsUrl = hit.cdpWsUrl;
    gb.cdpPort = hit.port;
    console.log(`[remote-bridge] CDP ready ${hit.cdpHttp}`);
  } else {
    gb.cdpHttp = null;
    gb.cdpWsUrl = null;
    gb.cdpPort = null;
    console.warn('[remote-bridge] CDP endpoint not found (ports 9242/9222)');
  }
  broadcastStatus();
  return hit;
}

export function clearCdpEndpoints() {
  const gb = state.globalBrowser;
  gb.cdpHttp = null;
  gb.cdpWsUrl = null;
  gb.cdpPort = null;
  broadcastStatus();
}

/**
 * Read live CSS viewport from the page (do not invent dashboard canvas sizes).
 */
async function syncViewportFromPage() {
  if (!client) return viewport;
  try {
    const metrics = await client.send('Page.getLayoutMetrics');
    const css = metrics?.cssVisualViewport || metrics?.visualViewport || metrics?.cssLayoutViewport || metrics?.layoutViewport;
    const w = Math.round(Number(css?.clientWidth || css?.width) || 0);
    const h = Math.round(Number(css?.clientHeight || css?.height) || 0);
    if (w > 0) viewport.w = w;
    if (h > 0) viewport.h = h;
    const dpr = Number(css?.scale);
    if (Number.isFinite(dpr) && dpr > 0) viewport.dpr = dpr;
  } catch (e) {
    console.warn('[remote-bridge] getLayoutMetrics failed:', e.message);
  }
  return viewport;
}

/**
 * Restore Session full viewport (1920×1080). Clears leftover Emulation crops
 * from earlier dashboard-sized overrides; does NOT shrink to the Dashboard.
 */
async function ensureFullSessionViewport(targetId) {
  if (!client) return;
  try { await client.send('Emulation.clearDeviceMetricsOverride'); } catch {}

  // Grow OS window if possible (best-effort; may fail headless / some Chrome builds)
  try {
    const win = await client.send('Browser.getWindowForTarget', { targetId }, null);
    if (win?.windowId != null) {
      await client.send('Browser.setWindowBounds', {
        windowId: win.windowId,
        bounds: {
          width: SESSION_VIEWPORT.w + 16,
          height: SESSION_VIEWPORT.h + 88,
          windowState: 'normal',
        },
      }, null);
    }
  } catch (e) {
    console.warn('[remote-bridge] setWindowBounds skipped:', e.message);
  }

  viewport = { ...SESSION_VIEWPORT };
  await applyViewportOverride();
  await syncViewportFromPage();
  // If metrics still report something tiny, force Session size again
  if (viewport.w < SESSION_VIEWPORT.w * 0.9 || viewport.h < SESSION_VIEWPORT.h * 0.9) {
    viewport = { ...SESSION_VIEWPORT };
    await applyViewportOverride();
  }
  console.log(`[remote-bridge] session viewport ${viewport.w}×${viewport.h}`);
}

/**
 * Attach to live Session Chrome, open remote_session row, start screencast.
 * Default: restore full Session viewport (1920×1080), never shrink to Dashboard.
 * Pass `{ resize: true, viewportW, viewportH }` only when intentionally resizing.
 */
export async function attachLive(opts = {}) {
  const gb = state.globalBrowser;
  if (!gb.ready) throw new Error('Session browser not ready');
  if (client) await detachLive();

  // Always re-probe — port may appear after first failed discover, or URL may be stale
  await refreshCdpEndpoints();
  if (!gb.cdpWsUrl) throw new Error('CDP WebSocket URL unavailable (is Session Chrome on 9242/9222?)');

  quality = Math.min(95, Math.max(40, Number(opts.quality) || 75));
  const wantResize = opts.resize === true;

  client = new CdpClient();
  try {
    await client.connect(gb.cdpWsUrl);

    const pages = await client.listPageTargets();
    if (!pages.length) throw new Error('No page target on CDP browser');
    // Prefer newest usable page (last) so leftover homepage tabs are not streamed by default
    const usable = pages.filter((p) => {
      const u = p.url || '';
      return !u.startsWith('devtools://') && !u.startsWith('chrome-extension://');
    });
    const page = (usable.length ? usable[usable.length - 1] : null)
      || pages.find((p) => !p.url?.startsWith('devtools://'))
      || pages[0];
    await client.attachToTarget(page.targetId);

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    try {
      await enableInspect(client);
    } catch (e) {
      console.warn('[remote-bridge] Overlay/DOM enable failed:', e.message);
    }

    if (wantResize) {
      viewport = {
        w: Math.max(320, Number(opts.viewportW) || SESSION_VIEWPORT.w),
        h: Math.max(240, Number(opts.viewportH) || SESSION_VIEWPORT.h),
        dpr: Number(opts.deviceScaleFactor) || Number(opts.dpr) || 1,
      };
      await applyViewportOverride();
    } else {
      await ensureFullSessionViewport(page.targetId);
    }

    remoteSession = await remoteSessionService.openSession({
      browserContextId: page.browserContextId || '',
      targetId: page.targetId,
      isolation: 'target',
      viewportW: viewport.w,
      viewportH: viewport.h,
      deviceScaleFactor: viewport.dpr,
      url: page.url || '',
    });

    client.on('Page.screencastFrame', onScreencastFrame);
    client.on('Client.disconnected', () => {
      clearStallWatch();
      screencastOn = false;
      broadcastStatus();
    });

    await startScreencast();
  } catch (err) {
    try { await client.close(); } catch {}
    client = null;
    screencastOn = false;
    if (remoteSession?.id) {
      try { await remoteSessionService.closeSession(remoteSession.id, { crashed: true }); } catch {}
      remoteSession = null;
    }
    throw err;
  }
  ensureWsHook();
  broadcastStatus();
  return { remoteSession, status: getRemoteStatus() };
}

export async function detachLive({ crashed = false } = {}) {
  clearStallWatch();
  screencastOn = false;
  if (client) {
    try { await client.send('Page.stopScreencast'); } catch {}
    try { await client.close(); } catch {}
    client = null;
  }
  if (remoteSession?.id) {
    try {
      await remoteSessionService.closeSession(remoteSession.id, { crashed });
    } catch (e) {
      console.warn('[remote-bridge] closeSession failed:', e.message);
    }
  }
  const closedId = remoteSession?.id ?? null;
  remoteSession = null;
  subscribers.clear();
  lastInspectLabel = '';
  broadcastStatus();
  return { closedId, status: getRemoteStatus() };
}

async function applyViewportOverride() {
  if (!client) return;
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.w,
    height: viewport.h,
    deviceScaleFactor: viewport.dpr,
    mobile: false,
  });
  if (remoteSession?.id) {
    await remoteSessionService.updateViewport(remoteSession.id, {
      viewportW: viewport.w,
      viewportH: viewport.h,
      deviceScaleFactor: viewport.dpr,
    });
  }
}

async function persistViewport() {
  if (!remoteSession?.id) return;
  try {
    await remoteSessionService.updateViewport(remoteSession.id, {
      viewportW: viewport.w,
      viewportH: viewport.h,
      deviceScaleFactor: viewport.dpr,
    });
  } catch {}
}

function clearStallWatch() {
  if (stallTimer) {
    clearInterval(stallTimer);
    stallTimer = null;
  }
}

function armStallWatch() {
  clearStallWatch();
  stallTimer = setInterval(() => {
    if (!screencastOn || !client) return;
    if (Date.now() - lastFrameAt > STALL_RESTART_MS) {
      restartScreencast().catch(() => {});
    }
  }, 1000);
}

async function restartScreencast() {
  if (!client || restartingCast) return;
  restartingCast = true;
  try {
    try { await client.send('Page.stopScreencast'); } catch {}
    screencastOn = false;
    await startScreencast();
  } catch (e) {
    console.warn('[remote-bridge] restartScreencast failed:', e.message);
  } finally {
    restartingCast = false;
  }
}

async function startScreencast() {
  if (!client) return;
  // Encode at session viewport (typically 1920×1080) for clarity.
  const maxW = Math.min(Math.max(viewport.w, SESSION_VIEWPORT.w), STREAM_MAX_W);
  const maxH = Math.min(Math.max(viewport.h, SESSION_VIEWPORT.h), STREAM_MAX_H);
  await client.send('Page.startScreencast', {
    format: 'jpeg',
    quality,
    maxWidth: maxW,
    maxHeight: maxH,
    everyNthFrame: 1,
  });
  screencastOn = true;
  lastFrameAt = Date.now();
  armStallWatch();
}

function onScreencastFrame(params) {
  if (!screencastOn || !remoteSession) return;
  const sessionId = params.sessionId;
  // Ack Chrome immediately — never wait for dashboard round-trip (stalls video while input still works).
  if (sessionId != null) {
    client?.send('Page.screencastFrameAck', { sessionId: Number(sessionId) }).catch(() => {});
  }
  lastFrameAt = Date.now();

  const dataB64 = params.data;
  if (!dataB64) return;

  const now = Date.now();
  if (now - lastForwardAt < MIN_FORWARD_MS) return;
  lastForwardAt = now;

  const metadata = params.metadata || {};
  // Keep coordinate space aligned with the live page (CSS px).
  const dw = Number(metadata.deviceWidth);
  const dh = Number(metadata.deviceHeight);
  if (Number.isFinite(dw) && dw > 0) viewport.w = Math.round(dw);
  if (Number.isFinite(dh) && dh > 0) viewport.h = Math.round(dh);
  try {
    const jpeg = Buffer.from(dataB64, 'base64');
    const uuidBuf = Buffer.from(String(remoteSession.sessionUuid), 'utf8');
    const header = Buffer.alloc(4 + 4 + 2 + uuidBuf.length);
    MAGIC.copy(header, 0);
    header.writeUInt32BE(Number(sessionId) >>> 0, 4);
    header.writeUInt16BE(uuidBuf.length, 8);
    uuidBuf.copy(header, 10);
    const packet = Buffer.concat([header, jpeg]);

    if (subscribers.size) {
      for (const ws of subscribers) {
        if (ws.readyState !== 1) continue;
        if ((ws.bufferedAmount || 0) > 2 * 1024 * 1024) continue;
        try { ws.send(packet); } catch {}
      }
    } else {
      broadcastBinary(packet);
    }
  } catch (e) {
    console.warn('[remote-bridge] frame encode failed:', e.message);
  }
}

/**
 * Pack/parse helpers exported for tests / docs
 */
export function parseRemoteFrame(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 10) return null;
  if (buf.subarray(0, 4).toString('utf8') !== 'RSCF') return null;
  const frameId = buf.readUInt32BE(4);
  const uuidLen = buf.readUInt16BE(8);
  const sessionUuid = buf.subarray(10, 10 + uuidLen).toString('utf8');
  const jpeg = buf.subarray(10 + uuidLen);
  return { frameId, sessionUuid, jpeg };
}

async function handleAck(payload) {
  // Producer already acks Chrome on receive; client ack is best-effort / legacy.
  if (!client || !screencastOn) return;
  const frameId = payload?.frameId ?? payload?.sessionId;
  if (frameId == null) return;
  try {
    await client.send('Page.screencastFrameAck', { sessionId: Number(frameId) });
  } catch {}
}

async function flushFillRecord() {
  if (fillRecordTimer) {
    clearTimeout(fillRecordTimer);
    fillRecordTimer = null;
  }
  if (!client || !state.globalBrowser.manualRecording) return;
  try {
    const payload = await resolveFocusedFillPayload(client);
    if (payload) {
      pushAgentEvent('manual_dom_event', payload);
      broadcastInspect(payload.label_text || payload.value || 'fill');
    }
  } catch (e) {
    console.warn('[remote-bridge] fill record failed:', e.message);
  }
}

async function handleInput(payload) {
  if (!client) return { ok: false, reason: 'not_attached' };

  const kind = payload?.kind;
  const gb = state.globalBrowser;

  try {
    if (kind === 'mouse') {
      const x = Math.round((Number(payload.x) || 0) * viewport.w);
      const y = Math.round((Number(payload.y) || 0) * viewport.h);
      const type = payload.type || 'mousePressed';
      const button = payload.button || 'left';
      const clickCount = payload.clickCount || 1;

      // Hover highlight — allowed even when agent busy (view-only inspect)
      if (type === 'mouseMoved' && inspectEnabled && (payload.buttons == null || payload.buttons === 0)) {
        const now = Date.now();
        if (now - lastHighlightAt >= 80) {
          lastHighlightAt = now;
          try {
            await highlightAt(client, x, y);
          } catch {}
        }
        // Hover alone does not require inputEnabled
        if (gb.busy || payload.hoverOnly) return { ok: true, highlighted: true };
      }

      if (gb.busy) return { ok: false, reason: 'agent_busy' };

      // Scroll (waterfall / overflow containers)
      if (type === 'mouseWheel') {
        await client.send('Input.dispatchMouseEvent', {
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
          await suppressPageManualRecorder(client, 900);
          let recPayload = await resolvePayloadAt(client, x, y);
          if (recPayload && isSpuriousFocusClickPayload(recPayload)) {
            recPayload = null;
          }
          // Date day: confirm after click commits (year/month arrows steal focus → missing label at press)
          if (recPayload && (recPayload.kind === 'fill_date' || recPayload.kind === 'fill_date_pending')) {
            const beforeSnap = await snapshotDateEditorValues(client);
            pendingDateDayPick = { hint: recPayload, beforeSnap };
          } else if (recPayload && recPayload.kind !== 'fill') {
            pendingDateDayPick = null;
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

      await client.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button,
        buttons: type === 'mouseReleased' ? 0 : (type === 'mouseMoved' ? (payload.buttons || 0) : 1),
        clickCount,
      });

      if ((type === 'mousePressed' || type === 'mouseReleased')
        && screencastOn && Date.now() - lastFrameAt > 800) {
        restartScreencast().catch(() => {});
      }

      // After day cell click applies, read which date field changed (multi-date forms)
      if (type === 'mouseReleased' && gb.manualRecording && pendingDateDayPick) {
        const pending = pendingDateDayPick;
        pendingDateDayPick = null;
        try {
          await new Promise((r) => setTimeout(r, 80));
          const hint = pending.hint || pending;
          const beforeSnap = pending.beforeSnap || null;
          let confirmed = await resolveCommittedDateFillPayload(client, hint, beforeSnap);
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
        await client.send('Page.reload', { ignoreCache: false });
        return { ok: true };
      }
      if (action === 'back' || action === 'forward') {
        const hist = await client.send('Page.getNavigationHistory');
        const entries = hist?.entries || [];
        const idx = Number(hist?.currentIndex);
        if (!Number.isFinite(idx) || !entries.length) return { ok: true, noop: true };
        const targetIdx = action === 'back' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= entries.length) return { ok: true, noop: true };
        const entry = entries[targetIdx];
        if (entry?.id == null) return { ok: true, noop: true };
        await client.send('Page.navigateToHistoryEntry', { entryId: entry.id });
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
      await client.send('Input.dispatchKeyEvent', params);
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
      if (!text) return { ok: true };
      // Dedupe burst duplicates (e.g. double-bound window listeners)
      const now = Date.now();
      const sig = text;
      if (sig === handleInput._lastTextSig && now - lastTypedTextAt < 25) {
        return { ok: true, deduped: true };
      }
      handleInput._lastTextSig = sig;
      lastTypedTextAt = now;

      // Single path: insertText only (do NOT also send keyDown with text)
      await client.send('Input.insertText', { text });
      // Mark that this field has pending edits; emit once on leave (click/Enter)
      if (gb.manualRecording) {
        if (fillRecordTimer) clearTimeout(fillRecordTimer);
        fillRecordTimer = setTimeout(() => { /* pending marker */ }, 60_000);
      }
      return { ok: true };
    }
    return { ok: false, reason: 'unknown_kind' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function handleViewport(payload) {
  if (!client) return;
  // Dashboard container resize alone must NOT Emulation-resize Chrome (causes crop + click offset).
  // Only resize when explicitly requested.
  if (payload?.resize === true) {
    const w = Number(payload?.viewportW || payload?.w);
    const h = Number(payload?.viewportH || payload?.h);
    const dpr = Number(payload?.dpr || payload?.deviceScaleFactor) || viewport.dpr;
    if (Number.isFinite(w) && w > 0) viewport.w = Math.round(w);
    if (Number.isFinite(h) && h > 0) viewport.h = Math.round(h);
    viewport.dpr = dpr;
    try {
      if (screencastOn) await client.send('Page.stopScreencast');
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

function ensureWsHook() {
  if (wsHooked) return;
  wsHooked = true;
  onWsMessage(async (ws, msg) => {
    const type = msg?.type;
    if (!type || !String(type).startsWith('remote:')) return;

    // Executor mode: proxy remote_* WS commands to executor bib bridge.
    if (USE_EXECUTOR) {
      const live = await remoteSessionService.getLiveStatus().catch(() => null);
      // Prefer the session that attachLive bound; fall back to first executor session.
      const boundId = remoteSessionService.getExecutorLiveSessionId?.() || null;
      let pick = boundId && state.sessions.get(boundId)?.useExecutor
        ? state.sessions.get(boundId)
        : null;
      if (!pick) {
        pick = [...state.sessions.values()].find((s) => s?.useExecutor && s?.executorNodeUuid && s?.sessionId);
      }
      if (type === 'remote:subscribe') {
        ws.send(JSON.stringify({ type: 'remote:status', payload: live || { attached: false, cdpReady: true } }));
        return;
      }
      if (type === 'remote:unsubscribe') return;

      if (!pick) {
        if (type === 'remote:status') {
          ws.send(JSON.stringify({ type: 'remote:status', payload: { attached: false, cdpReady: true } }));
        }
        return;
      }

      const { executorNodeUuid, sessionId } = pick;

      try {
        if (type === 'remote:start') {
          sendToExecutor(executorNodeUuid, 'session.bib_start', { sessionId });
        } else if (type === 'remote:stop') {
          sendToExecutor(executorNodeUuid, 'session.bib_stop', { sessionId });
        } else if (type === 'remote:ack') {
          sendToExecutor(executorNodeUuid, 'session.bib_ack', { sessionId, ...(msg.payload || {}) });
        } else if (type === 'remote:input') {
          sendToExecutor(executorNodeUuid, 'session.bib_input', { sessionId, ...(msg.payload || {}) });
        } else if (type === 'remote:tabs') {
          sendToExecutor(executorNodeUuid, 'session.bib_tabs', { sessionId });
        } else if (type === 'remote:switch_tab') {
          sendToExecutor(executorNodeUuid, 'session.bib_switch_tab', {
            sessionId,
            targetId: msg.payload?.targetId,
            url: msg.payload?.url,
            pageId: msg.payload?.pageId,
          });
        } else if (type === 'remote:viewport') {
          // viewport resize is handled at attach-time; ignore for now
        } else if (type === 'remote:inspect') {
          // optional inspect ignored in minimal executor bib bridge
        } else if (type === 'remote:status') {
          // below
        }
      } catch {}

      if (
        type === 'remote:start'
        || type === 'remote:stop'
        || type === 'remote:status'
        || type === 'remote:tabs'
        || type === 'remote:switch_tab'
      ) {
        const live2 = await remoteSessionService.getLiveStatus().catch(() => null);
        ws.send(JSON.stringify({ type: 'remote:status', payload: live2 || { attached: false, cdpReady: true } }));
      }
      return;
    }

    if (type === 'remote:subscribe') {
      subscribers.add(ws);
      ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
      return;
    }
    if (type === 'remote:unsubscribe') {
      subscribers.delete(ws);
      return;
    }
    if (type === 'remote:start') {
      try {
        subscribers.add(ws);
        if (!client) {
          // Never pass dashboard canvas size as Chrome viewport unless resize:true
          await attachLive(msg.payload || {});
        } else if (!screencastOn) {
          await startScreencast();
        } else if (msg.payload?.resize === true) {
          await handleViewport(msg.payload);
        }
        ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'remote:error', payload: { message: e.message } }));
      }
      return;
    }
    if (type === 'remote:stop') {
      subscribers.delete(ws);
      if (subscribers.size === 0 && client) {
        try { await client.send('Page.stopScreencast'); } catch {}
        screencastOn = false;
      }
      broadcastStatus();
      return;
    }
    if (type === 'remote:ack') {
      await handleAck(msg.payload || {});
      return;
    }
    if (type === 'remote:input') {
      const result = await handleInput(msg.payload || {});
      if (!result.ok && result.reason === 'agent_busy') {
        ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
      }
      return;
    }
    if (type === 'remote:inspect') {
      // Optional explicit inspect toggle / one-shot
      const p = msg.payload || {};
      if (typeof p.enabled === 'boolean') inspectEnabled = p.enabled;
      if (p.clear) {
        if (client) await hideHighlight(client);
        broadcastInspect('');
      }
      ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
      return;
    }
    if (type === 'remote:viewport') {
      await handleViewport(msg.payload || {});
      return;
    }
    if (type === 'remote:status') {
      ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
    }
  });
}

/** Call once from route registration so WS handlers exist even before attach */
export function initRemoteBridgeWs() {
  ensureWsHook();
}
