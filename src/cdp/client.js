/**
 * Minimal CDP WebSocket client (browser-level + flattened target sessions).
 */
import WebSocket from 'ws';

export class CdpClient {
  constructor() {
    /** @type {import('ws').WebSocket|null} */
    this.ws = null;
    this.nextId = 1;
    /** @type {Map<number, { resolve: Function, reject: Function }>} */
    this.pending = new Map();
    /** @type {Map<string, Set<Function>>} */
    this.handlers = new Map();
    /** Default sessionId for Page/Input after Target.attachToTarget({ flatten: true }) */
    this.sessionId = null;
    this._closed = false;
  }

  /**
   * @param {string} webSocketDebuggerUrl
   */
  async connect(webSocketDebuggerUrl) {
    if (this.ws) await this.close();
    this._closed = false;
    this.ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onErr = (err) => { cleanup(); reject(err); };
      const cleanup = () => {
        this.ws?.off('open', onOpen);
        this.ws?.off('error', onErr);
      };
      this.ws.once('open', onOpen);
      this.ws.once('error', onErr);
    });
    this.ws.on('message', (data) => this._onMessage(data));
    this.ws.on('close', () => {
      this._rejectAll(new Error('CDP WebSocket closed'));
      this._emitLocal('Client.disconnected', {});
    });
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      const cbs = this.handlers.get(msg.method);
      if (cbs) {
        for (const cb of cbs) {
          try { cb(msg.params || {}, msg.sessionId); } catch (e) {
            console.warn('[cdp] handler error', msg.method, e.message);
          }
        }
      }
    }
  }

  _emitLocal(method, params) {
    const cbs = this.handlers.get(method);
    if (!cbs) return;
    for (const cb of cbs) {
      try { cb(params, null); } catch {}
    }
  }

  _rejectAll(err) {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  /**
   * @param {string} method
   * @param {object} [params]
   * @param {string|null} [sessionId]
   */
  send(method, params = {}, sessionId = undefined) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP not connected'));
    }
    const id = this.nextId++;
    const msg = { id, method, params };
    const sid = sessionId !== undefined ? sessionId : this.sessionId;
    if (sid) msg.sessionId = sid;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(msg), (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /**
   * @param {string} method
   * @param {(params: object, sessionId?: string) => void} cb
   */
  on(method, cb) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(cb);
    return () => this.handlers.get(method)?.delete(cb);
  }

  async listPageTargets() {
    const result = await this.send('Target.getTargets', {}, null);
    const infos = result?.targetInfos || [];
    return infos.filter((t) => t.type === 'page');
  }

  /**
   * Attach to a page target (flatten session for Page/Input domains).
   * @param {string} targetId
   */
  async attachToTarget(targetId) {
    const result = await this.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    }, null);
    this.sessionId = result.sessionId;
    return result.sessionId;
  }

  async close() {
    this._closed = true;
    this._rejectAll(new Error('CDP client closed'));
    if (this.ws) {
      try { this.ws.removeAllListeners(); } catch {}
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.sessionId = null;
    this.handlers.clear();
  }
}
