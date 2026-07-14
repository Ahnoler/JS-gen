import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRows } from './helpers.js';

const TABLE = 'form_snapshot';
const TABLE_FIELD = 'snapshot_field';

export async function save(snapshot) {
  const db = getDB();
  return db.transaction(async (trx) => {
    const [id] = await trx(TABLE).insert(toDbRow({
      container: snapshot.container,
      fieldCount: snapshot.fieldCount ?? 0,
      requiredCount: snapshot.requiredCount ?? 0,
      optionalCount: snapshot.optionalCount ?? 0,
      actionIndex: snapshot.actionIndex ?? 0,
      caseDataId: snapshot.caseDataId ?? null,
      trajectoryId: snapshot.trajectoryId ?? null,
    }));
    if (snapshot.fields?.length) {
      const fieldRows = snapshot.fields.map((f) => ({
        form_snapshot_id: id,
        label: f.label,
        is_required: f.isRequired ?? f.is_required ?? false,
      }));
      await trx(TABLE_FIELD).insert(fieldRows);
    }
    return id;
  });
}

export async function listByTrajectory(trajectoryId) {
  const db = getDB();
  const rows = await db(TABLE).where({ trajectory_id: trajectoryId }).orderBy('action_index');
  const entities = fromDbRows(rows);
  for (const e of entities) {
    e.fields = fromDbRows(await db(TABLE_FIELD).where({ form_snapshot_id: e.id }).orderBy('id'));
  }
  return entities;
}

export async function listByCaseData(caseDataId) {
  const db = getDB();
  const rows = await db(TABLE).where({ case_data_id: caseDataId }).orderBy('action_index');
  const entities = fromDbRows(rows);
  for (const e of entities) {
    e.fields = fromDbRows(await db(TABLE_FIELD).where({ form_snapshot_id: e.id }).orderBy('id'));
  }
  return entities;
}
