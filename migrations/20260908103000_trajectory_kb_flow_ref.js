/**
 * trajectory: KB flow-card refs for atomic draft recording templates.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'kb_flow_ref');
  if (has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.string('kb_flow_ref', 191).nullable()
      .comment('KB flow card filename stem under data/kb/flows');
    t.string('kb_flow_node_id', 128).nullable()
      .comment('Optional nodes[].id within the flow card');
    t.index(['kb_flow_ref'], 'traj_kb_flow_ref_idx');
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'kb_flow_ref');
  if (!has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropIndex(['kb_flow_ref'], 'traj_kb_flow_ref_idx');
    t.dropColumn('kb_flow_ref');
    t.dropColumn('kb_flow_node_id');
  });
}
