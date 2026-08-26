/**
 * Dashboard WebSocket server (noServer mode).
 * Provides broadcast API for route modules to push real-time state, replacing polling + SSE.
 */
import { WebSocketServer } from 'ws';
import { state } from './state.js';

let wss = null;
const wsMessageHandlers = [];

/**
 * Register a WebSocket message handler (called by route modules at init to avoid circular deps).
 * @param {(ws: object, msg: object) => void} handler handler
 */
export function onWsMessage(handler) {
  wsMessageHandlers.push(handler);
}

/**
 * Snapshot of current sessions for state broadcast.
 * @returns {object[]} result
 */
function getSessionList() {
  const gb = state.globalBrowser;
  const list = [];
  for (const [id, s] of state.sessions) {
    list.push({
      sessionId: id,
      model: s.model,
      stepIndex: s.stepIndex,
      busy: gb.busy,
      createdAt: s.createdAt,
      stepCount: s.trajectories.length,
    });
  }
  return list;
}

/**
 * Build a full state snapshot pushed on new client connect.
 * @returns {object} result
 */
function getFullState() {
  const gb = state.globalBrowser;
  return {
    server: { status: 'ok', defaultModel: state.defaultModel },
    sessions: getSessionList(),
    watcher: {
      connected: !!(gb.ready && gb.stdin),
      agentBusy: gb.busy,
      cdpReady: !!(gb.cdpWsUrl || gb.cdpHttp),
      cdpHttp: gb.cdpHttp || null,
    },
  };
}

/**
 * Broadcast a typed JSON message to all connected dashboard clients.
 * @param {string} type type
 * @param {unknown} payload payload
 * @returns {number|undefined} number of clients that received the message (undefined when wss not initialized)
 */
export function broadcast(type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload });
  let count = 0;
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
      count++;
    }
  }
  return count;
}

/** Drop frame to a client when its outbound buffer is already large (prefer fresh frames). */
const BINARY_BUFFERED_LIMIT = 2 * 1024 * 1024;

/**
 * Broadcast a binary Buffer/Uint8Array to all clients (remote screencast frames).
 * Skips clients whose outbound buffer is already large.
 * @param {Buffer|Uint8Array} data data
 * @returns {number} number of clients that received the frame
 */
export function broadcastBinary(data) {
  if (!wss) return 0;
  let count = 0;
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    if ((client.bufferedAmount || 0) > BINARY_BUFFERED_LIMIT) continue;
    try {
      client.send(data);
      count++;
    } catch {}
  }
  return count;
}

/**
 * Initialize the dashboard WebSocket server (noServer mode; upgrade routed by server.mjs).
 * Sends full state on connect, dispatches client messages to registered handlers, runs heartbeat pings.
 * @returns {import('ws').WebSocketServer} result
 */
export function initWebSocket() {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    ws.id = crypto.randomUUID();
    ws._alive = true;

    // 首次连接立即推送全量状态（替代前端初始化时的 4 个 GET 请求）
    ws.send(JSON.stringify({
      type: 'server:init',
      payload: getFullState(),
    }));

    // 处理客户端消息
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch { return; }

      // 内置通用消息
      if (msg.type === 'ws:ping') {
        ws.send(JSON.stringify({ type: 'ws:pong', payload: {} }));
        return;
      }

      // 分发给各路由模块注册的处理器（支持 async）
      for (const handler of wsMessageHandlers) {
        try {
          Promise.resolve(handler(ws, msg)).catch((err) => {
            console.error('[ws] Handler error:', err);
          });
        } catch (err) {
          console.error('[ws] Handler error:', err);
        }
      }
    });

    // 连接关闭清理
    // 收到 pong 时标记存活,防止心跳误杀活跃连接
    ws.on('pong', () => { ws._alive = true; });

    ws.on('close', () => {
      ws._alive = false;
    });

    ws.on('error', () => {
      ws._alive = false;
    });
  });

  // ping 检测死连接(30秒)
  const heartbeat = setInterval(() => {
    if (!wss) { clearInterval(heartbeat); return; }
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

  console.log('[ws-server] WebSocket server ready at /ws (noServer mode)');
  return wss;
}

/**
 * @returns {import('ws').WebSocketServer|null} result
 */
export function getDashboardWss() {
  return wss;
}
