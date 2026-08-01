/**
 * Drop unused screenshot.file_name — images are identified by id + trajectory_step_id + kind.
 */

export async function up(knex) {
  const has = await knex.schema.hasColumn('screenshot', 'file_name');
  if (!has) return;
  await knex.schema.alterTable('screenshot', (t) => {
    t.dropColumn('file_name');
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('screenshot', 'file_name');
  if (has) return;
  await knex.schema.alterTable('screenshot', (t) => {
    t.string('file_name', 255).notNullable().defaultTo('');
  });
}
