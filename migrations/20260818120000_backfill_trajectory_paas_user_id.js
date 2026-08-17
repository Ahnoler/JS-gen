/**
 * 存量数据回填：trajectory / batch_recording_job 的 paas_user_id 归到账号中心用户
 * 1510076810578644992（admin，隔离启用前的存量数据全部归管理员可见）。
 *
 * 仅回填 paas_user_id IS NULL 的行（幂等）；空=无主=全可见的语义在回填后不再适用
 * 于存量数据——所有存量交易/批量导入任务归属 admin。
 *
 * down 为 no-op：数据回填不可逆（无法区分回填行与业务写入行），与
 * 20260814100000_batch_job_name.js 先例一致（down 只回滚 schema，数据不回滚）。
 */
export async function up(knex) {
  if (await knex.schema.hasTable('trajectory')) {
    await knex('trajectory')
      .whereNull('paas_user_id')
      .update({ paas_user_id: '1510076810578644992' });
  }
  if (await knex.schema.hasTable('batch_recording_job')) {
    await knex('batch_recording_job')
      .whereNull('paas_user_id')
      .update({ paas_user_id: '1510076810578644992' });
  }
}

export async function down() {
  // no-op：数据回填不可逆
}
