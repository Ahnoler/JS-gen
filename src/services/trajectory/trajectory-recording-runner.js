/**
 * AI trajectory recording runner — drives the phase-by-phase agent loop for
 * record/start: login pre-check, action_log_sync persistence, screenshot stash,
 * business-data injection, fact-pack + special-element hints.
 * Extracted from trajectory-record-lifecycle.js — move-only, no logic changes.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as execSession from '../../executor-session-client.js';
import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import { AI_MEMORY_FACT_PACK, PHASE_MAX_STEPS } from '../../../config/config.js';
import {
  getTrajectoryRuntime,
  touchTrajectoryRuntimeActivity,
} from './trajectory-runtime.js';
import { resolveTrajectoryAccount } from './trajectory-account-service.js';
import { getTrajectoryTree } from './trajectory-query-service.js';
import {
  runDefaultLogin,
  prepareCaseDataInjection,
} from './trajectory-record-lifecycle.js';
import { appendPhaseDoneLog } from './trajectory-phase-service.js';
import { notifyBatchProgressForTrajectory } from './batch-progress-notify.js';
import { isAiRecordingActive } from './trajectory-status-utils.js';

/** Phase watchdog: fail only when the agent stops emitting action_log_sync for this long. */
const PHASE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

async function broadcastRecordingLock() {
  try {
    const { broadcastWatcherStatus } = await import('../../routes/browser-session/broadcasts.js');
    broadcastWatcherStatus();
  } catch {}
}

function lockAiRecording(runtime, session, locked) {
  runtime.aiRecording = !!locked;
  if (session) {
    session.aiRecording = !!locked;
    session.busy = !!locked;
  }
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
  const mod = await import('../../routes/browser-session/persist-live.js');
  return mod.stashOrApplyStepScreenshot(...args);
}

async function flushPendingStepScreenshot(...args) {
  const mod = await import('../../routes/browser-session/persist-live.js');
  return mod.flushPendingStepScreenshot(...args);
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
  if (traj.recordStatus === 'recording' && (await isAiRecordingActive(tid))) {
    const err = new Error('Recording already in progress');
    err.statusCode = 409;
    throw err;
  }
  if (traj.recordStatus === 'recorded' || traj.recordStatus === 'completed') {
    const err = new Error('Trajectory already recorded — clear it to record again');
    err.statusCode = 409;
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
  // Hold the AI-recording lock before login so nested login cannot unlock the canvas.
  const session = state.sessions.get(runtime.sessionId);
  lockAiRecording(runtime, session, true);
  if (session) session.dbTrajectoryId = tid;
  await broadcastRecordingLock();

  const { account, accountId: acctId } = await resolveTrajectoryAccount(tid, accountId);
  try {
    if (!(runtime.loginDone && Number(runtime.loginAccountId) === Number(acctId))) {
      await runDefaultLogin(runtime, account);
    }
  } catch (err) {
    lockAiRecording(runtime, session, false);
    await broadcastRecordingLock();
    throw err;
  }

  runtime.abortRecording = false;
  runtime.recordStartAt = new Date().toISOString();
  touchTrajectoryRuntimeActivity(tid);
  await trajectoryDao.updateMeta(tid, { recordStatus: 'recording', systemAccountId: acctId });
  for (const p of phases) await trajectoryPhaseDao.updateStatus(p.id, 'pending');

  if (session) {
    session.dbTrajectoryId = tid;
    session.aiRecording = true;
    session.busy = true;
  }
  await broadcastRecordingLock();

  const events = [];
  /** Called on each agent activity event to keep the phase watchdog alive. */
  let phaseActivity = null;
  /** Clears the current phase watchdog (set per phase). */
  let clearPhaseActivity = () => {};
  // Listener #3 of 3 for step_screenshot (product AI record/start):
  // startTrajectoryRecording opens its own subscribeSessionEvents for this run's agent
  // action_log_sync → appendRecordedStep. Separate from bindExecutorSessionEvents (#1),
  // which focuses on manual/cdp (+ optional agent autoPersist). Both must handle
  // step_screenshot or AI-recording shots would be dropped.
  const unsubscribe = execSession.subscribeSessionEvents(runtime.sessionId, (type, payload) => {
    if (type === 'action_log_sync' || type === 'step_screenshot') {
      try { phaseActivity?.(); } catch {}
    }
    const work = (async () => {
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
      try {
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
      } catch (err) {
        console.error(
          `[record] action_log_sync entry failed: trajectoryDbId=${tid} actionId=${id}`,
          err?.message || err,
          err?.stack || '',
        );
        // appendRecordedStep uses .catch(() => null); failures here are post-persist
        // (screenshot flush / broadcast) — keep id in persistedActionIds
      }
    }
    })();
    if (type === 'action_log_sync' || type === 'step_screenshot') {
      runtime._persistDrain = Promise.resolve(runtime._persistDrain)
        .catch(() => {})
        .then(() => work)
        .catch((err) => console.warn('[record] persist drain failed:', err?.message || err));
    }
    return work;
  });

  // Enable per-step before/after screenshots for this recording session
  execSession.forwardStdin({
    nodeUuid: runtime.executorNodeUuid,
    sessionId: runtime.sessionId,
    event: 'capture_screenshots',
    data: { enabled: true },
  });

      // 业务数据：仅填表/引入类阶段注入；导航/登录/查询不挂，避免「填写」污染分类。
      const { caseDataFile, caseData, caseDataBlock } = await prepareCaseDataInjection(tid);
      const {
        phaseNeedsBusinessData,
        stripBusinessDataBlock,
      } = await import('./trajectory-meta-service.js');
      const CASE_BLOCK_MARK = '【业务数据';
      const CASE_BLOCK_MARK_LEGACY = '【业务场景案例数据';
      const caseBlockSuffix = caseDataBlock
        ? `\n\n${CASE_BLOCK_MARK} — 来自用户需求（非系统回写案例数据）；填表/引入时参考理解，按场景选用关键取值】\n${caseDataBlock}`
        : '';

  let recordingSystemId = null;
  try {
    const trajRow = await trajectoryDao.getById(tid);
    if (trajRow?.functionId) {
      const { resolveAncestorSystemId } = await import('../hierarchy-service.js');
      recordingSystemId = await resolveAncestorSystemId(trajRow.functionId);
    }
  } catch {
    recordingSystemId = null;
  }

  // Catalog for agent_task 【阶段目录】must list EVERY trajectory phase,
  // not only the phaseIds subset being recorded this run.
  const all_phases = allPhases.map((p) => ({
    id: p.id,
    phaseNumber: p.phaseNumber,
    title: (p.title || p.name || '').trim() || String(p.description || '').split('\n')[0].slice(0, 80),
    description: p.description || '',
  }));
  runtime.phaseOutcomes = {};

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

      let phaseIdleTimer = null;
      let rejectPhaseIdle = () => {};
      const idleP = new Promise((_resolve, reject) => { rejectPhaseIdle = reject; });
      const armPhaseIdle = () => {
        if (phaseIdleTimer) clearTimeout(phaseIdleTimer);
        phaseIdleTimer = setTimeout(() => {
          rejectPhaseIdle(new Error(
            `Phase ${phase.phaseNumber} idle timeout: no agent activity for ${PHASE_IDLE_TIMEOUT_MS / 60000} minutes`,
          ));
        }, PHASE_IDLE_TIMEOUT_MS);
      };
      armPhaseIdle();
      phaseActivity = armPhaseIdle;
      clearPhaseActivity = () => {
        if (phaseIdleTimer) clearTimeout(phaseIdleTimer);
        phaseIdleTimer = null;
        phaseActivity = null;
      };

      // phase_done / phase_error have no fixed timeout — the activity watchdog above
      // is the only timeout, so a long auto-fill phase cannot be killed at 300s.
      const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_done', null);
      const errRaw = execSession.waitForSessionEvent(runtime.sessionId, 'phase_error', null);
      const errP = errRaw.then((p) => Promise.reject(new Error(p?.message || 'phase_error')));
      errP.catch(() => {});
      const stepData = {
        instruction: phase.description,
        max_steps: PHASE_MAX_STEPS,
        phase_number: phase.phaseNumber,
      };
      stepData.all_phases = all_phases;
      if (i > 0) {
        const prev = phases[i - 1];
        const prevOutcome = runtime.phaseOutcomes?.[prev.id] || runtime.phaseOutcomes?.[prev.phaseNumber];
        stepData.prior_outcome = {
          phaseNumber: prev.phaseNumber,
          // Missing outcome → unknown (null), never default to success.
          success: prevOutcome?.success === true || prevOutcome?.success === false
            ? prevOutcome.success
            : null,
          text: prevOutcome?.text || prevOutcome?.summary || '见页面当前状态',
        };
      }
      // P1：记忆事实包注入（AI_MEMORY_FACT_PACK 默认关）——权威值/已保存值
      // 检索可能滞后（Python 异步批量上报），失败仅告警，不阻塞录制主链路。
      try {
        if (AI_MEMORY_FACT_PACK) {
          const { retrieveFactPack } = await import('../../memory/memory-service.js');
          const factPack = await retrieveFactPack({
            trajectoryId: tid,
            phaseNumber: phase.phaseNumber,
            maxChars: 1500,
            functionId: trajRow?.functionId ?? null,
          });
          if (factPack?.facts?.length) {
            stepData.fact_pack = factPack;
            console.log(`[record] fact-pack phase=${phase.phaseNumber} facts=${factPack.facts.length}`);
          }
        }
      } catch (err) {
        console.warn('[record] fact-pack skipped:', err?.message || err);
      }
      // P1：Python 记忆 writer 需要 trajectory_id（否则 case_saved 等事件无归属）
      stepData.trajectory_id = tid;
      // 业务数据仅挂到填表/引入阶段；导航阶段保持干净描述供边界分类。
      let instruction = phase.description || '';
      const wantBiz = phaseNeedsBusinessData(instruction);
      if (
        wantBiz
        && caseBlockSuffix
        && !instruction.includes(CASE_BLOCK_MARK)
        && !instruction.includes(CASE_BLOCK_MARK_LEGACY)
      ) {
        instruction = instruction + caseBlockSuffix;
      } else if (!wantBiz) {
        instruction = stripBusinessDataBlock(instruction);
      }
      stepData.instruction = instruction;
      if (wantBiz && caseDataBlock) {
        stepData.case_data_block = caseDataBlock;
      }
      // Optional flat KV only when this phase may use values
      if (wantBiz && caseData) {
        stepData.case_data = caseData;
        if (caseDataFile) stepData.case_data_file = caseDataFile;
      }
      if (recordingSystemId) {
        try {
          const { searchSpecialElements } = await import('../special-element-search-service.js');
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
      let donePayload;
      try {
        donePayload = await Promise.race([doneP, errP, idleP]);
      } finally {
        doneP.cancel?.();
        errRaw.cancel?.();
        clearPhaseActivity();
      }
      if (runtime.abortRecording) {
        await trajectoryPhaseDao.updateStatus(phase.id, 'failed').catch(() => {});
        throw new Error('Recording aborted');
      }
      const explicitSuccess = donePayload?.success === true
        || donePayload?.success === false
        ? donePayload.success
        : null;
      const textFromDone = String(donePayload?.text || donePayload?.summary || '').trim();
      const phaseOutcome = {
        // Only explicit true/false; missing success on phase_done → unknown (null).
        success: explicitSuccess,
        text: textFromDone
          || (explicitSuccess == null ? '见页面当前状态' : String(donePayload?.name || '').trim())
          || '见页面当前状态',
      };
      runtime.phaseOutcomes[phase.id] = phaseOutcome;
      runtime.phaseOutcomes[phase.phaseNumber] = phaseOutcome;
      const rawDoneText = String(donePayload?.text || '').trim();
      if (rawDoneText) {
        await appendPhaseDoneLog(phase.id, { text: rawDoneText, source: 'agent' });
      }
      await trajectoryPhaseDao.updateStatus(phase.id, 'completed');
      await notifyBatchProgressForTrajectory(tid);
      lockAiRecording(runtime, session, true);
      await broadcastRecordingLock();
      await Promise.resolve(runtime._persistDrain).catch(() => {});
      try {
        const { capturePhaseScreenshot } = await import('./phase-highlight-screenshot.js');
        await capturePhaseScreenshot({
          trajectoryId: tid,
          phaseId: phase.id,
          sessionId: runtime.sessionId,
          executorNodeUuid: runtime.executorNodeUuid,
        });
      } catch (err) {
        console.warn('[record] phase screenshot skipped:', err?.message || err);
      }
      events.push({ type: 'phase_done', phaseNumber: phase.phaseNumber, description: phase.description });
    }

    await trajectoryDao.updateMeta(tid, {
      recordStatus: 'recorded',
      isDone: true,
      isSuccessful: true,
    });
  } catch (err) {
    await trajectoryDao.updateMeta(tid, {
      recordStatus: 'failed',
      isDone: false,
      isSuccessful: false,
    });
    const failText = String(err?.message || err || '').trim();
    if (failText && session?.activePhaseId) {
      await appendPhaseDoneLog(session.activePhaseId, { text: failText, source: 'fail' });
    }
    await notifyBatchProgressForTrajectory(tid);
    throw err;
  } finally {
    if (session) {
      session.busy = false;
      session.aiRecording = false;
      session.activePhaseId = null;
    }
    runtime.abortRecording = false;
    runtime.aiRecording = false;
    clearPhaseActivity();
    unsubscribe?.();
    await broadcastRecordingLock();
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
