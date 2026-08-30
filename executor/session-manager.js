/**
 * Manages session slots on the executor (capacity-bound).
 */
import { SessionSlot } from './session-slot.js';
import { EXECUTOR_CAPACITY, EXECUTOR_CDP_PORT_BASE } from './config.js';
import { BibBridge } from './bib-bridge.js';
import { discoverAllCdpInRange } from '../src/cdp/discover.js';
import { isProcessAlive } from './spawn-agent.js';

/**
 * Manages executor session slots: allocation, CDP port binding, BiB screencast bridges,
 * and lifecycle (open/close/detach) for browser-automation sessions.
 */
export class SessionManager {
  /**
   * @param {number} capacity maximum number of concurrent slots
   * @param {(msg: object) => void} emitToControlPlane emit to control plane
   * @param {(packet: Buffer) => void} sendBinary send binary
   */
  constructor(capacity, emitToControlPlane, sendBinary) {
    this.capacity = capacity;
    /** @type {Map<string, SessionSlot>} */
    this.sessions = new Map();
    /** @type {SessionSlot[]} */
    this.slots = Array.from({ length: capacity }, (_, i) => new SessionSlot(i, (msg) => {
      // Drop crashed sessions from the map so leases/list stay consistent with free slots.
      if (msg?.event === 'session.process_exit' && msg.session_id) {
        const sessionId = msg.session_id;
        // Detach the BiB before dropping the session: the crash path used to
        // delete only the sessions entry, leaking the bib entry, its 1s stall
        // timer and the CDP client. detachBib is async (never throws
        // synchronously) — the extra .catch() covers late rejections so the
        // sessions delete below always runs.
        if (this.bibs.has(sessionId)) {
          try {
            this.detachBib(sessionId, { crashed: true }).catch((err) => {
              console.warn('[session-manager] process_exit detachBib failed:', err?.message || err);
            });
          } catch (err) {
            console.warn('[session-manager] process_exit detachBib failed:', err?.message || err);
          }
        }
        this.sessions.delete(sessionId);
      }
      emitToControlPlane(msg);
    }));
    this.emitToControlPlane = emitToControlPlane;
    this.sendBinary = sendBinary;

    /** @type {Map<string, BibBridge>} */
    this.bibs = new Map();
    /** Serialize attachBib/close per sessionId to avoid orphan screencast producers. */
    /** @type {Map<string, Promise<unknown>>} */
    this._attachLocks = new Map();
  }

  /**
   * Find a free slot, reclaiming ghost slots whose process already died.
   * @returns {SessionSlot|null} free slot or null if no slots available
   */
  _findFreeSlot() {
    for (const slot of this.slots) {
      if (!slot.sessionId) return slot;
      // Reclaim ghost: sessionId set but process already dead (failed open / unclean exit).
      if (!slot.process || !isProcessAlive(slot.process)) {
        const stale = slot.sessionId;
        slot.sessionId = null;
        slot.ready = false;
        slot.busy = false;
        slot.process = null;
        if (stale) this.sessions.delete(stale);
        return slot;
      }
    }
    return null;
  }

  /**
   * Get the SessionSlot for a session id (or null).
   * @param {string} sessionId session id
   * @returns {SessionSlot|null} the slot for the session, or null if not found
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * CDP ports currently claimed by live slots.
   * @returns {Set<number>} set of CDP port numbers occupied by active sessions
   */
  occupiedCdpPorts() {
    const ports = new Set();
    for (const slot of this.slots) {
      if (slot.sessionId && slot.cdpPort != null) ports.add(Number(slot.cdpPort));
    }
    return ports;
  }

  /**
   * List live CDP Chromes on this host; exclude ports already bound to a live slot.
   * @returns {Promise<{ browsers: object[], occupiedPorts: number[] }>} discovered browsers and occupied ports
   */
  async listCdp() {
    const occupied = this.occupiedCdpPorts();
    const hits = await discoverAllCdpInRange({
      portBase: EXECUTOR_CDP_PORT_BASE,
      span: Math.max(40, this.capacity * 20),
    });
    const browsers = hits
      .filter((h) => !occupied.has(Number(h.port)))
      .map((h) => ({
        port: h.port,
        cdpHttp: h.cdpHttp,
        cdpWsUrl: h.cdpWsUrl,
        browser: h.browser || '',
      }));
    return {
      browsers,
      occupiedPorts: [...occupied],
    };
  }

  /**
   * Open (or reuse) a session on a free slot and emit session.ready to the control plane.
   * @param {object} payload payload
   * @param {string} payload.sessionId payload.session id
   * @param {string} [payload.model] model
   * @param {string} [payload.cdpUrl] cdp url
   * @param {number} [payload.cdpPort] cdp port
   * @returns {Promise<{ sessionId: string, slotIndex: number, cdpPort: number|null, cdpReady: boolean, reused?: boolean }>} session open result
   */
  async open(payload) {
    if (this.sessions.has(payload.sessionId)) {
      const existing = this.sessions.get(payload.sessionId);
      return {
        sessionId: payload.sessionId,
        slotIndex: existing.slotIndex,
        cdpPort: existing.cdpPort,
        cdpReady: existing.ready,
        reused: true,
      };
    }

    const slot = this._findFreeSlot();
    if (!slot) throw new Error('No free executor slots');

    const result = await slot.open(payload);
    this.sessions.set(payload.sessionId, slot);

    this.emitToControlPlane({
      event: 'session.ready',
      session_id: payload.sessionId,
      data: {
        sessionId: payload.sessionId,
        slotIndex: result.slotIndex,
        cdpPort: result.cdpPort ?? slot.cdpPort,
        cdpReady: result.cdpReady !== false,
        reusedChrome: !!(payload.cdpUrl || payload.cdp_url),
      },
    });
    return result;
  }

  /**
   * Forward stdin event to session subprocess.
   * @param {string} sessionId session id
   * @param {string} stdinEvent e.g. step, manual_record_start
   * @param {object} data data
   * @returns {{ sessionId: string, slotIndex: number }} acknowledgement with sessionId and slotIndex
   */
  forward(sessionId, stdinEvent, data = {}) {
    const slot = this.sessions.get(sessionId);
    if (!slot) throw new Error(`Unknown session ${sessionId}`);
    slot.writeEvent(stdinEvent, data);
    return { sessionId, slotIndex: slot.slotIndex };
  }

  /**
   * Close a session, detach BiB, and free the slot.
   * Serialized against in-flight/concurrent attachBib via the per-session attach
   * lock, so a BiB cannot be attached back onto a closing/closed session.
   * @param {string} sessionId session id
   * @param {{ keepBrowser?: boolean }} [opts] close options
   * keepBrowser=false (default): kill Chrome — 「释放执行资源」
   * keepBrowser=true: leave Chrome on CDP — rare soft close
   * @returns {Promise<{ sessionId: string, slotIndex: number, closed: boolean, keepBrowser: boolean, cdpPort: number|null }>} close result
   */
  async close(sessionId, { keepBrowser = false } = {}) {
    // Same per-session chain as attachBib: wait out any in-flight attach, then
    // hold the chain ourselves so an attach that starts during close runs only
    // after close finished (and then fails the sessions.has check). Chain-tail
    // await, not a re-entrant mutex — attachBib/_attachBibLocked never call
    // close, so this wait cannot form a deadlock cycle.
    const prev = this._attachLocks.get(sessionId) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    const tail = prev.then(() => gate);
    this._attachLocks.set(sessionId, tail);
    await prev.catch(() => {});

    try {
      return await this._closeLocked(sessionId, { keepBrowser: !!keepBrowser });
    } finally {
      release();
      if (this._attachLocks.get(sessionId) === tail) {
        // Last lock holder gone — drop the entry so it does not leak.
        this._attachLocks.delete(sessionId);
      }
    }
  }

  /**
   * Internal: close body while holding the per-session attach lock (called by close).
   * @param {string} sessionId session id
   * @param {{ keepBrowser?: boolean }} [opts] close options
   * @param {boolean} [opts.keepBrowser] whether to keep the browser alive
   * @returns {Promise<{ sessionId: string, slotIndex: number, closed: boolean, keepBrowser: boolean, cdpPort: number|null }>} close result
   */
  async _closeLocked(sessionId, { keepBrowser = false } = {}) {
    const slot = this.sessions.get(sessionId);
    if (!slot) return { sessionId, closed: false };
    await this.detachBib(sessionId, { crashed: false }).catch(() => {});
    const closed = await slot.close({ keepBrowser: !!keepBrowser });
    this.sessions.delete(sessionId);
    this.emitToControlPlane({
      event: 'session.closed',
      session_id: sessionId,
      data: {
        sessionId,
        slotIndex: slot.slotIndex,
        keepBrowser: !!keepBrowser,
        cdpPort: closed?.cdpPort ?? slot.cdpPort ?? null,
      },
    });
    return {
      sessionId,
      slotIndex: slot.slotIndex,
      closed: true,
      keepBrowser: !!keepBrowser,
      cdpPort: closed?.cdpPort ?? null,
    };
  }

  /**
   * List all capacity slots (free + occupied) with current CDP port.
   * @returns {{ sessionId: string|null, slotIndex: number, ready: boolean, busy: boolean, cdpPort: number|null }[]} array of slot status objects
   */
  list() {
    return this.slots.map((slot) => ({
      sessionId: slot.sessionId || null,
      slotIndex: slot.slotIndex,
      ready: !!slot.ready,
      busy: !!slot.busy,
      cdpPort: slot.cdpPort ?? null,
    }));
  }

  /**
   * Attach a BiB (browser-in-browser) screencast bridge to a session.
   * Serialized per session to avoid orphan screencast producers.
   * @param {object} opts opts
   * @param {string} opts.sessionId opts.session id
   * @param {string} opts.remoteSessionUuid opts.remote session uuid
   * @param {number} [opts.quality] quality
   * @param {number} [opts.viewportW] viewport w
   * @param {number} [opts.viewportH] viewport h
   * @param {number} [opts.deviceScaleFactor] device scale factor
   * @param {boolean} [opts.resize] resize
   * @returns {Promise<{ attached: boolean, tabs: object[], activeTargetId: string|null }>} attach result with tabs and active target
   */
  async attachBib({
    sessionId,
    remoteSessionUuid,
    quality,
    viewportW,
    viewportH,
    deviceScaleFactor,
    resize,
  }) {
    const prev = this._attachLocks.get(sessionId) || Promise.resolve();
    let release;
    const gate = new Promise((r) => { release = r; });
    const tail = prev.then(() => gate);
    this._attachLocks.set(sessionId, tail);
    await prev.catch(() => {});

    try {
      return await this._attachBibLocked({
        sessionId,
        remoteSessionUuid,
        quality,
        viewportW,
        viewportH,
        deviceScaleFactor,
        resize,
      });
    } finally {
      release();
      if (this._attachLocks.get(sessionId) === tail) {
        // No newer waiter appended while we ran — drop the entry so it does not leak.
        this._attachLocks.delete(sessionId);
      }
    }
  }

  /**
   * Internal: attach BiB while holding the per-session lock (called by attachBib).
   * @param {object} opts attach options
   * @param {string} opts.sessionId session id
   * @param {string} opts.remoteSessionUuid remote session uuid
   * @param {number} [opts.quality] screencast quality
   * @param {number} [opts.viewportW] viewport width
   * @param {number} [opts.viewportH] viewport height
   * @param {number} [opts.deviceScaleFactor] device scale factor
   * @param {boolean} [opts.resize] whether to resize
   * @returns {Promise<{ attached: boolean, tabs: object[], activeTargetId: string|null }>} attach result
   */
  async _attachBibLocked({
    sessionId,
    remoteSessionUuid,
    quality,
    viewportW,
    viewportH,
    deviceScaleFactor,
    resize,
  }) {
    if (!this.sessions.has(sessionId)) throw new Error(`Unknown session ${sessionId}`);
    if (!remoteSessionUuid) throw new Error('remoteSessionUuid required for attachBib');
    if (!this.sendBinary) throw new Error('sendBinary callback missing');

    const slot = this.sessions.get(sessionId);

    // Replace existing bib (idempotent attach) — force dispose so screencast cannot orphan.
    const existing = this.bibs.get(sessionId);
    if (existing) {
      this.bibs.delete(sessionId);
      try {
        await existing.detach();
      } catch {
        try { existing._disposed = true; } catch {}
        try { existing.screencastOn = false; } catch {}
        try { existing.sendBinary = () => {}; } catch {}
      }
    }

    const bib = new BibBridge({
      sessionId,
      remoteSessionUuid,
      sendBinary: this.sendBinary,
    });
    try {
      await bib.attach({
        quality,
        viewportW,
        viewportH,
        deviceScaleFactor,
        resize,
        cdpPort: slot.cdpPort,
      });
    } catch (err) {
      try { await bib.detach(); } catch {}
      this.emitToControlPlane({
        event: 'session.bib_error',
        session_id: sessionId,
        data: {
          sessionId,
          remoteSessionUuid,
          error: err?.message || String(err),
        },
      });
      throw err;
    }

    this.bibs.set(sessionId, bib);
    let tabsPayload = { tabs: [], activeTargetId: bib.activeTargetId };
    try {
      tabsPayload = await bib.listTabs();
    } catch {}
    this.emitToControlPlane({
      event: 'session.bib_ready',
      session_id: sessionId,
      data: {
        sessionId,
        remoteSessionUuid,
        viewportW: bib.viewport.w,
        viewportH: bib.viewport.h,
        activeTargetId: bib.activeTargetId,
        tabs: tabsPayload.tabs || [],
      },
    });
    return { attached: true, tabs: tabsPayload.tabs, activeTargetId: bib.activeTargetId };
  }

  /**
   * List open page tabs for the BiB attached to a session.
   * @param {string} sessionId session id
   * @returns {Promise<{ tabs: object[], activeTargetId: string|null }>} tab list and active target
   */
  async bibListTabs(sessionId) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return { tabs: [], activeTargetId: null };
    return bib.listTabs();
  }

  /**
   * Switch BiB screencast to targetId and ask Agent to switch_to_tab by url/pageId.
   * @param {string} sessionId session id
   * @param {{ targetId?: string, url?: string, pageId?: string }} [opts] tab switch options
   * @returns {Promise<{ ok: boolean, tabs: object[], activeTargetId: string|null }>} switch result with updated tabs
   */
  async bibSwitchTab(sessionId, { targetId, url, pageId } = {}) {
    const bib = this.bibs.get(sessionId);
    if (!bib) throw new Error('BiB not attached');
    if (!targetId) throw new Error('targetId required');

    const result = await bib.switchToTarget(targetId);
    const tabsPayload = await bib.listTabs().catch(() => ({ tabs: [], activeTargetId: targetId }));

    // Align Agent current page with the streamed tab.
    try {
      const slot = this.sessions.get(sessionId);
      if (slot?.ready) {
        slot.writeEvent('switch_tab', {
          targetId,
          url: url || tabsPayload.tabs?.find((t) => t.targetId === targetId)?.url || '',
          pageId: pageId ?? null,
        });
      }
    } catch (err) {
      console.warn('[session-manager] switch_tab to agent failed:', err.message);
    }

    this.emitToControlPlane({
      event: 'session.bib_tabs',
      session_id: sessionId,
      data: {
        sessionId,
        tabs: tabsPayload.tabs || [],
        activeTargetId: tabsPayload.activeTargetId || targetId,
      },
    });

    return {
      ok: true,
      ...result,
      tabs: tabsPayload.tabs || [],
      activeTargetId: tabsPayload.activeTargetId || targetId,
    };
  }

  /**
   * Detach the BiB bridge for a session (stops screencast, emits session.bib_detached).
   * @param {string} sessionId session id
   * @param {{ crashed?: boolean }} [opts] detach options
   * @param {boolean} [opts.crashed] whether the session crashed
   * @returns {Promise<{ closed: boolean }>} detach result
   */
  async detachBib(sessionId, { crashed = false } = {}) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return { closed: false };
    this.bibs.delete(sessionId);
    await bib.detach().catch(() => {});
    this.emitToControlPlane({
      event: 'session.bib_detached',
      session_id: sessionId,
      data: { sessionId, crashed: !!crashed },
    });
    return { closed: true };
  }

  /**
   * (Re)start the BiB screencast for a session.
   * @param {string} sessionId session id
   * @param {object} [opts] screencast start options
   * @returns {Promise<void>}
   */
  async bibStart(sessionId, opts = {}) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return;
    // Prefer restart so a stalled CDP screencast recovers after agent steps
    if (typeof bib.restartScreencast === 'function') {
      await bib.restartScreencast().catch(() => bib.startScreencast(opts).catch(() => {}));
    } else {
      await bib.startScreencast(opts).catch(() => {});
    }
  }

  /**
   * Stop the BiB screencast for a session.
   * @param {string} sessionId session id
   * @returns {Promise<void>}
   */
  async bibStop(sessionId) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return;
    await bib.stopScreencast().catch(() => {});
  }

  /**
   * Resolve form element by label / actionType+params on the attached BiB page.
   * @param {string} sessionId session id
   * @param {{ labelText?: string, actionType?: string, params?: object, mode?: string, pageLabel?: string, requestId?: string }} [opts] element resolution options
   * @returns {Promise<{ requestId: string|null, sessionId: string, element: object|null, matchedLabel: string|null, ambiguous: boolean, matches: object[]|null, error: string|null }>} resolution result with element or error
   */
  async bibResolveElement(sessionId, { labelText, actionType, params, mode, pageLabel, requestId } = {}) {
    try {
      const bib = this.bibs.get(sessionId);
      if (!bib) {
        return {
          requestId: requestId || null,
          sessionId,
          element: null,
          matchedLabel: null,
          ambiguous: false,
          matches: null,
          error: 'BiB not attached - call record/prepare (stream) first',
        };
      }
      const resolved = await bib.resolveByLabel(labelText, { actionType, params, mode, pageLabel });
      if (resolved?.ambiguous) {
        return {
          requestId: requestId || null,
          sessionId,
          element: null,
          matchedLabel: null,
          ambiguous: true,
          matches: resolved.matches || [],
          ...(resolved.truncated ? { truncated: true } : {}),
          error: null,
        };
      }
      return {
        requestId: requestId || null,
        sessionId,
        element: resolved.element || null,
        matchedLabel: resolved.matchedLabel || null,
        ambiguous: false,
        matches: null,
        error: null,
      };
    } catch (err) {
      return {
        requestId: requestId || null,
        sessionId,
        element: null,
        matchedLabel: null,
        ambiguous: false,
        matches: null,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * Capture a phase-highlight screenshot via the attached BiB.
   * @param {string} sessionId session id
   * @param {{ requestId?: string }} [opts] capture options
   * @returns {Promise<{ requestId: string|null, sessionId: string, pngBase64: string|null, meta: object|null, error: string|null }>} capture result
   */
  async bibPhaseHighlightCapture(sessionId, { requestId } = {}) {
    try {
      const bib = this.bibs.get(sessionId);
      if (!bib) {
        return {
          requestId: requestId || null,
          sessionId,
          pngBase64: null,
          meta: null,
          error: 'BiB not attached - call record/prepare (stream) first',
        };
      }
      const captured = await bib.capturePhaseHighlight();
      return {
        requestId: requestId || null,
        sessionId,
        pngBase64: captured.pngBase64,
        meta: captured.meta || null,
        error: null,
      };
    } catch (err) {
      return {
        requestId: requestId || null,
        sessionId,
        pngBase64: null,
        meta: null,
        error: err?.message || String(err),
      };
    }
  }

  /**
   * Forward an optional client ack to the BiB screencast (kept for compatibility).
   * @param {string} sessionId session id
   * @param {object} [payload] ack payload
   * @returns {Promise<void>}
   */
  async bibAck(sessionId, payload = {}) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return;
    await bib.ack(payload).catch(() => {});
  }

  /**
   * Handle a remote input event (mouse/key/text/navigate/clipboard) via the attached BiB.
   * @param {string} sessionId session id
   * @param {object} [payload] input event payload
   * @returns {Promise<object|void>} input handling result or void when no BiB is attached
   */
  async bibInput(sessionId, payload = {}) {
    const bib = this.bibs.get(sessionId);
    if (!bib) {
      if (payload?.kind === 'clipboard') {
        return {
          clipboard: true,
          requestId: payload.requestId || null,
          ok: false,
          text: '',
          reason: 'not_attached',
        };
      }
      return;
    }
    return bib.handleInput(payload);
  }
}

/**
 * Factory: create a SessionManager with the configured EXECUTOR_CAPACITY.
 * @param {(msg: object) => void} emit emit
 * @param {(packet: Buffer) => void} sendBinary send binary
 * @returns {SessionManager} a new SessionManager instance
 */
export function createSessionManager(emit, sendBinary) {
  return new SessionManager(EXECUTOR_CAPACITY, emit, sendBinary);
}
