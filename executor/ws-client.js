/**
 * Executor Agent WebSocket client — outbound connect, register, heartbeat, auto-reconnect.
 */
import WebSocket from 'ws';

/**
 * @typedef {object} ExecutorWsClientOptions
 * @property {string} url WS URL including ?token=
 * @property {() => object} getRegisterPayload function returning the register payload
 * @property {(msg: {type: string, payload: object}) => void} [onMessage] inbound message callback
 * @property {(payload: object) => void} [onRegistered] registered callback
 * @property {() => void} [onDisconnected] disconnected callback
 * @property {() => void} [onDisconnectTimeout] 断线超时（调用方应杀会话，防静默丢事件）
 * @property {number} [disconnectTimeoutMs] 断线超时阈值（默认 30s）
 * @property {number} [heartbeatIntervalMs] heartbeat interval in ms
 * @property {number} [heartbeatAckTimeoutMs] heartbeat ack 超时阈值（默认 40s = 2×心跳间隔）
 * @property {number} [reconnectMinMs] minimum reconnect delay in ms
 * @property {number} [reconnectMaxMs] maximum reconnect delay in ms
 */

/**
 * Outbound WebSocket client for the executor agent: connects to the control plane,
 * registers, sends heartbeats, auto-reconnects with exponential backoff, and buffers
 * messages during disconnects to prevent silent event loss.
 */
export class ExecutorWsClient {
  /**
   * @param {ExecutorWsClientOptions} options options
   */
  constructor(options) {
    this.url = options.url;
    this.getRegisterPayload = options.getRegisterPayload;
    this.onMessage = options.onMessage;
    this.onRegistered = options.onRegistered;
    this.onDisconnected = options.onDisconnected;
    this.onDisconnectTimeout = options.onDisconnectTimeout;
    this.disconnectTimeoutMs = options.disconnectTimeoutMs ?? 30000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20000;
    /** 连续多久未收到 heartbeat ack 视为半开连接（NAT/LB 静默掐断，readyState 仍为 OPEN）。 */
    this.heartbeatAckTimeoutMs = options.heartbeatAckTimeoutMs ?? 40000;
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
    /** 最近一次 heartbeat ack（或注册成功）时间戳；半开连接检测基准。 */
    this.lastAckAt = 0;
  }

  /**
   * Open the WS connection and send register on open.
   * @returns {void} result
   */
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

  /**
   * Handle inbound server messages (registered, heartbeat.ack, drain, etc.).
   * @param {{ type: string, payload: object }} msg inbound server message
   * @returns {void}
   */
  handleServerMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'executor.registered':
        this.registered = true;
        this.lastAckAt = Date.now(); // 注册成功即视为链路可达
        console.log('[executor] registered', payload);
        this.onRegistered?.(payload);
        this.startHeartbeat();
        // 重连成功：重放断线期间缓存的事件（先于新事件，保持时序）
        this.flushPending();
        return;
      case 'executor.heartbeat.ack':
        this.lastAckAt = Date.now();
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

  /**
   * Send a typed JSON message; queues into pending buffer when disconnected.
   * @param {string} type type
   * @param {object} [payload] payload
   * @returns {boolean} true if sent or buffered, false if stopping
   */
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

  /**
   * Replay buffered messages after successful reconnection.
   * @returns {void} result
   */
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

  /**
   * Start the disconnect-timeout watchdog (kills sessions after threshold).
   * @returns {void} result
   */
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

  /**
   * Clear the disconnect-timeout watchdog.
   * @returns {void} result
   */
  clearDisconnectWatchdog() {
    if (this.disconnectWatchdog) {
      clearTimeout(this.disconnectWatchdog);
      this.disconnectWatchdog = null;
    }
  }

  /**
   * Send raw binary over WS (used by RSCF screencast frames).
   * Returns false when socket is closed or outbound buffer is backing up (caller should drop frame).
   * @param {Buffer|Uint8Array} data data
   * @returns {boolean} result
   */
  sendBinary(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if ((this.ws.bufferedAmount || 0) > 1.5 * 1024 * 1024) return false;
    this.ws.send(data);
    return true;
  }

  /**
   * Send a heartbeat; terminates the WS if no ack received within the threshold.
   * @returns {void} result
   */
  heartbeat() {
    if (!this.registered) return;
    this.send('executor.heartbeat', {});
    // 半开连接检测（NAT/LB 静默掐断时 readyState 仍为 OPEN，close 永不触发）：
    // heartbeat 照发但 ack 收不到 → 超过阈值主动 terminate，强制走 close →
    // 断线缓冲 + 看门狗 + 重连路径，事件不再进黑洞。
    if (this.lastAckAt && Date.now() - this.lastAckAt > this.heartbeatAckTimeoutMs) {
      console.error(
        `[executor] no heartbeat ack for ${Date.now() - this.lastAckAt}ms (threshold ${this.heartbeatAckTimeoutMs}ms) — half-open connection suspected, terminating ws to force reconnect`,
      );
      try {
        this.ws?.terminate?.();
      } catch {}
    }
  }

  /**
   * Start the periodic heartbeat interval.
   * @returns {void} result
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  /**
   * Stop the heartbeat interval.
   * @returns {void} result
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Schedule an exponential-backoff reconnect attempt.
   * @returns {void} result
   */
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

  /**
   * Clear any pending reconnect timer.
   * @returns {void} result
   */
  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Graceful shutdown: unregister then close.
   * @returns {Promise<void>} result
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
