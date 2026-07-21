/**
 * Merge process + function_def into unified `system` table (type 0/1/2).
 * Safe to re-run: no-ops when process/function_def already gone.
 */
export async function up(knex) {
  const hasProcess = await knex.schema.hasTable('process');
  const hasFunction = await knex.schema.hasTable('function_def');
  const hasTypeCol = await knex.schema.hasColumn('system', 'type');

  if (!hasTypeCol) {
    await knex.schema.alterTable('system', (t) => {
      t.specificType('type', 'tinyint').notNullable().defaultTo(0);
      t.bigInteger('parent_id').unsigned().nullable();
      t.integer('sort_order').unsigned().defaultTo(0);
    });
    // Drop unique name if present (siblings may share「未分类」)
    try {
      await knex.raw('ALTER TABLE `system` DROP INDEX `uk_name`');
    } catch {
      /* ignore */
    }
    try {
      await knex.raw('ALTER TABLE `system` DROP INDEX `system_name_unique`');
    } catch {
      /* ignore */
    }
    await knex.raw('UPDATE `system` SET `type` = 0 WHERE `type` IS NULL OR `parent_id` IS NULL');
    await knex.raw('ALTER TABLE `system` ADD INDEX `idx_type` (`type`)');
    await knex.raw('ALTER TABLE `system` ADD INDEX `idx_parent_id` (`parent_id`)');
  }

  // parent_id=0 marks type=系统 roots; do not add self-FK (0 is not a real row id)
  // See migrations/20260720_system_parent_id_zero.js

  if (!hasProcess && !hasFunction) {
    console.log('[migrate] hierarchy already unified');
    return;
  }

  const processIdMap = new Map(); // old process.id → new system.id
  const functionIdMap = new Map(); // old function_def.id → new system.id

  if (hasProcess) {
    const processes = await knex('process').select('*');
    for (const p of processes) {
      // Prefer reuse by UUID if already migrated
      const existing = await knex('system').where({ system_id: p.process_id }).first();
      if (existing) {
        processIdMap.set(p.id, existing.id);
        continue;
      }
      const [newId] = await knex('system').insert({
        system_id: p.process_id,
        type: 1,
        parent_id: p.system_id,
        name: p.name,
        description: p.description,
        sort_order: p.sort_order ?? 0,
        created_at: p.created_at,
        updated_at: p.updated_at,
      });
      processIdMap.set(p.id, newId);
    }
  }

  if (hasFunction) {
    const functions = await knex('function_def').select('*');
    for (const f of functions) {
      const existing = await knex('system').where({ system_id: f.function_id }).first();
      if (existing) {
        functionIdMap.set(f.id, existing.id);
        continue;
      }
      const parentId = processIdMap.get(f.process_id);
      if (parentId == null) {
        console.warn('[migrate] skip function without mapped process:', f.id, f.name);
        continue;
      }
      const [newId] = await knex('system').insert({
        system_id: f.function_id,
        type: 2,
        parent_id: parentId,
        name: f.name,
        description: f.description,
        sort_order: f.sort_order ?? 0,
        created_at: f.created_at,
        updated_at: f.updated_at,
      });
      functionIdMap.set(f.id, newId);
    }
  }

  // Remap trajectory.function_id
  if (functionIdMap.size) {
    try {
      await knex.raw('ALTER TABLE `trajectory` DROP FOREIGN KEY `fk_traj_function`');
    } catch {
      /* ignore */
    }

    const trajs = await knex('trajectory').whereNotNull('function_id').select('id', 'function_id');
    for (const t of trajs) {
      const mapped = functionIdMap.get(t.function_id);
      if (mapped != null) {
        await knex('trajectory').where({ id: t.id }).update({ function_id: mapped });
      } else {
        // Already points at system.id or orphan — leave if exists in system
        const ok = await knex('system').where({ id: t.function_id }).first();
        if (!ok) await knex('trajectory').where({ id: t.id }).update({ function_id: null });
      }
    }

    try {
      await knex.raw(
        'ALTER TABLE `trajectory` ADD CONSTRAINT `fk_traj_function` '
        + 'FOREIGN KEY (`function_id`) REFERENCES `system` (`id`) ON DELETE SET NULL',
      );
    } catch {
      /* ignore */
    }
  }

  if (hasFunction) await knex.schema.dropTableIfExists('function_def');
  if (hasProcess) await knex.schema.dropTableIfExists('process');

  console.log(
    `[migrate] merged hierarchy: processes=${processIdMap.size}, functions=${functionIdMap.size}`,
  );
}

export async function down() {
  throw new Error('Irreversible: hierarchy merge cannot be automatically rolled back');
}
