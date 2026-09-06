/**
 * DAO for the `system_menu_change_log` table — 菜单变更历史逐事件流水。
 * 记录菜单 JSON 导入 / 菜单扫描对系统树节点的每次变更（改名/新建/收编/迁移/删除/
 * 合并/置标等），按系统节点 + 菜单版本归档，供测试人员查版本演化、管理员排查手动迁移。
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow } from './helpers.js';

const TABLE = 'system_menu_change_log';

/**
 * 批量插入变更事件流水（设计为在事务内被调用）。
 *
 * detail 为对象时自动 `JSON.stringify`；nodeId 为空（null/undefined/0）时落 NULL。
 * @param {Array<{systemNodeId: number, menuVersion: number, source: string, changeType: string, nodeId?: number|null, detail: string|object}>} rows 变更事件数组
 * @param {object|null} [db] 可选 knex 实例（传 trx 时在事务内执行）
 * @returns {Promise<number[]>} 新插入行的 id 数组
 */
export async function insertRows(rows, db = null) {
  const client = db || getDB();
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return [];

  const dbRows = list.map((r) => {
    const detail = r.detail == null ? null
      : (typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail));
    return toDbRow({
      systemNodeId: Number(r.systemNodeId),
      menuVersion: Number(r.menuVersion),
      source: String(r.source || ''),
      changeType: String(r.changeType || ''),
      nodeId: r.nodeId == null || r.nodeId === '' ? null : Number(r.nodeId),
      detail,
    });
  });

  return client(TABLE).insert(dbRows);
}

/**
 * 按系统节点列出变更流水（id 倒序，最新在前）。
 *
 * version 非空时按 menu_version 过滤；limit 钳制 1..1000（默认 200）。
 * @param {number} systemNodeId 目标系统节点 id
 * @param {{ version?: number|string|null, limit?: number }} [opts] 查询选项
 * @param {object|null} [db] 可选 knex 实例
 * @returns {Promise<object[]>} camelCase 变更流水数组（id/systemNodeId/menuVersion/source/changeType/nodeId/detail/createdAt，id 倒序）
 */
export async function listBySystem(systemNodeId, { version = null, limit = 200 } = {}, db = null) {
  const client = db || getDB();
  const lim = Math.min(1000, Math.max(1, Number(limit) || 200));
  let q = client(TABLE).where({ system_node_id: Number(systemNodeId) });
  if (version !== null && version !== undefined && version !== '') {
    q = q.andWhere({ menu_version: Number(version) });
  }
  const rows = await q.orderBy([{ column: 'id', order: 'desc' }]).limit(lim);
  return rows.map(fromDbRow);
}
