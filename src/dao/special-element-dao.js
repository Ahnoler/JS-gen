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

export async function getById(id, trx = null) {
  const db = trx || getDB();
  const row = await db(TABLE).where({ id }).first();
  return shape(row);
}

export async function list({
  systemId,
  functionId,
  tagDictCode,
  keyword,
  enabled,
  page = 1,
  pageSize = 20,
} = {}) {
  const db = getDB();
  let q = db(TABLE);
  if (systemId != null && systemId !== '') q = q.where({ system_id: Number(systemId) });
  if (functionId != null && functionId !== '') q = q.where({ function_id: Number(functionId) });
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
  });
  const [id] = await db(TABLE).insert(row);
  return getById(id, trx);
}

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

export async function remove(id, trx = null) {
  const db = trx || getDB();
  return db(TABLE).where({ id }).del();
}

/** Candidates for hybrid search within a system (enabled only). */
export async function listEnabledBySystem(systemId) {
  const rows = await getDB()(TABLE)
    .where({ system_id: Number(systemId), enabled: 1 })
    .orderBy('id', 'desc');
  return rows.map(shape);
}
