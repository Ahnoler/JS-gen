/**
 * AI 记忆系统 P0 — 核心四表（事件 / 事实 / 关系 / 决策记录）。
 *
 * 设计约定：
 * - append-only：只追加、不覆盖；旧事实通过 superseded_by 指向新版本。
 * - trajectory_id 为逻辑关联（非硬外键）：删除交易不连带清空审计记忆，
 *   便于跨交易复用与外部独立审计。
 * - 与 docs/AI记忆系统优化方案.md 第 5.1/5.6 节保持一致。
 */

export async function up(knex) {
  if (!(await knex.schema.hasTable('memory_event'))) {
    await knex.schema.createTable('memory_event', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('trajectory_id').unsigned().nullable()
        .comment('逻辑关联 trajectory.id；删除交易不级联删除（审计保留）');
      t.string('session_id', 128).nullable().defaultTo('')
        .comment('执行机/浏览器会话 id（无法解析交易时兜底）');
      t.integer('phase_number').unsigned().nullable().comment('阶段号');
      t.integer('step_number').unsigned().nullable().comment('步骤号');
      t.string('action_id', 64).nullable().defaultTo('')
        .comment('动作/步骤的 action_id（与 trajectory_step 对齐）');
      t.string('event_type', 64).notNullable()
        .comment('action|phase_done|case_saved|summary|decision|context_drop|...');
      t.json('payload_json').nullable().comment('原始载荷');
      t.string('source', 32).notNullable().defaultTo('agent')
        .comment('agent|cdp|manual|node|rule|user|system');
      t.string('model', 128).nullable().defaultTo('').comment('产生者模型（LLM 产生时）');
      t.datetime('occurred_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.index(['trajectory_id', 'phase_number'], 'idx_me_traj');
      t.index(['session_id'], 'idx_me_session');
      t.index(['event_type', 'occurred_at'], 'idx_me_type');
    });
  }

  if (!(await knex.schema.hasTable('memory_fact'))) {
    await knex.schema.createTable('memory_fact', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('event_id').unsigned().nullable()
        .comment('来源 memory_event.id（软关联，事件可能异步后到）');
      t.bigInteger('trajectory_id').unsigned().notNullable()
        .comment('事实必须归属交易；删除交易不级联删除');
      t.integer('phase_number').unsigned().nullable().comment('产生阶段');
      t.integer('step_number').unsigned().nullable().comment('产生步骤');
      t.string('entity', 255).notNullable()
        .comment('实体：表单字段标签 / 客户名称 / 页面状态');
      t.string('attribute', 255).notNullable()
        .comment('属性：value / visible / error / outcome');
      t.text('value').nullable().comment('属性值');
      t.string('fact_type', 64).notNullable().defaultTo('case_value')
        .comment('case_value|page_state|outcome|rule|requirement|llm_generated');
      t.string('source', 32).notNullable().defaultTo('agent')
        .comment('user|page|rule|llm|observer|system|human');
      t.string('stance', 16).notNullable().defaultTo('neutral')
        .comment('authoritative|inferred|disputed|neutral');
      t.decimal('weight', 10, 4).notNullable().defaultTo(1.0)
        .comment('当前权重（权重引擎维护）');
      t.decimal('base_weight', 10, 4).notNullable().defaultTo(1.0)
        .comment('初始权重（来源基准）');
      t.integer('version').unsigned().notNullable().defaultTo(1)
        .comment('同实体属性版本号');
      t.bigInteger('superseded_by').unsigned().nullable()
        .comment('被哪个新事实取代（旧版本保留，供审计）');
      t.datetime('expires_at', 3).nullable().comment('过期时间（可为空）');
      t.string('created_by', 128).nullable().defaultTo('')
        .comment('model / rule / human / system');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.index(['trajectory_id', 'entity', 'attribute'], 'idx_mf_traj');
      t.index(['trajectory_id', 'phase_number'], 'idx_mf_phase');
      t.index(['stance', 'weight'], 'idx_mf_stance');
      t.index(['fact_type'], 'idx_mf_type');
    });
  }

  if (!(await knex.schema.hasTable('memory_relation'))) {
    await knex.schema.createTable('memory_relation', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('trajectory_id').unsigned().notNullable();
      t.bigInteger('from_fact_id').unsigned().notNullable();
      t.bigInteger('to_fact_id').unsigned().notNullable();
      t.string('relation_type', 64).notNullable()
        .comment('co_occur|fill_before_save|derive|same_entity|conflict');
      t.decimal('strength', 6, 4).notNullable().defaultTo(0);
      t.datetime('updated_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(
        ['trajectory_id', 'from_fact_id', 'to_fact_id', 'relation_type'],
        'uk_rel',
      );
    });
  }

  if (!(await knex.schema.hasTable('decision_record'))) {
    await knex.schema.createTable('decision_record', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.bigInteger('trajectory_id').unsigned().nullable()
        .comment('逻辑关联 trajectory.id；analyze 等阶段可无交易');
      t.integer('phase_number').unsigned().nullable();
      t.integer('step_number').unsigned().nullable();
      t.string('decision_type', 64).notNullable()
        .comment('agent_step|form_value|scenario_summary|heal|analyze_phase');
      t.string('model', 128).notNullable().defaultTo('');
      t.decimal('temperature', 4, 2).nullable();
      t.string('prompt_hash', 64).nullable().defaultTo('')
        .comment('sha256(系统提示+输入)');
      t.json('input_fact_ids').nullable().comment('[fact_id, ...] 事实包引用');
      t.bigInteger('context_snapshot_id').unsigned().nullable()
        .comment('完整上下文快照 id（P1 起使用）');
      t.text('input_preview').nullable().comment('输入前 500 字（审计用）');
      t.json('output_json').nullable().comment('模型原始输出');
      t.decimal('confidence', 6, 4).nullable().comment('模型自评（可选）');
      t.json('policy_checks').nullable()
        .comment('[{check, pass, detail}] 策略校验结果');
      t.boolean('overridden').notNullable().defaultTo(false)
        .comment('是否被策略层拦截/改写');
      t.json('final_action').nullable().comment('策略层裁决后的最终动作');
      t.string('audit_status', 16).notNullable().defaultTo('pending')
        .comment('pending|passed|failed');
      t.datetime('created_at', 3).notNullable().defaultTo(knex.fn.now(3));
      t.index(['trajectory_id', 'phase_number'], 'idx_dr_traj');
      t.index(['audit_status'], 'idx_dr_audit');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('decision_record');
  await knex.schema.dropTableIfExists('memory_relation');
  await knex.schema.dropTableIfExists('memory_fact');
  await knex.schema.dropTableIfExists('memory_event');
}
