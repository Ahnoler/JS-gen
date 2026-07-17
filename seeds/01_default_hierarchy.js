/**
 * Seed: default hierarchy nodes in unified `system` table.
 * type 0/1/2 = 系统/流程/功能点. Idempotent.
 */
export async function seed(knex) {
  const existing = await knex('system')
    .where('system_id', '00000000-0000-0000-0000-000000000001')
    .first();

  if (existing) {
    console.log('[seed] Default hierarchy already present, skipping');
    return;
  }

  const [rootId] = await knex('system').insert({
    system_id: '00000000-0000-0000-0000-000000000001',
    type: 0,
    parent_id: null,
    name: '未分类',
    description: '默认系统分类，用于尚未分配系统的历史轨迹',
    sort_order: 0,
  });

  const [procId] = await knex('system').insert({
    system_id: '00000000-0000-0000-0000-000000000002',
    type: 1,
    parent_id: rootId,
    name: '未分类',
    description: '默认流程分类',
    sort_order: 0,
  });

  await knex('system').insert({
    system_id: '00000000-0000-0000-0000-000000000003',
    type: 2,
    parent_id: procId,
    name: '未分类',
    description: '默认功能分类',
    sort_order: 0,
  });

  console.log('[seed] Default hierarchy inserted (unified system table)');
}
