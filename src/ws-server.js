// WebSocket 服务端
// 提供 broadcast API 供路由模块推送实时状态，替代轮询 + SSE

import { WebSocketServer } from 'ws';
import { state } from './state.js';

let wss = null;
const wsMessageHandlers = [];

// 注册 WebSocket 消息处理器（由各路由模块在初始化时调用，避免循环依赖）
export function onWsMessage(handler) {
  wsMessageHandlers.push(handler);
}

// 会话列表快照（与 state.sessions 结构一致，无内部引用）
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

// 构建 Full State 快照（新连接时推送一次，替代"首次轮询"）
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

// 向所有已连接客户端广播消息
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

/** Broadcast a binary Buffer/Uint8Array to all clients (remote screencast frames). */
export function broadcastBinary(data) {
  if (!wss) return 0;
  let count = 0;
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try {
        client.send(data);
        count++;
      } catch {}
    }
  }
  return count;
}

// 初始化 WebSocket 服务（挂载在共享 HTTP 服务器上）
export function initWebSocket(httpServer) {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

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

  console.log(`[ws-server] WebSocket server ready at /ws (${wss.options.maxPayload || 'default'} max payload)`);
  return wss;
}
