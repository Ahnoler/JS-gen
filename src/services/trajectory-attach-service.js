/**
 * Trajectory attach / prepare / detach + BiB and manual-persist binding.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../dao/trajectory-dao.js';
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
      attached = await remoteSessionService.attachLive({ sessionId, quality: 70 });
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
  // Share dedupe set with session-level live persist when present
  if (!session.persistedActionIds) session.persistedActionIds = runtime.persistedActionIds;
  else runtime.persistedActionIds = session.persistedActionIds;

  session._trajPersistUnsub = execSession.subscribeSessionEvents(sessionId, async (type, payload) => {
    if (type !== 'manual_action_recorded') return;
    if (runtime.suppressStepPersist || runtime.isReplay) return;
    // Dashboard/session hook already owns live persist when active
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
 * One-shot prepare for recording studio:
 *  1) session create (executor slot)
 *  2) browser allocate (+ CDP)
 *  3) BiB attach + screencast (stream)
 *  4) navigate/login (not persisted as steps)
 *
 * Requires trajectory.systemAccountId. Idempotent when session+login already live.
 */
export async function prepareTrajectoryRecording(trajectoryId) {
  const tid = Number(trajectoryId);
  const { traj, account, accountId } = await resolveTrajectoryAccount(tid);

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

  // ── 1+2: session + browser (+ best-effort BiB inside attachTrajectoryLive) ──
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
      status: await remoteSessionService.getLiveStatus().catch(() => null),
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

  // ── 3: ensure stream (BiB screencast) before login so canvas can show login ──
  emitStage('stream', 'running');
  let bibError = runtime.bibError || attachResult?.bibError || null;
  let remoteSessionId = runtime.remoteSessionId || attachResult?.remoteSessionId || null;

  if (!remoteSessionId && !bibError) {
    try {
      const attached = await remoteSessionService.attachLive({
        sessionId: runtime.sessionId,
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
    // Occupy indicator for trajectory list: stream ready ⇒ live (not AI recording)
    await trajectoryDao.updateMeta(tid, { recordStatus: 'live' }).catch(() => {});
  }

  // ── 4: login / navigate (default ops — not written to trajectory_step) ──
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
  const liveStatus = await remoteSessionService.getLiveStatus().catch(() => null);

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
    /** Critical path ready: session + browser + login (stream may be degraded). */
    ready: true,
  };
}

/**
 * Acquire executor resources for a trajectory:
 *  1) reuse live session for this traj
 *  2) free slot + orphan CDP Chrome → open with cdpUrl
 *  3) free slot → launch new Chrome
 *  4) no free slot → 409
 */
export async function attachTrajectoryLive(trajectoryId) {
  const tid = Number(trajectoryId);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  // Idempotent: already attached for this trajectory with a live session on executor
  const existing = await clearStaleTrajectoryRuntime(tid);
  if (existing?.sessionId && state.sessions.has(existing.sessionId)) {
    const liveStatus = await remoteSessionService.getLiveStatus().catch(() => null);
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

  // Drop orphan lease for this traj, then reconcile leases vs executor reality on candidates.
  slotLease.releaseByTrajectory(tid);

  let nodeUuid;
  try {
    nodeUuid = await execSession.pickExecutorNode({});
  } catch (err) {
    if (err?.statusCode === 409) throw err;
    const e = slotLease.noFreeSlotsError();
    e.message = err?.message || e.message;
    throw e;
  }

  await execSession.reconcileLeasesWithExecutor(nodeUuid).catch(() => {});

  // Re-check capacity after reconcile
  try {
    nodeUuid = await execSession.pickExecutorNode({ nodeUuid });
  } catch (err) {
    throw err?.statusCode === 409 ? err : slotLease.noFreeSlotsError();
  }

  let cdpUrl = null;
  let cdpPort = null;
  let reusedChrome = false;
  try {
    const { browsers } = await execSession.listExecutorCdp(nodeUuid, 12000);
    const pick = browsers?.[0];
    if (pick?.cdpWsUrl) {
      cdpUrl = pick.cdpWsUrl;
      cdpPort = pick.port != null ? Number(pick.port) : null;
      reusedChrome = true;
      console.log(`[trajectory] reusing CDP Chrome port=${cdpPort} for traj #${tid}`);
    }
  } catch (err) {
    console.warn('[trajectory] list_cdp failed, will launch new Chrome:', err.message);
  }

  const sessionId = randomUUID();
  const model = traj.model || 'deepseek-v4-flash';
  let opened;
  try {
    opened = await execSession.openSession({
      sessionId,
      model,
      trajectoryId: tid,
      nodeUuid,
      cdpUrl,
      cdpPort,
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

export async function detachTrajectoryLive(trajectoryId, { reason = 'manual' } = {}) {
  const tid = Number(trajectoryId);
  const runtime = getTrajectoryRuntime(tid);
  const traj = await trajectoryDao.getById(tid);
  const sessionId = runtime?.sessionId || null;

  // Always tear down BiB / live pointer (even if runtime.remoteSessionId missing).
  try {
    await remoteSessionService.detachLive({ crashed: false });
  } catch {}
  try {
    remoteSessionService.clearExecutorLive?.();
  } catch {}

  if (sessionId) {
    const session = state.sessions.get(sessionId);
    if (session?._trajPersistUnsub) {
      try { session._trajPersistUnsub(); } catch {}
      session._trajPersistUnsub = null;
    }
    try {
      await execSession.closeSession({
        nodeUuid: runtime.executorNodeUuid,
        sessionId,
      });
    } catch {
      slotLease.releaseBySession(sessionId);
    }
    state.sessions.delete(sessionId);
  }
  slotLease.releaseByTrajectory(tid);
  deleteTrajectoryRuntime(tid);

  // Release occupancy: live/recording → draft (do not clobber recorded/completed)
  let recordStatus = traj?.recordStatus || null;
  const meta = { remoteSessionId: null };
  if (traj && (traj.recordStatus === 'live' || traj.recordStatus === 'recording')) {
    meta.recordStatus = 'draft';
    recordStatus = 'draft';
  }
  if (traj) await trajectoryDao.updateMeta(tid, meta);

  const status = await remoteSessionService.getLiveStatus().catch(() => ({
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
  });

  return { trajectoryId: tid, detached: true, recordStatus, reason };
}
