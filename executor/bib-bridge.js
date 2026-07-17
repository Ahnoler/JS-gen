/**
 * Executor-side BiB bridge:
 * - Connect to Session Chrome via CDP
 * - Start Page.screencast (jpeg)
 * - Pack frames into RSCF (Remote ScreenCast Frame)
 * - Send raw binary packets to control-plane WS
 *
 * CDP screencast requires Page.screencastFrameAck before the next frame.
 * Waiting for a dashboard round-trip ack freezes the stream when any frame/
 * ack is dropped under agent load (input still works — Input.* is independent).
 * So we ack Chrome immediately on receive, then optionally forward to clients.
 */
import { CdpClient } from '../src/cdp/client.js';
import { discoverCdpWithRetry } from '../src/cdp/discover.js';

const MAGIC = Buffer.from('RSCF');
const DEFAULT_VIEWPORT = { w: 1920, h: 1080, dpr: 1 };
/** Min interval between forwarded JPEG frames (CDP ack is always immediate). */
const MIN_FORWARD_MS = 40;
/** If no CDP frame for this long while attached, restart screencast. */
const STALL_RESTART_MS = 2500;

export class BibBridge {
  /**
   * @param {object} opts
   * @param {string} opts.sessionId Python session id (used for ack mapping)
   * @param {string} opts.remoteSessionUuid UUID embedded into RSCF header
   * @param {(packet: Buffer) => void} opts.sendBinary
   */
  constructor({ sessionId, remoteSessionUuid, sendBinary }) {
    this.sessionId = sessionId;
    this.remoteSessionUuid = String(remoteSessionUuid || '');
    this.sendBinary = sendBinary;

    /** @type {CdpClient|null} */
    this.client = null;
    this.screencastOn = false;
    this.viewport = { ...DEFAULT_VIEWPORT };
    this.quality = 70;
    this._disposed = false;
    this._lastForwardAt = 0;
    this._lastFrameAt = 0;
    this._stallTimer = null;
    this._restarting = false;
  }

  async attach({
    quality = 70,
    viewportW,
    viewportH,
    deviceScaleFactor,
    host = '127.0.0.1',
    resize = false,
  } = {}) {
    this.quality = Math.min(95, Math.max(40, Number(quality) || 70));
    this.viewport = {
      w: Number.isFinite(Number(viewportW)) && Number(viewportW) > 0 ? Math.round(viewportW) : DEFAULT_VIEWPORT.w,
      h: Number.isFinite(Number(viewportH)) && Number(viewportH) > 0 ? Math.round(viewportH) : DEFAULT_VIEWPORT.h,
      dpr: Number.isFinite(Number(deviceScaleFactor)) && Number(deviceScaleFactor) > 0
        ? Number(deviceScaleFactor)
        : DEFAULT_VIEWPORT.dpr,
    };

    const hit = await discoverCdpWithRetry({ host });
    if (!hit?.cdpWsUrl) throw new Error('CDP WebSocket not found for BibBridge');

    this.client = new CdpClient();
    await this.client.connect(hit.cdpWsUrl);

    const pages = await this.client.listPageTargets();
    const page = pages.find((p) => !p.url?.startsWith('devtools://')) || pages[0];
    if (!page) throw new Error('No page target on CDP browser');
    await this.client.attachToTarget(page.targetId);

    await this.client.send('Page.enable');
    await this.client.send('Runtime.enable');

    if (resize) {
      await this.client.send('Emulation.setDeviceMetricsOverride', {
        width: this.viewport.w,
        height: this.viewport.h,
        deviceScaleFactor: this.viewport.dpr,
        mobile: false,
      });
    }

    this.client.on('Page.screencastFrame', (params) => this._onScreencastFrame(params));
    this.client.on('Client.disconnected', () => {
      this.screencastOn = false;
      this._clearStallWatch();
    });

    await this.startScreencast();
  }

  async startScreencast() {
    if (!this.client || this._disposed) return;
    const maxW = Math.max(this.viewport.w, DEFAULT_VIEWPORT.w);
    const maxH = Math.max(this.viewport.h, DEFAULT_VIEWPORT.h);
    await this.client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.quality,
      maxWidth: maxW,
      maxHeight: maxH,
      everyNthFrame: 1,
    });
    this.screencastOn = true;
    this._lastFrameAt = Date.now();
    this._armStallWatch();
  }

  async stopScreencast() {
    if (!this.client) return;
    this._clearStallWatch();
    try { await this.client.send('Page.stopScreencast'); } catch {}
    this.screencastOn = false;
  }

  /** Kick screencast after agent navigation / stall (safe if already running). */
  async restartScreencast() {
    if (!this.client || this._disposed || this._restarting) return;
    this._restarting = true;
    try {
      try { await this.client.send('Page.stopScreencast'); } catch {}
      this.screencastOn = false;
      await this.startScreencast();
    } catch (e) {
      console.warn('[bib-bridge] restartScreencast failed:', e.message);
    } finally {
      this._restarting = false;
    }
  }

  /**
   * Client ack is optional now (producer acks Chrome). Kept for compatibility.
   */
  async ack({ frameId, sessionId } = {}) {
    if (!this.client || !this.screencastOn) return;
    const fid = frameId ?? sessionId;
    if (fid == null) return;
    try {
      await this.client.send('Page.screencastFrameAck', { sessionId: Number(fid) });
    } catch {}
  }

  async handleInput(payload = {}) {
    // Input must work even if screencast briefly stalled (restart in progress).
    if (!this.client || this._disposed) return { ok: false, reason: 'not attached' };

    const kind = payload.kind;
    const xNorm = Number(payload.x);
    const yNorm = Number(payload.y);
    const x = Number.isFinite(xNorm) ? Math.round(xNorm * this.viewport.w) : Math.round(this.viewport.w / 2);
    const y = Number.isFinite(yNorm) ? Math.round(yNorm * this.viewport.h) : Math.round(this.viewport.h / 2);

    if (kind === 'mouse') {
      const type = payload.type;
      const button = payload.button || 'left';
      const buttons = payload.buttons ?? 0;
      const clickCount = payload.clickCount ?? 1;
      const deltaX = payload.deltaX ?? 0;
      const deltaY = payload.deltaY ?? 0;

      await this.client.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button,
        buttons,
        clickCount,
        deltaX,
        deltaY,
        modifiers: payload.modifiers ?? 0,
      });
      // Page changed under cursor — nudge stream if it was frozen
      if (type === 'mousePressed' || type === 'mouseReleased') {
        this._nudgeIfStalled();
      }
      return { ok: true };
    }

    if (kind === 'key') {
      await this.client.send('Input.dispatchKeyEvent', {
        type: payload.type || 'keyDown',
        key: payload.key || '',
        code: payload.code || '',
        windowsVirtualKeyCode: Number(payload.keyCode ?? 0),
        modifiers: payload.modifiers ?? 0,
      });
      return { ok: true };
    }

    if (kind === 'text') {
      await this.client.send('Input.insertText', { text: String(payload.text || '') });
      return { ok: true };
    }

    return { ok: false, reason: 'unknown input kind' };
  }

  _ackChrome(sessionId) {
    if (!this.client || sessionId == null) return;
    this.client.send('Page.screencastFrameAck', { sessionId: Number(sessionId) }).catch(() => {});
  }

  _onScreencastFrame(params = {}) {
    if (!this.screencastOn || !this.remoteSessionUuid) return;
    const cdpSessionId = params.sessionId;
    // CRITICAL: always ack Chrome first so the next frame can be produced.
    this._ackChrome(cdpSessionId);
    this._lastFrameAt = Date.now();

    const dataB64 = params.data;
    if (!dataB64) return;

    // Throttle WS forward; dropped frames are already acked above.
    const now = Date.now();
    if (now - this._lastForwardAt < MIN_FORWARD_MS) return;
    this._lastForwardAt = now;

    // Keep coordinate space aligned with the live page (CSS px).
    const metadata = params.metadata || {};
    const dw = Number(metadata.deviceWidth);
    const dh = Number(metadata.deviceHeight);
    if (Number.isFinite(dw) && dw > 0) this.viewport.w = Math.round(dw);
    if (Number.isFinite(dh) && dh > 0) this.viewport.h = Math.round(dh);

    try {
      const jpeg = Buffer.from(dataB64, 'base64');
      const uuidBuf = Buffer.from(String(this.remoteSessionUuid), 'utf8');
      const frameId = cdpSessionId ?? 0;
      const header = Buffer.alloc(4 + 4 + 2 + uuidBuf.length);
      MAGIC.copy(header, 0);
      header.writeUInt32BE(Number(frameId) >>> 0, 4);
      header.writeUInt16BE(uuidBuf.length, 8);
      uuidBuf.copy(header, 10);
      const packet = Buffer.concat([header, jpeg]);
      this.sendBinary(packet);
    } catch {}
  }

  _armStallWatch() {
    this._clearStallWatch();
    this._stallTimer = setInterval(() => {
      if (!this.screencastOn || this._disposed) return;
      if (Date.now() - this._lastFrameAt > STALL_RESTART_MS) {
        this.restartScreencast().catch(() => {});
      }
    }, 1000);
  }

  _clearStallWatch() {
    if (this._stallTimer) {
      clearInterval(this._stallTimer);
      this._stallTimer = null;
    }
  }

  _nudgeIfStalled() {
    if (!this.screencastOn || this._disposed) return;
    if (Date.now() - this._lastFrameAt > 800) {
      this.restartScreencast().catch(() => {});
    }
  }

  async detach() {
    this._disposed = true;
    this._clearStallWatch();
    await this.stopScreencast().catch(() => {});
    if (this.client) {
      try { await this.client.close(); } catch {}
      this.client = null;
    }
  }
}
