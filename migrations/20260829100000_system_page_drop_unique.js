/**
 * system_page 表 uk_page_id 唯一索引降级为普通索引 idx_page_id。
 *
 * 理由：JSON 实测有 38 个页面被多活动共享，未来跨菜单共享页面导入会
 * 撞唯一键导致整次导入回滚。改为普通索引后允许同一 page_id 关联多个
 * system_node_id，导入逻辑在 system_page 与 trajectory 间按 page_id
 * 匹配迁移（见 src/services/menu-json-import.js 规则5.4）。
 *
 * 实现方式：information_schema.STATISTICS 探测 uk_page_id 且 NON_UNIQUE=0，
 * 命中则 ALTER TABLE ... DROP INDEX uk_page_id, ADD INDEX idx_page_id (page_id)；
 * down 反向（幂等）。参照 20260828100000_menu_switching_phase1.js 的探测式写法。
 */

/**
 * 探测 system_page 表上是否存在指定名称的唯一索引（NON_UNIQUE=0）。
 * @param {import('knex').Knex} knex knex 实例
 * @param {string} table 表名
 * @param {string} indexName 索引名
 * @returns {Promise<boolean>} 是否存在该唯一索引
 */
async function uniqueIndexExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
       AND NON_UNIQUE = 0 LIMIT 1`,
    [table, indexName],
  );
  return !!(rows && rows.length);
}

/**
 * 探测指定索引名是否存在（不论唯一/普通）。
 * @param {import('knex').Knex} knex knex 实例
 * @param {string} table 表名
 * @param {string} indexName 索引名
 * @returns {Promise<boolean>} 是否存在该索引
 */
async function indexExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName],
  );
  return !!(rows && rows.length);
}

/**
 * up：uk_page_id 唯一索引 → idx_page_id 普通索引。
 * @param {import('knex').Knex} knex knex 实例
 * @returns {Promise<void>}
 */
export async function up(knex) {
  // 探测既有唯一索引 uk_page_id（NON_UNIQUE=0）
  if (await uniqueIndexExists(knex, 'system_page', 'uk_page_id')) {
    // 一次性 DROP + ADD，避免中间态无索引
    await knex.raw(
      'ALTER TABLE `system_page` DROP INDEX `uk_page_id`, ADD INDEX `idx_page_id` (`page_id`)',
    );
    console.log('[migration] system_page: uk_page_id (unique) → idx_page_id (non-unique)');
  } else if (!(await indexExists(knex, 'system_page', 'idx_page_id'))) {
    // 无 uk_page_id（可能已迁移过又意外丢失 idx_page_id）→ 仅补建普通索引
    await knex.raw('ALTER TABLE `system_page` ADD INDEX `idx_page_id` (`page_id`)');
    console.log('[migration] system_page: added idx_page_id (no uk_page_id found)');
  } else {
    console.log('[migration] system_page: idx_page_id already present, skip');
  }
}

/**
 * down：idx_page_id 普通索引 → uk_page_id 唯一索引（反向幂等）。
 * @param {import('knex').Knex} knex knex 实例
 * @returns {Promise<void>}
 */
export async function down(knex) {
  if (await indexExists(knex, 'system_page', 'idx_page_id')) {
    await knex.raw(
      'ALTER TABLE `system_page` DROP INDEX `idx_page_id`, ADD UNIQUE INDEX `uk_page_id` (`page_id`)',
    );
    console.log('[migration] system_page: idx_page_id (non-unique) → uk_page_id (unique)');
  } else if (!(await indexExists(knex, 'system_page', 'uk_page_id'))) {
    // 既无 idx_page_id 也无 uk_page_id → 补建唯一索引
    await knex.raw('ALTER TABLE `system_page` ADD UNIQUE INDEX `uk_page_id` (`page_id`)');
    console.log('[migration] system_page: added uk_page_id (no idx_page_id found)');
  } else {
    console.log('[migration] system_page: uk_page_id already present, skip');
  }
}
