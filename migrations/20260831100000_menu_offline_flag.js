/**
 * Menu offline flag split:
 *  - system 表加 removed_flag 列：版本已下线标记（重复导入时从新 JSON 消失，
 *    因子树下有交易而保留），语义归 JSON 导入独占。
 *  - 既有 unmatched_flag 语义收窄为"扫描未匹配"（菜单扫描独占），本迁移不动该列。
 *
 * 写法参照 20260828100000_menu_switching_phase1.js：
 *  - hasColumn 幂等守卫，已存在则跳过（可重复执行）；
 *  - down 同样按 hasColumn 幂等删列。
 */

export async function up(knex) {
  if (!(await knex.schema.hasColumn('system', 'removed_flag'))) {
    await knex.schema.alterTable('system', (t) => {
      t.specificType('removed_flag', 'tinyint').notNullable().defaultTo(0)
        .comment('版本已下线标记（重复导入时从新 JSON 消失，因子树下有交易而保留）')
        .after('unmatched_flag');
    });
    console.log('[migration] added system.removed_flag');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('system', 'removed_flag')) {
    await knex.schema.alterTable('system', (t) => {
      t.dropColumn('removed_flag');
    });
    console.log('[migration] dropped system.removed_flag');
  }
}
