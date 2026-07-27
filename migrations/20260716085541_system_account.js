/**
 * system_account — per-system test login credentials (multi-role).
 * Also drops login_* columns from `system` if a prior mistaken migration added them.
 */
export async function up(knex) {
  if (await knex.schema.hasColumn('system', 'login_url')) {
    await knex.schema.alterTable('system', (t) => {
      t.dropColumn('login_url');
      t.dropColumn('username');
      t.dropColumn('password');
      t.dropColumn('remark');
    });
  }

  const exists = await knex.schema.hasTable('system_account');
  if (!exists) {
    await knex.schema.createTable('system_account', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('system_id').unsigned().notNullable()
        .references('id').inTable('system').onDelete('CASCADE');
      t.string('name', 255).notNullable().comment('角色名：管理员/测试人员/…');
      t.string('login_url', 2048).defaultTo('').comment('登录/入口网址');
      t.string('username', 255).defaultTo('').comment('测试账号');
      t.string('password', 255).defaultTo('').comment('测试密码');
      t.text('remark').nullable().comment('备注（权限说明等）');
      t.integer('sort_order').unsigned().defaultTo(0);
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(['system_id', 'name']);
      t.index(['system_id']);
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('system_account');
}
