/**
 * Re-execute selected DB steps in a live executor session.
 */
import { getDB } from '../../config/database.js';
import * as execSession from '../executor-session-client.js';
import { state } from '../state.js';
import {
  getTrajectoryRuntime,
  markConsumedActionLog,
} from './trajectory-runtime.js';

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
 * Re-execute selected DB steps in the live executor session.
 * isReplay=true (default): runtime suppressStepPersist — do NOT append new trajectory_step
 * rows. This is not the same as writing rows with trajectory_step.is_replay=1
 * (TINYINT column; normal recorded steps are 0).
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
