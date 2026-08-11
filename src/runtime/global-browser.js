/**
 * Mutable GlobalBrowser singleton fields + thin lifecycle helpers.
 * Call sites may keep duck-typed property access (gb.ready, gb.stdin, …).
 */
import { isProcessAlive } from './agent-process.js';

/**
 * @typedef {object} GlobalBrowserState
 * @property {import('child_process').ChildProcess|null} process
 * @property {NodeJS.WritableStream|null} stdin
 * @property {boolean} ready
 * @property {boolean} busy
 * @property {string|null} model
 * @property {number} stepIndex
 * @property {string|null} cdpHttp
 * @property {string|null} cdpWsUrl
 * @property {number|null} cdpPort
 * @property {boolean} autoPersist
 * @property {boolean} manualRecording
 * @property {object[]} lastActionLog
 * @property {(opts?: { clearCdp?: boolean }) => void} reset
 * @property {() => boolean} isAlive
 * @property {() => boolean} isReady
 */

/**
 * Create a property-compatible GlobalBrowser bag with helpers.
 * @returns {GlobalBrowserState}
 */
export function createGlobalBrowserState() {
  return {
    process: null,
    stdin: null,
    ready: false,
    busy: false,
    model: null,
    stepIndex: 0,
    /** Chrome DevTools HTTP base, e.g. http://127.0.0.1:9242 */
    cdpHttp: null,
    /** Chrome DevTools WebSocket debugger URL */
    cdpWsUrl: null,
    cdpPort: null,
    autoPersist: false,
    manualRecording: false,
    lastActionLog: [],

    /**
     * Clear process / readiness fields (and optionally CDP endpoints).
     * @param {{ clearCdp?: boolean }} [opts]
     */
    reset({ clearCdp = true } = {}) {
      this.process = null;
      this.stdin = null;
      this.ready = false;
      this.busy = false;
      this.stepIndex = 0;
      if (clearCdp) {
        this.cdpHttp = null;
        this.cdpWsUrl = null;
        this.cdpPort = null;
      }
    },

    /** True when the local agent child process is still running. */
    isAlive() {
      return isProcessAlive(this.process);
    },

    /** True when the agent has signaled ready and stdin is writable. */
    isReady() {
      return !!(this.ready && this.stdin);
    },
  };
}
