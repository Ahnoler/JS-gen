/**
 * Bind case_data_entry to trajectory (product path).
 * - Add trajectory_id FK (CASCADE)
 * - Make case_data_id nullable (legacy case_data header path)
 */

export async function up(knex) {
  const hasTraj = await knex.schema.hasColumn('case_data_entry', 'trajectory_id');
  if (!hasTraj) {
    await knex.schema.alterTable('case_data_entry', (t) => {
      t.bigInteger('trajectory_id')
        .unsigned()
        .nullable()
        .comment('FK → trajectory.id；产品路径按交易绑定案例 KV')
        .after('case_data_id');
      t.index(['trajectory_id'], 'idx_entry_trajectory');
    });
    try {
      await knex.schema.alterTable('case_data_entry', (t) => {
        t.foreign('trajectory_id', 'fk_entry_trajectory')
          .references('id')
          .inTable('trajectory')
          .onDelete('CASCADE');
      });
    } catch (err) {
      console.warn('[migration] skip fk_entry_trajectory:', err.message);
    }
  }

  // Make case_data_id nullable for trajectory-only rows
  const [cols] = await knex.raw("SHOW COLUMNS FROM `case_data_entry` LIKE 'case_data_id'");
  const col = Array.isArray(cols) ? cols[0] : null;
  if (col && String(col.Null || '').toUpperCase() === 'NO') {
    try {
      await knex.raw('ALTER TABLE `case_data_entry` DROP FOREIGN KEY `fk_entry_case_data`');
    } catch (err) {
      console.warn('[migration] drop fk_entry_case_data:', err.message);
    }
    await knex.raw(
      "ALTER TABLE `case_data_entry` MODIFY `case_data_id` BIGINT UNSIGNED NULL COMMENT '外键 → case_data.id（可空；新产品用 trajectory_id）'",
    );
    try {
      await knex.raw(
        'ALTER TABLE `case_data_entry` ADD CONSTRAINT `fk_entry_case_data` '
        + 'FOREIGN KEY (`case_data_id`) REFERENCES `case_data` (`id`) ON DELETE CASCADE',
      );
    } catch (err) {
      console.warn('[migration] recreate fk_entry_case_data:', err.message);
    }
  }
}

export async function down(knex) {
  // Remove trajectory-only rows before restoring NOT NULL on case_data_id
  await knex('case_data_entry').whereNull('case_data_id').del();

  const hasTraj = await knex.schema.hasColumn('case_data_entry', 'trajectory_id');
  if (hasTraj) {
    try {
      await knex.raw('ALTER TABLE `case_data_entry` DROP FOREIGN KEY `fk_entry_trajectory`');
    } catch (err) {
      console.warn('[migration] drop fk_entry_trajectory:', err.message);
    }
    await knex.schema.alterTable('case_data_entry', (t) => {
      t.dropIndex(['trajectory_id'], 'idx_entry_trajectory');
      t.dropColumn('trajectory_id');
    });
  }

  const [cols] = await knex.raw("SHOW COLUMNS FROM `case_data_entry` LIKE 'case_data_id'");
  const col = Array.isArray(cols) ? cols[0] : null;
  if (col && String(col.Null || '').toUpperCase() === 'YES') {
    try {
      await knex.raw('ALTER TABLE `case_data_entry` DROP FOREIGN KEY `fk_entry_case_data`');
    } catch (err) {
      console.warn('[migration] drop fk_entry_case_data (down):', err.message);
    }
    await knex.raw(
      "ALTER TABLE `case_data_entry` MODIFY `case_data_id` BIGINT UNSIGNED NOT NULL COMMENT '外键 → case_data.id'",
    );
    try {
      await knex.raw(
        'ALTER TABLE `case_data_entry` ADD CONSTRAINT `fk_entry_case_data` '
        + 'FOREIGN KEY (`case_data_id`) REFERENCES `case_data` (`id`) ON DELETE CASCADE',
      );
    } catch (err) {
      console.warn('[migration] recreate fk_entry_case_data (down):', err.message);
    }
  }
}
