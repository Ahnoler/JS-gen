import { getDB } from '../../config/database.js';
import * as specialElementDao from '../dao/special-element-dao.js';
import * as specialElementStepDao from '../dao/special-element-step-dao.js';
import * as trajectoryPhaseDao from '../dao/trajectory-phase-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';
import * as trajectoryStepDao from '../dao/trajectory-step-dao.js';
import * as systemDao from '../dao/system-dao.js';
import { assertSpecialElementTag } from './sys-dict-service.js';
import { resolveAncestorSystemId } from './hierarchy-service.js';
import {
  searchSpecialElements,
  toDisplayCandidates,
} from './special-element-search-service.js';
import {
  getTrajectoryRuntime,
} from './trajectory-runtime.js';
import * as execSession from '../executor-session-client.js';
import { state } from '../state.js';

const SPECIAL_ELEMENT_TAG = 'special_element_tag';

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

function parseJsonMaybe(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

export function buildSearchText({ name, dictLabel, phaseDescription, remark }) {
  return [name, dictLabel, phaseDescription, remark]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ');
}

async function withSteps(element) {
  if (!element) return null;
  const steps = await specialElementStepDao.listByElement(element.id);
  return { ...element, steps };
}

/**
 * Resolve moduleId → function id list when functionId is absent.
 */
async function resolveFunctionScope(query = {}) {
  const functionId = query.functionId != null && query.functionId !== ''
    ? Number(query.functionId)
    : null;
  if (Number.isFinite(functionId) && functionId > 0) {
    return { functionId, functionIds: null };
  }
  const moduleId = query.moduleId != null && query.moduleId !== ''
    ? Number(query.moduleId)
    : null;
  if (Number.isFinite(moduleId) && moduleId > 0) {
    const fns = await systemDao.listFunctions(moduleId);
    return {
      functionId: null,
      functionIds: fns.map((f) => Number(f.id)).filter((n) => Number.isFinite(n) && n > 0),
    };
  }
  return { functionId: null, functionIds: null };
}

export async function listSpecialElements(query = {}) {
  const { functionId, functionIds } = await resolveFunctionScope(query);
  // module selected but empty → no rows
  if (
    query.moduleId != null && query.moduleId !== ''
    && !(Number.isFinite(functionId) && functionId > 0)
    && !(Array.isArray(functionIds) && functionIds.length)
  ) {
    return {
      items: [],
      total: 0,
      page: Math.max(1, Number(query.page) || 1),
      pageSize: Math.min(200, Math.max(1, Number(query.pageSize) || 20)),
    };
  }
  return specialElementDao.list({
    ...query,
    functionId,
    functionIds,
    keyword: query.keyword || query.description || null,
    stepDesc: query.stepDesc || query.step_desc || null,
    createdBy: query.createdBy || query.created_by || null,
    startTime: query.startTime || query.start_time || null,
    endTime: query.endTime || query.end_time || null,
  });
}

export async function getSpecialElement(id) {
  const row = await specialElementDao.getById(id);
  if (!row) throw httpError(404, 'Special element not found');
  return withSteps(row);
}

export async function updateSpecialElement(id, body = {}) {
  const existing = await specialElementDao.getById(id);
  if (!existing) throw httpError(404, 'Special element not found');

  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.remark !== undefined) patch.remark = String(body.remark ?? '');
  if (body.enabled !== undefined) {
    patch.enabled = body.enabled === true || body.enabled === 1 || body.enabled === '1';
  }
  if (body.functionId !== undefined) {
    const fid = body.functionId == null || body.functionId === ''
      ? null
      : Number(body.functionId);
    patch.functionId = Number.isFinite(fid) && fid > 0 ? fid : null;
  }

  let tagRow = null;
  if (body.tagDictCode !== undefined) {
    tagRow = await assertSpecialElementTag(Number(body.tagDictCode));
    patch.tagDictCode = Number(body.tagDictCode);
  }

  if (patch.name || patch.remark !== undefined || patch.tagDictCode) {
    const name = patch.name ?? existing.name;
    const remark = patch.remark !== undefined ? patch.remark : existing.remark;
    const dictLabel = tagRow?.dictLabel
      || (await assertSpecialElementTag(Number(patch.tagDictCode ?? existing.tagDictCode))).dictLabel;
    patch.searchText = buildSearchText({
      name,
      dictLabel,
      phaseDescription: existing.phaseDescription,
      remark,
    });
    if (existing.embeddingStatus === 'ready') {
      patch.embeddingStatus = 'stale';
      patch.embeddingContentHash = '';
    } else if (existing.embeddingStatus !== 'pending') {
      patch.embeddingStatus = 'pending';
    }
  }

  try {
    const updated = await specialElementDao.update(id, patch);
    return withSteps(updated);
  } catch (err) {
    if (String(err.message || '').includes('uk_special_element_sys_name')) {
      throw httpError(409, 'Special element name already exists in this system');
    }
    throw err;
  }
}

export async function deleteSpecialElement(id) {
  const existing = await specialElementDao.getById(id);
  if (!existing) throw httpError(404, 'Special element not found');
  await specialElementDao.remove(id);
  return { deleted: true, id: Number(id) };
}

/**
 * Snapshot selected trajectory steps into a special element group.
 */
export async function createFromTrajectory(body = {}) {
  const phaseId = Number(body.trajectoryPhaseId);
  const stepIds = (Array.isArray(body.stepIds) ? body.stepIds : [])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);
  const name = String(body.name || '').trim();
  const tagDictCode = Number(body.tagDictCode);
  const remark = String(body.remark || '');

  if (!Number.isFinite(phaseId) || phaseId <= 0) {
    throw httpError(400, 'trajectoryPhaseId is required');
  }
  if (!stepIds.length) throw httpError(400, 'stepIds is required');
  if (!name) throw httpError(400, 'name is required');
  if (!Number.isFinite(tagDictCode) || tagDictCode <= 0) {
    throw httpError(400, 'tagDictCode is required');
  }

  const tagRow = await assertSpecialElementTag(tagDictCode);
  const phase = await trajectoryPhaseDao.getById(phaseId);
  if (!phase) throw httpError(404, 'Trajectory phase not found');

  const traj = await trajectoryDao.getById(phase.trajectoryId);
  if (!traj) throw httpError(404, 'Trajectory not found');

  let systemId = body.systemId != null ? Number(body.systemId) : null;
  if (!Number.isFinite(systemId) || systemId <= 0) {
    systemId = traj.functionId
      ? await resolveAncestorSystemId(traj.functionId)
      : null;
  }
  if (!Number.isFinite(systemId) || systemId <= 0) {
    throw httpError(400, 'systemId could not be resolved — pass systemId explicitly');
  }

  const functionId = traj.functionId != null ? Number(traj.functionId) : null;

  const steps = [];
  for (const sid of stepIds) {
    const step = await trajectoryStepDao.getById(sid);
    if (!step) throw httpError(400, `Step not found: ${sid}`);
    if (Number(step.trajectoryId) !== Number(phase.trajectoryId)) {
      throw httpError(400, `Step ${sid} does not belong to the same trajectory`);
    }
    if (Number(step.trajectoryPhaseId) !== phaseId) {
      throw httpError(400, `Step ${sid} is not in the selected phase`);
    }
    steps.push(step);
  }

  steps.sort((a, b) => (Number(a.stepNumber) - Number(b.stepNumber))
    || (Number(a.actionIndex) - Number(b.actionIndex))
    || (Number(a.id) - Number(b.id)));

  const phaseDescription = String(phase.description || '').trim() || name;
  const searchText = buildSearchText({
    name,
    dictLabel: tagRow.dictLabel,
    phaseDescription,
    remark,
  });

  const db = getDB();
  try {
    const created = await db.transaction(async (trx) => {
      const el = await specialElementDao.create({
        name,
        phaseDescription,
        tagDictCode,
        systemId,
        functionId: Number.isFinite(functionId) && functionId > 0 ? functionId : null,
        sourceTrajectoryId: Number(traj.id),
        sourceTrajectoryPhaseId: phaseId,
        enabled: true,
        stepCount: steps.length,
        remark,
        searchText,
        embeddingStatus: 'pending',
      }, trx);

      await specialElementStepDao.batchCreate(
        steps.map((s, i) => ({
          specialElementId: el.id,
          stepNumber: i + 1,
          actionIndex: s.actionIndex ?? 0,
          actionType: s.actionType || '',
          paramsJson: parseJsonMaybe(s.paramsJson),
          elementJson: parseJsonMaybe(s.elementJson),
        })),
        trx,
      );
      return withSteps(await specialElementDao.getById(el.id, trx));
    });
    return created;
  } catch (err) {
    if (String(err.message || '').includes('uk_special_element_sys_name')) {
      throw httpError(409, 'Special element name already exists in this system');
    }
    throw err;
  }
}

export async function updateStep(stepId, body = {}) {
  const step = await specialElementStepDao.getById(stepId);
  if (!step) throw httpError(404, 'Special element step not found');
  const parent = await specialElementDao.getById(step.specialElementId);
  if (!parent) throw httpError(404, 'Special element not found');

  const updated = await specialElementStepDao.update(stepId, {
    actionType: body.actionType,
    actionIndex: body.actionIndex,
    paramsJson: body.paramsJson ?? body.params,
    elementJson: body.elementJson ?? body.element,
  });

  const parentPatch = {};
  if (parent.embeddingStatus === 'ready') {
    parentPatch.embeddingStatus = 'stale';
    parentPatch.embeddingContentHash = '';
  }
  await specialElementDao.update(parent.id, parentPatch);
  return updated;
}

export async function createStep(specialElementId, body = {}) {
  const id = Number(specialElementId);
  if (!Number.isFinite(id) || id <= 0) throw httpError(400, 'Invalid special element id');
  const parent = await specialElementDao.getById(id);
  if (!parent) throw httpError(404, 'Special element not found');

  const actionType = String(body.actionType || '').trim();
  if (!actionType) throw httpError(400, 'actionType is required');

  const current = await specialElementStepDao.listByElement(id);
  const nextNumber = current.reduce((max, s) => Math.max(max, Number(s.stepNumber) || 0), 0) + 1;

  const db = getDB();
  return db.transaction(async (trx) => {
    const created = await specialElementStepDao.batchCreate([{
      specialElementId: id,
      stepNumber: nextNumber,
      actionIndex: Number(body.actionIndex) || 0,
      actionType,
      paramsJson: body.paramsJson ?? body.params ?? null,
      elementJson: body.elementJson ?? body.element ?? null,
    }], trx);
    const parentPatch = {
      stepCount: current.length + 1,
    };
    if (parent.embeddingStatus === 'ready') {
      parentPatch.embeddingStatus = 'stale';
      parentPatch.embeddingContentHash = '';
    }
    await specialElementDao.update(id, parentPatch, trx);
    const row = created.find((s) => Number(s.specialElementId) === id);
    return row ?? created[created.length - 1];
  });
}

export async function deleteStep(stepId) {
  const step = await specialElementStepDao.getById(stepId);
  if (!step) throw httpError(404, 'Special element step not found');
  const count = await specialElementStepDao.countByElement(step.specialElementId);
  if (count <= 1) {
    throw httpError(409, 'Cannot delete the last step; delete the special element instead');
  }

  const db = getDB();
  await db.transaction(async (trx) => {
    await specialElementStepDao.remove(stepId, trx);
    const remaining = await specialElementStepDao.renumber(step.specialElementId, trx);
    await specialElementDao.update(step.specialElementId, {
      stepCount: remaining.length,
      embeddingStatus: 'stale',
      embeddingContentHash: '',
    }, trx);
  });
  return { deleted: true, id: Number(stepId) };
}

/**
 * Manual test replay of a special element into an attached trajectory session.
 */
export async function replaySpecialElement(id, {
  trajectoryId,
  persist = false,
} = {}) {
  const element = await getSpecialElement(id);
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    throw httpError(400, 'trajectoryId is required');
  }
  const runtime = getTrajectoryRuntime(tid);
  if (!runtime?.sessionId) {
    throw httpError(400, 'Trajectory is not attached — call record/prepare first');
  }
  const session = state.sessions.get(runtime.sessionId);
  if (session?.busy) {
    throw httpError(409, 'Session is busy');
  }

  const actions = (element.steps || []).map((s) => ({
    id: s.id,
    action: s.actionType,
    params: s.paramsJson || {},
    element: s.elementJson || null,
    source: persist ? 'special_element' : 'agent',
  }));
  if (!actions.length) throw httpError(400, 'Special element has no steps');

  if (session) session.busy = true;
  runtime.suppressStepPersist = !persist;
  runtime.isReplay = !persist;

  try {
    const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', 300000);
    const errP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_error', 300000)
      .then((p) => Promise.reject(new Error(p?.message || 'replay_error')));

    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'replay_actions',
      data: {
        actions,
        stop_on_fail: false,
      },
    });

    const result = await Promise.race([doneP, errP]);
    return {
      specialElementId: element.id,
      trajectoryId: tid,
      persist: !!persist,
      result: result || null,
    };
  } finally {
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    if (session) session.busy = false;
  }
}

export async function search(body = {}) {
  const systemId = Number(body.systemId);
  if (!Number.isFinite(systemId) || systemId <= 0) {
    throw httpError(400, 'systemId is required');
  }
  return searchSpecialElements({
    systemId,
    description: body.description || '',
    keyword: body.keyword || '',
    limit: body.limit ?? 10,
    includeSteps: !!body.includeSteps,
  });
}

/**
 * Best-effort attach display candidates to a phase description for a system.
 */
export async function fetchDisplayCandidatesForDescription(systemId, description, limit = 3) {
  if (!Number.isFinite(Number(systemId)) || Number(systemId) <= 0) return [];
  try {
    const found = await searchSpecialElements({
      systemId: Number(systemId),
      description: description || '',
      limit,
      includeSteps: false,
    });
    return toDisplayCandidates(found);
  } catch {
    return [];
  }
}

export { SPECIAL_ELEMENT_TAG };
