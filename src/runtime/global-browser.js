/**
 * Mutable GlobalBrowser singleton fields + thin lifecycle helpers.
 * Call sites may keep duck-typed property access (gb.ready, gb.stdin, …).
 */
import { isProcessAlive } from './agent-process.js';

/**
 * @typedef {object} GlobalBrowserState
 * @property {import('child_process').ChildProcess|null} process - Child process for the browser agent
 * @property {import('stream').Writable|null} stdin - Standard input stream for the agent process
 * @property {boolean} ready - Whether the browser is ready for commands
 * @property {boolean} busy - Whether the browser is currently executing actions
 * @property {string|null} model - Current model being used by the browser
 * @property {number} stepIndex - Current step index in trajectory execution
 * @property {string|null} cdpHttp - Chrome DevTools HTTP base URL
 * @property {string|null} cdpWsUrl - Chrome DevTools WebSocket debugger URL
 * @property {number|null} cdpPort - Chrome DevTools port number
 * @property {boolean} autoPersist - Whether to automatically persist trajectory data
 * @property {boolean} manualRecording - Whether manual recording is enabled
 * @property {object[]} lastActionLog - Log of the last executed actions
 * @property {(opts?: { clearCdp?: boolean }) => void} reset - Reset browser state
 * @property {() => boolean} isAlive - Check if agent process is still running
 * @property {() => boolean} isReady - Check if browser is ready for commands
 */

/**
 * Create a property-compatible GlobalBrowser bag with helpers.
 * @returns {GlobalBrowserState} result
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
 * @param {{ clearCdp?: boolean }} [opts] - Options for resetting the browser state
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

  /**
   * True when the local agent child process is still running.
   * @returns {boolean} Whether the agent process is alive
   */
  isAlive() {
      return isProcessAlive(this.process);
    },

  /**
   * True when the agent has signaled ready and stdin is writable.
   * @returns {boolean} Whether the browser is ready for commands
   */
  isReady() {
      return !!(this.ready && this.stdin);
    },
  };
}
