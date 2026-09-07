/**
 * Operation component CRUD: create from phase, list, patch, confirm, deprecate, delete.
 * Does not write trajectory_phase.component_id (reserved for later phases).
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow } from '../dao/helpers.js';
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
 * @param {number} nodeId starting node id
 * @returns {Promise<number|null>} ancestor system id, or null if not under a system
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
 * @param {object} trajectory trajectory row (with functionId/function_id)
 * @returns {Promise<number|null>} ancestor system id, or null
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
    stepNumber: step.stepNumber,
  };
}

/**
 * Load and normalize steps for a phase.
 * @param {number} phaseId phase id
 * @returns {Promise<object[]>} parsed step rows
 */
export async function loadPhaseSteps(phaseId) {
  const steps = await trajectoryStepDao.listByPhase(phaseId);
  return steps.map(parseStepParams);
}

/**
 * Recompute occurrence_count for a component from the occurrences table.
 * @param {number} componentId component id
 * @returns {Promise<object>} updated component row
 */
export async function refreshOccurrenceCount(componentId) {
  const n = await occurrenceDao.countByComponent(componentId);
  return componentDao.setOccurrenceCount(componentId, n);
}

/**
 * List operation components with optional filter (system/module/function/status/keyword/time).
 * @param {object} [query] filter + pagination options
 * @returns {Promise<{ rows: object[], total: number, page: number, pageSize: number }>} paged component list
 */
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

/**
 * Get a single component by id, enriched with its occurrences.
 * @param {number} id component id
 * @returns {Promise<object>} component row with occurrences[]
 */
export async function getComponent(id) {
  const row = await componentDao.getById(id);
  if (!row) throw svcError('Operation component not found', 404);
  const occurrences = await occurrenceDao.listByComponentWithPhaseMeta(row.id);
  return { ...row, occurrences };
}

/**
 * Manual create from trajectoryPhaseId or raw steps.
 * @param {object} [body] create payload (trajectoryPhaseId or steps[] + systemId)
 * @returns {Promise<object>} created (or existing) component with occurrences
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

/**
 * Patch editable fields (name/key/description/paramSchema); stepsJson/signature are immutable.
 * @param {number} id component id
 * @param {object} [body] fields to patch
 * @returns {Promise<object>} updated component with occurrences
 */
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

/**
 * Transition a draft component to confirmed status.
 * @param {number} id component id
 * @returns {Promise<object>} confirmed component with occurrences
 */
export async function confirmComponent(id) {
  const row = await componentDao.getById(id);
  if (!row) throw svcError('Operation component not found', 404);
  if (row.status !== 'draft') {
    throw svcError(`Cannot confirm from status=${row.status}`, 409);
  }
  await componentDao.update(row.id, { status: 'confirmed' });
  return getComponent(row.id);
}

/**
 * Transition a component to deprecated status.
 * @param {number} id component id
 * @returns {Promise<object>} deprecated component with occurrences
 */
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

/**
 * Delete a draft component (non-draft must use deprecate).
 * @param {number} id component id
 * @returns {Promise<{ status: string, id: number }>} deletion result
 */
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
 * @param {number} systemId system node id
 * @returns {Promise<number[]>} function ids under the system
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

const AUTH_COMPONENT_TYPES = new Set(['login', 'logout']);

const AUTH_FILL_ACTIONS = new Set([
  'fill_form_field',
  'fill_input',
  'type_text',
  'input_text',
  // Composite one-shot login action (form_action_engines LoginEngine.login):
  // params carry username/password values directly, so the scan below hits
  // them the same way as per-field fills; replay resolves via placeholders.
  'login',
]);

const AUTH_USERNAME_PLACEHOLDER = '__AUTH_USERNAME__';
const AUTH_PASSWORD_PLACEHOLDER = '__AUTH_PASSWORD__';

/**
 * Recursively replace exact-match string values inside a params structure.
 * @param {unknown} value params value (object / array / primitive)
 * @param {Map<string, string>} replacements exact string value → replacement map
 * @returns {unknown} deep-copied structure with replacements applied
 */
function deepReplaceStringValues(value, replacements) {
  if (typeof value === 'string') {
    return replacements.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepReplaceStringValues(item, replacements));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepReplaceStringValues(v, replacements);
    }
    return out;
  }
  return value;
}

/**
 * Recursively replace placeholder strings with current credentials.
 * @param {unknown} value params value (object / array / primitive)
 * @param {Map<string, string>} replacements placeholder → credential map
 * @returns {unknown} deep-copied structure with placeholders resolved
 */
function deepResolvePlaceholders(value, replacements) {
  if (typeof value === 'string') {
    let out = value;
    for (const [needle, replacement] of replacements) {
      if (out.includes(needle)) out = out.split(needle).join(replacement);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepResolvePlaceholders(item, replacements));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepResolvePlaceholders(v, replacements);
    }
    return out;
  }
  return value;
}

/**
 * Register a login/logout auth component from a recorded trajectory: snapshot all steps
 * with credentials masked by placeholders and mark the injection step numbers.
 * Deprecates previous active auth components of the same (systemId, componentType).
 * @param {object} payload registration payload
 * @param {number} payload.systemId system node id
 * @param {string} payload.componentType 'login' or 'logout'
 * @param {number} payload.trajectoryId source trajectory id
 * @param {number|null} [payload.accountId] associated system account id (unused in snapshot)
 * @param {string} payload.account username as typed during recording
 * @param {string} payload.password password as typed during recording
 * @returns {Promise<{ componentId: number }>} created component id
 */
export async function registerAuthComponent({
  systemId,
  componentType,
  trajectoryId,
  accountId,
  account,
  password,
}) {
  if (!AUTH_COMPONENT_TYPES.has(componentType)) {
    throw svcError(`componentType must be 'login' or 'logout', got=${componentType}`, 400);
  }
  if (!account || !password) {
    throw svcError('account and password are required', 400);
  }
  const sid = Number(systemId);
  const tid = Number(trajectoryId);
  if (!Number.isFinite(sid) || !Number.isFinite(tid)) {
    throw svcError('systemId and trajectoryId must be numbers', 400);
  }

  const rawSteps = await trajectoryStepDao.listByTrajectory(tid);
  if (!rawSteps.length) {
    throw svcError(`Trajectory ${tid} has no steps`, 400);
  }
  const steps = rawSteps.map(parseStepParams);

  const isLogout = componentType === 'logout';
  let usernameStepNumber = null;
  let passwordStepNumber = null;
  // Logout has no credential fields — skip injection-point location entirely
  // (a logout trajectory contains no fill/login steps carrying the account /
  // password, so the scan would always reject it, observed on job #10).
  if (!isLogout) {
    for (const step of steps) {
      const actionType = String(step.actionType || '').trim();
      if (!AUTH_FILL_ACTIONS.has(actionType)) continue;
      const params = step.params && typeof step.params === 'object' ? step.params : {};
      for (const value of Object.values(params)) {
        if (typeof value !== 'string') continue;
        // Placeholder forms count too: re-registration from an already-masked
        // trajectory (step params hold __AUTH_USERNAME__/__AUTH_PASSWORD__)
        // must still resolve the injection points.
        if (usernameStepNumber == null && (value === account || value === AUTH_USERNAME_PLACEHOLDER)) {
          usernameStepNumber = Number(step.stepNumber);
        }
        if (passwordStepNumber == null && (value === password || value === AUTH_PASSWORD_PLACEHOLDER)) {
          passwordStepNumber = Number(step.stepNumber);
        }
      }
    }
  }
  if (!isLogout && (usernameStepNumber == null || passwordStepNumber == null)) {
    throw svcError(
      `Cannot locate credential injection points in trajectory ${tid}`
      + ` (usernameStepNumber=${usernameStepNumber}, passwordStepNumber=${passwordStepNumber})`,
      400,
    );
  }

  const snapshot = stepsToSnapshot(steps).map((item) => ({
    ...item,
    // Mask credentials in the snapshot. Login keeps the account placeholder in
    // params (runtime injection re-substitutes it); logout only masks the
    // password — its account string is the avatar click-target text shown in
    // the UI (masking it displayed a raw __AUTH_USERNAME__ token) while
    // elementJson keeps the real text anyway.
    params: item.params
      ? deepReplaceStringValues(item.params, isLogout
        ? new Map([[password, AUTH_PASSWORD_PLACEHOLDER]])
        : new Map([
          [account, AUTH_USERNAME_PLACEHOLDER],
          [password, AUTH_PASSWORD_PLACEHOLDER],
        ]))
      : item.params,
  }));
  const signature = computePhaseSignature(steps).signature;

  // Source phase for the 来源阶段/出现次数 UI (occurrence provenance).
  const phaseRow = await db('trajectory_phase')
    .where({ trajectory_id: tid, phase_number: 1 })
    .first();

  const db = getDB();
  await db('operation_component')
    .where({ system_id: sid, component_type: componentType })
    .whereNot('status', 'deprecated')
    .update({ status: 'deprecated', updated_at: db.fn.now(3) });

  // Re-registering a structurally identical trajectory collides with
  // uk_oc_system_signature against the just-deprecated row; drop it.
  await db('operation_component')
    .where({ system_id: sid, component_type: componentType, status: 'deprecated', signature })
    .del();

  const [componentId] = await db('operation_component').insert(toDbRow({
    name: componentType === 'login' ? '登录组件' : '登出组件',
    grain: 'phase',
    systemId: sid,
    componentType,
    status: 'confirmed',
    paramSchema: isLogout ? {} : { usernameStepNumber, passwordStepNumber },
    stepsJson: JSON.stringify(snapshot),
    signature,
    sourceTrajectoryId: tid,
    sourcePhaseId: phaseRow?.id ?? null,
    occurrenceCount: 0,
  }));

  if (phaseRow?.id) {
    await occurrenceDao.create({
      componentId,
      trajectoryId: tid,
      trajectoryPhaseId: phaseRow.id,
      similarity: 1,
    });
    await refreshOccurrenceCount(componentId);
  }

  return { componentId };
}

/**
 * Find the latest active (non-deprecated) auth component for a system and type.
 * @param {number} systemId system node id
 * @param {string} componentType 'login' or 'logout'
 * @returns {Promise<object|null>} component row (parsed paramSchema/stepsJson) or null
 */
export async function findActiveAuthComponent(systemId, componentType) {
  const row = await getDB()('operation_component')
    .where({
      system_id: Number(systemId),
      component_type: componentType,
    })
    .whereNot('status', 'deprecated')
    .orderBy([{ column: 'id', order: 'desc' }])
    .first();
  if (!row) return null;
  const obj = fromDbRow(row);
  obj.paramSchema = typeof obj.paramSchema === 'string'
    ? JSON.parse(obj.paramSchema)
    : obj.paramSchema;
  obj.stepsJson = typeof obj.stepsJson === 'string'
    ? JSON.parse(obj.stepsJson)
    : (obj.stepsJson ?? []);
  return obj;
}

/**
 * Resolve a stored auth component into replay actions with current credentials
 * substituted for the placeholders.
 * @param {object} component auth component row (stepsJson snapshot with placeholders)
 * @param {object} creds current credentials
 * @param {string} creds.account username to inject at the username step
 * @param {string} creds.password password to inject at the password step
 * @returns {Array<{ action: string, params: object|null }>} replay action list
 */
export function resolveAuthComponentSteps(component, { account, password }) {
  const replacements = new Map([
    [AUTH_USERNAME_PLACEHOLDER, String(account ?? '')],
    [AUTH_PASSWORD_PLACEHOLDER, String(password ?? '')],
  ]);
  const snapshot = Array.isArray(component?.stepsJson) ? component.stepsJson : [];
  return snapshot.map((item) => ({
    action: String(item.actionType ?? item.action ?? '').trim(),
    params: item.params && typeof item.params === 'object'
      ? deepResolvePlaceholders(item.params, replacements)
      : item.params,
  }));
}
