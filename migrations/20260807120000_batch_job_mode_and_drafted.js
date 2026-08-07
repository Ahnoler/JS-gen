/**
 * batch_recording_job.mode + batch_recording_item status `drafted`
 */
export async function up(knex) {
  await knex.schema.alterTable('batch_recording_job', (t) => {
    t.enu('mode', ['record', 'draft']).notNullable().defaultTo('record')
      .after('original_filename')
      .comment('record = analyze→draft→record; draft = analyze→draft only');
  });

  // MySQL: alter enum to add drafted (Knex enu alter is limited — use raw)
  await knex.raw(`
    ALTER TABLE batch_recording_item
    MODIFY COLUMN status ENUM(
      'pending','analyzing','analyzed','queued','waiting_executor',
      'preparing','recording','recorded','drafted','failed','rejected','cancelled'
    ) NOT NULL DEFAULT 'pending'
  `);
}

export async function down(knex) {
  await knex.raw(`
    UPDATE batch_recording_item SET status = 'recorded' WHERE status = 'drafted'
  `);
  await knex.raw(`
    ALTER TABLE batch_recording_item
    MODIFY COLUMN status ENUM(
      'pending','analyzing','analyzed','queued','waiting_executor',
      'preparing','recording','recorded','failed','rejected','cancelled'
    ) NOT NULL DEFAULT 'pending'
  `);
  await knex.schema.alterTable('batch_recording_job', (t) => {
    t.dropColumn('mode');
  });
}
