import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'special_element_step';

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
  obj.paramsJson = parseJsonField(obj.paramsJson);
  obj.elementJson = parseJsonField(obj.elementJson);
  return obj;
}

export async function listByElement(specialElementId, trx = null) {
  const db = trx || getDB();
  const rows = await db(TABLE)
    .where({ special_element_id: specialElementId })
    .orderBy('step_number');
  return rows.map(shape);
}

export async function getById(id, trx = null) {
  const db = trx || getDB();
  const row = await db(TABLE).where({ id }).first();
  return shape(row);
}

export async function batchCreate(steps, trx = null) {
  if (!steps?.length) return [];
  const db = trx || getDB();
  const rows = steps.map((s) => {
    const row = toDbRow({
      specialElementId: s.specialElementId,
      stepNumber: s.stepNumber,
      actionIndex: s.actionIndex ?? 0,
      actionType: s.actionType ?? '',
    });
    row.params_json = s.paramsJson ?? s.params ?? null;
    if (row.params_json != null && typeof row.params_json !== 'string') {
      row.params_json = JSON.stringify(row.params_json);
    }
    row.element_json = s.elementJson ?? s.element ?? null;
    if (row.element_json != null && typeof row.element_json !== 'string') {
      row.element_json = JSON.stringify(row.element_json);
    }
    return row;
  });
  await db(TABLE).insert(rows);
  return listByElement(steps[0].specialElementId, trx);
}

export async function update(id, fields, trx = null) {
  const db = trx || getDB();
  const patch = {};
  if (fields.actionType !== undefined) patch.action_type = fields.actionType;
  if (fields.actionIndex !== undefined) patch.action_index = fields.actionIndex;
  if (fields.stepNumber !== undefined) patch.step_number = fields.stepNumber;
  if (fields.paramsJson !== undefined || fields.params !== undefined) {
    const raw = fields.paramsJson ?? fields.params ?? null;
    patch.params_json = raw == null || typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  if (fields.elementJson !== undefined || fields.element !== undefined) {
    const raw = fields.elementJson ?? fields.element ?? null;
    patch.element_json = raw == null || typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  if (!Object.keys(patch).length) return getById(id, trx);
  patch.updated_at = db.fn.now(3);
  await db(TABLE).where({ id }).update(patch);
  return getById(id, trx);
}

export async function remove(id, trx = null) {
  const db = trx || getDB();
  return db(TABLE).where({ id }).del();
}

/** Renumber steps 1..n for an element (by current step_number, then id). */
export async function renumber(specialElementId, trx = null) {
  const db = trx || getDB();
  const rows = await db(TABLE)
    .where({ special_element_id: specialElementId })
    .orderBy(['step_number', 'id']);
  for (let i = 0; i < rows.length; i += 1) {
    const next = i + 1;
    if (Number(rows[i].step_number) !== next) {
      await db(TABLE).where({ id: rows[i].id }).update({
        step_number: next,
        updated_at: db.fn.now(3),
      });
    }
  }
  return listByElement(specialElementId, trx);
}

export async function countByElement(specialElementId, trx = null) {
  const db = trx || getDB();
  const row = await db(TABLE)
    .where({ special_element_id: specialElementId })
    .count({ c: '*' })
    .first();
  return Number(row?.c || 0);
}
