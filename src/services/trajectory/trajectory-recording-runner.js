/**
 * AI trajectory recording runner — drives the phase-by-phase agent loop for
 * record/start: login pre-check, action_log_sync persistence, screenshot stash,
 * business-data injection, fact-pack + special-element hints.
 * Extracted from trajectory-record-lifecycle.js — move-only, no logic changes.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as trajectoryStepDao from '../../dao/trajectory-step-dao.js';
import * as execSession from '../../executor-session-client.js';
import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import { AI_MEMORY_FACT_PACK, MAX_ACTIONS_PER_STEP, PHASE_MAX_STEPS } from '#config/config.js';
import {
  getTrajectoryRuntime,
  touchTrajectoryRuntimeActivity,
} from './trajectory-runtime.js';
import { resolveTrajectoryAccount } from './trajectory-account-service.js';
import { getTrajectoryTree } from './trajectory-query-service.js';
import {
  runDefaultLogin,
  prepareBusinessDataInjection,
} from './trajectory-record-lifecycle.js';
import { appendPhaseDoneLog } from './trajectory-phase-service.js';
import { notifyBatchProgressForTrajectory } from './batch-progress-notify.js';
import { isAiRecordingActive } from './trajectory-status-utils.js';
import { capturePhaseBuffer, buildMetadata } from './phase-highlight-screenshot.js';
import { replacePhaseGroupScreenshot } from '../screenshot-service.js';

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

/**
 * Lazy accessor — avoid static cycle with trajectory-persist-service.js.
 * @param {...unknown} args forwarded arguments to appendRecordedStep
 * @returns {Promise<object>} append result from trajectory-persist-service
 */
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

async function applyPageLevelScreenshot(...args) {
  const mod = await import('../../routes/browser-session/persist-live.js');
  return mod.applyPageLevelScreenshot(...args);
}

/**
 * Per-phase state-group shot manager (G): 阶段内页面跳变（新增抽屉/保存跳转等）按状态键
 * 分组采集整页截图；步骤按动作发生前的 beforeKey 归属组图（group_shot_id）。
 *
 * runtime 状态（startTrajectoryRecording 初始化）：
 *  - _phaseGroups: Map<phaseNum, Map<stateKey, {shotId: number|null, stepIds: number[]}>>
 *  - _pendingStepGroup: Map<entryId, {phase: number, stateKey: string}>（entryId → 动作前状态组）
 *  - _phaseShotChain: Promise（串行采集队列，避免 BiB 采集结果事件互相串线）
 *  - _phaseNumToId: Map<phaseNumber, phaseId>
 */
/** Per-phase group count cap: beyond it stop capturing, group-only (shotId stays null). */
const PHASE_GROUP_SHOT_MAX_PER_PHASE = 20;

/**
 * Chain a phase-group shot job onto the runtime capture queue (serial execution).
 * @param {object} runtime trajectory runtime
 * @param {() => Promise<void>} job capture job
 * @returns {void}
 */
function queuePhaseGroupShot(runtime, job) {
  runtime._phaseShotChain = Promise.resolve(runtime._phaseShotChain)
    .catch(() => {})
    .then(job)
    .catch((err) => {
      console.warn('[record] phase group shot job failed:', err?.message || err);
    });
}

/**
 * Per-phase state-group map, created on demand.
 * @param {object} runtime trajectory runtime
 * @param {number} phaseNum phase number
 * @returns {Map<string, {shotId: number|null, stepIds: number[]}>} group map
 */
function phaseGroupMap(runtime, phaseNum) {
  let byKey = runtime._phaseGroups.get(Number(phaseNum));
  if (!byKey) {
    byKey = new Map();
    runtime._phaseGroups.set(Number(phaseNum), byKey);
  }
  return byKey;
}

/**
 * Resolve the trajectory_phase DB id for a phase number reported by the agent.
 * @param {object} runtime trajectory runtime
 * @param {number} phaseNum phase number
 * @returns {number|null} phase DB id or null when unknown (⇒ degrade to group-only)
 */
function resolvePhaseIdForGroup(runtime, phaseNum) {
  const fromMap = runtime._phaseNumToId?.get(Number(phaseNum));
  return Number.isFinite(fromMap) && fromMap > 0 ? Number(fromMap) : null;
}

/**
 * Ensure the state-group entry exists (创建 + 串行采集；采集失败 → shotId=null 降级).
 * When newly created and under the per-phase cap, queue the serialized capture.
 * @param {object} runtime trajectory runtime
 * @param {number} phaseNum phase number
 * @param {string} stateKey state key (beforeKey of the steps)
 * @returns {{shotId: number|null, stepIds: number[]}|null} group entry or null when stateKey empty
 */
function ensurePhaseGroup(runtime, phaseNum, stateKey) {
  const key = String(stateKey || '').trim();
  if (!key) return null;
  const byKey = phaseGroupMap(runtime, phaseNum);
  let group = byKey.get(key);
  if (group) return group;
  group = { shotId: null, stepIds: [] };
  byKey.set(key, group);
  if (byKey.size > PHASE_GROUP_SHOT_MAX_PER_PHASE) {
    // 超出上限：停止新采集、仅归组（shotId 留空，对应步骤 group_shot_id 不绑定）。
    console.warn(
      `[record] phase-group-shot cap reached for phase ${phaseNum} (${byKey.size} groups); skip capture: ${key.slice(0, 80)}`,
    );
    return group;
  }
  queuePhaseGroupShot(runtime, () => captureAndPersistPhaseGroupShot(runtime, Number(phaseNum), key));
  return group;
}

/**
 * Capture + persist one phase-group shot (upsert by phase × state_group) and refresh bindings.
 * Never throws: returns false on any failure (group shot missing / degraded).
 * @param {object} runtime trajectory runtime
 * @param {number} phaseNum phase number
 * @param {string} stateKey state-group key
 * @returns {Promise<boolean>} whether the group shot was persisted
 */
async function captureAndPersistPhaseGroupShot(runtime, phaseNum, stateKey) {
  const key = String(stateKey || '').trim();
  if (!key) return false;
  const byKey = phaseGroupMap(runtime, phaseNum);
  let group = byKey.get(key);
  if (!group) {
    group = { shotId: null, stepIds: [] };
    byKey.set(key, group);
  }
  if (byKey.size > PHASE_GROUP_SHOT_MAX_PER_PHASE) {
    console.warn(
      `[record] phase-group-shot cap reached for phase ${phaseNum} (${byKey.size} groups); skip capture: ${key.slice(0, 80)}`,
    );
    return false;
  }
  const phaseId = resolvePhaseIdForGroup(runtime, phaseNum);
  if (!phaseId) {
    console.warn(
      `[record] phase group shot skipped: no phase id for phase ${phaseNum} (stateKey=${key.slice(0, 80)})`,
    );
    return false;
  }
  try {
    const captured = await capturePhaseBuffer({
      sessionId: runtime.sessionId,
      executorNodeUuid: runtime.executorNodeUuid,
    });
    if (!captured?.ok) {
      console.warn('[record] phase group shot skipped:', captured?.skipped || 'capture_failed');
      return false;
    }
    const metadata = buildMetadata(captured.buffer, captured.meta);
    metadata.stateGroup = key;
    const shotId = await replacePhaseGroupScreenshot(phaseId, {
      trajectoryId: runtime.trajectoryId,
      stateGroup: String(key).slice(0, 120),
      buffer: captured.buffer,
      mimeType: 'image/png',
      metadataJson: JSON.stringify(metadata),
    });
    if (!shotId) {
      console.warn('[record] phase group shot persisted with no id:', key.slice(0, 80));
      return false;
    }
    group.shotId = Number(shotId);
    // 刷新该组所有待绑定步骤（shotId 就绪时一并绑定）。
    if (group.stepIds.length > 0) {
      const pending = [...group.stepIds];
      try {
        await trajectoryStepDao.updateGroupShotId(pending, Number(shotId));
        group.stepIds = [];
      } catch (err) {
        console.warn('[record] phase group shot bind flush failed:', err?.message || err);
      }
    }
    return true;
  } catch (err) {
    console.warn('[record] phase group shot failed:', err?.message || err);
    return false;
  }
}

/**
 * Bind a freshly persisted step to its pre-action state group (entryId → dbId).
 * Shot ready ⇒ updateGroupShotId; not yet (未开组/降级/采集未完) ⇒ pending list, flushed later.
 * @param {object} runtime trajectory runtime
 * @param {string} entryId agent action entry id
 * @param {number} dbId persisted step DB id
 * @returns {void}
 */
function bindPersistedStepToGroup(runtime, entryId, dbId) {
  const ref = runtime._pendingStepGroup?.get(entryId);
  if (!ref) return;
  runtime._pendingStepGroup.delete(entryId);
  const group = runtime._phaseGroups?.get(Number(ref.phase))?.get(String(ref.stateKey));
  if (!group) return;
  if (group.shotId != null) {
    trajectoryStepDao.updateGroupShotId([Number(dbId)], Number(group.shotId)).catch((err) => {
      console.warn('[record] step group bind failed:', err?.message || err);
    });
  } else {
    group.stepIds.push(Number(dbId));
  }
}

/**
 * Start AI trajectory recording: login pre-check, phase-by-phase agent loop,
 * action_log_sync persistence, screenshot stash, business-data injection.
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [root1] options
 * @param {Array<number>|null} [root1.phaseIds] subset of phase ids to record (null = all)
 * @param {number|null} [root1.accountId] login account id override
 * @returns {Promise<{ trajectoryId: number, recordStatus: string, phaseIds: Array<number>, accountId: number, systemAccountId: number, events: Array<object>, steps: Array<object> }>} recording result with updated tree
 */
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
  // 录制中(recording)的信号源是存在 running 阶段（AI 录制进行中），而非 record_status；
  // 用它在再次 start 时拦截并发录制（无论当前持久状态为何）。
  if (await isAiRecordingActive(tid)) {
    const err = new Error('Recording already in progress');
    err.statusCode = 409;
    throw err;
  }
  // 允许在待确认(recorded)/已确认(completed)上再次录制：录制是临时状态，
  // 结束后按持久状态基线恢复，不会把这些已确立状态降级。
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
  runtime.userStop = null;
  runtime.recordStartAt = new Date().toISOString();
  touchTrajectoryRuntimeActivity(tid);
  // 进入临时「录制中」：记录录制前持久状态基线（不降级待确认/已确认/录制异常）。
  await trajectoryDao.enterTransientRecording(tid);
  await trajectoryDao.updateMeta(tid, { systemAccountId: acctId });
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
  // Phase state-group shot manager (G) — per recording run, reset on (re)start.
  runtime._phaseGroups = new Map();
  runtime._pendingStepGroup = new Map();
  runtime._phaseShotChain = Promise.resolve();
  runtime._phaseNumToId = new Map(allPhases.map((p) => [Number(p.phaseNumber), Number(p.id)]));

  // Listener #3 of 3 for step_screenshot (product AI record/start):
  // startTrajectoryRecording opens its own subscribeSessionEvents for this run's agent
  // action_log_sync → appendRecordedStep. Separate from bindExecutorSessionEvents (#1),
  // which focuses on manual/cdp (+ optional agent autoPersist). Both must handle
  // step_screenshot or AI-recording shots would be dropped.
  const unsubscribe = execSession.subscribeSessionEvents(runtime.sessionId, (type, payload) => {
    if (type === 'action_log_sync' || type === 'step_screenshot' || type === 'page_level_screenshot') {
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
        dialog: payload?.dialog,
        dialogMeta: payload?.dialogMeta,
        trajectoryId: tid,
      }).catch((err) => console.warn('[record] step_screenshot failed:', err?.message || err));
      return;
    }
    if (type === 'page_level_screenshot') {
      await applyPageLevelScreenshot(tid, payload).catch((err) => {
        console.warn('[record] page_level_screenshot failed:', err?.message || err);
      });
      return;
    }
    if (type === 'phase_state_key') {
      // 阶段开始即采第一张（entryId 空、beforeKey==afterKey）；状态键变化时
      // 预先采集 afterKey 组供后续步骤使用。步骤归属 = 动作发生前状态（beforeKey）。
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
      const phaseNum = Number(data.phase ?? 0);
      const beforeKey = String(data.beforeKey || '').trim();
      const afterKey = String(data.afterKey || '').trim();
      const entryId = data.entryId != null ? String(data.entryId) : '';
      if (beforeKey) {
        ensurePhaseGroup(runtime, phaseNum, beforeKey);
        if (entryId) {
          runtime._pendingStepGroup.set(entryId, { phase: phaseNum, stateKey: beforeKey });
        }
        if (afterKey && afterKey !== beforeKey) {
          ensurePhaseGroup(runtime, phaseNum, afterKey);
        }
      }
      return;
    }
    if (type === 'phase_shot_candidate_request') {
      // 提交类动作执行前的显式采集（click_save）：串行采集 + upsert 组图 + ack。
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
      const phaseNum = Number(data.phase ?? 0);
      const stateKey = String(data.stateKey || '').trim();
      const requestId = data.requestId != null ? String(data.requestId) : '';
      queuePhaseGroupShot(runtime, async () => {
        let ok = false;
        try {
          ok = await captureAndPersistPhaseGroupShot(runtime, Number(phaseNum), stateKey);
        } catch (err) {
          console.warn('[record] phase candidate capture failed:', err?.message || err);
        }
        if (!requestId) return;
        try {
          execSession.forwardStdin({
            nodeUuid: runtime.executorNodeUuid,
            sessionId: runtime.sessionId,
            event: 'phase_shot_candidate_result',
            data: { requestId, ok },
          });
        } catch (err) {
          console.warn('[record] phase candidate ack failed:', err?.message || err);
        }
      });
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
        runtime._pendingStepGroup?.delete(aid);
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
            bindPersistedStepToGroup(runtime, id, Number(persisted.dbId));
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
    if (type === 'action_log_sync' || type === 'step_screenshot' || type === 'page_level_screenshot') {
      runtime._persistDrain = Promise.resolve(runtime._persistDrain)
        .catch(() => {})
        .then(() => work)
        .catch((err) => console.warn('[record] persist drain failed:', err?.message || err));
    }
    return work;
  });

  // Keep the persist/screenshot subscription alive until the session closes so
  // events emitted during graceful close (e.g. the session-end final screenshot,
  // capturedAt='session-end') are still persisted. The session hub is removed on
  // session close (execSession.closeSession → removeSessionHub) which cleans this
  // listener; explicit cleanup also happens at detach / runtime purge.
  if (session?._aiRecordUnsub) {
    try { session._aiRecordUnsub(); } catch {}
  }
  if (session) session._aiRecordUnsub = unsubscribe;

  // Enable per-step before/after screenshots for this recording session
  execSession.forwardStdin({
    nodeUuid: runtime.executorNodeUuid,
    sessionId: runtime.sessionId,
    event: 'capture_screenshots',
    data: { enabled: true },
  });

      // 业务数据：仅填表/引入类阶段注入；导航/登录/查询不挂，避免「填写」污染分类。
      const { businessDataFile, businessData, businessDataBlock } = await prepareBusinessDataInjection(tid);
      const {
        phaseNeedsBusinessData,
        stripBusinessDataBlock,
      } = await import('./trajectory-meta-service.js');
      const CASE_BLOCK_MARK = '【业务数据';
      const CASE_BLOCK_MARK_LEGACY = '【业务场景案例数据';
      const caseBlockSuffix = businessDataBlock
        ? `\n\n${CASE_BLOCK_MARK} — 来自用户需求；填表/引入时参考理解，按场景选用关键取值】\n${businessDataBlock}`
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

  let finalStatus = 'recorded';
  try {
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      if (runtime.abortRecording) {
        await trajectoryPhaseDao.updateStatus(phase.id, runtime.userStop?.success ? 'completed' : 'failed').catch(() => {});
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
        max_actions_per_step: MAX_ACTIONS_PER_STEP || undefined,
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
      // P1：Python 记忆 writer 需要 trajectory_id（否则 business_saved 等事件无归属）
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
      if (wantBiz && businessDataBlock) {
        stepData.business_data_block = businessDataBlock;
      }
      // Optional flat KV only when this phase may use values
      if (wantBiz && businessData) {
        stepData.business_data = businessData;
        if (businessDataFile) stepData.business_data_file = businessDataFile;
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
        await trajectoryPhaseDao.updateStatus(phase.id, runtime.userStop?.success ? 'completed' : 'failed').catch(() => {});
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
      // 组图采集先行落定（串行队列），避免 done 长图与组图并发争用 BiB 采集结果事件。
      await Promise.resolve(runtime._phaseShotChain).catch(() => {});
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

    // 录制成功（V3）：无论持久基线为何，显式结束成功 → 待确认(recorded)。
    finalStatus = await trajectoryDao.finishTransientRecording(tid, 'success');
    await trajectoryDao.updateMeta(tid, {
      isDone: true,
      isSuccessful: true,
    });
    await trajectoryPhaseDao.updateRunningStatus(tid, 'completed').catch((err) => {
      console.warn(`[record] updateRunningStatus(completed) failed for #${tid}:`, err?.message || err);
    });
  } catch (err) {
    // A user-initiated record/stop already wrote the final recordStatus
    // (recorded/failed); don't let the aborted runner overwrite that choice.
    if (!runtime.userStop) {
      // 自动失败（V3）：显式失败结果 → 录制异常(failed)。
      finalStatus = await trajectoryDao.finishTransientRecording(tid, 'failure');
      await trajectoryDao.updateMeta(tid, {
        isDone: false,
        isSuccessful: false,
      });
      await trajectoryPhaseDao.updateRunningStatus(tid, 'failed').catch((err2) => {
        console.warn(`[record] updateRunningStatus(failed) failed for #${tid}:`, err2?.message || err2);
      });
    } else {
      finalStatus = traj.recordStatus;
    }
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
    runtime.userStop = null;
    clearPhaseActivity();
    // Subscription deliberately NOT unsubscribed here: it lives until the session
    // closes (see the _aiRecordUnsub stash above) so session-end events (final
    // screenshot) are still persisted. Hub removal on closeSession cleans it.
    await broadcastRecordingLock();
  }

  const tree = await getTrajectoryTree(tid);
  return {
    trajectoryId: tid,
    recordStatus: finalStatus,
    phaseIds: phases.map((p) => p.id),
    accountId: acctId,
    systemAccountId: acctId,
    events,
    steps: tree?.phases?.flatMap((p) => p.steps || []) || [],
  };
}
