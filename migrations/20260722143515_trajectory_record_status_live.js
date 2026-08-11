/**
 * Add trajectory.record_status value `live` for prepare/stream occupancy
 * (distinct from AI `recording`).
 */
export async function up(knex) {
  await knex.raw(
    "ALTER TABLE `trajectory` MODIFY COLUMN `record_status` "
    + "ENUM('draft','live','recording','recorded','completed') NOT NULL DEFAULT 'draft' "
    + "COMMENT 'draft=空闲; live=推流占用; recording=AI录制中; recorded=录制完成; completed=人工确认'",
  );
}

export async function down(knex) {
  await knex('trajectory').where({ record_status: 'live' }).update({ record_status: 'draft' });
  await knex.raw(
    "ALTER TABLE `trajectory` MODIFY COLUMN `record_status` "
    + "ENUM('draft','recording','recorded','completed') NOT NULL DEFAULT 'draft' "
    + "COMMENT '录制生命周期：draft/recording/recorded/completed(人工确认)'",
  );
}
