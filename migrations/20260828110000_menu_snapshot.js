/**
 * 菜单导入历史快照表（规则5.1）：
 *  - 新建 system_menu_snapshot：每次菜单 JSON 导入前落一版整树 JSON 快照，
 *    按版本号递增，独立留存（不设 FK，防级联删除丢失历史）。
 *  - id 主键自增；system_node_id 索引便于按系统查快照。
 *
 * 注意：服务器为 MySQL 5.7，严禁使用 utf8mb4_0900_ai_ci（仅 8.0 支持），
 *       本表显式指定 ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci。
 *       snapshot 用 createTable 后 knex.raw 补 MODIFY 为 LONGTEXT
 *       （knex schema builder 的 t.text() 在 MySQL 默认 TEXT，装不下整树）。
 *       幂等：hasTable 守卫建表；down dropTableIfExists。
 */

export async function up(knex) {
  // ── 建表 system_menu_snapshot ──
  if (!(await knex.schema.hasTable('system_menu_snapshot'))) {
    await knex.schema.createTable('system_menu_snapshot', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('system_node_id').unsigned().notNullable()
        .comment('目标系统节点 id（system.type=1），不设 FK，独立留存历史');
      t.integer('menu_version').notNullable().comment('快照版本号，按系统递增');
      t.text('snapshot').notNullable().comment('导入前整树 JSON 快照');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.index(['system_node_id'], 'idx_system_node');
    });

    // ENGINE / CHARSET / COLLATE（knex createTable 表达不了，用 raw 补）
    await knex.raw(
      'ALTER TABLE `system_menu_snapshot` ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
    );

    // snapshot 改为 LONGTEXT（整树快照可能很大，TEXT 64KB 不够）
    await knex.raw(
      'ALTER TABLE `system_menu_snapshot` MODIFY COLUMN `snapshot` LONGTEXT NOT NULL ' +
      "COMMENT '导入前整树 JSON 快照'",
    );

    console.log('[migration] created system_menu_snapshot');
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('system_menu_snapshot')) {
    await knex.schema.dropTable('system_menu_snapshot');
    console.log('[migration] dropped system_menu_snapshot');
  }
}
