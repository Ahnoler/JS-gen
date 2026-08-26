/**
 * trajectory.batch_job_id — 所属批量导入任务（batch_recording_job.id，UUID）。
 * NULL = 用户手动创建。job.id 是 VARCHAR(36)，列类型必须一致。
 */
export async function up(knex) {
  await knex.schema.alterTable('trajectory', (t) => {
    // 不显式钉 collation：继承 trajectory 表默认（utf8mb4_general_ci），与 batch_recording_job.id 一致，FK 可建。
    // 勿用 utf8mb4_0900_ai_ci——那是 MySQL 8.0 专有 collation，服务器 MySQL 5.7 会报 Unknown collation。
    t.string('batch_job_id', 36).nullable()
      .comment('所属批量导入任务（batch_recording_job.id，UUID）；NULL=手动创建');
    t.index(['batch_job_id'], 'idx_batch_job_id');
  });
  await knex.raw(`
    ALTER TABLE trajectory
      ADD CONSTRAINT fk_traj_batch_job
      FOREIGN KEY (batch_job_id) REFERENCES batch_recording_job (id)
      ON DELETE SET NULL
  `);
}

export async function down(knex) {
  await knex.raw('ALTER TABLE trajectory DROP FOREIGN KEY fk_traj_batch_job');
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropIndex('idx_batch_job_id');
    t.dropColumn('batch_job_id');
  });
}
