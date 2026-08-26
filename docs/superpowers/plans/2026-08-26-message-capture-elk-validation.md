# 报文捞取+日志解析 ELK 验证（对公客户管理）Plan

> 关联 spec：`2026-08-26-message-capture-elk-validation.md`
> 状态：**待评审**

## 步骤

### P0 评审 Phase A（主 Agent）
- 对照 spec §4/§5 审查 `elk-msg-extract.mjs` 与 `characterize-log-extract.mjs` 的 GLM-5 改动：
  - complete 判定（有 End 标记 ∧ Request Body 非空 ∧ Status 存在）
  - 默认跳过不完整块、计数展示
  - `--latest N` 语义（升序全抓→保留末 N 条）
  - 网关前缀段级后缀匹配（≥2 接口反例）
  - import 守卫（characterization 可 import）
- 审查发现偏差 → 由主 Agent 直接修正（或小任务委托 GLM-5）
- 门禁：`node scripts/characterization/characterize-log-extract.mjs` + eslint

### P1 实现回填验证（GLM-5 委托，纯函数优先）
- `scripts/log-extract/validate-backfill.mjs`：
  - 导出纯函数 `matchApiRecord` / `buildBackfillKv` / `summarizeBackfill`（见 spec §5）
  - CLI：`--input records.json --mapping saveCustCorporat-field-mapping.json --out report.json [--md report.md]`
- `scripts/characterization/characterize-backfill.mjs`（pin 上述纯函数：命中/系统字段归类/嵌套/脱敏/反查/子集验证）
- `verify-all.sh` 追加 `run "characterize-backfill" node scripts/characterization/characterize-backfill.mjs`
- `README.md` 补验证用法 3 行

### P2 真实验证（主 Agent）
- 前置：确认/请求测试环境对公客户管理做一次新增保存（产生 saveCustCorporat 报文）
- 运行：48h 全量 + 表单接口窗口（`--uri /prod-api/…/custCorporat` 网关形式实测）
- 生成 `logs/backfill-report-*.json/md`；核对匹配率 ≥90%（或子集验证），解释全部未匹配项

### P3 门禁与提交
- `verify-all.sh` ALL GREEN；eslint 0 error/0 warning
- 提交（scripts-only；若有 src 改动先补 CHANGELOG）+ 推送 origin/uara_V1.2

### P4 汇报与后续
- 汇报：验证结论（报文→回填可用性）、报告位置、未匹配字段归因
- 后续建议：①SUT 三接口就绪后换真实映射源/日志源（解析器复用）；②system_ref 持久化（正式链路）；③录制自动注入

## 依赖与前置
- 测试环境有人操作一次对公客户新增/保存（**唯一外部依赖**）
- GLM-5 委托若超时 → 主 Agent 按 spec 实施（AGENTS.md 规则）
