/**
 * Seed: Create default System → Process → Function for unclassified trajectories.
 * Idempotent: safe to re-run.
 */
export async function seed(knex) {
  const existing = await knex('system')
    .where('system_id', '00000000-0000-0000-0000-000000000001')
    .first();

  if (existing) {
    console.log('[seed] Default hierarchy already present, skipping');
    return;
  }

  const [systemId] = await knex('system').insert({
    system_id: '00000000-0000-0000-0000-000000000001',
    name: '未分类',
    description: '默认系统分类，用于尚未分配系统的历史轨迹',
  });

  const [processId] = await knex('process').insert({
    process_id: '00000000-0000-0000-0000-000000000002',
    system_id: systemId,
    name: '未分类',
    description: '默认流程分类',
    sort_order: 0,
  });

  await knex('function_def').insert({
    function_id: '00000000-0000-0000-0000-000000000003',
    process_id: processId,
    name: '未分类',
    description: '默认功能分类',
    sort_order: 0,
  });

  console.log('[seed] Default hierarchy inserted');
}
