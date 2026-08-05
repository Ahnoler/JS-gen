/**
 * Executor Agent WebSocket client — outbound connect, register, heartbeat, auto-reconnect.
 */
import WebSocket from 'ws';

/**
 * @typedef {Object} ExecutorWsClientOptions
 * @property {string} url WS URL including ?token=
 * @property {() => object} getRegisterPayload
 * @property {(msg: {type: string, payload: object}) => void} [onMessage]
 * @property {(payload: object) => void} [onRegistered]
 * @property {() => void} [onDisconnected]
 * @property {() => void} [onDisconnectTimeout] 断线超时（调用方应杀会话，防静默丢事件）
 * @property {number} [disconnectTimeoutMs] 断线超时阈值（默认 30s）
 * @property {number} [heartbeatIntervalMs]
 * @property {number} [reconnectMinMs]
 * @property {number} [reconnectMaxMs]
 */

export class ExecutorWsClient {
  /** @param {ExecutorWsClientOptions} options */
  constructor(options) {
    this.url = options.url;
    this.getRegisterPayload = options.getRegisterPayload;
    this.onMessage = options.onMessage;
    this.onRegistered = options.onRegistered;
    this.onDisconnected = options.onDisconnected;
    this.onDisconnectTimeout = options.onDisconnectTimeout;
    this.disconnectTimeoutMs = options.disconnectTimeoutMs ?? 30000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20000;
    this.reconnectMinMs = options.reconnectMinMs ?? 1000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30000;

    /** @type {WebSocket|null} */
    this.ws = null;
    this.registered = false;
    this.draining = false;
    this.stopping = false;
    this.reconnectAttempt = 0;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.reconnectTimer = null;
    /** @type {ReturnType<typeof setInterval>|null} */
    this.heartbeatTimer = null;
    /** @type {Promise<void>|null} */
    this.unregisterPromise = null;
    /** @type {string[]} 断线期间缓存的消息（重连注册成功后按序重放） */
    this.pendingQueue = [];
    this.pendingBytes = 0;
    this.pendingMaxBytes = 32 * 1024 * 1024; // 缓冲上限 32MB（防内存膨胀）
    /** @type {ReturnType<typeof setTimeout>|null} 断线超时看门狗 */
    this.disconnectWatchdog = null;
  }

  connect() {
    if (this.stopping) return;
    this.clearReconnectTimer();

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.clearDisconnectWatchdog();
      console.log('[executor] connected, sending register…');
      this.send('executor.register', this.getRegisterPayload());
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handleServerMessage(msg);
      this.onMessage?.(msg);
    });

    ws.on('close', (code, reason) => {
      this.registered = false;
      this.stopHeartbeat();
      const r = reason?.toString?.() || '';
      console.log(`[executor] disconnected code=${code}${r ? ` reason=${r}` : ''}`);
      this.onDisconnected?.();
      // 断线超时看门狗：长时间未恢复 → 调用方杀会话，避免 Python 继续执行
      // 且事件在断线处静默丢弃（录制数据静默丢失的根因）。
      if (!this.stopping) this.startDisconnectWatchdog();
      if (!this.stopping) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      console.error('[executor] ws error:', err.message);
    });
  }

  handleServerMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'executor.registered':
        this.registered = true;
        console.log('[executor] registered', payload);
        this.onRegistered?.(payload);
        this.startHeartbeat();
        // 重连成功：重放断线期间缓存的事件（先于新事件，保持时序）
        this.flushPending();
        return;
      case 'executor.heartbeat.ack':
        return;
      case 'executor.drain':
        this.draining = true;
        console.log('[executor] drain requested — no new sessions', payload);
        return;
      case 'executor.unregistered':
        console.log('[executor] unregistered', payload);
        return;
      case 'executor.error':
        console.error('[executor] server error:', payload?.error || payload);
        return;
      default:
        break;
    }
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    // 断线：入队缓冲（重连注册成功后重放），避免事件静默丢失。
    // register/heartbeat/unregister 不走此路径（open 直发 / registered 门控 / stopping 短路）。
    if (this.stopping) return false;
    const msg = JSON.stringify({ type, payload });
    this.pendingBytes += Buffer.byteLength(msg);
    if (this.pendingBytes > this.pendingMaxBytes) {
      // 缓冲溢出：丢最旧（action_log_sync 是全量快照，新事件可覆盖旧值）
      while (this.pendingQueue.length && this.pendingBytes > this.pendingMaxBytes) {
        const dropped = this.pendingQueue.shift();
        this.pendingBytes -= Buffer.byteLength(dropped);
      }
      console.warn('[executor] ws pending buffer overflow — dropped oldest queued message(s)');
    }
    this.pendingQueue.push(msg);
    return true;
  }

  /** 重连注册成功后按序重放断线期间缓存的消息。 */
  flushPending() {
    if (!this.pendingQueue.length) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const remaining = [];
    let sent = 0;
    for (const msg of this.pendingQueue) {
      try {
        this.ws.send(msg);
        sent += 1;
      } catch {
        remaining.push(msg); // 保持顺序，留给下次 flush
      }
    }
    this.pendingQueue = remaining;
    this.pendingBytes = remaining.reduce((n, m) => n + Buffer.byteLength(m), 0);
    if (sent) {
      console.log(`[executor] ws reconnect: flushed ${sent} buffered message(s)`);
    }
  }

  startDisconnectWatchdog() {
    this.clearDisconnectWatchdog();
    this.disconnectWatchdog = setTimeout(() => {
      this.disconnectWatchdog = null;
      console.error(
        `[executor] disconnected for ${this.disconnectTimeoutMs}ms — killing sessions to avoid silent event loss`,
      );
      this.onDisconnectTimeout?.();
    }, this.disconnectTimeoutMs);
    this.disconnectWatchdog.unref?.();
  }

  clearDisconnectWatchdog() {
    if (this.disconnectWatchdog) {
      clearTimeout(this.disconnectWatchdog);
      this.disconnectWatchdog = null;
    }
  }

  /**
   * Send raw binary over WS (used by RSCF screencast frames).
   * Returns false when socket is closed or outbound buffer is backing up (caller should drop frame).
   * @param {Buffer|Uint8Array} data
   */
  sendBinary(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if ((this.ws.bufferedAmount || 0) > 1.5 * 1024 * 1024) return false;
    this.ws.send(data);
    return true;
  }

  heartbeat() {
    if (!this.registered) return;
    this.send('executor.heartbeat', {});
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectMinMs * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    console.log(`[executor] reconnect in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Graceful shutdown: unregister then close.
   * @returns {Promise<void>}
   */
  async stop() {
    this.stopping = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();

    if (this.ws && this.registered && this.ws.readyState === WebSocket.OPEN) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        const onMsg = (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'executor.unregistered') {
              clearTimeout(timer);
              this.ws?.off('message', onMsg);
              resolve();
            }
          } catch {}
        };
        this.ws.on('message', onMsg);
        this.send('executor.unregister', {});
      });
    }

    if (this.ws) {
      try {
        this.ws.close(1000, 'agent shutdown');
      } catch {}
      this.ws = null;
    }
  }
}
