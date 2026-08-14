/**
 * Manual recording toggle for a live trajectory session (manual_record_start/stop
 * + screenshot capture + optimistic ack). Extracted from
 * trajectory-record-lifecycle.js — move-only, no logic changes.
 */
import * as trajectoryDao from '../../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../../dao/trajectory-phase-dao.js';
import * as execSession from '../../executor-session-client.js';
import { state } from '../../state.js';
import {
  getTrajectoryRuntime,
  touchTrajectoryRuntimeActivity,
} from '../trajectory-runtime.js';
import { isAiRecordingActive } from './trajectory-status-utils.js';

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
  if (enabled && (await isAiRecordingActive(tid))) {
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

  try {
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: enabled ? 'manual_record_start' : 'manual_record_stop',
      data: {},
    });
  } catch (err) {
    const e = new Error(err?.message || 'Executor not connected');
    e.statusCode = 503;
    throw e;
  }
  // Manual recording also needs before/after capture when steps will persist
  try {
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'capture_screenshots',
      data: { enabled: !!enabled },
    });
  } catch {}
  // Short wait for ack; do not block HTTP long — agent may be mid-step.
  // On timeout, optimistically apply the requested enabled state.
  const status = await execSession.waitForSessionEvent(runtime.sessionId, 'manual_record_status', 8000)
    .catch(() => ({ enabled: !!enabled, timedOut: true }));
  runtime.manualRecording = !!status.enabled;
  // Manual activity resets idle timer
  if (runtime.manualRecording) touchTrajectoryRuntimeActivity(tid);
  return {
    trajectoryId: tid,
    enabled: !!status.enabled,
    phaseId: enabled ? (resolvedPhaseId ?? runtime.selectedPhaseId ?? null) : null,
  };
}
