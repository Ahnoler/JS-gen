// WebSocket 客户端
// 提供 connect / on / send / disconnect API，自动重连

const listeners = new Map();          // type → Set<callback>
const onceListeners = new Map();      // type → Set<callback> (一次性)
let ws = null;
let reconnectTimer = null;
let retries = 0;
const MAX_RETRIES = 20;
let isDestroyed = false;

// 获取 WebSocket URL（自动判断 http/https → ws/wss）
function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

// 连接 WebSocket
export function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (isDestroyed) return;

  try {
    ws = new WebSocket(getWsUrl());
  } catch (err) {
    console.error('[ws] Connection error:', err);
    scheduleReconnect();
    return;
  }

  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    console.info('[ws] Connected');
    retries = 0;
    emit('ws:connected', {});
  };

  ws.onmessage = (evt) => {
    if (evt.data instanceof ArrayBuffer) {
      emit('ws:binary', evt.data);
      return;
    }
    if (typeof Blob !== 'undefined' && evt.data instanceof Blob) {
      evt.data.arrayBuffer().then((buf) => emit('ws:binary', buf)).catch(() => {});
      return;
    }
    let msg;
    try {
      msg = JSON.parse(evt.data);
    } catch {
      return;
    }
    emit(msg.type, msg.payload);
  };

  ws.onclose = (evt) => {
    console.warn('[ws] Disconnected (code:', evt.code, ')');
    ws = null;
    emit('ws:disconnected', { code: evt.code });
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose 会紧随 onerror 触发，只处理重连
  };
}

// 订阅消息类型
export function on(type, callback) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(callback);

  // 返回取消订阅函数
  return () => {
    const set = listeners.get(type);
    if (set) set.delete(callback);
  };
}

// 一次性订阅
export function once(type, callback) {
  if (!onceListeners.has(type)) onceListeners.set(type, new Set());
  onceListeners.get(type).add(callback);
}

// 发送消息到服务器
export function send(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[ws] Cannot send — not connected');
    return false;
  }
  ws.send(JSON.stringify({ type, payload }));
  return true;
}

// 断开连接（不再重连）
export function disconnect() {
  isDestroyed = true;
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  listeners.clear();
  onceListeners.clear();
}

// 当前连接状态
export function isConnected() {
  return !!(ws && ws.readyState === WebSocket.OPEN);
}

// ─── internal ──────────────────────────────────────────

function emit(type, payload) {
  // 一次性监听器
  const onceSet = onceListeners.get(type);
  if (onceSet && onceSet.size) {
    const cbs = [...onceSet];
    onceListeners.delete(type);
    cbs.forEach(fn => fn(payload));
  }

  // 持久监听器
  const set = listeners.get(type);
  if (set && set.size) {
    set.forEach(fn => fn(payload));
  }
}

function scheduleReconnect() {
  if (isDestroyed) return;
  if (retries >= MAX_RETRIES) {
    console.error('[ws] Max reconnection attempts reached');
    emit('ws:reconnect_failed', {});
    return;
  }

  const delay = Math.min(1000 * Math.pow(1.5, retries), 10000);
  retries++;
  console.info(`[ws] Reconnecting in ${delay}ms (attempt ${retries}/${MAX_RETRIES})`);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!isDestroyed) connect();
  }, delay);
}
