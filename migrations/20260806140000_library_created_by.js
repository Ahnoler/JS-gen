/**
 * Add created_by (入库人) to operation_component and special_element.
 * User management not wired yet — column defaults empty.
 */

export async function up(knex) {
  if (!(await knex.schema.hasColumn('operation_component', 'created_by'))) {
    await knex.schema.alterTable('operation_component', (t) => {
      t.string('created_by', 128).notNullable().defaultTo('')
        .comment('入库人；用户体系接入前可空字符串')
        .after('confidence');
    });
  }
  if (!(await knex.schema.hasColumn('special_element', 'created_by'))) {
    await knex.schema.alterTable('special_element', (t) => {
      t.string('created_by', 128).notNullable().defaultTo('')
        .comment('入库人；用户体系接入前可空字符串')
        .after('remark');
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('operation_component', 'created_by')) {
    await knex.schema.alterTable('operation_component', (t) => {
      t.dropColumn('created_by');
    });
  }
  if (await knex.schema.hasColumn('special_element', 'created_by')) {
    await knex.schema.alterTable('special_element', (t) => {
      t.dropColumn('created_by');
    });
  }
}
