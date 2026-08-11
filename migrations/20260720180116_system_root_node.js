/**
 * Ensure sentinel root row system.id = 0 exists.
 * type=0「根」; type=1 系统节点 parent_id → 0.
 * Re-adds self-FK once the root row exists.
 */
const ROOT_ID = 0;
const ROOT_UUID = '00000000-0000-0000-0000-000000000000';
const TYPE_ROOT = 0;
const TYPE_SYSTEM = 1;

export async function up(knex) {
  await knex('system')
    .whereNull('parent_id')
    .whereIn('type', [TYPE_SYSTEM, TYPE_ROOT])
    .andWhereNot('id', ROOT_ID)
    .update({ parent_id: ROOT_ID });

  const existing = await knex('system').where({ id: ROOT_ID }).first();
  if (!existing) {
    await knex.raw("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_AUTO_VALUE_ON_ZERO')");
    // url is added by 20260720161449_system_url (runs before this migration).
    const row = {
      id: ROOT_ID,
      system_id: ROOT_UUID,
      type: TYPE_ROOT,
      parent_id: ROOT_ID,
      name: '根',
      description: '系统树根节点（不可删除）',
      sort_order: 0,
    };
    if (await knex.schema.hasColumn('system', 'url')) {
      row.url = '';
    }
    await knex('system').insert(row);
    console.log('[migrate] inserted system id=0 root');
  } else {
    console.log('[migrate] system id=0 root already present');
  }

  for (const name of ['fk_system_parent', 'system_parent_id_foreign']) {
    try {
      await knex.raw(`ALTER TABLE \`system\` DROP FOREIGN KEY \`${name}\``);
    } catch {
      /* ignore */
    }
  }
  try {
    await knex.raw(
      'ALTER TABLE `system` ADD CONSTRAINT `fk_system_parent` '
      + 'FOREIGN KEY (`parent_id`) REFERENCES `system` (`id`) ON DELETE CASCADE',
    );
    console.log('[migrate] restored fk_system_parent');
  } catch (e) {
    console.log('[migrate] fk_system_parent skip:', String(e.message).split('\n')[0]);
  }
}

export async function down(knex) {
  try {
    await knex.raw('ALTER TABLE `system` DROP FOREIGN KEY `fk_system_parent`');
  } catch {
    /* ignore */
  }
  await knex('system').where({ id: ROOT_ID }).del();
}
