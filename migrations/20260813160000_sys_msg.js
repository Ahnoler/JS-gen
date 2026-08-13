/**
 * Product messages: sys_msg + first msg type (batch import) in sys_dict_*.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('sys_msg'))) {
    await knex.schema.createTable('sys_msg', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('msg_title', 128).notNullable().defaultTo('')
        .comment('展示标题；第一种=批量导入任务');
      t.text('msg_content').notNullable()
        .comment('两行 HTML：功能·文件·状态 / 统计；用户字段已转义');
      t.integer('msg_type').notNullable()
        .comment('sys_dict_data.dict_value (sys_msg_type)');
      t.specificType('msg_status', 'tinyint').notNullable().defaultTo(0)
        .comment('0未读 2已读（现阶段全局）');
      t.string('link_url', 512).notNullable().defaultTo('');
      t.string('belong_item_name', 255).notNullable().defaultTo('')
        .comment('功能名');
      t.bigInteger('belong_item_id').unsigned().nullable()
        .comment('system.id type=3');
      t.string('source_type', 32).notNullable().defaultTo('')
        .comment('batch_import');
      t.string('source_id', 64).notNullable().defaultTo('')
        .comment('batch UUID');
      t.string('product_code', 64).nullable().comment('挂起');
      t.string('create_by', 64).notNullable().defaultTo('系统');
      t.bigInteger('user_id').unsigned().nullable().comment('挂起');
      t.specificType('user_flag', 'tinyint').nullable().comment('挂起');
      t.bigInteger('rule_id').unsigned().nullable().comment('挂起');
      t.string('remark', 500).nullable();
      t.datetime('create_time', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('update_time', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(['source_type', 'source_id'], 'uk_sys_msg_source');
      t.index(['create_time'], 'idx_sys_msg_created');
      t.index(['msg_status'], 'idx_sys_msg_status');
    });
  }

  if (await knex.schema.hasTable('sys_dict_type')) {
    const typeRow = await knex('sys_dict_type').where({ dict_type: 'sys_msg_type' }).first();
    if (!typeRow) {
      await knex('sys_dict_type').insert({
        dict_name: '消息类型',
        dict_type: 'sys_msg_type',
        status: '0',
        create_by: '',
        update_by: '',
        remark: '产品消息抽屉 msgType',
      });
    }
  }

  if (await knex.schema.hasTable('sys_dict_data')) {
    const dataRow = await knex('sys_dict_data')
      .where({ dict_type: 'sys_msg_type', dict_value: '1' })
      .first();
    if (!dataRow) {
      await knex('sys_dict_data').insert({
        dict_sort: 1,
        dict_label: '批量导入任务',
        dict_value: '1',
        dict_type: 'sys_msg_type',
        status: '0',
        is_default: 'N',
        create_by: '',
        update_by: '',
      });
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('sys_dict_data')) {
    await knex('sys_dict_data').where({ dict_type: 'sys_msg_type' }).del();
  }
  if (await knex.schema.hasTable('sys_dict_type')) {
    await knex('sys_dict_type').where({ dict_type: 'sys_msg_type' }).del();
  }
  await knex.schema.dropTableIfExists('sys_msg');
}
