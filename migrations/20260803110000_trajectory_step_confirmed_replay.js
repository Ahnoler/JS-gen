/**
 * trajectory_step.confirmed: 人工确认 → 回放成功
 * - default 1 (回放成功)
 * - 回放失败 / 触发自愈 → 置 0
 * Backfill existing rows to 1 so old "未确认=0" 不误判为回放失败。
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'confirmed');
  if (!has) return;

  await knex.raw(
    "ALTER TABLE `trajectory_step` MODIFY COLUMN `confirmed` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '回放成功：1=成功，0=失败（含触发自愈）'",
  );
  await knex.raw(
    "ALTER TABLE `trajectory_step` MODIFY COLUMN `confirmed_at` DATETIME(3) DEFAULT NULL COMMENT '最近一次回放结果写入时间'",
  );
  // Historical rows were default 0 (未人工确认) — treat as replay-ok until proven otherwise
  await knex('trajectory_step').update({ confirmed: 1 });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory_step', 'confirmed');
  if (!has) return;

  await knex.raw(
    "ALTER TABLE `trajectory_step` MODIFY COLUMN `confirmed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '人工确认'",
  );
  await knex.raw(
    "ALTER TABLE `trajectory_step` MODIFY COLUMN `confirmed_at` DATETIME(3) DEFAULT NULL COMMENT '人工确认时间'",
  );
}
