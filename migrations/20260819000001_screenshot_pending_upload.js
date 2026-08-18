/**
 * Screenshot local pending upload support.
 *
 * When MinIO upload fails, screenshots are kept on local disk and marked
 * storage_type='local'. retry_count / last_retry_at drive the background
 * retry (3 minute interval, max 3 attempts).
 */

export async function up(knex) {
  if (!(await knex.schema.hasTable('screenshot'))) return;

  if (!(await knex.schema.hasColumn('screenshot', 'retry_count'))) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.integer('retry_count').notNullable().defaultTo(0)
        .comment('本地暂存后的补传重试次数')
        .after('storage_type');
    });
  }

  if (!(await knex.schema.hasColumn('screenshot', 'last_retry_at'))) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.datetime('last_retry_at', 3).nullable()
        .comment('最后一次补传尝试时间')
        .after('retry_count');
    });
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('screenshot'))) return;

  if (await knex.schema.hasColumn('screenshot', 'last_retry_at')) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.dropColumn('last_retry_at');
    });
  }
  if (await knex.schema.hasColumn('screenshot', 'retry_count')) {
    await knex.schema.alterTable('screenshot', (t) => {
      t.dropColumn('retry_count');
    });
  }
}
