/**
 * batch_recording_job.name — 任务名称（默认 文件名_MMDD-HHmm）。
 * 存量行按同一公式回填（与运行时创建共用 batch-job-name.js）。
 */
import { defaultJobName } from '../src/services/trajectory/batch-job-name.js';

export async function up(knex) {
  await knex.schema.alterTable('batch_recording_job', (t) => {
    t.string('name', 512).notNullable().defaultTo('')
      .after('original_filename')
      .comment('任务名称；默认 文件名_MMDD-HHmm');
  });

  const rows = await knex('batch_recording_job').select('id', 'original_filename', 'created_at');
  for (const row of rows) {
    const name = defaultJobName(row.original_filename, row.created_at);
    await knex('batch_recording_job').where({ id: row.id }).update({ name });
  }
}

export async function down(knex) {
  await knex.schema.alterTable('batch_recording_job', (t) => {
    t.dropColumn('name');
  });
}
