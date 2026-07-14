import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as functionDefDao from '../dao/function-def-dao.js';
import { getDB } from '../../config/database.js';
import { stepFromActionLog } from '../models/helpers.js';

/**
 * Build trajectory_step rows from action_{ts}.json commands (canonical _STEP_LOG source).
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
 * Convert DB trajectory_step rows to Dashboard action-flow entry shape.
 */
export function stepsToActionEntries(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => {
    const params = s.params ?? s.paramsJson ?? null;
    const element = s.element ?? s.elementJson ?? null;
    return {
      action: s.actionType || s.action || '',
      params: typeof params === 'string' ? safeJson(params) : (params || {}),
      result: s.extractedContent || s.result || '',
      phase: s.phaseNumber ?? s.phase ?? 0,
      target: element?.xpath || element?.target || '',
      cssSelector: element?.cssSelector || '',
      tagName: element?.tag || element?.tagName || '',
      attributes: element?.attributes || {},
      timestamp: s.createdAt || null,
      persisted: true,
      source: s.source || 'agent',
      stepNumber: s.stepNumber,
    };
  });
}

function safeJson(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

/**
 * Persist trajectory for a session.
 * trajectoryId SHOULD be the sessionId.
 * Same sessionId → append phases/steps; first save → create trajectory.
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

  const existing = await trajectoryDao.getByTrajectoryId(trajectoryId);

  if (existing) {
    return appendToTrajectory(existing, {
      steps,
      task,
      url,
      isDone,
      isSuccessful,
    });
  }

  const phases = buildPhasesFromSteps(steps);
  return saveFullTrajectory({
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
}

/**
 * Append new steps/phases to an existing trajectory (same session).
 */
async function appendToTrajectory(existing, { steps, task, url, isDone, isSuccessful }) {
  if (!steps.length) {
    await trajectoryDao.updateMeta(existing.id, {
      isDone: isDone ?? existing.isDone,
      isSuccessful: isSuccessful ?? existing.isSuccessful,
      ...(url ? { url } : {}),
      ...(task && task !== existing.task ? { task: `${existing.task || ''}\n---\n${task}`.slice(0, 65000) } : {}),
    });
    return existing.id;
  }

  const maxStep = await trajectoryDao.getMaxStepNumber(existing.id);
  const renumbered = steps.map((s, i) => ({
    ...s,
    stepNumber: maxStep + i + 1,
  }));

  await trajectoryDao.appendSteps(existing.id, renumbered, { stepNumberOffset: maxStep });

  const existingPhases = await trajectoryDao.getExistingPhaseNumbers(existing.id);
  const existingPhaseNums = new Set(existingPhases.map((p) => p.phase_number));
  const newPhases = buildPhasesFromSteps(renumbered).filter((p) => !existingPhaseNums.has(p.phaseNumber));

  for (const phase of newPhases) {
    const phaseRow = await trajectoryPhaseDao.create({
      ...phase,
      phaseId: phase.phaseId || randomUUID(),
      trajectoryId: existing.id,
      status: 'completed',
      description: phase.description || (task || '').slice(0, 200),
    });
    const phaseId = phaseRow?.id;
    if (phaseId != null) {
      await getDB()('trajectory_step')
        .where({ trajectory_id: existing.id, phase_number: phase.phaseNumber })
        .whereNull('trajectory_phase_id')
        .update({ trajectory_phase_id: phaseId });
    }
  }

  // Link steps whose phase already existed
  for (const ep of existingPhases) {
    await getDB()('trajectory_step')
      .where({ trajectory_id: existing.id, phase_number: ep.phase_number })
      .whereNull('trajectory_phase_id')
      .update({ trajectory_phase_id: ep.id });
  }

  const refreshed = await trajectoryDao.getByTrajectoryId(existing.trajectoryId);
  const stepCount = refreshed?.steps?.length || (existing.stepCount || 0) + renumbered.length;
  const actionCount = (refreshed?.steps || []).filter((s) => s.actionType !== 'done').length;

  await trajectoryDao.updateMeta(existing.id, {
    stepCount,
    actionCount,
    isDone: isDone ?? existing.isDone,
    isSuccessful: isSuccessful ?? existing.isSuccessful,
    ...(url ? { url } : {}),
    ...(task ? { task: existing.task ? `${existing.task}\n---\n${task}`.slice(0, 65000) : task } : {}),
  });

  return existing.id;
}

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
        await getDB()('trajectory_step')
          .where({ trajectory_id: trajId, phase_number: phaseNumber })
          .update({ trajectory_phase_id: phaseId });
      }
    }
  }

  return trajId;
}

/**
 * Merged action flow for a session: DB persisted steps + live pending entries.
 */
export async function getSessionActionFlow(sessionId, pendingEntries = []) {
  const traj = await trajectoryDao.getByTrajectoryId(sessionId);
  const persisted = traj ? stepsToActionEntries(traj.steps || []) : [];
  const pending = (pendingEntries || []).map((e) => ({ ...e, persisted: false }));
  const entries = [...persisted, ...pending];
  return {
    sessionId,
    trajectoryId: sessionId,
    persistedCount: persisted.length,
    pendingCount: pending.length,
    count: entries.length,
    entries,
    trajectory: traj
      ? {
          id: traj.id,
          stepCount: traj.stepCount,
          actionCount: traj.actionCount,
          task: traj.task,
          createdAt: traj.createdAt,
        }
      : null,
  };
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
