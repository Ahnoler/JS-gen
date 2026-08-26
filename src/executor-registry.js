/**
 * In-memory registry of live executor WebSocket connections.
 * Server never initiates outbound connections — only holds executor-initiated WS.
 */

/** @typedef {{ ws: import('ws').WebSocket|null, nodeId: number, lastSeen: number, graceTimer: ReturnType<typeof setTimeout>|null }} RegistryEntry */

/** @type {Map<string, RegistryEntry>} */
const nodes = new Map();

/**
 * Attach or replace a live connection for nodeUuid (idempotent reconnect).
 * @param {string} nodeUuid node uuid
 * @param {import('ws').WebSocket} ws ws
 * @param {number} nodeId node id
 */
export function attach(nodeUuid, ws, nodeId) {
  const existing = nodes.get(nodeUuid);
  if (existing?.graceTimer) {
    clearTimeout(existing.graceTimer);
  }
  if (existing?.ws && existing.ws !== ws && existing.ws.readyState === 1) {
    try {
      existing.ws.close(4000, 'replaced by new connection');
    } catch {}
  }

  nodes.set(nodeUuid, {
    ws,
    nodeId,
    lastSeen: Date.now(),
    graceTimer: null,
  });
  ws._nodeUuid = nodeUuid;
  ws._nodeId = nodeId;
}

/**
 * Remove live connection. Optionally start grace timer before full removal.
 * @param {string} nodeUuid node uuid
 * @param {{ immediate?: boolean, graceMs?: number, onGraceExpired?: (nodeUuid: string, nodeId: number) => void }} [opts] detach options
 */
export function detach(nodeUuid, opts = {}) {
  const entry = nodes.get(nodeUuid);
  if (!entry) return;

  if (opts.immediate || !opts.onGraceExpired) {
    if (entry.graceTimer) clearTimeout(entry.graceTimer);
    nodes.delete(nodeUuid);
    return;
  }

  entry.ws = null;
  if (entry.graceTimer) clearTimeout(entry.graceTimer);
  entry.graceTimer = setTimeout(() => {
    const current = nodes.get(nodeUuid);
    if (current?.graceTimer === entry.graceTimer) {
      nodes.delete(nodeUuid);
      opts.onGraceExpired?.(nodeUuid, entry.nodeId);
    }
  }, opts.graceMs ?? 45000);
}

/**
 * @param {string} nodeUuid node uuid
 * @returns {RegistryEntry|undefined} result
 */
export function get(nodeUuid) {
  return nodes.get(nodeUuid);
}

/**
 * @returns {{ nodeUuid: string, nodeId: number, connected: boolean, lastSeen: number }[]} array of node status objects
 */
export function list() {
  const out = [];
  for (const [nodeUuid, entry] of nodes) {
    out.push({
      nodeUuid,
      nodeId: entry.nodeId,
      connected: !!(entry.ws && entry.ws.readyState === 1),
      lastSeen: entry.lastSeen,
    });
  }
  return out;
}

/**
 * Send JSON message on existing executor connection (never dials out).
 * @param {string} nodeUuid node uuid
 * @param {string} type type
 * @param {Record<string, unknown>} [payload] payload
 * @returns {boolean} true if the message was sent, false if the node is not connected or send failed
 */
export function send(nodeUuid, type, payload = {}) {
  const entry = nodes.get(nodeUuid);
  if (!entry?.ws || entry.ws.readyState !== 1) return false;
  try {
    entry.ws.send(JSON.stringify({ type, payload }));
    entry.lastSeen = Date.now();
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} nodeUuid node uuid
 */
export function touch(nodeUuid) {
  const entry = nodes.get(nodeUuid);
  if (entry) entry.lastSeen = Date.now();
}

/**
 * @param {string} nodeUuid node uuid
 * @returns {boolean} result
 */
export function isConnected(nodeUuid) {
  const entry = nodes.get(nodeUuid);
  return !!(entry?.ws && entry.ws.readyState === 1);
}

/** Clear all entries (shutdown). */
export function clearAll() {
  for (const entry of nodes.values()) {
    if (entry.graceTimer) clearTimeout(entry.graceTimer);
  }
  nodes.clear();
}
