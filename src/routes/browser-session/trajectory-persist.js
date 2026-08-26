import { existsSync } from 'fs';
import { state } from '../../state.js';
import { saveTrajectoryRecord } from '../../trajectory-store.js';
import { persistSessionTrajectory, upsertPhaseDescription } from '../../services/trajectory-service.js';
import { persistFormSnapshotsFromFile } from '../../services/business-data-service.js';
import * as execSession from '../../executor-session-client.js';
import { persistLiveActionEntries } from './persist-live.js';
import { writeAgentEvent, sessionRuntimeReady } from './agent-io.js';

/**
 * Trajectory persistence handler — saves the session's accumulated actions,
 * phase descriptions, form snapshots, and screenshots to the DB (and legacy
 * JSON store), for both executor and local shared-browser modes.
 */

/**
 * Persist a session's trajectory to the DB (and legacy JSON store).
 * @param {import('express').Request} req Express request
 * @param {import('express').Response} res Express response
 * @returns {Promise<void>}
 */
export async function persistTrajectory(req, res) {
  const { id } = req.params;
  const { task, functionId, trajectoryDbId, phaseDescriptions } = req.body || {};
  const resolvedFunctionId = functionId != null && functionId !== ''
    ? Number(functionId)
    : undefined;
  const resolvedTrajId = trajectoryDbId != null && trajectoryDbId !== ''
    ? Number(trajectoryDbId)
    : (state.sessions.get(id)?.dbTrajectoryId != null
      ? Number(state.sessions.get(id).dbTrajectoryId)
      : undefined);
  const gb = state.globalBrowser;
  const session = state.sessions.get(id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  // Merge: session-side (from each「执行阶段」) + client payload (client wins on conflict)
  const mergedPhaseDescriptions = {
    ...(session.phaseDescriptions || {}),
    ...(phaseDescriptions && typeof phaseDescriptions === 'object' ? phaseDescriptions : {}),
  };
  console.log('[save-trajectory] phaseDescriptions keys:', Object.keys(mergedPhaseDescriptions),
    'sample:', Object.fromEntries(Object.entries(mergedPhaseDescriptions).map(([k, v]) => [k, String(v).slice(0, 40)])));

  const busy = session.useExecutor ? !!session.busy : !!gb.busy;
  if (busy) return res.status(409).json({ error: 'Browser is busy executing a step' });
  if (!sessionRuntimeReady(session)) {
    return res.status(503).json({ error: 'Browser not ready' });
  }
  if (Number.isFinite(resolvedTrajId)) session.dbTrajectoryId = resolvedTrajId;

  async function finalizeSave(data) {
    console.log('[save-trajectory] Python response:', JSON.stringify(data, null, 2));
    if (!data?.success) {
      return res.status(500).json({ error: data?.message || 'Failed to save trajectory' });
    }
    const trajectoryFile = data.trajectory_file;
    const actionFile = data.action_file;
    console.log('[save-trajectory] actionFile:', actionFile, 'trajectoryFile:', trajectoryFile);

    // Prefer action_file; if only live ACTION_LOG entries exist (executor), persist those.
    const liveEntries = Array.isArray(session.lastActionLog) ? session.lastActionLog : [];
    if (!actionFile && !trajectoryFile && !liveEntries.length) {
      return res.status(500).json({ error: 'No action_file or trajectory_file from agent' });
    }

    try {
      if (!session.persistedActionIds) session.persistedActionIds = new Set();

      let flow = [];
      let jsonSteps = 0;
      try {
        if (trajectoryFile && existsSync(trajectoryFile)) {
          const jsonKey = Number.isFinite(resolvedTrajId) ? `db_${resolvedTrajId}` : id;
          const { record, flow: f } = saveTrajectoryRecord({
            trajectoryId: jsonKey,
            task: task || '',
            model: session.model,
            sourcePath: trajectoryFile,
            exploreMeta: { is_done: data.is_done, is_successful: data.is_successful },
          });
          flow = f || [];
          jsonSteps = record?.stepCount || 0;
        }
      } catch (jsonErr) {
        console.warn('[save-trajectory] legacy JSON store skipped:', jsonErr.message);
      }

      // If no action_file but we have live entries, persist them directly
      if (!actionFile && liveEntries.length) {
        await persistLiveActionEntries(session, liveEntries);
      }

      const actionCount = data.action_count
        ?? liveEntries.length
        ?? flow.filter((s) => s.type !== 'done' && !s.error).length;

      let dbId = Number.isFinite(resolvedTrajId) ? resolvedTrajId : null;
      if (actionFile || trajectoryFile) {
        dbId = await persistSessionTrajectory({
          id: Number.isFinite(resolvedTrajId) ? resolvedTrajId : undefined,
          task: task || '',
          model: session.model,
          url: data.url || '',
          isDone: data.is_done,
          isSuccessful: data.is_successful,
          actionFile: actionFile || null,
          flow,
          logFile: data.log_file || null,
          phaseDescriptions: mergedPhaseDescriptions,
          excludeActionIds: session.persistedActionIds,
          ...(Number.isFinite(resolvedFunctionId) ? { functionId: resolvedFunctionId } : {}),
        });
      } else if (dbId != null) {
        // Live entries already appended; refresh phase descriptions
        for (const [k, v] of Object.entries(mergedPhaseDescriptions)) {
          const n = Number(k);
          if (Number.isFinite(n) && v) {
            await upsertPhaseDescription(dbId, n, String(v)).catch(() => {});
          }
        }
      }
      if (dbId != null) session.dbTrajectoryId = dbId;

      let dbStepCount = null;
      try {
        const { getDB } = await import('../../../config/database.js');
        const row = await getDB()('trajectory').where({ id: dbId }).first();
        dbStepCount = row?.step_count ?? null;
        console.log(`[save-trajectory] DB trajectory id=${dbId} step_count=${dbStepCount}`);
      } catch (e) {
        console.warn('[save-trajectory] could not read back step_count:', e.message);
      }

      if (data.form_file) {
        try {
          await persistFormSnapshotsFromFile(data.form_file, { trajectoryId: dbId });
        } catch (formErr) {
          console.warn('[save-trajectory] form_snapshot DB write failed:', formErr.message);
        }
      }

      gb.lastActionLog = [];
      session.lastActionLog = [];

      return res.json({
        trajectoryDbId: dbId,
        sessionId: id,
        dbId,
        steps: dbStepCount ?? (jsonSteps || actionCount),
        actions: actionCount,
        dbStepCount,
        isSuccessful: data.is_successful ?? null,
        action_file: actionFile,
        log_file: data.log_file,
        action_count: data.action_count ?? actionCount,
        log_count: data.log_count,
        storage: 'db',
      });
    } catch (err) {
      return res.status(500).json({ error: `Trajectory save error: ${err.message}` });
    }
  }

  // Executor path: WS event instead of local stdin/stdout
  if (session.useExecutor) {
    try {
      const resultP = execSession.waitForSessionEvent(id, 'save_trajectory_result', 30000);
      writeAgentEvent(session, 'save_trajectory', {});
      const data = await resultP;
      return finalizeSave(data);
    } catch (err) {
      // Fallback: persist whatever live ACTION_LOG we already have
      if (Array.isArray(session.lastActionLog) && session.lastActionLog.length) {
        console.warn('[save-trajectory] executor save timed out; persisting live ACTION_LOG:', err.message);
        return finalizeSave({
          success: true,
          action_count: session.lastActionLog.length,
          is_done: null,
          is_successful: null,
        });
      }
      return res.status(504).json({ error: err.message || 'Timeout waiting for trajectory' });
    }
  }

  try {
    gb.stdin.write(JSON.stringify({ event: 'save_trajectory' }) + '\n');
  } catch (err) {
    return res.status(503).json({ error: `Browser not ready: ${err.message}` });
  }

  const timeout = setTimeout(() => {
    cleanupTrajListener();
    if (!res.writableEnded) res.status(504).json({ error: 'Timeout waiting for trajectory' });
  }, 30000);
  let pendingBuffer = '';

  const onStdout = async (chunk) => {
    pendingBuffer += chunk.toString();
    const lines = pendingBuffer.split('\n');
    pendingBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.event === 'save_trajectory_result') {
          clearTimeout(timeout);
          cleanupTrajListener();
          return finalizeSave(msg.data || {});
        }
      } catch {}
    }
  };

  function cleanupTrajListener() { gb.process?.stdout?.removeListener('data', onStdout); }
  gb.process.stdout.on('data', onStdout);
}
