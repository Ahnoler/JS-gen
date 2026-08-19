/**
 * Page-level screenshot support for V3 page/popup export.
 *
 * screenshot.kind adds 'page_level'; screenshot table adds
 * level_type / level_key / parent_level_key so V3 can export one screenshot
 * per page / popup level and validate coverage at push time.
 */

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
  if (!(await knex.schema.hasTable('screenshot'))) return;

  await knex.raw(
    `ALTER TABLE \`screenshot\`
     MODIFY COLUMN \`kind\` ENUM('before','after','phase_highlight','page_level')
     NOT NULL DEFAULT 'after'
     COMMENT 'before/after=步骤; phase_highlight=阶段长图/弹窗截图; page_level=页面级截图'`,
  );

  if (!(await knex.schema.hasColumn('screenshot', 'level_type'))) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.enu('level_type', ['page', 'popup']).nullable()
        .comment('页面级截图类型')
        .after('kind');
    });
  }

  if (!(await knex.schema.hasColumn('screenshot', 'level_key'))) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.string('level_key', 512).nullable()
        .comment('pageKey/popupKey，V3 页面级截图归属键')
        .after('level_type');
    });
  }

  if (!(await knex.schema.hasColumn('screenshot', 'parent_level_key'))) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.string('parent_level_key', 512).nullable()
        .comment('popup 所属 pageKey')
        .after('level_key');
    });
  }

  await dropIndexIfExists(knex, 'screenshot', 'uk_ss_level_key');
  await knex.raw(
    'ALTER TABLE `screenshot` ADD UNIQUE KEY `uk_ss_level_key` (`trajectory_id`, `kind`, `level_key`)',
  );
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('screenshot'))) return;

  await dropIndexIfExists(knex, 'screenshot', 'uk_ss_level_key');

  for (const col of ['parent_level_key', 'level_key', 'level_type']) {
    if (await knex.schema.hasColumn('screenshot', col)) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.dropColumn(col);
      });
    }
  }

  await knex.raw(
    `ALTER TABLE \`screenshot\`
     MODIFY COLUMN \`kind\` ENUM('before','after','phase_highlight')
     NOT NULL DEFAULT 'after'
     COMMENT 'before/after=步骤; phase_highlight=阶段长图'`,
  );
}
