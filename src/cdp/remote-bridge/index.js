/**
 * Single-live Remote Browser bridge: CDP screencast + input for Session Chrome.
 * Keeps all public exports + module state; delegates blocks to sibling modules:
 *   state.js      — shared mutable state + status/event helpers
 *   screencast.js — screencast lifecycle, frame fan-out, viewport override
 *   cdp-input.js  — CDP input handling (ack/fill/input/viewport)
 *   ws-router.js  — WS remote:* message router + BiB target resolution
 */
import { CdpClient } from '../client.js';
import { discoverCdpWithRetry } from '../discover.js';
import { state } from '../../state.js';
import * as remoteSessionService from '../../services/remote-session-service.js';
import { enableInspect, suppressPageManualRecorder } from '../inspect.js';
import { resolveElementByLabel } from '../resolve-by-label.js';
import {
  bridge, SESSION_VIEWPORT, getRemoteStatus, broadcastStatus,
} from './state.js';
import {
  startScreencast, onScreencastFrame, clearStallWatch, applyViewportOverride,
  ensureFullSessionViewport,
} from './screencast.js';
import { ensureWsHook, resolveBibTarget } from './ws-router.js';

export { getRemoteStatus, resolveBibTarget };

/**
 * Return the currently attached CDP client, or null when not attached.
 * @returns {import('../client.js').CdpClient|null} Attached CDP client, or null.
 */
export function getAttachedCdpClient() {
  return bridge.client || null;
}

/**
 * Called when Dashboard toggles manual recording — suppress page inject briefly.
 * @param {boolean} enabled True when manual recording was turned on.
 * @returns {void}
 */
export function notifyManualRecordingChanged(enabled) {
  if (!enabled) return;
  if (bridge.client) {
    suppressPageManualRecorder(bridge.client, 1500).catch(() => {});
  }
}

/**
 * Refresh CDP endpoints onto globalBrowser (call after Agent ready).
 * @returns {Promise<{ cdpHttp: string, cdpWsUrl: string, browser: string, port: number }|null>} Discovery hit, or null when not found.
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

/**
 * Clear CDP endpoints on globalBrowser and broadcast status.
 * @returns {void}
 */
export function clearCdpEndpoints() {
  const gb = state.globalBrowser;
  gb.cdpHttp = null;
  gb.cdpWsUrl = null;
  gb.cdpPort = null;
  broadcastStatus();
}

/**
 * Attach to live Session Chrome, open remote_session row, start screencast.
 * Default: restore full Session viewport (1600×900), never shrink to Dashboard.
 * Pass `{ resize: true, viewportW, viewportH }` only when intentionally resizing.
 * @param {object} [opts] Attach options.
 * @param {number} [opts.quality] JPEG quality (40-95, default 65).
 * @param {boolean} [opts.resize] True to resize Chrome to viewportW/viewportH.
 * @param {number} [opts.viewportW] Desired viewport width (with resize).
 * @param {number} [opts.viewportH] Desired viewport height (with resize).
 * @param {number} [opts.deviceScaleFactor] Device scale factor (with resize).
 * @param {number} [opts.dpr] Alias for deviceScaleFactor.
 * @returns {Promise<{ remoteSession: object, status: object }>} Opened remote session + status snapshot.
 */
export async function attachLive(opts = {}) {
  const gb = state.globalBrowser;
  if (!gb.ready) throw new Error('Session browser not ready');
  if (bridge.client) await detachLive();

  // Always re-probe — port may appear after first failed discover, or URL may be stale
  await refreshCdpEndpoints();
  if (!gb.cdpWsUrl) throw new Error('CDP WebSocket URL unavailable (is Session Chrome on 9242/9222?)');

  bridge.quality = Math.min(95, Math.max(40, Number(opts.quality) || 65));
  const wantResize = opts.resize === true;

  bridge.client = new CdpClient();
  try {
    await bridge.client.connect(gb.cdpWsUrl);

    const pages = await bridge.client.listPageTargets();
    if (!pages.length) throw new Error('No page target on CDP browser');
    // Prefer newest usable page (last) so leftover homepage tabs are not streamed by default
    const usable = pages.filter((p) => {
      const u = p.url || '';
      return !u.startsWith('devtools://') && !u.startsWith('chrome-extension://');
    });
    const page = (usable.length ? usable[usable.length - 1] : null)
      || pages.find((p) => !p.url?.startsWith('devtools://'))
      || pages[0];
    await bridge.client.attachToTarget(page.targetId);

    await bridge.client.send('Page.enable');
    await bridge.client.send('Runtime.enable');
    try {
      await enableInspect(bridge.client);
    } catch (e) {
      console.warn('[remote-bridge] Overlay/DOM enable failed:', e.message);
    }

    if (wantResize) {
      bridge.viewport = {
        w: Math.max(320, Number(opts.viewportW) || SESSION_VIEWPORT.w),
        h: Math.max(240, Number(opts.viewportH) || SESSION_VIEWPORT.h),
        dpr: Number(opts.deviceScaleFactor) || Number(opts.dpr) || 1,
      };
      await applyViewportOverride();
    } else {
      await ensureFullSessionViewport(page.targetId);
    }

    bridge.remoteSession = await remoteSessionService.openSession({
      browserContextId: page.browserContextId || '',
      targetId: page.targetId,
      isolation: 'target',
      viewportW: bridge.viewport.w,
      viewportH: bridge.viewport.h,
      deviceScaleFactor: bridge.viewport.dpr,
      url: page.url || '',
    });

    bridge.client.on('Page.screencastFrame', onScreencastFrame);
    bridge.client.on('Client.disconnected', () => {
      clearStallWatch();
      bridge.screencastOn = false;
      broadcastStatus();
    });

    await startScreencast();
  } catch (err) {
    try { await bridge.client.close(); } catch {}
    bridge.client = null;
    bridge.screencastOn = false;
    if (bridge.remoteSession?.id) {
      try { await remoteSessionService.closeSession(bridge.remoteSession.id, { crashed: true }); } catch {}
      bridge.remoteSession = null;
    }
    throw err;
  }
  ensureWsHook(attachLive);
  broadcastStatus();
  return { remoteSession: bridge.remoteSession, status: getRemoteStatus() };
}

/**
 * Detach from Session Chrome: stop screencast, close CDP + remote_session.
 * @param {{ crashed?: boolean }} [opts] Detach options.
 * @returns {Promise<{ closedId: number|null, status: object }>} Closed remote-session id + status snapshot.
 */
export async function detachLive({ crashed = false } = {}) {
  clearStallWatch();
  bridge.screencastOn = false;
  if (bridge.client) {
    try { await bridge.client.send('Page.stopScreencast'); } catch {}
    try { await bridge.client.close(); } catch {}
    bridge.client = null;
  }
  if (bridge.remoteSession?.id) {
    try {
      await remoteSessionService.closeSession(bridge.remoteSession.id, { crashed });
    } catch (e) {
      console.warn('[remote-bridge] closeSession failed:', e.message);
    }
  }
  const closedId = bridge.remoteSession?.id ?? null;
  bridge.remoteSession = null;
  bridge.subscribers.clear();
  bridge.lastInspectLabel = '';
  broadcastStatus();
  return { closedId, status: getRemoteStatus() };
}

/**
 * Pack/parse helpers exported for tests / docs.
 * @param {Buffer} buf Binary frame buffer (RSCF magic + frameId + uuid + jpeg).
 * @returns {{ frameId: number, sessionUuid: string, jpeg: Buffer }|null} Parsed frame, or null when malformed.
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

/**
 * Call once from route registration so WS handlers exist even before attach.
 * @returns {void}
 */
export function initRemoteBridgeWs() {
  ensureWsHook(attachLive);
}

/**
 * Resolve form control by label_text / actionType+params on the attached local BiB CDP page.
 * @param {string} labelText Form label text to resolve.
 * @param {{ actionType?: string, action?: string, params?: object, mode?: string, pageLabel?: string, page_label?: string }} [opts] Resolve options.
 * @returns {Promise<object>} Resolved element payload from resolveElementByLabel.
 */
export async function resolveElementByLabelText(labelText, opts = {}) {
  if (!bridge.client) {
    const err = new Error('BiB stream not attached — call record/prepare first');
    err.statusCode = 400;
    throw err;
  }
  return resolveElementByLabel(bridge.client, {
    labelText,
    actionType: opts.actionType || opts.action || '',
    params: opts.params || {},
    mode: opts.mode || 'inventory',
    pageLabel: opts.pageLabel || opts.page_label || '',
  });
}
