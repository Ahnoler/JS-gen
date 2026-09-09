/**
 * system_page.activity_uml_ecd — modeling activity umlEcd for this managePage
 * (menu JSON import); used by scan adopt instead of intermediate subdomain code.
 */
export async function up(knex) {
  if (!(await knex.schema.hasColumn('system_page', 'activity_uml_ecd'))) {
    await knex.schema.alterTable('system_page', (t) => {
      t.string('activity_uml_ecd', 64).notNullable().defaultTo('')
        .comment('活动级 umlEcd（建模 umlType=3）；导入写入，扫描 pageId 回填用')
        .after('page_type');
    });
    console.log('[migration] added system_page.activity_uml_ecd');
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('system_page', 'activity_uml_ecd')) {
    await knex.schema.alterTable('system_page', (t) => {
      t.dropColumn('activity_uml_ecd');
    });
    console.log('[migration] dropped system_page.activity_uml_ecd');
  }
}
