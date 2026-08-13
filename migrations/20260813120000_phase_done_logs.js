/**
 * trajectory_phase.done_logs — phase-end explanations [{text, at, source}].
 * trajectory.trajectory_log remains agent full-text LONGTEXT.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('trajectory_phase'))) return;
  if (await knex.schema.hasColumn('trajectory_phase', 'done_logs')) return;
  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.json('done_logs').nullable()
      .comment('阶段结束说明 [{text, at, source}]；trajectory.trajectory_log 仍为 agent 全文');
  });
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('trajectory_phase'))) return;
  if (!(await knex.schema.hasColumn('trajectory_phase', 'done_logs'))) return;
  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.dropColumn('done_logs');
  });
}
