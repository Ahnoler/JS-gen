/**
 * Operation component library (Phase 1):
 * - operation_component: phase-level reusable step snapshot
 * - operation_component_occurrence: evidence linking mined phases
 */

export async function up(knex) {
  if (!(await knex.schema.hasTable('operation_component'))) {
    await knex.schema.createTable('operation_component', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('name', 255).notNullable().comment('展示名');
      t.string('key', 128).nullable().comment('稳定键（展示辅助，不参与去重）');
      t.text('description').nullable().comment('语义说明');
      t.enu('grain', ['phase', 'step_seq']).notNullable().defaultTo('phase')
        .comment('组件粒度；本阶段恒 phase');
      t.bigInteger('system_id').unsigned().notNullable()
        .comment('归属系统 → system.id（NOT NULL）');
      t.enu('status', ['draft', 'confirmed', 'deprecated']).notNullable().defaultTo('draft');
      t.json('param_schema').nullable().comment('参数化预留 JSON');
      t.json('steps_json').notNullable().comment('代表样例步骤快照');
      t.string('signature', 64).notNullable().comment('结构签名 sha256 hex');
      t.bigInteger('source_trajectory_id').unsigned().nullable()
        .comment('代表样例来源轨迹');
      t.bigInteger('source_phase_id').unsigned().nullable()
        .comment('代表样例来源阶段');
      t.integer('occurrence_count').unsigned().notNullable().defaultTo(0);
      t.decimal('confidence', 4, 3).nullable();
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(['system_id', 'signature'], 'uk_oc_system_signature');
      t.index(['status'], 'idx_oc_status');
      t.index(['grain'], 'idx_oc_grain');
      t.index(['system_id'], 'idx_oc_system');
    });
    try {
      await knex.schema.alterTable('operation_component', (t) => {
        t.foreign('system_id', 'fk_oc_system')
          .references('id').inTable('system').onDelete('RESTRICT');
        t.foreign('source_trajectory_id', 'fk_oc_source_traj')
          .references('id').inTable('trajectory').onDelete('SET NULL');
        t.foreign('source_phase_id', 'fk_oc_source_phase')
          .references('id').inTable('trajectory_phase').onDelete('SET NULL');
      });
    } catch (err) {
      console.warn('[migration] skip operation_component FKs:', err.message);
    }
  }

  if (!(await knex.schema.hasTable('operation_component_occurrence'))) {
    await knex.schema.createTable('operation_component_occurrence', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('component_id').unsigned().notNullable();
      t.bigInteger('trajectory_id').unsigned().notNullable();
      t.bigInteger('trajectory_phase_id').unsigned().notNullable();
      t.decimal('similarity', 4, 3).nullable();
      t.integer('step_start').unsigned().nullable().comment('预留 step_seq');
      t.integer('step_end').unsigned().nullable().comment('预留 step_seq');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(['component_id', 'trajectory_phase_id'], 'uk_oco_comp_phase');
      t.index(['trajectory_id'], 'idx_oco_trajectory');
      t.index(['component_id'], 'idx_oco_component');
    });
    try {
      await knex.schema.alterTable('operation_component_occurrence', (t) => {
        t.foreign('component_id', 'fk_oco_component')
          .references('id').inTable('operation_component').onDelete('CASCADE');
        t.foreign('trajectory_id', 'fk_oco_trajectory')
          .references('id').inTable('trajectory').onDelete('CASCADE');
        t.foreign('trajectory_phase_id', 'fk_oco_phase')
          .references('id').inTable('trajectory_phase').onDelete('CASCADE');
      });
    } catch (err) {
      console.warn('[migration] skip operation_component_occurrence FKs:', err.message);
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('operation_component_occurrence')) {
    await knex.schema.dropTable('operation_component_occurrence');
  }
  if (await knex.schema.hasTable('operation_component')) {
    await knex.schema.dropTable('operation_component');
  }
}
