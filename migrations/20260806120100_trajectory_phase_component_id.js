/**
 * Reserve trajectory_phase.component_id for future phase→component linking.
 * Phase 1 business paths do not write this column.
 */

export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory_phase', 'component_id');
  if (has) return;

  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.bigInteger('component_id').unsigned().nullable()
      .comment('预留 → operation_component.id；本阶段业务不写入')
      .after('status');
    t.index(['component_id'], 'idx_phase_component');
  });

  try {
    await knex.schema.alterTable('trajectory_phase', (t) => {
      t.foreign('component_id', 'fk_phase_component')
        .references('id')
        .inTable('operation_component')
        .onDelete('SET NULL');
    });
  } catch (err) {
    console.warn('[migration] skip fk_phase_component:', err.message);
  }
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory_phase', 'component_id');
  if (!has) return;

  try {
    await knex.raw('ALTER TABLE `trajectory_phase` DROP FOREIGN KEY `fk_phase_component`');
  } catch (err) {
    console.warn('[migration] drop fk_phase_component:', err.message);
  }

  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.dropIndex(['component_id'], 'idx_phase_component');
    t.dropColumn('component_id');
  });
}
