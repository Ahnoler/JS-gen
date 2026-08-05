/**
 * Re-execute selected DB steps in a live executor session.
 *
 * Product contract (Recording Studio):
 * - HTTP 202 + envelope code 200 → { trajectoryId, accepted, stepIds }; progress via WS
 * - WS: replay:started → replay:step / replay:form_structure → replay:finished
 * - Type A: locator/action fail → confirmed=0 → single-step AI heal → continue
 * - Type B: save_form_snapshot checkpoint → verifyFormStructure → delete missing /
 *   AI-fill adding + structured insert (confirmed=0, next batch) — healType=form_structure
 */
import { getDB } from '../../config/database.js';
import * as execSession from '../executor-session-client.js';
import * as memoryService from '../memory/memory-service.js';
import * as formSnapshotDao from '../dao/form-snapshot-dao.js';
import * as trajectoryStepDao from '../dao/trajectory-step-dao.js';
import {
  buildStepHealInstruction,
  buildFormStructureHealInstruction,
} from '../routes/browser-session/heal-instruction.js';
import { state } from '../state.js';
import { broadcast } from '../ws-server.js';
import {
  getTrajectoryRuntime,
  markConsumedActionLog,
} from './trajectory-runtime.js';
import {
  markStepReplayFailed,
  markStepReplayOk,
  insertStepsAfter,
  refreshTrajectoryCounts,
} from './trajectory-step-service.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';

const REPLAY_TIMEOUT_MS = 300000;
const HEAL_TIMEOUT_MS = 300000;
/** Enough room to redo one failed action only (no extra form diagnosis). */
const HEAL_MAX_STEPS = 12;
/** Type B may fill several new fields. */
const FORM_STRUCTURE_HEAL_MAX_STEPS = 24;

/** Sentinel: user stopped replay/heal via cancel_step / steps/replay/stop. */
const USER_ABORT_CODE = 'USER_ABORT';

function makeUserAbortError() {
  const err = new Error(USER_ABORT_CODE);
  err.code = USER_ABORT_CODE;
  return err;
}

function isUserAbort(err) {
  if (!err) return false;
  if (err.code === USER_ABORT_CODE) return true;
  const msg = String(err.message || err || '');
  return msg === USER_ABORT_CODE || /USER_ABORT|Replay aborted/i.test(msg);
}

function emitReplayAborted(tid, { successCount = 0, failedStepIds = [] } = {}) {
  const uniqueFailed = [...new Set(failedStepIds)];
  emitReplay('replay:finished', tid, {
    successCount,
    failedCount: uniqueFailed.length,
    failedStepIds: uniqueFailed,
    aborted: true,
    reason: 'user_stop',
    error: null,
  });
}

const FILL_ACTION_TYPES = new Set([
  'fill_form_field',
  'fill_date_field',
  'select_option',
  'click_radio',
  'select_tree_option',
]);

function fromDbRowCompat(row) {
  if (!row) return null;
  const obj = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    obj[camel] = val;
  }
  return obj;
}

function trajScope(tid) {
  return { trajectoryId: tid, trajectoryDbId: tid };
}

function emitReplay(type, tid, extra = {}) {
  broadcast(type, { ...trajScope(tid), ...extra });
}

function toNumericStepId(id) {
  if (id == null || id === '') return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

function parseFormStructureResult(raw) {
  const s = String(raw || '');
  const jsonPart = s.startsWith('form-structure:') ? s.slice('form-structure:'.length) : s;
  try {
    const obj = typeof jsonPart === 'object' ? jsonPart : JSON.parse(jsonPart);
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
  }
}

function needsTypeB(report) {
  if (!report) return false;
  return !!(
    report.hasRequiredChange
    || (Array.isArray(report.missing_required) && report.missing_required.length)
    || (Array.isArray(report.added_required) && report.added_required.length)
    || (Array.isArray(report.added_optional) && report.added_optional.length)
    || (Array.isArray(report.missing_optional) && report.missing_optional.length)
  );
}

/**
 * Validate + accept replay, return 202 payload; run batch in background.
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

async function runReplayBatch({
  tid,
  orderedStepIds,
  doSuppress,
  runtime,
  session,
  actions,
  rows,
  snapshotsByTrigger,
}) {
  const allResults = [];
  const healed = [];
  const failedStepIds = [];
  let successCount = 0;
  /** @type {Set<number>} step ids removed mid-batch (Type B missing) */
  const skippedIds = new Set();

  emitReplay('replay:started', tid, { stepIds: orderedStepIds });

  try {
    for (let i = 0; i < actions.length; i += 1) {
      if (runtime.abortReplay) {
        emitReplayAborted(tid, { successCount, failedStepIds });
        return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
          successCount,
          failedCount: [...new Set(failedStepIds)].length,
          failedStepIds: [...new Set(failedStepIds)],
          aborted: true,
          reason: 'user_stop',
        });
      }

      const entry = actions[i];
      const stepId = toNumericStepId(entry.id);
      if (stepId != null && skippedIds.has(stepId)) continue;

      const stepNum = i + 1;

      emitReplay('replay:step', tid, {
        stepId,
        status: 'running',
        index: stepNum,
        total: actions.length,
        action: entry.action,
      });

      // ── Type B: form structure checkpoint (before Type A) ──
      if (entry.action === 'save_form_snapshot') {
        const typeB = await handleFormStructureCheckpoint({
          tid,
          runtime,
          doSuppress,
          entry,
          stepId,
          stepNum,
          total: actions.length,
          actions,
          skippedIds,
          snapshotsByTrigger,
        });
        if (typeB.userAbort || isUserAbort(typeB.error)) {
          allResults.push(...typeB.results);
          emitReplayAborted(tid, { successCount, failedStepIds });
          return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
            successCount,
            failedCount: [...new Set(failedStepIds)].length,
            failedStepIds: [...new Set(failedStepIds)],
            aborted: true,
            reason: 'user_stop',
          });
        }
        if (typeB.aborted) {
          if (stepId != null) failedStepIds.push(stepId);
          allResults.push(...typeB.results);
          emitReplay('replay:finished', tid, {
            successCount,
            failedCount: failedStepIds.length,
            failedStepIds: [...new Set(failedStepIds)],
            error: typeB.error,
            healType: 'form_structure',
          });
          return buildPayload(tid, doSuppress, rows, allResults, healed, typeB.error, {
            successCount,
            failedCount: failedStepIds.length,
            failedStepIds: [...new Set(failedStepIds)],
          });
        }
        if (typeB.ok) successCount += 1;
        allResults.push(...typeB.results);
        if (typeB.healed) healed.push(...typeB.healed);
        continue;
      }

      let result;
      try {
        const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', REPLAY_TIMEOUT_MS);
        execSession.forwardStdin({
          nodeUuid: runtime.executorNodeUuid,
          sessionId: runtime.sessionId,
          event: 'replay_actions',
          data: {
            actions: [entry],
            is_replay: doSuppress,
            stop_on_fail: true,
          },
        });
        result = await doneP;
        await markConsumedActionLog(runtime);
      } catch (e) {
        const msg = e?.message || String(e);
        if (stepId != null) {
          try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
          failedStepIds.push(stepId);
        }
        emitReplay('replay:step', tid, {
          stepId,
          status: 'failed',
          error: msg,
          index: stepNum,
          total: actions.length,
          action: entry.action,
        });
        allResults.push({
          index: stepNum,
          action: entry.action,
          params: entry.params,
          result: msg,
          ok: false,
          id: entry.id,
        });
        emitReplay('replay:finished', tid, {
          successCount,
          failedCount: failedStepIds.length,
          failedStepIds: [...new Set(failedStepIds)],
          error: msg,
        });
        return buildPayload(tid, doSuppress, rows, allResults, healed, msg, {
          successCount,
          failedCount: failedStepIds.length,
          failedStepIds: [...new Set(failedStepIds)],
        });
      }

      if (runtime.abortReplay) {
        emitReplayAborted(tid, { successCount, failedStepIds });
        return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
          successCount,
          failedCount: [...new Set(failedStepIds)].length,
          failedStepIds: [...new Set(failedStepIds)],
          aborted: true,
          reason: 'user_stop',
        });
      }

      const batchResults = Array.isArray(result?.results) ? result.results : [];
      const row = batchResults[0] || null;
      const ok = Number(result?.failed || 0) === 0 && (row ? !!row.ok : Number(result?.ok || 0) > 0);
      const failResult = row?.result || result?.error || 'unknown';

      if (ok) {
        successCount += 1;
        if (stepId != null) {
          try { await markStepReplayOk(stepId); } catch { /* ignore */ }
        }
        emitReplay('replay:step', tid, {
          stepId,
          status: 'success',
          index: stepNum,
          total: actions.length,
          action: entry.action,
        });
        allResults.push({
          index: stepNum,
          action: entry.action,
          params: entry.params,
          result: row?.result || 'ok',
          ok: true,
          id: entry.id,
          confirmed: true,
        });
        continue;
      }

      // Type A — single-step heal
      if (stepId != null) {
        try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
        failedStepIds.push(stepId);
      }
      emitReplay('replay:step', tid, {
        stepId,
        status: 'failed',
        error: String(failResult),
        index: stepNum,
        total: actions.length,
        action: entry.action,
        healType: 'step',
      });
      allResults.push({
        index: stepNum,
        action: entry.action,
        params: entry.params,
        result: failResult,
        ok: false,
        id: entry.id,
        confirmed: false,
      });

      broadcast('recording:replay_heal', {
        ...trajScope(tid),
        stepId,
        phase: 'start',
        action: entry.action,
        message: String(failResult),
        confirmed: false,
        healType: 'step',
      });

      try {
        const instruction = buildStepHealInstruction(entry, failResult);
        await runHealStep(runtime, instruction, HEAL_MAX_STEPS, 'step');
        await markConsumedActionLog(runtime);
        if (runtime.abortReplay) {
          broadcast('recording:replay_heal', {
            ...trajScope(tid),
            stepId,
            phase: 'error',
            action: entry.action,
            message: USER_ABORT_CODE,
            confirmed: false,
            healType: 'step',
            aborted: true,
          });
          emitReplayAborted(tid, { successCount, failedStepIds });
          return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
            successCount,
            failedCount: [...new Set(failedStepIds)].length,
            failedStepIds: [...new Set(failedStepIds)],
            aborted: true,
            reason: 'user_stop',
          });
        }
        broadcast('recording:replay_heal', {
          ...trajScope(tid),
          stepId,
          phase: 'done',
          action: entry.action,
          confirmed: false,
          healType: 'step',
        });
        healed.push({
          stepId,
          action: entry.action,
          index: stepNum,
          confirmed: false,
          healType: 'step',
        });
        const last = allResults[allResults.length - 1];
        if (last) {
          last.healed = true;
          last.result = `healed-by-ai (was: ${failResult})`;
        }
      } catch (healErr) {
        const msg = healErr?.message || String(healErr);
        if (isUserAbort(healErr) || runtime.abortReplay) {
          broadcast('recording:replay_heal', {
            ...trajScope(tid),
            stepId,
            phase: 'error',
            action: entry.action,
            message: USER_ABORT_CODE,
            confirmed: false,
            healType: 'step',
            aborted: true,
          });
          emitReplayAborted(tid, { successCount, failedStepIds });
          return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
            successCount,
            failedCount: [...new Set(failedStepIds)].length,
            failedStepIds: [...new Set(failedStepIds)],
            aborted: true,
            reason: 'user_stop',
          });
        }
        broadcast('recording:replay_heal', {
          ...trajScope(tid),
          stepId,
          phase: 'error',
          action: entry.action,
          message: msg,
          confirmed: false,
          healType: 'step',
        });
        emitReplay('replay:finished', tid, {
          successCount,
          failedCount: failedStepIds.length,
          failedStepIds: [...new Set(failedStepIds)],
          error: `AI heal failed for step ${stepNum} (${entry.action}): ${msg}`,
          healType: 'step',
        });
        return buildPayload(
          tid,
          doSuppress,
          rows,
          allResults,
          healed,
          `AI heal failed for step ${stepNum} (${entry.action}): ${msg}`,
          {
            successCount,
            failedCount: failedStepIds.length,
            failedStepIds: [...new Set(failedStepIds)],
          },
        );
      }
    }

    const uniqueFailed = [...new Set(failedStepIds)];
    emitReplay('replay:finished', tid, {
      successCount,
      failedCount: uniqueFailed.length,
      failedStepIds: uniqueFailed,
    });

    return buildPayload(tid, doSuppress, rows, allResults, healed, null, {
      successCount,
      failedCount: uniqueFailed.length,
      failedStepIds: uniqueFailed,
    });
  } finally {
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    runtime.formStructureHealLabels = null;
    runtime.abortReplay = false;
    if (session) session.busy = false;
  }
}

async function handleFormStructureCheckpoint({
  tid,
  runtime,
  doSuppress,
  entry,
  stepId,
  stepNum,
  total,
  actions,
  skippedIds,
  snapshotsByTrigger,
}) {
  const results = [];
  const healed = [];
  const snap = stepId != null ? snapshotsByTrigger.get(stepId) : null;

  // No bound snapshot (legacy) → skip Type B, treat as success no-op
  if (!snap) {
    if (stepId != null) {
      try { await markStepReplayOk(stepId); } catch { /* ignore */ }
    }
    emitReplay('replay:step', tid, {
      stepId,
      status: 'success',
      index: stepNum,
      total,
      action: entry.action,
      healType: 'form_structure',
      skipped: 'no_trigger_snapshot',
    });
    results.push({
      index: stepNum,
      action: entry.action,
      params: entry.params,
      result: 'ok-skip-no-snapshot',
      ok: true,
      id: entry.id,
      confirmed: true,
    });
    return { ok: true, aborted: false, results, healed };
  }

  let result;
  try {
    const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', REPLAY_TIMEOUT_MS);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'replay_actions',
      data: {
        actions: [{
          ...entry,
          params: {
            ...(entry.params || {}),
            fields: (snap.fields || []).map((f) => ({
              label: f.label,
              is_required: !!(f.isRequired ?? f.is_required),
            })),
            container: snap.container,
          },
        }],
        is_replay: doSuppress,
        stop_on_fail: true,
      },
    });
    result = await doneP;
    await markConsumedActionLog(runtime);
  } catch (e) {
    const msg = e?.message || String(e);
    if (stepId != null) {
      try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
    }
    emitReplay('replay:step', tid, {
      stepId,
      status: 'failed',
      error: msg,
      index: stepNum,
      total,
      action: entry.action,
      healType: 'form_structure',
    });
    results.push({
      index: stepNum,
      action: entry.action,
      params: entry.params,
      result: msg,
      ok: false,
      id: entry.id,
    });
    return { ok: false, aborted: true, error: msg, results, healed };
  }

  const batchResults = Array.isArray(result?.results) ? result.results : [];
  const row = batchResults[0] || null;
  const report = parseFormStructureResult(row?.result || '');

  if (!needsTypeB(report)) {
    if (stepId != null) {
      try { await markStepReplayOk(stepId); } catch { /* ignore */ }
    }
    emitReplay('replay:step', tid, {
      stepId,
      status: 'success',
      index: stepNum,
      total,
      action: entry.action,
      healType: 'form_structure',
    });
    results.push({
      index: stepNum,
      action: entry.action,
      params: entry.params,
      result: row?.result || 'ok',
      ok: true,
      id: entry.id,
      confirmed: true,
    });
    return { ok: true, aborted: false, results, healed };
  }

  const container = snap.container || entry.params?.container || 'main';
  emitReplay('replay:form_structure', tid, {
    stepId,
    healType: 'form_structure',
    container,
    missing_required: report.missing_required || [],
    missing_optional: report.missing_optional || [],
    added_required: report.added_required || [],
    added_optional: report.added_optional || [],
    hasRequiredChange: !!report.hasRequiredChange,
    hasOptionalChange: !!report.hasOptionalChange,
    reordered: !!report.reordered,
  });

  // Delete missing-label fill steps in same phase
  const missingLabels = new Set([
    ...(report.missing_required || []),
    ...(report.missing_optional || []),
  ]);
  const deletedIds = [];
  if (missingLabels.size) {
    const phaseId = entry.trajectoryPhaseId != null ? Number(entry.trajectoryPhaseId) : null;
    const db = getDB();
    let q = db('trajectory_step').where({ trajectory_id: tid });
    if (Number.isFinite(phaseId) && phaseId > 0) {
      q = q.andWhere({ trajectory_phase_id: phaseId });
    } else if (entry.phaseNumber) {
      q = q.andWhere({ phase_number: Number(entry.phaseNumber) });
    }
    const candidates = await q.select('*');
    for (const r of candidates) {
      const actionType = r.action_type || '';
      if (!FILL_ACTION_TYPES.has(actionType)) continue;
      let params = r.params_json;
      if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch { params = {}; }
      }
      const label = String(params?.label_text || '').trim();
      if (!label || !missingLabels.has(label)) continue;
      const sid = Number(r.id);
      if (sid === stepId) continue; // never delete checkpoint
      await trajectoryStepDao.removeById(sid);
      deletedIds.push(sid);
      skippedIds.add(sid);
      // Also drop from remaining in-memory queue
      for (let j = 0; j < actions.length; j += 1) {
        if (toNumericStepId(actions[j].id) === sid) {
          skippedIds.add(sid);
        }
      }
    }
    if (deletedIds.length) {
      await trajectoryStepDao.reorderByTrajectory(tid);
      const counts = await refreshTrajectoryCounts(tid);
      await trajectoryDao.updateMeta(tid, {
        stepCount: counts.stepCount,
        phaseCount: counts.phaseCount,
      });
    }
  }

  const addingLabels = [
    ...(report.added_required || []),
    ...(report.added_optional || []),
  ];

  if (addingLabels.length) {
    const instruction = buildFormStructureHealInstruction({
      container,
      added_required: report.added_required || [],
      added_optional: report.added_optional || [],
      missing_required: report.missing_required || [],
      missing_optional: report.missing_optional || [],
    });
    broadcast('recording:replay_heal', {
      ...trajScope(tid),
      stepId,
      phase: 'start',
      action: entry.action,
      healType: 'form_structure',
      message: `form structure: fill ${addingLabels.length} added field(s)`,
    });

    try {
      const beforeIds = await peekActionLogIds(runtime);
      await runHealStep(runtime, instruction, FORM_STRUCTURE_HEAL_MAX_STEPS, 'form_structure');
      const afterEntries = await fetchActionLogEntries(runtime);
      const newEntries = afterEntries.filter((e) => {
        const id = e?.id != null ? String(e.id) : '';
        if (!id || beforeIds.has(id)) return false;
        const a = e.action || '';
        if (!FILL_ACTION_TYPES.has(a)) return false;
        const label = String(e.params?.label_text || '').trim();
        return addingLabels.includes(label);
      });

      if (stepId != null && newEntries.length) {
        await insertStepsAfter(stepId, newEntries.map((e) => ({
          actionType: e.action,
          params: e.params || {},
          element: e.element || null,
          source: 'agent',
          confirmed: false,
          trajectoryPhaseId: entry.trajectoryPhaseId ?? null,
          phaseNumber: entry.phaseNumber ?? 0,
        })));
      }

      // Require coverage of added_required at minimum
      const filledLabels = new Set(
        newEntries.map((e) => String(e.params?.label_text || '').trim()).filter(Boolean),
      );
      const missingRequiredAdds = (report.added_required || []).filter((l) => !filledLabels.has(l));
      await markConsumedActionLog(runtime);

      if (missingRequiredAdds.length) {
        const err = `Type B incomplete: missing fills for ${missingRequiredAdds.join(', ')}`;
        broadcast('recording:replay_heal', {
          ...trajScope(tid),
          stepId,
          phase: 'error',
          action: entry.action,
          healType: 'form_structure',
          message: err,
        });
        if (stepId != null) {
          try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
        }
        // Still update snapshot to current DOM truth where possible
        await updateSnapshotFromReport(snap, report).catch(() => null);
        results.push({
          index: stepNum,
          action: entry.action,
          params: entry.params,
          result: err,
          ok: false,
          id: entry.id,
          healType: 'form_structure',
          deletedStepIds: deletedIds,
        });
        return { ok: false, aborted: true, error: err, results, healed };
      }

      broadcast('recording:replay_heal', {
        ...trajScope(tid),
        stepId,
        phase: 'done',
        action: entry.action,
        healType: 'form_structure',
        inserted: newEntries.length,
      });
      healed.push({
        stepId,
        action: entry.action,
        index: stepNum,
        confirmed: false,
        healType: 'form_structure',
        inserted: newEntries.length,
        deletedStepIds: deletedIds,
      });
    } catch (healErr) {
      const msg = healErr?.message || String(healErr);
      if (isUserAbort(healErr) || runtime.abortReplay) {
        broadcast('recording:replay_heal', {
          ...trajScope(tid),
          stepId,
          phase: 'error',
          action: entry.action,
          healType: 'form_structure',
          message: USER_ABORT_CODE,
          aborted: true,
        });
        results.push({
          index: stepNum,
          action: entry.action,
          params: entry.params,
          result: USER_ABORT_CODE,
          ok: false,
          id: entry.id,
          healType: 'form_structure',
          deletedStepIds: deletedIds,
          aborted: true,
        });
        return {
          ok: false,
          aborted: true,
          userAbort: true,
          error: USER_ABORT_CODE,
          results,
          healed,
        };
      }
      broadcast('recording:replay_heal', {
        ...trajScope(tid),
        stepId,
        phase: 'error',
        action: entry.action,
        healType: 'form_structure',
        message: msg,
      });
      if (stepId != null) {
        try { await markStepReplayFailed(stepId); } catch { /* ignore */ }
      }
      results.push({
        index: stepNum,
        action: entry.action,
        params: entry.params,
        result: msg,
        ok: false,
        id: entry.id,
        healType: 'form_structure',
        deletedStepIds: deletedIds,
      });
      return {
        ok: false,
        aborted: true,
        error: `form_structure heal failed: ${msg}`,
        results,
        healed,
      };
    }
  }

  // Update snapshot fields in place to post-heal DOM truth
  await updateSnapshotFromReport(snap, report).catch(() => null);

  if (stepId != null) {
    try { await markStepReplayOk(stepId); } catch { /* ignore */ }
  }
  emitReplay('replay:step', tid, {
    stepId,
    status: 'success',
    index: stepNum,
    total,
    action: entry.action,
    healType: 'form_structure',
    deletedStepIds: deletedIds,
  });
  results.push({
    index: stepNum,
    action: entry.action,
    params: entry.params,
    result: row?.result || 'ok-form-structure-healed',
    ok: true,
    id: entry.id,
    confirmed: true,
    healType: 'form_structure',
    deletedStepIds: deletedIds,
  });
  return { ok: true, aborted: false, results, healed };
}

async function updateSnapshotFromReport(snap, report) {
  if (!snap?.id || !report) return;
  const actualLabels = Array.isArray(report.fields) ? report.fields : [];
  const missing = new Set([
    ...(report.missing_required || []),
    ...(report.missing_optional || []),
  ]);
  const prevByLabel = new Map(
    (snap.fields || []).map((f) => [f.label, !!(f.isRequired ?? f.is_required)]),
  );
  const fields = [];
  for (const label of actualLabels) {
    if (missing.has(label)) continue;
    let isReq = prevByLabel.has(label) ? prevByLabel.get(label) : false;
    if ((report.added_required || []).includes(label)) isReq = true;
    if ((report.added_optional || []).includes(label)) isReq = false;
    fields.push({ label, isRequired: isReq });
  }
  const requiredCount = fields.filter((f) => f.isRequired).length;
  await formSnapshotDao.updateFields(snap.id, {
    fieldCount: fields.length,
    requiredCount,
    optionalCount: fields.length - requiredCount,
    fields,
  });
}

async function peekActionLogIds(runtime) {
  const entries = await fetchActionLogEntries(runtime);
  return new Set(entries.map((e) => (e?.id != null ? String(e.id) : '')).filter(Boolean));
}

async function fetchActionLogEntries(runtime) {
  if (!runtime?.sessionId || !runtime?.executorNodeUuid) return [];
  try {
    const resultP = execSession.waitForSessionEvent(runtime.sessionId, 'get_action_log_result', 5000);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'get_action_log',
      data: {},
    });
    const result = await resultP.catch(() => null);
    return Array.isArray(result?.entries) ? result.entries : [];
  } catch {
    return [];
  }
}

function buildPayload(tid, doSuppress, rows, allResults, healed, error, counts = {}) {
  const okCount = allResults.filter((r) => r.ok && !r.healed).length;
  const failCount = allResults.filter((r) => !r.ok || r.healed || r.confirmed === false).length;
  return {
    trajectoryId: tid,
    trajectoryDbId: tid,
    isReplay: doSuppress,
    stepIds: rows.map((r) => r.id),
    count: allResults.length,
    ok: counts.successCount ?? okCount,
    failed: counts.failedCount ?? failCount,
    successCount: counts.successCount ?? okCount,
    failedCount: counts.failedCount ?? failCount,
    failedStepIds: counts.failedStepIds || [],
    error: counts.aborted ? null : (error || null),
    aborted: !!counts.aborted,
    reason: counts.reason || null,
    healed: Array.isArray(healed) ? healed : [],
    results: allResults,
  };
}

async function runHealStep(runtime, instruction, maxSteps = HEAL_MAX_STEPS, healType = 'step') {
  // P2-1: record replay-heal decision (deterministic instruction template, not LLM-generated)
  try {
    await memoryService.ingestEvents([{
      eventType: 'decision',
      trajectoryId: runtime.trajectoryDbId ?? runtime.trajectoryId ?? null,
      sessionId: runtime.sessionId,
      payload: { kind: 'heal', healType },
      decision: {
        decisionType: 'heal',
        model: '',
        temperature: 0.0,
        inputPreview: String(instruction || '').slice(0, 500),
        outputJson: { healType, maxSteps },
        policyChecks: [{ check: 'instruction_present', pass: Boolean(instruction) }],
        auditStatus: instruction ? 'passed' : 'failed',
      },
    }]);
  } catch (err) {
    console.warn('[replay] heal decision ingest skipped:', err?.message || err);
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    let sawAgentStopped = false;

    const rejectAbort = () => {
      cleanup();
      reject(makeUserAbortError());
    };

    const unsubDone = execSession.onSessionEvent(runtime.sessionId, 'phase_done', () => {
      if (settled) return;
      if (runtime.abortReplay || sawAgentStopped) {
        rejectAbort();
        return;
      }
      cleanup();
      resolve();
    });
    const unsubErr = execSession.onSessionEvent(runtime.sessionId, 'phase_error', (payload) => {
      if (settled) return;
      if (runtime.abortReplay || sawAgentStopped) {
        rejectAbort();
        return;
      }
      cleanup();
      reject(new Error(payload?.message || 'phase_error'));
    });
    const unsubStopped = execSession.onSessionEvent(runtime.sessionId, 'agent_stopped', () => {
      if (settled) return;
      sawAgentStopped = true;
      runtime.abortReplay = true;
      rejectAbort();
    });
    const timer = setTimeout(() => {
      if (settled) return;
      if (runtime.abortReplay || sawAgentStopped) {
        rejectAbort();
        return;
      }
      cleanup();
      reject(new Error('Timeout waiting for heal phase_done'));
    }, HEAL_TIMEOUT_MS);

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unsubDone(); } catch { /* ignore */ }
      try { unsubErr(); } catch { /* ignore */ }
      try { unsubStopped(); } catch { /* ignore */ }
    }

    if (runtime.abortReplay) {
      rejectAbort();
      return;
    }

    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'step',
      data: {
        instruction,
        max_steps: maxSteps,
        phase_number: 0,
        heal_type: healType,
        healType,
      },
    });
  });
}
