/**
 * Remote-bridge shared state + tiny helpers (single-live Remote Browser bridge).
 * All mutable state lives in `bridge` so index.js / screencast.js / cdp-input.js /
 * ws-router.js observe the same values (ESM live binding on the object).
 */
import { broadcast } from '../../ws-server.js';
import { state } from '../../state.js';
import {
  DEFAULT_MIN_FORWARD_MS,
  DEFAULT_EVERY_NTH_FRAME,
  DEFAULT_STREAM_QUALITY,
  DEFAULT_STREAM_MAX_W,
  DEFAULT_STREAM_MAX_H,
  resolveScreencastTiming,
} from '../screencast-timing.js';

/** Binary frame magic: Remote ScreenCast Frame */
export const MAGIC = Buffer.from('RSCF');

/** Align with Session BrowserContextConfig (session_runner.py) */
export const SESSION_VIEWPORT = { w: 1600, h: 900, dpr: 1 };
export const STREAM_MAX_W = DEFAULT_STREAM_MAX_W;
export const STREAM_MAX_H = DEFAULT_STREAM_MAX_H;
// Re-export default for readers; runtime throttle should use bridge.minForwardMs.
export const MIN_FORWARD_MS = DEFAULT_MIN_FORWARD_MS;
export { resolveScreencastTiming };
export const STALL_RESTART_MS = 2500;

/** Mutable state shared by all remote-bridge modules. */
export const bridge = {
  client: null,
  remoteSession: null,
  screencastOn: false,
  viewport: { ...SESSION_VIEWPORT },
  quality: DEFAULT_STREAM_QUALITY,
  /** @type {Set<import('ws').WebSocket>} */
  subscribers: new Set(),
  wsHooked: false,
  lastHighlightAt: 0,
  lastInspectLabel: '',
  inspectEnabled: true,
  fillRecordTimer: null,
  lastTypedTextAt: 0,
  /** @type {{ hint: object, beforeSnap: Array } | null} */
  pendingDateDayPick: null,
  lastFrameAt: 0,
  lastForwardAt: 0,
  minForwardMs: DEFAULT_MIN_FORWARD_MS,
  everyNthFrame: DEFAULT_EVERY_NTH_FRAME,
  ackPacer: null,
  /** Last RSCF packet forwarded — cached for instant paint on new subscriber. */
  lastPacket: null,
  stallTimer: null,
  restartingCast: false,
  /** @type {WeakMap<import('ws').WebSocket, { trajectoryId: number|null, sessionId: string|null, remoteSessionId: number|null, remoteSessionUuid: string|null }>} */
  wsTrajectoryBind: new WeakMap(),
};

/**
 * Build a remote-bridge status snapshot for the dashboard.
 * @returns {{ attached: boolean, remoteSessionId: number|null, remoteSessionUuid: string|null, cdpReady: boolean, cdpHttp: string|null, inputEnabled: boolean, agentBusy: boolean, manualRecording: boolean, inspectEnabled: boolean, inspectLabel: string|null, viewportW: number, viewportH: number }} Status snapshot.
 */
export function getRemoteStatus() {
  const gb = state.globalBrowser;
  return {
    attached: !!bridge.client && bridge.screencastOn,
    remoteSessionId: bridge.remoteSession?.id ?? null,
    remoteSessionUuid: bridge.remoteSession?.sessionUuid ?? null,
    cdpReady: !!(gb.cdpWsUrl || gb.cdpHttp),
    cdpHttp: gb.cdpHttp || null,
    inputEnabled: !!(bridge.client && bridge.screencastOn && !gb.busy),
    agentBusy: !!gb.busy,
    manualRecording: !!gb.manualRecording,
    inspectEnabled: bridge.inspectEnabled,
    inspectLabel: bridge.lastInspectLabel || null,
    viewportW: bridge.viewport.w,
    viewportH: bridge.viewport.h,
  };
}

/**
 * Push an event line to the agent process stdin (JSON + newline).
 * @param {string} event Event name.
 * @param {object} [data] Event payload.
 * @returns {boolean} True if written, false if agent not ready or write failed.
 */
export function pushAgentEvent(event, data = {}) {
  const gb = state.globalBrowser;
  if (!gb.stdin || !gb.ready) return false;
  try {
    gb.stdin.write(JSON.stringify({ event, data }) + '\n');
    return true;
  } catch (e) {
    console.warn('[remote-bridge] stdin write failed:', e.message);
    return false;
  }
}

/**
 * Broadcast a remote:inspect event with the current inspect label.
 * @param {string} [label] Inspect label text.
 * @returns {void}
 */
export function broadcastInspect(label) {
  bridge.lastInspectLabel = label || '';
  broadcast('remote:inspect', {
    label: bridge.lastInspectLabel || null,
    manualRecording: !!state.globalBrowser.manualRecording,
  });
}

export function broadcastStatus() {
  broadcast('remote:status', getRemoteStatus());
}
