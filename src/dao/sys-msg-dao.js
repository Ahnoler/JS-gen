import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';
import { MSG_STATUS_READ } from '../models/sys-msg.js';

const TABLE = 'sys_msg';

function isDup(err) {
  return err?.code === 'ER_DUP_ENTRY' || /uk_sys_msg_source/i.test(String(err?.message || ''));
}

export async function insertIgnoreDuplicate(data) {
  const row = toDbRow(data);
  try {
    const [id] = await getDB()(TABLE).insert(row);
    const created = await getById(id);
    return { id, duplicate: false, row: created };
  } catch (err) {
    if (!isDup(err)) throw err;
    const existing = await getDB()(TABLE)
      .where({
        source_type: row.source_type,
        source_id: row.source_id,
      })
      .first();
    const shaped = fromDbRow(existing);
    return { id: shaped?.id ?? null, duplicate: true, row: shaped };
  }
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

export async function list({ pageNum = 1, pageSize = 20 } = {}) {
  const page = Math.max(1, Number(pageNum) || 1);
  const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const db = getDB();
  const [{ total }] = await db(TABLE).count('* as total');
  const rows = await db(TABLE)
    .orderBy('create_time', 'desc')
    .orderBy('id', 'desc')
    .limit(size)
    .offset((page - 1) * size);
  return { rows: fromDbRows(rows), total: Number(total) || 0 };
}

export async function countUnread() {
  const row = await getDB()(TABLE).whereNot({ msg_status: MSG_STATUS_READ }).count({ c: '*' }).first();
  return Number(row?.c || 0);
}

export async function markRead(id) {
  const existing = await getById(id);
  if (!existing) return null;
  if (Number(existing.msgStatus) !== MSG_STATUS_READ) {
    await getDB()(TABLE).where({ id }).update({
      msg_status: MSG_STATUS_READ,
      update_time: getDB().fn.now(3),
    });
  }
  return getById(id);
}

export async function markAllRead() {
  return getDB()(TABLE).whereNot({ msg_status: MSG_STATUS_READ }).update({
    msg_status: MSG_STATUS_READ,
    update_time: getDB().fn.now(3),
  });
}
