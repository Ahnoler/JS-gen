/**
 * DAO for the `remote_session` table — executor browser sessions with status, slot, and trajectory ownership.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';
import { REMOTE_SESSION_OCCUPIED } from '../models/constants.js';

const TABLE = 'remote_session';

/**
 * Insert a remote session and return the created entity.
 * @param {object} data CamelCase session fields
 * @returns {Promise<object|null>} Created session entity or null if creation failed
 */
export async function create(data) {
  const [id] = await getDB()(TABLE).insert(toDbRow(data));
  return getById(id);
}

/**
 * Fetch a single remote session by ID.
 * @param {number} id Session ID
 * @returns {Promise<object|null>} Session entity or null when not found
 */
export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

/**
 * Fetch a single remote session by session UUID.
 * @param {string} sessionUuid Session UUID
 * @returns {Promise<object|null>} Session entity or null when not found
 */
export async function getByUuid(sessionUuid) {
  const row = await getDB()(TABLE).where({ session_uuid: sessionUuid }).first();
  return fromDbRow(row);
}

/**
 * Get the latest remote_session row currently bound to a trajectory (any status).
 * @param {number} trajectoryId Trajectory ID
 * @returns {Promise<object|null>} Session entity or null when not found
 */
export async function getByTrajectory(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return null;
  const row = await getDB()(TABLE)
    .where({ trajectory_id: tid })
    .orderBy('id', 'desc')
    .first();
  return fromDbRow(row);
}

/**
 * Get all occupied (active|idle) rows for a trajectory — oldest first.
 * @param {number} trajectoryId Trajectory ID
 * @returns {Promise<Array<object>>} Occupied session entities
 */
export async function listOccupiedByTrajectory(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return [];
  const rows = await getDB()(TABLE)
    .where({ trajectory_id: tid })
    .whereIn('status', [...REMOTE_SESSION_OCCUPIED])
    .orderBy('id', 'asc');
  return fromDbRows(rows);
}

/**
 * Get occupied (active|idle) row for an agent session UUID.
 * @param {string} agentSessionId Agent session UUID
 * @returns {Promise<object|null>} Session entity or null when not found
 */
export async function getOccupiedByAgentSession(agentSessionId) {
  if (!agentSessionId) return null;
  const row = await getDB()(TABLE)
    .where({ agent_session_id: String(agentSessionId) })
    .whereIn('status', [...REMOTE_SESSION_OCCUPIED])
    .orderBy('id', 'desc')
    .first();
  return fromDbRow(row);
}

/**
 * Paginated list of remote sessions, optionally filtered by status.
 * @param {object} [opts] Optional pagination and filter parameters
 * @param {string} [opts.status] Status filter
 * @param {number} [opts.page] Page number (1-based)
 * @param {number} [opts.pageSize] Number of items per page
 * @returns {Promise<{ rows: Array<object>, total: number, page: number, pageSize: number }>} Paginated session list
 */
export async function list({ status, page = 1, pageSize = 20 } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  let query = db(TABLE);
  if (status) query = query.where({ status });
  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone().orderBy('created_at', 'desc').limit(pageSize).offset(offset);
  return { rows: fromDbRows(rows), total, page, pageSize };
}

/**
 * List occupied sessions by status set, ordered by slot_index then id.
 * @param {string[]} [statuses] Status set (defaults to active|idle)
 * @returns {Promise<Array<object>>} Session entities
 */
export async function listOccupied(statuses = [...REMOTE_SESSION_OCCUPIED]) {
  const rows = await getDB()(TABLE)
    .whereIn('status', statuses)
    .orderBy([{ column: 'slot_index', order: 'asc' }, { column: 'id', order: 'desc' }]);
  return fromDbRows(rows);
}

/**
 * List sessions on an executor node filtered by status set, ordered by id.
 * @param {number} nodeId Executor node ID
 * @param {string[]} [statuses] Status set (defaults to active|idle)
 * @returns {Promise<Array<object>>} Session entities
 */
export async function listByNode(nodeId, statuses = [...REMOTE_SESSION_OCCUPIED]) {
  if (nodeId == null) return [];
  const rows = await getDB()(TABLE)
    .where({ executor_node_id: Number(nodeId) })
    .whereIn('status', statuses)
    .orderBy('id', 'asc');
  return fromDbRows(rows);
}

/**
 * Get idle rows with no trajectory mount.
 * @param {object} [opts] Optional filter parameters
 * @param {number} [opts.olderThanMs] When >0, filter by created_at age (coarse)
 * @returns {Promise<Array<object>>} Orphan idle session entities
 */
export async function listOrphanIdle({ olderThanMs = 0 } = {}) {
  const q = getDB()(TABLE)
    .where({ status: 'idle' })
    .whereNull('trajectory_id')
    .orderBy('id', 'asc');
  if (olderThanMs > 0) {
    q.andWhere('created_at', '<', new Date(Date.now() - olderThanMs));
  }
  return fromDbRows(await q);
}

/**
 * Update a remote session by id and return the updated entity.
 * @param {number} id 主键
 * @param {object} data partial camelCase session fields
 * @returns {Promise<object|null>} updated session entity
 */
export async function update(id, data) {
  await getDB()(TABLE).where({ id }).update(toDbRow(data));
  return getById(id);
}

/**
 * Mark a session idle, optionally setting a grace window and/or overriding trajectory binding.
 * @param {number} id 主键
 * @param {object} [opts] 选项
 * @param {Date|null} [opts.graceUntil] grace window expiry
 * @param {number|null} [opts.trajectoryId] override trajectory binding (omit to keep existing)
 * @returns {Promise<object|null>} updated session entity
 */
export async function markIdle(id, { graceUntil = null, trajectoryId } = {}) {
  const patch = {
    status: 'idle',
    graceUntil: graceUntil ?? null,
  };
  // Keep existing trajectory_id unless explicitly overridden.
  if (trajectoryId !== undefined) {
    patch.trajectoryId = trajectoryId == null ? null : Number(trajectoryId);
  }
  return update(id, patch);
}

/**
 * Clear trajectory ownership and grace window for a session.
 * @param {number} id 主键
 * @returns {Promise<object|null>} updated session entity
 */
export async function clearGraceOwnership(id) {
  return update(id, {
    trajectoryId: null,
    graceUntil: null,
  });
}

/**
 * List idle sessions whose grace window has expired (still bound to a trajectory).
 * @param {object} [opts] 选项
 * @param {Date} [opts.now] cutoff timestamp
 * @returns {Promise<object[]>} grace-expired session entities
 */
export async function listGraceExpired({ now = new Date() } = {}) {
  const rows = await getDB()(TABLE)
    .where({ status: 'idle' })
    .whereNotNull('trajectory_id')
    .whereNotNull('grace_until')
    .andWhere('grace_until', '<=', now)
    .orderBy('id', 'asc');
  return fromDbRows(rows);
}

/**
 * Mark a session active; drops the grace window and optionally attaches a trajectory.
 * @param {number} id 主键
 * @param {object} [opts] 选项
 * @param {number|null} [opts.trajectoryId] trajectory to bind
 * @returns {Promise<object|null>} updated session entity
 */
export async function markActive(id, { trajectoryId = null } = {}) {
  // Owner reclaim / attach: drop stale grace window immediately
  const patch = { status: 'active', graceUntil: null };
  if (trajectoryId != null) patch.trajectoryId = Number(trajectoryId);
  return update(id, patch);
}

/**
 * Close a session (closed or crashed), clearing ownership and grace.
 * @param {number} id 主键
 * @param {object} [opts] 选项
 * @param {boolean} [opts.crashed] when true set status to 'crashed' instead of 'closed'
 * @returns {Promise<object|null>} updated session entity
 */
export async function close(id, { crashed = false } = {}) {
  return update(id, {
    status: crashed ? 'crashed' : 'closed',
    closedAt: new Date(),
    trajectoryId: null,
    graceUntil: null,
  });
}

/**
 * Crash all occupied sessions on a node (active|idle).
 * @param {number} nodeId executor node id
 * @returns {Promise<number>} number of updated rows
 */
export async function crashOccupiedOnNode(nodeId) {
  const db = getDB();
  const now = new Date();
  return db(TABLE)
    .where({ executor_node_id: Number(nodeId) })
    .whereIn('status', [...REMOTE_SESSION_OCCUPIED])
    .update({ status: 'crashed', closed_at: now, trajectory_id: null });
}

/**
 * Crash occupied rows whose executor node is offline / missing.
 * @returns {Promise<number>} number of updated rows
 */
export async function crashOccupiedOnOfflineNodes() {
  const db = getDB();
  const now = new Date();
  // Rows with no node, or node not online
  const offlineIds = await db('executor_node')
    .whereNot({ status: 'online' })
    .pluck('id');
  let n = 0;
  if (offlineIds.length) {
    n += await db(TABLE)
      .whereIn('executor_node_id', offlineIds)
      .whereIn('status', [...REMOTE_SESSION_OCCUPIED])
      .update({ status: 'crashed', closed_at: now, trajectory_id: null });
  }
  n += await db(TABLE)
    .whereNull('executor_node_id')
    .whereIn('status', [...REMOTE_SESSION_OCCUPIED])
    .update({ status: 'crashed', closed_at: now, trajectory_id: null });
  return n;
}

/**
 * Delete a remote session by id.
 * @param {number} id 主键
 * @returns {Promise<number>} number of deleted rows
 */
export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
