import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow } from './helpers.js';

const TABLE = 'executor_node';

function toExecutorRow(data) {
  const row = toDbRow({ ...data });
  if ('labels' in row) {
    row.labels_json = row.labels == null ? null : JSON.stringify(row.labels);
    delete row.labels;
  } else if (row.labels_json != null && typeof row.labels_json === 'object') {
    row.labels_json = JSON.stringify(row.labels_json);
  }
  return row;
}

function fromExecutorRow(row) {
  if (!row) return null;
  const entity = fromDbRow(row);
  if ('labelsJson' in entity) {
    const raw = entity.labelsJson;
    entity.labels = typeof raw === 'string' ? JSON.parse(raw) : raw;
    delete entity.labelsJson;
  }
  return entity;
}

function fromExecutorRows(rows) {
  return rows.map(fromExecutorRow);
}

/**
 * @param {import('../models/entities.js').ExecutorNode} data
 */
export async function upsertByUuid(data) {
  const db = getDB();
  const nodeUuid = data.nodeUuid;
  if (!nodeUuid) throw new Error('nodeUuid is required');

  const existing = await db(TABLE).where({ node_uuid: nodeUuid }).first();
  const now = new Date();
  const patch = toExecutorRow({
    name: data.name,
    host: data.host ?? '',
    status: 'online',
    capacity: data.capacity ?? 1,
    labels: data.labels ?? null,
    agentVersion: data.agentVersion ?? '',
    lastHeartbeatAt: now,
  });

  if (existing) {
    await db(TABLE).where({ id: existing.id }).update(patch);
    return getById(existing.id);
  }

  const [id] = await db(TABLE).insert(toExecutorRow({
    ...data,
    status: 'online',
    capacity: data.capacity ?? 1,
    host: data.host ?? '',
    agentVersion: data.agentVersion ?? '',
    lastHeartbeatAt: now,
  }));
  return getById(id);
}

export async function touchHeartbeat(nodeUuid) {
  const db = getDB();
  const updated = await db(TABLE)
    .where({ node_uuid: nodeUuid })
    .update({ last_heartbeat_at: new Date() });
  return updated > 0;
}

export async function setStatus(nodeUuid, status) {
  const db = getDB();
  const updated = await db(TABLE)
    .where({ node_uuid: nodeUuid })
    .update(toDbRow({ status }));
  if (!updated) return null;
  return getByUuid(nodeUuid);
}

export async function getByUuid(nodeUuid) {
  const row = await getDB()(TABLE).where({ node_uuid: nodeUuid }).first();
  return fromExecutorRow(row);
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromExecutorRow(row);
}

/** @returns {Promise<(import('../models/entities.js').ExecutorNode & { inUse: number })[]>} */
export async function list() {
  const db = getDB();
  const rows = await db(TABLE).orderBy('created_at', 'desc');
  const nodes = fromExecutorRows(rows);

  const counts = await db('remote_session')
    .where({ status: 'active' })
    .whereNotNull('executor_node_id')
    .groupBy('executor_node_id')
    .select('executor_node_id')
    .count('* as in_use');

  const countMap = new Map(counts.map((c) => [c.executor_node_id, Number(c.in_use) || 0]));

  return nodes.map((n) => ({
    ...n,
    inUse: countMap.get(n.id) || 0,
  }));
}

/**
 * Mark nodes with stale heartbeat as offline.
 * @returns {Promise<{ nodeId: number, nodeUuid: string }[]>}
 */
export async function markStaleOffline(timeoutMs) {
  const db = getDB();
  const cutoff = new Date(Date.now() - timeoutMs);
  const rows = await db(TABLE)
    .whereNot({ status: 'offline' })
    .where(function staleWhere() {
      this.where('last_heartbeat_at', '<', cutoff).orWhereNull('last_heartbeat_at');
    })
    .select('id', 'node_uuid');

  if (!rows.length) return [];

  await db(TABLE)
    .whereIn('id', rows.map((r) => r.id))
    .update({ status: 'offline', updated_at: new Date() });

  return rows.map((r) => ({ nodeId: r.id, nodeUuid: r.node_uuid }));
}

export async function crashActiveSessions(nodeId) {
  const db = getDB();
  const now = new Date();
  return db('remote_session')
    .where({ executor_node_id: nodeId, status: 'active' })
    .update({ status: 'crashed', closed_at: now });
}
