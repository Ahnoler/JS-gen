/**
 * trajectory 表加 page_id 列：交易起点页面 ID（组件编号 或 AILZ+13位时间戳）。
 *
 * hasColumn 幂等守卫；置于 system_account_id 之后（function_id 之后）。
 * down 幂等删列。本迁移不执行（由主 Agent 统一跑），仅交付文件。
 */

export async function up(knex) {
  const hasCol = await knex.schema.hasColumn('trajectory', 'page_id');
  if (!hasCol) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.string('page_id', 64)
        .notNullable()
        .defaultTo('')
        .comment('交易起点页面ID（组件编号 或 AILZ+13位时间戳）')
        .after('system_account_id');
    });
    console.log('[migration] added trajectory.page_id');
  }
}

export async function down(knex) {
  const hasCol = await knex.schema.hasColumn('trajectory', 'page_id');
  if (hasCol) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.dropColumn('page_id');
    });
    console.log('[migration] dropped trajectory.page_id');
  }
}
