/**
 * DAO for the `trajectory_step` table — recorded action steps within a trajectory.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';
import * as trajectoryDao from './trajectory-dao.js';

const TABLE = 'trajectory_step';

async function dirtyParent(trajectoryId, trx = null) {
  if (trajectoryId == null) return;
  await trajectoryDao.markExportDirty(trajectoryId, trx);
}

/**
 * Batch insert steps. Accepts camelCase fields including:
 * params/element (mapped to params_json/element_json) and source.
 * @param {object[]} steps array of camelCase step objects
 * @returns {Promise<void>}
 */
export async function batchSave(steps) {
  if (!steps.length) return;
  const db = getDB();
  const rows = steps.map((s) => {
    const row = toDbRow({
      trajectoryId: s.trajectoryId,
      stepNumber: s.stepNumber,
      phaseNumber: s.phaseNumber ?? 0,
      actionIndex: s.actionIndex ?? 0,
      actionType: s.actionType ?? s.action ?? '',
      success: s.success ?? null,
      error: s.error ?? null,
      extractedContent: s.extractedContent ?? s.result ?? '',
      trajectoryPhaseId: s.trajectoryPhaseId ?? null,
      source: s.source ?? 'agent',
      actionId: s.actionId ?? null,
    });
    // JSON columns: prefer already-named *_json, else serialize params/element
    row.params_json = s.paramsJson ?? s.params ?? null;
    row.element_json = s.elementJson ?? s.element ?? null;
    return row;
  });
  for (let i = 0; i < rows.length; i += 100) {
    await db(TABLE).insert(rows.slice(i, i + 100));
  }
  const trajectoryIds = [...new Set(steps.map((s) => s.trajectoryId).filter((id) => id != null))];
  for (const tid of trajectoryIds) {
    await dirtyParent(tid);
  }
}

/**
 * List steps of a trajectory ordered by step_number then action_index, optionally filtered by source.
 * @param {number} trajectoryId 轨迹 id
 * @param {object} [opts] 选项
 * @param {string} [opts.source] filter by source
 * @returns {Promise<object[]>} step entities
 */
export async function listByTrajectory(trajectoryId, { source } = {}) {
  let query = getDB()(TABLE).where({ trajectory_id: trajectoryId });
  if (source) query = query.where({ source });
  const rows = await query.orderBy(['step_number', 'action_index']);
  return fromDbRows(rows);
}

/**
 * List steps of a phase ordered by step_number.
 * @param {number} trajectoryPhaseId 阶段 id
 * @returns {Promise<object[]>} step entities
 */
export async function listByPhase(trajectoryPhaseId) {
  const rows = await getDB()(TABLE)
    .where({ trajectory_phase_id: trajectoryPhaseId })
    .orderBy('step_number');
  return fromDbRows(rows);
}

/**
 * List steps of a trajectory filtered by source.
 * @param {number} trajectoryId 轨迹 id
 * @param {string} source source filter
 * @returns {Promise<object[]>} step entities
 */
export async function listBySource(trajectoryId, source) {
  return listByTrajectory(trajectoryId, { source });
}

/**
 * Delete all steps of a trajectory and mark parent export-dirty.
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<number>} number of deleted rows
 */
export async function removeByTrajectory(trajectoryId) {
  const result = await getDB()(TABLE).where({ trajectory_id: trajectoryId }).del();
  await dirtyParent(trajectoryId);
  return result;
}

/**
 * Fetch a single step by id.
 * @param {number} id 主键
 * @returns {Promise<object|null>} step entity or null when not found
 */
export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

/**
 * Insert a single step and return the created entity.
 * @param {object} step camelCase step fields
 * @returns {Promise<object|null>} created step entity
 */
export async function create(step) {
  const row = toDbRow({
    trajectoryId: step.trajectoryId,
    stepNumber: step.stepNumber,
    phaseNumber: step.phaseNumber ?? 0,
    actionIndex: step.actionIndex ?? 0,
    actionType: step.actionType ?? step.action ?? '',
    success: step.success ?? null,
    error: step.error ?? null,
    extractedContent: step.extractedContent ?? step.result ?? '',
    trajectoryPhaseId: step.trajectoryPhaseId ?? null,
    source: step.source ?? 'manual',
    confirmed: step.confirmed !== undefined && step.confirmed !== null ? !!step.confirmed : true,
    confirmedAt: step.confirmedAt ?? null,
  });
  row.params_json = step.paramsJson ?? step.params ?? null;
  row.element_json = step.elementJson ?? step.element ?? null;
  const [id] = await getDB()(TABLE).insert(row);
  await dirtyParent(step.trajectoryId);
  return getById(id);
}

/**
 * Update a step by id (JSON-aware for params/element) and return the updated entity.
 * @param {number} id 主键
 * @param {object} fields partial camelCase step fields
 * @returns {Promise<object|null>} updated step entity
 */
export async function update(id, fields) {
  const patch = toDbRow(fields);
  // params/element are not DB columns — map to *_json
  delete patch.params;
  delete patch.element;
  // description column removed from trajectory_step
  delete patch.description;
  if ('paramsJson' in fields || 'params' in fields) {
    const raw = fields.paramsJson ?? fields.params ?? null;
    patch.params_json = raw == null || typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  if ('elementJson' in fields || 'element' in fields) {
    const raw = fields.elementJson ?? fields.element ?? null;
    patch.element_json = raw == null || typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  if (!Object.keys(patch).length) return getById(id);
  let trajectoryId = fields.trajectoryId;
  if (trajectoryId == null) {
    const cur = await getById(id);
    trajectoryId = cur?.trajectoryId;
  }
  await getDB()(TABLE).where({ id }).update(patch);
  await dirtyParent(trajectoryId);
  return getById(id);
}

/**
 * Delete a step by id and mark parent export-dirty.
 * @param {number} id 主键
 * @returns {Promise<number>} number of deleted rows
 */
export async function removeById(id) {
  const cur = await getById(id);
  const result = await getDB()(TABLE).where({ id }).del();
  await dirtyParent(cur?.trajectoryId);
  return result;
}

/**
 * Renumber steps of a trajectory sequentially (1..n) by current order and return the reordered list.
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<object[]>} reordered step entities
 */
export async function reorderByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .where({ trajectory_id: trajectoryId })
    .orderBy(['step_number', 'action_index', 'id']);
  for (let i = 0; i < rows.length; i += 1) {
    await getDB()(TABLE).where({ id: rows[i].id }).update({ step_number: i + 1 });
  }
  await dirtyParent(trajectoryId);
  return listByTrajectory(trajectoryId);
}

/**
 * Apply planned order: update phase binding + step_number for each row in one transaction.
 * @param {number} trajectoryId 轨迹 id
 * @param {Array<{ id: number, trajectoryPhaseId: number|null, phaseNumber: number, stepNumber: number }>} ordered 计划顺序
 * @returns {Promise<void>}
 */
export async function applyPlannedOrder(trajectoryId, ordered) {
  const db = getDB();
  const tid = Number(trajectoryId);
  await db.transaction(async (trx) => {
    for (const s of ordered) {
      await trx(TABLE).where({ id: s.id, trajectory_id: tid }).update({
        trajectory_phase_id: s.trajectoryPhaseId,
        phase_number: s.phaseNumber,
        step_number: s.stepNumber,
      });
    }
  });
  await dirtyParent(tid);
}

/**
 * Bind step rows to a phase-group screenshot id (only rows still unbound — no overwrite).
 * @param {number[]} stepIds step DB ids
 * @param {number} shotId phase-group screenshot id
 * @returns {Promise<number>} number of updated rows
 */
export async function updateGroupShotId(stepIds, shotId) {
  const ids = [...new Set((stepIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  const shot = Number(shotId);
  if (!ids.length || !Number.isFinite(shot) || shot <= 0) return 0;
  const db = getDB();
  const rows = await db(TABLE).select('trajectory_id').whereIn('id', ids).whereNull('group_shot_id');
  const updated = await db(TABLE)
    .whereIn('id', ids)
    .whereNull('group_shot_id')
    .update({ group_shot_id: shot });
  for (const tid of [...new Set(rows.map((r) => r.trajectory_id))]) {
    await dirtyParent(tid);
  }
  return updated;
}
