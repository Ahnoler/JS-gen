/**
 * Rename case_data / case_data_entry tables and case_data_id columns
 * to business_data / business_data_entry / business_data_id.
 *
 * The original create-all-tables migration is left untouched (historical
 * integrity); this migration layers the rename on top.
 */

export async function up(knex) {
  // 表重命名
  await knex.schema.renameTable('case_data', 'business_data');
  await knex.schema.renameTable('case_data_entry', 'business_data_entry');
  // form_snapshot 表名不改，仅改其外键列名

  // 列重命名（case_data_id → business_data_id）
  await knex.schema.alterTable('business_data_entry', (t) => {
    t.renameColumn('case_data_id', 'business_data_id');
  });
  await knex.schema.alterTable('form_snapshot', (t) => {
    t.renameColumn('case_data_id', 'business_data_id');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('form_snapshot', (t) => {
    t.renameColumn('business_data_id', 'case_data_id');
  });
  await knex.schema.alterTable('business_data_entry', (t) => {
    t.renameColumn('business_data_id', 'case_data_id');
  });
  await knex.schema.renameTable('business_data_entry', 'case_data_entry');
  await knex.schema.renameTable('business_data', 'case_data');
}
