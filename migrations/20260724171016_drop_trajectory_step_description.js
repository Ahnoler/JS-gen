/**
 * Drop trajectory_step.description — step goals are no longer persisted.
 * Phase task text remains on trajectory_phase.description.
 */

export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'description');
  if (!has) return;
  await knex.schema.alterTable('trajectory_step', (t) => {
    t.dropColumn('description');
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'description');
  if (has) return;
  await knex.schema.alterTable('trajectory_step', (t) => {
    t.text('description').nullable().comment('当前目标（来自 model_output.current_state.next_goal）');
  });
}
