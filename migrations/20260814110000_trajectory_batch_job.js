/**
 * trajectory.batch_job_id — 所属批量导入任务（batch_recording_job.id，UUID）。
 * NULL = 用户手动创建。job.id 是 VARCHAR(36)，列类型必须一致。
 */
export async function up(knex) {
  await knex.schema.alterTable('trajectory', (t) => {
    // FK 要求两侧 collation 一致：batch_recording_job.id 为服务器默认 utf8mb4_0900_ai_ci（迁移 20260802140000 未钉 collation），本列显式对齐
    t.string('batch_job_id', 36).collate('utf8mb4_0900_ai_ci').nullable()
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
