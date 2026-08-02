/**
 * Special element library + company-style sys_dict_* tables.
 * - sys_dict_type / sys_dict_data (seed special_element_tag)
 * - special_element / special_element_step
 * - trajectory_step.source += special_element
 * - trajectory_phase.special_element_candidates_json
 */

export async function up(knex) {
  await knex.schema.createTable('sys_dict_type', (t) => {
    t.bigIncrements('dict_id').primary().comment('字典主键');
    t.string('dict_name', 100).defaultTo('').comment('字典名称');
    t.string('dict_type', 100).defaultTo('').comment('字典类型');
    t.specificType('status', "char(1)").defaultTo('0').comment('状态（0正常 1停用）');
    t.string('create_by', 64).defaultTo('').comment('创建者');
    t.datetime('create_time').defaultTo(knex.fn.now()).comment('创建时间');
    t.string('update_by', 64).defaultTo('').comment('更新者');
    t.datetime('update_time').defaultTo(knex.fn.now()).comment('更新时间');
    t.string('remark', 500).nullable().comment('备注');
    t.unique(['dict_type'], 'dict_type');
  });

  await knex.schema.createTable('sys_dict_data', (t) => {
    t.bigIncrements('dict_code').primary().comment('字典编码');
    t.integer('dict_sort').defaultTo(0).comment('字典排序');
    t.string('dict_label', 100).defaultTo('').comment('字典标签');
    t.string('dict_value', 255).defaultTo('').comment('字典键值');
    t.string('dict_type', 100).defaultTo('').comment('字典类型');
    t.string('css_class', 100).nullable().comment('样式属性');
    t.string('list_class', 100).nullable().comment('表格回显样式');
    t.specificType('is_default', "char(1)").defaultTo('N').comment('是否默认（Y是 N否）');
    t.specificType('status', "char(1)").defaultTo('0').comment('状态（0正常 1停用）');
    t.string('create_by', 64).defaultTo('').comment('创建者');
    t.datetime('create_time').defaultTo(knex.fn.now()).comment('创建时间');
    t.string('update_by', 64).defaultTo('').comment('更新者');
    t.datetime('update_time').defaultTo(knex.fn.now()).comment('更新时间');
    t.string('remark', 500).nullable().comment('备注');
    t.index(['dict_type', 'status', 'dict_sort'], 'idx_sys_dict_data_type');
  });

  await knex('sys_dict_type').insert({
    dict_name: '特殊元素标签',
    dict_type: 'special_element_tag',
    status: '0',
    create_by: '',
    update_by: '',
    remark: '特殊元素库分类短语',
  });

  await knex('sys_dict_data').insert([
    {
      dict_sort: 1,
      dict_label: '登录',
      dict_value: 'login',
      dict_type: 'special_element_tag',
      status: '0',
      is_default: 'N',
      create_by: '',
      update_by: '',
    },
    {
      dict_sort: 2,
      dict_label: '填写',
      dict_value: 'fill',
      dict_type: 'special_element_tag',
      status: '0',
      is_default: 'N',
      create_by: '',
      update_by: '',
    },
  ]);

  await knex.schema.createTable('special_element', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.string('name', 255).notNullable().comment('操作组名称');
    t.text('phase_description').notNullable().comment('来源 trajectory_phase.description 快照');
    t.bigInteger('tag_dict_code').unsigned().notNullable()
      .comment('FK → sys_dict_data.dict_code');
    t.bigInteger('system_id').unsigned().notNullable()
      .comment('FK → system.id（type=1 系统）');
    t.bigInteger('function_id').unsigned().nullable()
      .comment('FK → system.id（type=3 功能）；可空');
    t.bigInteger('source_trajectory_id').unsigned().nullable();
    t.bigInteger('source_trajectory_phase_id').unsigned().nullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('step_count').unsigned().notNullable().defaultTo(0);
    t.string('remark', 512).defaultTo('');
    t.text('search_text').nullable();
    t.json('embedding_json').nullable();
    t.string('embedding_model', 128).defaultTo('');
    t.enu('embedding_status', ['pending', 'ready', 'failed', 'stale'])
      .notNullable().defaultTo('pending');
    t.string('embedding_content_hash', 64).defaultTo('');
    t.datetime('embedded_at', 3).nullable();
    t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
    t.unique(['system_id', 'name'], 'uk_special_element_sys_name');
    t.index(['tag_dict_code'], 'idx_se_tag_dict');
    t.index(['system_id'], 'idx_se_system');
    t.index(['function_id'], 'idx_se_source_function');
    t.index(['enabled', 'system_id'], 'idx_se_enabled_system');
    t.index(['source_trajectory_id'], 'idx_se_source_traj');
    t.index(['source_trajectory_phase_id'], 'idx_se_source_phase');
    t.index(['embedding_status'], 'idx_se_embedding_status');
  });

  await knex.schema.raw(
    'ALTER TABLE `special_element` '
    + 'ADD CONSTRAINT `fk_se_tag_dict_data` FOREIGN KEY (`tag_dict_code`) '
    + 'REFERENCES `sys_dict_data` (`dict_code`)',
  );
  await knex.schema.raw(
    'ALTER TABLE `special_element` '
    + 'ADD CONSTRAINT `fk_se_system` FOREIGN KEY (`system_id`) '
    + 'REFERENCES `system` (`id`) ON DELETE RESTRICT',
  );
  await knex.schema.raw(
    'ALTER TABLE `special_element` '
    + 'ADD CONSTRAINT `fk_se_function` FOREIGN KEY (`function_id`) '
    + 'REFERENCES `system` (`id`) ON DELETE SET NULL',
  );
  await knex.schema.raw(
    'ALTER TABLE `special_element` '
    + 'ADD CONSTRAINT `fk_se_source_traj` FOREIGN KEY (`source_trajectory_id`) '
    + 'REFERENCES `trajectory` (`id`) ON DELETE SET NULL',
  );
  await knex.schema.raw(
    'ALTER TABLE `special_element` '
    + 'ADD CONSTRAINT `fk_se_source_phase` FOREIGN KEY (`source_trajectory_phase_id`) '
    + 'REFERENCES `trajectory_phase` (`id`) ON DELETE SET NULL',
  );

  try {
    await knex.schema.raw(
      'ALTER TABLE `special_element` '
      + 'ADD FULLTEXT KEY `ft_se_search_text` (`search_text`) WITH PARSER ngram',
    );
  } catch (err) {
    console.warn(
      '[migrate] FULLTEXT ngram unavailable, falling back without FT index:',
      err?.message || err,
    );
  }

  await knex.schema.createTable('special_element_step', (t) => {
    t.bigIncrements('id').unsigned().primary();
    t.bigInteger('special_element_id').unsigned().notNullable();
    t.integer('step_number').unsigned().notNullable();
    t.integer('action_index').unsigned().notNullable().defaultTo(0);
    t.string('action_type', 64).notNullable().defaultTo('');
    t.json('params_json').nullable();
    t.json('element_json').nullable();
    t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
    t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
    t.unique(['special_element_id', 'step_number'], 'uk_ses_elem_step');
  });

  await knex.schema.raw(
    'ALTER TABLE `special_element_step` '
    + 'ADD CONSTRAINT `fk_ses_element` FOREIGN KEY (`special_element_id`) '
    + 'REFERENCES `special_element` (`id`) ON DELETE CASCADE',
  );

  await knex.schema.raw(
    "ALTER TABLE `trajectory_step` "
    + "MODIFY COLUMN `source` ENUM('agent','manual','cdp','special_element') "
    + "NOT NULL DEFAULT 'agent' "
    + "COMMENT 'agent|manual|cdp|special_element'",
  );

  await knex.schema.raw(
    'ALTER TABLE `trajectory_phase` '
    + 'ADD COLUMN `special_element_candidates_json` JSON NULL '
    + "COMMENT '阶段创建/同步时标记的候选特殊元素快照' "
    + 'AFTER `description`',
  );
}

export async function down(knex) {
  await knex.schema.raw(
    'ALTER TABLE `trajectory_phase` DROP COLUMN `special_element_candidates_json`',
  ).catch(() => {});

  await knex.schema.raw(
    "ALTER TABLE `trajectory_step` "
    + "MODIFY COLUMN `source` ENUM('agent','manual','cdp') "
    + "NOT NULL DEFAULT 'agent'",
  ).catch(() => {});

  await knex.schema.dropTableIfExists('special_element_step');
  await knex.schema.dropTableIfExists('special_element');
  await knex.schema.dropTableIfExists('sys_dict_data');
  await knex.schema.dropTableIfExists('sys_dict_type');
}
