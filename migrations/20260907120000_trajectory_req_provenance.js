/**
 * trajectory: req-slice provenance for draft trajectories generated from KB req workspaces.
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_atom_key');
  if (has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.string('req_module_key', 128).nullable()
      .comment('KB req moduleKey that sourced this draft');
    t.string('req_source_path', 1024).nullable()
      .comment('Requirement doc path/name from source.link.json');
    t.string('req_chapter_ref', 512).nullable()
      .comment('Chapter file + title path inside chapters/');
    t.string('req_atom_key', 191).nullable()
      .comment('Stable atom key from draft-traj propose');
    t.index(['req_module_key', 'req_atom_key'], 'traj_req_atom_idx');
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_atom_key');
  if (!has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropIndex(['req_module_key', 'req_atom_key'], 'traj_req_atom_idx');
    t.dropColumn('req_module_key');
    t.dropColumn('req_source_path');
    t.dropColumn('req_chapter_ref');
    t.dropColumn('req_atom_key');
  });
}
