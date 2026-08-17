# 总 TODO：缺陷 + Backlog（2026-08-13 基线 · 2026-08-17 更新）

> **跨会话共享清单。** Cursor 会话内 TodoWrite 不跨聊天；以本文件为准。  
> 来源：`c:\Users\water\Downloads\缺陷管理.xlsx`（2026-08-12 同步）+ [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md)。  
> 本文件只跟踪未闭环项。已修/已关条目已清出（历史见 git）。

## 挂起 / 待优化

| ID | 项 | 处理说明 |
|----|----|----------|
| **1448052** | 【AI录制】循环重复操作（较重） | Excel 已分配；slot-log 已就绪。2026-08-16 新增 `AI_DUP_FAILURE_CUE`（默认关）对连续相同失败动作注入纠偏；1448052 主线仍**等新缺陷 + 可检索日志**再改 |
| **heal-locate** | 【回放自愈】禁止/少用 `scroll_down` 找字段；高效定位与级联缺席判定 | ✅ **开发完成**（2026-08-15，`uara_V1.2`）：H0 调研 + MissingReason/HealContract + heal prompt + P2 决策路由已合入；characterization 全绿。剩余：真实 batch replay / live 湿测（见 `heal-locate-wet`）。见专节 |

### heal-locate — 回放自愈定位效率（✅ 开发完成 · 待 live 湿测）

**现象（2026-08-12 slot0）：** 单步自愈 goal=`滚动查找 '实际控制人单位电话' 字段并填写` → `scroll_down amount=300`。对级联字段（DOM 已卸/未出现）无效且烧 step。

**根因背景（已调研）：** 录制助手会在级联短暂出现时写入步骤；回放时闸门（如关系类型=本人、实际控制人整块未展开）使字段不在 DOM。自愈仍按「滚屏找控件」人类习惯行动；`heal-prompt.md` 未禁止 scroll 猎场，也未给「先判定缺席 / 先修闸门」策略。

**目标：** 自愈以 **O(1) 定位/判定** 为主，滚动仅为最后手段（或删除）。

**状态（2026-08-15 落地，2026-08-16 按 git 核对）：** 已完成开发并合入 `uara_V1.2`。

- 提交：`9bbe077` → `8bb87a2`（H0 调研）→ `8695d71`（MissingReason Analyzer + HealContract）→ `0e6963a`（replay/executor 接线）→ `15ff36d`（Python 解析 + heal prompt pack）→ `3620f22`（报告 + CHANGELOG）→ `e435e18`（P2 决策路由，`HEAL_LOCATE_DECISION_ENABLED`，默认关闭）→ `2ef0b1e`。
- 文档：[current-analysis spec](specs/2026-08-15-heal-locate-current-analysis.md) · [handoff plan](plans/2026-08-15-heal-locate-handoff-plan.md)。
- 验证：`characterize-heal-locate.mjs` 39 项、`characterize-heal-decision.mjs` 9 项、`characterize-heal-mode.py` 全绿；`verify-all.sh` ALL GREEN。
- **唯一剩余：** 真实浏览器 + 后端 + executor 的 batch replay live 湿测（Phase 7 场景），已登记为 `heal-locate-wet`。

**建议工作项（2026-08-15 已落地，以下为历史底稿）：**

1. **Prompt / 工具纪律（heal 专用）**  
   - 禁止用 `scroll_down`/`scroll_up` 猎字段或保存按钮。  
   - 字段 miss：`scan_visible_fields` / `scan_editable_summary` / 带 `region=` 的 `get_pending_tasks` → 有则带 `xpath_smart` 直填；无则进入缺席分支。  
   - 需要进视口时用控件路径上的 `scrollIntoView`（填/选动作内已有），不要像素滚动。

2. **级联缺席判定（与录制脏步骤同源）**  
   - 已知模式：`*归属人关系类型=本人` → 卸掉「归属人姓名/身份证」；上层闸门可卸整块「实际控制人*」。  
   - 自愈：label-not-found 时先读相关 select/闸门；若当前状态解释缺席 → **skip 本步并继续**（或改闸门后再填），不要滚屏。  
   - 可选：回放层对「级联可跳过」步骤打标，减少进自愈。

3. **定位优先级（高效操作序）**  
   1. 步骤自带 `element.xpath_smart` / 语义 label（exact）  
   2. 一次 fullpage/visible scan → 匹配 label/region  
   3. 修闸门（select / 引入 / Tab / collapse）后再 scan  
   4. （可选）`scroll_to_first_error` 仅校验失败后  
   5. ~~反复 `scroll_down`~~ 删除或硬限 0–1 次且须说明原因  

4. **验收**  
   - 自愈轨迹中 `scroll_down`/`scroll_up` 次数 → 近 0（猎场场景）。  
   - 「实际控制人单位电话」类缺席：≤2 step 内 skip 或闸门修复，无滚屏循环。  
   - Characterization：heal prompt 含反 scroll 猎场；可选 mock miss→skip 策略。

**相关：** 级联录制脏步骤（法定代表人归属人* / 实际控制人* Round2）；`heal-prompt.md`；`detect_heal_mode` / 单步自愈。

## Backlog 湿测（自 backlog「其它未闭环 / 推荐下一刀」）

| ID | 状态 | 项 |
|----|------|-----|
| **heal-locate-wet** | 待跑 | Heal-Locate live 冒烟：真实浏览器 + 后端 + executor；Phase 7 级联隐藏/折叠/Tab/Dialog/缺字段场景；`HEAL_LOCATE_DECISION_ENABLED=1` 路由验收 |
| **L1-picker-wet** | 挂起 | 多「新增」Vue 选择器冒烟；等执行机 / BiB 重载（缺陷 1448053 产品面已关） |
| **page-state-wet** | 挂起 | dialog/drawer 内/外同文案按钮碰撞湿测 |
| **L1c-wet** | P1 挂起 | `L1C_LLM=1` BiB 湿测低置信区域 |
| **L1c-scan-py** | P1 挂起 | Python scan 接入 `classify` / regions classify（与 L1c-wet 可同刀） |
| **AG-fullpage-wet** | 按需 | 无 label inventory BiB/UI 冒烟 |
| **session-lifecycle-wet** | 挂起 | A attach → streamDetach → B 同 Chrome 409 `grace_owned`；短 grace 后再认领；需在线执行机 + 已加载新控制面 |

## Backlog 工程债 / 未做（自 backlog 转入）

| ID | 优先级 | 项 |
|----|--------|-----|
| **fill-date-shell** | **已收尾** | 库内 7 行已 SQL 迁成 `fill_form_field`；控制器壳已删；别名归一；前端去掉「填写日期」 |
| **option-first-commit** | **已收尾**（2026-08-11，`79a8e92`） | `option_text=first` 聚焦 commit 已入库：`resolve_recorded_option_text` 盖章实际选项；select 路径不再持久化 first；characterization 覆盖（当前门禁由 `characterize-select-option-stamp.py` / `characterize-select-option-substring.py` / `characterize-form-engine-wiring.py` 承接） |
| **form-actions-split** | 部分（2026-08-15 大幅推进） | `form_autofill.py` + `autofill_round/pending` 已拆；`form_scan_utils` 拆成 summary/select/task；login/fill/select/radio/tree 拆到 `form_action_engines.py`。**剩余：`click_save` 与部分 scan/snapshot 动作壳仍在 `_form.py`（当前 ~990 行，验收线 ≲600）** — [TODO](todos/2026-08-11-split-form-actions.md) |
| **sectionOf-dead-calls** | **已收尾**（2026-08-13，`8b6863a`） | 产品面旧 `sectionOf` / `sectionAnchorOf` / `sectionAnchorXPath` 死调用已删；D3 锚 xpath 行为由 `SECTION_ATTACH` 保留；`characterize-section-anchored-xpath.py` OK |
| **T1r** | 穿插 | tree / replay label 兜底残余 |
| **T3r** | P2 | 活录 CDP 对拍残余 |
| **T4-P4** | P2 | Playwright MCP a11y ⟷ L2 对拍（灰度，非写路径） |
| **L1-vision** | P2+ | 争议容器裁图辅助定角色 |
| **T5** | 暂缓 | 非 `el-table` 自定义网格；需另页证据 · [gap](specs/2026-08-10-t5-credit-scan-gap-design.md) |
| **T9** | 部分 | 产品 `steps/replay` 常态验收（运维） |
| **三大问题①** | **已完成**（2026-08-13，V2.1 `2d5a54d`） | 表单助手已填跳过（`currentValue` 非空即 skip）；`scan_editable_summary` 只读、不 auto-fill；`characterize-scan-editable-summary.py` / `characterize-case-data.py` 门禁覆盖。见 `AI录制三大问题分析.md` |

### fill-date-shell — 已收尾（2026-08-13）

`js_gen`：`trajectory_step` 7 行 `fill_date_field`→`fill_form_field`；`special_element_step` 0 行。控制器动作已删；`fill_date_field` / `fillDateField` 仅作别名。前端 `vue-project/src` 已去掉独立「填写日期」。

## 产品排期（淼一协作 · 需求已梳理 2026-08-12）

> 权威需求纪要：[product-requirements-miaoyi-brief](specs/2026-08-12-product-requirements-miaoyi-brief.md)。工程映射见 [roadmap](plans/2026-08-12-miaoyi-workstream-roadmap.md)。

### 挂起 · 等会议

| ID | 状态 | 项 | 说明 |
|----|------|-----|------|
| **PR-SSO-ADMIN** | **挂起** | 公司登录 → 产品**管理员**如何映射 | 等 **2026-08-13 会议**；截至 2026-08-16 仓库/文档未见结论落地，继续挂起。推荐（未拍板）：账号中心 admin → 产品管理员（可删系统树）；普通用户增改不可删。结论前不实现权限闸。关联 **PR-SSO** / **PR-USER** |

### 产品任务

| ID | 状态 | 工作内容 | 已锁定要点 | 关联工程项 |
|----|------|----------|------------|------------|
| **PR-PART** | **第一刀已实现** | 元素分区算法完善 | V2.1：`display_group`/`region_label`。第一刀：tab+向导+titlebox 拼接已落地 — [design](specs/2026-08-13-partition-tab-wizard-titlebox-design.md) · [plan](plans/2026-08-13-partition-tab-wizard-titlebox.md)；9242 湿测已跑（对公客户修改；评级向导） | unify-partition · L1c · picker · regionAnchor |
| **PR-LAYER** | **本仓库侧已完成**（2026-08-15） | 元素分层树（分区之后） | 每控件 `layers[]` 已落 snap/resolve preview/扫描/`element_json`；可选 `pageLabel` 只加根 page；todo role 已对齐。**整页大树已落地（assembleRegionTree + 扫描/阶段树）**；`characterize-region-tree.mjs` OK。**本仓库无湿测记录**；Vue 画树另刀 | 依赖 PR-PART；Vue 画树另仓 |
| **PR-LOC** | **本仓库已落地（V2.1）** | 阶段长图 + 控件高亮 | AI `phase_done` 后 1 张 PNG；浅蓝蒙层 + 描边；滚主滚动区拼接。**湿测已完成**（对公长表单 / BiB） | [design](specs/2026-08-13-phase-highlight-long-screenshot-design.md) · [plan](plans/2026-08-13-phase-highlight-long-screenshot.md) |
| **PR-LOC-HL** | 挂起 | 步骤级高亮截图 | 操作**完成后**逐步高亮再截 | 逐步截仍挂起；阶段级高亮已并入 **PR-LOC** |
| **PR-DATA** | 待办 | 被测系统接口报文捞取 | 静态目录（开发提供）；AI 录制中动态捞；非消费型字段；软文本填写 | case-data 软文本底座；**需专刀 design** |
| **PR-BATCH** | **部分完成**（本周：交易列表加任务 8/19） | 批量导入：用户只看自己任务 | ① 用户隔离与 **PR-USER** appid 隔离同源，本周排 8/19；②行进度 + ③phase `done_logs` 已合 V2.1 | Vue BatchImport 另仓 |
| **PR-USER** | 待办（本周子项：系统树凭据维护 8/19） | 用户/系统树权限 | 树共享；交易本人可见；仅管理员删树。**本期只做系统树创建时用户名/密码/角色维护，不做权限闸** | 等 **PR-SSO-ADMIN**（权限部分）；凭据维护子项本周可独立推进 |
| **PR-SSO** | 待办（本周子项：appid 登录 + 数据隔离 8/19） | 接入公司账号中心 HTTP API | 用户名密码或 token 换会话；本周用流水线 appid 做脚本数据用户隔离 | 等 **PR-SSO-ADMIN**（管理员映射）；appid 隔离子项先做 |
| **PR-PUSH** | **已完成**（2026-08-15） · V2.0：每步 regionId/parentRegionId + 每交易 phases[]（截图引用+元数据）— [spec](specs/2026-08-14-batch-push-v2-region-evidence-design.md) | 推送到自动化 | 拒草稿；仅 recorded/completed；`characterize-transaction-export-region.mjs` OK；**未见 live 湿测记录** | export-push-gate |
| **PR-EXEC** | **挂起** | 脚本执行（引擎/执行机） | 本侧只提供浏览器操作与 actions 设计；暂不排调度产品 | T9 / session-lifecycle 湿测另跟 |

### 本周任务（2026-08-17 ~ 08-19 · 本人负责）

> 来源：产品周任务表。截图插件任务（手动截图按钮 / 坐标记录）**不属于本人**，仍由健君 / 淼一、正祥、张奕伟跟进（8.21）。

| 任务 | 对应 todo / 工程项 | 状态 | 交付日期 | 备注 |
|------|--------------------|------|----------|------|
| 3. 系统管理：系统树创建时维护用户名、密码、角色 | PR-USER 子集（不含权限闸） | **本周进行中** | **8.19** | 用作测试数据补充；当前版本不做权限场景，后续版本增加 |
| 4. 交易列表里增加任务 | PR-BATCH | **本周进行中** | **8.19** | 需求澄清已完成；JS-gen 对齐接口，Vue 另仓联调 |
| 5. 登录：流水线 appid + 脚本数据用户隔离 | PR-SSO / PR-USER 子集 | **本周进行中** | **8.19** | 用 appid 做用户隔离；PR-SSO-ADMIN 仍挂起，不阻塞本子项 |

**排期：**
- 8/17（周一）：对齐 3/4/5 实现方案与接口约定。
- 8/18（周二）：开发实现（系统树凭据维护 / 交易列表加任务 / appid 登录 + 数据隔离）。
- 8/19（周三）：交付 + characterization / 冒烟；更新对应 todo 状态。

## 交叉关系

- **1448052** ↔ 全页 DOM 合约；slot-log 已就绪；2026-08-16 已有 `AI_DUP_FAILURE_CUE` 缓解，主线等新缺陷 + 可检索日志再改。
- **heal-locate** ↔ 开发已完成（H0 + MissingReason/HealContract + heal prompt + P2 路由）；live 湿测见 **heal-locate-wet**。
- **PR-PART** ↔ 第一刀 tab/向导/titlebox 拼接已落地；9242 湿测已跑（对公客户修改；评级向导）。
- **PR-LAYER** ↔ 本仓库侧已完成：`layers[]` + 整页大树（`assembleRegionTree` + 扫描/阶段树）；Vue 画树另刀。依赖 **PR-PART**。
- **PR-LOC** ↔ 阶段长图本仓库已落地；**湿测已完成**。**PR-LOC-HL** 逐步截仍后置。
- **PR-PUSH** ↔ 推送/导出闸门已完成（2026-08-15，V2.0）；characterization OK，未见 live 湿测记录。
- **PR-BATCH** ↔ ① 用户隔离与 **PR-USER** appid 隔离同源，本周排 8/19（交易列表加任务）。
- **PR-SSO-ADMIN** ↔ 阻塞 **PR-SSO** / **PR-USER** 权限实现；2026-08-13 会议后未见结论落地，继续挂起。本周 appid 登录/数据隔离与系统树凭据维护子项不等待该结论。
- **session-lifecycle-wet** ↔ 湿测仍挂起（**PR-EXEC 挂起**时作工程债）。
- 控件视野主线细节仍以 [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md) 为准；需求纪要见 [brief](specs/2026-08-12-product-requirements-miaoyi-brief.md)。

## 更新记录

| 2026-08-17 | 产品周任务表排期：本人负责 3/4/5（系统树凭据维护、交易列表加任务、appid 登录 + 数据隔离），8/19 交付；新增「本周任务」小节；PR-USER/PR-SSO/PR-BATCH 标注本周子项。截图插件任务不归本人（健君 / 淼一、正祥、张奕伟 8/21） |
| 2026-08-16 | 全量核对 git/CHANGELOG：**option-first-commit、sectionOf-dead-calls、三大问题①** 标为已完成；**form-actions-split** 更新进度；**PR-LAYER/PR-PUSH** 更新为仓库侧已完成并标注测试状态；1448052 补充 `AI_DUP_FAILURE_CUE` 缓解说明 |
| 2026-08-16 | Recording steps hardening E1/E2/E3 合入：done accept reason、click_save sticky retry、`AI_DUP_FAILURE_CUE`（默认关）；对应 characterization 全绿 |
| 2026-08-16 | 核对 git（`uara_V1.2`）：**heal-locate 开发已完成**；todo 同步为「开发完成 + 仅剩 live 湿测」，新增 `heal-locate-wet` |
| 2026-08-15 | **Heal-Locate 开发落地**：H0 spec + Node analyzer/contract + heal prompt pack + P2 决策路由（默认关闭） — [spec](specs/2026-08-15-heal-locate-current-analysis.md) · [handoff](plans/2026-08-15-heal-locate-handoff-plan.md) |
| 2026-08-15 | 批量推送 V2.0 + 整页大树 + 阶段截图元数据 落地 — [plan](plans/2026-08-15-batch-push-v2-region-evidence.md) |
| 2026-08-14 | **PR-LAYER 第一刀实现：** 每控件 `layers[]` 落 snap/resolve/scan/`element_json`，可选根 `pageLabel`；整页大树 TODO — [plan](plans/2026-08-14-pr-layer-region-layers.md) |
| 2026-08-14 | **PR-LAYER 第一刀 spec：** 每控件 `layers[]`；整页大树 TODO — [design](specs/2026-08-14-pr-layer-region-layers-design.md) |
| 2026-08-13 | **PR-PART 第一刀落地**：tab + 向导 + titlebox 拼接（CI fixture） — [design](specs/2026-08-13-partition-tab-wizard-titlebox-design.md) · [plan](plans/2026-08-13-partition-tab-wizard-titlebox.md) |
| 2026-08-13 | **PR-PART 第一刀 plan：** tab + 向导 + titlebox 拼接 — [plan](plans/2026-08-13-partition-tab-wizard-titlebox.md) |
| 2026-08-13 | **PR-PART 第一刀 spec：** tab + 向导 + titlebox 拼接分区；表格/分层树后置 — [design](specs/2026-08-13-partition-tab-wizard-titlebox-design.md) |
| 2026-08-13 | **PR-LOC-wet 完成**（对公长表单 / BiB + 浅蓝蒙层） |
| 2026-08-13 | **1448062 本仓库已修**：AI 活录 `_record_action` 不因 capture 失败丢步；`stepEntryToTrajectoryStep` `requireUsable:false`。残余：REST 手工建步仍 400 `LOCATOR_REQUIRED` |
| 2026-08-13 | **fill-date-shell 收尾**：SQL 已迁 7 行；删 `fill_date_field` 动作；别名归一；前端去掉「填写日期」 |
| 2026-08-13 | 产品表加回 **PR-LOC** / **PR-PART** / **PR-PUSH**（状态仍为已落地/已完成） |
| 2026-08-13 | 清出已修缺陷与空待修表；session-lifecycle-commit、T7(不做)；**PR-BATCH** 只留 ①；湿测补 **PR-LOC-wet** |
| 2026-08-13 | V2.1 冻结：`master@8a50413`；下一线 `uara_V1.2` |


## Heal-Locate Optimization

**状态：** ✅ **开发完成**（2026-08-15 合入 `uara_V1.2`） · characterization 全绿 · **Phase 7 live 湿测待跑**（见 `heal-locate-wet`）

**总目标：**

将当前 Heal-Locate 从「元素不存在 → 盲目寻找 → 重复失败」升级为「定位失败 → 页面状态诊断 → 原因分类 → 自动修复 / 合理跳过 / 有限重试」。

最终目标：Agent 能理解“为什么找不到”，而不是只知道“没找到”。

### Phase 0：现状分析（Current State Analysis） ✅

- [x] 梳理 Replay → Action → Locator → Heal 调用链
- [x] 确认 Heal 触发条件
- [x] 分析当前 heal prompt 输入信息
- [x] 梳理当前 Locator 能力
- [x] 收集已有失败案例
- [x] 输出当前 Heal-Locate 架构图

产出：`docs/superpowers/specs/2026-08-15-heal-locate-current-analysis.md`。

### Phase 1：Heal-Locate Design ✅

- [x] 定义 Missing Element 分类体系
- [x] 定义 Heal Decision Tree
- [x] 定义定位优先级
- [x] 定义 Repair / Skip / Retry 策略

核心分类：

- Invisible
- Collapsed
- Conditional Hidden
- Wrong Page State
- Wrong Region
- Really Missing

> 分类体系已收敛为 MissingReason categories：`conditional_absent | not_visible | not_loaded | changed_structure | permission_blocked | business_locked | unknown`，并映射 `repair | skip | retry | heal | fail`。

### Phase 2：Locator Pipeline 优化 ✅

- [x] 建立 Locator Priority
- [x] 增加 semantic locate
- [x] 增加 region-aware locate
- [x] 限制 scroll 行为
- [x] 增加定位证据记录

> H0.4 已确认既有 `xpath_smart` / semantic / region 定位能力；`HealContract.target` 结构化携带 `action/label/xpath_smart/option_text`，`reason.evidence` + decision memory 记录定位证据；反 scroll 猎场禁令保留在 `heal-prompt.md`，live heal 由 strategy 约束。

### Phase 3：Missing Analyzer ✅

- [x] 设计缺席原因 Schema
- [x] 实现缺席分析器
- [x] 接入 Replay 流程
- [x] 增加诊断日志

> 落地为 Unified Missing Reason Analyzer：`src/services/trajectory/missing-reason-analyzer.js`（纯函数规则引擎）→ `heal-contract.js` → `runHealStep` 转发 → Python 解析。

### Phase 4：Heal Prompt 优化 ✅

- [x] 重构 heal prompt
- [x] 禁止无意义 scroll 搜索
- [x] 增加诊断流程
- [x] 增加结构化输出约束

> Type A/B instruction 旧文本不变，末尾追加【失败分析】`category/suggestedAction/evidence`；新增 `scripts/prompts/agent-tools-heal.md`，heal 模式只装配 `agent-core + agent-tools-common + agent-tools-heal`。

### Phase 5：Repair Action 扩展 ✅

- [x] expand section
- [x] switch tab
- [x] open dialog
- [x] select prerequisite option
- [x] refresh state
- [x] retry locate

> 既有工具已覆盖（`expand_all_el_tree` / `switch_tab` / `close_dialog` / `select_option` / `wait_for_loading` 等），本轮不新增工具；`agent-tools-heal.md` 的 strategy 约束优先使用等价恢复动作。

### Phase 6：Heal Trace & Memory ✅

- [x] 设计 heal_trace
- [x] 记录失败 → 原因 → 修复 → 结果链路
- [x] 关联 trajectory
- [x] 支持经验复用

> 落地为 decision memory：`runHealStep` 写入 `healType / maxSteps / healContract(mode,scope,strategy,category)` 并关联 `trajectoryId/sessionId`，作为失败→原因→修复→结果的审计沉淀，供经验复用。

### Phase 7：测试与验证 ⏳（live 湿测待跑）

- [ ] 级联隐藏字段测试
- [ ] 折叠区域测试
- [ ] Tab 状态错误测试
- [ ] Dialog 缺失测试
- [ ] 真实字段不存在测试

> 单元/契约 characterization 已绿（`characterize-heal-locate.mjs` 39 项、`characterize-heal-decision.mjs` 9 项、`characterize-heal-mode.py`）；以下 5 个真实浏览器场景尚未跑，统一登记为 `heal-locate-wet`。


## Heal-Locate Optimization TODO Adjustment (2026-08-14)

### Phase 3 调整

原目标：
- Missing Element Analyzer

调整为：
- Unified Missing Reason Analyzer

原因：
- 当前系统已经存在 label-not-found / ok-skip:label-not-found 等缺席字段处理逻辑。
- 不应重新建设独立缺席分析器，而应统一现有散落规则。

新的目标：

统一处理：
- label-not-found
- ok-skip:label-not-found
- field-disabled
- option-not-found
- select-disabled
- 页面状态导致的定位失败

形成统一决策模型：

MissingReason {
  type,
  confidence,
  evidence,
  action
}

决策结果：

- repair
- skip
- retry
- fail

Phase 3 后续以规则收敛和决策统一为主。
