/**
 * trajectory: provenance anchor columns (spec D2 Phase 1 / F-05).
 *
 * `req_source_hash` = sha256 of the resolved chapter file at propose time;
 * `req_chunk_id` = `<chapter-file-stem>#<h1-slug>` (slug via normalizeHint —
 * independent of source punctuation). commit re-checks the hash and skips
 * atoms whose chapter drifted (stale_chapter_ref).
 */
export async function up(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_source_hash');
  if (has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.string('req_source_hash', 64).nullable()
      .comment('sha256 of the resolved chapter file at propose time');
    t.string('req_chunk_id', 191).nullable()
      .comment('Chapter anchor: <file-stem>#<h1-slug>');
  });
}

export async function down(knex) {
  const has = await knex.schema.hasColumn('trajectory', 'req_source_hash');
  if (!has) return;
  await knex.schema.alterTable('trajectory', (t) => {
    t.dropColumn('req_source_hash');
    t.dropColumn('req_chunk_id');
  });
}
