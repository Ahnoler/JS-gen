/**
 * Remote-bridge shared state + tiny helpers (single-live Remote Browser bridge).
 * All mutable state lives in `bridge` so index.js / screencast.js / cdp-input.js /
 * ws-router.js observe the same values (ESM live binding on the object).
 */
import { broadcast } from '../../ws-server.js';
import { state } from '../../state.js';

/** Binary frame magic: Remote ScreenCast Frame */
export const MAGIC = Buffer.from('RSCF');

/** Align with Session BrowserContextConfig (session_runner.py) */
export const SESSION_VIEWPORT = { w: 1600, h: 900, dpr: 1 };
export const STREAM_MAX_W = 1920;
export const STREAM_MAX_H = 1080;
export const MIN_FORWARD_MS = 33;
export const STALL_RESTART_MS = 2500;

/** Mutable state shared by all remote-bridge modules. */
export const bridge = {
  client: null,
  remoteSession: null,
  screencastOn: false,
  viewport: { ...SESSION_VIEWPORT },
  quality: 65,
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
  stallTimer: null,
  restartingCast: false,
  /** @type {WeakMap<import('ws').WebSocket, { trajectoryId: number|null, sessionId: string|null, remoteSessionId: number|null, remoteSessionUuid: string|null }>} */
  wsTrajectoryBind: new WeakMap(),
};

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
