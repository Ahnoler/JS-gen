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
  }

  connect() {
    if (this.stopping) return;
    this.clearReconnectTimer();

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempt = 0;
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, payload }));
    return true;
  }

  /**
   * Send raw binary over WS (used by RSCF screencast frames).
   * @param {Buffer|Uint8Array} data
   */
  sendBinary(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
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
