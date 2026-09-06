/**
 * DAO for the `trajectory_phase` table — phases within a trajectory, with done-logs and special-element candidates.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';
import { parseDoneLogs } from '../models/phase-done-logs.js';
import * as trajectoryDao from './trajectory-dao.js';

const TABLE = 'trajectory_phase';

async function dirtyParent(trajectoryId, trx = null) {
  if (trajectoryId == null) return;
  await trajectoryDao.markExportDirty(trajectoryId, trx);
}

/**
 * Create a phase row and return the created entity; marks the parent trajectory export-dirty.
 * @param {object} data camelCase phase fields
 * @param {object|null} [trx] optional transaction
 * @returns {Promise<object|null>} created phase entity
 */
export async function create(data, trx = null) {
  const db = trx || getDB();
  const [id] = await db(TABLE).insert(toDbRow(data));
  await dirtyParent(data.trajectoryId, trx);
  return getById(id, trx);
}

/**
 * Fetch a single phase by id, parsing JSON columns.
 * @param {number} id 主键
 * @param {object|null} [trx] optional transaction
 * @returns {Promise<object|null>} phase entity or null when not found
 */
export async function getById(id, trx = null) {
  const db = trx || getDB();
  const row = await db(TABLE).where({ id }).first();
  return parseCandidates(row);
}

/**
 * List phases of a trajectory ordered by phase_number.
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<object[]>} phase entities
 */
export async function listByTrajectory(trajectoryId) {
  const rows = await getDB()(TABLE)
    .where({ trajectory_id: trajectoryId })
    .orderBy('phase_number');
  return rows.map(parseCandidates);
}

/**
 * List phases for multiple trajectory ids ordered by phase_number.
 * @param {number[]} ids trajectory ids
 * @returns {Promise<object[]>} phase entities
 */
export async function listByTrajectoryIds(ids) {
  const nums = [...new Set((ids || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!nums.length) return [];
  const rows = await getDB()(TABLE)
    .whereIn('trajectory_id', nums)
    .orderBy('phase_number');
  return rows.map(parseCandidates);
}

/**
 * 按轨迹 id 批量统计阶段数（一次 GROUP BY 查询替代逐轨迹 COUNT；1+N 修复）。
 * @param {Array<number|string>} trajectoryIds 轨迹 id 数组
 * @returns {Promise<Map<number, number>>} 轨迹 id → 阶段数（无阶段/未查到的 id 不在 Map 中）
 */
export async function countByTrajectoryIds(trajectoryIds) {
  const nums = [...new Set((trajectoryIds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  const counts = new Map();
  if (!nums.length) return counts;
  const rows = await getDB()(TABLE)
    .select('trajectory_id')
    .whereIn('trajectory_id', nums)
    .groupBy('trajectory_id')
    .count('* as phaseCount');
  for (const row of rows) {
    counts.set(Number(row.trajectory_id), Number(row.phaseCount) || 0);
  }
  return counts;
}

/**
 * Update a phase status; sets/clears completed_at and marks parent export-dirty.
 * @param {number} phaseId 阶段 id
 * @param {string} status target status ('completed'/'failed' set completed_at)
 * @returns {Promise<object|null>} updated phase entity
 */
export async function updateStatus(phaseId, status) {
  const existing = await getById(phaseId);
  const data = { status };
  if (status === 'completed' || status === 'failed') {
    data.completed_at = getDB().fn.now();
  } else {
    // Keep completed_at consistent for non-terminal statuses (e.g. pending/running).
    data.completed_at = null;
  }
  await getDB()(TABLE).where({ id: phaseId }).update(toDbRow(data));
  await dirtyParent(existing?.trajectoryId);
  return getById(phaseId);
}

/**
 * 将某交易下所有 running 阶段批量置为指定状态。
 * 用于结束录制/释放资源时清理「AI 录制中」信号（running → completed/failed/pending）。
 * @param {number} trajectoryId 轨迹 id
 * @param {string} status target status
 * @returns {Promise<{ n: number }|undefined>} count of phases now in target status
 */
export async function updateRunningStatus(trajectoryId, status) {
  const db = getDB();
  const data = { status };
  if (status === 'completed' || status === 'failed') {
    data.completed_at = db.fn.now();
  } else {
    data.completed_at = null;
  }
  await db(TABLE)
    .where({ trajectory_id: trajectoryId, status: 'running' })
    .update(toDbRow(data));
  await dirtyParent(trajectoryId);
  return getDB()(TABLE)
    .where({ trajectory_id: trajectoryId, status })
    .count('* as n')
    .first();
}

function parseCandidates(row) {
  const obj = fromDbRow(row);
  if (!obj) return null;
  const raw = obj.specialElementCandidatesJson;
  if (raw != null && typeof raw === 'string') {
    try {
      obj.specialElementCandidatesJson = JSON.parse(raw);
    } catch {
      /* keep string */
    }
  }
  obj.doneLogs = parseDoneLogs(obj.doneLogs);
  return obj;
}

/**
 * Update a phase by id (JSON-aware for specialElementCandidatesJson/doneLogs) and return the updated entity.
 * @param {number} phaseId 阶段 id
 * @param {object} fields partial camelCase phase fields
 * @param {object|null} [trx] optional transaction
 * @returns {Promise<object|null>} updated phase entity
 */
export async function update(phaseId, fields, trx = null) {
  const db = trx || getDB();
  const existing = await getById(phaseId, trx);
  const patch = toDbRow({ ...fields });
  delete patch.id;
  if ('specialElementCandidatesJson' in fields || 'special_element_candidates_json' in fields) {
    const raw = fields.specialElementCandidatesJson
      ?? fields.special_element_candidates_json
      ?? null;
    patch.special_element_candidates_json = raw == null || typeof raw === 'string'
      ? raw
      : JSON.stringify(raw);
    delete patch.specialElementCandidatesJson;
  }
  if ('doneLogs' in fields || 'done_logs' in fields) {
    const raw = fields.doneLogs ?? fields.done_logs ?? null;
    patch.done_logs = raw == null || typeof raw === 'string'
      ? raw
      : JSON.stringify(raw);
    delete patch.doneLogs;
  }
  if (!Object.keys(patch).length) return getById(phaseId, trx);
  await db(TABLE).where({ id: phaseId }).update(patch);
  const trajectoryId = fields.trajectoryId ?? existing?.trajectoryId;
  await dirtyParent(trajectoryId, trx);
  return getById(phaseId, trx);
}
