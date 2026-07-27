/**
 * System (type=1) nodes use parent_id = 0 instead of NULL.
 * Drops self-FK so 0 is allowed (no row with id=0).
 */
export async function up(knex) {
  for (const name of ['fk_system_parent', 'system_parent_id_foreign']) {
    try {
      await knex.raw(`ALTER TABLE \`system\` DROP FOREIGN KEY \`${name}\``);
    } catch {
      /* ignore missing */
    }
  }

  // type=1 系统；兼容尚未迁完的旧 type=0 根节点
  await knex('system')
    .whereNull('parent_id')
    .whereIn('type', [0, 1])
    .update({ parent_id: 0 });

  console.log('[migrate] system parent_id: roots → 0 (FK dropped)');
}

export async function down(knex) {
  await knex('system')
    .where({ parent_id: 0 })
    .whereIn('type', [0, 1])
    .update({ parent_id: null });

  try {
    await knex.raw(
      'ALTER TABLE `system` ADD CONSTRAINT `fk_system_parent` '
      + 'FOREIGN KEY (`parent_id`) REFERENCES `system` (`id`) ON DELETE CASCADE',
    );
  } catch {
    /* ignore */
  }
}
