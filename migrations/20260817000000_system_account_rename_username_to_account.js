/**
 * system_account: rename column `username` → `account`.
 *
 * API/JS entity uses camelCase `account`; DAO maps it to `account` naturally,
 * so only the physical column and in-memory shapes need to change.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('system_account'))) return;

  const hasUsername = await knex.schema.hasColumn('system_account', 'username');
  const hasAccount = await knex.schema.hasColumn('system_account', 'account');
  if (hasUsername && !hasAccount) {
    await knex.schema.alterTable('system_account', (t) => {
      t.renameColumn('username', 'account');
    });
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('system_account'))) return;

  const hasUsername = await knex.schema.hasColumn('system_account', 'username');
  const hasAccount = await knex.schema.hasColumn('system_account', 'account');
  if (hasAccount && !hasUsername) {
    await knex.schema.alterTable('system_account', (t) => {
      t.renameColumn('account', 'username');
    });
  }
}
