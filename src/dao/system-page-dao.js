/**
 * DAO for the `system_page` table — per-function-node detail page list.
 * 每个功能节点（system.type=3）可挂多个明细页面；replaceForNode 在事务内整替，
 * listByNodeId 按 id 升序返回 camelCase 实体。
 */
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow } from './helpers.js';

const TABLE = 'system_page';

/**
 * 整替某功能节点下的明细页面（先删后插），设计为在事务内被调用。
 * @param {number} nodeId system 节点 id（功能节点）
 * @param {object[]} pages 页面清单，每项含 pageId/pageName/resPath/pageType
 * @param {object|null} [db] 可选 knex 实例（传 trx 时在事务内执行）
 * @returns {Promise<number>} 实际插入的行数
 */
export async function replaceForNode(nodeId, pages, db = null) {
  const client = db || getDB();
  await client(TABLE).where({ system_node_id: Number(nodeId) }).del();

  const rows = (Array.isArray(pages) ? pages : [])
    .filter((p) => typeof p?.pageId === 'string' && p.pageId)
    .map((p) => toDbRow({
      systemNodeId: Number(nodeId),
      pageId: String(p.pageId),
      pageName: String(p.pageName ?? ''),
      resPath: String(p.resPath ?? ''),
      pageType: String(p.pageType || 'managePage'),
    }));

  if (!rows.length) return 0;
  await client(TABLE).insert(rows);
  return rows.length;
}

/**
 * 按功能节点 id 列出明细页面（id 升序）。
 * @param {number} nodeId system 节点 id（功能节点）
 * @param {object|null} [db] 可选 knex 实例
 * @returns {Promise<object[]>} camelCase 实体数组（systemNodeId/pageId/pageName/resPath/pageType）
 */
export async function listByNodeId(nodeId, db = null) {
  const client = db || getDB();
  const rows = await client(TABLE)
    .where({ system_node_id: Number(nodeId) })
    .orderBy([{ column: 'id', order: 'asc' }]);
  return rows.map(fromDbRow);
}
