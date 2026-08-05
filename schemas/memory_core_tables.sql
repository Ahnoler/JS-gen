-- ============================================================
-- AI 记忆系统 P0 — 核心四表（事件 / 事实 / 关系 / 决策记录）
-- append-only；trajectory_id 为逻辑关联（非硬外键），删除交易不连带清空审计记忆。
-- 与 migrations/20260805120000_memory_core_tables.js 保持一致。
-- ============================================================

CREATE TABLE `memory_event` (
  `id`            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `trajectory_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '逻辑关联 trajectory.id；删除交易不级联删除（审计保留）',
  `session_id`    VARCHAR(128) DEFAULT '' COMMENT '执行机/浏览器会话 id（无法解析交易时兜底）',
  `phase_number`  INT UNSIGNED DEFAULT NULL COMMENT '阶段号',
  `step_number`   INT UNSIGNED DEFAULT NULL COMMENT '步骤号',
  `action_id`     VARCHAR(64) DEFAULT '' COMMENT '动作/步骤的 action_id（与 trajectory_step 对齐）',
  `event_type`    VARCHAR(64) NOT NULL COMMENT 'action|phase_done|case_saved|summary|decision|context_drop|...',
  `payload_json`  JSON DEFAULT NULL COMMENT '原始载荷',
  `source`        VARCHAR(32) NOT NULL DEFAULT 'agent' COMMENT 'agent|cdp|manual|node|rule|user|system',
  `model`         VARCHAR(128) DEFAULT '' COMMENT '产生者模型（LLM 产生时）',
  `occurred_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_me_traj` (`trajectory_id`, `phase_number`),
  KEY `idx_me_session` (`session_id`),
  KEY `idx_me_type` (`event_type`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='记忆事件（append-only）';

CREATE TABLE `memory_fact` (
  `id`            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `event_id`      BIGINT UNSIGNED DEFAULT NULL COMMENT '来源 memory_event.id（软关联）',
  `trajectory_id` BIGINT UNSIGNED NOT NULL COMMENT '事实必须归属交易；删除交易不级联删除',
  `phase_number`  INT UNSIGNED DEFAULT NULL COMMENT '产生阶段',
  `step_number`   INT UNSIGNED DEFAULT NULL COMMENT '产生步骤',
  `entity`        VARCHAR(255) NOT NULL COMMENT '实体：表单字段标签 / 客户名称 / 页面状态',
  `attribute`     VARCHAR(255) NOT NULL COMMENT '属性：value / visible / error / outcome',
  `value`         TEXT COMMENT '属性值',
  `fact_type`     VARCHAR(64) NOT NULL DEFAULT 'case_value' COMMENT 'case_value|page_state|outcome|rule|requirement|llm_generated',
  `source`        VARCHAR(32) NOT NULL DEFAULT 'agent' COMMENT 'user|page|rule|llm|observer|system|human',
  `stance`        VARCHAR(16) NOT NULL DEFAULT 'neutral' COMMENT 'authoritative|inferred|disputed|neutral',
  `weight`        DECIMAL(10,4) NOT NULL DEFAULT 1.0 COMMENT '当前权重（权重引擎维护）',
  `base_weight`   DECIMAL(10,4) NOT NULL DEFAULT 1.0 COMMENT '初始权重（来源基准）',
  `version`       INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '同实体属性版本号',
  `superseded_by` BIGINT UNSIGNED DEFAULT NULL COMMENT '被哪个新事实取代（旧版本保留，供审计）',
  `expires_at`    DATETIME(3) DEFAULT NULL COMMENT '过期时间（可为空）',
  `created_by`    VARCHAR(128) DEFAULT '' COMMENT 'model / rule / human / system',
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_mf_traj` (`trajectory_id`, `entity`, `attribute`),
  KEY `idx_mf_phase` (`trajectory_id`, `phase_number`),
  KEY `idx_mf_stance` (`stance`, `weight`),
  KEY `idx_mf_type` (`fact_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='记忆事实（可引用的数据点）';

CREATE TABLE `memory_relation` (
  `id`            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `trajectory_id` BIGINT UNSIGNED NOT NULL,
  `from_fact_id`  BIGINT UNSIGNED NOT NULL,
  `to_fact_id`    BIGINT UNSIGNED NOT NULL,
  `relation_type` VARCHAR(64) NOT NULL COMMENT 'co_occur|fill_before_save|derive|same_entity|conflict',
  `strength`      DECIMAL(6,4) NOT NULL DEFAULT 0,
  `updated_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_rel` (`trajectory_id`, `from_fact_id`, `to_fact_id`, `relation_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='记忆关系（相关性建模结果）';

CREATE TABLE `decision_record` (
  `id`                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `trajectory_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '逻辑关联 trajectory.id；analyze 等阶段可无交易',
  `phase_number`        INT UNSIGNED DEFAULT NULL,
  `step_number`         INT UNSIGNED DEFAULT NULL,
  `decision_type`       VARCHAR(64) NOT NULL COMMENT 'agent_step|form_value|scenario_summary|heal|analyze_phase',
  `model`               VARCHAR(128) NOT NULL DEFAULT '',
  `temperature`         DECIMAL(4,2) DEFAULT NULL,
  `prompt_hash`         VARCHAR(64) DEFAULT '' COMMENT 'sha256(系统提示+输入)',
  `input_fact_ids`      JSON DEFAULT NULL COMMENT '[fact_id, ...] 事实包引用',
  `context_snapshot_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '完整上下文快照 id（P1 起使用）',
  `input_preview`       TEXT COMMENT '输入前 500 字（审计用）',
  `output_json`         JSON DEFAULT NULL COMMENT '模型原始输出',
  `confidence`          DECIMAL(6,4) DEFAULT NULL COMMENT '模型自评（可选）',
  `policy_checks`       JSON DEFAULT NULL COMMENT '[{check, pass, detail}] 策略校验结果',
  `overridden`          TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否被策略层拦截/改写',
  `final_action`        JSON DEFAULT NULL COMMENT '策略层裁决后的最终动作',
  `audit_status`        VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending|passed|failed',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_dr_traj` (`trajectory_id`, `phase_number`),
  KEY `idx_dr_audit` (`audit_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='LLM 决策记录（外部审计）';
