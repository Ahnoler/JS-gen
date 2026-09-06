/**
 * trajectory / batch_recording_job 加 paas_user_id（账号中心用户 id，字符串，可空）。
 * 空=无主=全可见（存量兼容 + 管理员视角；PR-SSO-ADMIN 出结论后再收紧）。
 */
export async function up(knex) {
  if (await knex.schema.hasTable('trajectory')) {
    if (!(await knex.schema.hasColumn('trajectory', 'paas_user_id'))) {
      await knex.schema.alterTable('trajectory', (t) => {
        t.string('paas_user_id', 32).nullable().after('batch_job_id');
        t.index(['paas_user_id'], 'idx_trajectory_paas_user_id');
      });
    }
  }
  if (await knex.schema.hasTable('batch_recording_job')) {
    if (!(await knex.schema.hasColumn('batch_recording_job', 'paas_user_id'))) {
      await knex.schema.alterTable('batch_recording_job', (t) => {
        t.string('paas_user_id', 32).nullable().after('name');
        t.index(['paas_user_id'], 'idx_batch_job_paas_user_id');
      });
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('trajectory')) {
    if (await knex.schema.hasColumn('trajectory', 'paas_user_id')) {
      await knex.schema.alterTable('trajectory', (t) => t.dropColumn('paas_user_id'));
    }
  }
  if (await knex.schema.hasTable('batch_recording_job')) {
    if (await knex.schema.hasColumn('batch_recording_job', 'paas_user_id')) {
      await knex.schema.alterTable('batch_recording_job', (t) => t.dropColumn('paas_user_id'));
    }
  }
}
