/**
 * Manages session slots on the executor (capacity-bound).
 */
import { SessionSlot } from './session-slot.js';
import { EXECUTOR_CAPACITY } from './config.js';
import { BibBridge } from './bib-bridge.js';

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

  /**
   * @param {object} payload
   * @param {string} payload.sessionId
   */
  async open(payload) {
    if (this.sessions.has(payload.sessionId)) {
      const existing = this.sessions.get(payload.sessionId);
      return { sessionId: payload.sessionId, slotIndex: existing.slotIndex, reused: true };
    }

    const slot = this._findFreeSlot();
    if (!slot) throw new Error('No free executor slots');

    const result = await slot.open(payload);
    this.sessions.set(payload.sessionId, slot);

    this.emitToControlPlane({
      event: 'session.ready',
      session_id: payload.sessionId,
      data: { sessionId: payload.sessionId, slotIndex: result.slotIndex },
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
    if (!this.sessions.has(sessionId)) throw new Error(`Unknown session ${sessionId}`);
    if (!remoteSessionUuid) throw new Error('remoteSessionUuid required for attachBib');
    if (!this.sendBinary) throw new Error('sendBinary callback missing');

    // Replace existing bib (idempotent attach)
    const existing = this.bibs.get(sessionId);
    if (existing) await existing.detach().catch(() => {});

    const bib = new BibBridge({
      sessionId,
      remoteSessionUuid,
      sendBinary: this.sendBinary,
    });
    await bib.attach({
      quality,
      viewportW,
      viewportH,
      deviceScaleFactor,
      resize,
    });

    this.bibs.set(sessionId, bib);
    this.emitToControlPlane({
      event: 'session.bib_ready',
      session_id: sessionId,
      data: {
        sessionId,
        remoteSessionUuid,
        viewportW: bib.viewport.w,
        viewportH: bib.viewport.h,
      },
    });
    return { attached: true };
  }

  async detachBib(sessionId, { crashed = false } = {}) {
    const bib = this.bibs.get(sessionId);
    if (!bib) return { closed: false };
    await bib.detach().catch(() => {});
    this.bibs.delete(sessionId);
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
