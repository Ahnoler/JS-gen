/**
 * Recording feature fields:
 * - trajectory.name / record_status
 * - trajectory_step.confirmed / confirmed_at
 * - trajectory_phase.status += pending
 */
export async function up(knex) {
  const hasName = await knex.schema.hasColumn('trajectory', 'name');
  if (!hasName) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.string('name', 255).defaultTo('').comment('交易名称').after('id');
      t.enum('record_status', ['draft', 'recording', 'recorded'])
        .notNullable()
        .defaultTo('draft')
        .comment('录制生命周期')
        .after('remote_session_id');
    });
  }

  const hasConfirmed = await knex.schema.hasColumn('trajectory_step', 'confirmed');
  if (!hasConfirmed) {
    await knex.schema.alterTable('trajectory_step', (t) => {
      t.boolean('confirmed').notNullable().defaultTo(false).comment('人工确认');
      t.datetime('confirmed_at', 3).nullable().comment('人工确认时间');
    });
  }

  // Expand phase status ENUM to include pending
  await knex.raw(
    "ALTER TABLE `trajectory_phase` MODIFY COLUMN `status` "
    + "ENUM('pending','running','completed','failed') DEFAULT 'pending'",
  );
}

export async function down(knex) {
  const hasConfirmed = await knex.schema.hasColumn('trajectory_step', 'confirmed');
  if (hasConfirmed) {
    await knex.schema.alterTable('trajectory_step', (t) => {
      t.dropColumn('confirmed');
      t.dropColumn('confirmed_at');
    });
  }

  const hasName = await knex.schema.hasColumn('trajectory', 'name');
  if (hasName) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.dropColumn('name');
      t.dropColumn('record_status');
    });
  }

  await knex.raw(
    "ALTER TABLE `trajectory_phase` MODIFY COLUMN `status` "
    + "ENUM('running','completed','failed') DEFAULT 'completed'",
  );
}
