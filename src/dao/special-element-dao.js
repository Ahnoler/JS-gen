/**
 * DAO for the `special_element` table — reusable element templates with embedding search support.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'special_element';

function parseJsonField(val) {
  if (val == null) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function shape(row) {
  if (!row) return null;
  const obj = fromDbRow(row);
  if (obj.embeddingJson != null) obj.embeddingJson = parseJsonField(obj.embeddingJson);
  obj.enabled = obj.enabled == null ? true : !!obj.enabled;
  return obj;
}

/**
 * Fetch a single special element by id.
 * @param {number} id 主键
 * @param {object|null} [trx] optional transaction
 * @returns {Promise<object|null>} element entity or null when not found
 */
export async function getById(id, trx = null) {
  const db = trx || getDB();
  const row = await db(TABLE).where({ id }).first();
  return shape(row);
}

/**
 * Paginated list of special elements with multi-field filters and keyword search.
 * @param {object} [opts] 筛选与分页选项
 * @param {number} [opts.systemId] 系统节点 id
 * @param {number} [opts.functionId] 功能节点 id
 * @param {number[]} [opts.functionIds] alternative to functionId (whereIn)
 * @param {number} [opts.tagDictCode] 标签字典编码
 * @param {string} [opts.keyword] LIKE search across name/phase_description/remark/search_text
 * @param {string} [opts.stepDesc] LIKE search on step action_type/params_json
 * @param {string} [opts.createdBy] 创建人
 * @param {boolean|number|string} [opts.enabled] 启用状态
 * @param {string} [opts.startTime] created_at >= start
 * @param {string} [opts.endTime] created_at <= end
 * @param {number} [opts.page] 页码（1 起）
 * @param {number} [opts.pageSize] 每页条数
 * @returns {Promise<{ items: object[], total: number, page: number, pageSize: number }>} 分页结果
 */
export async function list({
  systemId,
  functionId,
  functionIds,
  tagDictCode,
  keyword,
  stepDesc,
  createdBy,
  enabled,
  startTime,
  endTime,
  page = 1,
  pageSize = 20,
} = {}) {
  const db = getDB();
  let q = db(TABLE);
  if (systemId != null && systemId !== '') q = q.where({ system_id: Number(systemId) });
  if (functionId != null && functionId !== '') {
    q = q.where({ function_id: Number(functionId) });
  } else if (Array.isArray(functionIds) && functionIds.length) {
    q = q.whereIn('function_id', functionIds.map(Number).filter((n) => Number.isFinite(n)));
  }
  if (tagDictCode != null && tagDictCode !== '') q = q.where({ tag_dict_code: Number(tagDictCode) });
  if (enabled != null && enabled !== '') {
    q = q.where({ enabled: enabled === true || enabled === '1' || enabled === 1 ? 1 : 0 });
  }
  if (keyword) {
    const kw = `%${String(keyword).trim()}%`;
    q = q.andWhere((qb) => {
      qb.where('name', 'like', kw)
        .orWhere('phase_description', 'like', kw)
        .orWhere('remark', 'like', kw)
        .orWhere('search_text', 'like', kw);
    });
  }
  if (stepDesc && String(stepDesc).trim()) {
    const kw = `%${String(stepDesc).trim()}%`;
    q = q.whereExists(function stepExists() {
      this.select(db.raw('1'))
        .from('special_element_step')
        .whereRaw('special_element_step.special_element_id = special_element.id')
        .andWhere((qb) => {
          qb.where('action_type', 'like', kw)
            .orWhereRaw('CAST(params_json AS CHAR) LIKE ?', [kw]);
        });
    });
  }
  if (createdBy && String(createdBy).trim()) {
    q = q.andWhere('created_by', 'like', `%${String(createdBy).trim()}%`);
  }
  if (startTime) {
    q = q.andWhere('created_at', '>=', `${String(startTime).slice(0, 10)} 00:00:00.000`);
  }
  if (endTime) {
    q = q.andWhere('created_at', '<=', `${String(endTime).slice(0, 10)} 23:59:59.999`);
  }

  const countRow = await q.clone().clearOrder().count({ c: '*' }).first();
  const total = Number(countRow?.c || 0);
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 20));
  const rows = await q
    .orderBy([{ column: 'updated_at', order: 'desc' }, { column: 'id', order: 'desc' }])
    .offset((p - 1) * ps)
    .limit(ps);

  return {
    items: rows.map(shape),
    total,
    page: p,
    pageSize: ps,
  };
}

/**
 * Create a new special element and return the created entity.
 * @param {object} data camelCase element fields
 * @param {object|null} [trx] optional transaction
 * @returns {Promise<object|null>} created element entity
 */
export async function create(data, trx = null) {
  const db = trx || getDB();
  const row = toDbRow({
    name: data.name,
    phaseDescription: data.phaseDescription,
    tagDictCode: data.tagDictCode,
    systemId: data.systemId,
    functionId: data.functionId ?? null,
    sourceTrajectoryId: data.sourceTrajectoryId ?? null,
    sourceTrajectoryPhaseId: data.sourceTrajectoryPhaseId ?? null,
    enabled: data.enabled == null ? true : !!data.enabled,
    stepCount: data.stepCount ?? 0,
    remark: data.remark ?? '',
    searchText: data.searchText ?? null,
    embeddingStatus: data.embeddingStatus ?? 'pending',
    embeddingModel: data.embeddingModel ?? '',
    embeddingContentHash: data.embeddingContentHash ?? '',
    createdBy: data.createdBy ?? '',
    updatedBy: data.updatedBy ?? '',
  });
  const [id] = await db(TABLE).insert(row);
  return getById(id, trx);
}

/**
 * Update a special element by id (system_id is immutable) and return the updated entity.
 * @param {number} id 主键
 * @param {object} fields partial camelCase element fields
 * @param {object|null} [trx] optional transaction
 * @returns {Promise<object|null>} updated element entity
 */
export async function update(id, fields, trx = null) {
  const db = trx || getDB();
  const patch = toDbRow(fields);
  delete patch.id;
  delete patch.system_id; // immutable
  if (!Object.keys(patch).length) return getById(id, trx);
  patch.updated_at = db.fn.now(3);
  await db(TABLE).where({ id }).update(patch);
  return getById(id, trx);
}

/**
 * Delete a special element by id.
 * @param {number} id 主键
 * @param {object|null} [trx] optional transaction
 * @returns {Promise<number>} number of deleted rows
 */
export async function remove(id, trx = null) {
  const db = trx || getDB();
  return db(TABLE).where({ id }).del();
}

/**
 * Candidates for hybrid search within a system (enabled only).
 * @param {number} systemId 系统节点 id
 * @returns {Promise<object[]>} enabled element entities for the system
 */
export async function listEnabledBySystem(systemId) {
  const rows = await getDB()(TABLE)
    .where({ system_id: Number(systemId), enabled: 1 })
    .orderBy('id', 'desc');
  return rows.map(shape);
}
