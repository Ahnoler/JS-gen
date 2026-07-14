-- ============================================================
-- 智能填表系统 — 数据库初始化脚本
-- 目标数据库: MySQL 8.0+
-- 字符集: utf8mb4
-- 表数量: 13
-- ============================================================

CREATE DATABASE IF NOT EXISTS `uara`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `uara`;

-- ─────────────────────────────────────────────────────────────
-- 一级：被测系统 (System)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `system` (
  `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '代理主键',
  `system_id`   VARCHAR(36)  NOT NULL COMMENT 'UUID 业务标识',
  `name`        VARCHAR(255) NOT NULL COMMENT '系统名称，如 天阳信贷V5.2',
  `description` TEXT COMMENT '描述',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_system_id` (`system_id`),
  UNIQUE KEY `uk_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='被测系统';

-- ─────────────────────────────────────────────────────────────
-- 二级：业务流程 (Process)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `process` (
  `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `process_id`  VARCHAR(36)  NOT NULL COMMENT 'UUID 业务标识',
  `system_id`   BIGINT UNSIGNED NOT NULL COMMENT '外键 → system.id',
  `name`        VARCHAR(255) NOT NULL COMMENT '流程名称，如 客户转正流程',
  `description` TEXT,
  `sort_order`  INT UNSIGNED DEFAULT 0 COMMENT '排序序号',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_process_id` (`process_id`),
  UNIQUE KEY `uk_system_name` (`system_id`, `name`),
  CONSTRAINT `fk_process_system` FOREIGN KEY (`system_id`) REFERENCES `system` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务流程';

-- ─────────────────────────────────────────────────────────────
-- 三级：功能点 (FunctionDef)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `function_def` (
  `id`          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `function_id` VARCHAR(36)  NOT NULL COMMENT 'UUID 业务标识',
  `process_id`  BIGINT UNSIGNED NOT NULL COMMENT '外键 → process.id',
  `name`        VARCHAR(255) NOT NULL COMMENT '功能名称，如 新增信贷潜在客户',
  `description` TEXT,
  `sort_order`  INT UNSIGNED DEFAULT 0,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_function_id` (`function_id`),
  UNIQUE KEY `uk_process_name` (`process_id`, `name`),
  CONSTRAINT `fk_func_process` FOREIGN KEY (`process_id`) REFERENCES `process` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='功能点';

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
  `status`              ENUM('active','closed','crashed') DEFAULT 'active' COMMENT '会话状态',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closed_at`           DATETIME(3) DEFAULT NULL,
  UNIQUE KEY `uk_session_uuid` (`session_uuid`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='远程浏览器操控/录制会话（BrowserContext 隔离、视口、Target、生命周期）';

-- ─────────────────────────────────────────────────────────────
-- 轨迹主表 (Trajectory)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `trajectory` (
  `id`                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `trajectory_id`     VARCHAR(64)  NOT NULL COMMENT '业务标识，如 traj_20260713_143528',
  `task`              TEXT COMMENT '任务描述',
  `model`             VARCHAR(128) DEFAULT '' COMMENT '使用的 LLM 模型',
  `step_count`        INT UNSIGNED DEFAULT 0 COMMENT '总步数（history.length）',
  `action_count`      INT UNSIGNED DEFAULT 0 COMMENT '有效动作数',
  `is_done`           TINYINT(1) DEFAULT NULL COMMENT '是否完成',
  `is_successful`     TINYINT(1) DEFAULT NULL COMMENT '是否成功',
  `url`               VARCHAR(2048) DEFAULT '' COMMENT '目标页面 URL',
  `function_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → function_def.id',
  `remote_session_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → remote_session.id（远程/人工录制来源，可空）',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_trajectory_id` (`trajectory_id`),
  KEY `idx_function_id` (`function_id`),
  KEY `idx_remote_session_id` (`remote_session_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_model` (`model`),
  CONSTRAINT `fk_traj_function` FOREIGN KEY (`function_id`) REFERENCES `function_def` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_traj_remote_session` FOREIGN KEY (`remote_session_id`) REFERENCES `remote_session` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='浏览器操作轨迹';

-- ─────────────────────────────────────────────────────────────
-- 轨迹执行阶段 (TrajectoryPhase)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `trajectory_phase` (
  `id`             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `phase_id`       VARCHAR(36) NOT NULL COMMENT 'UUID 业务标识',
  `trajectory_id`  BIGINT UNSIGNED NOT NULL COMMENT '外键 → trajectory.id',
  `phase_number`   INT UNSIGNED NOT NULL COMMENT '阶段序号（1-based）',
  `description`    VARCHAR(512) DEFAULT '' COMMENT '来自 task_text，截断 200 字',
  `status`         ENUM('running','completed','failed') DEFAULT 'completed',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at`   DATETIME(3) DEFAULT NULL,
  UNIQUE KEY `uk_phase_id` (`phase_id`),
  KEY `idx_trajectory_id` (`trajectory_id`),
  KEY `idx_phase_number` (`trajectory_id`, `phase_number`),
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
  `description`         TEXT COMMENT '当前目标（来自 model_output.current_state.next_goal）',
  `params_json`         JSON COMMENT '动作参数 { text, value, index, url, label_text, option_text, ... }',
  `element_json`        JSON COMMENT '交互元素信息 { tag, xpath, cssSelector, attributes, candidates[], ... }',
  `success`             TINYINT(1) DEFAULT NULL COMMENT '是否成功',
  `error`               TEXT COMMENT '错误信息',
  `extracted_content`   TEXT COMMENT '执行结果',
  `trajectory_phase_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory_phase.id',
  `source`              ENUM('agent','manual','cdp') NOT NULL DEFAULT 'agent'
    COMMENT '动作来源：agent=AI Agent 录制 | manual=人工录制 | cdp=CDP 反查录制',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_trajectory_id` (`trajectory_id`),
  KEY `idx_step_number` (`trajectory_id`, `step_number`),
  KEY `idx_phase_number` (`trajectory_id`, `phase_number`),
  KEY `idx_action_type` (`action_type`),
  KEY `idx_traj_phase_id` (`trajectory_phase_id`),
  KEY `idx_source` (`source`),
  CONSTRAINT `fk_step_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_step_phase` FOREIGN KEY (`trajectory_phase_id`) REFERENCES `trajectory_phase` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='轨迹步骤';

-- ─────────────────────────────────────────────────────────────
-- 案例数据 (CaseData)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='案例数据';

-- ─────────────────────────────────────────────────────────────
-- 案例数据 KV 明细 (CaseDataEntry)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `case_data_entry` (
  `id`           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `case_data_id` BIGINT UNSIGNED NOT NULL COMMENT '外键 → case_data.id',
  `field_key`    VARCHAR(255) NOT NULL COMMENT '字段键名，如 "姓名"',
  `field_value`  TEXT COMMENT '字段值',
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_case_data_id` (`case_data_id`),
  KEY `idx_field_key` (`field_key`),
  CONSTRAINT `fk_entry_case_data` FOREIGN KEY (`case_data_id`) REFERENCES `case_data` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='案例数据键值';

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
  `case_data_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → case_data.id',
  `trajectory_id`  BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory.id',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_container` (`container`),
  KEY `idx_case_data_id` (`case_data_id`),
  KEY `idx_trajectory_id` (`trajectory_id`),
  CONSTRAINT `fk_fs_case_data` FOREIGN KEY (`case_data_id`) REFERENCES `case_data` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fs_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE SET NULL
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
  `id`            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `file_name`     VARCHAR(255) NOT NULL COMMENT '文件名，如 step-3-1712345678-abc.png',
  `image_data`    MEDIUMBLOB NOT NULL COMMENT 'PNG 图片二进制 (MEDIUMBLOB 最大 16MB)',
  `file_size`     INT UNSIGNED DEFAULT 0 COMMENT '文件大小（字节）',
  `mime_type`     VARCHAR(64) DEFAULT 'image/png' COMMENT 'MIME 类型',
  `trajectory_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '外键 → trajectory.id',
  `step_index`    INT UNSIGNED DEFAULT 0 COMMENT '对应步骤序号',
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY `idx_trajectory_id` (`trajectory_id`),
  KEY `idx_step_index` (`step_index`),
  CONSTRAINT `fk_ss_trajectory` FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='截图';

-- ─────────────────────────────────────────────────────────────
-- API 响应覆写/Mock 规则 (ApiOverride) — P7 配置数据
-- scope_ref_id 为逻辑关联：scope 决定指向 system/process/function_def 哪张表
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
-- 默认数据
-- ============================================================
INSERT INTO `system` (`system_id`, `name`, `description`) VALUES
  ('00000000-0000-0000-0000-000000000001', '未分类', '默认系统分类，用于尚未分配系统的历史轨迹');

INSERT INTO `process` (`process_id`, `system_id`, `name`, `description`) VALUES
  ('00000000-0000-0000-0000-000000000002', 1, '未分类', '默认流程分类');

INSERT INTO `function_def` (`function_id`, `process_id`, `name`, `description`) VALUES
  ('00000000-0000-0000-0000-000000000003', 1, '未分类', '默认功能分类');
