import { randomUUID } from 'crypto';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as systemDao from '../dao/system-dao.js';
import { getDB } from '../../config/database.js';
import * as execSession from '../executor-session-client.js';
import * as slotLease from '../executor-slot-lease.js';
import * as remoteSessionService from './remote-session-service.js';
import { state } from '../state.js';
import { broadcast } from '../ws-server.js';
import { USE_EXECUTOR } from '../../config/config.js';
import * as remoteBridge from '../cdp/remote-bridge.js';
import {
  buildLoginInstruction,
  resolveTrajectoryAccount,
} from './trajectory-account-service.js';
import { getTrajectoryTree } from './trajectory-query-service.js';

/** Lazy accessor — avoid static cycle with trajectory-service.js (persist helpers) */
async function appendRecordedStep(...args) {
  const mod = await import('./trajectory-service.js');
  return mod.appendRecordedStep(...args);
}

/** Mark current ACTION_LOG ids as consumed so they are not later appended as steps. */
async function markConsumedActionLog(runtime) {
  if (!runtime?.sessionId || !runtime?.executorNodeUuid) return;
  try {
    const resultP = execSession.waitForSessionEvent(runtime.sessionId, 'get_action_log_result', 5000);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'get_action_log',
      data: {},
    });
    const result = await resultP.catch(() => null);
    const entries = Array.isArray(result?.entries) ? result.entries : [];
    for (const entry of entries) {
      const id = entry?.id != null ? String(entry.id) : '';
      if (id) runtime.persistedActionIds.add(id);
    }
  } catch (err) {
    console.warn('[trajectory] markConsumedActionLog failed:', err.message);
  }
}

/**
 * Default login/navigate — NOT written to trajectory_step (is_replay / suppress persist).
 */
async function runDefaultLogin(runtime, account, system = null) {
  const session = state.sessions.get(runtime.sessionId);
  if (session) session.busy = true;
  runtime.suppressStepPersist = true;
  runtime.isReplay = true;
  try {
    let sys = system;
    if (!sys?.url && account?.systemId) {
      sys = await systemDao.getById(Number(account.systemId));
    }
    const instruction = buildLoginInstruction(account, sys || {});
    const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_done', 300000);
    const errP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_error', 300000)
      .then((p) => Promise.reject(new Error(p?.message || 'login phase_error')));
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'step',
      data: {
        instruction,
        max_steps: 30,
        phase_number: 0,
      },
    });
    await Promise.race([doneP, errP]);
    await markConsumedActionLog(runtime);
    runtime.loginDone = true;
    runtime.loginAccountId = Number(account.id);
  } finally {
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    if (session) {
      session.busy = false;
      session.activePhaseId = null;
    }
  }
}

const trajectoryRuntimeMap = new Map();

export function getTrajectoryRuntime(trajectoryId) {
  return trajectoryRuntimeMap.get(Number(trajectoryId)) || null;
}

/** @returns {Map<number, object>} */
export function getAllTrajectoryRuntimes() {
  return trajectoryRuntimeMap;
}

/** Mark activity for idle reaper (after a step is persisted). */
export function touchTrajectoryRuntimeActivity(trajectoryId, at = new Date()) {
  const runtime = trajectoryRuntimeMap.get(Number(trajectoryId));
  if (!runtime) return;
  runtime.lastStepAt = at instanceof Date ? at.toISOString() : String(at);
}

/** Clear in-memory trajectory↔executor bindings for a node (offline / crash). */
export function clearTrajectoryRuntimesForNode(nodeUuid) {
  if (!nodeUuid) return 0;
  let n = 0;
  for (const [tid, runtime] of [...trajectoryRuntimeMap.entries()]) {
    if (runtime?.executorNodeUuid !== nodeUuid) continue;
    if (runtime.sessionId) {
      const session = state.sessions.get(runtime.sessionId);
      if (session?._trajPersistUnsub) {
        try { session._trajPersistUnsub(); } catch {}
      }
      state.sessions.delete(runtime.sessionId);
    }
    trajectoryRuntimeMap.delete(tid);
    n += 1;
  }
  return n;
}

/**
 * Drop stale trajectory runtime when the control-plane session is gone,
 * or when the executor no longer has that sessionId.
 */
async function clearStaleTrajectoryRuntime(tid, { verifyExecutor = true } = {}) {
  const existing = trajectoryRuntimeMap.get(tid);
  if (!existing) return null;
  if (!existing.sessionId || !state.sessions.has(existing.sessionId)) {
    slotLease.releaseByTrajectory(tid);
    trajectoryRuntimeMap.delete(tid);
    return null;
  }
  if (verifyExecutor && existing.executorNodeUuid) {
    try {
      const sessions = await execSession.listExecutorSessions(existing.executorNodeUuid, 8000);
      const live = sessions.some((s) => s.sessionId === existing.sessionId);
      if (!live) {
        const session = state.sessions.get(existing.sessionId);
        if (session?._trajPersistUnsub) {
          try { session._trajPersistUnsub(); } catch {}
        }
        state.sessions.delete(existing.sessionId);
        slotLease.releaseByTrajectory(tid);
        trajectoryRuntimeMap.delete(tid);
        return null;
      }
    } catch {
      // If executor is unreachable, keep runtime until disconnect purge.
    }
  }
  return existing;
}

/**
 * Bind control-plane session + trajectory runtime after a successful openSession.
 */
function registerTrajectorySession(tid, sessionId, opened, { bibError = null, remoteSessionId = null } = {}) {
  const persistedActionIds = new Set();
  state.sessions.set(sessionId, {
    sessionId,
    stepIndex: 0,
    trajectories: [],
    createdAt: new Date().toISOString(),
    model: opened.model || null,
    lastTask: null,
    lastMaxSteps: null,
    caseDataFile: null,
    useExecutor: true,
    executorNodeUuid: opened.nodeUuid,
    executorSlotIndex: opened.slotIndex,
    busy: false,
    dbTrajectoryId: tid,
    selectedPhaseId: null,
    activePhaseId: null,
    autoPersist: true,
    persistedActionIds,
    cdpPort: opened.cdpPort ?? null,
    cdpReady: opened.cdpReady !== false,
  });

  const runtime = {
    trajectoryId: tid,
    sessionId,
    executorNodeUuid: opened.nodeUuid,
    executorSlotIndex: opened.slotIndex,
    remoteSessionId,
    attachedAt: new Date().toISOString(),
    lastStepAt: null,
    persistedActionIds,
    selectedPhaseId: null,
    abortRecording: false,
    bibError,
    manualRecording: false,
  };
  trajectoryRuntimeMap.set(tid, runtime);
  bindTrajectoryManualPersist(tid, sessionId, runtime);
  return runtime;
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
    runtime = trajectoryRuntimeMap.get(tid);
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

/** Persist manual CDP actions for trajectory-attached sessions (phase via selectedPhaseId). */
function bindTrajectoryManualPersist(trajectoryId, sessionId, runtime) {
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
 * Re-execute selected DB steps in the live executor session.
 * isReplay=true (default): actions are NOT appended to trajectory_step lists.
 */
export async function replayTrajectorySteps(trajectoryId, { stepIds = [], isReplay = true } = {}) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  if (!runtime?.sessionId) {
    const err = new Error('Trajectory is not attached — call record/prepare first');
    err.statusCode = 400;
    throw err;
  }
  const ids = (Array.isArray(stepIds) ? stepIds : [])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) {
    const err = new Error('stepIds is required');
    err.statusCode = 400;
    throw err;
  }

  const db = getDB();
  const rows = await db('trajectory_step')
    .where({ trajectory_id: tid })
    .whereIn('id', ids)
    .orderBy(['step_number', 'action_index']);
  if (!rows.length) {
    const err = new Error('No matching steps for stepIds');
    err.statusCode = 404;
    throw err;
  }

  const { trajectoryStepToActionEntry } = await import('../models/element.js');
  const actions = rows.map((r) => {
    const step = fromDbRowCompat(r);
    const entry = trajectoryStepToActionEntry(step);
    return {
      action: entry.action,
      params: entry.params || {},
      target: entry.target || '',
      cssSelector: entry.cssSelector || '',
      tagName: entry.tagName || '',
      attributes: entry.attributes || {},
      description: entry.description || '',
      id: entry.id,
    };
  });

  const session = state.sessions.get(runtime.sessionId);
  if (session?.busy) {
    const err = new Error('Session is busy (AI recording in progress)');
    err.statusCode = 409;
    throw err;
  }

  const doSuppress = isReplay !== false;
  runtime.suppressStepPersist = doSuppress;
  runtime.isReplay = doSuppress;
  if (session) session.busy = true;

  try {
    const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', 300000);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'replay_actions',
      data: { actions, is_replay: doSuppress },
    });
    const result = await doneP;
    await markConsumedActionLog(runtime);
    const failed = Number(result?.failed) || 0;
    const okCount = Number(result?.ok) || 0;
    const count = result?.count ?? actions.length;
    const error = result?.error || (failed > 0
      ? `${failed}/${count} steps failed`
      : null);
    const payload = {
      trajectoryId: tid,
      isReplay: doSuppress,
      stepIds: rows.map((r) => r.id),
      count,
      ok: okCount,
      failed,
      error,
      results: Array.isArray(result?.results) ? result.results : undefined,
    };
    if (error) {
      const err = new Error(error);
      err.statusCode = 500;
      err.payload = payload;
      throw err;
    }
    return payload;
  } finally {
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    if (session) session.busy = false;
  }
}

function fromDbRowCompat(row) {
  if (!row) return null;
  const obj = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    obj[camel] = val;
  }
  return obj;
}

export async function detachTrajectoryLive(trajectoryId) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  const traj = await trajectoryDao.getById(tid);
  if (runtime?.remoteSessionId) {
    await remoteSessionService.detachLive({ crashed: false }).catch(() => {});
  }
  if (runtime?.sessionId) {
    const session = state.sessions.get(runtime.sessionId);
    if (session?._trajPersistUnsub) {
      try { session._trajPersistUnsub(); } catch {}
      session._trajPersistUnsub = null;
    }
    try {
      await execSession.closeSession({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
      });
    } catch {
      slotLease.releaseBySession(runtime.sessionId);
    }
    state.sessions.delete(runtime.sessionId);
  }
  slotLease.releaseByTrajectory(tid);
  trajectoryRuntimeMap.delete(tid);

  // Release occupancy: live/recording → draft (do not clobber recorded/completed)
  let recordStatus = traj?.recordStatus || null;
  const meta = { remoteSessionId: null };
  if (traj && (traj.recordStatus === 'live' || traj.recordStatus === 'recording')) {
    meta.recordStatus = 'draft';
    recordStatus = 'draft';
  }
  if (traj) await trajectoryDao.updateMeta(tid, meta);

  return { trajectoryId: tid, detached: true, recordStatus };
}

export async function startTrajectoryRecording(trajectoryId, { phaseIds = null, accountId = null } = {}) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  if (!runtime) {
    const err = new Error('Trajectory is not attached');
    err.statusCode = 400;
    throw err;
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  const allPhases = await trajectoryPhaseDao.listByTrajectory(tid);
  if (!allPhases.length) throw new Error('Trajectory has no phases');

  let phases = allPhases;
  if (Array.isArray(phaseIds) && phaseIds.length > 0) {
    const idSet = new Set(phaseIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0));
    phases = allPhases.filter((p) => idSet.has(Number(p.id)));
    if (!phases.length) {
      const err = new Error('No matching phases for phaseIds');
      err.statusCode = 400;
      throw err;
    }
    phases.sort((a, b) => Number(a.phaseNumber) - Number(b.phaseNumber));
  }

  // Login is a prepare-time default op (not in step table). Ensure browser is logged in.
  const { account, accountId: acctId } = await resolveTrajectoryAccount(tid, accountId);
  if (!(runtime.loginDone && Number(runtime.loginAccountId) === Number(acctId))) {
    await runDefaultLogin(runtime, account);
  }

  runtime.abortRecording = false;
  runtime.recordStartAt = new Date().toISOString();
  touchTrajectoryRuntimeActivity(tid);
  await trajectoryDao.updateMeta(tid, { recordStatus: 'recording', systemAccountId: acctId });
  for (const p of phases) await trajectoryPhaseDao.updateStatus(p.id, 'pending');

  const session = state.sessions.get(runtime.sessionId);
  if (session) {
    session.dbTrajectoryId = tid;
    session.busy = true;
  }

  const events = [];
  const unsubscribe = execSession.subscribeSessionEvents(runtime.sessionId, async (type, payload) => {
    if (type !== 'action_log_sync') return;
    if (runtime.suppressStepPersist || runtime.isReplay) return;
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const phaseIdHint = session?.activePhaseId != null ? Number(session.activePhaseId) : null;
    for (const entry of entries) {
      const id = entry?.id ? String(entry.id) : '';
      if (!id || runtime.persistedActionIds.has(id)) continue;
      // Manual/CDP have dedicated persist paths; skip to avoid double-write with action_log_sync
      const src = entry?.source || 'agent';
      if (src === 'manual' || src === 'cdp') continue;
      runtime.persistedActionIds.add(id);
      const persisted = await appendRecordedStep(tid, entry, {
        source: 'agent',
        trajectoryPhaseId: Number.isFinite(phaseIdHint) ? phaseIdHint : undefined,
      }).catch(() => null);
      if (persisted) {
        broadcast('action_persisted', {
          trajectoryDbId: tid,
          sessionId: runtime.sessionId,
          ...persisted,
          entry,
        });
      } else {
        runtime.persistedActionIds.delete(id);
      }
    }
  });

  try {
    for (const phase of phases) {
      if (runtime.abortRecording) {
        await trajectoryPhaseDao.updateStatus(phase.id, 'failed').catch(() => {});
        throw new Error('Recording aborted');
      }
      events.push({ type: 'phase_start', phaseNumber: phase.phaseNumber, description: phase.description });
      await trajectoryPhaseDao.updateStatus(phase.id, 'running');
      if (session) session.activePhaseId = phase.id;

      const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_done', 300000);
      const errP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_error', 300000)
        .then((p) => Promise.reject(new Error(p?.message || 'phase_error')));
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'step',
        data: {
          instruction: phase.description,
          max_steps: 40,
          phase_number: phase.phaseNumber,
        },
      });
      await Promise.race([doneP, errP]);
      if (runtime.abortRecording) {
        await trajectoryPhaseDao.updateStatus(phase.id, 'failed').catch(() => {});
        throw new Error('Recording aborted');
      }
      await trajectoryPhaseDao.updateStatus(phase.id, 'completed');
      events.push({ type: 'phase_done', phaseNumber: phase.phaseNumber, description: phase.description });
    }

    await trajectoryDao.updateMeta(tid, {
      recordStatus: 'recorded',
      isDone: true,
      isSuccessful: true,
    });
  } catch (err) {
    const aborted = runtime.abortRecording || /aborted/i.test(err.message || '');
    await trajectoryDao.updateMeta(tid, {
      recordStatus: aborted ? 'draft' : 'draft',
      isDone: false,
      isSuccessful: false,
    });
    throw err;
  } finally {
    if (session) {
      session.busy = false;
      session.activePhaseId = null;
    }
    runtime.abortRecording = false;
    unsubscribe?.();
  }

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus: 'recorded',
    phaseIds: phases.map((p) => p.id),
    accountId: acctId,
    systemAccountId: acctId,
    events,
    steps: tree?.phases?.flatMap((p) => p.steps || []) || [],
  };
}

export async function stopTrajectoryRecording(trajectoryId, { success = true } = {}) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  if (runtime) {
    runtime.abortRecording = true;
    const session = state.sessions.get(runtime.sessionId);
    // Always ask agent to stop — do not wait for busy flag (may be stale).
    try {
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'cancel_step',
        data: {},
      });
    } catch {}
    if (session) {
      session.busy = false;
      session.selectedPhaseId = null;
    }
    // Stop manual recording if on
    try {
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'manual_record_stop',
        data: {},
      });
    } catch {}
    runtime.selectedPhaseId = null;
  }

  const recordStatus = success ? 'recorded' : 'draft';
  await trajectoryDao.updateMeta(tid, {
    recordStatus,
    isDone: !!success,
    isSuccessful: !!success,
  });

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus,
    detached: false,
    tree,
  };
}

export async function resolveTrajectoryElement(trajectoryId, { labelText } = {}) {
  const tid = Number(trajectoryId);
  const label = String(labelText || '').trim();
  if (!label) {
    const err = new Error('labelText is required');
    err.statusCode = 400;
    throw err;
  }
  const runtime = trajectoryRuntimeMap.get(tid);
  if (!runtime?.sessionId) {
    const err = new Error('Trajectory is not attached — call record/prepare first');
    err.statusCode = 400;
    throw err;
  }

  if (USE_EXECUTOR) {
    if (!runtime.executorNodeUuid) {
      const err = new Error('Executor node missing on trajectory runtime');
      err.statusCode = 400;
      throw err;
    }
    const requestId = randomUUID();
    const resultP = execSession.waitForSessionEvent(
      runtime.sessionId,
      'session.bib_resolve_element_result',
      20000,
    );
    execSession.sendToExecutor(runtime.executorNodeUuid, 'session.bib_resolve_element', {
      sessionId: runtime.sessionId,
      labelText: label,
      requestId,
    });
    const payload = await resultP;
    if (payload?.error) {
      const msg = String(payload.error);
      const err = new Error(msg);
      err.statusCode = /not attached|not available|required/i.test(msg) ? 400 : 404;
      throw err;
    }
    if (!payload?.element) {
      const err = new Error(`No form field found for label: ${label}`);
      err.statusCode = 404;
      throw err;
    }
    return {
      trajectoryId: tid,
      matchedLabel: payload.matchedLabel || label,
      element: payload.element,
    };
  }

  const resolved = await remoteBridge.resolveElementByLabelText(label);
  return {
    trajectoryId: tid,
    matchedLabel: resolved.matchedLabel,
    element: resolved.element,
  };
}

export async function toggleTrajectoryManualRecord(trajectoryId, enabled, { phaseId = null } = {}) {
  const tid = Number(trajectoryId);
  const runtime = trajectoryRuntimeMap.get(tid);
  if (!runtime) {
    const err = new Error('Trajectory is not attached');
    err.statusCode = 400;
    throw err;
  }
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }
  if (traj.recordStatus === 'recording' && enabled) {
    const err = new Error('AI recording in progress');
    err.statusCode = 409;
    throw err;
  }

  const session = state.sessions.get(runtime.sessionId);
  let resolvedPhaseId = null;
  if (enabled) {
    if (phaseId != null && phaseId !== '') {
      const pid = Number(phaseId);
      if (!Number.isFinite(pid) || pid <= 0) {
        const err = new Error('Invalid phaseId');
        err.statusCode = 400;
        throw err;
      }
      const phase = await trajectoryPhaseDao.getById(pid);
      if (!phase || Number(phase.trajectoryId) !== tid) {
        const err = new Error('phaseId does not belong to this trajectory');
        err.statusCode = 400;
        throw err;
      }
      resolvedPhaseId = phase.id;
      runtime.selectedPhaseId = phase.id;
      if (session) session.selectedPhaseId = phase.id;
    } else {
      runtime.selectedPhaseId = null;
      if (session) session.selectedPhaseId = null;
    }
  }

  execSession.forwardStdin({
    nodeUuid: runtime.executorNodeUuid,
    sessionId: runtime.sessionId,
    event: enabled ? 'manual_record_start' : 'manual_record_stop',
    data: {},
  });
  const status = await execSession.waitForSessionEvent(runtime.sessionId, 'manual_record_status', 10000)
    .catch(() => ({ enabled: !!enabled }));
  runtime.manualRecording = !!status.enabled;
  // Manual activity resets idle timer
  if (runtime.manualRecording) touchTrajectoryRuntimeActivity(tid);
  return {
    trajectoryId: tid,
    enabled: !!status.enabled,
    phaseId: enabled ? (resolvedPhaseId ?? runtime.selectedPhaseId ?? null) : null,
  };
}
