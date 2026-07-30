/**
 * Re-execute selected DB steps in a live executor session.
 * On step failure: stop → AI single-step heal → resume remaining steps.
 */
import { getDB } from '../../config/database.js';
import * as execSession from '../executor-session-client.js';
import { buildStepHealInstruction } from '../routes/browser-session/heal-instruction.js';
import { state } from '../state.js';
import { broadcast } from '../ws-server.js';
import {
  getTrajectoryRuntime,
  markConsumedActionLog,
} from './trajectory-runtime.js';

const REPLAY_TIMEOUT_MS = 300000;
const HEAL_TIMEOUT_MS = 300000;
/** Enough room to diagnose validation, fill new required fields, retry save. */
const HEAL_MAX_STEPS = 30;
/** Max AI heal attempts per failed step index (absolute in the selected list). */
const HEAL_PER_STEP = 1;

function fromDbRowCompat(row) {
  if (!row) return null;
  const obj = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    obj[camel] = val;
  }
  return obj;
}

function remapBatchResults(batchResults, offset) {
  if (!Array.isArray(batchResults)) return [];
  return batchResults.map((r) => ({
    ...r,
    index: offset + Number(r.index || 0),
  }));
}

/**
 * Re-execute selected DB steps in the live executor session.
 * isReplay=true (default): runtime suppressStepPersist — do NOT append new trajectory_step
 * rows. This is not the same as writing rows with trajectory_step.is_replay=1
 * (TINYINT column; normal recorded steps are 0).
 *
 * Failure path: stop_on_fail → AI heal (once per step) → continue remaining actions.
 */
export async function replayTrajectorySteps(trajectoryId, { stepIds = [], isReplay = true } = {}) {
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

  const allResults = [];
  const healed = [];
  const healAttempts = new Map(); // absolute action index → count
  let cursor = 0;
  const total = actions.length;

  const unsubscribe = execSession.subscribeSessionEvents(runtime.sessionId, (type, payload) => {
    if (type !== 'replay_step') return;
    const batchIndex = Number(payload?.index) || 0;
    const absoluteIndex = cursor + batchIndex;
    broadcast('recording:replay_step', {
      trajectoryId: tid,
      stepId: payload?.id ?? actions[absoluteIndex - 1]?.id ?? null,
      index: absoluteIndex,
      total,
      ok: !!payload?.ok,
      action: payload?.action,
      result: payload?.result,
    });
  });

  try {
    while (cursor < total) {
      const remaining = actions.slice(cursor);
      const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', REPLAY_TIMEOUT_MS);
      execSession.forwardStdin({
        nodeUuid: runtime.executorNodeUuid,
        sessionId: runtime.sessionId,
        event: 'replay_actions',
        data: {
          actions: remaining,
          is_replay: doSuppress,
          stop_on_fail: true,
        },
      });
      const result = await doneP;
      await markConsumedActionLog(runtime);

      const batchResults = Array.isArray(result?.results) ? result.results : [];
      allResults.push(...remapBatchResults(batchResults, cursor));

      const failed = Number(result?.failed) || 0;
      if (failed === 0) {
        cursor = total;
        break;
      }

      const stoppedAt = Number(result?.stoppedAt)
        || batchResults.find((r) => !r.ok)?.index
        || batchResults.length;
      const failedAbsIndex = cursor + stoppedAt - 1; // 0-based in full actions
      const failedEntry = actions[failedAbsIndex];
      const failedRow = batchResults.find((r) => !r.ok) || batchResults[stoppedAt - 1];
      const failResult = failedRow?.result || result?.error || 'unknown';

      if (!failedEntry) {
        const err = new Error(result?.error || `${failed} steps failed`);
        err.statusCode = 500;
        err.payload = buildPayload(tid, doSuppress, rows, allResults, healed, err.message);
        throw err;
      }

      const attempts = healAttempts.get(failedAbsIndex) || 0;
      if (attempts >= HEAL_PER_STEP) {
        const msg = `AI heal exhausted for step ${failedAbsIndex + 1}: ${failedEntry.action} → ${failResult}`;
        const err = new Error(msg);
        err.statusCode = 500;
        err.payload = buildPayload(tid, doSuppress, rows, allResults, healed, msg);
        throw err;
      }
      healAttempts.set(failedAbsIndex, attempts + 1);

      const stepId = failedEntry.id ?? null;
      broadcast('recording:replay_heal', {
        trajectoryId: tid,
        stepId,
        phase: 'start',
        action: failedEntry.action,
        message: String(failResult),
      });

      const instruction = buildStepHealInstruction(failedEntry, failResult);
      try {
        await runHealStep(runtime, instruction);
        await markConsumedActionLog(runtime);
        broadcast('recording:replay_heal', {
          trajectoryId: tid,
          stepId,
          phase: 'done',
          action: failedEntry.action,
        });
        healed.push({
          stepId,
          action: failedEntry.action,
          index: failedAbsIndex + 1,
        });
        // Mark failed replay row as healed in aggregate results
        const lastFail = [...allResults].reverse().find((r) => !r.ok);
        if (lastFail) {
          lastFail.healed = true;
          lastFail.ok = true;
          lastFail.result = `healed-by-ai (was: ${failResult})`;
        }
        // Resume from the next action after the failed one
        cursor = failedAbsIndex + 1;
      } catch (healErr) {
        const msg = healErr?.message || String(healErr);
        broadcast('recording:replay_heal', {
          trajectoryId: tid,
          stepId,
          phase: 'error',
          action: failedEntry.action,
          message: msg,
        });
        const err = new Error(
          `AI heal failed for step ${failedAbsIndex + 1} (${failedEntry.action}): ${msg}`,
        );
        err.statusCode = 500;
        err.payload = buildPayload(tid, doSuppress, rows, allResults, healed, err.message);
        throw err;
      }
    }

    const okCount = allResults.filter((r) => r.ok).length;
    const failCount = allResults.filter((r) => !r.ok).length;
    const payload = buildPayload(tid, doSuppress, rows, allResults, healed, null);
    payload.ok = okCount;
    payload.failed = failCount;
    payload.count = allResults.length;
    if (failCount > 0) {
      const err = new Error(`${failCount}/${allResults.length} steps failed`);
      err.statusCode = 500;
      err.payload = payload;
      throw err;
    }
    return payload;
  } finally {
    try { unsubscribe?.(); } catch { /* ignore */ }
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    if (session) session.busy = false;
  }
}

function buildPayload(tid, doSuppress, rows, allResults, healed, error) {
  const okCount = allResults.filter((r) => r.ok).length;
  const failCount = allResults.filter((r) => !r.ok).length;
  return {
    trajectoryId: tid,
    isReplay: doSuppress,
    stepIds: rows.map((r) => r.id),
    count: allResults.length,
    ok: okCount,
    failed: failCount,
    error: error || null,
    healed: Array.isArray(healed) ? healed : [],
    results: allResults,
  };
}

async function runHealStep(runtime, instruction) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const unsubDone = execSession.onSessionEvent(runtime.sessionId, 'phase_done', () => {
      cleanup();
      resolve();
    });
    const unsubErr = execSession.onSessionEvent(runtime.sessionId, 'phase_error', (payload) => {
      cleanup();
      reject(new Error(payload?.message || 'phase_error'));
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout waiting for heal phase_done'));
    }, HEAL_TIMEOUT_MS);

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { unsubDone(); } catch { /* ignore */ }
      try { unsubErr(); } catch { /* ignore */ }
    }

    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'step',
      data: {
        instruction,
        max_steps: HEAL_MAX_STEPS,
        phase_number: 0,
      },
    });
  });
}
