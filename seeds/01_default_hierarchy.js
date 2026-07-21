/**
 * Seed: sentinel root (id=0) + default 未分类 hierarchy.
 * type 0/1/2/3 = 根/系统/模块/功能. Idempotent.
 */
export async function seed(knex) {
  const rootExisting = await knex('system').where({ id: 0 }).first();
  if (!rootExisting) {
    await knex.raw("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_AUTO_VALUE_ON_ZERO')");
    await knex('system').insert({
      id: 0,
      system_id: '00000000-0000-0000-0000-000000000000',
      type: 0,
      parent_id: 0,
      name: '根',
      description: '系统树根节点（不可删除）',
      url: '',
      sort_order: 0,
    });
    console.log('[seed] Root node id=0 inserted');
  }

  const existing = await knex('system')
    .where('system_id', '00000000-0000-0000-0000-000000000001')
    .first();

  if (existing) {
    console.log('[seed] Default hierarchy already present, skipping');
    return;
  }

  const [sysId] = await knex('system').insert({
    system_id: '00000000-0000-0000-0000-000000000001',
    type: 1,
    parent_id: 0,
    name: '未分类',
    description: '默认系统分类，用于尚未分配系统的历史轨迹',
    sort_order: 0,
  });

  const [procId] = await knex('system').insert({
    system_id: '00000000-0000-0000-0000-000000000002',
    type: 2,
    parent_id: sysId,
    name: '未分类',
    description: '默认流程分类',
    sort_order: 0,
  });

  await knex('system').insert({
    system_id: '00000000-0000-0000-0000-000000000003',
    type: 3,
    parent_id: procId,
    name: '未分类',
    description: '默认功能分类',
    sort_order: 0,
  });

  console.log('[seed] Default hierarchy inserted (unified system table)');
}
