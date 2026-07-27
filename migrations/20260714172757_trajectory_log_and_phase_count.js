/**
 * - trajectory_log: JSON(next_goal) → LONGTEXT (log_{ts}.txt 全文)
 * - action_count → phase_count（阶段数；step_count 保留为步骤数）
 */
export async function up(knex) {
  const hasAction = await knex.schema.hasColumn('trajectory', 'action_count');
  const hasPhase = await knex.schema.hasColumn('trajectory', 'phase_count');
  if (hasAction && !hasPhase) {
    await knex.raw(
      "ALTER TABLE `trajectory` CHANGE COLUMN `action_count` `phase_count` INT UNSIGNED DEFAULT 0 COMMENT '阶段数'"
    );
  } else if (!hasPhase) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.integer('phase_count').unsigned().defaultTo(0).comment('阶段数');
    });
  }

  await knex.raw(
    "ALTER TABLE `trajectory` MODIFY COLUMN `trajectory_log` LONGTEXT NULL COMMENT '操作日志全文（同 log_{ts}.txt：含 URL + goal/actions/result 行）'"
  );
}

export async function down(knex) {
  const hasPhase = await knex.schema.hasColumn('trajectory', 'phase_count');
  const hasAction = await knex.schema.hasColumn('trajectory', 'action_count');
  if (hasPhase && !hasAction) {
    await knex.raw(
      "ALTER TABLE `trajectory` CHANGE COLUMN `phase_count` `action_count` INT UNSIGNED DEFAULT 0 COMMENT '有效动作数'"
    );
  }

  await knex.raw(
    "ALTER TABLE `trajectory` MODIFY COLUMN `trajectory_log` JSON NULL COMMENT 'next_goal history'"
  );
}
