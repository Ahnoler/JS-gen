/**
 * trajectory.is_export — 0 dirty/never exported, 1 last full export succeeded
 */
export async function up(knex) {
  await knex.schema.alterTable('trajectory', (t) => {
    t.specificType('is_export', 'TINYINT(1)')
      .notNullable()
      .defaultTo(0)
      .comment('1 = full transaction export succeeded; 0 = changed or never exported');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropColumn('is_export');
  });
}
