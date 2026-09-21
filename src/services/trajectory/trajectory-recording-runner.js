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
  markConsumedActionLog,
} from './trajectory-runtime.js';
import { resolveTrajectoryAccount } from './trajectory-account-service.js';
import { getTrajectoryTree } from './trajectory-query-service.js';
import { runDefaultLogin } from './trajectory-record-lifecycle.js';
import {
  prepareRecordingBusinessContext,
  applyBusinessDataToStep,
} from './recording-runner-business-data.js';
import {
  resolveRecordingSystemId,
  attachSpecialElementCandidates,
} from './recording-runner-step-context.js';
import { appendPhaseDoneLog } from './trajectory-phase-service.js';
import { captureDeadlockForensics } from './deadlock-forensics.js';
import { applyActionLogSync, countBusinessSteps, countBusinessStepsByPhase, clearActionLogCopy } from './action-log-copy.js';
import { META_STEP_ACTIONS, isEngineeringStepAction } from '../../models/meta-step-actions.js';
import { failReasonText } from '../../models/failure-reason.js';
import { notifyBatchProgressForTrajectory } from './batch-progress-notify.js';
import { isAiRecordingActive } from './trajectory-status-utils.js';
import { capturePhaseBuffer, buildMetadata } from './phase-highlight-screenshot.js';
import { replacePhaseGroupScreenshot } from '../screenshot-service.js';
import { phaseEventOwnership, waitForSessionEventOwned } from './run-event-ownership.js';
// G3（PR #45）：countBusinessSteps / META_STEP_ACTIONS 已在本文件上方从
// ./action-log-copy.js 与 ../../models/meta-step-actions.js 导入——两个模块的
// 同名导出只取其一，故此处只引入本文件尚未有的两个 helper。
import {
  aggregateTrajectorySuccessful,
  applyZeroStepFakeSuccessGate,
  collectFailedPhases,
  evaluateFinalVerdict,
  evaluateFinalizeGate,
  evaluatePhaseOutcome,
} from './phase-done-evidence-gate.js';

/** Phase watchdog: fail only when the agent stops emitting action_log_sync for this long. */
const PHASE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Persist-path event types: bodies are queued serially onto runtime._persistDrain. */
const PERSIST_EVENT_TYPES = new Set(['action_log_sync', 'step_screenshot', 'page_level_screenshot']);

/**
 * 录制锁状态变更后通知浏览器会话观察者。
 * 路由依赖采用惰性加载以避免静态服务-路由循环；
 * 通知失败被有意设为对录制运行器非致命。
 * @returns {Promise<void>} 尽力通知尝试完成后兑现
 */
async function broadcastRecordingLock() {
  try {
    const { broadcastWatcherStatus } = await import('../../routes/browser-session/broadcasts.js');
    broadcastWatcherStatus();
  } catch {}
}

/**
 * 同步运行时和在线会话上的 AI 录制及忙碌标记。
 * 保持两个标记一致，防止并发的生命周期操作将活动执行器会话
 * 视为可用。
 * @param {object} runtime 可变的轨迹运行时条目
 * @param {object|null|undefined} session 可用时的在线执行器会话
 * @param {boolean} locked AI 录制是否处于活动状态
 * @returns {void}
 */
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

/**
 * 惰性转发合并步骤删除到持久化模块。
 * @param {...unknown} args 转发给 removeRecordedStepsByDbIds 的参数
 * @returns {Promise<object>} 持久化结果
 */
async function removeRecordedStepsByDbIds(...args) {
  const mod = await import('./trajectory-persist-service.js');
  return mod.removeRecordedStepsByDbIds(...args);
}

/**
 * 惰性转发步骤截图处理到在线持久化路由。
 * @param {...unknown} args 路由辅助函数参数
 * @returns {Promise<unknown>} 委托的截图结果
 */
async function stashOrApplyStepScreenshot(...args) {
  const mod = await import('../../routes/browser-session/persist-live.js');
  return mod.stashOrApplyStepScreenshot(...args);
}

/**
 * 惰性写入正在等待其持久化步骤 id 的截图。
 * @param {...unknown} args 路由辅助函数参数
 * @returns {Promise<unknown>} 委托的写入结果
 */
async function flushPendingStepScreenshot(...args) {
  const mod = await import('../../routes/browser-session/persist-live.js');
  return mod.flushPendingStepScreenshot(...args);
}

/**
 * 惰性转发页面级截图持久化以避免导入循环。
 * @param {...unknown} args 路由辅助函数参数
 * @returns {Promise<unknown>} 委托的截图结果
 */
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
 *  - _phaseShotPersistChain: Promise（独立持久化队列，MinIO 慢不阻塞采集）
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
 * Queue persistence independently from browser capture so a slow MinIO does not
 * delay the next state capture.
 * @param {object} runtime trajectory runtime
 * @param {() => Promise<void>} job persistence job
 * @returns {void}
 */
function queuePhaseGroupPersistence(runtime, job) {
  runtime._phaseShotPersistChain = Promise.resolve(runtime._phaseShotPersistChain)
    .catch(() => {})
    .then(job)
    .catch((err) => console.warn('[record] phase group shot persistence failed:', err?.message || err));
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
  queuePhaseGroupShot(runtime, async () => {
    const shot = await capturePhaseGroupShot(runtime, Number(phaseNum), key);
    if (shot) queuePhaseGroupPersistence(runtime, () => persistPhaseGroupShot(runtime, shot));
  });
  return group;
}

/**
 * Capture one phase-group shot without waiting for storage persistence.
 * @param {object} runtime trajectory runtime
 * @param {number} phaseNum phase number
 * @param {string} stateKey state-group key
 * @returns {Promise<object|null>} captured shot or null on failure
 */
async function capturePhaseGroupShot(runtime, phaseNum, stateKey) {
  const key = String(stateKey || '').trim();
  if (!key) return null;
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
    return null;
  }
  const phaseId = resolvePhaseIdForGroup(runtime, phaseNum);
  if (!phaseId) {
    console.warn(
      `[record] phase group shot skipped: no phase id for phase ${phaseNum} (stateKey=${key.slice(0, 80)})`,
    );
    return null;
  }
  try {
    const captured = await capturePhaseBuffer({
      sessionId: runtime.sessionId,
      executorNodeUuid: runtime.executorNodeUuid,
    });
    if (!captured?.ok) {
      console.warn('[record] phase group shot skipped:', captured?.skipped || 'capture_failed');
      return null;
    }
    const metadata = buildMetadata(captured.buffer, captured.meta);
    metadata.stateGroup = key;
    return { key, phaseNum: Number(phaseNum), phaseId, buffer: captured.buffer, metadata };
  } catch (err) {
    console.warn('[record] phase group shot capture failed:', err?.message || err);
    return null;
  }
}

/**
 * Persist a previously captured phase-group shot and bind waiting steps.
 * @param {object} runtime trajectory runtime
 * @param {object} shot captured shot
 * @returns {Promise<boolean>} whether persistence succeeded
 */
async function persistPhaseGroupShot(runtime, shot) {
  const { key, phaseNum, phaseId, buffer, metadata } = shot || {};
  if (!key || !phaseId || !buffer) return false;
  const group = phaseGroupMap(runtime, phaseNum).get(key);
  if (!group) return false;
  try {
    const shotId = await replacePhaseGroupScreenshot(phaseId, {
      trajectoryId: runtime.trajectoryId,
      stateGroup: String(key).slice(0, 120),
      buffer,
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
  // P1-5：per-tid 内存互斥——在进入任何异步点之前同步 check-and-set。
  // isAiRecordingActive 依赖 phase=running，登录窗口内阶段尚未 running，双击/
  // 批+手并发 start 均可过 DB 闸；runtime.aiRecording 填补该窗口。
  if (runtime.aiRecording) {
    const err = new Error('Recording already in progress');
    err.statusCode = 409;
    throw err;
  }
  runtime.aiRecording = true;
  let session = null;
  let enteredPhaseLoop = false;
  try {
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
  session = state.sessions.get(runtime.sessionId);
  lockAiRecording(runtime, session, true);
  if (session) session.dbTrajectoryId = tid;
  await broadcastRecordingLock();

  // phase_done 跨 run 串台修复（spec 4.1）：本轮录制唯一 runId，随 step 下发，
  // 事件按归属过滤；finally 补发 cancel_step 也以此标记本次 run。
  // P0-3 H5：铸造提前到登录回放之前——登录窗口（可长达数分钟）内旧 run 的 90s
  // 门闩比对 runtime.currentRunId 不再撞上上一轮旧值，盲区消除。
  runtime.currentRunId = (await import('node:crypto')).randomUUID();
  runtime._sentStepThisRun = false;
  // P0-2②：本 run 循环的归属锚点——catch/finally 的写副作用以此为守卫
  //（runtime 被重录替换 / 同对象换 run 时，旧循环不得再写任何状态）。
  const myRunId = runtime.currentRunId;
  const runStillOwnsRuntime = () =>
    getTrajectoryRuntime(tid) === runtime && runtime.currentRunId === myRunId;

  const { account, accountId: acctId } = await resolveTrajectoryAccount(tid, accountId);
  try {
    if (runtime.skipDefaultLogin) {
      // Auth dry-run login segment: the agent performs the login itself.
      // Read-only here — the flag lives until runtime teardown at detach.
      // P1-7：与正常登录路径三个调用点同形——预标 persistedActionIds，消费旧
      // _ACTION_LOG；否则 detach→重附（fresh runtime）后旧条目全部重持久化并
      // 归到新 run 阶段名下（旧步重录成新步）。
      await markConsumedActionLog(runtime);
    } else if (!(runtime.loginDone && Number(runtime.loginAccountId) === Number(acctId))) {
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
  // 进入临时「录制中」：记录录制前持久状态基线（不降级待确认/录制异常）。
  await trajectoryDao.enterTransientRecording(tid);
  // 已确认(completed)重新录制时，把持久基线改为待确认(recorded)，
  // 这样停止后需要再次人工确认，而不是自动回到已确认。
  const statusRow = await trajectoryDao.getRecordStatusRow(tid);
  if (statusRow?.persistentRecordStatus === 'completed') {
    await trajectoryDao.updateMeta(tid, { persistentRecordStatus: 'recorded' });
  }
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

  // ── agent 事件处理段落（命名分段，闭包共享 runtime/session/tid/events）──

  /**
   * Push a phase observation event (phase_intent_obs / phase_boundary_obs / phase_end).
   * @param {string} type event type
   * @param {object|null} payload event payload
   * @returns {void}
   */
  const pushPhaseObservation = (type, payload) => {
    events.push({
      type,
      phaseNumber: payload?.phase ?? payload?.phaseNumber ?? session?.activePhaseId ?? null,
      ...(payload && typeof payload === 'object' ? payload : {}),
      at: new Date().toISOString(),
    });
  };

  /**
   * Stash a step_screenshot payload (before/after) for the persisted step.
   * @param {object|null} payload event payload
   * @returns {Promise<void>}
   */
  const handleStepScreenshot = async (payload) => {
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
  };

  /**
   * Apply a page_level_screenshot payload (page-level before/after shots).
   * @param {object|null} payload event payload
   * @returns {Promise<void>}
   */
  const handlePageLevelScreenshot = async (payload) => {
    await applyPageLevelScreenshot(tid, payload).catch((err) => {
      console.warn('[record] page_level_screenshot failed:', err?.message || err);
    });
  };

  /**
   * Track phase state keys: pre-capture afterKey group, bind step → beforeKey group.
   * @param {object|null} payload event payload
   * @returns {void}
   */
  const handlePhaseStateKey = (payload) => {
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
  };

  /**
   * Explicit pre-submit capture request (click_save): serial capture + upsert + ack.
   * @param {object|null} payload event payload
   * @returns {void}
   */
  const handlePhaseShotCandidateRequest = (payload) => {
    // 提交类动作执行前的显式采集（click_save）：串行采集 + upsert 组图 + ack。
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload || {};
    const phaseNum = Number(data.phase ?? 0);
    const stateKey = String(data.stateKey || '').trim();
    const requestId = data.requestId != null ? String(data.requestId) : '';
    queuePhaseGroupShot(runtime, async () => {
      let ok = false;
      try {
        // 577d322a 拆分后的接线：串行采集完成即 ack，MinIO 持久化排入
        // _phaseShotPersistChain 独立队列（慢持久化不阻塞下一次采集/ack）。
        const shot = await capturePhaseGroupShot(runtime, Number(phaseNum), stateKey);
        if (shot) {
          queuePhaseGroupPersistence(runtime, () => persistPhaseGroupShot(runtime, shot));
          ok = true;
        }
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
  };

  /**
   * Persist agent action_log_sync entries (append / coalesce-remove) + broadcasts.
   * @param {object|null} payload event payload
   * @returns {Promise<void>}
   */
  const handleActionLogSync = async (payload) => {
    // B（2026-09-20）归属守卫：旧 run 的订阅刻意活到 session close，被新 run 取代后其
    // 迟到 action_log_sync 若照常落库，会跨 run 污染新 recording 轨迹（#925 实证：定稿后
    // 仍追加 select_option/real_click 等步）。非 runtime 属主的 run 一律不落步。
    if (!runStillOwnsRuntime()) {
      console.warn(
        `[record] stale run step persist skipped traj=${tid} myRunId=${myRunId}`
        + ` liveRunId=${runtime.currentRunId}`,
      );
      return;
    }
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    const removedIds = Array.isArray(payload?.removedIds) ? payload.removedIds : [];
    // 服务器端 action_log 副本：full 覆盖 / delta 合并（syncMode）；legacy 无 syncMode=full。
    // 前端展示与门闩判定读副本（即时），DB persist 降级为异步持久化。
    try {
      applyActionLogSync(tid, payload);
    } catch {}
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
      const unmappedAids = [];
      for (const rid of removedIds) {
        const aid = String(rid || '');
        if (!aid) continue;
        const info = runtime._lastPersistByActionId.get(aid)
          || session?._lastPersistByActionId?.get(aid);
        const dbId = info?.dbId != null ? Number(info.dbId) : null;
        if (Number.isFinite(dbId) && dbId > 0) dbIds.push(dbId);
        else unmappedAids.push(aid);
        runtime.persistedActionIds.delete(aid);
        runtime._lastPersistByActionId.delete(aid);
        session?.persistedActionIds?.delete(aid);
        session?._lastPersistByActionId?.delete(aid);
        runtime._pendingStepShots?.delete(aid);
        session?._pendingStepShots?.delete(aid);
        runtime._pendingStepGroup?.delete(aid);
      }
      console.log(`[traj-recon] coalesce traj=${tid} removed=${removedIds.length} mapped=${dbIds.length} unmapped=[${unmappedAids.join(',')}]`);
      if (dbIds.length) {
        await removeRecordedStepsByDbIds(tid, dbIds).catch((err) => {
          console.warn('[record] remove coalesced steps failed:', err?.message || err);
        });
        // coalesce 删除重排后回补内存步号（B1 步号缺口治理：否则后续步骤沿用旧计数，
        // 与 DB max(step_number) 脱节留下断号）
        runtime._nextStepNumber = (await trajectoryDao.getMaxStepNumber(tid)) + 1;
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
        // P6-0 性能：步号内存递增（串行链安全）+跳过 DB 幂等查+counts 延迟到阶段收尾，
        // 每步 persist 从 7-9 次远程往返（65ms RTT）削到 1-2 次
        if (!Number.isFinite(runtime._nextStepNumber)) {
          runtime._nextStepNumber = (await trajectoryDao.getMaxStepNumber(tid)) + 1;
        }
        const persistArgs = {
          source: src === 'special_element' ? 'special_element' : 'agent',
          trajectoryPhaseId: Number.isFinite(phaseIdHint) ? phaseIdHint : undefined,
          stepNumber: runtime._nextStepNumber,
          trustPhaseId: Number.isFinite(phaseIdHint),
          skipIdempotentDbCheck: true,
          deferCounts: true,
        };
        // P6-0/T0.2 落库丢失治理：失败重试一次，仍失败则广播告警（不再静默丢弃）
        let persisted = await appendRecordedStep(tid, entry, persistArgs).catch((err1) => {
          console.warn(`[record] step persist retry: trajectoryDbId=${tid} actionId=${id}:`, err1?.message || err1);
          void captureDeadlockForensics(err1, { trajectoryDbId: tid, actionId: id }).catch(() => {});
          return null;
        });
        if (!persisted) {
          persisted = await appendRecordedStep(tid, entry, persistArgs).catch((err2) => {
            console.error(`[record] step persist FAILED twice: trajectoryDbId=${tid} actionId=${id}:`, err2?.message || err2);
            broadcast('step_persist_failed', {
              trajectoryDbId: tid,
              sessionId: runtime.sessionId,
              actionId: id,
              error: String(err2?.message || err2 || 'persist failed'),
            });
            return null;
          });
        }
        if (persisted) {
          runtime._nextStepNumber = Math.max(
            runtime._nextStepNumber,
            Number(persisted.stepNumber) || runtime._nextStepNumber,
          ) + 1;
          runtime._lastPersistByActionId.set(id, persisted);
          session?._lastPersistByActionId?.set(id, persisted);
          // P6-0/T0.1 计数：persist 返回的 trajectoryPhaseId 是 DB 解析后的真归属，
          // activePhaseId 仅作兜底（sync 处理时序可能晚于阶段切换，不可靠）。
          // save_form_snapshot 是 meta 步（产品 stepCount 口径排除），门闩不计数。
          if (String(entry.action || '') !== 'save_form_snapshot') {
            const countPhaseId = Number.isFinite(persisted.trajectoryPhaseId)
              ? persisted.trajectoryPhaseId
              : phaseIdHint;
            if (Number.isFinite(countPhaseId)) {
              runtime.phaseStepCounts.set(countPhaseId, (runtime.phaseStepCounts.get(countPhaseId) || 0) + 1);
            }
          }
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
  };

  // Listener #3 of 3 for step_screenshot (product AI record/start):
  // startTrajectoryRecording opens its own subscribeSessionEvents for this run's agent
  // action_log_sync → appendRecordedStep. Separate from bindExecutorSessionEvents (#1),
  // which focuses on manual/cdp (+ optional agent autoPersist). Both must handle
  // step_screenshot or AI-recording shots would be dropped.
  const unsubscribe = execSession.subscribeSessionEvents(runtime.sessionId, (type, payload) => {
    if (type === 'phase_done' || type === 'action_log_sync') {
      console.log(`[probe] session=${runtime.sessionId} event=${type} entries=${Array.isArray(payload?.entries) ? payload.entries.length : '-'}`);
    }
    // 落库事件归属过滤（spec 4.1.4）：上一轮 run 的持久化事件不写入本轮步骤表、
    // 不喂空闲看门狗。legacy（旧执行机 payload 无 runId）按 spec 4.4 兼容放行。
    if (type === 'phase_state_key') {
      const statePayload = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
      const own = phaseEventOwnership(statePayload, {
        runId: runtime.currentRunId,
        phaseNumber: statePayload?.phase ?? statePayload?.phaseNumber ?? null,
      });
      if (own.decision === 'ignore') {
        console.warn(
          `[record] phase_state_key_ignored_${own.reason} session=${runtime.sessionId}`
          + ` phase=${statePayload?.phase ?? statePayload?.phaseNumber}`
          + ` gotRunId=${statePayload?.runId} expect=${runtime.currentRunId}`,
        );
        return Promise.resolve();
      }
    }
    if (type === 'action_log_sync' || type === 'step_screenshot' || type === 'page_level_screenshot') {
      const own = phaseEventOwnership(payload, { runId: runtime.currentRunId });
      if (own.decision === 'ignore') {
        console.warn(
          `[record] persist_event_ignored_${own.reason} session=${runtime.sessionId} type=${type}`
          + ` gotRunId=${payload?.runId} expect=${runtime.currentRunId}`,
        );
        return Promise.resolve();
      }
    }
    if (type === 'action_log_sync' || type === 'step_screenshot' || type === 'page_level_screenshot') {
      try { phaseActivity?.(); } catch {}
    }
    const runWork = () => (async () => {
      if (type === 'phase_intent_obs' || type === 'phase_boundary_obs' || type === 'phase_end') {
        if (type === 'phase_end' && payload?.quality_failed === true) {
          // 假成功防线 v3：QUALITY FAIL（pending_fields/missing_success_token 等）只进
          // phase_end 事件——在此捕获，终局门闩消费（09-07 #612/#614/19:55 教训）。
          (runtime.phaseQualityFails = runtime.phaseQualityFails || []).push({
            phase: payload?.phase,
            reasons: payload?.quality_failed_reasons || [],
          });
        }
        if (type === 'phase_end' && Array.isArray(payload?.overlayButtons) && payload.overlayButtons.length > 0) {
          // 常态收口弹窗按钮清单（#917④b）：phase_end 先于 phase_done 到达且此时
          // session.activePhaseId 已置（与下方 fail 落库同源），直接落该阶段 doneLog，
          // 台账不必等卡死收口即可见弹窗按钮。文本形态对齐 probe 收口 [a][b] 拼法；
          // 空清单不落（防噪红线），.catch(() => {}) 包裹防落库噪声上抛。
          // await 对齐既有落库调用（零步门禁/fail 路径）：appendPhaseDoneLog 非
          // 原子 RMW，不 await 会与紧随的 phase_done → recordPhaseResult 写入
          // 并发交错丢条目（可能丢的恰是阶段主 done 文本）。
          await appendPhaseDoneLog(session?.activePhaseId, {
            text: 'overlay buttons: ' + payload.overlayButtons.map((b) => `[${b}]`).join(''),
            source: 'agent',
          }).catch(() => {});
        }
        pushPhaseObservation(type, payload);
        return;
      }
      if (type === 'step_screenshot') {
        await handleStepScreenshot(payload);
        return;
      }
      if (type === 'page_level_screenshot') {
        await handlePageLevelScreenshot(payload);
        return;
      }
      if (type === 'phase_state_key') {
        handlePhaseStateKey(payload);
        return;
      }
      if (type === 'phase_shot_candidate_request') {
        handlePhaseShotCandidateRequest(payload);
        return;
      }
      if (type !== 'action_log_sync') return;
      if (runtime.suppressStepPersist || runtime.isReplay) return;
      await handleActionLogSync(payload);
    })();
    if (PERSIST_EVENT_TYPES.has(type)) {
      // 串行化（#917 根修）：步号分配（_nextStepNumber 读-改-写）必须原子——派生快照
      // 与主 fill 同批到达时并发进入会双双读到同一号（同号双行 + 跳号缺口的根因）。
      // persist 类 body 惰性化：不再急切执行，改由链串行触发；链 resolve 即全部落库
      // 完成（recordPhaseResult 与 90s 门闩 await 本值，语义不变）。
      // 非 persist 类（phase_intent_obs 等）保持急切执行不变。
      runtime._persistDrain = Promise.resolve(runtime._persistDrain)
        .catch(() => {})
        .then(() => runWork())
        .catch((err) => console.warn('[record] persist drain failed:', err?.message || err));
      return runtime._persistDrain;
    }
    return runWork();
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
  const bizCtx = await prepareRecordingBusinessContext(tid);

  const { systemId: recordingSystemId, functionId: recordingFunctionId } = await resolveRecordingSystemId(tid);

  // Catalog for agent_task 【阶段目录】must list EVERY trajectory phase,
  // not only the phaseIds subset being recorded this run.
  const all_phases = allPhases.map((p) => ({
    id: p.id,
    phaseNumber: p.phaseNumber,
    title: (p.title || p.name || '').trim() || String(p.description || '').split('\n')[0].slice(0, 80),
    description: p.description || '',
  }));
  runtime.phaseOutcomes = {};
  // 假成功防线 v3：phase_end.quality_failed 捕获（终局门闩消费，per-run 重置）
  runtime.phaseQualityFails = [];
  // 假成功防线 v3：本轮 0 落库步却自报 success=true 的阶段。重录场景下副本/DB 均为
  // 跨 run 累积口径（旧步骤掩护空洞阶段），唯有 phaseStepCounts 是本轮真源。
  runtime.perRunZeroSuccessPhases = [];
  // 假成功防线（P6-0/T0.1）：每阶段落库步数计数，recordPhaseResult 与收尾门闩消费
  runtime.phaseStepCounts = new Map();
  // 假成功防线 v2：每阶段业务步计数快照（终局门闩按阶段降级用，phaseNumber → count）
  runtime.phaseBusinessCounts = new Map();

  /**
   * 阶段空闲看门狗：超过 PHASE_IDLE_TIMEOUT_MS 无 agent 活动（action_log_sync 等）
   * 则 reject 返回的 idleP；就地更新外层 phaseActivity / clearPhaseActivity。
   * @param {object} phase 当前阶段（仅用 phaseNumber 生成超时消息）
   * @returns {Promise<void>} idleP — 空闲超时时 reject
   */
  const startPhaseWatchdog = (phase) => {
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
    return idleP;
  };

  /**
   * 阶段收尾：解析 phase_done 结果写入 phaseOutcomes、appendPhaseDoneLog、
   * 置阶段 completed、通知批量进度，排空持久化与组图队列后采集阶段高亮截图。
   * G3：0 业务步 + success=true → 覆盖为 success=false（zero_step_rejected）。
   * @param {object} phase 当前阶段
   * @param {object|null} donePayload phase_done 事件负载
   * @returns {Promise<void>}
   */
  const recordPhaseResult = async (phase, donePayload) => {
    const explicitSuccess = donePayload?.success === true
      || donePayload?.success === false
      ? donePayload.success
      : null;
    // 假成功防线（P6-0/T0.1）v1 阶段级：判定收敛在 evaluatePhaseOutcome（G3 模块），
    // 此处只消费判定结果做副作用（嫌疑登记 + 降级留痕 + outcomes 写入）。
    const phaseStepCount = runtime.phaseStepCounts.get(phase.id) || 0;
    const phaseOutcome = evaluatePhaseOutcome({ explicitSuccess, phaseStepCount, donePayload });
    const zeroStepPhase = phaseOutcome.zeroStepPhase;
    if (phaseOutcome.registerPerRun) {
      console.warn(
        `[record] phase #${phase.phaseNumber} self-reported success with 0 persisted steps — downgraded to unknown`,
      );
      // 假成功防线 v3：登记到 per-run 嫌疑清单——异步终局门闩 drain 后复读
      // phaseStepCounts（本轮真源）仍 0 则整轨降级（堵重录累积口径掩护）。
      (runtime.perRunZeroSuccessPhases = runtime.perRunZeroSuccessPhases || []).push({
        id: phase.id,
        phaseNumber: phase.phaseNumber,
      });
    }
    // 假成功防线 v2：自报 success=true 且 0 业务步的阶段即嫌疑（与上面阶段级
    // 降级同一判据），终局门闩对其做双源复核，仍 0 则整轨降级。
    try {
      if (explicitSuccess === true) {
        runtime.phaseBusinessCounts.set(phase.phaseNumber, countBusinessStepsByPhase(tid, phase.phaseNumber));
      }
    } catch {}
    runtime.phaseOutcomes[phase.id] = phaseOutcome;
    runtime.phaseOutcomes[phase.phaseNumber] = phaseOutcome;
    const rawDoneText = String(donePayload?.text || '').trim();
    if (rawDoneText) {
      await appendPhaseDoneLog(phase.id, { text: rawDoneText, source: 'agent' });
    }
    if (zeroStepPhase) {
      await appendPhaseDoneLog(phase.id, {
        text: `[0步完成] 本阶段无任何落库步骤${explicitSuccess === true ? '；已自报 success 但被降级' : ''}`,
        source: 'gate',
      }).catch(() => {});
    }
    await trajectoryPhaseDao.updateStatus(phase.id, 'completed');
    await notifyBatchProgressForTrajectory(tid);
    lockAiRecording(runtime, session, true);
    await broadcastRecordingLock();
    await Promise.resolve(runtime._persistDrain).catch(() => {});
    // P6-0 性能：counts 刷新从每步一次改为每阶段一次（远程 RTT 下省大量往返）
    try {
      const { refreshTrajectoryCounts } = await import('./trajectory-step-service.js');
      const counts = await refreshTrajectoryCounts(tid);
      await trajectoryDao.updateMeta(tid, {
        stepCount: counts.stepCount,
        phaseCount: counts.phaseCount,
      });
      // traj-recon（B-2 口径对账，只读、零行为变更）：rawRows−bizRows=meta 行数 → 判 A1；
      // gaps（step_number 断号）非空 → 判 B1。gaps 复用一次 listByTrajectory 现有 dao 查询。
      try {
        const reconRows = await trajectoryStepDao.listByTrajectory(tid);
        const reconMaxStep = reconRows.reduce((mx, r) => Math.max(mx, Number(r.stepNumber) || 0), 0);
        const gaps = [];
        let prevStep = 0;
        for (const r of reconRows) {
          const sn = Number(r.stepNumber) || 0;
          while (sn > prevStep + 1) {
            gaps.push(prevStep + 1);
            prevStep += 1;
          }
          prevStep = Math.max(prevStep, sn);
        }
        let copyBiz = 0;
        try {
          copyBiz = countBusinessSteps(tid);
        } catch {}
        console.log(`[traj-recon] phase traj=${tid} rawRows=${reconRows.length} bizRows=${counts.stepCount} copyBiz=${copyBiz} maxStep=${reconMaxStep} gaps=[${gaps.join(',')}]`);
      } catch (err) {
        console.warn(`[traj-recon] phase recon failed traj=${tid}: ${err?.message || err}`);
      }
    } catch (err) {
      console.warn('[record] phase counts refresh failed:', err?.message || err);
    }
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
  };

  /**
   * 落库本轨失败原因（首次为准；成功收官由 finishTransientRecording 清除）。
   * 定义在 try 之外，使 catch 分支（runner_error）也可用。
   * @param {string} kind failure kind code (see models/failure-reason.js)
   * @param {Array<number>} [phaseHint] 失败阶段号列表，非空时文案追加（阶段 N,M）后缀
   * @returns {Promise<void>} resolves after best-effort persist
   */
  const persistFailReason = async (kind, phaseHint) => {
    try {
      const base = failReasonText(kind);
      await trajectoryDao.markFailedReason(tid, {
        failedKind: kind,
        failedReason: base + (Array.isArray(phaseHint) && phaseHint.length ? '（阶段 ' + phaseHint.join(',') + '）' : ''),
      });
    } catch (err) {
      console.warn(`[record] failed_reason persist skipped for #${tid}:`, err?.message || err);
    }
  };

  let finalStatus = 'recorded';
  enteredPhaseLoop = true;
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

      const idleP = startPhaseWatchdog(phase);

      // phase_done / phase_error have no fixed timeout — the activity watchdog above
      // is the only timeout, so a long auto-fill phase cannot be killed at 300s.
      const ownedWaitOpts = {
        // execSession.onSessionEvent 是 3 参 (sessionId, type, handler)——必须在此
        // 绑定 sessionId；直传会错位实参并抛 TypeError，录制在阶段 1 即失败（终审 B1）。
        addListener: (type, handler) => execSession.onSessionEvent(runtime.sessionId, type, handler),
        // P0-2②：钉死本 run 的 runId——重录会改写 runtime.currentRunId，
        // 旧循环的等待若 live 读取会误收新 run 的事件。
        runId: myRunId,
        phaseNumber: phase.phaseNumber,
      };
      // 观察日志（spec 5.5）：标签带事件类型，避免 phase_error 被误记为 phase_done_*。
      const onIgnored = (type) => (payload, reason) => {
        console.warn(
          `[record] ${type}_${reason === 'missing_runid' ? 'missing_runid' : `ignored_${reason}`}`
          + ` session=${runtime.sessionId} phase=${payload?.phase} gotRunId=${payload?.runId}`
          + ` expect=${myRunId}`,
        );
      };
      const doneP = waitForSessionEventOwned({ ...ownedWaitOpts, type: 'phase_done', onIgnored: onIgnored('phase_done') });
      const errRaw = waitForSessionEventOwned({ ...ownedWaitOpts, type: 'phase_error', onIgnored: onIgnored('phase_error') });
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
            functionId: recordingFunctionId ?? null,
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
      stepData.runId = runtime.currentRunId;
      runtime._sentStepThisRun = true;
      // 业务数据仅挂到填表/引入阶段；导航阶段保持干净描述供边界分类。
      applyBusinessDataToStep(stepData, phase.description || '', bizCtx);
      await attachSpecialElementCandidates(stepData, {
        systemId: recordingSystemId,
        description: phase.description || '',
        phaseNumber: phase.phaseNumber,
      });
      let donePayload;
      // P2-#7：step 下发必须在本 try 内——forwardStdin 同步抛错（executor 掉线）时
      // finally 仍能 cancel owned-wait 监听器，否则泄漏到 hub 关闭为止。
      try {
        execSession.forwardStdin({
          nodeUuid: runtime.executorNodeUuid,
          sessionId: runtime.sessionId,
          event: 'step',
          data: stepData,
        });
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
      await recordPhaseResult(phase, donePayload);
    }

    // 假成功硬门闩（P6-0/T0.1，v3 异步终局化）：sync 端到端延迟实测可达分钟级
    // （588-593 实证：detach flush 模式），同步判定必然误杀或漏放——改为：
    // 立即 resync → recorded（recordStatus 本有「待确认」语义），后台 90s 二次
    // resync 复核 DB 业务步，仍 0 步则降级 failed 并广播。
    try {
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'get_action_log',
        data: {},
      });
    } catch (err) {
      console.warn('[record] fake-success gate resync send failed:', err?.message || err);
    }
    // 门闩归属守卫（09-07 教训：timer 从不取消，90s 内重录会让旧门闩在新录制进行中
    // 触发——覆写新 run 的持久基线、清掉新副本）。runId 变化即整体跳过。
    const gateRunId = runtime.currentRunId;
    const finalizeGate = setTimeout(async () => {
      if (runtime.currentRunId !== gateRunId) {
        console.log(`[record] async gate skipped for traj=${tid}: superseded by a newer run`);
        return;
      }
      // P0-3 三重活性守卫：detach（删 runtime）→ 重附（新对象）后，仅比对闭包捕获的
      // 旧 runtime 字段恒真，90s 到点会误伤正在录制的新 run。解析 live 状态三重校验，
      // 任一不满足即整体放弃本次门闩（不做任何降级、不清副本）。
      const gateRuntimeReplaced = getTrajectoryRuntime(tid) !== runtime;
      const gateSessionGone = !state.sessions.has(runtime.sessionId);
      let gateRecordingActive = false;
      try {
        gateRecordingActive = await isAiRecordingActive(tid);
      } catch {}
      if (gateRuntimeReplaced || gateSessionGone || gateRecordingActive) {
        console.log(
          `[record] async gate skipped for traj=${tid}: live state changed`
          + ` (runtimeReplaced=${gateRuntimeReplaced}`
          + ` sessionGone=${gateSessionGone}`
          + ` recordingActive=${gateRecordingActive})`,
        );
        return;
      }
      // P0-3 CAS 降级：仅当前态仍为 recorded 才可降级为 failed。finishTransientRecording
      // 无条件覆写；updateMetaIf whereIn record_status 是仓库现成的 CAS 落点。
      // failure 终局恒为 failed（resolvePostRecordingStatus），故 CAS 直接写终态；
      // persistent_record_status 列缺失（旧迁移）时退化为仅 record_status 的 CAS。
      const casDegradeRecordedToFailed = async () => {
        try {
          const n = await trajectoryDao.updateMetaIf(
            tid,
            { recordStatus: 'failed', persistentRecordStatus: 'failed' },
            { recordStatusIn: ['recorded'] },
          );
          if (n > 0) return true;
        } catch {
          const n2 = await trajectoryDao.updateMetaIf(
            tid,
            { recordStatus: 'failed' },
            { recordStatusIn: ['recorded'] },
          ).catch(() => 0);
          if (n2 > 0) return true;
        }
        return false;
      };
      try {
        execSession.forwardStdin({
          nodeUuid: runtime.executorNodeUuid,
          sessionId: runtime.sessionId,
          event: 'get_action_log',
          data: {},
        });
      } catch {}
      await Promise.resolve(runtime._persistDrain).catch(() => {});
      // 判定源=服务器端副本计数（即时、与 Python _ACTION_LOG 一致）；DB 复核仍跑，
      // 用于 counts 刷新与持久化最终一致（sync 端到端延迟实测可达分钟级）。
      let copySteps = 0;
      try {
        copySteps = countBusinessSteps(tid);
      } catch {}
      let dbSteps = 0;
      let reconRawRows = 0;
      let reconMaxStep = 0;
      try {
        const { refreshTrajectoryCounts } = await import('./trajectory-step-service.js');
        // 注意返回键是 stepCount（业务步，已排除 save_form_snapshot 等 meta）
        const counts = await refreshTrajectoryCounts(tid);
        dbSteps = Number(counts?.stepCount || 0);
        await trajectoryDao.updateMeta(tid, {
          stepCount: counts.stepCount,
          phaseCount: counts.phaseCount,
        });
        // traj-recon（B-2 口径对账，只读、零行为变更）：rawRows/maxStep 复用一次 listByTrajectory
        const reconRows = await trajectoryStepDao.listByTrajectory(tid);
        reconRawRows = reconRows.length;
        reconMaxStep = reconRows.reduce((mx, r) => Math.max(mx, Number(r.stepNumber) || 0), 0);
      } catch (err) {
        console.warn('[record] async gate recount failed:', err?.message || err);
      }
      console.log(`[traj-recon] finalize traj=${tid} rawRows=${reconRawRows} biz=${dbSteps} copy=${copySteps} maxStep=${reconMaxStep}`);
      // 假成功防线 v2：快照为 0 业务步的阶段（关键写阶段假完成）→ 重取副本计数 + DB 复核，
      // 双源仍 0 → 整轨降级 failure。总数>0 但关键阶段 0 步（#612/#614：几步树点击
      // 掩盖写阶段 0 步）由该分支拦截，不再只卡全轨总数。
      // 【Step 1 收敛】IO 复核（副本/DB 双源）留在 runner，裁决收敛在
      // evaluateFinalizeGate（G3 模块）——判定序 zeroPhase → total → perRun 单点化。
      let zeroPhaseSuspects = [];
      try {
        zeroPhaseSuspects = [...(runtime.phaseBusinessCounts || new Map())]
          .filter(([, n]) => !n)
          .map(([pn]) => pn);
      } catch {}
      let zeroPhaseBoth = [];
      if (zeroPhaseSuspects.length) {
        const zeroPhaseDb = [];
        try {
          const rows = await trajectoryStepDao.listByTrajectory(tid);
          const business = rows.filter((r) => {
            const at = String(r.actionType || '').trim();
            return at && !META_STEP_ACTIONS.includes(at) && !isEngineeringStepAction(at);
          });
          for (const pn of zeroPhaseSuspects) {
            if (!business.some((r) => Number(r.phaseNumber) === Number(pn))) zeroPhaseDb.push(pn);
          }
        } catch (err) {
          console.warn('[record] per-phase recount failed:', err?.message || err);
        }
        const zeroPhaseCopy = zeroPhaseSuspects.filter((pn) => countBusinessStepsByPhase(tid, pn) === 0);
        // 与总数门闩同语义：降级须双源一致（副本缺失时 copyCount 恒 0，此时以 DB 为准）
        zeroPhaseBoth = zeroPhaseSuspects.filter(
          (pn) => zeroPhaseCopy.includes(pn) && zeroPhaseDb.includes(pn),
        );
        console.log(
          `[record] async gate per-phase traj=${tid}: suspects=[${zeroPhaseSuspects}] copy0=[${zeroPhaseCopy}] db0=[${zeroPhaseDb}]`,
        );
      }
      // 假成功防线 v3（per-run 真源）：本轮 0 落库步却自报 success=true 的阶段。
      // 重录场景下上面两条累积口径（副本/DB）均被旧 run 步骤掩护，唯有
      // phaseStepCounts 只计本轮；drain 后复读防迟到步误杀。
      // G3：0 步却自报成功的阶段。计数取本轮真源 phaseStepCounts，且此时已
      // await drain（v3 前提：迟到步不会再进来），故此处可安全地同步判定。
      const perRunZeroPhases = (runtime.perRunZeroSuccessPhases || [])
        .filter((p) => applyZeroStepFakeSuccessGate({
          stepCount: runtime.phaseStepCounts?.get(p.id) || 0,
          donePayload: { success: true },
        }).rejectedZeroStep)
        .map((p) => p.phaseNumber);
      const { zeroStepGate, perRunGate } = evaluateFinalizeGate({
        hasPhaseSuspects: zeroPhaseSuspects.length > 0,
        totalCopySteps: copySteps,
        totalDbSteps: dbSteps,
        zeroPhaseBoth,
        perRunZeroPhases,
      });
      if (zeroStepGate.verdict === 'downgrade' && zeroStepGate.kind === 'zeroPhase') {
        const zeroStepPhases = zeroStepGate.phases;
        try {
          if (await casDegradeRecordedToFailed()) {
            await trajectoryDao.updateMeta(tid, { isDone: false, isSuccessful: false });
            await persistFailReason('zero_step', zeroStepPhases);
            broadcast('fake_success_detected', {
              trajectoryDbId: tid,
              zeroStepPhases,
            });
            console.warn(
              `[record] traj #${tid} downgraded recorded→failure: zero-step phases [${zeroStepPhases}] after finalization window`,
            );
          } else {
            console.log(
              `[record] async gate downgrade skipped for traj=${tid}: recordStatus no longer 'recorded' (zeroStepPhases=[${zeroStepPhases}])`,
            );
          }
        } catch (err) {
          console.warn('[record] async gate downgrade failed:', err?.message || err);
        }
      } else if (zeroStepGate.verdict === 'downgrade' && zeroStepGate.kind === 'total') {
        try {
          if (await casDegradeRecordedToFailed()) {
            await trajectoryDao.updateMeta(tid, { isDone: false, isSuccessful: false });
            await persistFailReason('zero_step');
            broadcast('fake_success_detected', { trajectoryDbId: tid });
            console.warn(
              `[record] traj #${tid} downgraded recorded→failure: 0 persisted business steps after finalization window`,
            );
          } else {
            console.log(
              `[record] async gate downgrade skipped for traj=${tid}: recordStatus no longer 'recorded' (0 business steps)`,
            );
          }
        } catch (err) {
          console.warn('[record] async gate downgrade failed:', err?.message || err);
        }
      }
      // v3 per-run 独立判定（旧控制流：不与上面互斥——zeroStepGate 已降级时仍会
      // 尝试 CAS，失败仅打 skipped 日志，广播不再重复发）。
      if (perRunGate) {
        const perRunPhases = perRunGate.phases;
        try {
          if (await casDegradeRecordedToFailed()) {
            await trajectoryDao.updateMeta(tid, { isDone: false, isSuccessful: false });
            await persistFailReason('zero_step', perRunPhases);
            broadcast('fake_success_detected', {
              trajectoryDbId: tid,
              perRunZeroPhases: perRunPhases,
            });
            console.warn(
              `[record] traj #${tid} downgraded recorded→failure: phases with 0 steps THIS run [${perRunPhases}] (cumulative copy/DB masked by previous runs)`,
            );
          } else {
            console.log(
              `[record] per-run zero downgrade skipped for traj=${tid}: recordStatus no longer 'recorded' (phases=[${perRunPhases}])`,
            );
          }
        } catch (err) {
          console.warn('[record] per-run zero downgrade failed:', err?.message || err);
        }
      }
      try {
        clearActionLogCopy(tid);
      } catch {}
    }, Number(process.env.RECORD_FINALIZE_GATE_MS || 90000));
    if (typeof finalizeGate.unref === 'function') finalizeGate.unref();
    // 假成功防线 v3（终局判定消费阶段结果——09-07 #612/#614/19:55 教训）：任一阶段
    // 显式 success=false，或 phase_end 上报 QUALITY FAIL（pending_fields /
    // missing_success_token 等），整轨按 failure 收官（宁误拒不假绿），不再无条件
    // recorded/isSuccessful=1。零步类假成功由上方异步门闩三路复核兜底。
    // 【Step 1 收敛】failedPhases 收集（collectFailedPhases）与成败裁决
    // （evaluateFinalVerdict）在 G3 模块；runner 只留终态写入 + broadcast。
    // P2-#6：failedPhases 统一报 phaseNumber——phaseOutcomes 以 phase.id /
    // phaseNumber 双键同写同一对象，collectFailedPhases 按 phase.id 取判定、
    // 报 phase.phaseNumber（避免把 DB id 混进载荷误导前端诊断）。
    // A（2026-09-20）收尾归属守卫：循环自然走完到写终态之间，runtime 可能已被新 run
    // 取代（用户「重新录制」/ 并发 start）。旧 run 若无条件 finishTransientRecording +
    // 覆盖 isDone/isSuccessful + updateRunningStatus，会把正在录制的新 run 标成 recorded
    //（#925 实证：录制中却无推流——前端只对 draft/recording 自动 prepare——且定稿后继续落步）。
    // catch/finally 已有同类守卫；此处补齐成功/失败收尾前的守卫，被取代即抛出、不写任何终态。
    if (!runStillOwnsRuntime()) {
      console.warn(
        `[record] stale recording finalize suppressed traj=${tid} myRunId=${myRunId}`
        + ` liveRunId=${runtime.currentRunId}`,
      );
      const supersededErr = new Error('Recording run superseded by a newer run');
      supersededErr.statusCode = 409;
      supersededErr.code = 'run_superseded';
      throw supersededErr;
    }
    const failedOutcomeKeys = collectFailedPhases(runtime.phaseOutcomes, phases);
    const qualityFails = runtime.phaseQualityFails || [];
    // G3（PR #45）：整轨成败 = phaseOutcomes 聚合（任一显式 false → false）。
    // phaseOutcomes 以 phase.id / phaseNumber 双键同写同一对象，按引用去重判定。
    const trajSuccess = aggregateTrajectorySuccessful(runtime.phaseOutcomes);
    const finalVerdict = evaluateFinalVerdict({ failedPhases: failedOutcomeKeys, qualityFails, trajSuccess });
    if (!finalVerdict.success) {
      finalStatus = await trajectoryDao.finishTransientRecording(tid, 'failure');
      await trajectoryDao.updateMeta(tid, { isDone: false, isSuccessful: false });
      await persistFailReason(finalVerdict.failKind, finalVerdict.failKind === 'quality_failed'
        ? qualityFails.map((q) => q.phase).filter(Boolean)
        : failedOutcomeKeys);
      broadcast('fake_success_detected', {
        trajectoryDbId: tid,
        failedPhases: failedOutcomeKeys,
        qualityFailedPhases: qualityFails,
      });
      console.warn(
        `[record] traj #${tid} finalized as failure: failedPhases=[${failedOutcomeKeys}]`
        + ` qualityFails=${JSON.stringify(qualityFails)}`,
      );
      await trajectoryPhaseDao.updateRunningStatus(tid, 'failed').catch((err) => {
        console.warn(`[record] updateRunningStatus(failed) failed for #${tid}:`, err?.message || err);
      });
    } else {
      // 录制成功（V3）：无论持久基线为何，显式结束成功 → 待确认(recorded)。
      finalStatus = await trajectoryDao.finishTransientRecording(tid, 'success');
      await trajectoryDao.updateMeta(tid, {
        isDone: true,
        isSuccessful: true,
      });
      await trajectoryPhaseDao.updateRunningStatus(tid, 'completed').catch((err) => {
        console.warn(`[record] updateRunningStatus(completed) failed for #${tid}:`, err?.message || err);
      });
    }
  } catch (err) {
    // P0-2② 归属守卫：本循环已不是 runtime 的属主（runtime 被重录替换 / 同对象
    // 换 run）→ 一行日志后直接退出，不写任何库、不清新 run 的锁、不发 cancel_step
    //（否则 stop→重录级联误杀：覆写新 run 终态、砍新 run agent，review P0-2 分支 B）。
    if (!runStillOwnsRuntime()) {
      console.warn(
        `[record] stale recording loop exit suppressed traj=${tid} myRunId=${myRunId}`
        + ` liveRunId=${runtime.currentRunId} err=${String(err?.message || err || '').slice(0, 160)}`,
      );
      throw err;
    }
    // 用户 stop / abort 退出（spec 4.3.2：stop 不计入阶段完成）：lifecycle.stop
    // 已写终态并清理 running 阶段——不得再写失败终态/失败注记，但仍走 finally 释放锁与清理。
    const userStopPath = !!(runtime.userStop || runtime.abortRecording)
      || /Recording aborted/i.test(String(err?.message || err || ''));
    if (!userStopPath) {
      // A user-initiated record/stop already wrote the final recordStatus
      // (recorded/failed); don't let the aborted runner overwrite that choice.
      // 自动失败（V3）：显式失败结果 → 录制异常(failed)。
      finalStatus = await trajectoryDao.finishTransientRecording(tid, 'failure');
      await trajectoryDao.updateMeta(tid, {
        isDone: false,
        isSuccessful: false,
      });
      await persistFailReason('runner_error');
      await trajectoryPhaseDao.updateRunningStatus(tid, 'failed').catch((err2) => {
        console.warn(`[record] updateRunningStatus(failed) failed for #${tid}:`, err2?.message || err2);
      });
    } else {
      finalStatus = traj.recordStatus;
    }
    const failText = String(err?.message || err || '').trim();
    if (!userStopPath && failText && session?.activePhaseId) {
      await appendPhaseDoneLog(session.activePhaseId, { text: failText, source: 'fail' });
    }
    await notifyBatchProgressForTrajectory(tid);
    throw err;
  } finally {
    // P0-2② 归属守卫：旧循环（runtime 被重录替换 / 同对象换 run）不得清新 run 的
    // session 锁、不得复位共享 runtime 字段（会洗掉新 run 的 abortRecording/userStop）、
    // 不得补发 cancel_step（会砍掉新 run 当前 agent → 新 run done 也 canceled → 双录皆死）。
    if (runStillOwnsRuntime()) {
      if (session) {
        session.busy = false;
        session.aiRecording = false;
        session.activePhaseId = null;
      }
      runtime.abortRecording = false;
      runtime.aiRecording = false;
      runtime.userStop = null;
      // spec 4.2：所有异常结束路径补发 cancel_step，防止空闲超时/phase_error 退出后
      // 执行机 agent 成为僵尸。幂等：用户 stop 路径已发过，再发无害（执行机侧
      // _request_agent_stop 天然幂等）。发送失败不影响 finally 其余清理。
      if (runtime._sentStepThisRun) {
        try {
          execSession.forwardStdin({
            nodeUuid: runtime.executorNodeUuid,
            sessionId: runtime.sessionId,
            event: 'cancel_step',
            data: {},
          });
        } catch {}
      }
    } else {
      console.warn(
        `[record] stale recording loop cleanup suppressed traj=${tid} myRunId=${myRunId}`
        + ` liveRunId=${runtime.currentRunId}`,
      );
    }
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
  } catch (err) {
    // Early-exit before phase loop (claim / login / enterTransient) — release sync claim.
    // Phase-loop failures unlock in the inner finally above.
    if (!enteredPhaseLoop) {
      lockAiRecording(runtime, session, false);
      await broadcastRecordingLock().catch(() => {});
    }
    throw err;
  }
}
