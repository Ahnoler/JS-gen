import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'sys_dict_data';

function shape(row) {
  if (!row) return null;
  return fromDbRow(row);
}

export async function list({ dictType, status } = {}) {
  let q = getDB()(TABLE).orderBy([
    { column: 'dict_sort', order: 'asc' },
    { column: 'dict_code', order: 'asc' },
  ]);
  if (dictType != null && dictType !== '') {
    q = q.where({ dict_type: String(dictType) });
  }
  if (status != null && status !== '') {
    q = q.where({ status: String(status) });
  }
  return fromDbRows(await q);
}

export async function listByTypeActive(dictType) {
  return list({ dictType, status: '0' });
}

export async function getById(dictCode) {
  const row = await getDB()(TABLE).where({ dict_code: dictCode }).first();
  return shape(row);
}

export async function countByType(dictType) {
  const row = await getDB()(TABLE).where({ dict_type: dictType }).count({ c: '*' }).first();
  return Number(row?.c || 0);
}

export async function create(data) {
  const row = {
    dict_sort: data.dictSort ?? data.dict_sort ?? 0,
    dict_label: data.dictLabel ?? data.dict_label ?? '',
    dict_value: data.dictValue ?? data.dict_value ?? '',
    dict_type: data.dictType ?? data.dict_type ?? '',
    css_class: data.cssClass ?? data.css_class ?? null,
    list_class: data.listClass ?? data.list_class ?? null,
    is_default: data.isDefault ?? data.is_default ?? 'N',
    status: data.status ?? '0',
    remark: data.remark ?? null,
    create_by: '',
    update_by: '',
  };
  const [id] = await getDB()(TABLE).insert(row);
  return getById(id);
}

export async function update(dictCode, data) {
  const patch = {};
  if (data.dictSort !== undefined) patch.dict_sort = data.dictSort;
  if (data.dictLabel !== undefined) patch.dict_label = data.dictLabel;
  if (data.dictValue !== undefined) patch.dict_value = data.dictValue;
  if (data.dictType !== undefined) patch.dict_type = data.dictType;
  if (data.cssClass !== undefined) patch.css_class = data.cssClass;
  if (data.listClass !== undefined) patch.list_class = data.listClass;
  if (data.isDefault !== undefined) patch.is_default = data.isDefault;
  if (data.status !== undefined) patch.status = data.status;
  if (data.remark !== undefined) patch.remark = data.remark;
  if (!Object.keys(patch).length) return getById(dictCode);
  patch.update_time = getDB().fn.now();
  await getDB()(TABLE).where({ dict_code: dictCode }).update(patch);
  return getById(dictCode);
}

export async function remove(dictCode) {
  return getDB()(TABLE).where({ dict_code: dictCode }).del();
}

/** Count special_element rows referencing this dict_code. */
export async function countSpecialElementRefs(dictCode) {
  const hasTable = await getDB().schema.hasTable('special_element');
  if (!hasTable) return 0;
  const row = await getDB()('special_element')
    .where({ tag_dict_code: dictCode })
    .count({ c: '*' })
    .first();
  return Number(row?.c || 0);
}
