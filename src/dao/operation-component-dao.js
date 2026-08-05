import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow } from './helpers.js';

const TABLE = 'operation_component';

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return null; }
  }
  return null;
}

function shape(row) {
  const obj = fromDbRow(row);
  if (!obj) return null;
  obj.paramSchema = parseJsonField(obj.paramSchema);
  obj.stepsJson = parseJsonField(obj.stepsJson) ?? [];
  obj.occurrenceCount = Number(obj.occurrenceCount) || 0;
  obj.confidence = obj.confidence == null ? null : Number(obj.confidence);
  return obj;
}

export async function create(data) {
  const row = toDbRow({
    name: data.name,
    key: data.key ?? null,
    description: data.description ?? null,
    grain: data.grain ?? 'phase',
    systemId: data.systemId,
    status: data.status ?? 'draft',
    paramSchema: data.paramSchema != null ? JSON.stringify(data.paramSchema) : null,
    stepsJson: JSON.stringify(data.stepsJson ?? []),
    signature: data.signature,
    sourceTrajectoryId: data.sourceTrajectoryId ?? null,
    sourcePhaseId: data.sourcePhaseId ?? null,
    occurrenceCount: data.occurrenceCount ?? 0,
    confidence: data.confidence ?? null,
  });
  const [id] = await getDB()(TABLE).insert(row);
  return getById(id);
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return shape(row);
}

export async function getBySystemAndSignature(systemId, signature) {
  const row = await getDB()(TABLE)
    .where({ system_id: systemId, signature })
    .first();
  return shape(row);
}

export async function list({
  page = 1,
  pageSize = 20,
  systemId = null,
  status = null,
  grain = null,
  q = null,
} = {}) {
  const db = getDB();
  let query = db(TABLE);
  if (systemId != null && Number.isFinite(Number(systemId))) {
    query = query.where({ system_id: Number(systemId) });
  }
  if (status) query = query.where({ status: String(status) });
  if (grain) query = query.where({ grain: String(grain) });
  if (q && String(q).trim()) {
    const kw = `%${String(q).trim()}%`;
    query = query.andWhere(function likeNameDesc() {
      this.where('name', 'like', kw).orWhere('description', 'like', kw).orWhere('key', 'like', kw);
    });
  }

  const countRow = await query.clone().count({ total: '*' }).first();
  const total = Number(countRow?.total) || 0;
  const offset = Math.max(0, (Number(page) || 1) - 1) * (Number(pageSize) || 20);
  const rows = await query
    .clone()
    .orderBy([
      { column: 'updated_at', order: 'desc' },
      { column: 'id', order: 'desc' },
    ])
    .limit(Number(pageSize) || 20)
    .offset(offset);

  return {
    rows: rows.map(shape),
    total,
    page: Number(page) || 1,
    pageSize: Number(pageSize) || 20,
  };
}

export async function update(id, fields) {
  const patch = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.key !== undefined) patch.key = fields.key;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.paramSchema !== undefined) {
    patch.param_schema = fields.paramSchema == null
      ? null
      : JSON.stringify(fields.paramSchema);
  }
  if (fields.status !== undefined) patch.status = fields.status;
  if (fields.occurrenceCount !== undefined) patch.occurrence_count = fields.occurrenceCount;
  if (fields.confidence !== undefined) patch.confidence = fields.confidence;
  if (fields.sourceTrajectoryId !== undefined) {
    patch.source_trajectory_id = fields.sourceTrajectoryId;
  }
  if (fields.sourcePhaseId !== undefined) patch.source_phase_id = fields.sourcePhaseId;
  patch.updated_at = getDB().fn.now(3);

  if (Object.keys(patch).length <= 1) return getById(id);
  await getDB()(TABLE).where({ id }).update(patch);
  return getById(id);
}

export async function setOccurrenceCount(id, count) {
  await getDB()(TABLE).where({ id }).update({
    occurrence_count: Number(count) || 0,
    updated_at: getDB().fn.now(3),
  });
  return getById(id);
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
