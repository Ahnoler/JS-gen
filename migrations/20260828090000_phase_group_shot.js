/**
 * Phase state-group screenshot support: screenshot.kind += 'phase_group'
 * (one row per trajectory_phase × state_group) and a step-side binding
 * trajectory_step.group_shot_id → screenshot.id.
 *
 * 说明：阶段内页面可能跳变（新增抽屉/保存跳转等），按 state_group
 * （scripts/state.py current_page_level() 的 level key）归档组图；
 * 步骤按其动作发生前的 beforeKey 归属组图。
 * 原 uk_ss_phase_kind (trajectory_phase_id, kind) 与「同阶段多状态组」
 * 冲突（kind=phase_group 每阶段多行），故由 uk_ss_phase_group
 * (trajectory_phase_id, state_group) 取代；down 恢复原唯一键。
 * 注意：uk_ss_phase_kind 同时是 fk_ss_trajectory_phase 的支撑索引
 * （trajectory_phase_id 左前缀），换键前须先 DROP FK、换键后按原样重建。
 */

async function dropFkIfExists(knex, table, name) {
  const [rows] = await knex.raw(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY' LIMIT 1`,
    [table, name],
  );
  if (rows && rows.length) {
    await knex.raw(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${name}\``);
  }
}

async function dropIndexIfExists(knex, table, indexName) {
  const [rows] = await knex.raw(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName],
  );
  if (rows && rows.length) {
    await knex.raw(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
  }
}

export async function up(knex) {
  if (await knex.schema.hasTable('screenshot')) {
    await knex.raw(
      `ALTER TABLE \`screenshot\`
       MODIFY COLUMN \`kind\` ENUM('before','after','phase_highlight','page_level','phase_group')
       NOT NULL DEFAULT 'after'
       COMMENT 'before/after=步骤; phase_highlight=阶段长图/弹窗截图; page_level=页面级截图; phase_group=阶段内状态组截图'`,
    );

    if (!(await knex.schema.hasColumn('screenshot', 'state_group'))) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.string('state_group', 128).nullable()
          .comment('阶段内状态键（current_page_level level key），kind=phase_group 必填')
          .after('kind');
      });
    }

    // phase_highlight（done 行）也占一个 state_group 值：让
    // uk_ss_phase_group (trajectory_phase_id, state_group) 同时承担 done 行的
    // 去重 —— 否则 replaceForPhase 的 ON DUPLICATE KEY UPDATE 失去唯一键支撑，
    // 每阶段会累积多张 phase_highlight（2026-08-28 review 发现）。
    await knex.raw(
      "UPDATE `screenshot` SET `state_group` = 'done' WHERE `kind` = 'phase_highlight' AND `state_group` IS NULL",
    );

    // uk_ss_phase_kind 限制每阶段同 kind 仅一行，与多状态组冲突 → 由
    // uk_ss_phase_group (trajectory_phase_id, state_group) 取代。
    // 先放 FK（它依赖 uk_ss_phase_kind 的 trajectory_phase_id 前缀索引），
    // 换键后按原样重建（新键同样提供该前缀）。
    await dropFkIfExists(knex, 'screenshot', 'fk_ss_trajectory_phase');
    await dropIndexIfExists(knex, 'screenshot', 'uk_ss_phase_kind');
    await dropIndexIfExists(knex, 'screenshot', 'uk_ss_phase_group');
    await knex.raw(
      'ALTER TABLE `screenshot` ADD UNIQUE KEY `uk_ss_phase_group` (`trajectory_phase_id`, `state_group`)',
    );
    try {
      await knex.raw(
        `ALTER TABLE \`screenshot\`
         ADD CONSTRAINT \`fk_ss_trajectory_phase\`
         FOREIGN KEY (\`trajectory_phase_id\`) REFERENCES \`trajectory_phase\` (\`id\`)
         ON DELETE CASCADE`,
      );
    } catch (err) {
      console.warn('[migration] skip fk_ss_trajectory_phase:', err.message);
    }
  }

  if (await knex.schema.hasTable('trajectory_step')) {
    if (!(await knex.schema.hasColumn('trajectory_step', 'group_shot_id'))) {
      await knex.schema.alterTable('trajectory_step', (t) => {
        t.bigInteger('group_shot_id').unsigned().nullable()
          .comment('动作前所属状态组截图 → screenshot.id（kind=phase_group）')
          .after('trajectory_phase_id');
      });
      try {
        await knex.raw(
          `ALTER TABLE \`trajectory_step\`
           ADD CONSTRAINT \`fk_step_group_shot\`
           FOREIGN KEY (\`group_shot_id\`) REFERENCES \`screenshot\` (\`id\`)
           ON DELETE SET NULL`,
        );
      } catch (err) {
        console.warn('[migration] skip fk_step_group_shot:', err.message);
      }
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('trajectory_step')) {
    await dropFkIfExists(knex, 'trajectory_step', 'fk_step_group_shot');
    if (await knex.schema.hasColumn('trajectory_step', 'group_shot_id')) {
      await knex.schema.alterTable('trajectory_step', (t) => {
        t.dropColumn('group_shot_id');
      });
    }
  }

  if (await knex.schema.hasTable('screenshot')) {
    // 先释放 FK（当前索引 uk_ss_phase_group 是其 trajectory_phase_id 支撑索引），
    // 否则 DROP INDEX 被 FK 拒绝。
    await dropFkIfExists(knex, 'screenshot', 'fk_ss_trajectory_phase');
    await dropIndexIfExists(knex, 'screenshot', 'uk_ss_phase_group');
    if (await knex.schema.hasColumn('screenshot', 'state_group')) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.dropColumn('state_group');
      });
    }
    // 重建 uk_ss_phase_kind（恢复原唯一键）。
    await dropIndexIfExists(knex, 'screenshot', 'uk_ss_phase_kind');
    await knex.raw(
      'ALTER TABLE `screenshot` ADD UNIQUE KEY `uk_ss_phase_kind` (`trajectory_phase_id`, `kind`)',
    );
    try {
      await knex.raw(
        `ALTER TABLE \`screenshot\`
         ADD CONSTRAINT \`fk_ss_trajectory_phase\`
         FOREIGN KEY (\`trajectory_phase_id\`) REFERENCES \`trajectory_phase\` (\`id\`)
         ON DELETE CASCADE`,
      );
    } catch (err) {
      console.warn('[migration] skip fk_ss_trajectory_phase:', err.message);
    }
    await knex.raw(
      `ALTER TABLE \`screenshot\`
       MODIFY COLUMN \`kind\` ENUM('before','after','phase_highlight','page_level')
       NOT NULL DEFAULT 'after'
       COMMENT 'before/after=步骤; phase_highlight=阶段长图/弹窗截图; page_level=页面级截图'`,
    );
  }
}
