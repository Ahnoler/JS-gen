/**
 * Remote-bridge screencast block: CDP Page.startScreencast lifecycle, frame fan-out,
 * stall watchdog and viewport override helpers.
 */
import { broadcastBinary } from '../../ws-server.js';
import * as remoteSessionService from '../../services/remote-session-service.js';
import {
  bridge, MAGIC, MIN_FORWARD_MS, STALL_RESTART_MS, SESSION_VIEWPORT,
  STREAM_MAX_W, STREAM_MAX_H, resolveScreencastTiming,
} from './state.js';

/**
 * Read live CSS viewport from the page (do not invent dashboard canvas sizes).
 */
export async function syncViewportFromPage() {
  if (!bridge.client) return bridge.viewport;
  try {
    const metrics = await bridge.client.send('Page.getLayoutMetrics');
    const css = metrics?.cssVisualViewport || metrics?.visualViewport || metrics?.cssLayoutViewport || metrics?.layoutViewport;
    const w = Math.round(Number(css?.clientWidth || css?.width) || 0);
    const h = Math.round(Number(css?.clientHeight || css?.height) || 0);
    if (w > 0) bridge.viewport.w = w;
    if (h > 0) bridge.viewport.h = h;
    const dpr = Number(css?.scale);
    if (Number.isFinite(dpr) && dpr > 0) bridge.viewport.dpr = dpr;
  } catch (e) {
    console.warn('[remote-bridge] getLayoutMetrics failed:', e.message);
  }
  return bridge.viewport;
}

/**
 * Restore Session full viewport (1600×900). Clears leftover Emulation crops
 * from earlier dashboard-sized overrides; does NOT shrink to the Dashboard.
 */
export async function ensureFullSessionViewport(targetId) {
  if (!bridge.client) return;
  try { await bridge.client.send('Emulation.clearDeviceMetricsOverride'); } catch {}

  // Grow OS window if possible (best-effort; may fail headless / some Chrome builds)
  try {
    const win = await bridge.client.send('Browser.getWindowForTarget', { targetId }, null);
    if (win?.windowId != null) {
      await bridge.client.send('Browser.setWindowBounds', {
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

  bridge.viewport = { ...SESSION_VIEWPORT };
  await applyViewportOverride();
  await syncViewportFromPage();
  // If metrics still report something tiny, force Session size again
  if (bridge.viewport.w < SESSION_VIEWPORT.w * 0.9 || bridge.viewport.h < SESSION_VIEWPORT.h * 0.9) {
    bridge.viewport = { ...SESSION_VIEWPORT };
    await applyViewportOverride();
  }
  console.log(`[remote-bridge] session viewport ${bridge.viewport.w}×${bridge.viewport.h}`);
}

export async function applyViewportOverride() {
  if (!bridge.client) return;
  await bridge.client.send('Emulation.setDeviceMetricsOverride', {
    width: bridge.viewport.w,
    height: bridge.viewport.h,
    deviceScaleFactor: bridge.viewport.dpr,
    mobile: false,
  });
  if (bridge.remoteSession?.id) {
    await remoteSessionService.updateViewport(bridge.remoteSession.id, {
      viewportW: bridge.viewport.w,
      viewportH: bridge.viewport.h,
      deviceScaleFactor: bridge.viewport.dpr,
    });
  }
}

export async function persistViewport() {
  if (!bridge.remoteSession?.id) return;
  try {
    await remoteSessionService.updateViewport(bridge.remoteSession.id, {
      viewportW: bridge.viewport.w,
      viewportH: bridge.viewport.h,
      deviceScaleFactor: bridge.viewport.dpr,
    });
  } catch {}
}

export function clearStallWatch() {
  if (bridge.stallTimer) {
    clearInterval(bridge.stallTimer);
    bridge.stallTimer = null;
  }
}

function armStallWatch() {
  clearStallWatch();
  bridge.stallTimer = setInterval(() => {
    if (!bridge.screencastOn || !bridge.client) return;
    if (Date.now() - bridge.lastFrameAt > STALL_RESTART_MS) {
      restartScreencast().catch(() => {});
    }
  }, 1000);
}

export async function restartScreencast() {
  if (!bridge.client || bridge.restartingCast) return;
  bridge.restartingCast = true;
  try {
    try { await bridge.client.send('Page.stopScreencast'); } catch {}
    bridge.screencastOn = false;
    await startScreencast();
  } catch (e) {
    console.warn('[remote-bridge] restartScreencast failed:', e.message);
  } finally {
    bridge.restartingCast = false;
  }
}

export async function startScreencast() {
  if (!bridge.client) return;
  const timing = resolveScreencastTiming();
  bridge.minForwardMs = timing.minForwardMs;
  bridge.everyNthFrame = timing.everyNthFrame;
  // Encode at current viewport; never upscale beyond STREAM_MAX_* (do not floor to 1080p).
  const maxW = Math.min(Math.max(320, Number(bridge.viewport.w) || SESSION_VIEWPORT.w), STREAM_MAX_W);
  const maxH = Math.min(Math.max(240, Number(bridge.viewport.h) || SESSION_VIEWPORT.h), STREAM_MAX_H);
  await bridge.client.send('Page.startScreencast', {
    format: 'jpeg',
    quality: bridge.quality,
    maxWidth: maxW,
    maxHeight: maxH,
    everyNthFrame: timing.everyNthFrame,
  });
  bridge.screencastOn = true;
  bridge.lastFrameAt = Date.now();
  armStallWatch();
}

export function onScreencastFrame(params) {
  if (!bridge.screencastOn || !bridge.remoteSession) return;
  const sessionId = params.sessionId;
  // Ack Chrome immediately — never wait for dashboard round-trip (stalls video while input still works).
  if (sessionId != null) {
    bridge.client?.send('Page.screencastFrameAck', { sessionId: Number(sessionId) }).catch(() => {});
  }
  bridge.lastFrameAt = Date.now();

  const dataB64 = params.data;
  if (!dataB64) return;

  const now = Date.now();
  const minForward = bridge.minForwardMs ?? MIN_FORWARD_MS;
  if (now - bridge.lastForwardAt < minForward) return;
  bridge.lastForwardAt = now;

  const metadata = params.metadata || {};
  // Keep coordinate space aligned with the live page (CSS px).
  const dw = Number(metadata.deviceWidth);
  const dh = Number(metadata.deviceHeight);
  if (Number.isFinite(dw) && dw > 0) bridge.viewport.w = Math.round(dw);
  if (Number.isFinite(dh) && dh > 0) bridge.viewport.h = Math.round(dh);
  try {
    const jpeg = Buffer.from(dataB64, 'base64');
    const uuidBuf = Buffer.from(String(bridge.remoteSession.sessionUuid), 'utf8');
    const header = Buffer.alloc(4 + 4 + 2 + uuidBuf.length);
    MAGIC.copy(header, 0);
    header.writeUInt32BE(Number(sessionId) >>> 0, 4);
    header.writeUInt16BE(uuidBuf.length, 8);
    uuidBuf.copy(header, 10);
    const packet = Buffer.concat([header, jpeg]);

    if (bridge.subscribers.size) {
      for (const ws of bridge.subscribers) {
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
