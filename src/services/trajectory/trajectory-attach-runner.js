/**
 * One-shot prepare for recording studio, serialized per trajectory (unlocked
 * body of prepareTrajectoryRecording). Extracted from
 * trajectory-attach-service.js — move-only, no logic changes.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as execSession from '../../executor-session-client.js';
import * as remoteSessionService from '../remote-session-service.js';
import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import {
  resolveTrajectoryAccount,
} from '../trajectory-account-service.js';
import { getTrajectoryTree } from '../trajectory-query-service.js';
import {
  clearStaleTrajectoryRuntime,
  getTrajectoryRuntime,
} from '../trajectory-runtime.js';
import { runDefaultLogin } from './trajectory-record-lifecycle.js';
import { USE_EXECUTOR } from '../../../config/config.js';
import { attachTrajectoryLive } from './trajectory-attach-service.js';

export async function prepareTrajectoryRecordingUnlocked(tid) {
  const { traj, account, accountId } = await resolveTrajectoryAccount(tid);

  if (!USE_EXECUTOR) {
    // Local path: single-live only — refuse if another traj already holds a stream.
    const anyLive = remoteSessionService.listLiveBindings?.()?.some((b) => b.attached && Number(b.trajectoryId) !== tid);
    if (anyLive) {
      const err = new Error('Local (non-executor) mode only supports one live trajectory; detach the other first');
      err.statusCode = 409;
      throw err;
    }
  }

  const stages = {
    session: { status: 'pending' },
    browser: { status: 'pending' },
    stream: { status: 'pending' },
    login: { status: 'pending' },
  };

  const emitStage = (stage, status, extra = {}) => {
    stages[stage] = { status, ...extra, at: new Date().toISOString() };
    try {
      broadcast('recording:prepare', { trajectoryId: tid, stage, status, ...extra });
    } catch {}
  };

  emitStage('session', 'running');
  emitStage('browser', 'running');

  let attachResult = null;
  let runtime = await clearStaleTrajectoryRuntime(tid);
  if (!runtime) {
    attachResult = await attachTrajectoryLive(tid);
    runtime = getTrajectoryRuntime(tid);
  } else {
    attachResult = {
      sessionId: runtime.sessionId,
      executorNodeUuid: runtime.executorNodeUuid,
      remoteSessionId: runtime.remoteSessionId,
      bibError: runtime.bibError || null,
      reused: true,
      status: await remoteSessionService.getLiveStatus({ trajectoryId: tid }).catch(() => null),
    };
  }

  if (!runtime?.sessionId) {
    emitStage('session', 'error', { error: 'no session' });
    const err = new Error('Failed to open executor session for prepare');
    err.statusCode = 503;
    throw err;
  }

  emitStage('session', 'done', {
    sessionId: runtime.sessionId,
    executorNodeUuid: runtime.executorNodeUuid,
    reused: !!attachResult?.reused,
    reusedChrome: !!attachResult?.reusedChrome,
  });
  emitStage('browser', 'done', {
    cdpPort: state.sessions.get(runtime.sessionId)?.cdpPort ?? null,
    cdpReady: state.sessions.get(runtime.sessionId)?.cdpReady !== false,
  });

  // ── stream: attach BiB for THIS trajectory only ──
  emitStage('stream', 'running');
  let bibError = runtime.bibError || attachResult?.bibError || null;
  let remoteSessionId = null;

  const liveNow = await remoteSessionService.getLiveStatus({
    trajectoryId: tid,
    preferAgentSessionId: runtime.sessionId,
  }).catch(() => null);
  const liveMatchesRuntime = liveNow?.attached
    && liveNow?.remoteSessionId
    && liveNow.sessionId === runtime.sessionId;

  if (liveMatchesRuntime) {
    remoteSessionId = liveNow.remoteSessionId;
    runtime.remoteSessionId = remoteSessionId;
    await remoteSessionService.mountTrajectoryRemoteSession(tid, remoteSessionId).catch(() => {});
  } else {
    // Drop dirty bindings for other agent sessions; keep current agent's row if any.
    await remoteSessionService.supersedeStaleForTrajectory(tid, {
      keepAgentSessionId: runtime.sessionId,
    }).catch(() => {});

    const liveAfter = await remoteSessionService.getLiveStatus({
      trajectoryId: tid,
      preferAgentSessionId: runtime.sessionId,
    }).catch(() => null);
    if (liveAfter?.attached && liveAfter.sessionId === runtime.sessionId && liveAfter.remoteSessionId) {
      remoteSessionId = liveAfter.remoteSessionId;
      runtime.remoteSessionId = remoteSessionId;
      await remoteSessionService.mountTrajectoryRemoteSession(tid, remoteSessionId).catch(() => {});
    } else {
      // Do not reuse a superseded/closed runtime.remoteSessionId — force re-attach.
      remoteSessionId = null;
      runtime.remoteSessionId = null;
    }
  }

  if (!remoteSessionId && !bibError) {
    try {
      const attached = await remoteSessionService.attachLive({
        sessionId: runtime.sessionId,
        trajectoryId: tid,
        quality: 65,
        viewportW: 1600,
        viewportH: 900,
      });
      remoteSessionId = attached?.remoteSession?.id ?? attached?.status?.remoteSessionId ?? null;
      runtime.remoteSessionId = remoteSessionId;
      // attachLive already mounts exclusively; keep runtime in sync
      runtime.bibError = null;
      bibError = null;
    } catch (err) {
      if (err?.statusCode === 409 || err?.code === 'grace_owned') throw err;
      bibError = err?.message || String(err);
      runtime.bibError = bibError;
    }
  }

  if (remoteSessionId && runtime.executorNodeUuid) {
    try {
      execSession.sendToExecutor(runtime.executorNodeUuid, 'session.bib_start', {
        sessionId: runtime.sessionId,
      });
    } catch (err) {
      console.warn('[prepare] bib_start failed:', err.message);
    }
  }

  if (bibError || !remoteSessionId) {
    emitStage('stream', 'degraded', {
      remoteSessionId,
      sessionId: runtime.sessionId,
      error: bibError || 'BiB not attached',
    });
  } else {
    emitStage('stream', 'done', { remoteSessionId, sessionId: runtime.sessionId });
    const currentStatus = (await trajectoryDao.getById(tid).catch(() => null))?.recordStatus;
    if (currentStatus !== 'recording') {
      await trajectoryDao.updateMeta(tid, { recordStatus: 'live' }).catch(() => {});
    }
  }

  emitStage('login', 'running', { accountId });
  let login = { skipped: false, done: false, accountId };
  try {
    if (runtime.loginDone && Number(runtime.loginAccountId) === Number(accountId)) {
      login = { skipped: true, done: true, accountId };
      emitStage('login', 'skipped', { accountId });
    } else {
      await runDefaultLogin(runtime, account);
      login = { skipped: false, done: true, accountId };
      emitStage('login', 'done', { accountId });
    }
  } catch (err) {
    emitStage('login', 'error', { accountId, error: err.message });
    throw err;
  }

  const fresh = await trajectoryDao.getById(tid);
  const tree = await getTrajectoryTree(tid);
  const liveStatus = await remoteSessionService.getLiveStatus({ trajectoryId: tid }).catch(() => null);

  const streamOk = !!remoteSessionId && !bibError;
  return {
    trajectoryId: tid,
    trajectory: fresh || traj,
    recordStatus: fresh?.recordStatus || (streamOk ? 'live' : traj?.recordStatus) || null,
    phases: tree?.phases || [],
    orphanSteps: tree?.orphanSteps || [],
    sessionId: runtime.sessionId,
    executorNodeUuid: runtime.executorNodeUuid,
    remoteSessionId,
    status: liveStatus || attachResult?.status || null,
    attached: !!remoteSessionId,
    login,
    systemAccountId: accountId,
    bibError,
    stream: { ok: streamOk, remoteSessionId },
    stages,
    reused: !!attachResult?.reused,
    reusedChrome: !!attachResult?.reusedChrome,
    ready: true,
  };
}
