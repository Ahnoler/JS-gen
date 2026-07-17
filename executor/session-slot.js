/**
 * One executor slot = one Python session subprocess + stdin/stdout bridge.
 */
import { spawnAgent, waitForReady, isProcessAlive, killTree } from './spawn-agent.js';
import { LLM_API_KEY, LLM_BASE_URL, CONTROL_PLANE_HTTP } from './config.js';

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
  }

  /**
   * @param {object} opts
   * @param {string} opts.sessionId
   * @param {string} [opts.model]
   * @param {string} [opts.baseUrl]
   * @param {string} [opts.apiKey]
   */
  async open(opts) {
    if (this.process && isProcessAlive(this.process)) {
      throw new Error(`slot ${this.slotIndex} already has a live session`);
    }

    const sessionId = opts.sessionId;
    const model = opts.model || 'deepseek/deepseek-v4-flash';
    const baseUrl = opts.baseUrl || `${CONTROL_PLANE_HTTP}/v1`;
    const apiKey = opts.apiKey || LLM_API_KEY;

    const child = spawnAgent(
      ['--session', '--session-id', sessionId, '--model', model, '--base-url', baseUrl, '--api-key', apiKey],
      { OPENAI_API_KEY: apiKey },
    );

    this.sessionId = sessionId;
    this.process = child;
    this.ready = false;
    this.busy = false;
    this._stdoutBuf = '';

    child.stderr.on('data', (chunk) => {
      process.stderr.write(`[slot:${this.slotIndex}] ${chunk}`);
    });

    child.stdout.on('data', (chunk) => this._onStdout(chunk));

    child.on('exit', (code) => {
      this.ready = false;
      this.busy = false;
      this.process = null;
      this.onAgentEvent({
        event: 'session.process_exit',
        session_id: sessionId,
        data: { code, sessionId, slotIndex: this.slotIndex },
      });
    });

    child.stdin.on('error', () => {});

    await waitForReady(child, 90000);
    this.ready = true;
    return { sessionId, slotIndex: this.slotIndex };
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

  async close() {
    const sessionId = this.sessionId;
    if (this.process?.stdin && this.ready) {
      try {
        this.process.stdin.write(JSON.stringify({ event: 'close' }) + '\n');
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
    if (this.process && isProcessAlive(this.process)) {
      killTree(this.process.pid);
    }
    this.process = null;
    this.ready = false;
    this.busy = false;
    this.sessionId = null;
    return { sessionId, slotIndex: this.slotIndex };
  }
}
