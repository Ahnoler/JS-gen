# 总 TODO：缺陷 + Backlog（2026-08-13 基线 · 2026-08-17 更新）

> **跨会话共享清单。** Cursor 会话内 TodoWrite 不跨聊天；以本文件为准。  
> 来源：`c:\Users\water\Downloads\缺陷管理.xlsx`（2026-08-12 同步）+ [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md)。  
> 本文件只跟踪未闭环项。已修/已关条目已清出（历史见 git）。

## 挂起 / 待优化

| ID | 项 | 处理说明 |
|----|----|----------|
| **1448052** | 【AI录制】循环重复操作（较重） | Excel 已分配；slot-log 已就绪。2026-08-16 新增 `AI_DUP_FAILURE_CUE`（默认关）对连续相同失败动作注入纠偏；1448052 主线仍**等新缺陷 + 可检索日志**再改 |
| **v3-payload-size** | 【V3/V2 接口】优化传输数据量 + 防信息丢失 + 增强鲁棒性 | 2026-08-18 登记。现状：V3 payload（traj 38）紧凑传输 308KB，大头在 target xpath / params / rect（可选字段）；V2 精简后约 90KB。目标：① 精简传输（评估去 `params`、压缩/收敛 target、可选字段裁剪）② 防信息丢失（构建期字段完整性校验/缺失统计，推送前自检）③ 鲁棒性（缺字段降级、超长截断策略、消费方容错）。代码 TODO 已写 `transaction-export-v3.js` 头部 + api-docs notes |
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

Heal-Locate Optimization 转存 Heal-Locate Optimization.md 文件中。

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
| **PR-LOC** | **已落地（V2.1）** · 需求变更（2026-08-17）：阶段长图**无元素高亮**；**内部滚动容器修复（2026-08-17，`d570311`）** | 阶段长图 + 控件坐标 | AI `phase_done` 后 1 张 PNG（滚主滚动区拼接，**不再烘焙高亮**）；`screenshot.metadata_json` 记录截图长宽（image/content 双坐标系）+ **全部可见 L2 控件坐标**（left/top/right/bottom + kind/text/layers/region）+ region_tree。**长图内部滚动修复**：`pickScrollRoot` 泛化覆盖非标准 class 的内部滚动容器（如 `.plugin-content-list` 瀑布流，scrollHeight 6554/clientHeight 659），修复前回退 document 只截一屏；湿测命中正确滚动根。湿测已完成 | [design](specs/2026-08-13-phase-highlight-long-screenshot-design.md) · 阶段截图 V2 已合 V2.1 |
| **PR-LOC-HL** | **需求变更**（2026-08-17）：由「步骤级高亮截图」改为「**控件坐标点亮**」；**MVP 已定**：只用阶段图 `metadata.elements[]` 控件坐标点亮（不补步骤坐标）。**前置项已落地（2026-08-17）**：步骤 element region/bbox 入库（spec `2026-08-17-step-element-region-bbox-design.md` + plan 5 任务完成，commit `68065cb`~`38f20a9`，9242 湿测 3 层分层 + 内容坐标验证通过）。**探索工具已建**（`scripts/tools/`） | 步骤级控件坐标 → 推送 | 旧方向（操作后逐步高亮再截）**取消**。**MVP**：阶段长图无元素高亮 + `metadata.elements[]` 经推送 V2.0 envelope（`phases[].metadata`）推给公司其他平台。**工具（功能分离）**：① 元素高亮 `lightup-phase-screenshot.mjs`；② 元素分层 `layer-tree-from-properties.mjs`（`--file`/`--shot`/`--trajectory` 三模式）。**前置项（完成）**：录制时 `_capture_element`/`_enrich_click_element` evaluate `assignRegion` + `stepBBoxOf`（内容坐标，泛化 `pickScrollRoot` 覆盖内部滚动容器），`element_json` 新增 `region_id`/`region_label`/`layers[]`/`bbox`——新录制按 step 分层 + 步骤级高亮可用（湿测：`tab:客户基本信息\|section\|titlebox` 3 层 + y1=4769 内容坐标正确）。**剩余**：端到端录制验证 element_json 落库；步骤级高亮（bbox 画框，PR-LOC-HL 本体）待 design | 参考 `src/services/transaction-export.js`（V2.0）；spec `2026-08-17-step-element-region-bbox-design.md`；工具 commit `8e9e76d`/`43290ec`/`1e1ecad`/`01197ce`/`55f648e`/`8f3d15e` |
| **PR-DATA** | 待办 | 被测系统接口报文捞取 | 静态目录（开发提供）；AI 录制中动态捞；非消费型字段；软文本填写 | case-data 软文本底座；**需专刀 design** |
| **PR-BATCH** | **已交付**（2026-08-18，用户确认前端完成） | 批量导入：用户只看自己任务 | ① 用户隔离与 **PR-USER** appid 隔离同源：`paas_user_id` 列表过滤/盖章/存量回填/批量透传已落地（`c0503f3`/`7abf7e8`/`8ab90e0`）+ 前端任务 key 按 paasUserId 命名空间；②行进度条 + ③phase done 说明前端已实现（`el-progress`/`lastDoneText`/详情页 `doneLogs`）。**已知小缺口**：交易列表页无 batchTaskName 筛选入口（后端参数已支持）、顶栏徽标文案未实现 | Vue BatchImport 另仓 |
| **PR-USER** | 凭据维护**后端已落地**（2026-08-17）；前端 UI + 联调进行中（8/19） | 用户/系统树权限 | 树共享；交易本人可见；仅管理员删树。**本期只做系统树创建时用户名/密码/角色维护，不做权限闸**：`system_account.username`→`account` 更名 + 节点 POST/PUT `accounts[]` 批量维护（`1a46519`）+ 节点详情回显 `accounts[]`（`d09fc60`） | 等 **PR-SSO-ADMIN**（权限部分）；前端凭据维护 UI 8/19 |
| **PR-SSO** | 子项已落地（2026-08-17：appid 登录 + 数据隔离；2026-08-18：JWT 验签 + /me 回查用户）；完整登录后置 | 接入公司账号中心 HTTP API | 前端跳账号中心登录，回调 authCode=JWT 当 token；后端验签（`query_jwt_secret` 密钥，HMAC-SHA256）+ 解 payload 拿 `paasUserId` 做 `/api/v2/*` 用户隔离（`SSO_AUTH_REQUIRED` 默认关，空 `paas_user_id`=全可见）；`/me` 回查 `query_access_user` 返回 userName/userAccount（`d8efbfd`/另仓 `7390a6a`）；管理员映射仍挂起 | 等 **PR-SSO-ADMIN**（管理员映射）；换会话/权限后置 |
| **PR-PUSH** | **已完成**（2026-08-15） · V2.0：每步 regionId/parentRegionId + 每交易 phases[]（截图引用+元数据）— [spec](specs/2026-08-14-batch-push-v2-region-evidence-design.md) | 推送到自动化 | 拒草稿；仅 recorded/completed；`characterize-transaction-export-region.mjs` OK；**未见 live 湿测记录** | export-push-gate |
| **PR-EXEC** | **挂起** | 脚本执行（引擎/执行机） | 本侧只提供浏览器操作与 actions 设计；暂不排调度产品 | T9 / session-lifecycle 湿测另跟 |

### 本周任务（2026-08-17 ~ 08-19 · 本人负责）

> 来源：产品周任务表。截图插件任务（手动截图按钮 / 坐标记录）**不属于本人**，仍由健君 / 淼一、正祥、张奕伟跟进（8.21）。  
> **进度快照（2026-08-17 EOD）：** 排期时间 **33%**（1/3 天）· 三条主任务综合 **~78%** · 开发事项对齐（本周范围 18 项）**15/18 ≈ 83%** · 较排期**超前约 1.5 天**（后端已于 8/17 集中落地）。

| 任务 | 对应 todo / 工程项 | 进度 | 状态 | 交付日期 | 备注 |
|------|--------------------|------|------|----------|------|
| 3. 系统管理：系统树创建时维护用户名、密码、角色 | PR-USER 子集（不含权限闸） | **~70%** | **后端已交付**（2026-08-17）；前端 UI + 联调 8/19 | **8.19** | 后端 5/5 ✅：`account` 更名 + `accounts[]` 批量维护（`1a46519`）+ 节点详情回显（`d09fc60`）。待办：另仓凭据 UI + JS-gen↔Vue 联调 |
| 4. 交易列表里增加任务 | PR-BATCH | **100%** | **已交付**（2026-08-18，用户确认前端完成） | **8.19** | 后端 6/6 ✅ + 前端完成（行进度条/done 说明/任务按用户持久化）。小缺口：列表页 batchTaskName 筛选入口、顶栏徽标未实现；「只看我的」UI 后置 |
| 5. 登录：流水线 appid + 脚本数据用户隔离 | PR-SSO / PR-USER 子集 | **100%** | **已交付**（2026-08-17 主体 + 2026-08-18 验签/回查） | **8.19** | `c0503f3`/`45e0b6a`/`d8efbfd` + 另仓 SSO `75e9562`/`7390a6a`；`SSO_AUTH_REQUIRED` 默认关，冒烟时开；**PR-SSO-ADMIN** 仍挂起不阻塞 |

**排期 vs 实际：**

| 日期 | 计划 | 实际（截至 8/17 14:32） |
|------|------|-------------------------|
| 8/17（周一） | 对齐 3/4/5 实现方案与接口约定 | ✅ 方案已对齐；**三条任务本仓后端均已落地**（27 commits） |
| 8/18（周二） | 开发实现（凭据维护 / 交易列表 / appid 隔离） | ⚠️ 后端提前完成；**剩余主要为另仓前端** |
| 8/19（周三） | 交付 + characterization / 冒烟 | ⏳ 联调、`SSO_AUTH_REQUIRED=1` 冒烟、更新 todo 为已交付 |

**8/18–8/19 聚焦：** 系统树凭据 UI · BatchImport 任务列表联调 · SSO 冒烟 · 本周任务表标「已交付」。

### 开发事项对齐（2026-08-17 · 本周 3/4/5 拆解）

#### ① 登录与用户管理（PR-SSO / PR-USER）

| 事项 | 状态 | 说明 / commit |
|------|------|---------------|
| SSO 接入：auth 中间件 + `/api/v2/auth/{sso/login-page,sso/logout-page,me,sso/check}` | ✅ 已落地 | `c0503f3`；`SSO_AUTH_REQUIRED` 默认关，仅 `/api/v2/*`，白名单 `/api/v2/auth/*` |
| JWT 解码 + 验签（`verifyPaasToken`：HMAC-SHA256，密钥 `query_jwt_secret`，缓存 1h；`SSO_JWT_SECRET` 可配置覆盖；密钥不可用降级纯解） | ✅ 已落地 | `c0503f3`（解码）+ `d8efbfd`（验签，`src/services/sso/jwt-decode.js`） |
| 前端 SSO 接通：占位接口 → 真实 `/v2/auth/*` + `stores/user.ts` + 401 处理 | ✅ 已落地（另仓） | vue-project dev `75e9562` |
| 用户名显示（`paasUserId` 替代硬编码 `675310918`） | ✅ 已落地（另仓） | `75e9562` |
| `/me` 回查用户信息（`query_access_user` → userName/userAccount，如 管理员/admin）+ 前端显示用户名 | ✅ 已落地 | `d8efbfd` + 另仓 `7390a6a`（`src/services/sso/paas-client.js`） |
| 管理员角色映射 / 权限闸 | ⏳ 挂起 | **PR-SSO-ADMIN** 等会议结论 |

#### ② 交易管理的用户隔离（PR-BATCH / PR-USER 子集）

| 事项 | 状态 | 说明 / commit |
|------|------|---------------|
| schema：`trajectory`/`batch_recording_job` 加 `paas_user_id VARCHAR(32)` + 索引 | ✅ 已落地 | 迁移 `20260818000000`（已跑） |
| 列表/统计按 `paasUserId` 过滤（`list`/`listByFunction`/`countByRecordStatus`，空=全可见） | ✅ 已落地 | `c0503f3`；A/B 用户实测（B 看不到 A 的） |
| 手工创建交易盖章（`POST /api/v2/trajectories`） | ✅ 已落地 | `c0503f3` |
| 批量导入任务盖章 + view 归属校验 404 + 幂等 key 跨用户 409 | ✅ 已落地 | `c0503f3` |
| 批量导入生成交易透传 `job.paasUserId` | ✅ 已落地（补漏） | `7abf7e8`（analyze 链路曾漏盖，已修 + characterization 断言） |
| 存量数据回填归 admin（95 交易 + 18 任务） | ✅ 已落地 | `8ab90e0`（迁移 `20260818120000`，幂等） |
| 前端批量导入任务 key 按 paasUserId 命名空间 | ✅ 已落地（另仓） | `75e9562` |
| 交易列表加任务前端（行进度条 / phase done 说明 / 任务 summary） | ✅ 已落地（另仓，2026-08-18 用户确认） | BatchImportDialog `el-progress`/`lastDoneText`、详情页 `doneLogs` |
| 前端「只看我的」开关 UI | ⏳ 待办 | 后端已按 token 自动过滤；切换「全部/我的」UI 另开。**小缺口**：列表页 batchTaskName 筛选入口未接（后端参数已支持）、顶栏徽标文案未实现 |
| `messages`/`case-data`/`screenshots` 用户隔离 | ⏳ 未做 | 等 **PR-SSO-ADMIN**（权限部分）后统一收紧 |
| 单条 `GET /api/v2/trajectories/:id` 归属校验 | ⏳ 未做 | 同上，本周仅列表/创建/批量隔离 |

#### ③ 系统附带多账户 + 新增/编辑接口同步（system-mgmt / 本周任务 3）

| 事项 | 状态 | 说明 / commit |
|------|------|---------------|
| `system_account.username` → `account` 更名（迁移 + init.sql + 实体同步） | ✅ 已落地 | `1a46519`（2026-08-17） |
| 节点 `POST /api/v2/system-mgmt/nodes` type=1 支持 `accounts[]` 批量创建 | ✅ 已落地 | `1a46519` |
| 节点 `PUT /api/v2/system-mgmt/nodes/{id}` 支持 `accounts[]` 全量替换（按 id 更新 / 无 id 按 name 匹配 / 未出现删除） | ✅ 已落地 | `1a46519` |
| 账号被 `batch_recording_job` 引用时删除返回 409 | ✅ 已落地 | `1a46519` |
| account/password 接受数字并落库为字符串 | ✅ 已落地 | `1a46519` |
| 前端系统树凭据维护 UI（创建/编辑时维护用户名、密码、角色） | ⏳ 进行中（另仓） | 本周任务 3，8/19 |
| JS-gen ↔ Vue 接口联调（accounts[] 新增/编辑同步） | ⏳ 进行中 | 8/19 |

## 交叉关系

- **1448052** ↔ 全页 DOM 合约；slot-log 已就绪；2026-08-16 已有 `AI_DUP_FAILURE_CUE` 缓解，主线等新缺陷 + 可检索日志再改。
- **heal-locate** ↔ 开发已完成（H0 + MissingReason/HealContract + heal prompt + P2 路由）；live 湿测见 **heal-locate-wet**。
- **PR-PART** ↔ 第一刀 tab/向导/titlebox 拼接已落地；9242 湿测已跑（对公客户修改；评级向导）。
- **PR-LAYER** ↔ 本仓库侧已完成：`layers[]` + 整页大树（`assembleRegionTree` + 扫描/阶段树）；Vue 画树另刀。依赖 **PR-PART**。
- **PR-LOC** ↔ 阶段长图已落地（V2.1，**无元素高亮**，控件坐标存 `metadata_json`）；湿测已完成。**PR-LOC-HL** 需求变更（2026-08-17）：步骤级高亮截图**取消**，改为「步骤控件坐标存储 + 推送其他平台」（参考批量推送 V2.0 接口）。
- **PR-PUSH** ↔ 推送/导出闸门已完成（2026-08-15，V2.0）；characterization OK，未见 live 湿测记录。
- **PR-BATCH** ↔ ① 用户隔离与 **PR-USER** appid 隔离同源，本周排 8/19（交易列表加任务）。
- **PR-SSO-ADMIN** ↔ 阻塞 **PR-SSO** / **PR-USER** 权限实现；2026-08-13 会议后未见结论落地，继续挂起。本周 appid 登录/数据隔离与系统树凭据维护子项不等待该结论。
- **session-lifecycle-wet** ↔ 湿测仍挂起（**PR-EXEC 挂起**时作工程债）。
- 控件视野主线细节仍以 [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md) 为准；需求纪要见 [brief](specs/2026-08-12-product-requirements-miaoyi-brief.md)。

## 更新记录

| 2026-08-18 | **任务 4（交易列表加任务）已交付**：Vue 侧确认完成（行进度条 `el-progress`、phase done 说明 `lastDoneText`/详情页 `doneLogs`、任务按 paasUserId 持久化）；PR-BATCH 标已交付。**任务 5 增强落地**：SSO JWT 验签（`verifyPaasToken`，密钥 `query_jwt_secret`=paas-application，缓存 1h，`SSO_JWT_SECRET` 可配置覆盖；伪造 token 拒绝、密钥不可用降级纯解）+ `/me` 回查账号中心用户信息（`query_access_user` → userName/userAccount，实测 管理员/admin）——commit `d8efbfd` + 另仓 `7390a6a`（顶部用户名显示「管理员」）；characterization 25/25 绿。已知小缺口：列表页 batchTaskName 筛选入口、顶栏徽标文案未实现（非阻塞） |
| 2026-08-17 | **PR-LOC-HL 前置项完成：步骤 element region/bbox 入库**：spec（`2026-08-17-step-element-region-bbox-design.md`）+ plan 5 任务全部落地（`68065cb`~`38f20a9`，verify-all ALL GREEN）；录制时 `assignRegion` + `stepBBoxOf`（内容坐标，泛化 `pickScrollRoot`）写入 `element_json`（`region_id`/`region_label`/`layers[]`/`bbox`）；9242 浏览器湿测通过（`tab:客户基本信息\|section\|titlebox` 3 层 + 内容坐标 y1=4769 正确）。剩余：端到端录制验证落库；步骤级高亮（bbox 画框）待 design |
| 2026-08-17 | **本周任务进度写回**：三条主任务综合 ~78%（任务 5 已交付；任务 3/4 后端已交付待 8/19 联调）；开发事项对齐 15/18；日报见 `docs/report/2026-08-17.md` |
| 2026-08-17 | **PR-LOC-HL 探索进度**：点亮 viewer 工具 `scripts/tools/lightup-phase-screenshot.mjs` 已建并提交（`8e9e76d` 操作过过滤 / `43290ec` 三维匹配 / `1e1ecad` 移除冗余勾选）——阶段图 56 控件画框 + 「仅显示本阶段操作过的控件」+ 点击详情；**三维匹配验证**：`formLabel`→`label`、`target_kind`→`kind`、`regionId`→`regionId`，traj 157 phase 4 匹配 **16/16**（原 text 匹配 1/4）；结论：表单填写型阶段匹配可靠，下拉/弹窗/切 tab 场景需步骤坐标兜底（后置待 design） |
| 2026-08-17 | **PR-LOC / PR-LOC-HL 产品需求变更**：阶段长图**无元素高亮**（V2.1 已落地，控件坐标存 `metadata_json`）；**PR-LOC-HL 取消「步骤级高亮截图」**，新方向=所有步骤操作的控件坐标入库（`element_json` 当前无 bbox，需补）+ 经批量推送 V2.0 envelope（`transcationProperties` 当前无坐标字段，需加）推送给公司其他平台。待办（需 design） |
| 2026-08-17 | **阶段长图内部滚动容器修复**（`d570311`）：`pickScrollRoot` 泛化——标准主区优先，否则扫描全页可滚动容器（`div/main/section/article` + overflowY auto/scroll + scrollHeight>clientHeight）选最高者，覆盖 `.plugin-content-list` 瀑布流（6554/659）；修复前回退 document 只截一屏。真实页面湿测命中正确滚动根；characterization 断言新增 |
| 2026-08-17 | **任务 3/4 后端交付、任务 5 已交付**：产品任务表更新——**PR-BATCH** ① 用户隔离后端已落地（`c0503f3`/`7abf7e8`/`8ab90e0`）、**PR-USER** 凭据维护后端已落地（`1a46519`/`d09fc60`）、**PR-SSO** 子项已落地；本周任务 3/4 标「后端已交付，前端 UI + 联调 8/19」，任务 5 标已交付。另：**执行机 slot 复用 bug 修复**（`a9a4d56`）：supersede 补关闭执行机 agent session（keepBrowser 保留 Chrome 复用），根因=控制面重启后重连时旧 slot 占用排除孤儿扫描导致新开 slot |
| 2026-08-17 | **新增「开发事项对齐」区段**：本周 3/4/5 拆解为三块——① 登录与用户管理（SSO 接入/JWT 解码/前端接通已落地；友好用户名、token 校验、权限闸待办或挂起）、② 交易管理用户隔离（列表过滤/盖章/批量透传/存量回填已落地；只看我的 UI、messages 等隔离待办）、③ 系统多账户 + 新增/编辑接口同步（accounts[] 批量维护已落地 `1a46519`；前端凭据维护 UI 与联调进行中 8/19）。补漏 commit `7abf7e8`（批量导入生成交易透传 paasUserId）、存量回填 `8ab90e0` |
| 2026-08-17 | **任务 5（appid 登录 + 数据隔离）已交付**：后端 `paas_user_id` 列（迁移已跑）+ `/api/v2/auth/*` 四端点 + auth 中间件（`SSO_AUTH_REQUIRED` 默认关）+ 列表/批量导入按 `paasUserId` 过滤与盖章（commit `c0503f3`，verify-all Python 解析修复 `45e0b6a`）；前端 SSO 接通 + user store + 401 处理（另仓 dev `75e9562`）。characterization 20/20 绿（内嵌 Python）；`characterize-tree-select-record` 需 `playwright install`（预存环境，未跑） |
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

