/**
 * form_snapshot.trigger_step_id — 1:1 checkpoint trajectory_step binding (Type B)
 * + trajectory_id ON DELETE CASCADE (align with case_data_entry)
 */
export async function up(knex) {
  const hasTrigger = await knex.schema.hasColumn('form_snapshot', 'trigger_step_id');
  if (!hasTrigger) {
    await knex.schema.alterTable('form_snapshot', (t) => {
      t.bigInteger('trigger_step_id').unsigned().nullable()
        .comment('checkpoint trajectory_step.id（1:1，创建/去重更新时绑定）')
        .after('action_index');
    });
    await knex.schema.alterTable('form_snapshot', (t) => {
      t.unique(['trigger_step_id'], 'uk_fs_trigger_step');
      t.foreign('trigger_step_id', 'fk_fs_trigger_step')
        .references('id')
        .inTable('trajectory_step')
        .onDelete('CASCADE');
    });
  }

  // Drop SET NULL FK and re-add as CASCADE
  const [fkRows] = await knex.raw(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'form_snapshot'
       AND CONSTRAINT_NAME = 'fk_fs_trajectory'
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
  );
  if (fkRows?.length) {
    await knex.raw('ALTER TABLE `form_snapshot` DROP FOREIGN KEY `fk_fs_trajectory`');
  }
  await knex.raw(
    `ALTER TABLE \`form_snapshot\`
     ADD CONSTRAINT \`fk_fs_trajectory\`
     FOREIGN KEY (\`trajectory_id\`) REFERENCES \`trajectory\` (\`id\`) ON DELETE CASCADE`,
  );
}

export async function down(knex) {
  const hasTrigger = await knex.schema.hasColumn('form_snapshot', 'trigger_step_id');
  if (hasTrigger) {
    await knex.raw('ALTER TABLE `form_snapshot` DROP FOREIGN KEY `fk_fs_trigger_step`').catch(() => {});
    await knex.raw('ALTER TABLE `form_snapshot` DROP INDEX `uk_fs_trigger_step`').catch(() => {});
    await knex.schema.alterTable('form_snapshot', (t) => {
      t.dropColumn('trigger_step_id');
    });
  }

  await knex.raw('ALTER TABLE `form_snapshot` DROP FOREIGN KEY `fk_fs_trajectory`').catch(() => {});
  await knex.raw(
    `ALTER TABLE \`form_snapshot\`
     ADD CONSTRAINT \`fk_fs_trajectory\`
     FOREIGN KEY (\`trajectory_id\`) REFERENCES \`trajectory\` (\`id\`) ON DELETE SET NULL`,
  );
}
