/**
 * DAO for `business_data` / `business_data_entry` — case KV data store, including trajectory-bound entries.
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'business_data';
const ENTRY_TABLE = 'business_data_entry';

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
 * @param {Array} raw raw entry payloads
 * @returns {{ fieldKey: string, fieldValue: string|null }[]} deduped entries
 */
export function normalizeBusinessEntries(raw) {  if (!Array.isArray(raw)) return [];
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

/**
 * Flat label→value dict for the Python business_data store.
 * @param {Array} entries raw entry payloads
 * @returns {Record<string, string>} flat dict keyed by fieldKey
 */export function entriesToFlatDict(entries) {
  const dict = {};
  for (const e of normalizeBusinessEntries(entries)) {
    dict[e.fieldKey] = e.fieldValue ?? '';
  }
  return dict;
}

/**
 * Insert a business_data record with its entries (transactional) and return its id.
 * @param {object} record camelCase record with entries array
 * @returns {Promise<number>} inserted record id
 */
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
      const entryRows = normalizeBusinessEntries(record.entries).map((e) => {
        const row = {
          business_data_id: id,
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

/**
 * Fetch a business_data record by record_id, including its entries.
 * @param {string} recordId external record id
 * @returns {Promise<object|null>} record entity with entries, or null when not found
 */
export async function getByRecordId(recordId) {
  const db = getDB();
  const row = await db(TABLE).where({ record_id: recordId }).first();
  if (!row) return null;
  const entity = fromDbRow(row);
  entity.entries = fromDbRows(await db(ENTRY_TABLE)
    .where({ business_data_id: row.id })
    .orderBy('id'));
  return entity;
}

/**
 * Paginated list of business_data records ordered by created_at desc.
 * @param {object} [opts] 分页选项
 * @param {number} [opts.page] 页码（1 起）
 * @param {number} [opts.pageSize] 每页条数
 * @returns {Promise<{ rows: object[], total: number, page: number, pageSize: number }>} 分页结果
 */
export async function list({ page = 1, pageSize = 20 } = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  const [{ total }] = await db(TABLE).count('* as total');
  const rows = await db(TABLE).orderBy('created_at', 'desc').limit(pageSize).offset(offset);
  return { rows: fromDbRows(rows), total, page, pageSize };
}

/**
 * Delete a business_data record by id.
 * @param {number} id 主键
 * @returns {Promise<number>} number of deleted rows
 */
export async function remove(id) {
  return getDB()(TABLE).where({ id }).del();
}

/**
 * Case KV bound to a trajectory. Empty = user has not configured case data
 * (also when schema lacks trajectory_id — treat as unconfigured, not fatal).
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<object[]>} entry entities bound to the trajectory
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
 * @param {number} trajectoryId 轨迹 id
 * @param {Array} entries raw caseEntries
 * @param {import('knex').Knex.Transaction} [trx] 可选事务
 * @returns {Promise<object[]>} resulting entry entities bound to the trajectory
 */
export async function replaceEntriesForTrajectory(trajectoryId, entries, trx = null) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    throw new Error('Invalid trajectory id');
  }
  const normalized = normalizeBusinessEntries(entries);
  const hasCol = await hasEntryTrajectoryId(trx || getDB());
  if (!hasCol) {
    // No schema support yet: unconfigured (empty) → default none; configured → ask migrate
    if (!normalized.length) return [];
    const err = new Error(
      'business_data_entry.trajectory_id missing — run: npx knex migrate:latest --knexfile config/knexfile.js',
    );
    err.statusCode = 503;
    throw err;
  }
  const db = trx || getDB();
  const run = async (client) => {
    await client(ENTRY_TABLE).where({ trajectory_id: tid }).del();
    if (!normalized.length) return [];
    const rows = normalized.map((e) => ({
      business_data_id: null,
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

/**
 * Load trajectory case entries as flat dict for agent injection.
 * @param {number} trajectoryId 轨迹 id
 * @returns {Promise<Record<string, string>>} flat label→value dict
 */
export async function loadFlatDictByTrajectory(trajectoryId) {
  const entries = await listEntriesByTrajectory(trajectoryId);
  return entriesToFlatDict(entries);
}
