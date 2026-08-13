/**
 * screenshot.kind += phase_highlight; bind to trajectory_phase;
 * trajectory_phase.stitch_screenshot_id.
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
       MODIFY COLUMN \`kind\` ENUM('before','after','phase_highlight')
       NOT NULL DEFAULT 'after'
       COMMENT 'before/after=步骤; phase_highlight=阶段长图'`,
    );
    if (!(await knex.schema.hasColumn('screenshot', 'trajectory_phase_id'))) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.bigInteger('trajectory_phase_id').unsigned().nullable()
          .comment('阶段长图所属 trajectory_phase.id')
          .after('trajectory_step_id');
      });
      await knex.raw(
        `ALTER TABLE \`screenshot\`
         ADD CONSTRAINT \`fk_ss_trajectory_phase\`
         FOREIGN KEY (\`trajectory_phase_id\`) REFERENCES \`trajectory_phase\` (\`id\`)
         ON DELETE CASCADE`,
      );
    }
    await dropIndexIfExists(knex, 'screenshot', 'uk_ss_phase_kind');
    await knex.raw(
      'ALTER TABLE `screenshot` ADD UNIQUE KEY `uk_ss_phase_kind` (`trajectory_phase_id`, `kind`)',
    );
  }

  if (await knex.schema.hasTable('trajectory_phase')) {
    if (!(await knex.schema.hasColumn('trajectory_phase', 'stitch_screenshot_id'))) {
      await knex.schema.alterTable('trajectory_phase', (t) => {
        t.bigInteger('stitch_screenshot_id').unsigned().nullable()
          .comment('阶段展示长图 → screenshot.id')
          .after('component_id');
      });
      try {
        await knex.raw(
          `ALTER TABLE \`trajectory_phase\`
           ADD CONSTRAINT \`fk_phase_stitch_screenshot\`
           FOREIGN KEY (\`stitch_screenshot_id\`) REFERENCES \`screenshot\` (\`id\`)
           ON DELETE SET NULL`,
        );
      } catch (err) {
        console.warn('[migration] skip fk_phase_stitch_screenshot:', err.message);
      }
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('trajectory_phase')) {
    await dropFkIfExists(knex, 'trajectory_phase', 'fk_phase_stitch_screenshot');
    if (await knex.schema.hasColumn('trajectory_phase', 'stitch_screenshot_id')) {
      await knex.schema.alterTable('trajectory_phase', (t) => {
        t.dropColumn('stitch_screenshot_id');
      });
    }
  }
  if (await knex.schema.hasTable('screenshot')) {
    await dropFkIfExists(knex, 'screenshot', 'fk_ss_trajectory_phase');
    await dropIndexIfExists(knex, 'screenshot', 'uk_ss_phase_kind');
    if (await knex.schema.hasColumn('screenshot', 'trajectory_phase_id')) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.dropColumn('trajectory_phase_id');
      });
    }
    await knex.raw(
      `ALTER TABLE \`screenshot\`
       MODIFY COLUMN \`kind\` ENUM('before','after') NOT NULL DEFAULT 'after'`,
    );
  }
}
