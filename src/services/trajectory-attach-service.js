/**
 * Trajectory attach / prepare / detach + BiB and manual-persist binding.
 * Lifecycle is 1:1 trajectory ↔ remote_session ↔ agent session.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as remoteSessionDao from '../dao/remote-session-dao.js';
import * as execSession from '../executor-session-client.js';
import * as slotLease from '../executor-slot-lease.js';
import * as remoteSessionService from './remote-session-service.js';
import { state } from '../state.js';
import { broadcast } from '../ws-server.js';
import {
  resolveTrajectoryAccount,
} from './trajectory-account-service.js';
import { getTrajectoryTree } from './trajectory-query-service.js';
import {
  clearStaleTrajectoryRuntime,
  deleteTrajectoryRuntime,
  getTrajectoryRuntime,
  registerTrajectorySession,
} from './trajectory-runtime.js';
import { runDefaultLogin } from './trajectory-record-lifecycle.js';
import { USE_EXECUTOR } from '../../config/config.js';

/** Lazy accessor — avoid static cycle with trajectory-persist-service.js */
async function appendRecordedStep(...args) {
  const mod = await import('./trajectory-persist-service.js');
  return mod.appendRecordedStep(...args);
}

async function attachBibBestEffort(tid, sessionId, runtime) {
  let attached = null;
  let bibError = null;
  const session = state.sessions.get(sessionId);
  const cdpReady = session?.cdpReady !== false;
  if (!cdpReady) {
    bibError = `CDP not ready on port ${session?.cdpPort ?? '?'} — skipped BiB attach`;
    console.warn(`[trajectory] ${bibError}`);
  } else {
    try {
      attached = await remoteSessionService.attachLive({
        sessionId,
        trajectoryId: tid,
        quality: 70,
      });
    } catch (err) {
      bibError = err?.message || String(err);
      console.warn(`[trajectory] BiB attach failed (session kept): ${bibError}`);
    }
  }
  const remoteSessionId = attached?.remoteSession?.id ?? attached?.status?.remoteSessionId ?? null;
  if (remoteSessionId) await trajectoryDao.updateMeta(tid, { remoteSessionId });
  if (runtime) {
    runtime.remoteSessionId = remoteSessionId;
    runtime.bibError = bibError;
  }
  return { attached, bibError, remoteSessionId, status: attached?.status };
}

/** Persist manual CDP actions for trajectory-attached sessions (phase via selectedPhaseId). */
export function bindTrajectoryManualPersist(trajectoryId, sessionId, runtime) {
  const session = state.sessions.get(sessionId);
  if (!session || session._trajPersistUnsub) return;
  if (!session.persistedActionIds) session.persistedActionIds = runtime.persistedActionIds;
  else runtime.persistedActionIds = session.persistedActionIds;

  session._trajPersistUnsub = execSession.subscribeSessionEvents(sessionId, async (type, payload) => {
    if (type !== 'manual_action_recorded') return;
    if (runtime.suppressStepPersist || runtime.isReplay) return;
    if (session._persistUnsub && session.autoPersist !== false) return;
    const entry = payload?.entry;
    if (!entry) return;
    const aid = entry.id != null ? String(entry.id) : '';
    if (aid) {
      if (runtime.persistedActionIds.has(aid)) return;
      runtime.persistedActionIds.add(aid);
    }
    const phaseId = session.selectedPhaseId ?? runtime.selectedPhaseId ?? null;
    try {
      const persisted = await appendRecordedStep(trajectoryId, entry, {
        source: 'manual',
        trajectoryPhaseId: phaseId != null ? Number(phaseId) : undefined,
      });
      if (persisted) {
        broadcast('manual_action_persisted', {
          trajectoryDbId: trajectoryId,
          sessionId,
          ...persisted,
          entry,
        });
      } else if (aid) {
        runtime.persistedActionIds.delete(aid);
      }
    } catch (err) {
      if (aid) runtime.persistedActionIds.delete(aid);
      console.warn('[trajectory-manual] live persist failed:', err.message);
    }
  });
}

/**
 * One-shot prepare for recording studio (serialized per trajectory).
 */
export async function prepareTrajectoryRecording(trajectoryId) {
  const tid = Number(trajectoryId);
  return remoteSessionService.withTrajectoryLock(tid, () => prepareTrajectoryRecordingUnlocked(tid));
}

async function prepareTrajectoryRecordingUnlocked(tid) {
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
  let remoteSessionId = runtime.remoteSessionId || attachResult?.remoteSessionId || null;

  const liveNow = await remoteSessionService.getLiveStatus({ trajectoryId: tid }).catch(() => null);
  if (liveNow?.attached && liveNow?.remoteSessionId) {
    remoteSessionId = liveNow.remoteSessionId;
    runtime.remoteSessionId = remoteSessionId;
  } else {
    remoteSessionId = null;
    runtime.remoteSessionId = null;
  }

  if (!remoteSessionId && !bibError) {
    try {
      const attached = await remoteSessionService.attachLive({
        sessionId: runtime.sessionId,
        trajectoryId: tid,
        quality: 70,
      });
      remoteSessionId = attached?.remoteSession?.id ?? attached?.status?.remoteSessionId ?? null;
      runtime.remoteSessionId = remoteSessionId;
      if (remoteSessionId) await trajectoryDao.updateMeta(tid, { remoteSessionId });
      runtime.bibError = null;
      bibError = null;
    } catch (err) {
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
    await trajectoryDao.updateMeta(tid, { recordStatus: 'live' }).catch(() => {});
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

/**
 * Acquire executor resources for a trajectory (agent session + optional BiB).
 */
export async function attachTrajectoryLive(trajectoryId) {
  const tid = Number(trajectoryId);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  const existing = await clearStaleTrajectoryRuntime(tid);
  if (existing?.sessionId && state.sessions.has(existing.sessionId)) {
    const liveStatus = await remoteSessionService.getLiveStatus({ trajectoryId: tid }).catch(() => null);
    return {
      trajectoryId: tid,
      sessionId: existing.sessionId,
      executorNodeUuid: existing.executorNodeUuid,
      remoteSessionId: existing.remoteSessionId,
      status: liveStatus,
      reused: true,
      reusedChrome: false,
    };
  }

  slotLease.releaseByTrajectory(tid);

  try {
    const live = (await import('../executor-registry.js')).list().filter((n) => n.connected);
    await Promise.all(
      live.map((n) => execSession.reconcileLeasesWithExecutor(n.nodeUuid).catch(() => {})),
    );
  } catch {}

  const sessionId = randomUUID();
  const model = traj.model || 'deepseek-v4-flash';
  let opened;
  try {
    opened = await execSession.openSession({
      sessionId,
      model,
      trajectoryId: tid,
      preferIdleChrome: true,
    });
  } catch (err) {
    if (
      err?.statusCode === 409
      || /no free/i.test(err?.message || '')
      || /无可用执行资源/.test(err?.message || '')
    ) {
      const e = slotLease.noFreeSlotsError();
      e.message = err.message || e.message;
      throw e;
    }
    throw err;
  }

  const reusedChrome = !!opened.reusedChrome;
  if (reusedChrome) {
    console.log(
      `[trajectory] reusing orphan CDP Chrome`
      + (opened.cdpPort != null ? ` port=${opened.cdpPort}` : '')
      + ` for traj #${tid} (orphan-recovery)`,
    );
  } else {
    console.log(`[trajectory] launching new Chrome for traj #${tid}`);
  }

  const runtime = registerTrajectorySession(tid, sessionId, { ...opened, model }, {});
  bindTrajectoryManualPersist(tid, sessionId, runtime);
  const bib = await attachBibBestEffort(tid, sessionId, runtime);

  return {
    trajectoryId: tid,
    sessionId,
    executorNodeUuid: opened.nodeUuid,
    remoteSessionId: bib.remoteSessionId,
    status: bib.status || { attached: false, cdpReady: opened.cdpReady !== false, bibError: bib.bibError },
    bibError: bib.bibError,
    reused: false,
    reusedChrome,
  };
}

/**
 * Disconnect stream only (浏览器置 idle，清 FK，live→draft). Agent session kept.
 * Idempotent when already disconnected.
 */
export async function detachTrajectoryStream(trajectoryId) {
  const tid = Number(trajectoryId);
  return remoteSessionService.withTrajectoryLock(tid, async () => {
    const traj = await trajectoryDao.getById(tid);
    if (!traj) {
      const err = new Error('Trajectory not found');
      err.statusCode = 404;
      throw err;
    }

    const runtime = getTrajectoryRuntime(tid);
    const remoteSessionId = traj.remoteSessionId
      || runtime?.remoteSessionId
      || remoteSessionService.getLiveBindingByTrajectory(tid)?.remoteSessionId
      || null;

    const result = await remoteSessionService.detachLive({
      trajectoryId: tid,
      remoteSessionId: remoteSessionId || undefined,
      crashed: false,
    });

    const fresh = await trajectoryDao.getById(tid);
    const status = await remoteSessionService.getLiveStatus({ trajectoryId: tid }).catch(() => ({
      attached: false,
      remoteSessionId: null,
    }));

    broadcast('remote:status', {
      ...status,
      attached: false,
      remoteSessionId: null,
      remoteSessionUuid: null,
      inputEnabled: false,
      reason: 'stream_detach',
      trajectoryId: tid,
    });
    broadcast('recording:stream_detached', {
      trajectoryId: tid,
      remoteSessionId: result.remoteSessionId || remoteSessionId,
      recordStatus: fresh?.recordStatus || 'draft',
      sessionId: runtime?.sessionId || null,
    });

    return {
      trajectoryId: tid,
      streamDetached: true,
      sessionKept: true,
      remoteSessionId: result.remoteSessionId || remoteSessionId,
      recordStatus: fresh?.recordStatus || null,
      status,
    };
  });
}

/**
 * Release executor resources: kill Chrome + Python + slot.
 * Only touches THIS trajectory's remote_session / agent session.
 */
export async function detachTrajectoryLive(trajectoryId, { reason = 'manual' } = {}) {
  const tid = Number(trajectoryId);
  return remoteSessionService.withTrajectoryLock(tid, async () => {
    const runtime = getTrajectoryRuntime(tid);
    const traj = await trajectoryDao.getById(tid);
    if (!traj && !runtime) {
      // Idempotent: nothing to release
      return { trajectoryId: tid, detached: true, recordStatus: null, reason };
    }

    const sessionId = runtime?.sessionId || null;
    const remoteSessionId = traj?.remoteSessionId
      || runtime?.remoteSessionId
      || null;

    // Stop BiB for THIS traj only (never clear global map blindly)
    try {
      await remoteSessionService.detachLive({
        trajectoryId: tid,
        remoteSessionId: remoteSessionId || undefined,
        crashed: false,
      });
    } catch {}

    // Close remote_session row (browser released)
    if (remoteSessionId) {
      try {
        await remoteSessionDao.close(remoteSessionId, { crashed: false });
        remoteSessionService.clearLiveBinding(remoteSessionId);
      } catch {}
    }

    // Also close any occupied remote row still bound to this agent session
    if (sessionId) {
      const occupied = await remoteSessionDao.getOccupiedByAgentSession(sessionId).catch(() => null);
      if (occupied) {
        try {
          await remoteSessionDao.close(occupied.id, { crashed: false });
          remoteSessionService.clearLiveBinding(occupied.id);
        } catch {}
      }
    }

    if (sessionId) {
      const session = state.sessions.get(sessionId);
      if (session?._trajPersistUnsub) {
        try { session._trajPersistUnsub(); } catch {}
        session._trajPersistUnsub = null;
      }
      try {
        await execSession.closeSession({
          nodeUuid: runtime?.executorNodeUuid,
          sessionId,
          keepBrowser: false,
        });
      } catch {
        slotLease.releaseBySession(sessionId);
      }
      state.sessions.delete(sessionId);
    }
    slotLease.releaseByTrajectory(tid);
    deleteTrajectoryRuntime(tid);

    let recordStatus = traj?.recordStatus || null;
    const meta = { remoteSessionId: null };
    if (traj && (traj.recordStatus === 'live' || traj.recordStatus === 'recording')) {
      meta.recordStatus = 'draft';
      recordStatus = 'draft';
    }
    if (traj) await trajectoryDao.updateMeta(tid, meta);

    const status = await remoteSessionService.getLiveStatus({ trajectoryId: tid }).catch(() => ({
      attached: false,
      remoteSessionId: null,
      cdpReady: false,
    }));
    broadcast('remote:status', {
      ...status,
      attached: false,
      remoteSessionId: null,
      remoteSessionUuid: null,
      inputEnabled: false,
      reason,
      trajectoryId: tid,
    });
    broadcast('recording:detached', {
      trajectoryId: tid,
      reason,
      recordStatus,
      sessionId,
      remoteSessionId,
    });

    try {
      const batchService = await import('./trajectory-batch-service.js');
      batchService.kickScheduler();
    } catch {}

    return { trajectoryId: tid, detached: true, recordStatus, reason, remoteSessionId };
  });
}

/**
 * Best-effort cleanup after control-plane restart using DB bindings only
 * (runtime map may be empty). Corrects live/recording → draft when requested.
 */
export async function cleanupPersistedTrajectoryResources(trajectoryId, {
  demoteLive = true,
  reason = 'batch_recovery',
} = {}) {
  const tid = Number(trajectoryId);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    return { trajectoryId: tid, cleaned: false };
  }

  // Prefer live detach when runtime still exists
  const runtime = getTrajectoryRuntime(tid);
  if (runtime?.sessionId) {
    try {
      await detachTrajectoryLive(tid, { reason });
    } catch (err) {
      console.warn('[batch-cleanup] detach failed:', err.message);
    }
    return { trajectoryId: tid, cleaned: true, via: 'detach' };
  }

  const remoteSessionId = traj.remoteSessionId || null;
  let closed = false;
  if (remoteSessionId) {
    try {
      await remoteSessionService.detachLive({
        trajectoryId: tid,
        remoteSessionId,
        crashed: true,
      }).catch(() => {});
      await remoteSessionDao.close(remoteSessionId, { crashed: true });
      remoteSessionService.clearLiveBinding(remoteSessionId);
      closed = true;
    } catch {}
  }

  // Also try agent_session_id from remote_session bound to trajectory
  try {
    const rs = await remoteSessionDao.getByTrajectory(tid);
    if (rs && (rs.status === 'active' || rs.status === 'idle')) {
      await remoteSessionDao.close(rs.id, { crashed: true });
      remoteSessionService.clearLiveBinding(rs.id);
      closed = true;
      if (rs.agentSessionId) {
        try {
          await execSession.closeSession({
            sessionId: rs.agentSessionId,
            keepBrowser: false,
          });
        } catch {
          slotLease.releaseBySession(rs.agentSessionId);
        }
      }
    }
  } catch {}

  slotLease.releaseByTrajectory(tid);

  if (demoteLive && (traj.recordStatus === 'live' || traj.recordStatus === 'recording')) {
    await trajectoryDao.updateMetaIf(tid, {
      recordStatus: 'draft',
      remoteSessionId: null,
    }, { recordStatusIn: ['live', 'recording'] });
  } else if (traj.remoteSessionId) {
    await trajectoryDao.updateMeta(tid, { remoteSessionId: null });
  }

  return { trajectoryId: tid, cleaned: closed || demoteLive, via: 'persisted' };
}
