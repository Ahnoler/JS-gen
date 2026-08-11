/**
 * Batch Excel import + auto-recording jobs.
 * - batch_recording_job: one upload / Idempotency-Key
 * - batch_recording_item: one Excel row pipeline state
 */

export async function up(knex) {
  await knex.schema.createTable('batch_recording_job', (t) => {
    t.string('id', 36).primary().comment('UUID batch id');
    t.string('idempotency_key', 128).notNullable()
      .comment('Client Idempotency-Key; unique');
    t.string('request_hash', 128).notNullable()
      .comment('SHA-256 of file bytes + function/account/model');
    t.bigInteger('function_id').unsigned().notNullable()
      .references('id').inTable('system').onDelete('RESTRICT');
    t.bigInteger('system_account_id').unsigned().notNullable()
      .references('id').inTable('system_account').onDelete('RESTRICT');
    t.string('model', 128).notNullable().defaultTo('');
    t.string('original_filename', 512).notNullable().defaultTo('');
    t.enu('status', [
      'accepted',
      'running',
      'waiting_executor',
      'cancelling',
      'cancelled',
      'completed',
      'completed_with_errors',
      'failed',
    ]).notNullable().defaultTo('accepted');
    t.datetime('cancel_requested_at', 3).nullable();
    t.text('error_message').nullable();
    t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
    t.unique(['idempotency_key'], 'uk_batch_job_idempotency');
    t.index(['status'], 'idx_batch_job_status');
    t.index(['created_at'], 'idx_batch_job_created');
    t.index(['function_id'], 'idx_batch_job_function');
  });

  await knex.schema.createTable('batch_recording_item', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.string('batch_id', 36).notNullable()
      .references('id').inTable('batch_recording_job').onDelete('CASCADE');
    t.integer('row_number').unsigned().notNullable()
      .comment('1-based Excel row number');
    t.string('name', 255).notNullable().defaultTo('');
    t.text('requirement').notNullable();
    t.enu('status', [
      'pending',
      'analyzing',
      'analyzed',
      'queued',
      'waiting_executor',
      'preparing',
      'recording',
      'recorded',
      'failed',
      'rejected',
      'cancelled',
    ]).notNullable().defaultTo('pending');
    t.json('analysis_json').nullable()
      .comment('{ phases, caseEntries } after LLM analyze');
    t.bigInteger('trajectory_id').unsigned().nullable()
      .references('id').inTable('trajectory').onDelete('SET NULL');
    t.string('error_code', 64).nullable();
    t.text('error_message').nullable();
    t.integer('attempt_count').unsigned().notNullable().defaultTo(0);
    t.datetime('next_attempt_at', 3).nullable();
    t.integer('version').unsigned().notNullable().defaultTo(1);
    t.string('worker_token', 64).nullable();
    t.datetime('lease_expires_at', 3).nullable();
    t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
    t.unique(['batch_id', 'row_number'], 'uk_batch_item_row');
    t.unique(['trajectory_id'], 'uk_batch_item_trajectory');
    t.index(['status', 'id'], 'idx_batch_item_status_fifo');
    t.index(['status', 'next_attempt_at'], 'idx_batch_item_retry');
    t.index(['worker_token'], 'idx_batch_item_worker');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('batch_recording_item');
  await knex.schema.dropTableIfExists('batch_recording_job');
}
