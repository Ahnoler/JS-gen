/**
 * system 表菜单推送状态列（D1/D2）：仅系统节点有意义。
 * hasColumn 幂等；参照 20260831100000_menu_offline_flag.js。
 */
export async function up(knex) {
  const cols = [
    { name: 'menu_push_status', build: (t) => t.string('menu_push_status', 16).notNullable().defaultTo('').comment('idle/pushing/synced/failed；空串=idle') },
    { name: 'menu_push_version', build: (t) => t.integer('menu_push_version').notNullable().defaultTo(0).comment('最近推送 menuVersion') },
    { name: 'menu_push_at', build: (t) => t.dateTime('menu_push_at').nullable().comment('进入 pushing 时间') },
    { name: 'menu_push_synced_at', build: (t) => t.dateTime('menu_push_synced_at').nullable().comment('进入 synced 时间') },
    { name: 'menu_push_error', build: (t) => t.string('menu_push_error', 512).notNullable().defaultTo('').comment('失败信息') },
  ];
  for (const col of cols) {
    if (!(await knex.schema.hasColumn('system', col.name))) {
      await knex.schema.alterTable('system', (t) => { col.build(t); });
      console.log('[migration] added system.%s', col.name);
    }
  }
}

export async function down(knex) {
  for (const name of ['menu_push_error', 'menu_push_synced_at', 'menu_push_at', 'menu_push_version', 'menu_push_status']) {
    if (await knex.schema.hasColumn('system', name)) {
      await knex.schema.alterTable('system', (t) => t.dropColumn(name));
      console.log('[migration] dropped system.%s', name);
    }
  }
}
