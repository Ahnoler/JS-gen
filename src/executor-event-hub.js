/**
 * Per-session event hub for executor ↔ control plane routing.
 */
import { EventEmitter } from 'events';

/** @type {Map<string, EventEmitter>} */
const hubs = new Map();

/** @param {string} sessionId */
export function getSessionHub(sessionId) {
  if (!hubs.has(sessionId)) {
    hubs.set(sessionId, new EventEmitter());
  }
  return hubs.get(sessionId);
}

/** @param {string} sessionId @param {string} type @param {object} payload */
export function emitSessionEvent(sessionId, type, payload) {
  getSessionHub(sessionId).emit(type, payload);
  getSessionHub(sessionId).emit('*', { type, payload });
}

/** @param {{ type: string, payload?: object }} msg */
export function routeExecutorInbound(msg) {
  const { type, payload = {} } = msg;
  const sessionId = payload.sessionId;
  if (sessionId) {
    emitSessionEvent(sessionId, type, payload);
  }
}

/** @param {string} sessionId */
export function removeSessionHub(sessionId) {
  const hub = hubs.get(sessionId);
  if (hub) {
    hub.removeAllListeners();
    hubs.delete(sessionId);
  }
}

/**
 * @param {string} sessionId
 * @param {string} type
 * @param {(payload: object) => void} handler
 * @returns {() => void}
 */
export function onSessionEvent(sessionId, type, handler) {
  const hub = getSessionHub(sessionId);
  hub.on(type, handler);
  return () => hub.off(type, handler);
}

/**
 * Wait for one event on a session hub.
 * @param {string} sessionId
 * @param {string} type
 * @param {number} [timeoutMs]
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
    timer = setTimeout(() => {
      finish(() => reject(new Error(`Timeout waiting for ${type}`)));
    }, timeoutMs);
    hub.once(type, onEvent);
    // Drop the loser of Promise.race without rejecting (avoids unhandled timeout).
    cancel = () => finish(() => {});
  });
  promise.cancel = cancel;
  return promise;
}
