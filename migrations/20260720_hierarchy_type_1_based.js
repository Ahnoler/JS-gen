/**
 * Remap hierarchy node types: 0/1/2 → 1/2/3 (系统/模块/功能).
 * Idempotent: only runs when any type=0 row still exists.
 */
export async function up(knex) {
  const hasLegacy = await knex('system').where('type', 0).first();
  if (!hasLegacy) {
    console.log('[migration] hierarchy types already 1/2/3, skipping');
    return;
  }

  // Single UPDATE: 0→1, 1→2, 2→3
  const result = await knex.raw(
    'UPDATE `system` SET `type` = `type` + 1 WHERE `type` IN (0, 1, 2)',
  );
  const n = result?.[0]?.affectedRows ?? result?.[0]?.info ?? '?';
  console.log(`[migration] remapped system.type 0/1/2 → 1/2/3 (${n} rows)`);

  try {
    await knex.raw(`ALTER TABLE \`system\` MODIFY COLUMN \`type\` TINYINT NOT NULL COMMENT '1=系统 2=模块 3=功能'`);
  } catch (err) {
    console.warn('[migration] skip alter type comment:', err.message);
  }
}

export async function down(knex) {
  const hasNew = await knex('system').where('type', 3).first();
  if (!hasNew) {
    console.log('[migration] no type=3 rows, skip down');
    return;
  }

  await knex.raw(
    'UPDATE `system` SET `type` = `type` - 1 WHERE `type` IN (1, 2, 3)',
  );

  try {
    await knex.raw(`ALTER TABLE \`system\` MODIFY COLUMN \`type\` TINYINT NOT NULL COMMENT '0=系统 1=模块 2=功能'`);
  } catch (err) {
    console.warn('[migration] skip alter type comment:', err.message);
  }
}
