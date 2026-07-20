/**
 * Add system.url for type=1 system nodes (system address).
 * Backfill from first non-empty system_account.login_url per system.
 */
export async function up(knex) {
  const hasUrl = await knex.schema.hasColumn('system', 'url');
  if (!hasUrl) {
    await knex.schema.alterTable('system', (t) => {
      t.string('url', 2048)
        .defaultTo('')
        .comment('系统地址/入口 URL（仅 type=1 系统节点有意义）')
        .after('description');
    });
    console.log('[migration] added system.url');
  }

  // Backfill: pick first non-empty account login_url per system
  const accounts = await knex('system_account')
    .select('system_id', 'login_url', 'sort_order', 'id')
    .whereNotNull('login_url')
    .andWhere('login_url', '!=', '')
    .orderBy([
      { column: 'system_id', order: 'asc' },
      { column: 'sort_order', order: 'asc' },
      { column: 'id', order: 'asc' },
    ]);

  const firstBySystem = new Map();
  for (const row of accounts) {
    const sid = Number(row.system_id);
    if (!firstBySystem.has(sid)) {
      firstBySystem.set(sid, String(row.login_url).trim());
    }
  }

  let n = 0;
  for (const [systemId, url] of firstBySystem) {
    if (!url) continue;
    const updated = await knex('system')
      .where({ id: systemId, type: 1 })
      .andWhere((qb) => {
        qb.whereNull('url').orWhere('url', '');
      })
      .update({ url });
    n += Number(updated) || 0;
  }
  console.log(`[migration] backfilled system.url from system_account (${n} systems)`);
}

export async function down(knex) {
  if (await knex.schema.hasColumn('system', 'url')) {
    await knex.schema.alterTable('system', (t) => {
      t.dropColumn('url');
    });
  }
}
