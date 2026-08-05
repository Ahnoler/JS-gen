import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';

const TABLE = 'system_ref_data';
const ENTRY_TABLE = 'system_ref_entry';

const RESERVED_KEYS = new Set(['form_snapshots', 'form_snapshot', 'task_list', '_watcher_mode']);

const SOURCES = new Set(['system_capture', 'manual', 'import']);
const VERIFY_STATUSES = new Set(['raw', 'verified', 'rejected']);

/**
 * Normalize API payloads to { fieldKey, fieldValue, source?, verificationStatus? }.
 * Accepts `{ fieldKey, fieldValue }` or `{ key, value }`.
 */
export function normalizeSystemRefEntries(raw, defaults = {}) {
  if (!Array.isArray(raw)) return [];
  const defSource = SOURCES.has(defaults.source) ? defaults.source : 'system_capture';
  const defStatus = VERIFY_STATUSES.has(defaults.verificationStatus)
    ? defaults.verificationStatus
    : 'raw';
  const out = [];
  const seen = new Set();
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const fieldKey = String(e.fieldKey ?? e.key ?? '').trim();
    if (!fieldKey || RESERVED_KEYS.has(fieldKey) || seen.has(fieldKey)) continue;
    seen.add(fieldKey);
    const v = e.fieldValue ?? e.value;
    const source = SOURCES.has(e.source) ? e.source : defSource;
    const verificationStatus = VERIFY_STATUSES.has(e.verificationStatus ?? e.verification_status)
      ? (e.verificationStatus ?? e.verification_status)
      : defStatus;
    out.push({
      fieldKey,
      fieldValue: v == null ? null : String(v),
      source,
      verificationStatus,
    });
  }
  return out;
}

export function entriesToFlatDict(entries) {
  const dict = {};
  for (const e of normalizeSystemRefEntries(entries)) {
    dict[e.fieldKey] = e.fieldValue ?? '';
  }
  return dict;
}

function makeRecordId() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `sref_${ts}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Insert a header + optional entries.
 * @returns {Promise<number>} system_ref_data.id
 */
export async function save(record) {
  const db = getDB();
  const source = SOURCES.has(record.source) ? record.source : 'system_capture';
  const verificationStatus = VERIFY_STATUSES.has(record.verificationStatus)
    ? record.verificationStatus
    : 'raw';
  const entries = normalizeSystemRefEntries(record.entries || [], {
    source,
    verificationStatus,
  });

  return db.transaction(async (trx) => {
    const [id] = await trx(TABLE).insert(toDbRow({
      trajectoryId: record.trajectoryId ?? null,
      sessionId: record.sessionId || '',
      recordId: record.recordId || makeRecordId(),
      source,
      verificationStatus,
      description: record.description || '',
      keyCount: record.keyCount ?? entries.length,
      rawJson: record.rawJson ?? null,
    }));
    if (entries.length) {
      const nowVerified = verificationStatus === 'verified' ? new Date() : null;
      await trx(ENTRY_TABLE).insert(entries.map((e) => ({
        system_ref_data_id: id,
        trajectory_id: record.trajectoryId ?? null,
        field_key: e.fieldKey,
        field_value: e.fieldValue,
        source: e.source,
        verification_status: e.verificationStatus,
        verified_at: e.verificationStatus === 'verified' ? (nowVerified || new Date()) : null,
      })));
    }
    return id;
  });
}

export async function getById(id) {
  const db = getDB();
  const row = await db(TABLE).where({ id: Number(id) }).first();
  if (!row) return null;
  const entity = fromDbRow(row);
  entity.entries = fromDbRows(await db(ENTRY_TABLE)
    .where({ system_ref_data_id: row.id })
    .orderBy('id'));
  return entity;
}

export async function getByRecordId(recordId) {
  const db = getDB();
  const row = await db(TABLE).where({ record_id: recordId }).first();
  if (!row) return null;
  return getById(row.id);
}

/**
 * List headers (optional filters).
 * @param {{ page?: number, pageSize?: number, trajectoryId?: number, verificationStatus?: string }} opts
 */
export async function list({
  page = 1,
  pageSize = 20,
  trajectoryId = null,
  verificationStatus = null,
} = {}) {
  const db = getDB();
  const offset = (page - 1) * pageSize;
  let q = db(TABLE);
  let countQ = db(TABLE);
  const tid = Number(trajectoryId);
  if (Number.isFinite(tid) && tid > 0) {
    q = q.where({ trajectory_id: tid });
    countQ = countQ.where({ trajectory_id: tid });
  }
  if (VERIFY_STATUSES.has(verificationStatus)) {
    q = q.where({ verification_status: verificationStatus });
    countQ = countQ.where({ verification_status: verificationStatus });
  }
  const [{ total }] = await countQ.count('* as total');
  const rows = await q.orderBy('created_at', 'desc').limit(pageSize).offset(offset);
  return { rows: fromDbRows(rows), total: Number(total) || 0, page, pageSize };
}

export async function remove(id) {
  return getDB()(TABLE).where({ id: Number(id) }).del();
}

/**
 * List KV entries bound to a trajectory (optionally filter by verification_status).
 */
export async function listEntriesByTrajectory(trajectoryId, { verificationStatus = null } = {}) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return [];
  let q = getDB()(ENTRY_TABLE).where({ trajectory_id: tid });
  if (VERIFY_STATUSES.has(verificationStatus)) {
    q = q.where({ verification_status: verificationStatus });
  }
  return fromDbRows(await q.orderBy('id'));
}

/**
 * Replace all system_ref entries for a trajectory (delete header+entries, re-insert).
 * Creates one header row bound to the trajectory.
 *
 * @param {number} trajectoryId
 * @param {Array} entries
 * @param {{ source?: string, verificationStatus?: string, description?: string, sessionId?: string }} [opts]
 */
export async function replaceEntriesForTrajectory(trajectoryId, entries, opts = {}) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) {
    throw new Error('Invalid trajectory id');
  }
  const source = SOURCES.has(opts.source) ? opts.source : 'system_capture';
  const verificationStatus = VERIFY_STATUSES.has(opts.verificationStatus)
    ? opts.verificationStatus
    : 'raw';
  const normalized = normalizeSystemRefEntries(entries, { source, verificationStatus });

  return getDB().transaction(async (trx) => {
    // Cascade deletes entries via FK
    await trx(TABLE).where({ trajectory_id: tid }).del();
    // Orphan entry rows (if any header was null) — also clear by trajectory
    await trx(ENTRY_TABLE).where({ trajectory_id: tid }).del();

    if (!normalized.length) return [];

    const [headerId] = await trx(TABLE).insert(toDbRow({
      trajectoryId: tid,
      sessionId: opts.sessionId || '',
      recordId: opts.recordId || makeRecordId(),
      source,
      verificationStatus,
      description: opts.description || '',
      keyCount: normalized.length,
      rawJson: opts.rawJson ?? null,
    }));

    const verifiedAt = verificationStatus === 'verified' ? new Date() : null;
    await trx(ENTRY_TABLE).insert(normalized.map((e) => ({
      system_ref_data_id: headerId,
      trajectory_id: tid,
      field_key: e.fieldKey,
      field_value: e.fieldValue,
      source: e.source,
      verification_status: e.verificationStatus,
      verified_at: e.verificationStatus === 'verified' ? (verifiedAt || new Date()) : null,
    })));

    return fromDbRows(await trx(ENTRY_TABLE).where({ trajectory_id: tid }).orderBy('id'));
  });
}

/** Delete all system_ref headers (and cascaded entries) for a trajectory. */
export async function removeByTrajectory(trajectoryId) {
  const tid = Number(trajectoryId);
  if (!Number.isFinite(tid) || tid <= 0) return 0;
  return getDB()(TABLE).where({ trajectory_id: tid }).del();
}

export async function loadFlatDictByTrajectory(trajectoryId, { verificationStatus = null } = {}) {
  const entries = await listEntriesByTrajectory(trajectoryId, { verificationStatus });
  return entriesToFlatDict(entries);
}
