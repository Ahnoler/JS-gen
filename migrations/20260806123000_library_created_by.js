/**
 * Add created_by (入库人) to component libraries — empty until user management exists.
 */

export async function up(knex) {
  if (await knex.schema.hasTable('operation_component')) {
    const has = await knex.schema.hasColumn('operation_component', 'created_by');
    if (!has) {
      await knex.schema.alterTable('operation_component', (t) => {
        t.string('created_by', 128).notNullable().defaultTo('')
          .comment('入库人；用户管理就绪前可为空串')
          .after('confidence');
      });
    }
  }

  if (await knex.schema.hasTable('special_element')) {
    const has = await knex.schema.hasColumn('special_element', 'created_by');
    if (!has) {
      await knex.schema.alterTable('special_element', (t) => {
        t.string('created_by', 128).notNullable().defaultTo('')
          .comment('入库人；用户管理就绪前可为空串')
          .after('embedded_at');
        t.string('updated_by', 128).notNullable().defaultTo('')
          .comment('更新人；用户管理就绪前可为空串')
          .after('created_by');
      });
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('operation_component')) {
    const has = await knex.schema.hasColumn('operation_component', 'created_by');
    if (has) {
      await knex.schema.alterTable('operation_component', (t) => {
        t.dropColumn('created_by');
      });
    }
  }
  if (await knex.schema.hasTable('special_element')) {
    const has = await knex.schema.hasColumn('special_element', 'created_by');
    if (has) {
      await knex.schema.alterTable('special_element', (t) => {
        t.dropColumn('updated_by');
        t.dropColumn('created_by');
      });
    }
  }
}
