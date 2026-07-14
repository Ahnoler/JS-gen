import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'case_data';

export async function save(record) {
  const db = getDB();
  return db.transaction(async (trx) => {
    const [id] = await trx(TABLE).insert(toDbRow({
      recordId: record.recordId,
      sessionId: record.sessionId,
      model: record.model,
      description: record.description,
      keyCount: record.keyCount,
      rawJson: record.rawJson ?? null,
    }));
    if (record.entries?.length) {
      const entryRows = record.entries.map(e => ({
        case_data_id: id,
        field_key: e.fieldKey || e.key,
        field_value: e.fieldValue ?? e.value ?? null,
      }));
      await trx('case_data_entry').insert(entryRows);
    }
    return id;
  });
}

export async function getByRecordId(recordId) {
  const db = getDB();
  const row = await db(TABLE).where({ record_id: recordId }).first();
  if (!row) return null;
  const entity = fromDbRow(row);
  entity.entries = await db('case_data_entry')
    .where({ case_data_id: row.id })
    .orderBy('id');
  return entity;
}

export async function list({ page = 1, pageSize = 20 } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const [{ total }] = await db(TABLE).count('* as total');
  const rows = await db(TABLE).orderBy('created_at', 'desc').limit(pageSize).offset(offset);
  return { rows: fromDbRows(rows), total, page, pageSize };
}

export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}
