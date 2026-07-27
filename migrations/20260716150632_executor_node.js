/**
 * executor_node — registered executor worker nodes.
 * remote_session — bind sessions to executor nodes (slot + client affinity).
 */
export async function up(knex) {
  const hasTable = await knex.schema.hasTable('executor_node');
  if (!hasTable) {
    await knex.schema.createTable('executor_node', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('node_uuid', 36).notNullable().comment('执行机自报 UUID，register 以此 upsert');
      t.string('name', 255).notNullable().comment('显示名');
      t.string('host', 255).defaultTo('').comment('内网标识/备注（非公网 CDP 地址）');
      t.enum('status', ['online', 'draining', 'offline']).notNullable().defaultTo('offline').comment('节点状态');
      t.integer('capacity').unsigned().notNullable().defaultTo(1).comment('最大槽位数（配置量；in_use 由 active 会话计数派生）');
      t.json('labels_json').nullable().comment('能力标签 { "os":"win", "headed":true, "chrome":"120" }');
      t.string('agent_version', 64).defaultTo('').comment('Agent 版本，灰度用');
      t.datetime('last_heartbeat_at', 3).nullable().comment('最近心跳时间');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(['node_uuid']);
      t.index(['status']);
      t.index(['last_heartbeat_at']);
    });
  }

  const hasExecutorCol = await knex.schema.hasColumn('remote_session', 'executor_node_id');
  if (!hasExecutorCol) {
    await knex.schema.alterTable('remote_session', (t) => {
      t.bigInteger('executor_node_id').unsigned().nullable()
        .comment('外键 → executor_node.id（会话所在执行机）');
      t.integer('slot_index').unsigned().nullable().comment('执行机内槽位号');
      t.string('client_key', 64).nullable().comment('前端会话/用户标识，用于亲和调度');
      t.index(['executor_node_id'], 'idx_executor_node_id');
      t.index(['client_key'], 'idx_client_key');
    });
    await knex.schema.alterTable('remote_session', (t) => {
      t.foreign('executor_node_id', 'fk_rs_executor_node')
        .references('id').inTable('executor_node').onDelete('SET NULL');
    });
  }
}

export async function down(knex) {
  const hasExecutorCol = await knex.schema.hasColumn('remote_session', 'executor_node_id');
  if (hasExecutorCol) {
    await knex.schema.alterTable('remote_session', (t) => {
      t.dropForeign('executor_node_id', 'fk_rs_executor_node');
      t.dropIndex(['executor_node_id'], 'idx_executor_node_id');
      t.dropIndex(['client_key'], 'idx_client_key');
      t.dropColumn('executor_node_id');
      t.dropColumn('slot_index');
      t.dropColumn('client_key');
    });
  }
  await knex.schema.dropTableIfExists('executor_node');
}
