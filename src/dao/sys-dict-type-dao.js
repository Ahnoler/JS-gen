import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'sys_dict_type';

function shape(row) {
  if (!row) return null;
  return fromDbRow(row);
}

export async function list({ status } = {}) {
  let q = getDB()(TABLE).orderBy([
    { column: 'dict_id', order: 'asc' },
  ]);
  if (status != null && status !== '') {
    q = q.where({ status: String(status) });
  }
  return fromDbRows(await q);
}

export async function getById(dictId) {
  const row = await getDB()(TABLE).where({ dict_id: dictId }).first();
  return shape(row);
}

export async function getByType(dictType) {
  const row = await getDB()(TABLE).where({ dict_type: dictType }).first();
  return shape(row);
}

export async function create(data) {
  const row = {
    dict_name: data.dictName ?? data.dict_name ?? '',
    dict_type: data.dictType ?? data.dict_type ?? '',
    status: data.status ?? '0',
    remark: data.remark ?? null,
    create_by: '',
    update_by: '',
  };
  const [id] = await getDB()(TABLE).insert(row);
  return getById(id);
}

export async function update(dictId, data) {
  const patch = {};
  if (data.dictName !== undefined) patch.dict_name = data.dictName;
  if (data.dictType !== undefined) patch.dict_type = data.dictType;
  if (data.status !== undefined) patch.status = data.status;
  if (data.remark !== undefined) patch.remark = data.remark;
  if (!Object.keys(patch).length) return getById(dictId);
  patch.update_time = getDB().fn.now();
  await getDB()(TABLE).where({ dict_id: dictId }).update(patch);
  return getById(dictId);
}

export async function remove(dictId) {
  return getDB()(TABLE).where({ dict_id: dictId }).del();
}
