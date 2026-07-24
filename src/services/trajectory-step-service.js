/**
 * Trajectory step CRUD + shared step/phase count refresh.
 */
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryStepDao from '../dao/trajectory-step-dao.js';
import { getDB } from '../../config/database.js';

export async function refreshTrajectoryCounts(trajectoryDbId) {
  const db = getDB();
  const [{ steps }] = await db('trajectory_step')
    .where({ trajectory_id: trajectoryDbId })
    .andWhere((qb) => {
      qb.where({ is_replay: false }).orWhereNull('is_replay');
    })
    .count('* as steps');
  const [{ phases }] = await db('trajectory_phase')
    .where({ trajectory_id: trajectoryDbId })
    .count('* as phases');
  return {
    stepCount: Number(steps) || 0,
    phaseCount: Number(phases) || 0,
  };
}

export async function confirmTrajectoryStep(stepId, confirmed) {
  return trajectoryStepDao.update(Number(stepId), {
    confirmed: !!confirmed,
    confirmedAt: confirmed ? new Date().toISOString().slice(0, 23).replace('T', ' ') : null,
  });
}

export async function createTrajectoryStep(input = {}) {
  const trajectoryId = Number(input.trajectoryId);
  if (!Number.isFinite(trajectoryId) || trajectoryId <= 0) throw new Error('trajectoryId required');
  const max = await trajectoryDao.getMaxStepNumber(trajectoryId);
  const row = await trajectoryStepDao.create({
    trajectoryId,
    stepNumber: input.stepNumber ?? (max + 1),
    phaseNumber: input.phaseNumber ?? 0,
    actionIndex: input.actionIndex ?? 0,
    actionType: input.actionType ?? input.action ?? '',
    params: input.params ?? null,
    element: input.element ?? null,
    source: input.source ?? 'manual',
    success: input.success ?? null,
    error: input.error ?? null,
    extractedContent: input.extractedContent ?? '',
    trajectoryPhaseId: input.trajectoryPhaseId ?? null,
    confirmed: !!input.confirmed,
    confirmedAt: input.confirmed ? new Date().toISOString().slice(0, 23).replace('T', ' ') : null,
  });
  await trajectoryStepDao.reorderByTrajectory(trajectoryId);
  const counts = await refreshTrajectoryCounts(trajectoryId);
  await trajectoryDao.updateMeta(trajectoryId, {
    stepCount: counts.stepCount,
    phaseCount: counts.phaseCount,
  });
  return row;
}

export async function updateTrajectoryStep(stepId, fields = {}) {
  const existing = await trajectoryStepDao.getById(Number(stepId));
  if (!existing) return null;
  const patch = { ...fields };
  delete patch.description;
  if ('confirmed' in fields) {
    patch.confirmedAt = fields.confirmed
      ? new Date().toISOString().slice(0, 23).replace('T', ' ')
      : null;
  }
  const row = await trajectoryStepDao.update(Number(stepId), patch);
  await trajectoryStepDao.reorderByTrajectory(existing.trajectoryId);
  return row;
}

export async function removeTrajectoryStep(stepId) {
  const existing = await trajectoryStepDao.getById(Number(stepId));
  if (!existing) return { removed: false };
  await trajectoryStepDao.removeById(Number(stepId));
  await trajectoryStepDao.reorderByTrajectory(existing.trajectoryId);
  const counts = await refreshTrajectoryCounts(existing.trajectoryId);
  await trajectoryDao.updateMeta(existing.trajectoryId, {
    stepCount: counts.stepCount,
    phaseCount: counts.phaseCount,
  });
  return { removed: true, trajectoryId: existing.trajectoryId };
}
