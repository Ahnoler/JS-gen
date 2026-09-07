/**
 * Auth recording: jobs table + operation_component.component_type + trajectory.auth_kind.
 * Spec: docs/superpowers/specs/2026-09-07-auth-recording-design.md
 */

export async function up(knex) {
  if (!(await knex.schema.hasTable('auth_recording_jobs'))) {
    await knex.schema.createTable('auth_recording_jobs', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('system_id').unsigned().notNullable().comment('系统节点 → system.id (type=1)');
      t.bigInteger('account_id').unsigned().nullable().comment('system_account.id');
      t.enu('status', ['pending', 'running', 'success', 'failed']).notNullable().defaultTo('pending');
      t.bigInteger('login_trajectory_id').unsigned().nullable();
      t.bigInteger('logout_trajectory_id').unsigned().nullable();
      t.text('error').nullable().comment('失败摘要（agent 诊断）');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.index(['system_id'], 'idx_arj_system');
      t.index(['status'], 'idx_arj_status');
    });
  }
  if (!(await knex.schema.hasColumn('operation_component', 'component_type'))) {
    await knex.schema.alterTable('operation_component', (t) => {
      t.enu('component_type', ['normal', 'login', 'logout']).notNullable().defaultTo('normal');
    });
    await knex.schema.alterTable('operation_component', (t) => {
      t.index(['system_id', 'component_type'], 'idx_oc_system_ctype');
    });
  }
  if (!(await knex.schema.hasColumn('trajectory', 'auth_kind'))) {
    await knex.schema.alterTable('trajectory', (t) => {
      t.enu('auth_kind', ['login', 'logout']).nullable().comment('登录/登出自动录制交易标记，NULL=普通交易');
    });
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('trajectory', 'auth_kind')) {
    await knex.schema.alterTable('trajectory', (t) => t.dropColumn('auth_kind'));
  }
  if (await knex.schema.hasColumn('operation_component', 'component_type')) {
    await knex.schema.alterTable('operation_component', (t) => {
      t.dropIndex(['system_id', 'component_type'], 'idx_oc_system_ctype');
      t.dropColumn('component_type');
    });
  }
  if (await knex.schema.hasTable('auth_recording_jobs')) {
    await knex.schema.dropTable('auth_recording_jobs');
  }
}
