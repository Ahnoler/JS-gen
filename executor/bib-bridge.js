/**
 * Executor-side BiB bridge:
 * - Connect to Session Chrome via CDP
 * - Start Page.screencast (jpeg)
 * - Pack frames into RSCF (Remote ScreenCast Frame)
 * - Send raw binary packets to control-plane WS
 *
 * CDP screencast flow-control: while maxFramesInFlight (3) is full without an ack,
 * Chrome skips capture AND encode. We therefore pace acks to the forward cadence
 * (createAckPacer) so the producer-side rate is pinned to TARGET_FPS regardless of
 * display refresh — skipped frames cost zero CPU — then optionally forward to clients.
 */
import { CdpClient } from '../src/cdp/client.js';
import { discoverCdpWithRetry } from '../src/cdp/discover.js';
import { resolveScreencastStreamConfig, createAckPacer } from '../src/cdp/screencast-timing.js';
import { resolveElementByLabel } from '../src/cdp/resolve-by-label.js';
import {
  CLIPBOARD_GET_SELECTION_EXPRESSION,
  normalizeClipboardSelectionResult,
} from '../src/cdp/clipboard-selection.js';

const MAGIC = Buffer.from('RSCF');
const DEFAULT_VIEWPORT = { w: 1600, h: 900, dpr: 1 };
/** If no CDP frame for this long while attached, restart screencast. */
const STALL_RESTART_MS = 2500;

function isUsablePage(p) {
  const url = p?.url || '';
  return !url.startsWith('devtools://') && !url.startsWith('chrome-extension://');
}

/**
 * Prefer newest page (last) so Agent's working tab wins over leftover homepage tabs.
 * @param {object[]} pages Array of page targets from CDP
 * @returns {object|null} The selected page target or null if no usable pages
 */
function pickDefaultPage(pages) {
  const usable = (pages || []).filter(isUsablePage);
  if (usable.length) return usable[usable.length - 1];
  return (pages || []).find((p) => !p.url?.startsWith('devtools://')) || pages?.[0] || null;
}

/**
 * BiB (Browser-in-Browser) bridge: connects to Chrome via CDP, manages screencast,
 * and handles remote input events for agent sessions.
 */
export class BibBridge {
  /**
   * @param {object} opts opts
   * @param {string} opts.sessionId Python session id (used for ack mapping)
   * @param {string} opts.remoteSessionUuid UUID embedded into RSCF header
   * @param {(packet: Buffer) => void} opts.sendBinary opts.send binary
   */
  constructor({ sessionId, remoteSessionUuid, sendBinary }) {
    this.sessionId = sessionId;
    this.remoteSessionUuid = String(remoteSessionUuid || '');
    this.sendBinary = sendBinary;

    /** @type {CdpClient|null} */
    this.client = null;
    this.screencastOn = false;
    this.viewport = { ...DEFAULT_VIEWPORT };
    this.quality = null;
    this._disposed = false;
    this._lastForwardAt = 0;
    this._lastFrameAt = 0;
    this._minForwardMs = 90;
    this._everyNthFrame = 2;
    this._ackPacer = null;
    this._stallTimer = null;
    this._restarting = false;
    /** @type {string|null} */
    this.activeTargetId = null;
    this._switching = false;
  }

  /**
   * Connect to the session Chrome via CDP, bind the page target, and start screencast.
   * @param {object} [opts] opts
   * @param {number} [opts.quality] jpeg quality (50–90)
   * @param {number} [opts.viewportW] viewport w
   * @param {number} [opts.viewportH] viewport h
   * @param {number} [opts.deviceScaleFactor] device scale factor
   * @param {string} [opts.host] CDP host (default 127.0.0.1)
   * @param {boolean} [opts.resize] apply Emulation.setDeviceMetricsOverride
   * @param {number} [opts.cdpPort] explicit CDP port (multi-Chrome safe)
   * @param {string} [opts.targetId] attach to this target instead of default pick
   * @returns {Promise<void>} result
   */
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
    // null → stream quality falls back to env config (BIB_STREAM_QUALITY) in startScreencast
    this.quality = quality == null ? null : Math.min(90, Math.max(50, Number(quality)));
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
 * @param {string} targetId The CDP target ID to attach to
 * @param {{ resize?: boolean }} [opts] Options for binding
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
 * @returns {Promise<{ tabs: object[], activeTargetId: string|null }>} Promise resolving to tabs array and active target ID
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
 * @param {string} targetId The target ID to switch to
 * @returns {Promise<{ ok: boolean, targetId: string, reused?: boolean }>} Result with success status and target info
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

  /**
   * Start the CDP Page.screencast (jpeg) for the bound page.
   * @returns {Promise<void>} result
   */
  async startScreencast() {
    if (!this.client || this._disposed) return;
    const stream = resolveScreencastStreamConfig();
    this._minForwardMs = stream.minForwardMs;
    this._everyNthFrame = stream.everyNthFrame;
    // Encode at current viewport; never upscale beyond env caps (do not floor to 1080p).
    const maxW = Math.min(Math.max(320, Number(this.viewport.w) || DEFAULT_VIEWPORT.w), stream.maxW);
    const maxH = Math.min(Math.max(240, Number(this.viewport.h) || DEFAULT_VIEWPORT.h), stream.maxH);
    await this.client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.quality ?? stream.quality,
      maxWidth: maxW,
      maxHeight: maxH,
      everyNthFrame: this._everyNthFrame,
    });
    this._ackPacer?.cancel();
    this._ackPacer = createAckPacer({
      minForwardMs: stream.minForwardMs,
      ack: (id) => { this._ackChrome(id); },
    });
    this.screencastOn = true;
    this._lastFrameAt = Date.now();
    this._armStallWatch();
  }

  /**
   * Stop the CDP Page.screencast.
   * @returns {Promise<void>} result
   */
  async stopScreencast() {
    if (!this.client) return;
    this._clearStallWatch();
    this._ackPacer?.cancel();
    this._ackPacer = null;
    try { await this.client.send('Page.stopScreencast'); } catch {}
    this.screencastOn = false;
  }

  /**
   * Viewer-count push from the control plane: pause the screencast entirely when
   * nobody is watching (producer CPU + WS bandwidth → 0), resume on first viewer.
   * @param {number} viewers dashboard subscriber count for this remote session uuid
   * @returns {Promise<{ ok: boolean, screencastOn: boolean }>} result
   */
  async setStreamViewers(viewers) {
    const n = Number(viewers);
    if (!Number.isFinite(n)) return { ok: false, screencastOn: !!this.screencastOn };
    if (n <= 0 && this.screencastOn) {
      await this.stopScreencast();
    } else if (n > 0 && !this.screencastOn && this.client && !this._disposed) {
      await this.startScreencast();
    }
    return { ok: true, screencastOn: !!this.screencastOn };
  }

  /**
   * Kick screencast after agent navigation / stall (safe if already running).
   * @returns {Promise<void>} result
   */
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
 * @param {{ frameId?: number, sessionId?: number }} [opts] Ack options with frame or session ID
 * @returns {Promise<void>} Promise that resolves when ack is sent
 */
async ack({ frameId, sessionId } = {}) {
    if (!this.client || !this.screencastOn) return;
    const fid = frameId ?? sessionId;
    if (fid == null) return;
    try {
      await this.client.send('Page.screencastFrameAck', { sessionId: Number(fid) });
    } catch {}
  }

  /**
   * Dispatch a remote input event (mouse/key/text/navigate/clipboard) via CDP.
   * @param {object} [payload] input payload with `kind` (mouse|key|text|navigate|clipboard)
   * @returns {Promise<object>} result with ok/reason or clipboard payload
   */
  async handleInput(payload = {}) {
    if (!this.client || this._disposed) {
      if (payload.kind === 'clipboard') {
        return {
          clipboard: true,
          requestId: payload.requestId || null,
          ok: false,
          text: '',
          reason: 'not_attached',
        };
      }
      return { ok: false, reason: 'not attached' };
    }

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

    if (kind === 'clipboard') {
      const action = String(payload.action || '');
      const requestId = payload.requestId || null;
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
        const evaluated = await this.client.send('Runtime.evaluate', {
          expression: CLIPBOARD_GET_SELECTION_EXPRESSION,
          returnByValue: true,
        });
        const normalized = normalizeClipboardSelectionResult(evaluated?.result?.value);
        return { clipboard: true, requestId, ...normalized };
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

    return { ok: false, reason: 'unknown input kind' };
  }

  /**
   * Acknowledge a screencast frame back to Chrome CDP.
   * @param {number} sessionId CDP session id for the screencast
   * @returns {void}
   */
  _ackChrome(sessionId) {
    if (!this.client || sessionId == null) return;
    this.client.send('Page.screencastFrameAck', { sessionId: Number(sessionId) }).catch(() => {});
  }

  /**
   * Handle incoming screencast frame from Chrome, ack it, and forward to control-plane.
   * @param {{ sessionId?: number, data?: string, metadata?: object }} params Frame parameters
   * @returns {void}
   */
  _onScreencastFrame(params = {}) {
    if (!this.screencastOn || !this.remoteSessionUuid) return;
    const cdpSessionId = params.sessionId;
    // Pace acks to the forward cadence — Chrome skips capture/encode while in-flight is full.
    this._ackPacer?.schedule(Number(cdpSessionId));
    this._lastFrameAt = Date.now();

    const dataB64 = params.data;
    if (!dataB64) return;

    const now = Date.now();
    if (now - this._lastForwardAt < this._minForwardMs) return;
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
   * @param {string} labelText label text
   * @param {{ actionType?: string, params?: object, mode?: string }} [opts] resolution options
   * @returns {Promise<object>} resolved element / ambiguous result
   */
  async resolveByLabel(labelText, opts = {}) {
    if (!this.client || this._disposed) {
      throw new Error('BiB not attached');
    }
    return resolveElementByLabel(this.client, {
      labelText,
      actionType: opts.actionType || opts.action || '',
      params: opts.params || {},
      mode: opts.mode || 'inventory',
      pageLabel: opts.pageLabel || opts.page_label || '',
    });
  }

  /**
   * Capture a phase-highlight screenshot via CDP.
   * @returns {Promise<{ pngBase64: string, meta: object }>} screenshot with base64 PNG and metadata
   */
  async capturePhaseHighlight() {
    const { runPhaseScreenshotCapture } = await import('../src/cdp/phase-screenshot-capture.js');
    if (!this.client) throw new Error('BiB not attached');
    const { buffer, meta } = await runPhaseScreenshotCapture(this.client);
    return { pngBase64: buffer.toString('base64'), meta };
  }

  /**
   * Detach from CDP: stop screencast, close client, clear state.
   * @returns {Promise<void>} result
   */
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
