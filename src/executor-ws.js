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

/** @param {import('http').IncomingMessage} req */
export function getExecutorTokenFromRequest(req) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const queryToken = url.searchParams.get('token');
  const headerToken = req.headers['x-executor-token'];
  return String(queryToken || headerToken || '');
}

/** @param {import('http').IncomingMessage} req */
export function validateExecutorToken(req) {
  if (!EXECUTOR_TOKEN) return false;
  return getExecutorTokenFromRequest(req) === EXECUTOR_TOKEN;
}

/** @param {import('net').Socket} socket @param {number} code @param {string} message */
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
  if (payload?.sessionId) {
    if (type === 'action_log_sync' || type === 'manual_action_recorded') {
      broadcast(type, { ...payload, sessionId: payload.sessionId });
    }
    if (type === 'manual_record_status') {
      broadcast('manual_record_status', { ...payload, sessionId: payload.sessionId });
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

export function initExecutorWs() {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    bindConnectionHandlers(ws);
  });

  const heartbeat = setInterval(() => {
    if (!wss) {
      clearInterval(heartbeat);
      return;
    }
    wss.clients.forEach((ws) => {
      if (!ws._alive) {
        ws.terminate();
        return;
      }
      ws._alive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  console.log('[executor-ws] Executor WebSocket ready at /ws/executor (noServer mode)');
  return wss;
}

/** @returns {import('ws').WebSocketServer|null} */
export function getExecutorWss() {
  return wss;
}
