/**
 * Drop dead trajectory_step.is_replay.
 * Replay suppress-persist remains request/runtime isReplay only (no table column).
 */
async function dropIndexIfExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName],
  );
  if (rows?.length) {
    await knex.raw(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
  }
}

export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'is_replay');
  if (!has) return;
  await dropIndexIfExists(knex, 'trajectory_step', 'idx_step_is_replay');
  await knex.schema.alterTable('trajectory_step', (t) => {
    t.dropColumn('is_replay');
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'is_replay');
  if (has) return;
  await knex.schema.alterTable('trajectory_step', (t) => {
    t.boolean('is_replay').notNullable().defaultTo(false)
      .comment('DEPRECATED restored — prefer runtime isReplay suppress');
    t.index(['trajectory_id', 'is_replay'], 'idx_step_is_replay');
  });
}
