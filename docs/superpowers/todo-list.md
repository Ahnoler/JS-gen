# 总 TODO：缺陷 + Backlog（2026-08-13）

> **跨会话共享清单。** Cursor 会话内 TodoWrite 不跨聊天；以本文件为准。  
> 来源：`c:\Users\water\Downloads\缺陷管理.xlsx`（2026-08-12 同步）+ [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md)。  
> 本文件只跟踪未闭环项。已修/已关条目已清出（历史见 git）。

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
| **fill-date-shell** | **已收尾** | 库内 7 行已 SQL 迁成 `fill_form_field`；控制器壳已删；别名归一；前端去掉「填写日期」 |
| **option-first-commit** | — | 聚焦 commit：`option_text=first` 盖章（未入库 WIP） |
| **form-actions-split** | 部分 | `form_autofill.py` 已拆出；其余 select/click_save 分文件仍见 [TODO](todos/2026-08-11-split-form-actions.md) |
| **sectionOf-dead-calls** | 可选 | 删死代码里仅作产品猜归属的 `sectionOf` 调用；**勿删** D3 锚 xpath 函数 |
| **T1r** | 穿插 | tree / replay label 兜底残余 |
| **T3r** | P2 | 活录 CDP 对拍残余 |
| **T4-P4** | P2 | Playwright MCP a11y ⟷ L2 对拍（灰度，非写路径） |
| **L1-vision** | P2+ | 争议容器裁图辅助定角色 |
| **T5** | 暂缓 | 非 `el-table` 自定义网格；需另页证据 · [gap](specs/2026-08-10-t5-credit-scan-gap-design.md) |
| **T9** | 部分 | 产品 `steps/replay` 常态验收（运维） |
| **三大问题①** | 穿插 | 摘要化 / 禁清单 auto-fill 等；见 `AI录制三大问题分析.md`（与控件清单解耦） |

### fill-date-shell — 已收尾（2026-08-13）

`js_gen`：`trajectory_step` 7 行 `fill_date_field`→`fill_form_field`；`special_element_step` 0 行。控制器动作已删；`fill_date_field` / `fillDateField` 仅作别名。前端 `vue-project/src` 已去掉独立「填写日期」。

## 产品排期（淼一协作 · 需求已梳理 2026-08-12）

> 权威需求纪要：[product-requirements-miaoyi-brief](specs/2026-08-12-product-requirements-miaoyi-brief.md)。工程映射见 [roadmap](plans/2026-08-12-miaoyi-workstream-roadmap.md)。

### 挂起 · 等会议

| ID | 状态 | 项 | 说明 |
|----|------|-----|------|
| **PR-SSO-ADMIN** | **挂起** | 公司登录 → 产品**管理员**如何映射 | 等 **2026-08-13 会议**。推荐（未拍板）：账号中心 admin → 产品管理员（可删系统树）；普通用户增改不可删。结论前不实现权限闸。关联 **PR-SSO** / **PR-USER** |

### 产品任务

| ID | 状态 | 工作内容 | 已锁定要点 | 关联工程项 |
|----|------|----------|------------|------------|
| **PR-PART** | **本仓库已落地（V2.1）+ 第一刀 spec** | 元素分区算法完善 | V2.1：`display_group`/`region_label`。下一刀：tab+向导+titlebox 拼接 — [design](specs/2026-08-13-partition-tab-wizard-titlebox-design.md) | unify-partition · L1c · picker · regionAnchor |
| **PR-LAYER** | 待办 | 元素分层树（分区之后） | `页面→tab/向导/弹窗→功能分区→控件`；效果图已附 | 依赖 PR-PART；L1 `region_*` 产品展示 |
| **PR-LOC** | **本仓库已落地（V2.1）** | 阶段长图 + 控件高亮 | AI `phase_done` 后 1 张 PNG；浅蓝蒙层 + 描边；滚主滚动区拼接。**湿测已完成**（对公长表单 / BiB） | [design](specs/2026-08-13-phase-highlight-long-screenshot-design.md) · [plan](plans/2026-08-13-phase-highlight-long-screenshot.md) |
| **PR-LOC-HL** | 挂起 | 步骤级高亮截图 | 操作**完成后**逐步高亮再截 | 逐步截仍挂起；阶段级高亮已并入 **PR-LOC** |
| **PR-DATA** | 待办 | 被测系统接口报文捞取 | 静态目录（开发提供）；AI 录制中动态捞；非消费型字段；软文本填写 | case-data 软文本底座；**需专刀 design** |
| **PR-BATCH** | **部分完成** | 批量导入：用户只看自己任务 | ① 仍待办（等 **PR-USER**）。②行进度 + ③phase `done_logs` 已合 V2.1 | Vue BatchImport 另仓 |
| **PR-USER** | 待办 | 用户/系统树权限 | 树共享；交易本人可见；仅管理员删树 | 等 **PR-SSO-ADMIN** |
| **PR-SSO** | 待办 | 接入公司账号中心 HTTP API | 用户名密码或 token 换会话 | 等 **PR-SSO-ADMIN** |
| **PR-PUSH** | **已完成** | 推送到自动化 | 拒草稿；仅 recorded/completed | export-push-gate |
| **PR-EXEC** | **挂起** | 脚本执行（引擎/执行机） | 本侧只提供浏览器操作与 actions 设计；暂不排调度产品 | T9 / session-lifecycle 湿测另跟 |

## 交叉关系

- **1448052** ↔ 全页 DOM 合约；slot-log 已就绪，等新缺陷 + 可检索日志再改。
- **heal-locate** ↔ 级联脏录制 + 单步自愈；先判定缺席再修闸门，禁止 scroll 猎场。
- **PR-PART** ↔ 后端分区已合 V2.1；湿测仍见 L1-picker / L1c。
- **PR-LAYER** ↔ 分区之后的产品树；依赖 **PR-PART**。
- **PR-LOC** ↔ 阶段长图本仓库已落地；**湿测已完成**。**PR-LOC-HL** 逐步截仍后置。
- **PR-PUSH** ↔ 推送/导出闸门已完成。
- **PR-BATCH** ↔ ① 用户隔离与 **PR-USER** 同源，未做。
- **PR-SSO-ADMIN** ↔ 阻塞 **PR-SSO** / **PR-USER** 权限实现；等 2026-08-13 会议。
- **session-lifecycle-wet** ↔ 湿测仍挂起（**PR-EXEC 挂起**时作工程债）。
- 控件视野主线细节仍以 [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md) 为准；需求纪要见 [brief](specs/2026-08-12-product-requirements-miaoyi-brief.md)。

## 更新记录

| 2026-08-13 | **PR-PART 第一刀 spec：** tab + 向导 + titlebox 拼接分区；表格/分层树后置 — [design](specs/2026-08-13-partition-tab-wizard-titlebox-design.md) |
| 2026-08-13 | **PR-LOC-wet 完成**（对公长表单 / BiB + 浅蓝蒙层） |
| 2026-08-13 | **1448062 本仓库已修**：AI 活录 `_record_action` 不因 capture 失败丢步；`stepEntryToTrajectoryStep` `requireUsable:false`。残余：REST 手工建步仍 400 `LOCATOR_REQUIRED` |
| 2026-08-13 | **fill-date-shell 收尾**：SQL 已迁 7 行；删 `fill_date_field` 动作；别名归一；前端去掉「填写日期」 |
| 2026-08-13 | 产品表加回 **PR-LOC** / **PR-PART** / **PR-PUSH**（状态仍为已落地/已完成） |
| 2026-08-13 | 清出已修缺陷与空待修表；session-lifecycle-commit、T7(不做)；**PR-BATCH** 只留 ①；湿测补 **PR-LOC-wet** |
| 2026-08-13 | V2.1 冻结：`master@8a50413`；下一线 `uara_V1.2` |
