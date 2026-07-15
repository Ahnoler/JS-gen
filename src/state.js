export const state = {
  defaultModel: null,
  globalBrowser: {
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
  },
  sessions: new Map(),
};
