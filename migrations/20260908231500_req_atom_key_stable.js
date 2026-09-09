/**
 * trajectory: stabilize historical req_atom_key values (drop title suffix).
 *
 * Legacy keys were `<module>:<chain>:<step>:<title-slug>` — LLM re-runs rephrased
 * titles and produced new identities for the same step (spec F-01). New keys are
 * `<module>:<chain>:<step>`; this migration truncates legacy keys to their first
 * three colon-separated parts (safe: slugPart already normalizes ':' to '-'
 * inside each part, so parts can only be the four identity segments).
 *
 * NOT REVERSIBLE: the title slug cannot be reconstructed from a truncated key.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_atom_key');
  if (!has) return;
  const rows = await knex('trajectory')
    .select('id', 'req_atom_key')
    .whereNotNull('req_atom_key');
  for (const row of rows) {
    const key = String(row.req_atom_key || '');
    if (key.split(':').length <= 3) continue;
    await knex('trajectory')
      .where({ id: row.id })
      .update({ req_atom_key: key.split(':').slice(0, 3).join(':') });
  }
}

// down: intentionally not restorable — the dropped title slug is unrecoverable.
export async function down() {
  // no-op by design (see header)
}
