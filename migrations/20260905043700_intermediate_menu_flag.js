/**
 * Intermediate (non-navigable group) menu flag:
 *  - system.intermediate_flag：建模有 umlEcd、对应 SUT 不可点分组标题；
 *    与 unmatched_flag（扫描未匹配）/ removed_flag（版本下线）正交。
 *  - 导入在「叶子子领域且 managePage≥2」时置 1；树/推送默认过滤；扫描不得写 xpath。
 */

export async function up(knex) {
  if (!(await knex.schema.hasColumn('system', 'intermediate_flag'))) {
    await knex.schema.alterTable('system', (t) => {
      t.specificType('intermediate_flag', 'tinyint').notNullable().defaultTo(0)
        .comment('中间菜单（不可导航分组标题）；导入打标，树/推送默认隐藏')
        .after('removed_flag');
    });
    console.log('[migration] added system.intermediate_flag');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('system', 'intermediate_flag')) {
    await knex.schema.alterTable('system', (t) => {
      t.dropColumn('intermediate_flag');
    });
    console.log('[migration] dropped system.intermediate_flag');
  }
}
