/**
 * 系统参考值表（目标系统回写 / 经校验可复用的填表参考）。
 * 与用户需求「业务数据」、legacy case_data / case_data_entry 分离。
 */

export async function up(knex) {
  if (!(await knex.schema.hasTable('system_ref_data'))) {
    await knex.schema.createTable('system_ref_data', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('trajectory_id').unsigned().nullable()
        .comment('外键 → trajectory.id；按交易绑定');
      t.string('session_id', 128).nullable().defaultTo('')
        .comment('关联会话 ID');
      t.string('record_id', 64).notNullable()
        .comment('业务标识，如 sref_20260805_120000');
      t.string('source', 32).notNullable().defaultTo('system_capture')
        .comment('system_capture | manual | import');
      t.string('verification_status', 32).notNullable().defaultTo('raw')
        .comment('raw | verified | rejected');
      t.string('description', 512).nullable().defaultTo('');
      t.integer('key_count').unsigned().nullable().defaultTo(0)
        .comment('KV 字段数量');
      t.json('raw_json').nullable().comment('可选整包 JSON');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(['record_id'], 'uk_sref_record_id');
      t.index(['trajectory_id'], 'idx_sref_trajectory');
      t.index(['session_id'], 'idx_sref_session');
      t.index(['verification_status'], 'idx_sref_verify');
      t.index(['created_at'], 'idx_sref_created');
    });
    try {
      await knex.schema.alterTable('system_ref_data', (t) => {
        t.foreign('trajectory_id', 'fk_sref_trajectory')
          .references('id')
          .inTable('trajectory')
          .onDelete('SET NULL');
      });
    } catch (err) {
      console.warn('[migration] skip fk_sref_trajectory:', err.message);
    }
  }

  if (!(await knex.schema.hasTable('system_ref_entry'))) {
    await knex.schema.createTable('system_ref_entry', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('system_ref_data_id').unsigned().notNullable()
        .comment('外键 → system_ref_data.id');
      t.bigInteger('trajectory_id').unsigned().nullable()
        .comment('冗余 → trajectory.id，便于按交易查询');
      t.string('field_key', 255).notNullable().comment('字段键名');
      t.text('field_value').nullable().comment('字段值');
      t.string('source', 32).notNullable().defaultTo('system_capture')
        .comment('system_capture | manual | import');
      t.string('verification_status', 32).notNullable().defaultTo('raw')
        .comment('raw | verified | rejected');
      t.datetime('verified_at', 3).nullable().comment('校验通过时间');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.index(['system_ref_data_id'], 'idx_sre_header');
      t.index(['trajectory_id'], 'idx_sre_trajectory');
      t.index(['field_key'], 'idx_sre_field_key');
      t.index(['trajectory_id', 'field_key'], 'idx_sre_traj_key');
      t.index(['verification_status'], 'idx_sre_verify');
    });
    try {
      await knex.schema.alterTable('system_ref_entry', (t) => {
        t.foreign('system_ref_data_id', 'fk_sre_header')
          .references('id')
          .inTable('system_ref_data')
          .onDelete('CASCADE');
        t.foreign('trajectory_id', 'fk_sre_trajectory')
          .references('id')
          .inTable('trajectory')
          .onDelete('CASCADE');
      });
    } catch (err) {
      console.warn('[migration] skip system_ref_entry FKs:', err.message);
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('system_ref_entry')) {
    await knex.schema.dropTable('system_ref_entry');
  }
  if (await knex.schema.hasTable('system_ref_data')) {
    await knex.schema.dropTable('system_ref_data');
  }
}
