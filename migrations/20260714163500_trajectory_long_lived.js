/**
 * Rename trajectory.trajectory_id → trajectory_log (JSON of next_goals).
 * Widen trajectory_phase.description to TEXT for full phase task text.
 * External identity becomes numeric trajectory.id.
 */
export async function up(knex) {
  const hasLog = await knex.schema.hasColumn('trajectory', 'trajectory_log');
  if (!hasLog) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.json('trajectory_log').nullable().comment('next_goal history from native traj JSON');
    });
  }

  const hasBizId = await knex.schema.hasColumn('trajectory', 'trajectory_id');
  if (hasBizId) {
    // Drop unique index if present (MySQL naming may vary)
    try {
      await knex.raw('ALTER TABLE `trajectory` DROP INDEX `uk_trajectory_id`');
    } catch (_) {
      try {
        await knex.raw('ALTER TABLE `trajectory` DROP INDEX `trajectory_trajectory_id_unique`');
      } catch (__) {}
    }
    await knex.schema.alterTable('trajectory', (t) => {
      t.dropColumn('trajectory_id');
    });
  }

  // Widen phase description
  await knex.raw(
    "ALTER TABLE `trajectory_phase` MODIFY COLUMN `description` TEXT NULL COMMENT '阶段任务完整描述'"
  );
}

export async function down(knex) {
  const hasBizId = await knex.schema.hasColumn('trajectory', 'trajectory_id');
  if (!hasBizId) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.string('trajectory_id', 64).nullable();
    });
  }
  const hasLog = await knex.schema.hasColumn('trajectory', 'trajectory_log');
  if (hasLog) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.dropColumn('trajectory_log');
    });
  }
  await knex.raw(
    "ALTER TABLE `trajectory_phase` MODIFY COLUMN `description` VARCHAR(512) DEFAULT ''"
  );
}
