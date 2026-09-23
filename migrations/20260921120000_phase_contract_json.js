/**
 * trajectory_phase.contract_json — 分析侧签下的阶段合约（方案 D v1）。空则录制时走文本分类。
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('trajectory_phase'))) return;
  if (await knex.schema.hasColumn('trajectory_phase', 'contract_json')) return;
  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.json('contract_json').nullable()
      .comment('阶段合约 v1 {v,mode,refill,submitRequired,successWhen,source}；空则录制兜底');
  });
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('trajectory_phase'))) return;
  if (!(await knex.schema.hasColumn('trajectory_phase', 'contract_json'))) return;
  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.dropColumn('contract_json');
  });
}
