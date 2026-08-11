/**
 * Add trajectory.record_status value `completed` for human confirmation.
 * Step.confirmed fields remain unchanged for future use.
 */
export async function up(knex) {
  await knex.raw(
    "ALTER TABLE `trajectory` MODIFY COLUMN `record_status` "
    + "ENUM('draft','recording','recorded','completed') NOT NULL DEFAULT 'draft' "
    + "COMMENT '录制生命周期：draft/recording/recorded/completed(人工确认)'",
  );
}

export async function down(knex) {
  // Rows in completed would fail MODIFY — coerce to recorded first.
  await knex('trajectory').where({ record_status: 'completed' }).update({ record_status: 'recorded' });
  await knex.raw(
    "ALTER TABLE `trajectory` MODIFY COLUMN `record_status` "
    + "ENUM('draft','recording','recorded') NOT NULL DEFAULT 'draft' "
    + "COMMENT '录制生命周期'",
  );
}
