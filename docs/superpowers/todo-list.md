# 总 TODO：缺陷 + Backlog（2026-08-12）

> **跨会话共享清单。** Cursor 会话内 TodoWrite 不跨聊天；以本文件为准。  
> 来源：`c:\Users\water\Downloads\缺陷管理.xlsx`（2026-08-12 同步）+ [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md)。  
> Excel「当前状态」多为 **已分配**；本文件工程状态：`进行中` / `待办` / `挂起` / `已解决` / `转前端` / `本仓库已修`。

## 进行中

| ID | 项 | 备注 |
|----|----|------|
| **1448062** | 【AI录制】未抓取到 xpath 时没产生步骤（较重/高） | Excel 已分配；工程侧已在修 |

## 缺陷待修（开着 · 对照最新 Excel）

| ID | 优先级 | 项 |
|----|--------|-----|

## 本仓库已修（缺陷）

| ID | 项 | 备注 |
|----|----|------|
| **1448060** | 【人工录制】下拉选项未进步骤，只录点击按钮 | 2026-08-12：对公客户评级「新增」弹窗内 **下拉含表格**；`fedbd6f` table-row select 落 `select_option`+option。残余：AI 仍可能先 `click_element_by_index` 点下拉行 → 多一条「点击元素」；已加 `use-select-option` 硬闸（拒点下拉面/表格行，不落步） |
| **1448068** | 【UI录制】草稿交易被推送成功 | 2026-08-12：push 仅 `recorded`/`completed`；409 `not_pushable_status` |
| **1448067** | 【UI录制】回放提示成功但未点到元素 | 正确相对 xpath 未写入 params（部分已修）。**待办卡片「处理」**：`div.todo-item-action` 非 button → 人工不入库 + 回放漏选 + **自动抓取/分区不收录**；2026-08-12 已补录制/回放/L2 `collectL2Buttons` + L1 `assignRegion` + resolve |
| **1448061** | 【批量导入】空文件接口提示语改中文（一般） | Excel 仍「已分配」；工程：`请上传 Excel 文件` / 无数据行中文文案 |
| **1448050** | 【批量导入】下载模板文件名改中文（低） | 2026-08-12：根因在 Vue `a.download` 写死英文；已改 `批量录制导入模板.xlsx`（JS-gen Content-Disposition 此前已中文） |
| **1448055** | 【AI录制】录到 `save_form_snapshot` 等非业务步骤 | Excel 仍「已分配」；工程：产品树/步骤默认过滤 meta；仍入库 + 回放区间自动补检查点 |
| **1448066** / **ai-case-select** | 【UI录制】AI录制下拉忽略案例数据、默认选第一项 | Excel 仍「已分配」；工程：业务数据仅软文本；撤回 commandValue 硬绑；【阶段目录】全量 phase |
| **1448064** / **ai-case-half-fill** | 【UI录制】案例 KV 填值只填一半 | Excel 仍「已分配」；工程：form assistant 读案例面板 flat KV；prompt 原样填写 |
| **tree-select-kind** | 行业代码等录成 `tree_node` 而非树选择器 | 2026-08-12：`select_tree_option`+`form_tree_select`；popover 回绑 |
| **select-substr** | 下拉子串误配（国民经济部门类别→非金融…） | 2026-08-12：exact/`match_select_option_candidate`；禁止 `o in want` |
| **manual-table-radio** | 【人工录制】弹窗表格 radio 不落步 | 2026-08-12：`data-row-key`/`row-index` 回退，禁静默 return |
| **canvas-copy** | 【前端画布】本机剪贴板 C/V | 2026-08-12：JS-gen 协议/执行机/控制面已落地；Vue `useRemoteCanvas.ts`（`d:/dev/ui-auto-recording-agent-vue-master/vue-project/src/composables/useRemoteCanvas.ts`）Task 4 完成；[design](specs/2026-08-12-bib-canvas-clipboard-design.md) 已实现 |

## 已解决 / 非本侧

| ID | 项 | 结论 |
|----|----|------|
| **1448054** | 【AI录制】连续多元素只录一个（较重） | 去重原则，非缺陷；Excel 仍「已分配」 |
| **1448053** | 【AI录制】同元素点第一个（较重） | L1-picker / page-state 消歧已落地；湿测可按需验 |
| **1448057** | 【列表】占用中 `live` 状态名改中文（低） | **转前端** |
| **1448059** | 【AI录制】无法优先识别客户名称（较重） | **已解决（产品用法）**：用户数据直接写进任务说明 |
| **slot-log** | 多 slot 浏览器日志隔离/可检索 | **已落地**：[plan](plans/2026-08-11-multi-slot-stderr-isolation.md) |
| **select-state** | 下拉状态边界（reset / 单步 / xpath 回退） | **已落地**（`79a8e92`）；专题分支勿再 merge |
| **1448056** | 【批量导入】存草稿有步骤但界面显示步骤为 0 | **不在 2026-08-12 Excel 表中**（疑已关或未导出）；从待修移出 |

## 挂起 / 待优化

| ID | 项 | 处理说明 |
|----|----|----------|
| **1448052** | 【AI录制】循环重复操作（较重） | Excel 已分配；全页 DOM 合约待调；slot-log 已就绪，**等新缺陷 + 可检索日志**再改 |
| **heal-locate** | 【回放自愈】禁止/少用 `scroll_down` 找字段；高效定位与级联缺席判定 | 部分落地：`label-not-found`→`ok-skip`；其余定位序仍待做。见专节 |

### heal-locate — 回放自愈定位效率（TODO）

**现象（2026-08-12 slot0）：** 单步自愈 goal=`滚动查找 '实际控制人单位电话' 字段并填写` → `scroll_down amount=300`。对级联字段（DOM 已卸/未出现）无效且烧 step。

**根因背景（已调研）：** 录制助手会在级联短暂出现时写入步骤；回放时闸门（如关系类型=本人、实际控制人整块未展开）使字段不在 DOM。自愈仍按「滚屏找控件」人类习惯行动；`heal-prompt.md` 未禁止 scroll 猎场，也未给「先判定缺席 / 先修闸门」策略。

**目标：** 自愈以 **O(1) 定位/判定** 为主，滚动仅为最后手段（或删除）。

**建议工作项（未排期，设计后再改）：**

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
| **L1-picker-wet** | 挂起 | 多「新增」Vue 选择器冒烟；等执行机 / BiB 重载（缺陷 1448053 产品面已关） |
| **page-state-wet** | 挂起 | dialog/drawer 内/外同文案按钮碰撞湿测 |
| **L1c-wet** | P1 挂起 | `L1C_LLM=1` BiB 湿测低置信区域 |
| **L1c-scan-py** | P1 挂起 | Python scan 接入 `classify` / regions classify（与 L1c-wet 可同刀） |
| **AG-fullpage-wet** | 按需 | 无 label inventory BiB/UI 冒烟 |
| **session-lifecycle-wet** | 挂起 | A attach → streamDetach → B 同 Chrome 409 `grace_owned`；短 grace 后再认领；需在线执行机 + 已加载新控制面 |

## Backlog 工程债 / 未做（自 backlog 转入）

| ID | 优先级 | 项 |
|----|--------|-----|
| **session-lifecycle-commit** | — | 聚焦 commit：remote_session `grace_until` + SessionLifecycle 门面（工作树未提交；勿与 stderr/Partner WIP 混提） |
| **option-first-commit** | — | 聚焦 commit：`option_text=first` 盖章（未入库 WIP） |
| **form-actions-split** | P2 | 拆 `_form.py`；[TODO](todos/2026-08-11-split-form-actions.md) |
| **sectionOf-dead-calls** | 可选 | 删死代码里仅作产品猜归属的 `sectionOf` 调用；**勿删** D3 锚 xpath 函数 |
| **T1r** | 穿插 | tree / replay label 兜底残余 |
| **T3r** | P2 | 活录 CDP 对拍残余 |
| **T4-P4** | P2 | Playwright MCP a11y ⟷ L2 对拍（灰度，非写路径） |
| **L1-vision** | P2+ | 争议容器裁图辅助定角色 |
| **T5** | 暂缓 | 非 `el-table` 自定义网格；需另页证据 · [gap](specs/2026-08-10-t5-credit-scan-gap-design.md) |
| **T9** | 部分 | 产品 `steps/replay` 常态验收（运维） |
| **三大问题①** | 穿插 | 摘要化 / 禁清单 auto-fill 等；见 `AI录制三大问题分析.md`（与控件清单解耦） |
| **T7** | 不做 | API 改名 `control_*`（明确不做，仅登记） |

## 产品排期（淼一协作 · 需求已梳理 2026-08-12）

> 权威需求纪要：[product-requirements-miaoyi-brief](specs/2026-08-12-product-requirements-miaoyi-brief.md)。工程映射见 [roadmap](plans/2026-08-12-miaoyi-workstream-roadmap.md)。原 MY-* 已迁为 **PR-***。

### 挂起 · 等会议

| ID | 状态 | 项 | 说明 |
|----|------|-----|------|
| **PR-SSO-ADMIN** | **挂起** | 公司登录 → 产品**管理员**如何映射 | 等 **2026-08-13 会议**。推荐（未拍板）：账号中心 admin → 产品管理员（可删系统树）；普通用户增改不可删。结论前不实现权限闸。关联 **PR-SSO** / **PR-USER** |

### 产品任务

| ID | 状态 | 工作内容 | 已锁定要点 | 关联工程项 |
|----|------|----------|------------|------------|
| **PR-PART** | 进行中 | 元素分区算法完善 | 同页同名可分；分层之前 | unify-partition · L1c · picker · page-state · **1448067** · regionAnchor |
| **PR-LAYER** | 待办 | 元素分层树（分区之后） | `页面→tab/向导/弹窗→功能分区→控件`；效果图已附 | 依赖 PR-PART；L1 `region_*` 产品展示 |
| **PR-LOC** | 待办 | 整页 stitch（phase 绑定） | 停录/阶段结束自动 1 张；`trajectory_phase` 新字段存 URL/id；**非** step screenshot | screenshots · phase 模型；步骤高亮截图 → **PR-LOC-HL** |
| **PR-LOC-HL** | 挂起 | 步骤级高亮截图 | 操作**完成后**高亮再截 | stitch / 分区稳定后 |
| **PR-DATA** | 待办 | 被测系统接口报文捞取 | 静态目录（开发提供）；AI 录制中动态捞；非消费型字段；软文本填写 | case-data · 1448066/64 底座；**需专刀 design** |
| **PR-BATCH** | 待办 | 批量导入增强 | ①用户只看自己任务 ②按行进度条 ③phase `done`→`trajectory_log` 数组 | Vue BatchImport · batch API · trajectory_log |
| **PR-USER** | 待办 | 用户/系统树权限 | 树共享；交易本人可见；仅管理员删树 | 等 **PR-SSO-ADMIN** |
| **PR-SSO** | 待办 | 接入公司账号中心 HTTP API | 用户名密码或 token 换会话 | 等 **PR-SSO-ADMIN** |
| **PR-PUSH** | **已完成** | 推送到自动化 | 拒草稿；仅 recorded/completed | **1448068** · export-push-gate |
| **PR-EXEC** | **挂起** | 脚本执行（引擎/执行机） | 本侧只提供浏览器操作与 actions 设计；暂不排调度产品 | 原 MY-08/09；T9/session-lifecycle 工程债另跟 |

## 交叉关系

- **1448053** ↔ L1-picker / page-state / L1-titlebox（同文案消歧；产品面已关，湿测另验）。
- **1448052** ↔ 全页 DOM 合约（**slot-log 已落地**；按新缺陷 + 可检索日志再调合约）。
- **1448059** ↔ 已关：任务说明内嵌用户数据（非助手扫描主路径改造）。
- **slot-log** ↔ 已关：多 slot stderr 隔离/可检索（1448052 前置）。
- **1448060** ↔ 对公客户评级新增弹窗：下拉面板内嵌表格选行；须落 `select_option`；AI 禁止 `click_element_by_index` 点下拉面（`use-select-option` 闸）。
- **1448066** ↔ **ai-case-select**；**1448064** ↔ **ai-case-half-fill**：案例/业务数据统一软文本。↔ **PR-DATA** 软文本底座。
- **1448055** ↔ Type B `save_form_snapshot`：产品隐藏 ≠ 删除；回放仍依赖入库检查点。
- **1448068** ↔ 推送/导出闸门。↔ **PR-PUSH 已完成**。
- **1448067** ↔ 待办「处理」L2/L1。↔ **PR-PART**。
- **heal-locate** ↔ 级联脏录制 + 单步自愈；先判定缺席再修闸门，禁止 scroll 猎场。
- **session-lifecycle-*** ↔ session lifecycle spec/plan；湿测与 commit 待办（**PR-EXEC 挂起**时作工程债，不升产品排期）。
- **PR-LOC** ↔ phase stitch 字段；**PR-LOC-HL** 后置。
- **PR-LAYER** ↔ 分区之后的产品树（效果图已确认形态）。
- **PR-BATCH** ↔ 用户隔离与 **PR-USER** 同源；done→`trajectory_log`。
- **PR-SSO-ADMIN** ↔ 阻塞 **PR-SSO** / **PR-USER** 权限实现；等 2026-08-13 会议。
- 控件视野主线细节仍以 [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md) 为准；**未闭环跟踪以本文件为准**；需求纪要见 [brief](specs/2026-08-12-product-requirements-miaoyi-brief.md)。

## 更新记录

| 日期 | 变更 |
|------|------|
| 2026-08-12 | 产品需求梳理：MY→**PR-***；锁定 stitch/DATA/BATCH/分层等；**PR-SSO-ADMIN 挂起等 8.13 会议**；纪要 [brief](specs/2026-08-12-product-requirements-miaoyi-brief.md) |
| 2026-08-12 | 录入淼一协作产品排期 **MY-01..09**；**MY-06 推送到自动化 = 已完成**；交叉关系与 [roadmap](plans/2026-08-12-miaoyi-workstream-roadmap.md) |
| 2026-08-11 | 初建：缺陷表 + backlog 合并；标 1448054/53 已解决、1448057 转前端、1448061/50 本仓库已修、1448062 进行中 |
| 2026-08-11 | 待修加 `ai-case-select`：AI录制下拉忽略案例数据、默认选第一项 |
| 2026-08-11 | `ai-case-select`：agent_task 挂 KV 文本 + 全量阶段目录；撤回硬绑 |
| 2026-08-11 | 待修加 `ai-case-half-fill`：案例步骤设置后 AI 录制只填一半 |
| 2026-08-11 | `ai-case-half-fill`：form assistant 补 flat KV + 原样填写 prompt；确认助手应读案例面板 KV；交叉关系补 select↔half-fill |
| 2026-08-11 | **1448055** 本仓库已修：meta 步骤产品侧过滤 + 回放区间自动补检查点 |
| 2026-08-12 | 待优化加 **heal-locate**：回放自愈禁 scroll 猎场；级联缺席判定 + 高效定位序（traj#33 实际控制人单位电话） |
| 2026-08-12 | 自 backlog 转入未闭环：湿测状态对齐（挂起/P1）；补 **L1c-scan-py** / **session-lifecycle-wet|commit** / **sectionOf-dead-calls** / **T9** / **三大问题①** / **T7(不做)** |
| 2026-08-12 | **1448059** 已解决（产品用法）：用户数据直接写入任务说明，不再挂「优化场景/任务分析助手」 |
| 2026-08-12 | **slot-log** 已落地：多 slot 日志隔离（1448052 前置解除） |
| 2026-08-12 | **select-state** 收尾：确认已在 `V2.1_dev@79a8e92`；对齐 char 断言；退役 `fix/select-option-state-boundary` worktree（勿 merge） |
| 2026-08-12 | 同步 `缺陷管理.xlsx`（14 条均「已分配」）：**新增待修 1448068 / 1448067**；**1448066/1448064** 对齐正式编号；**1448056** 不在表中移出待修；tree-select / select-substr / manual-table-radio 归入本仓库已修 |
| 2026-08-12 | **1448060** 本仓库已修：对公客户评级新增弹窗「下拉含表格」；table-row select 落选项步 |
| 2026-08-12 | **1448060** 残余：AI `click_element_by_index` 点下拉表格行仍落「点击元素」→ `use-select-option` 硬闸 |
| 2026-08-12 | **1448067**/待办「处理」：`div.todo-item-action` 人工录制入库 + 回放 durable/parent_text 消歧 |
| 2026-08-12 | **自动抓取/分区**：L2 `collectL2Buttons` 收录 `.todo-item-action`；L1 `assignRegion` 按 `.todo-item` 卡片分区；`regionAnchor*` / resolve 同步 |
| 2026-08-12 | **regionAnchor R4**：`sectionAnchor*` 别名已删；xpath 消歧仅用 `regionAnchor*` — [design](specs/2026-08-12-retire-abc-d3-favor-l1l2-regionanchor-design.md) |
| 2026-08-12 | 待修加 **canvas-copy**：前端 BiB 画布本机剪贴板；设计稿 [bib-canvas-clipboard](specs/2026-08-12-bib-canvas-clipboard-design.md) |
| 2026-08-12 | **canvas-copy** 实现计划：[plans/2026-08-12-bib-canvas-clipboard.md](plans/2026-08-12-bib-canvas-clipboard.md) |
| 2026-08-12 | **canvas-copy** 本仓库已修：BiB `kind:clipboard` / `remote:clipboard` + Vue `useRemoteCanvas` C/V 拦截 |
