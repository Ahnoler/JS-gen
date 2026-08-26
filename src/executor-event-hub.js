/**
 * Per-session event hub for executor ↔ control plane routing.
 */
import { EventEmitter } from 'events';

/** @type {Map<string, EventEmitter>} */
const hubs = new Map();

/**
 * @param {string} sessionId session id
 * @returns {import('events').EventEmitter} result
 */
export function getSessionHub(sessionId) {
  if (!hubs.has(sessionId)) {
    hubs.set(sessionId, new EventEmitter());
  }
  return hubs.get(sessionId);
}

/**
 * @param {string} sessionId session id
 * @param {string} type type
 * @param {object} payload payload
 * @returns {void} result
 */
export function emitSessionEvent(sessionId, type, payload) {
  getSessionHub(sessionId).emit(type, payload);
  getSessionHub(sessionId).emit('*', { type, payload });
}

/**
 * @param {{ type: string, payload?: object }} msg inbound executor message with optional sessionId in payload
 * @returns {void}
 */
export function routeExecutorInbound(msg) {
  const { type, payload = {} } = msg;
  const sessionId = payload.sessionId;
  if (sessionId) {
    emitSessionEvent(sessionId, type, payload);
  }
}

/**
 * @param {string} sessionId session id
 * @returns {void} result
 */
export function removeSessionHub(sessionId) {
  const hub = hubs.get(sessionId);
  if (hub) {
    hub.removeAllListeners();
    hubs.delete(sessionId);
  }
}

/**
 * @param {string} sessionId session id
 * @param {string} type type
 * @param {(payload: object) => void} handler handler
 * @returns {() => void} unsubscribe function
 */
export function onSessionEvent(sessionId, type, handler) {
  const hub = getSessionHub(sessionId);
  hub.on(type, handler);
  return () => hub.off(type, handler);
}

/**
 * Wait for one event on a session hub.
 * @param {string} sessionId session id
 * @param {string} type type
 * @param {number|null} [timeoutMs] pass null to wait indefinitely.
 * @returns {Promise<object>} the event payload
 */
export function waitForSessionEvent(sessionId, type, timeoutMs = 120000) {
  let cancel = () => {};
  const promise = new Promise((resolve, reject) => {
    const hub = getSessionHub(sessionId);
    let settled = false;
    let timer = null;
    function finish(fn) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      hub.off(type, onEvent);
      fn();
    }
    function onEvent(payload) {
      finish(() => resolve(payload));
    }
    if (timeoutMs != null && Number.isFinite(Number(timeoutMs))) {
      timer = setTimeout(() => {
        finish(() => reject(new Error(`Timeout waiting for ${type}`)));
      }, Number(timeoutMs));
    }
    hub.once(type, onEvent);
    // Drop the loser of Promise.race without rejecting (avoids unhandled timeout).
    cancel = () => finish(() => {});
  });
  promise.cancel = cancel;
  return promise;
}
