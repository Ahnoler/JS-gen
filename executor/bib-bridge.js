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
import { resolveElementByLabel } from '../src/cdp/resolve-by-label.js';

const MAGIC = Buffer.from('RSCF');
const DEFAULT_VIEWPORT = { w: 1600, h: 900, dpr: 1 };
/** Screencast encode cap (optional upscale ceiling; default stream is 1600×900). */
const STREAM_MAX_W = 1920;
const STREAM_MAX_H = 1080;
/** Min interval between forwarded JPEG frames (CDP ack is always immediate). */
const MIN_FORWARD_MS = 33;
/** If no CDP frame for this long while attached, restart screencast. */
const STALL_RESTART_MS = 2500;

function isUsablePage(p) {
  const url = p?.url || '';
  return !url.startsWith('devtools://') && !url.startsWith('chrome-extension://');
}

/** Prefer newest page (last) so Agent's working tab wins over leftover homepage tabs. */
function pickDefaultPage(pages) {
  const usable = (pages || []).filter(isUsablePage);
  if (usable.length) return usable[usable.length - 1];
  return (pages || []).find((p) => !p.url?.startsWith('devtools://')) || pages?.[0] || null;
}

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
    this.quality = 65;
    this._disposed = false;
    this._lastForwardAt = 0;
    this._lastFrameAt = 0;
    this._stallTimer = null;
    this._restarting = false;
    /** @type {string|null} */
    this.activeTargetId = null;
    this._switching = false;
  }

  async attach({
    quality = 75,
    viewportW,
    viewportH,
    deviceScaleFactor,
    host = '127.0.0.1',
    resize = false,
    /** Prefer explicit port from session slot (multi-Chrome safe). */
    cdpPort,
    /** Optional: attach to this CDP target instead of default pick. */
    targetId = null,
  } = {}) {
    this.quality = Math.min(90, Math.max(50, Number(quality) || 65));
    this.viewport = {
      w: Number.isFinite(Number(viewportW)) && Number(viewportW) > 0 ? Math.round(viewportW) : DEFAULT_VIEWPORT.w,
      h: Number.isFinite(Number(viewportH)) && Number(viewportH) > 0 ? Math.round(viewportH) : DEFAULT_VIEWPORT.h,
      dpr: Number.isFinite(Number(deviceScaleFactor)) && Number(deviceScaleFactor) > 0
        ? Number(deviceScaleFactor)
        : DEFAULT_VIEWPORT.dpr,
    };

    const hit = await discoverCdpWithRetry({
      host,
      port: cdpPort,
      ports: cdpPort != null ? [Number(cdpPort)] : undefined,
      attempts: 24,
      delayMs: 500,
    });
    if (!hit?.cdpWsUrl) {
      throw new Error(
        cdpPort != null
          ? `CDP WebSocket not found for BibBridge on port ${cdpPort}`
          : 'CDP WebSocket not found for BibBridge',
      );
    }

    this.client = new CdpClient();
    await this.client.connect(hit.cdpWsUrl);

    const pages = await this.client.listPageTargets();
    let page = null;
    if (targetId) {
      page = pages.find((p) => p.targetId === targetId) || null;
    }
    if (!page) page = pickDefaultPage(pages);
    if (!page) throw new Error('No page target on CDP browser');

    await this._bindPageTarget(page.targetId, { resize });
    this.client.on('Page.screencastFrame', (params) => this._onScreencastFrame(params));
    this.client.on('Client.disconnected', () => {
      this.screencastOn = false;
      this._clearStallWatch();
    });

    await this.startScreencast();
  }

  /**
   * Attach Page/Runtime domains to a target and mark it active.
   * @param {string} targetId
   * @param {{ resize?: boolean }} [opts]
   */
  async _bindPageTarget(targetId, { resize = false } = {}) {
    if (!this.client) throw new Error('not attached');
    try {
      await this.client.send('Target.activateTarget', { targetId }, null);
    } catch {}
    await this.client.attachToTarget(targetId);
    this.activeTargetId = targetId;

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
  }

  /**
   * List open page tabs for the bound Chrome.
   * @returns {Promise<{ tabs: object[], activeTargetId: string|null }>}
   */
  async listTabs() {
    if (!this.client || this._disposed) {
      return { tabs: [], activeTargetId: this.activeTargetId };
    }
    const pages = await this.client.listPageTargets();
    const tabs = pages
      .filter(isUsablePage)
      .map((p, index) => ({
        targetId: p.targetId,
        url: p.url || '',
        title: p.title || '',
        index,
        active: p.targetId === this.activeTargetId,
      }));
    if (tabs.length && !tabs.some((t) => t.active)) {
      tabs[tabs.length - 1].active = true;
    }
    return { tabs, activeTargetId: this.activeTargetId };
  }

  /**
   * Switch screencast + Chrome foreground to another page target.
   * @param {string} targetId
   */
  async switchToTarget(targetId) {
    if (!this.client || this._disposed) throw new Error('not attached');
    if (!targetId) throw new Error('targetId required');
    if (targetId === this.activeTargetId && this.screencastOn) {
      try { await this.client.send('Target.activateTarget', { targetId }, null); } catch {}
      return { ok: true, targetId, reused: true };
    }
    if (this._switching) throw new Error('tab switch already in progress');
    this._switching = true;
    try {
      await this.stopScreencast().catch(() => {});
      await this._bindPageTarget(targetId, { resize: false });
      await this.startScreencast();
      return { ok: true, targetId, reused: false };
    } finally {
      this._switching = false;
    }
  }

  async startScreencast() {
    if (!this.client || this._disposed) return;
    // Encode at current viewport; never upscale beyond STREAM_MAX_* (do not floor to 1080p).
    const maxW = Math.min(Math.max(320, Number(this.viewport.w) || DEFAULT_VIEWPORT.w), STREAM_MAX_W);
    const maxH = Math.min(Math.max(240, Number(this.viewport.h) || DEFAULT_VIEWPORT.h), STREAM_MAX_H);
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
      const text = String(payload.text || '');
      if (!text && payload.replace !== true) return { ok: true };

      if (payload.replace === true) {
        try {
          await this.client.send('Runtime.evaluate', {
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
          console.warn('[bib-bridge] text replace select failed:', e.message);
        }
      }

      if (text) {
        await this.client.send('Input.insertText', { text });
      } else if (payload.replace === true) {
        await this.client.send('Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Backspace', code: 'Backspace',
          windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
        });
        await this.client.send('Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Backspace', code: 'Backspace',
          windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
        });
      }
      return { ok: true };
    }

    if (kind === 'navigate') {
      const action = String(payload.action || '');
      if (action === 'reload') {
        await this.client.send('Page.reload', { ignoreCache: false });
        return { ok: true };
      }
      if (action === 'back' || action === 'forward') {
        const hist = await this.client.send('Page.getNavigationHistory');
        const entries = hist?.entries || [];
        const idx = Number(hist?.currentIndex);
        if (!Number.isFinite(idx) || !entries.length) return { ok: true, noop: true };
        const targetIdx = action === 'back' ? idx - 1 : idx + 1;
        if (targetIdx < 0 || targetIdx >= entries.length) return { ok: true, noop: true };
        const entry = entries[targetIdx];
        if (entry?.id == null) return { ok: true, noop: true };
        await this.client.send('Page.navigateToHistoryEntry', { entryId: entry.id });
        return { ok: true };
      }
      return { ok: false, reason: 'unknown_navigate_action' };
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
    this._ackChrome(cdpSessionId);
    this._lastFrameAt = Date.now();

    const dataB64 = params.data;
    if (!dataB64) return;

    const now = Date.now();
    if (now - this._lastForwardAt < MIN_FORWARD_MS) return;
    this._lastForwardAt = now;

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
      // Backpressure: skip frame rather than queue multi-second lag on the WS.
      if (typeof this.sendBinary === 'function') {
        this.sendBinary(packet);
      }
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

  /**
   * Resolve Element UI control by form label / actionType+params via CDP.
   * @param {string} labelText
   * @param {{ actionType?: string, params?: object }} [opts]
   */
  async resolveByLabel(labelText, opts = {}) {
    if (!this.client || this._disposed) {
      throw new Error('BiB not attached');
    }
    return resolveElementByLabel(this.client, {
      labelText,
      actionType: opts.actionType || opts.action || '',
      params: opts.params || {},
    });
  }

  async detach() {
    this._disposed = true;
    this._clearStallWatch();
    await this.stopScreencast().catch(() => {});
    if (this.client) {
      try { await this.client.close(); } catch {}
      this.client = null;
    }
    this.activeTargetId = null;
  }
}
