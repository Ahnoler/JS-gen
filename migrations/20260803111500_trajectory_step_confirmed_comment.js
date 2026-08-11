/**
 * Rename trajectory_step.confirmed column comment → 回放确认
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'confirmed');
  if (!has) return;

  await knex.raw(
    "ALTER TABLE `trajectory_step` MODIFY COLUMN `confirmed` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '回放确认'",
  );
  await knex.raw(
    "ALTER TABLE `trajectory_step` MODIFY COLUMN `confirmed_at` DATETIME(3) DEFAULT NULL COMMENT '回放确认时间'",
  );
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'confirmed');
  if (!has) return;

  await knex.raw(
    "ALTER TABLE `trajectory_step` MODIFY COLUMN `confirmed` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '回放成功：1=成功，0=失败（含触发自愈）'",
  );
  await knex.raw(
    "ALTER TABLE `trajectory_step` MODIFY COLUMN `confirmed_at` DATETIME(3) DEFAULT NULL COMMENT '最近一次回放结果写入时间'",
  );
}
