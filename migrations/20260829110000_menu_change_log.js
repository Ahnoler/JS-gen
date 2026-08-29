/**
 * 菜单变更历史表：记录菜单 JSON 导入 / 菜单扫描时对系统树节点的逐事件流水，
 * 供测试人员查版本演化、管理员按 transaction_migrated 记录手动迁移排查。
 *
 *  - id 主键自增；system_node_id + menu_version 复合索引便于按系统按版本查。
 *  - source（import|scan）/ change_type（renamed/updated/adopted/created/moved/
 *    transaction_migrated/deleted/merged/unmatched_marked 等）/ detail（JSON 字符串）。
 *  - 不设 FK，独立留存历史（防级联删除丢失流水）。
 *
 * 注意：服务器为 MySQL 5.7，严禁使用 utf8mb4_0900_ai_ci（仅 8.0 支持），
 *       本表显式指定 ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci。
 *       幂等：hasTable 守卫建表；down dropTableIfExists。
 *       参照 20260828110000_menu_snapshot.js 写法。
 */

export async function up(knex) {
  // ── 建表 system_menu_change_log ──
  if (!(await knex.schema.hasTable('system_menu_change_log'))) {
    await knex.schema.createTable('system_menu_change_log', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('system_node_id').unsigned().notNullable()
        .comment('目标系统节点 id（system.type=1），不设 FK，独立留存历史');
      t.integer('menu_version').notNullable().comment('菜单版本号（对齐 system_menu_snapshot.menu_version）');
      t.string('source', 16).notNullable().comment('变更来源：import|scan');
      t.string('change_type', 32).notNullable().comment('变更类型：renamed/updated/adopted/created/moved/transaction_migrated/deleted/merged/unmatched_marked 等');
      t.bigInteger('node_id').unsigned().nullable().comment('受影响的系统节点 id（可为空，如跨节点迁移事件）');
      t.text('detail').nullable().comment('变更明细 JSON 字符串');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.index(['system_node_id', 'menu_version'], 'idx_sys_ver');
    });

    // ENGINE / CHARSET / COLLATE（knex createTable 表达不了，用 raw 补）
    await knex.raw(
      'ALTER TABLE `system_menu_change_log` ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci',
    );

    console.log('[migration] created system_menu_change_log');
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('system_menu_change_log')) {
    await knex.schema.dropTable('system_menu_change_log');
    console.log('[migration] dropped system_menu_change_log');
  }
}
