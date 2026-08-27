/**
 * WebSocket endpoint for executor agents: WS /ws/executor
 * Executors connect out; server never dials executors.
 */
import { WebSocketServer } from 'ws';
import { EXECUTOR_TOKEN } from '../config/config.js';
import * as registry from './executor-registry.js';
import * as executorService from './services/executor-node-service.js';
import { routeExecutorInbound } from './executor-event-hub.js';
import { broadcast, broadcastBinary } from './ws-server.js';

let wss = null;

/**
 * @param {import('http').IncomingMessage} req req
 * @returns {string} result
 */
export function getExecutorTokenFromRequest(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const queryToken = url.searchParams.get('token');
  const headerToken = req.headers['x-executor-token'];
  return String(queryToken || headerToken || '');
}

/**
 * @param {import('http').IncomingMessage} req req
 * @returns {boolean} result
 */
export function validateExecutorToken(req) {
  if (!EXECUTOR_TOKEN) return false;
  return getExecutorTokenFromRequest(req) === EXECUTOR_TOKEN;
}

/**
 * @param {import('net').Socket} socket socket
 * @param {number} code code
 * @param {string} message message
 * @returns {void} result
 */
export function rejectUpgrade(socket, code, message) {
  socket.write(`HTTP/1.1 ${code} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function sendJson(ws, type, payload = {}) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, payload }));
}

async function handleRegister(ws, payload) {
  const { nodeUuid, name, host, capacity, labels, agentVersion } = payload || {};
  if (!nodeUuid || !name) {
    sendJson(ws, 'executor.error', { error: 'nodeUuid and name are required' });
    return;
  }

  const node = await executorService.register({
    nodeUuid,
    name,
    host,
    capacity,
    labels,
    agentVersion,
  });
  registry.attach(nodeUuid, ws, node.id);
  sendJson(ws, 'executor.registered', {
    nodeId: node.id,
    nodeUuid: node.nodeUuid,
    status: node.status,
  });

  // Rebuild in-memory BiB bindings for active remote_sessions on this node
  // (control-plane restart otherwise leaves DB rows orphaned from liveByRemoteSessionId).
  try {
    const remoteSessionDao = await import('./dao/remote-session-dao.js');
    const remoteSessionService = await import('./services/remote-session-service.js');
    const rows = await remoteSessionDao.listByNode(node.id, ['active']);
    /** Per trajectory keep only the newest active row — close older duplicates in DB. */
    const pickRows = [];
    const byTraj = new Map();
    for (const row of rows) {
      const tid = row.trajectoryId != null ? Number(row.trajectoryId) : null;
      if (Number.isFinite(tid) && tid > 0) {
        const prev = byTraj.get(tid);
        if (!prev || row.id > prev.id) byTraj.set(tid, row);
      } else {
        pickRows.push(row);
      }
    }
    pickRows.push(...byTraj.values());
    const keepIds = new Set(pickRows.map((r) => r.id));

    let closedStale = 0;
    for (const row of rows) {
      if (keepIds.has(row.id)) continue;
      const tid = row.trajectoryId != null ? Number(row.trajectoryId) : null;
      if (!(Number.isFinite(tid) && tid > 0)) continue;
      try {
        await remoteSessionDao.close(row.id, { crashed: false });
        remoteSessionService.clearLiveBinding(row.id);
        await remoteSessionService.unmountTrajectoriesFromRemoteSession(row.id).catch(() => {});
        closedStale += 1;
      } catch (err) {
        console.warn(`[executor-ws] close stale remote_session #${row.id} failed:`, err.message);
      }
    }

    let restored = 0;
    for (const row of pickRows) {
      const binding = remoteSessionService.restoreLiveBindingFromRow(row, {
        nodeUuid: node.nodeUuid,
        attached: true,
      });
      if (binding?.attached) restored += 1;
    }
    if (restored || closedStale) {
      console.log(
        `[executor-ws] restored ${restored} live BiB binding(s) for ${nodeUuid}`
        + (closedStale ? ` (closed ${closedStale} stale duplicate(s))` : ''),
      );
    }
  } catch (err) {
    console.warn('[executor-ws] live binding restore skipped:', err.message);
  }

  // Orphan reconcile: after a control-plane restart, live executor sessions
  // whose remote_session rows were crashed (boot sweep) would otherwise occupy
  // slots forever. Close the Python with keepBrowser=true → Chrome becomes a
  // reusable orphan CDP browser.
  try {
    const { reconcileOrphanSessions } = await import('./services/executor-orphan-session-service.js');
    const orphanResult = await reconcileOrphanSessions(node);
    if (orphanResult.closed) {
      console.log(`[executor-ws] closed ${orphanResult.closed} orphan executor session(s) for ${nodeUuid}`);
    }
  } catch (err) {
    console.warn('[executor-ws] orphan session reconcile skipped:', err.message);
  }
}

async function handleMessage(ws, msg) {
  const { type, payload } = msg;

  if (type?.startsWith('executor.')) {
    switch (type) {
      case 'executor.register':
        await handleRegister(ws, payload);
        return;
      case 'executor.heartbeat':
        if (ws._nodeUuid) {
          await executorService.heartbeat(ws._nodeUuid);
          sendJson(ws, 'executor.heartbeat.ack', { ok: true });
        } else {
          sendJson(ws, 'executor.error', { error: 'not registered' });
        }
        return;
      case 'executor.unregister':
        if (ws._nodeUuid) {
          const nodeUuid = ws._nodeUuid;
          ws._nodeUuid = null;
          ws._nodeId = null;
          await executorService.unregister(nodeUuid);
          sendJson(ws, 'executor.unregistered', { nodeUuid });
          ws.close(1000, 'unregistered');
        } else {
          sendJson(ws, 'executor.error', { error: 'not registered' });
        }
        return;
      default:
        break;
    }
    return;
  }

  // Agent → control plane (session events, stdout relay)
  routeExecutorInbound(msg);
  if (type === 'session.agent_stderr' && Array.isArray(payload?.lines) && payload.sessionId) {
    import('./services/agent-stderr-log-service.js')
      .then(({ appendLines }) => appendLines(payload.sessionId, payload.lines))
      .catch((err) => console.warn('[executor-ws] agent_stderr append failed:', err?.message || err));
    return;
  }
  if (payload?.sessionId) {
    if (type === 'action_resync') {
      // 断线重连补拉审计：executor 已对 session 重新下发 get_action_log（全量快照幂等补写），
      // 旁路记 memory_event(connection_resync)，失败不影响主链路。
      import('./memory/memory-service.js')
        .then(({ ingestEvents }) =>
          ingestEvents({
            events: [
              {
                eventType: 'connection_resync',
                source: 'executor',
                sessionId: payload.sessionId,
                payload: {
                  sessionIds: payload.sessionIds || [],
                  nodeUuid: payload.nodeUuid || null,
                  at: payload.at || null,
                },
              },
            ],
          }),
        )
        .catch((err) =>
          console.warn('[executor-ws] memory connection_resync event failed:', err?.message || err),
        );
      return;
    }
    if (type === 'action_log_sync' || type === 'manual_action_recorded') {
      broadcast(type, { ...payload, sessionId: payload.sessionId });
    }
    if (type === 'manual_record_status') {
      broadcast('manual_record_status', { ...payload, sessionId: payload.sessionId });
    }
    if (type === 'session.bib_tabs' || type === 'session.bib_ready') {
      broadcast('remote:tabs', {
        sessionId: payload.sessionId,
        tabs: payload.tabs || [],
        activeTargetId: payload.activeTargetId || null,
        switched: !!payload.switched,
      });
    }
    if (type === 'session.bib_clipboard') {
      broadcast('remote:clipboard', {
        sessionId: payload.sessionId,
        requestId: payload.requestId || null,
        ok: !!payload.ok,
        text: payload.text == null ? '' : String(payload.text),
        reason: payload.reason || null,
      });
    }
  }
}

function bindConnectionHandlers(ws) {
  ws._alive = true;

  ws.on('message', (raw) => {
    if (Buffer.isBuffer(raw)) {
      // RSCF binary frames from executor -> broadcast to dashboard clients.
      // Note: ws text frames also arrive as Buffer by default, so only short-circuit
      // true binary packets that carry the RSCF magic header.
      try {
        if (raw.length >= 4 && raw.subarray(0, 4).toString('utf8') === 'RSCF') {
          broadcastBinary(raw);
          return;
        }
      } catch {}
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (ws._nodeUuid) registry.touch(ws._nodeUuid);
    Promise.resolve(handleMessage(ws, msg)).catch((err) => {
      console.error('[executor-ws] message error:', err);
      sendJson(ws, 'executor.error', { error: err.message || 'internal error' });
    });
  });

  ws.on('pong', () => {
    ws._alive = true;
    if (ws._nodeUuid) {
      registry.touch(ws._nodeUuid);
      executorService.heartbeat(ws._nodeUuid).catch(() => {});
    }
  });

  ws.on('close', () => {
    ws._alive = false;
    const nodeUuid = ws._nodeUuid;
    const nodeId = ws._nodeId;
    if (nodeUuid && nodeId) {
      executorService.onDisconnect(nodeUuid, nodeId);
    }
  });

  ws.on('error', () => {
    ws._alive = false;
  });
}

/**
 * Initialize the executor WebSocket server in noServer mode.
 * Sets up connection handlers, heartbeat pings, and returns the wss instance.
 * @returns {import('ws').WebSocketServer} result
 */
export function initExecutorWs() {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    bindConnectionHandlers(ws);
  });

  // 心跳周期 10s：NAT/LB 空闲回收窗口内尽快发现半开连接（配合 executor 侧
  // heartbeat ack 超时检测，感知窗口从 30–60s 缩到 ~10–20s）。
  const heartbeat = setInterval(() => {
    if (!wss) {
      clearInterval(heartbeat);
      return;
    }
    wss.clients.forEach((ws) => {
      if (!ws._alive) {
        console.warn(
          '[executor-ws] half-open detected (pong missing), terminated',
          ws._nodeUuid || 'unknown',
        );
        ws.terminate();
        return;
      }
      ws._alive = false;
      ws.ping();
    });
  }, 10000);

  wss.on('close', () => clearInterval(heartbeat));

  console.log('[executor-ws] Executor WebSocket ready at /ws/executor (noServer mode)');
  return wss;
}

/**
 * @returns {import('ws').WebSocketServer|null} result
 */
export function getExecutorWss() {
  return wss;
}
