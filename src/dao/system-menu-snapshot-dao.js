/**
 * DAO for the `system_menu_snapshot` table — 菜单 JSON 导入前的整树历史快照（规则5.1）。
 * 每次导入事务内、预加载既有子树完成后（upsert 前）落一版快照，
 * 按系统节点递增版本号，独立留存（不设 FK，防级联删除丢失历史）。
 */
import { getDB } from '../../config/database.js';
import { toDbRow } from './helpers.js';

const TABLE = 'system_menu_snapshot';

/**
 * 落一版菜单导入前快照（insert 一行）。设计为在事务内被调用。
 * @param {object} params 快照参数
 * @param {number} params.systemNodeId 目标系统节点 id（system.type=1）
 * @param {number} params.menuVersion 快照版本号（递增）
 * @param {string} params.snapshot 整树 JSON 字符串
 * @param {object|null} [db] 可选 knex 实例（传 trx 时在事务内执行）
 * @returns {Promise<number>} 新插入行的 id
 */
export async function saveSnapshot({ systemNodeId, menuVersion, snapshot }, db = null) {
  const client = db || getDB();
  const [id] = await client(TABLE).insert(toDbRow({
    systemNodeId: Number(systemNodeId),
    menuVersion: Number(menuVersion),
    snapshot: String(snapshot),
  }));
  return id;
}

/**
 * 取某系统节点下最大的快照版本号（无则返回 0，供 +1 生成下一版）。
 * @param {number} systemNodeId 目标系统节点 id
 * @param {object|null} [db] 可选 knex 实例（传 trx 时在事务内执行）
 * @returns {Promise<number>} 最大 menu_version，无快照时为 0
 */
export async function getLatestVersion(systemNodeId, db = null) {
  const client = db || getDB();
  const row = await client(TABLE)
    .where({ system_node_id: Number(systemNodeId) })
    .max('menu_version as v')
    .first();
  return Number(row?.v) || 0;
}
