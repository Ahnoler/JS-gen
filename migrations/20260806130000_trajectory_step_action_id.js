/**
 * trajectory_step.action_id — Python ActionEntry.id for DB-level idempotent dedupe
 * after control-plane restart (in-memory persistedActionIds is lost).
 * NULL for historical rows and manual/cdp/special_element sources.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'action_id');
  if (!has) {
    await knex.raw(
      "ALTER TABLE `trajectory_step` ADD COLUMN `action_id` VARCHAR(64) NULL "
      + "COMMENT 'Python ActionEntry.id（UUID v4）；控制面重启后幂等去重；历史行为 NULL' "
      + "AFTER `source`",
    );
    await knex.raw(
      'ALTER TABLE `trajectory_step` ADD UNIQUE KEY `uk_traj_action` (`trajectory_id`, `action_id`)',
    );
  }
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'action_id');
  if (has) {
    await knex.raw('ALTER TABLE `trajectory_step` DROP INDEX `uk_traj_action`');
    await knex.raw('ALTER TABLE `trajectory_step` DROP COLUMN `action_id`');
  }
}
