import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'case_data';
const ENTRY_TABLE = 'case_data_entry';

const RESERVED_KEYS = new Set(['form_snapshots', 'form_snapshot', 'task_list', '_watcher_mode']);

/** Cached positive only — never stick on false (schema may be migrated while process runs). */
let _hasTrajectoryIdCol = null;

async function hasEntryTrajectoryId(db = getDB()) {
  if (_hasTrajectoryIdCol === true) return true;
  try {
    const ok = await db.schema.hasColumn(ENTRY_TABLE, 'trajectory_id');
    if (ok) _hasTrajectoryIdCol = true;
    return ok;
  } catch {
    return false;
  }
}

function isUnknownTrajectoryIdColumn(err) {
  const msg = String(err?.message || err || '');
  return /Unknown column ['`]?trajectory_id['`]?/i.test(msg)
    || err?.code === 'ER_BAD_FIELD_ERROR';
}

/**
 * Normalize API / UI case entry payloads to { fieldKey, fieldValue }.
 * Accepts `{ fieldKey, fieldValue }` or `{ key, value }`.
 */
export function normalizeCaseEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const fieldKey = String(e.fieldKey ?? e.key ?? '').trim();
    if (!fieldKey || RESERVED_KEYS.has(fieldKey) || seen.has(fieldKey)) continue;
    seen.add(fieldKey);
    const v = e.fieldValue ?? e.value;
    out.push({
      fieldKey,
      fieldValue: v == null ? null : String(v),
    });
  }
  return out;
}

/** Flat label→value dict for Python case_data_store. */
export function entriesToFlatDict(entries) {
  const dict = {};
  for (const e of normalizeCaseEntries(entries)) {
    dict[e.fieldKey] = e.fieldValue ?? '';
  }
  return dict;
}

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
      const bindTraj = await hasEntryTrajectoryId(trx);
      const entryRows = normalizeCaseEntries(record.entries).map((e) => {
        const row = {
          case_data_id: id,
          field_key: e.fieldKey,
          field_value: e.fieldValue,
        };
        if (bindTraj) row.trajectory_id = null;
        return row;
      });
      if (entryRows.length) await trx(ENTRY_TABLE).insert(entryRows);
    }
    return id;
  });
}

export async function getByRecordId(recordId) {
  const db = getDB();
  const row = await db(TABLE).where({ record_id: recordId }).first();
  if (!row) return null;
  const entity = fromDbRow(row);
  entity.entries = fromDbRows(await db(ENTRY_TABLE)
    .where({ case_data_id: row.id })
    .orderBy('id'));
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

/**
 * Case KV bound to a trajectory. Empty = user has not configured case data
 * (also when schema lacks trajectory_id — treat as unconfigured, not fatal).
 */
export async function listEntriesByTrajectory(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return [];
  if (!(await hasEntryTrajectoryId())) return [];
  try {
    const rows = await getDB()(ENTRY_TABLE)
      .where({ trajectory_id: tid })
      .orderBy('id');
    return fromDbRows(rows);
  } catch (err) {
    if (isUnknownTrajectoryIdColumn(err)) {
      _hasTrajectoryIdCol = null; // allow re-probe after migrate
      return [];
    }
    throw err;
  }
}

/**
 * Replace all case entries bound to a trajectory (delete + insert).
 * Empty / unconfigured case data is a no-op when the column is missing
 * (treat as "no case data"), so draft save without KV still succeeds.
 * @param {number} trajectoryId
 * @param {Array} entries raw caseEntries
 * @param {import('knex').Knex.Transaction} [trx]
 */
export async function replaceEntriesForTrajectory(trajectoryId, entries, trx = null) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    throw new Error('Invalid trajectory id');
  }
  const normalized = normalizeCaseEntries(entries);
  const hasCol = await hasEntryTrajectoryId(trx || getDB());
  if (!hasCol) {
    // No schema support yet: unconfigured (empty) → default none; configured → ask migrate
    if (!normalized.length) return [];
    const err = new Error(
      'case_data_entry.trajectory_id missing — run: npx knex migrate:latest --knexfile config/knexfile.js',
    );
    err.statusCode = 503;
    throw err;
  }
  const db = trx || getDB();
  const run = async (client) => {
    await client(ENTRY_TABLE).where({ trajectory_id: tid }).del();
    if (!normalized.length) return [];
    const rows = normalized.map((e) => ({
      case_data_id: null,
      trajectory_id: tid,
      field_key: e.fieldKey,
      field_value: e.fieldValue,
    }));
    await client(ENTRY_TABLE).insert(rows);
    return fromDbRows(await client(ENTRY_TABLE).where({ trajectory_id: tid }).orderBy('id'));
  };
  if (trx) return run(db);
  return getDB().transaction((t) => run(t));
}

/** Load trajectory case entries as flat dict for agent injection. */
export async function loadFlatDictByTrajectory(trajectoryId) {
  const entries = await listEntriesByTrajectory(trajectoryId);
  return entriesToFlatDict(entries);
}
