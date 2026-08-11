/**
 * remote_session.grace_until — streamDetach ownership window.
 * Also one-shot backfill for cross-link / half-empty mounts (truth = trajectory_id).
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('remote_session', 'grace_until');
  if (!has) {
    await knex.schema.alterTable('remote_session', (t) => {
      t.datetime('grace_until', { precision: 3 }).nullable()
        .comment('streamDetach 宽限截止；期内仍属 trajectory_id；到期后清空归属')
        .after('trajectory_id');
      t.index(['grace_until'], 'idx_rs_grace_until');
    });
  }

  // Cross-link: traj cache points at rs owned by another traj → clear cache (+ demote live)
  const cross = await knex('trajectory as t')
    .join('remote_session as rs', 'rs.id', 't.remote_session_id')
    .whereNotNull('rs.trajectory_id')
    .whereRaw('rs.trajectory_id <> t.id')
    .select('t.id as tid', 't.record_status as recordStatus');
  for (const row of cross) {
    const patch = { remote_session_id: null, updated_at: knex.fn.now() };
    if (row.recordStatus === 'live') patch.record_status = 'draft';
    await knex('trajectory').where({ id: row.tid }).update(patch);
  }

  // Half-empty: traj → rs, rs.trajectory_id NULL, rs still occupied → set truth to traj
  // Prefer lowest traj id if multiple caches point at same rs (exclusive).
  const half = await knex('trajectory as t')
    .join('remote_session as rs', 'rs.id', 't.remote_session_id')
    .whereNull('rs.trajectory_id')
    .whereIn('rs.status', ['active', 'idle'])
    .select('t.id as tid', 'rs.id as rid')
    .orderBy(['rs.id', 't.id']);
  const claimed = new Set();
  for (const row of half) {
    if (claimed.has(row.rid)) {
      await knex('trajectory').where({ id: row.tid }).update({
        remote_session_id: null,
        updated_at: knex.fn.now(),
      });
      continue;
    }
    claimed.add(row.rid);
    await knex('remote_session').where({ id: row.rid }).update({ trajectory_id: row.tid });
  }

  // Cache → closed/crashed → clear (per-row; MySQL driver rejects multi-table join update)
  const stale = await knex('trajectory as t')
    .join('remote_session as rs', 'rs.id', 't.remote_session_id')
    .whereIn('rs.status', ['closed', 'crashed'])
    .select('t.id as tid');
  for (const row of stale) {
    await knex('trajectory').where({ id: row.tid }).update({
      remote_session_id: null,
      updated_at: knex.fn.now(),
    });
  }
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('remote_session', 'grace_until');
  if (!has) return;
  await knex.schema.alterTable('remote_session', (t) => {
    t.dropIndex(['grace_until'], 'idx_rs_grace_until');
    t.dropColumn('grace_until');
  });
}
