import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'form_snapshot';
const TABLE_FIELD = 'snapshot_field';

function rootContainer(container) {
  return String(container || 'main').replace(/#\d+$/, '');
}

function fieldsFingerprint(fields = []) {
  return (fields || [])
    .map((f) => `${String(f.label || '').trim()}\0${f.isRequired || f.is_required ? 1 : 0}`)
    .join('\n');
}

async function attachFields(db, entities) {
  for (const e of entities) {
    e.fields = fromDbRows(await db(TABLE_FIELD).where({ form_snapshot_id: e.id }).orderBy('id'));
  }
  return entities;
}

export async function save(snapshot) {
  const db = getDB();
  return db.transaction(async (trx) => {
    const [id] = await trx(TABLE).insert(toDbRow({
      container: snapshot.container,
      fieldCount: snapshot.fieldCount ?? 0,
      requiredCount: snapshot.requiredCount ?? 0,
      optionalCount: snapshot.optionalCount ?? 0,
      actionIndex: snapshot.actionIndex ?? 0,
      triggerStepId: snapshot.triggerStepId ?? null,
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

export async function updateFields(id, {
  fieldCount,
  requiredCount,
  optionalCount,
  fields,
  actionIndex,
  container,
} = {}) {
  const db = getDB();
  const sid = Number(id);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  return db.transaction(async (trx) => {
    const patch = {};
    if (fieldCount != null) patch.field_count = fieldCount;
    if (requiredCount != null) patch.required_count = requiredCount;
    if (optionalCount != null) patch.optional_count = optionalCount;
    if (actionIndex != null) patch.action_index = actionIndex;
    if (container != null) patch.container = container;
    if (Object.keys(patch).length) {
      await trx(TABLE).where({ id: sid }).update(patch);
    }
    if (Array.isArray(fields)) {
      await trx(TABLE_FIELD).where({ form_snapshot_id: sid }).del();
      if (fields.length) {
        await trx(TABLE_FIELD).insert(fields.map((f) => ({
          form_snapshot_id: sid,
          label: f.label,
          is_required: f.isRequired ?? f.is_required ?? false,
        })));
      }
    }
    const row = await trx(TABLE).where({ id: sid }).first();
    if (!row) return null;
    const entity = fromDbRow(row);
    entity.fields = fromDbRows(await trx(TABLE_FIELD).where({ form_snapshot_id: sid }).orderBy('id'));
    return entity;
  });
}

export async function remove(id) {
  const db = getDB();
  const sid = Number(id);
  if (!Number.isFinite(sid) || sid <= 0) return 0;
  return db(TABLE).where({ id: sid }).del();
}

export async function listByTrajectory(trajectoryId) {
  const db = getDB();
  const rows = await db(TABLE).where({ trajectory_id: trajectoryId }).orderBy('action_index');
  return attachFields(db, fromDbRows(rows));
}

export async function listByCaseData(caseDataId) {
  const db = getDB();
  const rows = await db(TABLE).where({ case_data_id: caseDataId }).orderBy('action_index');
  return attachFields(db, fromDbRows(rows));
}

/**
 * Find snapshot for fingerprint dedupe: same trajectory + phase (via trigger step) + root container + fields fingerprint.
 * @returns {Promise<object|null>}
 */
export async function findForDedupe(trajectoryId, phaseId, container, fields) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return null;
  const root = rootContainer(container);
  const fp = fieldsFingerprint(fields);
  const db = getDB();

  let q = db(TABLE)
    .select('form_snapshot.*')
    .where({ 'form_snapshot.trajectory_id': tid });

  const pid = Number(phaseId);
  if (Number.isFinite(pid) && pid > 0) {
    q = q
      .leftJoin('trajectory_step as ts', 'ts.id', 'form_snapshot.trigger_step_id')
      .andWhere('ts.trajectory_phase_id', pid);
  }

  const rows = await q.orderBy('form_snapshot.id', 'desc');
  const entities = fromDbRows(rows);
  await attachFields(db, entities);
  for (const e of entities) {
    if (rootContainer(e.container) !== root) continue;
    if (fieldsFingerprint(e.fields) === fp) return e;
  }
  return null;
}

export { rootContainer, fieldsFingerprint };
