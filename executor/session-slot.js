/**
 * One executor slot = one Python session subprocess + stdin/stdout bridge.
 */
import { spawnAgent, waitForReady, isProcessAlive, killTree, killProcessOnly, killListenerOnPort } from './spawn-agent.js';
import { createStderrLineBuffer } from './stderr-prefix.js';
import { LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, FORM_LLM_MODEL, FORM_LLM_BASE_URL, FORM_LLM_API_KEY, CONTROL_PLANE_HTTP, EXECUTOR_CDP_PORT_BASE } from './config.js';
import net from 'net';

/** @returns {Promise<boolean>} true if port is free to bind */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

/** Pick first free port at or above preferred (scan a short range). */
async function allocateCdpPort(preferred) {
  for (let p = preferred; p < preferred + 20; p++) {
    if (await isPortFree(p)) return p;
  }
  return preferred;
}

export class SessionSlot {
  /**
   * @param {number} slotIndex
   * @param {(msg: { event: string, data?: object, session_id?: string }) => void} onAgentEvent
   */
  constructor(slotIndex, onAgentEvent) {
    this.slotIndex = slotIndex;
    /** @type {string|null} */
    this.sessionId = null;
    this.ready = false;
    this.busy = false;
    /** @type {import('child_process').ChildProcess|null} */
    this.process = null;
    this.onAgentEvent = onAgentEvent;
    this._stdoutBuf = '';
    /** Chrome remote-debugging port for this slot (BiB attach). */
    this.cdpPort = EXECUTOR_CDP_PORT_BASE + slotIndex;
  }

  /**
   * @param {object} opts
   * @param {string} opts.sessionId
   * @param {string} [opts.model]
   * @param {string} [opts.baseUrl]
   * @param {string} [opts.apiKey]
   * @param {string} [opts.cdpUrl] Connect to existing Chrome via CDP (reuse orphan)
   * @param {number} [opts.cdpPort] Explicit CDP port when launching or reusing
   */
  async open(opts) {
    if (this.process && isProcessAlive(this.process)) {
      throw new Error(`slot ${this.slotIndex} already has a live session`);
    }

    const sessionId = opts.sessionId;
    const model = opts.model || LLM_MODEL;
    const baseUrl = opts.baseUrl || `${CONTROL_PLANE_HTTP}/v1`;
    const apiKey = opts.apiKey || LLM_API_KEY;
    const cdpUrl = opts.cdpUrl || opts.cdp_url || null;
    const explicitPort = opts.cdpPort ?? opts.cdp_port;

    const agentArgs = [
      '--session',
      '--session-id', sessionId,
      '--model', model,
      '--base-url', baseUrl,
      '--api-key', apiKey,
    ];

    if (cdpUrl) {
      // Reuse existing Chrome — do not allocate a new debugging port.
      agentArgs.push('--cdp-url', String(cdpUrl));
      if (explicitPort != null && Number.isFinite(Number(explicitPort))) {
        this.cdpPort = Number(explicitPort);
      } else {
        // Best-effort extract port from ws://127.0.0.1:PORT/...
        const m = String(cdpUrl).match(/:(\d+)\//) || String(cdpUrl).match(/:(\d+)$/);
        this.cdpPort = m ? Number(m[1]) : EXECUTOR_CDP_PORT_BASE + this.slotIndex;
      }
    } else {
      this.cdpPort = explicitPort != null && Number.isFinite(Number(explicitPort))
        ? Number(explicitPort)
        : await allocateCdpPort(EXECUTOR_CDP_PORT_BASE + this.slotIndex);
      agentArgs.push('--cdp-port', String(this.cdpPort));
    }

    const child = spawnAgent(agentArgs, {
      OPENAI_API_KEY: apiKey,
      // Python 表单 LLM（_llm_values.py）直接读这些 env；缺省回落 agent LLM
      FORM_LLM_MODEL, FORM_LLM_BASE_URL, FORM_LLM_API_KEY: FORM_LLM_API_KEY || apiKey,
    });

    this.sessionId = sessionId;
    this.process = child;
    this.ready = false;
    this.busy = false;
    this._stdoutBuf = '';

    this._stderrBuf?.dispose?.();
    this._stderrBuf = createStderrLineBuffer({
      slotIndex: this.slotIndex,
      sessionId,
      onFlush: (lines) => {
        for (const line of lines) {
          process.stderr.write(`${line}\n`);
        }
        this.onAgentEvent({
          event: 'session.agent_stderr',
          session_id: sessionId,
          data: {
            sessionId,
            slotIndex: this.slotIndex,
            lines,
          },
        });
      },
    });
    child.stderr.on('data', (chunk) => this._stderrBuf.push(chunk));

    child.stdout.on('data', (chunk) => this._onStdout(chunk));

    child.on('exit', (code) => {
      this._stderrBuf?.flush?.({ end: true });
      this._stderrBuf?.dispose?.();
      this.ready = false;
      this.busy = false;
      this.process = null;
      // Free the slot so _findFreeSlot can reuse it (open-failure ghosts used to stick forever).
      if (this.sessionId === sessionId) this.sessionId = null;
      this.onAgentEvent({
        event: 'session.process_exit',
        session_id: sessionId,
        data: { code, sessionId, slotIndex: this.slotIndex },
      });
    });

    child.stdin.on('error', () => {});

    try {
      const readyMsg = await waitForReady(child, 90000);
      if (readyMsg?.cdp_port != null) {
        this.cdpPort = Number(readyMsg.cdp_port) || this.cdpPort;
      }
      this.ready = true;
      // Prefer explicit cdp_ready from Python (false when browser_use dropped the port).
      const readyFlag = readyMsg && Object.prototype.hasOwnProperty.call(readyMsg, 'cdp_ready')
        ? !!readyMsg.cdp_ready
        : true;
      return {
        sessionId,
        slotIndex: this.slotIndex,
        cdpPort: this.cdpPort,
        cdpReady: readyFlag,
      };
    } catch (err) {
      this._stderrBuf?.flush?.({ end: true });
      this._stderrBuf?.dispose?.();
      // Agent died / timed out before ready — reclaim slot and kill orphans.
      if (this.process && isProcessAlive(this.process)) {
        killTree(this.process.pid);
      }
      if (this.cdpPort != null) killListenerOnPort(this.cdpPort);
      this.process = null;
      this.ready = false;
      this.busy = false;
      if (this.sessionId === sessionId) this.sessionId = null;
      throw err;
    }
  }

  _onStdout(chunk) {
    this._stdoutBuf += chunk.toString();
    const lines = this._stdoutBuf.split('\n');
    this._stdoutBuf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this._handleAgentMessage(msg);
      } catch {}
    }
  }

  _handleAgentMessage(msg) {
    const event = msg.event;
    if (!event) return;

    if (event === 'phase_start' || event === 'step') {
      this.busy = true;
    }
    if (event === 'phase_done' || event === 'done' || event === 'phase_error' || event === 'error') {
      this.busy = false;
    }

    this.onAgentEvent({
      ...msg,
      session_id: this.sessionId,
      data: { ...(msg.data || {}), sessionId: this.sessionId, slotIndex: this.slotIndex },
    });
  }

  /** @param {string} event @param {object} [data] */
  writeEvent(event, data = {}) {
    if (!this.process?.stdin || !this.ready) {
      throw new Error('Session subprocess not ready');
    }
    this.process.stdin.write(JSON.stringify({ event, data }) + '\n');
  }

  /**
   * @param {{ keepBrowser?: boolean }} [opts]
   * keepBrowser=false (default): kill Chrome for「释放执行资源」.
   * keepBrowser=true: leave Chrome on CDP (soft close).
   */
  async close({ keepBrowser = false } = {}) {
    const sessionId = this.sessionId;
    const cdpPort = this.cdpPort;
    const pid = this.process?.pid;
    if (this.process?.stdin && this.ready) {
      try {
        this.process.stdin.write(JSON.stringify({
          event: 'close',
          data: { keep_browser: !!keepBrowser },
        }) + '\n');
      } catch {}
    }
    // Graceful close: the agent's exit path runs the session-end final screenshot
    // (capturedAt='session-end'), flushes the memory writer and closes the browser —
    // wait for natural exit before force-killing (a fixed 2s let taskkill /F
    // interrupt the shot; 20s cap keeps worst-case detach bounded).
    const closeSent = this.process?.stdin && this.ready;
    await new Promise((resolve) => {
      if (!closeSent || !this.process || !isProcessAlive(this.process)) {
        setTimeout(resolve, keepBrowser ? 2500 : 2000);
        return;
      }
      const timer = setTimeout(resolve, 20000);
      this.process.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (this.process && isProcessAlive(this.process)) {
      if (keepBrowser) {
        // Soft close: do not kill process tree — Chromium is often a child of the agent.
        killProcessOnly(this.process.pid || pid);
      } else {
        killTree(this.process.pid || pid);
      }
    }
    if (!keepBrowser && cdpPort != null) killListenerOnPort(cdpPort);
    this._stderrBuf?.flush?.({ end: true });
    this._stderrBuf?.dispose?.();
    this.process = null;
    this.ready = false;
    this.busy = false;
    this.sessionId = null;
    return { sessionId, slotIndex: this.slotIndex, keepBrowser: !!keepBrowser, cdpPort };
  }
}
