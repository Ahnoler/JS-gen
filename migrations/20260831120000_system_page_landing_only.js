/**
 * 菜单落地 pageId 单一化存量清理：
 * 1) 删除 page_type='guidePage'
 * 2) 同一 system_node_id 多行时只留一行（优先 managePage，同类型取最小 id）
 * 3) 按保留行回写 system.pd_cmpt_ecd；无行则置 ''
 * 不修改 trajectory.page_id。
 *
 * down：不可无损恢复已删 guidePage，仅 log 说明（no-op）。
 */

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
export async function up(knex) {
  // Nodes that currently have any system_page row (including guide-only) — must sync after cleanup
  const affectedBefore = await knex('system_page').distinct('system_node_id').pluck('system_node_id');
  const touchIds = new Set(affectedBefore.map(Number));

  const deletedGuides = await knex('system_page').where({ page_type: 'guidePage' }).del();
  console.log('[migration] system_page: deleted guidePage rows=%s', deletedGuides);

  const dupes = await knex('system_page')
    .select('system_node_id')
    .groupBy('system_node_id')
    .havingRaw('COUNT(*) > 1');

  let collapsed = 0;
  for (const row of dupes) {
    const nodeId = Number(row.system_node_id);
    touchIds.add(nodeId);
    const pages = await knex('system_page')
      .where({ system_node_id: nodeId })
      .orderBy([{ column: 'id', order: 'asc' }]);
    const keep =
      pages.find((p) => String(p.page_type) === 'managePage') || pages[0];
    if (!keep) continue;
    const removed = await knex('system_page')
      .where({ system_node_id: nodeId })
      .whereNot({ id: keep.id })
      .del();
    collapsed += removed;
  }
  console.log('[migration] system_page: collapsed extra rows=%s', collapsed);

  const kept = await knex('system_page').select('system_node_id', 'page_id');
  const byNode = new Map();
  for (const p of kept) {
    byNode.set(Number(p.system_node_id), String(p.page_id || ''));
  }
  // Only sync nodes that had system_page before/during this migration — never blanket-clear unrelated system rows
  let synced = 0;
  for (const id of touchIds) {
    const next = byNode.has(id) ? byNode.get(id) : '';
    await knex('system').where({ id }).update({ pd_cmpt_ecd: next });
    synced += 1;
  }
  console.log('[migration] system: synced pd_cmpt_ecd for nodes=%s', synced);
}

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
export async function down(knex) {
  console.log('[migration] system_page_landing_only: down is no-op (guidePage rows not restored)');
}
