/**
 * Migration: Create all core tables (13 tables).
 *
 * Table creation order follows foreign key dependencies:
 *   system (type 0/1/2/3 根/系统/模块/功能；根 id=0) → system_account
 *   remote_session → trajectory → trajectory_phase → trajectory_step
 *   case_data → case_data_entry
 *   form_snapshot → snapshot_field
 *   screenshot
 *   api_override
 */
export function up(knex) {
  return knex.schema
    // ── Hierarchy: unified system (type 0/1/2/3) ──
    .createTable('system', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('system_id', 36).notNullable().unique();
      t.specificType('type', 'tinyint').notNullable();
      // type=1 系统挂在根 id=0；FK 在 seed/迁移插入根后再加
      t.bigInteger('parent_id').unsigned().nullable().defaultTo(0);
      t.string('name', 255).notNullable();
      t.text('description');
      t.integer('sort_order').unsigned().defaultTo(0);
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.index(['type']);
      t.index(['parent_id']);
    })
    .createTable('system_account', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('system_id').unsigned().notNullable()
        .references('id').inTable('system').onDelete('CASCADE');
      t.string('name', 255).notNullable();
      t.string('login_url', 2048).defaultTo('');
      t.string('username', 255).defaultTo('');
      t.string('password', 255).defaultTo('');
      t.text('remark');
      t.integer('sort_order').unsigned().defaultTo(0);
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(['system_id', 'name']);
    })
    // ── RemoteSession (before trajectory — FK dependency) ──
    .createTable('remote_session', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('session_uuid', 36).notNullable().unique();
      t.string('browser_context_id', 128).defaultTo('');
      t.string('target_id', 128).defaultTo('');
      t.enu('isolation', ['context', 'target']).defaultTo('context');
      t.integer('viewport_w').unsigned().defaultTo(0);
      t.integer('viewport_h').unsigned().defaultTo(0);
      t.decimal('device_scale_factor', 4, 2).defaultTo(1.0);
      t.string('url', 2048).defaultTo('');
      t.enu('status', ['active', 'closed', 'crashed']).defaultTo('active');
      t.index('status');
      t.index('created_at');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('closed_at', 3).nullable();
    })
    // ── Trajectory ──
    .createTable('trajectory', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.text('trajectory_log').nullable();
      t.text('task');
      t.string('model', 128).defaultTo('');
      t.integer('step_count').unsigned().defaultTo(0);
      t.integer('phase_count').unsigned().defaultTo(0);
      t.boolean('is_done').nullable();
      t.boolean('is_successful').nullable();
      t.string('url', 2048).defaultTo('');
      t.bigInteger('function_id').unsigned().nullable().references('id').inTable('system').onDelete('SET NULL');
      t.bigInteger('remote_session_id').unsigned().nullable().references('id').inTable('remote_session').onDelete('SET NULL');
      t.index('function_id');
      t.index('remote_session_id');
      t.index('created_at');
      t.index('model');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
    })
    // ── TrajectoryPhase ──
    .createTable('trajectory_phase', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('phase_id', 36).notNullable().unique();
      t.bigInteger('trajectory_id').unsigned().notNullable().references('id').inTable('trajectory').onDelete('CASCADE');
      t.integer('phase_number').unsigned().notNullable();
      t.text('description').nullable();
      t.enu('status', ['running', 'completed', 'failed']).defaultTo('completed');
      t.index('trajectory_id');
      t.index(['trajectory_id', 'phase_number']);
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('completed_at', 3).nullable();
    })
    // ── TrajectoryStep ──
    .createTable('trajectory_step', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('trajectory_id').unsigned().notNullable().references('id').inTable('trajectory').onDelete('CASCADE');
      t.integer('step_number').unsigned().notNullable();
      t.integer('phase_number').unsigned().defaultTo(0);
      t.integer('action_index').unsigned().defaultTo(0);
      t.string('action_type', 64).defaultTo('');
      t.json('params_json');
      t.json('element_json');
      t.boolean('success').nullable();
      t.text('error');
      t.text('extracted_content');
      t.bigInteger('trajectory_phase_id').unsigned().nullable().references('id').inTable('trajectory_phase').onDelete('SET NULL');
      t.enu('source', ['agent', 'manual', 'cdp']).notNullable().defaultTo('agent');
      t.index('trajectory_id');
      t.index(['trajectory_id', 'step_number']);
      t.index(['trajectory_id', 'phase_number']);
      t.index('action_type');
      t.index('trajectory_phase_id');
      t.index('source');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    })
    // ── CaseData ──
    .createTable('case_data', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('record_id', 64).notNullable().unique();
      t.string('session_id', 128).defaultTo('');
      t.string('model', 128).defaultTo('');
      t.string('description', 512).defaultTo('');
      t.integer('key_count').unsigned().defaultTo(0);
      t.json('raw_json');
      t.index('session_id');
      t.index('created_at');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    })
    .createTable('case_data_entry', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('case_data_id').unsigned().nullable().references('id').inTable('case_data').onDelete('CASCADE');
      t.bigInteger('trajectory_id').unsigned().nullable().references('id').inTable('trajectory').onDelete('CASCADE');
      t.string('field_key', 255).notNullable();
      t.text('field_value');
      t.index('case_data_id');
      t.index('trajectory_id');
      t.index('field_key');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    })
    // ── FormSnapshot ──
    .createTable('form_snapshot', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('container', 128).notNullable();
      t.integer('field_count').unsigned().defaultTo(0);
      t.integer('required_count').unsigned().defaultTo(0);
      t.integer('optional_count').unsigned().defaultTo(0);
      t.integer('action_index').unsigned().defaultTo(0);
      t.bigInteger('case_data_id').unsigned().nullable().references('id').inTable('case_data').onDelete('CASCADE');
      t.bigInteger('trajectory_id').unsigned().nullable().references('id').inTable('trajectory').onDelete('SET NULL');
      t.index('container');
      t.index('case_data_id');
      t.index('trajectory_id');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    })
    .createTable('snapshot_field', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('form_snapshot_id').unsigned().notNullable().references('id').inTable('form_snapshot').onDelete('CASCADE');
      t.string('label', 255).notNullable();
      t.boolean('is_required').defaultTo(false);
      t.index('form_snapshot_id');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    })
    // ── Screenshot ──
    .createTable('screenshot', (t) => {
      t.bigIncrements('id').unsigned().primary();
      // Knex registers mediumblob() but MySQL dialect may emit type "undefined";
      // specificType keeps MEDIUMBLOB stable (matches schemas/init.sql).
      t.specificType('image_data', 'MEDIUMBLOB').notNullable();
      t.integer('file_size').unsigned().defaultTo(0);
      t.string('mime_type', 64).defaultTo('image/png');
      t.bigInteger('trajectory_id').unsigned().nullable().references('id').inTable('trajectory').onDelete('SET NULL');
      t.bigInteger('trajectory_step_id').unsigned().nullable()
        .references('id').inTable('trajectory_step').onDelete('CASCADE');
      t.enu('kind', ['before', 'after']).notNullable().defaultTo('after');
      t.index('trajectory_id');
      t.unique(['trajectory_step_id', 'kind'], { indexName: 'uk_ss_step_kind' });
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    })
    // ── ApiOverride (config; scope_ref_id is logical, not hard FK) ──
    .createTable('api_override', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('name', 255).notNullable();
      t.string('url_pattern', 2048).notNullable();
      t.enu('match_type', ['exact', 'prefix', 'regex']).defaultTo('prefix');
      t.string('http_method', 16).defaultTo('');
      t.boolean('enabled').defaultTo(true);
      t.integer('resp_status').unsigned().defaultTo(200);
      t.json('resp_headers_json');
      t.text('resp_body', 'mediumtext');
      t.enu('scope', ['global', 'system', 'process', 'function']).defaultTo('global');
      t.bigInteger('scope_ref_id').unsigned().nullable();
      t.integer('sort_order').unsigned().defaultTo(0);
      t.index('enabled');
      t.index(['scope', 'scope_ref_id']);
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
    });
}

export function down(knex) {
  return knex.schema
    .dropTableIfExists('api_override')
    .dropTableIfExists('screenshot')
    .dropTableIfExists('snapshot_field')
    .dropTableIfExists('form_snapshot')
    .dropTableIfExists('case_data_entry')
    .dropTableIfExists('case_data')
    .dropTableIfExists('trajectory_step')
    .dropTableIfExists('trajectory_phase')
    .dropTableIfExists('trajectory')
    .dropTableIfExists('remote_session')
    .dropTableIfExists('system_account')
    .dropTableIfExists('system');
}
