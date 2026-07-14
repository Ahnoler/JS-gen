import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as functionDefDao from '../dao/function-def-dao.js';
import { stepFromActionLog } from '../models/helpers.js';

/**
 * Build trajectory_step rows from action_{ts}.json commands (canonical _STEP_LOG source).
 * Falls back to flow extracted from traj history when action file is missing.
 */
export function buildStepsFromActionFile(actionFilePath, { source = 'agent' } = {}) {
  if (!actionFilePath || !existsSync(actionFilePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(actionFilePath, 'utf-8'));
    const commands = raw?.tests?.[0]?.commands || raw?.commands || [];
    return commands.map((cmd, i) => stepFromActionLog(cmd, {
      stepNumber: i + 1,
      phaseNumber: cmd.phase ?? cmd.phaseNumber ?? 0,
      source: cmd.source || source,
    }));
  } catch (err) {
    console.warn('[trajectory-service] Failed to parse action file:', err.message);
    return [];
  }
}

/**
 * Build steps from Dashboard flow entries (traj-derived, secondary fallback).
 */
export function buildStepsFromFlow(flow, { source = 'agent' } = {}) {
  if (!Array.isArray(flow)) return [];
  return flow
    .filter((s) => s.type && s.type !== 'done')
    .map((s, i) => ({
      stepNumber: s.stepNumber || i + 1,
      phaseNumber: s.phaseNumber ?? 0,
      actionIndex: s.actionIndex ?? 0,
      actionType: s.type,
      description: s.description || '',
      params: s.params || null,
      element: s.element || null,
      success: s.success ?? null,
      error: s.error || null,
      extractedContent: s.extractedContent || '',
      source,
    }));
}

/**
 * Group consecutive steps by phaseNumber into TrajectoryPhase create payloads.
 */
function buildPhasesFromSteps(steps) {
  const phaseMap = new Map();
  for (const s of steps) {
    const n = s.phaseNumber || 0;
    if (!phaseMap.has(n)) {
      phaseMap.set(n, {
        phaseId: randomUUID(),
        phaseNumber: n || 1,
        description: '',
        status: 'completed',
      });
    }
  }
  return [...phaseMap.values()].sort((a, b) => a.phaseNumber - b.phaseNumber);
}

/**
 * Persist trajectory metadata + steps (+ phases) to MySQL.
 * Prefer action file as step source; fall back to flow from traj.
 */
export async function persistSessionTrajectory({
  trajectoryId,
  task,
  model,
  url,
  isDone,
  isSuccessful,
  actionFile,
  flow,
  remoteSessionId,
  functionName,
}) {
  let steps = buildStepsFromActionFile(actionFile, { source: 'agent' });
  if (!steps.length) {
    steps = buildStepsFromFlow(flow, { source: 'agent' });
  }

  const phases = buildPhasesFromSteps(steps);

  const dbId = await saveFullTrajectory({
    trajectory: {
      trajectoryId,
      task: task || '',
      model: model || '',
      stepCount: steps.length || (flow?.length || 0),
      actionCount: steps.filter((s) => s.actionType !== 'done').length,
      isDone: isDone ?? null,
      isSuccessful: isSuccessful ?? null,
      url: url || '',
      steps,
      remoteSessionId: remoteSessionId || null,
    },
    phases,
    functionName,
    remoteSessionId,
  });

  return dbId;
}

/**
 * Save a full trajectory with its phases and steps.
 */
export async function saveFullTrajectory({ trajectory, phases, functionName, remoteSessionId }) {
  let functionId = null;
  if (typeof functionName === 'number') {
    functionId = functionName;
  } else {
    functionId = await functionDefDao.getDefaultFunctionId();
  }

  const trajId = await trajectoryDao.save({
    ...trajectory,
    functionId,
    remoteSessionId: remoteSessionId ?? trajectory.remoteSessionId ?? null,
  });

  if (phases?.length) {
    for (const phase of phases) {
      const phaseRow = await trajectoryPhaseDao.create({
        ...phase,
        phaseId: phase.phaseId || randomUUID(),
        trajectoryId: trajId,
        status: phase.status || 'completed',
      });
      const phaseId = typeof phaseRow === 'object' ? phaseRow.id : phaseRow;
      const phaseNumber = phase.phaseNumber;
      if (phaseId != null && phaseNumber != null) {
        const db = (await import('../../config/database.js')).getDB();
        await db('trajectory_step')
          .where({ trajectory_id: trajId, phase_number: phaseNumber })
          .update({ trajectory_phase_id: phaseId });
      }
    }
  }

  return trajId;
}

export async function getTrajectoryWithPhases(trajectoryId) {
  const traj = await trajectoryDao.getByTrajectoryId(trajectoryId);
  if (!traj) return null;
  traj.phases = await trajectoryPhaseDao.listByTrajectory(traj.id);
  return traj;
}

export async function listByFunction(functionId, pagination) {
  return trajectoryDao.listByFunction(functionId, pagination);
}
