/**
 * System dictionary (dict_type / dict_data) CRUD + special-element tag assertion.
 */
import * as typeDao from '../dao/sys-dict-type-dao.js';
import * as dataDao from '../dao/sys-dict-data-dao.js';

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

/**
 * List dict types (filter/pagination via query).
 * @param {object} [query] list filters
 * @returns {Promise<Array<object>>} dict type rows
 */
export async function listTypes(query = {}) {
  return typeDao.list(query);
}

/**
 * Get a dict type by id; 404 if not found.
 * @param {number} dictId dict type id
 * @returns {Promise<object>} dict type row
 */
export async function getType(dictId) {
  const row = await typeDao.getById(dictId);
  if (!row) throw httpError(404, 'Dict type not found');
  return row;
}

/**
 * Create a dict type (unique dictType).
 * @param {object} [body] creation fields (dictType, dictName, status, remark)
 * @returns {Promise<object>} created dict type row
 */
export async function createType(body = {}) {
  const dictType = String(body.dictType || body.dict_type || '').trim();
  const dictName = String(body.dictName || body.dict_name || '').trim();
  if (!dictType || !dictName) throw httpError(400, 'dictName and dictType are required');
  const existing = await typeDao.getByType(dictType);
  if (existing) throw httpError(409, `dictType already exists: ${dictType}`);
  return typeDao.create({
    dictName,
    dictType,
    status: body.status ?? '0',
    remark: body.remark ?? null,
  });
}

/**
 * Update a dict type (checks dictType uniqueness on change).
 * @param {number} dictId dict type id
 * @param {object} [body] patch fields
 * @returns {Promise<object>} updated dict type row
 */
export async function updateType(dictId, body = {}) {
  await getType(dictId);
  if (body.dictType != null) {
    const next = String(body.dictType).trim();
    const clash = await typeDao.getByType(next);
    if (clash && Number(clash.dictId) !== Number(dictId)) {
      throw httpError(409, `dictType already exists: ${next}`);
    }
  }
  return typeDao.update(dictId, body);
}

/**
 * Delete a dict type (refuses if data rows exist).
 * @param {number} dictId dict type id
 * @returns {Promise<{ deleted: boolean, dictId: number }>} deletion result
 */
export async function deleteType(dictId) {
  const row = await getType(dictId);
  const count = await dataDao.countByType(row.dictType);
  if (count > 0) {
    throw httpError(409, 'Cannot delete dict type with existing data rows; remove or reassign data first');
  }
  await typeDao.remove(dictId);
  return { deleted: true, dictId: Number(dictId) };
}

/**
 * List dict data rows (filter by dictType/status).
 * @param {object} [query] list filters (dictType, status)
 * @returns {Promise<Array<object>>} dict data rows
 */
export async function listData(query = {}) {
  return dataDao.list({
    dictType: query.dictType ?? query.dict_type,
    status: query.status,
  });
}

/**
 * List active dict data for a dict type.
 * @param {string} dictType dict type code
 * @returns {Promise<Array<object>>} active dict data rows
 */
export async function listDataByType(dictType) {
  return dataDao.listByTypeActive(dictType);
}

/**
 * Get a dict data row by id; 404 if not found.
 * @param {number} dictCode dict data id
 * @returns {Promise<object>} dict data row
 */
export async function getData(dictCode) {
  const row = await dataDao.getById(dictCode);
  if (!row) throw httpError(404, 'Dict data not found');
  return row;
}

/**
 * Create a dict data row (validates dict type exists + active).
 * @param {object} [body] creation fields (dictType, dictLabel, dictValue, …)
 * @returns {Promise<object>} created dict data row
 */
export async function createData(body = {}) {
  const dictType = String(body.dictType || body.dict_type || '').trim();
  const dictLabel = String(body.dictLabel || body.dict_label || '').trim();
  const dictValue = String(body.dictValue || body.dict_value || '').trim();
  if (!dictType || !dictLabel || !dictValue) {
    throw httpError(400, 'dictType, dictLabel and dictValue are required');
  }
  const typeRow = await typeDao.getByType(dictType);
  if (!typeRow) throw httpError(400, `Unknown dictType: ${dictType}`);
  if (String(typeRow.status) !== '0') {
    throw httpError(400, `Dict type is disabled: ${dictType}`);
  }
  return dataDao.create({
    dictType,
    dictLabel,
    dictValue,
    dictSort: body.dictSort ?? body.dict_sort ?? 0,
    cssClass: body.cssClass ?? body.css_class,
    listClass: body.listClass ?? body.list_class,
    isDefault: body.isDefault ?? body.is_default ?? 'N',
    status: body.status ?? '0',
    remark: body.remark ?? null,
  });
}

/**
 * Update a dict data row (validates dictType on change).
 * @param {number} dictCode dict data id
 * @param {object} [body] patch fields
 * @returns {Promise<object>} updated dict data row
 */
export async function updateData(dictCode, body = {}) {
  await getData(dictCode);
  if (body.dictType != null) {
    const typeRow = await typeDao.getByType(String(body.dictType).trim());
    if (!typeRow) throw httpError(400, `Unknown dictType: ${body.dictType}`);
  }
  return dataDao.update(dictCode, body);
}

/**
 * Delete a dict data row (refuses if referenced by special elements).
 * @param {number} dictCode dict data id
 * @returns {Promise<{ deleted: boolean, dictCode: number }>} deletion result
 */
export async function deleteData(dictCode) {
  await getData(dictCode);
  const refs = await dataDao.countSpecialElementRefs(dictCode);
  if (refs > 0) {
    throw httpError(
      409,
      `Dict data is referenced by ${refs} special element(s); set status=1 instead of deleting`,
    );
  }
  await dataDao.remove(dictCode);
  return { deleted: true, dictCode: Number(dictCode) };
}

/**
 * Assert tag is usable for special_element create/update.
 * @param {number} tagDictCode dict data id (must belong to special_element_tag)
 * @returns {Promise<object>} validated dict data row
 */
export async function assertSpecialElementTag(tagDictCode) {
  const row = await dataDao.getById(tagDictCode);
  if (!row) throw httpError(400, 'tagDictCode not found');
  if (row.dictType !== 'special_element_tag') {
    throw httpError(400, 'tagDictCode must belong to dict_type=special_element_tag');
  }
  if (String(row.status) !== '0') {
    throw httpError(400, 'tagDictCode is disabled');
  }
  const typeRow = await typeDao.getByType('special_element_tag');
  if (!typeRow || String(typeRow.status) !== '0') {
    throw httpError(400, 'special_element_tag dict type is disabled');
  }
  return row;
}
