/**
 * AI / manual recording lifecycle: start, stop, toggle, resolve, default login.
 */
import { randomUUID } from 'crypto';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as systemDao from '../dao/system-dao.js';
import * as execSession from '../executor-session-client.js';
import { state } from '../state.js';
import { broadcast } from '../ws-server.js';
import { USE_EXECUTOR } from '../../config/config.js';
import * as remoteBridge from '../cdp/remote-bridge.js';
import {
  buildLoginInstruction,
  resolveTrajectoryAccount,
} from './trajectory-account-service.js';
import { getTrajectoryTree } from './trajectory-query-service.js';
import {
  getTrajectoryRuntime,
  markConsumedActionLog,
  touchTrajectoryRuntimeActivity,
} from './trajectory-runtime.js';

/**
 * 版本V2.2：案例数据注入 Python case_data_store 暂时停用。
 * 本期录制只靠 phase 文本中的【业务场景案例数据】（analyze 附加），由 LLM 读文本优先填写。
 * case_data_entry 仍可经 API 入库，供后续「分块标注 / 接口报文捞取」再用（本期不注入）。
 * （原实现：按 trajectory_id 加载 case_data_entry → traj_{id}.json / inline case_data）
 */
async function prepareCaseDataInjection(_trajectoryId) {
  return { caseDataFile: null, caseData: null };
}

/** Lazy accessor — avoid static cycle with trajectory-persist-service.js */
async function appendRecordedStep(...args) {
  const mod = await import('./trajectory-persist-service.js');
  return mod.appendRecordedStep(...args);
}

async function removeRecordedStepsByDbIds(...args) {
  const mod = await import('./trajectory-persist-service.js');
  return mod.removeRecordedStepsByDbIds(...args);
}

async function stashOrApplyStepScreenshot(...args) {
  const mod = await import('../routes/browser-session/persist-live.js');
  return mod.stashOrApplyStepScreenshot(...args);
}

async function flushPendingStepScreenshot(...args) {
  const mod = await import('../routes/browser-session/persist-live.js');
  return mod.flushPendingStepScreenshot(...args);
}

/**
 * Default login/navigate — NOT written to trajectory_step (is_replay / suppress persist).
 */
export async function runDefaultLogin(runtime, account, system = null) {
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
        max_steps: 10,
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
    try {
      const { broadcastWatcherStatus } = await import('../routes/browser-session/broadcasts.js');
      broadcastWatcherStatus();
    } catch {}
  }
}

export async function startTrajectoryRecording(trajectoryId, { phaseIds = null, accountId = null } = {}) {
  const tid = Number(trajectoryId);
  const runtime = getTrajectoryRuntime(tid);
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
  // Listener #3 of 3 for step_screenshot (product AI record/start):
  // startTrajectoryRecording opens its own subscribeSessionEvents for this run's agent
  // action_log_sync → appendRecordedStep. Separate from bindExecutorSessionEvents (#1),
  // which focuses on manual/cdp (+ optional agent autoPersist). Both must handle
  // step_screenshot or AI-recording shots would be dropped.
  const unsubscribe = execSession.subscribeSessionEvents(runtime.sessionId, async (type, payload) => {
    if (type === 'phase_intent_obs' || type === 'phase_boundary_obs' || type === 'phase_end') {
      events.push({
        type,
        phaseNumber: payload?.phase ?? payload?.phaseNumber ?? session?.activePhaseId ?? null,
        ...(payload && typeof payload === 'object' ? payload : {}),
        at: new Date().toISOString(),
      });
      return;
    }
    if (type === 'step_screenshot') {
      const entryId = payload?.entryId;
      if (!entryId) return;
      const ctx = session || runtime;
      if (session && !session._pendingStepShots) session._pendingStepShots = runtime._pendingStepShots || new Map();
      if (!runtime._pendingStepShots) runtime._pendingStepShots = session?._pendingStepShots || new Map();
      if (session) session._pendingStepShots = runtime._pendingStepShots;
      await stashOrApplyStepScreenshot(ctx, entryId, {
        before: payload?.before,
        after: payload?.after,
        trajectoryId: tid,
      }).catch((err) => console.warn('[record] step_screenshot failed:', err?.message || err));
      return;
    }
    if (type !== 'action_log_sync') return;
    if (runtime.suppressStepPersist || runtime.isReplay) return;
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const removedIds = Array.isArray(payload?.removedIds) ? payload.removedIds : [];
    if (!runtime._lastPersistByActionId) runtime._lastPersistByActionId = new Map();
    if (session && !session._lastPersistByActionId) {
      session._lastPersistByActionId = runtime._lastPersistByActionId;
    }
    if (session && !session.persistedActionIds) {
      session.persistedActionIds = runtime.persistedActionIds;
    }
    if (!runtime._pendingStepShots) runtime._pendingStepShots = new Map();
    if (session) session._pendingStepShots = runtime._pendingStepShots;

    if (removedIds.length) {
      const dbIds = [];
      for (const rid of removedIds) {
        const aid = String(rid || '');
        if (!aid) continue;
        const info = runtime._lastPersistByActionId.get(aid)
          || session?._lastPersistByActionId?.get(aid);
        const dbId = info?.dbId != null ? Number(info.dbId) : null;
        if (Number.isFinite(dbId) && dbId > 0) dbIds.push(dbId);
        runtime.persistedActionIds.delete(aid);
        runtime._lastPersistByActionId.delete(aid);
        session?.persistedActionIds?.delete(aid);
        session?._lastPersistByActionId?.delete(aid);
        runtime._pendingStepShots?.delete(aid);
        session?._pendingStepShots?.delete(aid);
      }
      if (dbIds.length) {
        await removeRecordedStepsByDbIds(tid, dbIds).catch((err) => {
          console.warn('[record] remove coalesced steps failed:', err?.message || err);
        });
        broadcast('action_removed', {
          trajectoryDbId: tid,
          sessionId: runtime.sessionId,
          removedIds,
          dbIds,
        });
      }
    }

    const phaseIdHint = session?.activePhaseId != null ? Number(session.activePhaseId) : null;
    for (const entry of entries) {
      const id = entry?.id ? String(entry.id) : '';
      if (!id || runtime.persistedActionIds.has(id)) continue;
      // Manual/CDP have dedicated persist paths; skip to avoid double-write with action_log_sync
      const src = entry?.source || 'agent';
      if (src === 'manual' || src === 'cdp') continue;
      runtime.persistedActionIds.add(id);
      const persisted = await appendRecordedStep(tid, entry, {
        source: src === 'special_element' ? 'special_element' : 'agent',
        trajectoryPhaseId: Number.isFinite(phaseIdHint) ? phaseIdHint : undefined,
      }).catch(() => null);
      if (persisted) {
        runtime._lastPersistByActionId.set(id, persisted);
        session?._lastPersistByActionId?.set(id, persisted);
        if (persisted.dbId != null) {
          await flushPendingStepScreenshot(runtime, id, persisted.dbId, tid);
        }
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

  // Enable per-step before/after screenshots for this recording session
  execSession.forwardStdin({
    nodeUuid: runtime.executorNodeUuid,
    sessionId: runtime.sessionId,
    event: 'capture_screenshots',
    data: { enabled: true },
  });

  // 版本V2.2：不注入 case_data 到 Python。case_data_entry 可入库留待后续；
  // 本期填表靠 phase.description 内【业务场景案例数据】+ LLM 优先对齐。
  // const { caseDataFile, caseData } = await prepareCaseDataInjection(tid);
  const caseDataFile = null;
  const caseData = null;

  let recordingSystemId = null;
  try {
    const trajRow = await trajectoryDao.getById(tid);
    if (trajRow?.functionId) {
      const { resolveAncestorSystemId } = await import('./hierarchy-service.js');
      recordingSystemId = await resolveAncestorSystemId(trajRow.functionId);
    }
  } catch {
    recordingSystemId = null;
  }

  try {
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
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
      // Prior 0–2 phases by array position (not phaseNumber±1 — phaseIds filter may skip).
      const priorSlice = phases.slice(Math.max(0, i - 2), i);
      const prior_phases = priorSlice.map((p) => ({
        phaseNumber: p.phaseNumber,
        description: p.description || '',
      }));
      const stepData = {
        instruction: phase.description,
        max_steps: 30,
        phase_number: phase.phaseNumber,
      };
      if (prior_phases.length) stepData.prior_phases = prior_phases;
      // 版本V2.2：不再注入 case_data / case_data_file 到 Python case_data_store
      // （业务场景案例数据已写在 phase.description 内，供 AI 填表参考）
      if (caseData) {
        stepData.case_data = caseData;
        if (caseDataFile) stepData.case_data_file = caseDataFile;
      }
      if (recordingSystemId) {
        try {
          const { searchSpecialElements } = await import('./special-element-search-service.js');
          const candidates = await searchSpecialElements({
            systemId: recordingSystemId,
            description: phase.description || '',
            limit: 3,
            includeSteps: true,
          });
          if (candidates.length) {
            stepData.special_element_candidates = candidates;
            console.log(
              `[record] special-element candidates phase=${phase.phaseNumber} `
              + `n=${candidates.length} ids=${candidates.map((c) => c.id).join(',')}`,
            );
          } else {
            console.log(
              `[record] special-element candidates phase=${phase.phaseNumber} n=0 `
              + `(systemId=${recordingSystemId})`,
            );
          }
        } catch (err) {
          console.warn('[record] special-element search skipped:', err?.message || err);
        }
      }
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'step',
        data: stepData,
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
  const runtime = getTrajectoryRuntime(tid);
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
    try {
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'capture_screenshots',
        data: { enabled: false },
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

/**
 * Batch-safe stop: never downgrade recorded/completed back to draft.
 * Sends cancel_step when a runtime exists; CAS-updates only live/recording.
 */
export async function stopTrajectoryRecordingSafe(trajectoryId, {
  success = false,
} = {}) {
  const tid = Number(trajectoryId);
  const runtime = getTrajectoryRuntime(tid);
  const traj = await trajectoryDao.getById(tid);
  if (!traj) {
    const err = new Error('Trajectory not found');
    err.statusCode = 404;
    throw err;
  }

  if (runtime) {
    runtime.abortRecording = true;
    const session = state.sessions.get(runtime.sessionId);
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

  let recordStatus = traj.recordStatus;
  if (traj.recordStatus === 'recorded' || traj.recordStatus === 'completed') {
    // Do not downgrade terminal success
    recordStatus = traj.recordStatus;
  } else if (success) {
    const n = await trajectoryDao.updateMetaIf(tid, {
      recordStatus: 'recorded',
      isDone: true,
      isSuccessful: true,
    }, { recordStatusIn: ['live', 'recording', 'draft'] });
    recordStatus = n ? 'recorded' : (await trajectoryDao.getById(tid))?.recordStatus;
  } else {
    const n = await trajectoryDao.updateMetaIf(tid, {
      recordStatus: 'draft',
      isDone: false,
      isSuccessful: false,
    }, { recordStatusIn: ['live', 'recording'] });
    const fresh = await trajectoryDao.getById(tid);
    recordStatus = n ? 'draft' : (fresh?.recordStatus || traj.recordStatus);
  }

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus,
    detached: false,
    tree,
  };
}

export async function resolveTrajectoryElement(trajectoryId, {
  labelText,
  actionType,
  action,
  params,
} = {}) {
  const tid = Number(trajectoryId);
  const label = String(labelText || '').trim();
  const act = String(actionType || action || '').trim();
  const p = params && typeof params === 'object' ? params : {};
  if (!label && !act && !Object.keys(p).length) {
    const err = new Error('labelText or actionType/params is required');
    err.statusCode = 400;
    throw err;
  }
  const runtime = getTrajectoryRuntime(tid);
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
      actionType: act,
      params: p,
      requestId,
    });
    const payload = await resultP;
    if (payload?.error) {
      const msg = String(payload.error);
      const err = new Error(msg);
      err.statusCode = /not attached|not available|required/i.test(msg) ? 400 : 404;
      throw err;
    }
    if (payload?.ambiguous && Array.isArray(payload.matches)) {
      return {
        trajectoryId: tid,
        ambiguous: true,
        matches: payload.matches,
      };
    }
    if (!payload?.element) {
      const err = new Error(`No form field found for label: ${label || act}`);
      err.statusCode = 404;
      throw err;
    }
    return {
      trajectoryId: tid,
      matchedLabel: payload.matchedLabel || label,
      element: payload.element,
    };
  }

  const resolved = await remoteBridge.resolveElementByLabelText(label, {
    actionType: act,
    params: p,
  });
  if (resolved?.ambiguous) {
    return {
      trajectoryId: tid,
      ambiguous: true,
      matches: resolved.matches,
    };
  }
  return {
    trajectoryId: tid,
    matchedLabel: resolved.matchedLabel,
    element: resolved.element,
  };
}

export async function toggleTrajectoryManualRecord(trajectoryId, enabled, { phaseId = null } = {}) {
  const tid = Number(trajectoryId);
  const runtime = getTrajectoryRuntime(tid);
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
  // Manual recording also needs before/after capture when steps will persist
  try {
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'capture_screenshots',
      data: { enabled: !!enabled },
    });
  } catch {}
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
