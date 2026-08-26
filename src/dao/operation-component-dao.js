/**
 * DAO for the `operation_component` table — reusable operation components with param schema and signature.
 */
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

/**
 * Create a new operation component and return the created entity.
 * @param {object} data camelCase component fields (name/signature/systemId required)
 * @returns {Promise<object|null>} created component entity
 */
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
    createdBy: data.createdBy ?? '',
  });
  const [id] = await getDB()(TABLE).insert(row);
  return getById(id);
}

/**
 * Fetch a single operation component by id.
 * @param {number} id 主键
 * @returns {Promise<object|null>} component entity or null when not found
 */
export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return shape(row);
}

/**
 * Fetch a component by (systemId, signature) unique key.
 * @param {number} systemId 系统节点 id
 * @param {string} signature component signature
 * @returns {Promise<object|null>} component entity or null when not found
 */
export async function getBySystemAndSignature(systemId, signature) {
  const row = await getDB()(TABLE)
    .where({ system_id: systemId, signature })
    .first();
  return shape(row);
}

/**
 * Paginated list of operation components with filters and function-scope matching.
 * @param {object} [opts] 筛选与分页选项
 * @param {number} [opts.page] 页码（1 起）
 * @param {number} [opts.pageSize] 每页条数
 * @param {number} [opts.systemId] 系统节点 id
 * @param {string} [opts.status] 状态过滤
 * @param {string} [opts.grain] 粒度过滤
 * @param {string} [opts.q] LIKE search across name/description/key
 * @param {number} [opts.functionId] single function scope
 * @param {number[]} [opts.functionIds] multiple function scope
 * @param {string} [opts.startTime] created_at >= start
 * @param {string} [opts.endTime] created_at <= end
 * @returns {Promise<{ rows: object[], total: number, page: number, pageSize: number }>} 分页结果
 */
export async function list({
  page = 1,
  pageSize = 20,
  systemId = null,
  status = null,
  grain = null,
  q = null,
  functionId = null,
  functionIds = null,
  startTime = null,
  endTime = null,
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
  if (startTime) {
    query = query.andWhere('created_at', '>=', `${String(startTime).slice(0, 10)} 00:00:00.000`);
  }
  if (endTime) {
    query = query.andWhere('created_at', '<=', `${String(endTime).slice(0, 10)} 23:59:59.999`);
  }

  const fnIds = Number.isFinite(Number(functionId)) && Number(functionId) > 0
    ? [Number(functionId)]
    : (Array.isArray(functionIds)
      ? functionIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)
      : []);
  if (fnIds.length) {
    // Match source trajectory OR any occurrence trajectory under the function scope
    query = query.andWhere(function functionScope() {
      this.whereIn('source_trajectory_id', function srcTraj() {
        this.select('id').from('trajectory').whereIn('function_id', fnIds);
      }).orWhereIn('id', function viaOcc() {
        this.select('operation_component_occurrence.component_id')
          .from('operation_component_occurrence')
          .innerJoin('trajectory', 'operation_component_occurrence.trajectory_id', 'trajectory.id')
          .whereIn('trajectory.function_id', fnIds);
      });
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

/**
 * Update an operation component by id and return the updated entity.
 * @param {number} id 主键
 * @param {object} fields partial camelCase component fields
 * @returns {Promise<object|null>} updated component entity
 */
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

/**
 * Set the occurrence_count for a component and return the updated entity.
 * @param {number} id 主键
 * @param {number} count new occurrence count
 * @returns {Promise<object|null>} updated component entity
 */
export async function setOccurrenceCount(id, count) {
  await getDB()(TABLE).where({ id }).update({
    occurrence_count: Number(count) || 0,
    updated_at: getDB().fn.now(3),
  });
  return getById(id);
}

/**
 * Delete an operation component by id.
 * @param {number} id 主键
 * @returns {Promise<number>} number of deleted rows
 */
export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
