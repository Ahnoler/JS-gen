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
  clearStaleTrajectoryRuntime,
  deleteTrajectoryRuntime,
  getTrajectoryRuntime,
  registerTrajectorySession,
} from './trajectory-runtime.js';
import { resolveModelId } from '../runtime/resolve-model.js';
import { prepareTrajectoryRecordingUnlocked } from './trajectory/trajectory-attach-runner.js';

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
        quality: 65,
        viewportW: 1600,
        viewportH: 900,
      });
    } catch (err) {
      bibError = err?.message || String(err);
      console.warn(`[trajectory] BiB attach failed (session kept): ${bibError}`);
    }
  }
  const remoteSessionId = attached?.remoteSession?.id ?? attached?.status?.remoteSessionId ?? null;
  if (remoteSessionId) {
    await remoteSessionService.mountTrajectoryRemoteSession(tid, remoteSessionId).catch(async () => {
      await trajectoryDao.updateMeta(tid, { remoteSessionId });
    });
  }
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

  await remoteSessionService.supersedeStaleForTrajectory(tid).catch(() => {});

  try {
    const live = (await import('../executor-registry.js')).list().filter((n) => n.connected);
    await Promise.all(
      live.map((n) => execSession.reconcileLeasesWithExecutor(n.nodeUuid).catch(() => {})),
    );
  } catch {}

  const sessionId = randomUUID();
  // Empty traj.model → agent-api.json defaultModel; explicit value kept as-is.
  const model = resolveModelId(traj.model);
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
        await remoteSessionService.unmountTrajectoriesFromRemoteSession(remoteSessionId).catch(() => {});
      } catch {}
    }

    // Also close any occupied remote row still bound to this agent session
    if (sessionId) {
      const occupied = await remoteSessionDao.getOccupiedByAgentSession(sessionId).catch(() => null);
      if (occupied) {
        try {
          await remoteSessionDao.close(occupied.id, { crashed: false });
          remoteSessionService.clearLiveBinding(occupied.id);
          await remoteSessionService.unmountTrajectoriesFromRemoteSession(occupied.id).catch(() => {});
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
      await remoteSessionService.unmountTrajectoriesFromRemoteSession(remoteSessionId).catch(() => {});
      closed = true;
    } catch {}
  }

  // Also try agent_session_id from remote_session bound to trajectory
  try {
    const rs = await remoteSessionDao.getByTrajectory(tid);
    if (rs && (rs.status === 'active' || rs.status === 'idle')) {
      await remoteSessionDao.close(rs.id, { crashed: true });
      remoteSessionService.clearLiveBinding(rs.id);
      await remoteSessionService.unmountTrajectoriesFromRemoteSession(rs.id).catch(() => {});
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
