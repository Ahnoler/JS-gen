/**
 * Single-live Remote Browser bridge: CDP screencast + input for Session Chrome.
 * Keeps all public exports + module state; delegates blocks to sibling modules:
 *   state.js      — shared mutable state + status/event helpers
 *   screencast.js — screencast lifecycle, frame fan-out, viewport override
 *   cdp-input.js  — CDP input handling (ack/fill/input/viewport)
 *   ws-router.js  — WS remote:* message router + BiB target resolution
 */
import { state } from '../../state.js';
import * as remoteSessionService from '../../services/remote-session-service.js';
import { suppressPageManualRecorder } from '../inspect.js';
import { resolveElementByLabel } from '../resolve-by-label.js';
import {
  bridge, getRemoteStatus, broadcastStatus,
} from './state.js';
import {
  stopScreencast, clearStallWatch,
} from './screencast.js';
import { ensureWsHook, resolveBibTarget } from './ws-router.js';

export { getRemoteStatus, resolveBibTarget };

/**
 * Return the currently attached CDP client, or null when not attached.
 * Local BiB mount removed — always null; executor path uses remote-session-service.
 * @returns {null} Always null (no local CDP attach).
 */
export function getAttachedCdpClient() {
  return null;
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
 * Attach to live Session Chrome — local mount removed; use executor BiB path.
 * @param {object} [_opts] Ignored (retained for WS hook signature).
 * @returns {Promise<never>} Always throws.
 */
export async function attachLive(_opts = {}) {
  throw new Error('local BiB mount removed — use executor');
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
    await stopScreencast();
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
  bridge.lastPacket = null;
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
