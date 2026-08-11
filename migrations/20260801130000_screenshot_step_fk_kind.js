/**
 * screenshot: step_index → trajectory_step_id + kind (before|after).
 * UNIQUE(trajectory_step_id, kind); ON DELETE CASCADE from trajectory_step.
 * Existing rows (if any) are truncated — saveScreenshot had no callers.
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
  const hasTable = await knex.schema.hasTable('screenshot');
  if (!hasTable) return;

  await knex('screenshot').del();

  const hasStepIndex = await knex.schema.hasColumn('screenshot', 'step_index');
  if (hasStepIndex) {
    await dropIndexIfExists(knex, 'screenshot', 'idx_step_index');
    await dropIndexIfExists(knex, 'screenshot', 'screenshot_step_index_index');
    await knex.schema.alterTable('screenshot', (t) => {
      t.dropColumn('step_index');
    });
  }

  const hasStepId = await knex.schema.hasColumn('screenshot', 'trajectory_step_id');
  if (!hasStepId) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.bigInteger('trajectory_step_id').unsigned().nullable();
      t.enu('kind', ['before', 'after']).notNullable().defaultTo('after');
    });
    await knex.raw(
      `ALTER TABLE \`screenshot\`
       ADD CONSTRAINT \`fk_ss_trajectory_step\`
       FOREIGN KEY (\`trajectory_step_id\`) REFERENCES \`trajectory_step\` (\`id\`)
       ON DELETE CASCADE`,
    );
  } else {
    const hasKind = await knex.schema.hasColumn('screenshot', 'kind');
    if (!hasKind) {
      await knex.schema.alterTable('screenshot', (t) => {
        t.enu('kind', ['before', 'after']).notNullable().defaultTo('after');
      });
    }
  }

  const [rows] = await knex.raw(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'screenshot' AND INDEX_NAME = 'uk_ss_step_kind'`,
  );
  if (!rows || !rows.length) {
    await knex.raw(
      'ALTER TABLE `screenshot` ADD UNIQUE KEY `uk_ss_step_kind` (`trajectory_step_id`, `kind`)',
    );
  }
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('screenshot');
  if (!hasTable) return;

  await dropIndexIfExists(knex, 'screenshot', 'uk_ss_step_kind');

  const [fks] = await knex.raw(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'screenshot'
       AND CONSTRAINT_NAME = 'fk_ss_trajectory_step' AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
  );
  if (fks && fks.length) {
    await knex.raw('ALTER TABLE `screenshot` DROP FOREIGN KEY `fk_ss_trajectory_step`');
  }

  const hasStepId = await knex.schema.hasColumn('screenshot', 'trajectory_step_id');
  if (hasStepId) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.dropColumn('trajectory_step_id');
    });
  }

  const hasKind = await knex.schema.hasColumn('screenshot', 'kind');
  if (hasKind) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.dropColumn('kind');
    });
  }

  const hasStepIndex = await knex.schema.hasColumn('screenshot', 'step_index');
  if (!hasStepIndex) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.integer('step_index').unsigned().defaultTo(0);
      t.index('step_index');
    });
  }
}
