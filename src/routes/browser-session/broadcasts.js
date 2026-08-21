import { USE_EXECUTOR } from '#config/config.js';
import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import { getRemoteStatus } from '../../cdp/remote-bridge.js';
import * as remoteSessionService from '../../services/remote-session-service.js';

export function broadcastSessions() {
  const gb = state.globalBrowser;
  const list = [];
  for (const [id, s] of state.sessions) {
    list.push({
      sessionId: id, model: s.model, stepIndex: s.stepIndex,
      busy: gb.busy, createdAt: s.createdAt, stepCount: s.trajectories.length,
    });
  }
  broadcast('sessions:updated', { sessions: list });
}

/** Prefer executor live BiB status when USE_EXECUTOR — local bridge is always detached then. */
function pushRemoteStatus() {
  if (USE_EXECUTOR) {
    // Broadcast per attached binding so traj-scoped studios do not get clobbered
    // by an unscoped attached:false / wrong-traj status.
    const bindings = remoteSessionService.listLiveBindings?.() || [];
    const attached = bindings.filter((b) => b.attached);
    if (!attached.length) {
      remoteSessionService.getLiveStatus()
        .then((s) => broadcast('remote:status', s))
        .catch(() => {});
      return;
    }
    Promise.all(
      attached.map((b) => remoteSessionService.getLiveStatus({
        trajectoryId: b.trajectoryId ?? undefined,
        remoteSessionId: b.remoteSessionId,
      }).catch(() => null)),
    ).then((statuses) => {
      for (const s of statuses) {
        if (s) broadcast('remote:status', s);
      }
    }).catch(() => {});
    return;
  }
  broadcast('remote:status', getRemoteStatus());
}

export function broadcastWatcherStatus() {
  const gb = state.globalBrowser;
  const executorSessions = [...state.sessions.values()].filter((s) => s.useExecutor);
  const executorBusy = executorSessions.some((s) => s.busy);
  broadcast('watcher:status', {
    connected: USE_EXECUTOR
      ? executorSessions.length > 0
      : !!(gb.ready && gb.stdin),
    agentBusy: USE_EXECUTOR ? executorBusy : gb.busy,
    cdpReady: USE_EXECUTOR ? false : !!(gb.cdpWsUrl || gb.cdpHttp),
    cdpHttp: USE_EXECUTOR ? null : (gb.cdpHttp || null),
    useExecutor: USE_EXECUTOR,
  });
  pushRemoteStatus();
}
