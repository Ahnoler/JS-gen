/**
 * Trajectory session replay coordinator.
 *
 * Validates selected persisted steps, prepares executor actions, and delegates
 * execution to the replay batch runner while maintaining runtime busy/abort
 * state and the product replay event contract.
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
 * Convert snake_case database columns to the camelCase shape used by models.
 * @param {object|null} row database result row
 * @returns {object|null} converted row, or null for an absent row
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
 * Build the common trajectory identifiers included in replay events.
 * @param {number} tid trajectory DB id
 * @returns {{trajectoryId: number, trajectoryDbId: number}} event scope
 */
function trajScope(tid) {
  return { trajectoryId: tid, trajectoryDbId: tid };
}

/**
 * Broadcast a replay event with both product trajectory identifiers.
 * @param {string} type event name
 * @param {number} tid trajectory DB id
 * @param {object} [extra] event-specific fields
 * @returns {void}
 */
function emitReplay(type, tid, extra = {}) {
  broadcast(type, { ...trajScope(tid), ...extra });
}

/**
 * Normalize a possibly string step identifier for executor ordering.
 * @param {number|string|null} id candidate step id
 * @returns {number|null} finite numeric id, or null for invalid input
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
  const { tid, orderedStepIds, doSuppress, runtime, session, actions, rows, snapshotsByTrigger } = prepared;

  runtime.abortReplay = false;
  runtime.suppressStepPersist = doSuppress;
  runtime.isReplay = doSuppress;
  if (session) session.busy = true;

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
  const { tid, orderedStepIds, doSuppress, runtime, session, actions, rows, snapshotsByTrigger } = prepared;

  runtime.abortReplay = false;
  runtime.suppressStepPersist = doSuppress;
  runtime.isReplay = doSuppress;
  if (session) session.busy = true;

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
    });
  } finally {
    // runReplayBatch also clears busy in finally
  }
}

/**
 * Stop an in-flight steps/replay batch (including Type A/B heal).
 * Does not change recordStatus. Idempotent if no batch is running.
 * @param {number} trajectoryId trajectory DB id
 * @returns {Promise<{ trajectoryId: number, trajectoryDbId: number, stopped: boolean }>} stop result
 */
export async function stopTrajectoryStepsReplay(trajectoryId) {
  const tid = Number(trajectoryId);
  const runtime = getTrajectoryRuntime(tid);
  if (!runtime?.sessionId) {
    const err = new Error('Trajectory is not attached — call record/prepare first');
    err.statusCode = 400;
    throw err;
  }

  runtime.abortReplay = true;
  try {
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'cancel_step',
      data: {},
    });
  } catch (err) {
    console.warn('[steps/replay/stop] cancel_step failed:', err?.message || err);
  }

  return {
    trajectoryId: tid,
    trajectoryDbId: tid,
    stopped: true,
  };
}

/**
 * Load, validate, enrich, and order a replay batch before execution begins.
 * Includes hidden meta checkpoints in the selected range, restores bound auth
 * placeholders, and rejects attached sessions that are already busy.
 * @param {number} trajectoryId trajectory DB id
 * @param {object} [options] replay options
 * @param {Array<number>} [options.stepIds] selected step DB ids
 * @param {boolean} [options.isReplay] suppress persistence when true; defaults to true
 * @returns {Promise<object>} prepared runtime, session, actions, rows, and ids
 * @throws {Error} with statusCode 400, 404, or 409 when preparation fails
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
  if (trajRow?.system_account_id) {
    const accountRow = await db('system_account')
      .where('id', Number(trajRow.system_account_id))
      .first();
    if (accountRow && (accountRow.account || accountRow.password)) {
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
  if (session?.busy) {
    const err = new Error('Session is busy (AI recording in progress)');
    err.statusCode = 409;
    throw err;
  }

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
  };
}
