/**
 * Trajectory attach / prepare / detach + BiB and manual-persist binding.
 * Lifecycle is 1:1 trajectory ↔ remote_session ↔ agent session.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as remoteSessionDao from '../../dao/remote-session-dao.js';
import * as executorNodeDao from '../../dao/executor-node-dao.js';
import * as execSession from '../../executor-session-client.js';
import * as slotLease from '../../executor-slot-lease.js';
import * as remoteSessionService from '../remote-session-service.js';
import { assertClaimable, clearOwnershipOnClose } from '../session-lifecycle.js';
import { isWithinGrace } from '../session-lifecycle-rules.js';
import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import {
  clearStaleTrajectoryRuntime,
  deleteTrajectoryRuntime,
  getTrajectoryRuntime,
  registerTrajectorySession,
} from './trajectory-runtime.js';
import { resolveModelId } from '../../runtime/resolve-model.js';
import { prepareTrajectoryRecordingUnlocked } from './trajectory-attach-runner.js';
import { isAiRecordingActive } from './trajectory-status-utils.js';

/** Lazy accessor — avoid static cycle with trajectory-persist-service.js */
async function appendRecordedStep(...args) {
  const mod = await import('./trajectory-persist-service.js');
  return mod.appendRecordedStep(...args);
}

/**
 * Whether an occupied row is tied to the Chrome we just opened (or ambiguous).
 * Skip rows with a proven different slotIndex; fail-closed for idle grace/owned
 * when slot cannot be proven different (incl. opened.slotIndex null).
 */
function rowTiedToReusedChrome(row, opened) {
  const openedSlot = opened?.slotIndex != null && Number.isFinite(Number(opened.slotIndex))
    ? Number(opened.slotIndex)
    : null;
  const rowSlot = row?.slotIndex != null && Number.isFinite(Number(row.slotIndex))
    ? Number(row.slotIndex)
    : null;
  const openedCdp = opened?.cdpPort != null && Number.isFinite(Number(opened.cdpPort))
    ? Number(opened.cdpPort)
    : null;
  const rowCdp = row?.cdpPort != null && Number.isFinite(Number(row.cdpPort))
    ? Number(row.cdpPort)
    : null;

  // Proven different Chrome on another slot → skip (avoids multi-slot false 409)
  if (openedSlot != null && rowSlot != null && openedSlot !== rowSlot) {
    return false;
  }

  // Same slot → tied
  if (openedSlot != null && rowSlot != null && openedSlot === rowSlot) {
    return true;
  }

  // CDP port match when row stores it
  if (openedCdp != null && rowCdp != null && openedCdp === rowCdp) {
    return true;
  }

  // Idle grace / owned + cannot prove different slot → fail closed
  if (row?.status === 'idle') {
    const ownedOrGrace = isWithinGrace(row) || row?.trajectoryId != null;
    if (ownedOrGrace) return true;
  }

  return false;
}

/**
 * When preferIdleChrome reused a Chrome, deny if that Chrome is tied to a
 * foreign grace-owned remote_session (before registerRuntime / BiB).
 * Slot-aware: different non-null slotIndex rows are skipped; same/unknown
 * slot + idle grace still gated. Runs whenever reusedChrome (cdpPort optional).
 */
async function assertNoForeignGraceOnNodeSlot(tid, opened) {
  if (!opened?.reusedChrome) return;
  const node = opened.nodeUuid
    ? await executorNodeDao.getByUuid(opened.nodeUuid).catch(() => null)
    : null;
  if (!node?.id) return;
  const rows = await remoteSessionDao.listByNode(node.id, ['idle', 'active']);
  for (const row of rows) {
    if (!rowTiedToReusedChrome(row, opened)) continue;
    assertClaimable(row, tid);
  }
}

/** Resolve remote_session id after streamDetach cleared cache/runtime. */
async function resolveHardDetachRemoteSessionId(tid, { traj, runtime, sessionId }) {
  let remoteSessionId = traj?.remoteSessionId
    || runtime?.remoteSessionId
    || null;
  if (remoteSessionId) return Number(remoteSessionId);

  const byTraj = await remoteSessionDao.getByTrajectory(tid).catch(() => null);
  if (byTraj && (byTraj.status === 'idle' || byTraj.status === 'active')) {
    return Number(byTraj.id);
  }
  if (sessionId) {
    const occupied = await remoteSessionDao.getOccupiedByAgentSession(sessionId).catch(() => null);
    if (occupied) return Number(occupied.id);
  }
  return null;
}

async function hardCloseRemoteSession(remoteSessionId) {
  if (!remoteSessionId) return;
  try {
    await clearOwnershipOnClose(remoteSessionId);
    await remoteSessionDao.close(remoteSessionId, { crashed: false });
    remoteSessionService.clearLiveBinding(remoteSessionId);
  } catch {}
}

async function releaseOpenedSessionBestEffort(sessionId, opened) {
  try {
    await execSession.closeSession({
      nodeUuid: opened?.nodeUuid,
      sessionId,
      // Reused Chrome belongs to the grace owner — leave it idle, drop our lease only.
      keepBrowser: !!opened?.reusedChrome,
    });
  } catch {
    slotLease.releaseBySession(sessionId);
  }
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
      // Claim denials must surface as HTTP 409, not soft bibError.
      if (err?.statusCode === 409 || err?.code === 'grace_owned') throw err;
      bibError = err?.message || String(err);
      console.warn(`[trajectory] BiB attach failed (session kept): ${bibError}`);
    }
  }
  const remoteSessionId = attached?.remoteSession?.id ?? attached?.status?.remoteSessionId ?? null;
  if (remoteSessionId) {
    // syncMount-only — no cache-only updateMeta fallback on mount failure
    await remoteSessionService.mountTrajectoryRemoteSession(tid, remoteSessionId).catch((err) => {
      console.warn(`[trajectory] syncMount failed for traj #${tid} rs=${remoteSessionId}:`, err?.message || err);
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
    const live = (await import('../../executor-registry.js')).list().filter((n) => n.connected);
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

  try {
    await assertNoForeignGraceOnNodeSlot(tid, opened);
  } catch (err) {
    await releaseOpenedSessionBestEffort(sessionId, opened);
    throw err;
  }

  const runtime = registerTrajectorySession(tid, sessionId, { ...opened, model }, {});
  bindTrajectoryManualPersist(tid, sessionId, runtime);
  let bib;
  try {
    bib = await attachBibBestEffort(tid, sessionId, runtime);
  } catch (err) {
    if (err?.statusCode === 409 || err?.code === 'grace_owned') {
      deleteTrajectoryRuntime(tid);
      await releaseOpenedSessionBestEffort(sessionId, opened);
    }
    throw err;
  }

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
 * Disconnect stream only (浏览器置 idle，清 FK，录制中(非AI)→draft). Agent session kept.
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
    if (runtime) {
      // Closing the browser also aborts any in-flight recording, but detach must not
      // change recordStatus. Mark userStop so the aborted runner keeps the current status.
      runtime.abortRecording = true;
      runtime.userStop = { success: false };
    }
    // Cache/runtime may be null after streamDetach — resolve via truth
    const remoteSessionId = await resolveHardDetachRemoteSessionId(tid, {
      traj,
      runtime,
      sessionId,
    });

    // Stop BiB for THIS traj only (never clear global map blindly)
    try {
      await remoteSessionService.detachLive({
        trajectoryId: tid,
        remoteSessionId: remoteSessionId || undefined,
        crashed: false,
      });
    } catch {}

    // Hard detach: clear ownership immediately via lifecycle, then close row
    await hardCloseRemoteSession(remoteSessionId);

    // Also close any occupied remote row still bound to this agent session
    if (sessionId) {
      const occupied = await remoteSessionDao.getOccupiedByAgentSession(sessionId).catch(() => null);
      if (occupied && Number(occupied.id) !== Number(remoteSessionId)) {
        await hardCloseRemoteSession(occupied.id);
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

    // Detach only releases executor resources; it must not change recordStatus.
    let recordStatus = traj?.recordStatus || null;

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
 * (runtime map may be empty). 录制中(非AI)→draft；AI活跃→failed when requested.
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

  if (demoteLive && traj.recordStatus === 'recording') {
    // 清理/重启回收：非终结性恢复或 AI 中断。
    // 首次(基线 draft) AI 中断 → failed；其余一律恢复到录制前持久状态基线，不降级。
    if (await isAiRecordingActive(tid)) {
      await trajectoryDao.finishTransientRecording(tid, 'failure');
    } else {
      await trajectoryDao.restorePersistentRecordStatus(tid);
    }
  } else if (traj.remoteSessionId) {
    await trajectoryDao.updateMeta(tid, { remoteSessionId: null });
  }

  return { trajectoryId: tid, cleaned: closed || demoteLive, via: 'persisted' };
}
