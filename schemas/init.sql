-- ============================================================
-- 智能填表系统 — 数据库初始化脚本
-- 目标数据库: MySQL 8.0+
-- 字符集: utf8mb4
-- 表数量: 12
-- ============================================================

CREATE DATABASE IF NOT EXISTS `uara`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `uara`;

-- ─────────────────────────────────────────────────────────────
-- 层级节点 (System) — 系统/模块/功能 合并为一表
-- type: 0=根 1=系统 2=模块 3=功能；系统节点 parent_id=0 指向根
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `system` (
  `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '代理主键；根节点固定 id=0',
  `system_id`   VARCHAR(36)  NOT NULL COMMENT 'UUID 业务标识（各级节点共用）',
  `type`        TINYINT NOT NULL COMMENT '0=根 1=系统 2=模块 3=功能',
  `parent_id`   BIGINT UNSIGNED DEFAULT 0 COMMENT '父节点 id；系统挂在根 0 下',
  `name`        VARCHAR(255) NOT NULL COMMENT '名称',
  `description` TEXT COMMENT '描述',
  `url`         VARCHAR(2048) DEFAULT '' COMMENT '系统地址/入口 URL（仅 type=1 系统节点有意义）',
  `sort_order`  INT UNSIGNED DEFAULT 0 COMMENT '同级排序',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_system_id` (`system_id`),
  KEY `idx_type` (`type`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_parent_name` (`parent_id`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='层级节点（0=根 1=系统 2=模块 3=功能）';

-- ─────────────────────────────────────────────────────────────
-- 系统测试账号 (SystemAccount) — 挂在 type=1 系统节点下
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `system_account` (
  `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `system_id`   BIGINT UNSIGNED NOT NULL COMMENT '外键 → system.id（type=1）',
  `name`        VARCHAR(255) NOT NULL COMMENT '角色名：管理员/测试人员/…',
  `login_url`   VARCHAR(2048) DEFAULT '' COMMENT '登录/入口网址',
  `username`    VARCHAR(255) DEFAULT '' COMMENT '测试账号',
  `password`    VARCHAR(255) DEFAULT '' COMMENT '测试密码',
  `remark`      TEXT COMMENT '备注（权限说明等）',
  `sort_order`  INT UNSIGNED DEFAULT 0,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_system_account_name` (`system_id`, `name`),
  KEY `idx_system_account_system` (`system_id`),
  CONSTRAINT `fk_system_account_system` FOREIGN KEY (`system_id`) REFERENCES `system` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='被测系统测试账号（多角色）';

-- ─────────────────────────────────────────────────────────────
-- 远程浏览器会话 (RemoteSession) — P6 运行时
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `remote_session` (
  `id`                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `session_uuid`        VARCHAR(36) NOT NULL COMMENT 'UUID',
  `browser_context_id`  VARCHAR(128) DEFAULT '' COMMENT 'CDP Target.createBrowserContext 返回的 contextId',
  `target_id`           VARCHAR(128) DEFAULT '' COMMENT 'CDP Target.createTarget 返回的 targetId（Page）',
  `isolation`           ENUM('context','target') DEFAULT 'context' COMMENT '隔离方式：独立 BrowserContext / 共享上下文的 Target',
  `viewport_w`          INT UNSIGNED DEFAULT 0 COMMENT '视口宽（Emulation.setDeviceMetricsOverride）',
  `viewport_h`          INT UNSIGNED DEFAULT 0 COMMENT '视口高',
  `device_scale_factor` DECIMAL(4,2) DEFAULT 1.00 COMMENT 'DPR，处理 Retina/2x 屏',
  `url`                 VARCHAR(2048) DEFAULT '' COMMENT '当前/初始页面 URL',
  `status`              ENUM('active','idle','closed','crashed') NOT NULL DEFAULT 'active' COMMENT 'active=推流中; idle=断开画面浏览器仍在; closed=已释放; crashed=异常',
  `executor_node_id`    BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → executor_node.id（会话所在执行机）',
  `slot_index`          INT UNSIGNED DEFAULT NULL COMMENT '执行机内槽位号',
  `client_key`          VARCHAR(64) DEFAULT NULL COMMENT '前端会话/用户标识，用于亲和调度',
  `agent_session_id`    VARCHAR(64) DEFAULT NULL COMMENT 'Python/执行机 agent session UUID',
  `trajectory_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '当前挂载交易；idle 宽限期内仍非空；到期或 detach/close 后 NULL',
  `grace_until`         DATETIME(3) DEFAULT NULL COMMENT 'streamDetach 宽限截止；期内仍属 trajectory_id；到期后清空归属',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closed_at`           DATETIME(3) DEFAULT NULL,
  UNIQUE KEY `uk_session_uuid` (`session_uuid`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_executor_node_id` (`executor_node_id`),
  KEY `idx_client_key` (`client_key`),
  KEY `idx_rs_agent_session` (`agent_session_id`),
  KEY `idx_rs_trajectory` (`trajectory_id`),
  KEY `idx_rs_grace_until` (`grace_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='远程浏览器操控/录制会话（BrowserContext 隔离、视口、Target、生命周期）';

-- ─────────────────────────────────────────────────────────────
-- 轨迹主表 (Trajectory)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `trajectory` (
  `id`                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`              VARCHAR(255) DEFAULT '' COMMENT '交易名称',
  `trajectory_log`    LONGTEXT DEFAULT NULL COMMENT '操作日志全文（同 log_{ts}.txt：含 URL + goal/actions/result 行）',
  `task`              TEXT COMMENT '需求描述 / 任务描述',
  `model`             VARCHAR(128) DEFAULT '' COMMENT '使用的 LLM 模型',
  `step_count`        INT UNSIGNED DEFAULT 0 COMMENT '总步数（trajectory_step 行数）',
  `phase_count`       INT UNSIGNED DEFAULT 0 COMMENT '阶段数（trajectory_phase 行数）',
  `is_done`           TINYINT(1) DEFAULT NULL COMMENT '是否完成',
  `is_successful`     TINYINT(1) DEFAULT NULL COMMENT '是否成功',
  `url`               VARCHAR(2048) DEFAULT '' COMMENT '目标页面 URL',
  `function_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → system.id（type=3 功能）',
  `system_account_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → system_account.id（录制默认登录账号）',
  `remote_session_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → remote_session.id（远程/人工录制来源，可空）',
  `batch_job_id`       VARCHAR(36) DEFAULT NULL COMMENT '所属批量导入任务（batch_recording_job.id，UUID）；NULL=手动创建',
  `record_status`     ENUM('draft','live','recording','recorded','completed') NOT NULL DEFAULT 'draft' COMMENT 'draft=空闲; live=推流占用; recording=AI录制中; recorded=录制完成; completed=人工确认',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY `idx_function_id` (`function_id`),
  KEY `idx_traj_system_account` (`system_account_id`),
  KEY `idx_remote_session_id` (`remote_session_id`),
  KEY `idx_batch_job_id` (`batch_job_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_model` (`model`),
  KEY `idx_record_status` (`record_status`),
  CONSTRAINT `fk_traj_function` FOREIGN KEY (`function_id`) REFERENCES `system` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_traj_system_account` FOREIGN KEY (`system_account_id`) REFERENCES `system_account` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_traj_remote_session` FOREIGN KEY (`remote_session_id`) REFERENCES `remote_session` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='浏览器操作轨迹（交易）';

-- ─────────────────────────────────────────────────────────────
-- 轨迹执行阶段 (TrajectoryPhase)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `trajectory_phase` (
  `id`             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `phase_id`       VARCHAR(36) NOT NULL COMMENT 'UUID 业务标识',
  `trajectory_id`  BIGINT UNSIGNED NOT NULL COMMENT '外键 → trajectory.id',
  `phase_number`   INT UNSIGNED NOT NULL COMMENT '阶段序号（1-based）',
  `description`    TEXT COMMENT '阶段任务完整描述（执行阶段时下发的 task）',
  `special_element_candidates_json` JSON NULL COMMENT '阶段创建/同步时标记的候选特殊元素快照',
  `status`         ENUM('pending','running','completed','failed') DEFAULT 'pending',
  `component_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '预留 → operation_component.id；Phase1 业务不写入',
  `stitch_screenshot_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '阶段展示长图 → screenshot.id',
  `done_logs`        JSON NULL COMMENT '阶段结束说明 [{text, at, source}]；trajectory.trajectory_log 仍为 agent 全文',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at`   DATETIME(3) DEFAULT NULL,
  UNIQUE KEY `uk_phase_id` (`phase_id`),
  KEY `idx_trajectory_id` (`trajectory_id`),
  KEY `idx_phase_number` (`trajectory_id`, `phase_number`),
  KEY `idx_phase_component` (`component_id`),
  KEY `idx_phase_stitch_screenshot` (`stitch_screenshot_id`),
  CONSTRAINT `fk_phase_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='轨迹执行阶段';

-- ─────────────────────────────────────────────────────────────
-- 轨迹步骤 (TrajectoryStep)
-- element_json 内约定 candidates[]: [{ "type": "css|xpath_full|xpath_smart", "value": "..." }]
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `trajectory_step` (
  `id`                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `trajectory_id`       BIGINT UNSIGNED NOT NULL COMMENT '外键 → trajectory.id',
  `step_number`         INT UNSIGNED NOT NULL COMMENT '步骤序号（从 1 开始）',
  `phase_number`        INT UNSIGNED DEFAULT 0 COMMENT '阶段编号，向后兼容',
  `action_index`        INT UNSIGNED DEFAULT 0 COMMENT '同一步内的动作索引',
  `action_type`         VARCHAR(64) DEFAULT '' COMMENT '动作类型: fill_form_field | select_option | click_element_by_index | ...',
  `params_json`         JSON COMMENT '动作参数 { text, value, index, url, label_text, option_text, ... }',
  `element_json`        JSON COMMENT '交互元素信息 { tag, xpath, cssSelector, attributes, candidates[], ... }',
  `success`             TINYINT(1) DEFAULT NULL COMMENT '是否成功',
  `error`               TEXT COMMENT '错误信息',
  `extracted_content`   TEXT COMMENT '执行结果',
  `trajectory_phase_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory_phase.id',
  `source`              ENUM('agent','manual','cdp','special_element') NOT NULL DEFAULT 'agent'
    COMMENT '动作来源：agent|manual|cdp|special_element',
  `action_id`           VARCHAR(64) DEFAULT NULL COMMENT 'Python ActionEntry.id（UUID v4）；控制面重启后幂等去重；历史行为 NULL',
  `confirmed`           TINYINT(1) NOT NULL DEFAULT 1 COMMENT '回放确认',
  `confirmed_at`        DATETIME(3) DEFAULT NULL COMMENT '回放确认时间',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_trajectory_id` (`trajectory_id`),
  KEY `idx_step_number` (`trajectory_id`, `step_number`),
  KEY `idx_phase_number` (`trajectory_id`, `phase_number`),
  KEY `idx_action_type` (`action_type`),
  KEY `idx_traj_phase_id` (`trajectory_phase_id`),
  KEY `idx_source` (`source`),
  UNIQUE KEY `uk_traj_action` (`trajectory_id`, `action_id`),
  CONSTRAINT `fk_step_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_step_phase` FOREIGN KEY (`trajectory_phase_id`) REFERENCES `trajectory_phase` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='轨迹步骤';

-- ─────────────────────────────────────────────────────────────
-- 操作原子化组件库 (OperationComponent) — Phase 级步骤快照
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `operation_component` (
  `id`                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`                   VARCHAR(255) NOT NULL COMMENT '展示名',
  `key`                    VARCHAR(128) DEFAULT NULL COMMENT '稳定键（展示辅助，不参与去重）',
  `description`            TEXT COMMENT '语义说明',
  `grain`                  ENUM('phase','step_seq') NOT NULL DEFAULT 'phase' COMMENT '组件粒度；本阶段恒 phase',
  `system_id`              BIGINT UNSIGNED NOT NULL COMMENT '归属系统 → system.id',
  `status`                 ENUM('draft','confirmed','deprecated') NOT NULL DEFAULT 'draft',
  `param_schema`           JSON DEFAULT NULL COMMENT '参数化预留 JSON',
  `steps_json`             JSON NOT NULL COMMENT '代表样例步骤快照',
  `signature`              CHAR(64) NOT NULL COMMENT '结构签名 sha256 hex',
  `source_trajectory_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '代表样例来源轨迹',
  `source_phase_id`        BIGINT UNSIGNED DEFAULT NULL COMMENT '代表样例来源阶段',
  `occurrence_count`       INT UNSIGNED NOT NULL DEFAULT 0,
  `confidence`             DECIMAL(4,3) DEFAULT NULL,
  `created_by`             VARCHAR(128) NOT NULL DEFAULT '' COMMENT '入库人；用户管理就绪前可为空串',
  `created_at`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_oc_system_signature` (`system_id`, `signature`),
  KEY `idx_oc_status` (`status`),
  KEY `idx_oc_grain` (`grain`),
  KEY `idx_oc_system` (`system_id`),
  CONSTRAINT `fk_oc_system` FOREIGN KEY (`system_id`) REFERENCES `system` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_oc_source_traj` FOREIGN KEY (`source_trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_oc_source_phase` FOREIGN KEY (`source_phase_id`) REFERENCES `trajectory_phase` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作原子化组件（Phase 级）';

CREATE TABLE `operation_component_occurrence` (
  `id`                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `component_id`         BIGINT UNSIGNED NOT NULL,
  `trajectory_id`        BIGINT UNSIGNED NOT NULL,
  `trajectory_phase_id`  BIGINT UNSIGNED NOT NULL,
  `similarity`           DECIMAL(4,3) DEFAULT NULL,
  `step_start`           INT UNSIGNED DEFAULT NULL COMMENT '预留 step_seq',
  `step_end`             INT UNSIGNED DEFAULT NULL COMMENT '预留 step_seq',
  `created_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_oco_comp_phase` (`component_id`, `trajectory_phase_id`),
  KEY `idx_oco_trajectory` (`trajectory_id`),
  KEY `idx_oco_component` (`component_id`),
  CONSTRAINT `fk_oco_component` FOREIGN KEY (`component_id`) REFERENCES `operation_component` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_oco_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_oco_phase` FOREIGN KEY (`trajectory_phase_id`) REFERENCES `trajectory_phase` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组件候选/证据 occurrence';

-- trajectory_phase.component_id FK（表已在上方建好，此处补约束）
-- ALTER 在迁移 20260806120100 中执行；init 全量建库时用下方可选约束：
-- ALTER TABLE `trajectory_phase` ADD CONSTRAINT `fk_phase_component`
--   FOREIGN KEY (`component_id`) REFERENCES `operation_component` (`id`) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- 字典类型 / 字典数据（公司同款）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `sys_dict_type` (
  `dict_id`     BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '字典主键',
  `dict_name`   VARCHAR(100) DEFAULT '' COMMENT '字典名称',
  `dict_type`   VARCHAR(100) DEFAULT '' COMMENT '字典类型',
  `status`      CHAR(1) DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `create_by`   VARCHAR(64) DEFAULT '' COMMENT '创建者',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by`   VARCHAR(64) DEFAULT '' COMMENT '更新者',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `remark`      VARCHAR(500) NULL COMMENT '备注',
  UNIQUE KEY `dict_type` (`dict_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='字典类型表';

CREATE TABLE `sys_dict_data` (
  `dict_code`   BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '字典编码',
  `dict_sort`   INT(4) DEFAULT 0 COMMENT '字典排序',
  `dict_label`  VARCHAR(100) DEFAULT '' COMMENT '字典标签',
  `dict_value`  VARCHAR(255) DEFAULT '' COMMENT '字典键值',
  `dict_type`   VARCHAR(100) DEFAULT '' COMMENT '字典类型',
  `css_class`   VARCHAR(100) NULL COMMENT '样式属性',
  `list_class`  VARCHAR(100) NULL COMMENT '表格回显样式',
  `is_default`  CHAR(1) DEFAULT 'N' COMMENT '是否默认（Y是 N否）',
  `status`      CHAR(1) DEFAULT '0' COMMENT '状态（0正常 1停用）',
  `create_by`   VARCHAR(64) DEFAULT '' COMMENT '创建者',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_by`   VARCHAR(64) DEFAULT '' COMMENT '更新者',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `remark`      VARCHAR(500) NULL COMMENT '备注',
  KEY `idx_sys_dict_data_type` (`dict_type`, `status`, `dict_sort`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='字典数据表';

-- ─────────────────────────────────────────────────────────────
-- 产品消息（批量导入终态等）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `sys_msg` (
  `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `msg_title`        VARCHAR(128) NOT NULL DEFAULT '' COMMENT '展示标题；第一种=批量导入任务',
  `msg_content`      TEXT NOT NULL COMMENT '两行 HTML：功能·文件·状态 / 统计；用户字段已转义',
  `msg_type`         INT NOT NULL COMMENT 'sys_dict_data.dict_value (sys_msg_type)',
  `msg_status`       TINYINT NOT NULL DEFAULT 0 COMMENT '0未读 2已读（现阶段全局）',
  `link_url`         VARCHAR(512) NOT NULL DEFAULT '',
  `belong_item_name` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '功能名',
  `belong_item_id`   BIGINT UNSIGNED NULL COMMENT 'system.id type=3',
  `source_type`      VARCHAR(32) NOT NULL DEFAULT '' COMMENT 'batch_import',
  `source_id`        VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'batch UUID',
  `product_code`     VARCHAR(64) NULL COMMENT '挂起',
  `create_by`        VARCHAR(64) NOT NULL DEFAULT '系统',
  `user_id`          BIGINT UNSIGNED NULL COMMENT '挂起',
  `user_flag`        TINYINT NULL COMMENT '挂起',
  `rule_id`          BIGINT UNSIGNED NULL COMMENT '挂起',
  `remark`           VARCHAR(500) NULL,
  `create_time`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_sys_msg_source` (`source_type`, `source_id`),
  KEY `idx_sys_msg_created` (`create_time`),
  KEY `idx_sys_msg_status` (`msg_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品消息';

-- ─────────────────────────────────────────────────────────────
-- 特殊元素库
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `special_element` (
  `id`                         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`                       VARCHAR(255) NOT NULL COMMENT '操作组名称',
  `phase_description`          TEXT NOT NULL COMMENT '来源 trajectory_phase.description 快照',
  `tag_dict_code`              BIGINT UNSIGNED NOT NULL COMMENT 'FK → sys_dict_data.dict_code',
  `system_id`                  BIGINT UNSIGNED NOT NULL COMMENT 'FK → system.id（type=1）',
  `function_id`                BIGINT UNSIGNED NULL COMMENT 'FK → system.id（type=3）；可空',
  `source_trajectory_id`       BIGINT UNSIGNED NULL,
  `source_trajectory_phase_id` BIGINT UNSIGNED NULL,
  `enabled`                    TINYINT(1) NOT NULL DEFAULT 1,
  `step_count`                 INT UNSIGNED NOT NULL DEFAULT 0,
  `remark`                     VARCHAR(512) DEFAULT '',
  `search_text`                TEXT NULL,
  `embedding_json`             JSON NULL,
  `embedding_model`            VARCHAR(128) DEFAULT '',
  `embedding_status`           ENUM('pending','ready','failed','stale') NOT NULL DEFAULT 'pending',
  `embedding_content_hash`     VARCHAR(64) DEFAULT '',
  `embedded_at`                DATETIME(3) NULL,
  `created_by`                 VARCHAR(128) NOT NULL DEFAULT '' COMMENT '入库人；用户管理就绪前可为空串',
  `updated_by`                 VARCHAR(128) NOT NULL DEFAULT '' COMMENT '更新人；用户管理就绪前可为空串',
  `created_at`                 DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`                 DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_special_element_sys_name` (`system_id`, `name`),
  KEY `idx_se_tag_dict` (`tag_dict_code`),
  KEY `idx_se_system` (`system_id`),
  KEY `idx_se_source_function` (`function_id`),
  KEY `idx_se_enabled_system` (`enabled`, `system_id`),
  CONSTRAINT `fk_se_tag_dict_data` FOREIGN KEY (`tag_dict_code`) REFERENCES `sys_dict_data` (`dict_code`),
  CONSTRAINT `fk_se_system` FOREIGN KEY (`system_id`) REFERENCES `system` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_se_function` FOREIGN KEY (`function_id`) REFERENCES `system` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_se_source_traj` FOREIGN KEY (`source_trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_se_source_phase` FOREIGN KEY (`source_trajectory_phase_id`) REFERENCES `trajectory_phase` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='特殊页面元素操作组';

CREATE TABLE `special_element_step` (
  `id`                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `special_element_id` BIGINT UNSIGNED NOT NULL,
  `step_number`        INT UNSIGNED NOT NULL,
  `action_index`       INT UNSIGNED NOT NULL DEFAULT 0,
  `action_type`        VARCHAR(64) NOT NULL DEFAULT '',
  `params_json`        JSON NULL,
  `element_json`       JSON NULL,
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_ses_elem_step` (`special_element_id`, `step_number`),
  CONSTRAINT `fk_ses_element` FOREIGN KEY (`special_element_id`) REFERENCES `special_element` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='特殊元素所属操作步骤';

-- ─────────────────────────────────────────────────────────────
-- 案例数据 (CaseData) — LEGACY；新产品系统参考值见 system_ref_*
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `case_data` (
  `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `record_id`   VARCHAR(64)  NOT NULL COMMENT '业务标识，如 cdata_20260713_143528',
  `session_id`  VARCHAR(128) DEFAULT '' COMMENT '关联的会话 ID',
  `model`       VARCHAR(128) DEFAULT '' COMMENT '使用的 LLM 模型',
  `description` VARCHAR(512) DEFAULT '' COMMENT '描述',
  `key_count`   INT UNSIGNED DEFAULT 0 COMMENT '纯 KV 字段数量（排除内嵌对象）',
  `raw_json`    JSON COMMENT 'case_data_store 的完整原始 JSON',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_record_id` (`record_id`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='案例数据（legacy；系统参考值用 system_ref_data）';

-- ─────────────────────────────────────────────────────────────
-- 案例数据 KV 明细 (CaseDataEntry) — LEGACY
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `case_data_entry` (
  `id`             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `case_data_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → case_data.id（可空；新产品用 trajectory_id）',
  `trajectory_id`  BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory.id；产品路径按交易绑定案例 KV',
  `field_key`      VARCHAR(255) NOT NULL COMMENT '字段键名，如 "姓名"',
  `field_value`    TEXT COMMENT '字段值',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_case_data_id` (`case_data_id`),
  KEY `idx_entry_trajectory` (`trajectory_id`),
  KEY `idx_field_key` (`field_key`),
  CONSTRAINT `fk_entry_case_data` FOREIGN KEY (`case_data_id`) REFERENCES `case_data` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_entry_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='案例数据键值（legacy；系统参考值用 system_ref_entry）';

-- ─────────────────────────────────────────────────────────────
-- 系统参考数据 (SystemRefData)
-- 目标系统回写 / 经校验可复用的填表参考值（≠ 用户需求业务数据）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `system_ref_data` (
  `id`                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `trajectory_id`        BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory.id；按交易绑定',
  `session_id`           VARCHAR(128) DEFAULT '' COMMENT '关联会话 ID',
  `record_id`            VARCHAR(64)  NOT NULL COMMENT '业务标识，如 sref_20260805_120000',
  `source`               VARCHAR(32)  NOT NULL DEFAULT 'system_capture' COMMENT 'system_capture | manual | import',
  `verification_status`  VARCHAR(32)  NOT NULL DEFAULT 'raw' COMMENT 'raw | verified | rejected',
  `description`          VARCHAR(512) DEFAULT '',
  `key_count`            INT UNSIGNED DEFAULT 0 COMMENT 'KV 字段数量',
  `raw_json`             JSON COMMENT '可选整包 JSON',
  `created_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_sref_record_id` (`record_id`),
  KEY `idx_sref_trajectory` (`trajectory_id`),
  KEY `idx_sref_session` (`session_id`),
  KEY `idx_sref_verify` (`verification_status`),
  KEY `idx_sref_created` (`created_at`),
  CONSTRAINT `fk_sref_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统参考数据（目标系统回写/已校验填表真值）';

-- ─────────────────────────────────────────────────────────────
-- 系统参考数据 KV 明细 (SystemRefEntry)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `system_ref_entry` (
  `id`                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `system_ref_data_id`   BIGINT UNSIGNED NOT NULL COMMENT '外键 → system_ref_data.id',
  `trajectory_id`        BIGINT UNSIGNED DEFAULT NULL COMMENT '冗余 → trajectory.id，便于按交易查询',
  `field_key`            VARCHAR(255) NOT NULL COMMENT '字段键名',
  `field_value`          TEXT COMMENT '字段值',
  `source`               VARCHAR(32)  NOT NULL DEFAULT 'system_capture' COMMENT 'system_capture | manual | import',
  `verification_status`  VARCHAR(32)  NOT NULL DEFAULT 'raw' COMMENT 'raw | verified | rejected',
  `verified_at`          DATETIME(3) DEFAULT NULL COMMENT '校验通过时间',
  `created_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_sre_header` (`system_ref_data_id`),
  KEY `idx_sre_trajectory` (`trajectory_id`),
  KEY `idx_sre_field_key` (`field_key`),
  KEY `idx_sre_traj_key` (`trajectory_id`, `field_key`),
  KEY `idx_sre_verify` (`verification_status`),
  CONSTRAINT `fk_sre_header` FOREIGN KEY (`system_ref_data_id`) REFERENCES `system_ref_data` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sre_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统参考数据键值';

-- ─────────────────────────────────────────────────────────────
-- 表单快照 (FormSnapshot)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `form_snapshot` (
  `id`             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `container`      VARCHAR(128) NOT NULL COMMENT '容器标识: main | dialog:标题 | drawer:标签',
  `field_count`    INT UNSIGNED DEFAULT 0 COMMENT '字段总数',
  `required_count` INT UNSIGNED DEFAULT 0 COMMENT '必填字段数',
  `optional_count` INT UNSIGNED DEFAULT 0 COMMENT '可选字段数',
  `action_index`   INT UNSIGNED DEFAULT 0 COMMENT '在 _ACTION_LOG 中的位置索引',
  `trigger_step_id` BIGINT UNSIGNED DEFAULT NULL COMMENT 'checkpoint trajectory_step.id（1:1，创建/去重更新时绑定）',
  `case_data_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → case_data.id',
  `trajectory_id`  BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory.id',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_container` (`container`),
  KEY `idx_case_data_id` (`case_data_id`),
  KEY `idx_trajectory_id` (`trajectory_id`),
  UNIQUE KEY `uk_fs_trigger_step` (`trigger_step_id`),
  CONSTRAINT `fk_fs_case_data` FOREIGN KEY (`case_data_id`) REFERENCES `case_data` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fs_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fs_trigger_step` FOREIGN KEY (`trigger_step_id`) REFERENCES `trajectory_step` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='表单结构快照';

-- ─────────────────────────────────────────────────────────────
-- 快照字段明细 (SnapshotField)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `snapshot_field` (
  `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `form_snapshot_id` BIGINT UNSIGNED NOT NULL COMMENT '外键 → form_snapshot.id',
  `label`            VARCHAR(255) NOT NULL COMMENT '字段标签名',
  `is_required`      TINYINT(1) DEFAULT 0 COMMENT '是否必填',
  `created_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_form_snapshot_id` (`form_snapshot_id`),
  CONSTRAINT `fk_sf_snapshot` FOREIGN KEY (`form_snapshot_id`) REFERENCES `form_snapshot` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='快照字段明细';

-- ─────────────────────────────────────────────────────────────
-- 截图 (Screenshot)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `screenshot` (
  `id`                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `image_data`          MEDIUMBLOB NOT NULL COMMENT 'PNG 图片二进制 (MEDIUMBLOB 最大 16MB)',
  `file_size`           INT UNSIGNED DEFAULT 0 COMMENT '文件大小（字节）',
  `mime_type`           VARCHAR(64) DEFAULT 'image/png' COMMENT 'MIME 类型',
  `trajectory_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory.id',
  `trajectory_step_id`  BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory_step.id',
  `trajectory_phase_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory_phase.id',
  `kind`                ENUM('before','after','phase_highlight') NOT NULL DEFAULT 'after' COMMENT 'before/after=步骤; phase_highlight=阶段长图',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_trajectory_id` (`trajectory_id`),
  UNIQUE KEY `uk_ss_step_kind` (`trajectory_step_id`, `kind`),
  UNIQUE KEY `uk_ss_phase_kind` (`trajectory_phase_id`, `kind`),
  CONSTRAINT `fk_ss_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ss_trajectory_step` FOREIGN KEY (`trajectory_step_id`) REFERENCES `trajectory_step` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ss_trajectory_phase` FOREIGN KEY (`trajectory_phase_id`) REFERENCES `trajectory_phase` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='截图';

-- ─────────────────────────────────────────────────────────────
-- API 响应覆写/Mock 规则 (ApiOverride) — P7 配置数据
-- scope_ref_id 为逻辑关联：scope 决定指向 system 表中 type=1/2/3 的节点
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `api_override` (
  `id`                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `name`              VARCHAR(255) NOT NULL COMMENT '规则名称',
  `url_pattern`       VARCHAR(2048) NOT NULL COMMENT '匹配的 URL 模式',
  `match_type`        ENUM('exact','prefix','regex') DEFAULT 'prefix' COMMENT 'URL 匹配方式',
  `http_method`       VARCHAR(16) DEFAULT '' COMMENT 'HTTP 方法，空表示不限',
  `enabled`           TINYINT(1) DEFAULT 1 COMMENT '是否启用',
  `resp_status`       INT UNSIGNED DEFAULT 200 COMMENT '覆写响应状态码',
  `resp_headers_json` JSON COMMENT '覆写响应头 { "Content-Type": "application/json" }',
  `resp_body`         MEDIUMTEXT COMMENT '覆写响应体',
  `scope`             ENUM('global','system','process','function') DEFAULT 'global' COMMENT '作用域',
  `scope_ref_id`      BIGINT UNSIGNED DEFAULT NULL COMMENT '作用域引用 id（scope 非 global 时指向对应层级表；逻辑关联，非硬外键）',
  `sort_order`        INT UNSIGNED DEFAULT 0 COMMENT '同一 URL 命中多条时的优先级',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY `idx_enabled` (`enabled`),
  KEY `idx_scope` (`scope`, `scope_ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='响应覆写/Mock 规则，运行时由 CDP Fetch.fulfillRequest 应用';

-- ============================================================
-- 默认数据（根 id=0 + type 1/2/3 三级未分类）
-- ============================================================
SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_AUTO_VALUE_ON_ZERO');

INSERT INTO `sys_dict_type` (`dict_name`, `dict_type`, `status`, `create_by`, `update_by`, `remark`) VALUES
  ('消息类型', 'sys_msg_type', '0', '', '', '产品消息抽屉 msgType');

INSERT INTO `sys_dict_data` (`dict_sort`, `dict_label`, `dict_value`, `dict_type`, `status`, `is_default`, `create_by`, `update_by`) VALUES
  (1, '批量导入任务', '1', 'sys_msg_type', '0', 'N', '', '');

INSERT INTO `system` (`id`, `system_id`, `type`, `parent_id`, `name`, `description`, `sort_order`) VALUES
  (0, '00000000-0000-0000-0000-000000000000', 0, 0, '根', '系统树根节点（不可删除）', 0);

INSERT INTO `system` (`system_id`, `type`, `parent_id`, `name`, `description`, `sort_order`) VALUES
  ('00000000-0000-0000-0000-000000000001', 1, 0, '未分类', '默认系统分类，用于尚未分配系统的历史轨迹', 0);

INSERT INTO `system` (`system_id`, `type`, `parent_id`, `name`, `description`, `sort_order`) VALUES
  ('00000000-0000-0000-0000-000000000002', 2, 1, '未分类', '默认流程分类', 0);

INSERT INTO `system` (`system_id`, `type`, `parent_id`, `name`, `description`, `sort_order`) VALUES
  ('00000000-0000-0000-0000-000000000003', 3, 2, '未分类', '默认功能分类', 0);

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
