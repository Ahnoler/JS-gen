/**
 * Repair hierarchy node types after older migrations left mislabeled rows:
 *   - id=0 must be type=0 根
 *   - direct children of 根 (id≠0) must be type=1 系统
 *   - direct children of 系统 must be type=2 模块 (not 功能)
 *
 * Idempotent. Does not move parent_id links — only corrects `type`.
 *
 * Observed broken shape (example):
 *   0 系统树 type=1,  1 信贷系统 type=2 parent=0,  4 客户管理 type=3 parent=1
 * Expected:
 *   0 根 type=0,  1 信贷系统 type=1 parent=0,  4 客户管理 type=2 parent=1
 */
const ROOT_ID = 0;
const TYPE_ROOT = 0;
const TYPE_SYSTEM = 1;
const TYPE_MODULE = 2;
const TYPE_FUNCTION = 3;

export async function up(knex) {
  // 1) Sentinel root
  const root = await knex('system').where({ id: ROOT_ID }).first();
  if (root && Number(root.type) !== TYPE_ROOT) {
    const patch = { type: TYPE_ROOT, parent_id: ROOT_ID };
    if (!root.name || root.name === '系统树') patch.name = '根';
    await knex('system').where({ id: ROOT_ID }).update(patch);
    console.log(`[migrate] repaired root id=0 type → ${TYPE_ROOT}`);
  }

  // 2) Top-level under 根 → 系统
  const systemsUpdated = await knex('system')
    .where({ parent_id: ROOT_ID })
    .andWhereNot({ id: ROOT_ID })
    .whereNot({ type: TYPE_SYSTEM })
    .update({ type: TYPE_SYSTEM });
  if (systemsUpdated) {
    console.log(`[migrate] repaired top-level nodes → type=${TYPE_SYSTEM} (${systemsUpdated} rows)`);
  }

  // Also treat legacy NULL parent as under root (except id=0)
  const nullParentUpdated = await knex('system')
    .whereNull('parent_id')
    .andWhereNot({ id: ROOT_ID })
    .update({ parent_id: ROOT_ID, type: TYPE_SYSTEM });
  if (nullParentUpdated) {
    console.log(`[migrate] null parent_id → parent=0 type=系统 (${nullParentUpdated} rows)`);
  }

  // 3) Direct children of 系统 that are labeled 功能 → 模块
  const systemIds = (
    await knex('system').select('id').where({ type: TYPE_SYSTEM }).andWhereNot({ id: ROOT_ID })
  ).map((r) => r.id);

  let modulesUpdated = 0;
  if (systemIds.length) {
    modulesUpdated = await knex('system')
      .whereIn('parent_id', systemIds)
      .where({ type: TYPE_FUNCTION })
      .update({ type: TYPE_MODULE });
    if (modulesUpdated) {
      console.log(`[migrate] children of 系统: type 功能→模块 (${modulesUpdated} rows)`);
    }
  }

  console.log(
    `[migrate] repair_hierarchy_node_types done `
    + `(systems=${systemsUpdated || 0}, `
    + `nullParent=${nullParentUpdated || 0}, modules=${modulesUpdated || 0})`,
  );
}

export async function down() {
  // Irreversible data correction — no-op
}
