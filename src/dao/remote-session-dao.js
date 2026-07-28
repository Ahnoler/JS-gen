import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';
import { REMOTE_SESSION_OCCUPIED } from '../models/constants.js';

const TABLE = 'remote_session';

export async function create(data) {
  const [id] = await getDB()(TABLE).insert(toDbRow(data));
  return getById(id);
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

export async function getByUuid(sessionUuid) {
  const row = await getDB()(TABLE).where({ session_uuid: sessionUuid }).first();
  return fromDbRow(row);
}

/** Latest remote_session row currently bound to a trajectory (any status). */
export async function getByTrajectory(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return null;
  const row = await getDB()(TABLE)
    .where({ trajectory_id: tid })
    .orderBy('id', 'desc')
    .first();
  return fromDbRow(row);
}

/** Occupied (active|idle) row for an agent session UUID. */
export async function getOccupiedByAgentSession(agentSessionId) {
  if (!agentSessionId) return null;
  const row = await getDB()(TABLE)
    .where({ agent_session_id: String(agentSessionId) })
    .whereIn('status', [...REMOTE_SESSION_OCCUPIED])
    .orderBy('id', 'desc')
    .first();
  return fromDbRow(row);
}

export async function list({ status, page = 1, pageSize = 20 } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  let query = db(TABLE);
  if (status) query = query.where({ status });
  const [{ total }] = await query.clone().count('* as total');
  const rows = await query.clone().orderBy('created_at', 'desc').limit(pageSize).offset(offset);
  return { rows: fromDbRows(rows), total, page, pageSize };
}

export async function listByNode(nodeId, statuses = [...REMOTE_SESSION_OCCUPIED]) {
  if (nodeId == null) return [];
  const rows = await getDB()(TABLE)
    .where({ executor_node_id: Number(nodeId) })
    .whereIn('status', statuses)
    .orderBy('id', 'asc');
  return fromDbRows(rows);
}

/**
 * Idle rows with no trajectory mount.
 * @param {{ olderThanMs?: number }} [opts] when >0, filter by created_at age (coarse).
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

export async function update(id, data) {
  await getDB()(TABLE).where({ id }).update(toDbRow(data));
  return getById(id);
}

export async function markIdle(id) {
  return update(id, {
    status: 'idle',
    trajectoryId: null,
  });
}

export async function markActive(id, { trajectoryId = null } = {}) {
  const patch = { status: 'active' };
  if (trajectoryId != null) patch.trajectoryId = Number(trajectoryId);
  return update(id, patch);
}

export async function close(id, { crashed = false } = {}) {
  return update(id, {
    status: crashed ? 'crashed' : 'closed',
    closedAt: new Date(),
    trajectoryId: null,
  });
}

/** Crash all occupied sessions on a node (active|idle). */
export async function crashOccupiedOnNode(nodeId) {
  const db = getDB();
  const now = new Date();
  return db(TABLE)
    .where({ executor_node_id: Number(nodeId) })
    .whereIn('status', [...REMOTE_SESSION_OCCUPIED])
    .update({ status: 'crashed', closed_at: now, trajectory_id: null });
}

/** Crash occupied rows whose executor node is offline / missing. */
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

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
