/**
 * trajectory: DB-level idempotency for req draft atoms (spec D1 / F-02).
 *
 * Adds `req_atom_seq int not null default 0` plus unique index
 * `traj_req_atom_uq(req_module_key, req_atom_key, req_atom_seq)` so the same
 * (module, atom) can only exist once at seq 0 — force re-commits take
 * max(seq)+1. MySQL unique indexes tolerate multiple NULL key parts, so
 * trajectories created outside the req pipeline are unaffected.
 *
 * Pre-check: existing duplicates on (req_module_key, req_atom_key) abort the
 * migration with the offending rows — they must be merged by a human first.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_atom_seq');
  if (has) return;
  const dup = await knex('trajectory')
    .select('req_module_key', 'req_atom_key')
    .count({ c: '*' })
    .whereNotNull('req_atom_key')
    .groupBy('req_module_key', 'req_atom_key')
    .havingRaw('COUNT(*) > 1');
  if (dup.length) {
    throw new Error('duplicate req_atom_key rows exist; resolve manually before adding the unique index: '
      + JSON.stringify(dup));
  }
  await knex.schema.alterTable('trajectory', (t) => {
    t.integer('req_atom_seq').notNullable().defaultTo(0)
      .comment('Force re-commit sequence within (req_module_key, req_atom_key)');
    t.unique(['req_module_key', 'req_atom_key', 'req_atom_seq'], { indexName: 'traj_req_atom_uq' });
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_atom_seq');
  if (!has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropUnique(['req_module_key', 'req_atom_key', 'req_atom_seq'], 'traj_req_atom_uq');
    t.dropColumn('req_atom_seq');
  });
}
