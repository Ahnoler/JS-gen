/**
 * In-memory registry of live executor WebSocket connections.
 * Server never initiates outbound connections — only holds executor-initiated WS.
 */

/** @typedef {{ ws: import('ws').WebSocket|null, nodeId: number, pid: number|null, lastSeen: number, graceTimer: ReturnType<typeof setTimeout>|null }} RegistryEntry */

/** @type {Map<string, RegistryEntry>} */
const nodes = new Map();

/**
 * Attach or replace a live connection for nodeUuid (idempotent reconnect).
 *
 * 同 uuid 异 pid 双活防护：现役连接仍然打开（readyState OPEN）且其 pid 与新连接的
 * pid 不同（两个进程同时以同一 nodeUuid 注册）→ 拒绝新连接：向其发送
 * `executor.error` 后以 4001 关闭，返回 false；注册表不受影响。
 * 同 pid（同一进程重连，如半开连接重连）或旧 entry 已断开（grace 期）→
 * 维持既有顶替行为（旧连接 close 4000 后由其 close 回调做身份校验）。
 * @param {string} nodeUuid node uuid
 * @param {import('ws').WebSocket} ws ws
 * @param {number} nodeId node id
 * @param {number|string|null} [pid] executor agent 进程 id（register payload 透传，用于双活检测；缺省视为旧版 agent，维持顶替行为）
 * @returns {boolean} true if attached; false when rejected (nodeUuid already served by a different live pid)
 */
export function attach(nodeUuid, ws, nodeId, pid = null) {
  const existing = nodes.get(nodeUuid);
  const newPid = pid == null ? null : Number(pid);
  if (
    existing?.ws && existing.ws !== ws && existing.ws.readyState === 1 &&
    existing.pid != null && newPid != null && newPid !== existing.pid
  ) {
    // 同 nodeUuid 已有另一进程的现役连接：拒绝双活注册（非 4000，避免被 agent
    // 当作普通"被顶替"；close 前先回发一条 executor.error 说明原因）。
    try {
      ws.send(JSON.stringify({
        type: 'executor.error',
        payload: {
          error: `nodeUuid ${nodeUuid} is already served by another executor process (pid ${existing.pid})`,
        },
      }));
    } catch {}
    try {
      ws.close(4001, 'duplicate executor process for this node');
    } catch {}
    return false;
  }

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
    pid: newPid,
    lastSeen: Date.now(),
    graceTimer: null,
  });
  ws._nodeUuid = nodeUuid;
  ws._nodeId = nodeId;
  return true;
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
