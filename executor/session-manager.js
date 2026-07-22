/**
 * Manages session slots on the executor (capacity-bound).
 */
import { SessionSlot } from './session-slot.js';
import { EXECUTOR_CAPACITY, EXECUTOR_CDP_PORT_BASE } from './config.js';
import { BibBridge } from './bib-bridge.js';
import { discoverAllCdpInRange } from '../src/cdp/discover.js';

export class SessionManager {
  /**
   * @param {number} capacity
   * @param {(msg: object) => void} emitToControlPlane
   * @param {(packet: Buffer) => void} sendBinary
   */
  constructor(capacity, emitToControlPlane, sendBinary) {
    this.capacity = capacity;
    /** @type {Map<string, SessionSlot>} */
    this.sessions = new Map();
    /** @type {SessionSlot[]} */
    this.slots = Array.from({ length: capacity }, (_, i) => new SessionSlot(i, (msg) => {
      emitToControlPlane(msg);
    }));
    this.emitToControlPlane = emitToControlPlane;
    this.sendBinary = sendBinary;

    /** @type {Map<string, BibBridge>} */
    this.bibs = new Map();
    /** Serialize attachBib per sessionId to avoid orphan screencast producers. */
    /** @type {Map<string, Promise<unknown>>} */
    this._attachLocks = new Map();
  }

  _findFreeSlot() {
    for (const slot of this.slots) {
      if (!slot.sessionId) return slot;
    }
    return null;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  /** CDP ports currently claimed by live slots. */
  occupiedCdpPorts() {
    const ports = new Set();
    for (const slot of this.slots) {
      if (slot.sessionId && slot.cdpPort != null) ports.add(Number(slot.cdpPort));
    }
    return ports;
  }

  /**
   * List live CDP Chromes on this host; exclude ports already bound to a live slot.
   * @returns {Promise<{ browsers: object[], occupiedPorts: number[] }>}
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
   * @param {object} payload
   * @param {string} payload.sessionId
   * @param {string} [payload.model]
   * @param {string} [payload.cdpUrl]
   * @param {number} [payload.cdpPort]
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
   * @param {string} sessionId
   * @param {string} stdinEvent e.g. step, manual_record_start
   * @param {object} data
   */
  forward(sessionId, stdinEvent, data = {}) {
    const slot = this.sessions.get(sessionId);
    if (!slot) throw new Error(`Unknown session ${sessionId}`);
    slot.writeEvent(stdinEvent, data);
    return { sessionId, slotIndex: slot.slotIndex };
  }

  async close(sessionId) {
    const slot = this.sessions.get(sessionId);
    if (!slot) return { sessionId, closed: false };
    await this.detachBib(sessionId, { crashed: false }).catch(() => {});
    await slot.close();
    this.sessions.delete(sessionId);
    this.emitToControlPlane({
      event: 'session.closed',
      session_id: sessionId,
      data: { sessionId, slotIndex: slot.slotIndex },
    });
    return { sessionId, slotIndex: slot.slotIndex, closed: true };
  }

  list() {
    return [...this.sessions.entries()].map(([sessionId, slot]) => ({
      sessionId,
      slotIndex: slot.slotIndex,
      ready: slot.ready,
      busy: slot.busy,
      cdpPort: slot.cdpPort ?? null,
    }));
  }

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
    this._attachLocks.set(sessionId, prev.then(() => gate));
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
      if (this._attachLocks.get(sessionId) === gate) {
        // chain continues via next waiter; clear if we are tail
      }
    }
  }

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

  async bibListTabs(sessionId) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return { tabs: [], activeTargetId: null };
    return bib.listTabs();
  }

  /**
   * Switch BiB screencast to targetId and ask Agent to switch_to_tab by url/pageId.
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

  async bibStop(sessionId) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return;
    await bib.stopScreencast().catch(() => {});
  }

  /**
   * Resolve form element by label_text on the attached BiB page.
   * @param {string} sessionId
   * @param {{ labelText?: string, requestId?: string }} [opts]
   */
  async bibResolveElement(sessionId, { labelText, requestId } = {}) {
    try {
      const bib = this.bibs.get(sessionId);
      if (!bib) {
        return {
          requestId: requestId || null,
          sessionId,
          element: null,
          matchedLabel: null,
          error: 'BiB not attached — call record/prepare (stream) first',
        };
      }
      const resolved = await bib.resolveByLabel(labelText);
      return {
        requestId: requestId || null,
        sessionId,
        element: resolved.element || null,
        matchedLabel: resolved.matchedLabel || null,
        error: null,
      };
    } catch (err) {
      return {
        requestId: requestId || null,
        sessionId,
        element: null,
        matchedLabel: null,
        error: err?.message || String(err),
      };
    }
  }

  async bibAck(sessionId, payload = {}) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return;
    await bib.ack(payload).catch(() => {});
  }

  async bibInput(sessionId, payload = {}) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return;
    return bib.handleInput(payload);
  }
}

/** @param {(msg: object) => void} emit */
export function createSessionManager(emit, sendBinary) {
  return new SessionManager(EXECUTOR_CAPACITY, emit, sendBinary);
}
