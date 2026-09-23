/**
 * 轨迹会话回放协调器。
 *
 * 校验选定的持久化步骤，准备执行器操作，并将执行委托给回放批处理运行器，
 * 同时维护运行时忙碌/中止状态和产品回放事件契约。
 *
 * Re-execute selected DB steps in a live executor session.
 *
 * Product contract (Recording Studio):
 * - HTTP 202 + envelope code 200 → { trajectoryId, accepted, stepIds }; progress via WS
 * - WS: replay:started → replay:step / replay:form_structure → replay:finished
 * - Type A: locator/action fail → confirmed=0 → single-step AI heal → continue
 * - Type B: save_form_snapshot checkpoint → verifyFormStructure → delete missing /
 *   AI-fill adding + structured insert (confirmed=0, next batch) — healType=form_structure
 */
import { getDB } from '#config/database.js';
import * as execSession from '../../executor-session-client.js';
import * as formSnapshotDao from '../../dao/form-snapshot-dao.js';
import { state } from '../../state.js';
import { broadcast } from '../../ws-server.js';
import {
  getTrajectoryRuntime,
} from './trajectory-runtime.js';
import { runReplayBatch } from './replay-batch-runner.js';

/**
 * 将 snake_case 数据库列转换为模型使用的 camelCase 结构。
 * @param {object|null} row 数据库结果行
 * @returns {object|null} 转换后的行，不存在的行返回 null
 */
function fromDbRowCompat(row) {
  if (!row) return null;
  const obj = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    obj[camel] = val;
  }
  return obj;
}

/**
 * 构建回放事件中包含的通用轨迹标识符。
 * @param {number} tid 轨迹 DB id
 * @returns {{trajectoryId: number, trajectoryDbId: number}} 事件作用域
 */
function trajScope(tid) {
  return { trajectoryId: tid, trajectoryDbId: tid };
}

/**
 * 广播带有两个产品轨迹标识符的回放事件。
 * @param {string} type 事件名称
 * @param {number} tid 轨迹 DB id
 * @param {object} [extra] 事件专属字段
 * @returns {void}
 */
function emitReplay(type, tid, extra = {}) {
  broadcast(type, { ...trajScope(tid), ...extra });
}

/**
 * 规范化可能为字符串的步骤标识符，以供执行器排序。
 * @param {number|string|null} id 候选步骤 id
 * @returns {number|null} 有限数值 id，无效输入时返回 null
 */
function toNumericStepId(id) {
  if (id == null || id === '') return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validate + accept replay, return 202 payload; run batch in background.
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [root0] options
 * @param {Array<number>} [root0.stepIds] step DB ids to replay
 * @param {boolean} [root0.isReplay] whether to suppress step persist (default true)
 * @returns {Promise<{ trajectoryId: number, trajectoryDbId: number, accepted: boolean, stepIds: Array<number> }>} 202 acceptance payload
 */
export async function acceptTrajectoryStepsReplay(trajectoryId, {
  stepIds = [],
  isReplay = true,
} = {}) {
  const prepared = await prepareReplayBatch(trajectoryId, { stepIds, isReplay });
  const {
    tid, orderedStepIds, doSuppress, runtime, session, actions, rows, snapshotsByTrigger,
    secretValues,
  } = prepared;

  runtime.abortReplay = false;
  runtime.suppressStepPersist = doSuppress;
  runtime.isReplay = doSuppress;
  if (session) session.busy = true;

  // #7 批次世代令牌：prepare 成功后起跑前递增，本批 seq 随批传入 runReplayBatch；
  // 其 finally 仅当 runtime.replayBatchSeq 仍等于本批 seq 才复位运行标志，防止
  // 先结束的旧批次复位后到批次的 abortReplay/suppressStepPersist/busy 等标志。
  // （busy 原子化后同一 runtime 同时至多一个批次，守卫为防御性设计。）
  runtime.replayBatchSeq = (runtime.replayBatchSeq || 0) + 1;
  const batchSeq = runtime.replayBatchSeq;

  const accepted = {
    trajectoryId: tid,
    trajectoryDbId: tid,
    accepted: true,
    stepIds: orderedStepIds,
  };

  setImmediate(() => {
    runReplayBatch({
      tid,
      orderedStepIds,
      doSuppress,
      runtime,
      session,
      actions,
      rows,
      snapshotsByTrigger,
      secretValues,
      seq: batchSeq,
    }).catch((err) => {
      const msg = err?.message || String(err);
      console.error(`[steps/replay] background batch failed traj=${tid}:`, msg);
      try {
        emitReplay('replay:finished', tid, {
          successCount: 0,
          failedCount: orderedStepIds.length,
          failedStepIds: orderedStepIds,
          error: msg,
        });
      } catch { /* ignore */ }
      try {
        runtime.suppressStepPersist = false;
        runtime.isReplay = false;
        runtime.abortReplay = false;
        runtime.replayRunning = false;
        if (session) session.busy = false;
      } catch { /* ignore */ }
    });
  });

  return accepted;
}

/**
 * Replay selected steps synchronously (await batch completion).
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [root0] options
 * @param {Array<number>} [root0.stepIds] step DB ids to replay
 * @param {boolean} [root0.isReplay] whether to suppress step persist (default true)
 * @returns {Promise<object>} replay batch result
 */
export async function replayTrajectorySteps(trajectoryId, { stepIds = [], isReplay = true } = {}) {
  const prepared = await prepareReplayBatch(trajectoryId, { stepIds, isReplay });
  const {
    tid, orderedStepIds, doSuppress, runtime, session, actions, rows, snapshotsByTrigger,
    secretValues,
  } = prepared;

  runtime.abortReplay = false;
  runtime.suppressStepPersist = doSuppress;
  runtime.isReplay = doSuppress;
  if (session) session.busy = true;

  // #7 批次世代令牌（与 accept 路径同口径）：prepare 成功后起跑前递增并随批传入
  // runReplayBatch，供其 finally 做世代守卫复位。
  runtime.replayBatchSeq = (runtime.replayBatchSeq || 0) + 1;
  const batchSeq = runtime.replayBatchSeq;

  try {
    return await runReplayBatch({
      tid,
      orderedStepIds,
      doSuppress,
      runtime,
      session,
      actions,
      rows,
      snapshotsByTrigger,
      secretValues,
      seq: batchSeq,
    });
  } catch (err) {
    // #13 sync busy 泄漏：runReplayBatch 的 finally 只覆盖其主 try 段；若批在
    // 进入主 try 前抛出（replay:started 广播 / 计划日志 / 菜单导航段），其
    // finally 不会执行，busy/replayRunning 只能由本 catch 兜底复位。字段集对齐
    // accept 路径的 .catch 兜底（suppressStepPersist/isReplay/abortReplay +
    // session.busy=false，另含本任务新增的 replayRunning），并补发
    // replay:finished error 终态——sync 调用方同样以前端 WS 收尾信号为准，
    // 缺失会让条目悬挂。随后原样 rethrow，保持同步调用方的错误语义不变。
    const msg = err?.message || String(err);
    try {
      emitReplay('replay:finished', tid, {
        successCount: 0,
        failedCount: orderedStepIds.length,
        failedStepIds: orderedStepIds,
        error: msg,
      });
    } catch { /* ignore */ }
    try {
      runtime.suppressStepPersist = false;
      runtime.isReplay = false;
      runtime.abortReplay = false;
      runtime.replayRunning = false;
      if (session) session.busy = false;
    } catch { /* ignore */ }
    throw err;
  } finally {
    // runReplayBatch also clears busy in finally
  }
}

/**
 * Stop an in-flight steps/replay batch (including Type A/B heal).
 * Does not change recordStatus. Honest when no batch is running: returns
 * stopped:false without touching abortReplay or forwarding cancel_step —
 * this covers both idle leftovers (#16) and AI-recording occupancy (#8:
 * session.busy is true while recording but runtime.replayRunning is false,
 * so stop can no longer kill the recording agent via cancel_step).
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<{ trajectoryId: number, trajectoryDbId: number, stopped: boolean, batchWasRunning: boolean, cancelStepDelivered?: boolean, reason?: string }>} stop result
 */
export async function stopTrajectoryStepsReplay(trajectoryId) {
  const tid = Number(trajectoryId);
  const runtime = getTrajectoryRuntime(tid);
  if (!runtime?.sessionId) {
    const err = new Error('Trajectory is not attached — call record/prepare first');
    err.statusCode = 400;
    throw err;
  }

  // #5/#8/#16 诚实化：仅当回放批真正在跑（runtime.replayRunning，由
  // runReplayBatch 置位/复位）才置 abortReplay 并下发 cancel_step；录制期
  // （busy=true 但 replayRunning=false）与空闲期一律早退返回诚实结果。
  if (!runtime.replayRunning) {
    return {
      trajectoryId: tid,
      trajectoryDbId: tid,
      stopped: false,
      batchWasRunning: false,
      reason: 'no_replay_batch_running',
    };
  }

  runtime.abortReplay = true;
  let cancelStepDelivered = true;
  try {
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'cancel_step',
      data: {},
    });
  } catch (err) {
    cancelStepDelivered = false;
    console.warn('[steps/replay/stop] cancel_step failed:', err?.message || err);
  }

  return {
    trajectoryId: tid,
    trajectoryDbId: tid,
    stopped: true,
    batchWasRunning: true,
    cancelStepDelivered,
  };
}

/**
 * 在执行开始前加载、校验、补充并排序回放批次。
 * 包括选定范围内隐藏的元检查点，恢复绑定的认证占位符，
 * 并拒绝已处于忙碌状态的附加会话。
 * @param {number} trajectoryId 轨迹 DB id
 * @param {object} [options] 回放选项
 * @param {Array<number>} [options.stepIds] 选定的步骤 DB id
 * @param {boolean} [options.isReplay] 为 true 时禁止持久化；默认为 true
 * @returns {Promise<object>} 准备好的运行时、会话、操作、行和 id
 * @throws {Error} 准备失败时带有 statusCode 400、404 或 409
 */
async function prepareReplayBatch(trajectoryId, { stepIds = [], isReplay = true } = {}) {
  const tid = Number(trajectoryId);
  const runtime = getTrajectoryRuntime(tid);
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
  const selectedRows = await db('trajectory_step')
    .where({ trajectory_id: tid })
    .whereIn('id', ids)
    .orderBy(['step_number', 'action_index']);
  if (!selectedRows.length) {
    const err = new Error('No matching steps for stepIds');
    err.statusCode = 404;
    throw err;
  }

  // Auto-include meta checkpoints (e.g. save_form_snapshot) between the selected
  // business range so Type B still runs when the product UI hides meta steps.
  const { META_STEP_ACTIONS } = await import('../../models/meta-step-actions.js');
  const stepNumbers = selectedRows
    .map((r) => Number(r.step_number))
    .filter((n) => Number.isFinite(n));
  const minSn = Math.min(...stepNumbers);
  const maxSn = Math.max(...stepNumbers);
  const selectedIdSet = new Set(selectedRows.map((r) => Number(r.id)));
  let metaRows = [];
  if (META_STEP_ACTIONS.length && Number.isFinite(minSn) && Number.isFinite(maxSn)) {
    metaRows = await db('trajectory_step')
      .where({ trajectory_id: tid })
      .whereIn('action_type', META_STEP_ACTIONS)
      .andWhere('step_number', '>=', minSn)
      .andWhere('step_number', '<=', maxSn)
      .orderBy(['step_number', 'action_index']);
  }
  const rows = [...selectedRows];
  for (const r of metaRows) {
    if (!selectedIdSet.has(Number(r.id))) rows.push(r);
  }
  rows.sort((a, b) => {
    const sn = Number(a.step_number) - Number(b.step_number);
    if (sn !== 0) return sn;
    return Number(a.action_index || 0) - Number(b.action_index || 0);
  });

  const { trajectoryStepToActionEntry } = await import('../../models/element.js');
  // Auth-recording trajectories persist masked credentials
  // (__AUTH_USERNAME__/__AUTH_PASSWORD__) in step params — restore the bound
  // account's real credentials before execution.
  const trajRow = await db('trajectory').where('id', tid).first();
  // Auth transactions must never run the Type B form-structure checkpoint:
  // the login page re-renders after navigation, verifyFormStructure then
  // reports the username/password fields as "missing" and the heal deletes
  // the fill steps (observed on traj 668). Drop snapshot meta rows upfront.
  if (trajRow?.auth_kind) {
    const kept = rows.filter(
      (r) => String(r.action_type || '') !== 'save_form_snapshot',
    );
    if (kept.length !== rows.length) {
      const droppedIds = new Set(
        rows.filter((r) => String(r.action_type || '') === 'save_form_snapshot').map((r) => Number(r.id)),
      );
      rows.length = 0;
      rows.push(...kept);
      for (const id of droppedIds) selectedIdSet?.delete?.(id);
    }
  }
  // Resolved auth credentials are redacted from replay logs (plan + executor
  // per-step stderr) so manual replay of auth trajectories never prints the
  // plaintext password / account.
  const secretValues = [];
  if (trajRow?.system_account_id) {
    const accountRow = await db('system_account')
      .where('id', Number(trajRow.system_account_id))
      .first();
    if (accountRow && (accountRow.account || accountRow.password)) {
      if (accountRow.account) secretValues.push(String(accountRow.account));
      if (accountRow.password) secretValues.push(String(accountRow.password));
      const { resolveAuthPlaceholdersDeep } =
        await import('../operation-component-service.js');
      for (const r of rows) {
        if (r.params_json == null) continue;
        let parsed = r.params_json;
        if (typeof parsed === 'string') {
          try { parsed = JSON.parse(parsed); } catch { continue; }
        }
        const resolved = resolveAuthPlaceholdersDeep(parsed, {
          account: accountRow.account,
          password: accountRow.password,
        });
        r.params_json = typeof r.params_json === 'string'
          ? JSON.stringify(resolved)
          : resolved;
      }
    }
  }
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
      id: entry.id,
      element: entry.element || undefined,
      trajectoryPhaseId: step.trajectoryPhaseId ?? null,
      phaseNumber: step.phaseNumber ?? 0,
    };
  });

  const orderedStepIds = actions
    .map((a) => toNumericStepId(a.id))
    .filter((n) => n != null);

  const snapshots = await formSnapshotDao.listByTrajectory(tid);
  const snapshotsByTrigger = new Map();
  for (const s of snapshots) {
    if (s.triggerStepId != null) {
      snapshotsByTrigger.set(Number(s.triggerStepId), s);
    }
  }

  const session = state.sessions.get(runtime.sessionId);
  // #6 busy 检查-置位原子化：检查通过与置位之间不得有 await——两者同处一个同步
  // 段，Node 单线程事件循环下，并发第二个 accept/sync 的 continuation 无法插入
  // 「检查已通过、置位未发生」的窗口，双开批回放（TOCTOU）被堵死。此前置位延迟
  // 到 accept/sync 的 continuation，与检查之间隔着 prepare 返回 + 微任务调度，
  // 构成竞窗（A、B 都 await 在 prepare 的 DB 段时，A 的置位排在 B 的检查之后）。
  if (session?.busy) {
    const err = new Error('Session is busy (AI recording in progress)');
    err.statusCode = 409;
    throw err;
  }
  if (session) session.busy = true;
  // 置位后本函数剩余段（纯同步对象装配，现无 throw 点）以 try/catch 兜底：任何
  // 意外抛出必须先复位 busy 再原样 rethrow，否则 4xx/5xx 错误响应会把 session
  // 卡死成永久 busy（后续所有回放 409）。
  try {
    const doSuppress = isReplay !== false;
    return {
      tid,
      orderedStepIds,
      doSuppress,
      runtime,
      session,
      actions,
      rows,
      snapshotsByTrigger,
      secretValues,
    };
  } catch (err) {
    if (session) session.busy = false;
    throw err;
  }
}
