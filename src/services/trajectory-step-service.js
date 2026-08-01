/**
 * Trajectory step CRUD + shared step/phase count refresh.
 */
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryStepDao from '../dao/trajectory-step-dao.js';
import { getDB } from '../../config/database.js';
import {
  isSingleTargetAction,
  LOCATOR_EXEMPT_ACTIONS,
  prepareElementJson,
} from '../models/element.js';
import { normalizeActionName } from '../models/action-name.js';

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

function prepareStepElement(actionType, params, element, { requireUsable = true } = {}) {
  const action = normalizeActionName(actionType || '');
  if (LOCATOR_EXEMPT_ACTIONS.includes(action) || !isSingleTargetAction(action)) {
    if (!element) return null;
    return prepareElementJson({
      element,
      actionType: action,
      params,
      requireUsable: false,
    });
  }
  return prepareElementJson({
    element,
    actionType: action,
    params,
    requireUsable,
  });
}

export async function createTrajectoryStep(input = {}) {
  const trajectoryId = Number(input.trajectoryId);
  if (!Number.isFinite(trajectoryId) || trajectoryId <= 0) {
    const err = new Error('trajectoryId required');
    err.statusCode = 400;
    throw err;
  }
  const actionType = input.actionType ?? input.action ?? '';
  const params = input.params ?? null;
  const element = prepareStepElement(
    actionType,
    params,
    input.element ?? input.elementJson ?? null,
    { requireUsable: true },
  );
  const max = await trajectoryDao.getMaxStepNumber(trajectoryId);
  const row = await trajectoryStepDao.create({
    trajectoryId,
    stepNumber: input.stepNumber ?? (max + 1),
    phaseNumber: input.phaseNumber ?? 0,
    actionIndex: input.actionIndex ?? 0,
    actionType,
    params,
    element,
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

  const targetChanging = (
    'actionType' in fields
    || 'action' in fields
    || 'params' in fields
    || 'element' in fields
    || 'elementJson' in fields
  );

  if (targetChanging) {
    const actionType = fields.actionType ?? fields.action ?? existing.actionType ?? '';
    const params = ('params' in fields) ? fields.params : existing.params;
    const elementIn = ('element' in fields)
      ? fields.element
      : (('elementJson' in fields) ? fields.elementJson : existing.element);
    patch.actionType = actionType;
    patch.params = params;
    patch.element = prepareStepElement(actionType, params, elementIn, { requireUsable: true });
    delete patch.action;
    delete patch.elementJson;
  }

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
