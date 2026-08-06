/**
 * Operation component CRUD: create from phase, list, patch, confirm, deprecate, delete.
 * Does not write trajectory_phase.component_id (reserved for later phases).
 */
import * as componentDao from '../dao/operation-component-dao.js';
import * as occurrenceDao from '../dao/operation-component-occurrence-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as trajectoryStepDao from '../dao/trajectory-step-dao.js';
import * as systemDao from '../dao/system-dao.js';
import { NODE_TYPE } from '../models/hierarchy-constants.js';
import {
  OPERATION_COMPONENT_STATUSES,
} from '../models/constants.js';
import {
  computePhaseSignature,
  stepsToSnapshot,
} from './operation-component-signature.js';

function svcError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Walk system tree from a function/module node up to type=SYSTEM.
 * @param {number} nodeId
 * @returns {Promise<number|null>}
 */
export async function resolveSystemIdFromNode(nodeId) {
  let id = Number(nodeId);
  if (!Number.isFinite(id) || id <= 0) return null;
  for (let i = 0; i < 8; i++) {
    const node = await systemDao.getRawById(id);
    if (!node) return null;
    const type = Number(node.type);
    if (type === NODE_TYPE.SYSTEM) return Number(node.id);
    if (type === NODE_TYPE.ROOT || node.parentId == null || Number(node.parentId) === 0) {
      return null;
    }
    id = Number(node.parentId);
  }
  return null;
}

/**
 * Resolve system id for a trajectory via function_id ancestors.
 */
export async function resolveSystemIdForTrajectory(trajectory) {
  const functionId = trajectory?.functionId ?? trajectory?.function_id;
  if (functionId == null) return null;
  return resolveSystemIdFromNode(functionId);
}

function parseStepParams(step) {
  let params = step.params ?? step.paramsJson ?? null;
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch { params = null; }
  }
  let element = step.element ?? step.elementJson ?? null;
  if (typeof element === 'string') {
    try { element = JSON.parse(element); } catch { element = null; }
  }
  return {
    ...step,
    actionType: step.actionType ?? step.action ?? '',
    params,
    paramsJson: params,
    element,
    elementJson: element,
    isReplay: !!step.isReplay,
    stepNumber: step.stepNumber,
  };
}

export async function loadPhaseSteps(phaseId) {
  const steps = await trajectoryStepDao.listByPhase(phaseId);
  return steps.map(parseStepParams).filter((s) => !s.isReplay);
}

export async function refreshOccurrenceCount(componentId) {
  const n = await occurrenceDao.countByComponent(componentId);
  return componentDao.setOccurrenceCount(componentId, n);
}

export async function listComponents(query = {}) {
  const functionId = query.functionId != null && query.functionId !== ''
    ? Number(query.functionId)
    : null;
  let functionIds = null;
  if (!(Number.isFinite(functionId) && functionId > 0)
    && query.moduleId != null && query.moduleId !== '') {
    const moduleId = Number(query.moduleId);
    if (Number.isFinite(moduleId) && moduleId > 0) {
      const fns = await systemDao.listFunctions(moduleId);
      functionIds = fns.map((f) => Number(f.id)).filter((n) => Number.isFinite(n) && n > 0);
      if (!functionIds.length) {
        return {
          rows: [],
          total: 0,
          page: +query.page || 1,
          pageSize: +query.pageSize || 20,
        };
      }
    }
  }

  return componentDao.list({
    page: +query.page || 1,
    pageSize: +query.pageSize || 20,
    systemId: query.systemId != null ? +query.systemId : null,
    status: query.status || null,
    grain: query.grain || null,
    q: query.q || query.keyword || null,
    functionId: Number.isFinite(functionId) && functionId > 0 ? functionId : null,
    functionIds,
    startTime: query.startTime || query.start_time || null,
    endTime: query.endTime || query.end_time || null,
  });
}

export async function getComponent(id) {
  const row = await componentDao.getById(id);
  if (!row) throw svcError('Operation component not found', 404);
  const occurrences = await occurrenceDao.listByComponentWithPhaseMeta(row.id);
  return { ...row, occurrences };
}

/**
 * Manual create from trajectoryPhaseId or raw steps.
 */
export async function createComponent(body = {}) {
  const trajectoryPhaseId = body.trajectoryPhaseId != null
    ? Number(body.trajectoryPhaseId)
    : null;

  let systemId = body.systemId != null ? Number(body.systemId) : null;
  let stepsSnapshot = null;
  let signature = null;
  let sourceTrajectoryId = null;
  let sourcePhaseId = null;
  let name = String(body.name || '').trim();

  if (trajectoryPhaseId) {
    const phase = await trajectoryPhaseDao.getById(trajectoryPhaseId);
    if (!phase) throw svcError('Trajectory phase not found', 404);
    const traj = await trajectoryDao.getById(phase.trajectoryId);
    if (!traj) throw svcError('Trajectory not found', 404);
    systemId = systemId || await resolveSystemIdForTrajectory(traj);
    if (!systemId) throw svcError('Cannot resolve systemId for trajectory', 400);

    const steps = await loadPhaseSteps(phase.id);
    if (!steps.length) throw svcError('Phase has no steps', 400);
    stepsSnapshot = stepsToSnapshot(steps);
    signature = computePhaseSignature(steps).signature;
    sourceTrajectoryId = traj.id;
    sourcePhaseId = phase.id;
    if (!name) {
      name = String(phase.description || '').trim().slice(0, 80) || `phase-${phase.id}`;
    }
  } else if (Array.isArray(body.steps) && body.steps.length) {
    if (!systemId) throw svcError('systemId is required when creating from steps', 400);
    const normalized = body.steps.map((s, i) => parseStepParams({
      ...s,
      stepNumber: s.stepNumber ?? i + 1,
    }));
    stepsSnapshot = stepsToSnapshot(normalized);
    signature = computePhaseSignature(normalized).signature;
    if (!name) name = `component-${signature.slice(0, 8)}`;
  } else {
    throw svcError('trajectoryPhaseId or steps[] is required', 400);
  }

  const existing = await componentDao.getBySystemAndSignature(systemId, signature);
  if (existing) {
    if (sourcePhaseId) {
      await occurrenceDao.create({
        componentId: existing.id,
        trajectoryId: sourceTrajectoryId,
        trajectoryPhaseId: sourcePhaseId,
        similarity: 1,
      });
      await refreshOccurrenceCount(existing.id);
    }
    return getComponent(existing.id);
  }

  const created = await componentDao.create({
    name,
    key: body.key != null ? String(body.key).trim() || null : null,
    description: body.description != null ? String(body.description) : null,
    grain: 'phase',
    systemId,
    status: 'draft',
    paramSchema: body.paramSchema ?? null,
    stepsJson: stepsSnapshot,
    signature,
    sourceTrajectoryId,
    sourcePhaseId,
    occurrenceCount: 0,
    confidence: body.confidence ?? null,
  });

  if (sourcePhaseId && sourceTrajectoryId) {
    await occurrenceDao.create({
      componentId: created.id,
      trajectoryId: sourceTrajectoryId,
      trajectoryPhaseId: sourcePhaseId,
      similarity: 1,
    });
    await refreshOccurrenceCount(created.id);
  }

  return getComponent(created.id);
}

export async function updateComponent(id, body = {}) {
  const row = await componentDao.getById(id);
  if (!row) throw svcError('Operation component not found', 404);

  const fields = {};
  if (body.name !== undefined) {
    const n = String(body.name || '').trim();
    if (!n) throw svcError('name cannot be empty', 400);
    fields.name = n;
  }
  if (body.key !== undefined) fields.key = body.key == null ? null : String(body.key).trim() || null;
  if (body.description !== undefined) {
    fields.description = body.description == null ? null : String(body.description);
  }
  if (body.paramSchema !== undefined) fields.paramSchema = body.paramSchema;

  if (body.stepsJson !== undefined || body.signature !== undefined) {
    throw svcError('stepsJson and signature cannot be patched', 400);
  }

  await componentDao.update(row.id, fields);
  return getComponent(row.id);
}

export async function confirmComponent(id) {
  const row = await componentDao.getById(id);
  if (!row) throw svcError('Operation component not found', 404);
  if (row.status !== 'draft') {
    throw svcError(`Cannot confirm from status=${row.status}`, 409);
  }
  await componentDao.update(row.id, { status: 'confirmed' });
  return getComponent(row.id);
}

export async function deprecateComponent(id) {
  const row = await componentDao.getById(id);
  if (!row) throw svcError('Operation component not found', 404);
  if (row.status === 'deprecated') {
    throw svcError('Already deprecated', 409);
  }
  if (!OPERATION_COMPONENT_STATUSES.includes(row.status)) {
    throw svcError(`Invalid status=${row.status}`, 409);
  }
  await componentDao.update(row.id, { status: 'deprecated' });
  return getComponent(row.id);
}

export async function deleteComponent(id) {
  const row = await componentDao.getById(id);
  if (!row) throw svcError('Operation component not found', 404);
  if (row.status !== 'draft') {
    throw svcError('Only draft components can be deleted; use deprecate instead', 409);
  }
  await componentDao.remove(row.id);
  return { status: 'deleted', id: row.id };
}

/**
 * Collect function ids under a system (module → function).
 */
export async function collectFunctionIdsForSystem(systemId) {
  const modules = await systemDao.listModules(systemId);
  const ids = [];
  for (const mod of modules) {
    const fns = await systemDao.listFunctions(mod.id);
    for (const fn of fns) ids.push(Number(fn.id));
  }
  return ids;
}
