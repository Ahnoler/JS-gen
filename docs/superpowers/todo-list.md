# 总 TODO：缺陷 + Backlog（2026-08-11）

> **跨会话共享清单。** Cursor 会话内 TodoWrite 不跨聊天；以本文件为准。  
> 来源：`缺陷管理.xlsx` + [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md)。  
> 状态约定：`进行中` / `待办` / `挂起` / `已解决` / `转前端` / `本仓库已修`。

## 进行中

| ID | 项 | 备注 |
|----|----|------|
| **1448062** | 【AI录制】未抓取到 xpath 时没产生步骤（较重/高） | 已在修 |

## 本仓库已修（缺陷）

| ID | 项 | 备注 |
|----|----|------|
| **1448061** | 【批量导入】空文件接口提示语改中文（一般） | 2026-08-11：`请上传 Excel 文件` / 无数据行中文文案 |
| **1448050** | 【批量导入】下载模板文件名改中文（低） | 2026-08-11：`批量录制导入模板.xlsx` |
| **1448055** | 【AI录制】录到 `save_form_snapshot` 等非业务步骤 | 2026-08-11：产品树/步骤默认过滤 meta；仍入库 + 回放区间自动补检查点 |
| **ai-case-select** | 【UI录制】AI录制下拉忽略案例数据、默认选第一项 | 2026-08-11：业务数据仅软文本（agent_task block+KV）；撤回 commandValue 硬绑；【阶段目录】全量 phase |
| **ai-case-half-fill** | 【UI录制】案例 KV 填值只填一半（`PJ20260811` vs full） | 2026-08-11：form assistant 亦读案例面板 flat KV（产品确认）；`business_data` 与 agent_task 对齐；prompt 原样填写 |

## 已解决 / 非本侧

| ID | 项 | 结论 |
|----|----|------|
| **1448054** | 【AI录制】连续多元素只录一个（较重） | 去重原则，非缺陷 |
| **1448053** | 【AI录制】同元素点第一个（较重） | L1-picker / page-state 消歧已落地；湿测可按需验 |
| **1448057** | 【列表】占用中 `live` 状态名改中文（低） | **转前端** |

## 挂起 / 待优化

| ID | 项 | 处理说明 |
|----|----|----------|
| **1448052** | 【AI录制】循环重复操作（较重） | 全页 DOM 合约待调；**等新缺陷 + 日志**再改 |
| **slot-log** | 多 slot 浏览器日志隔离/可检索 | **1448052 前置**；见 [plan](plans/2026-08-11-multi-slot-stderr-isolation.md) |
| **1448059** | 【AI录制】无法优先识别客户名称（较重） | 优化「业务场景描述助手」+「任务分析助手」 |
| **heal-locate** | 【回放自愈】禁止/少用 `scroll_down` 找字段；高效定位与级联缺席判定 | 部分落地：`label-not-found`→`ok-skip`（回放成功跳过、录制不写步）；其余定位序仍待做。见专节 |

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

## 缺陷待修（开着）

| ID | 优先级 | 项 |
|----|--------|-----|
| **1448060** | 较重/中 | 【人工录制】下拉选项未进步骤，只录点击按钮 |
| **1448056** | 一般/中 | 【批量导入】存草稿有步骤但界面显示步骤为 0 |

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

## 交叉关系

- **1448053** ↔ L1-picker / page-state / L1-titlebox（同文案消歧；产品面已关，湿测另验）。
- **1448052** ↔ 全页 DOM 合约 + **多 slot 日志**（先能定位，再按新缺陷调合约）。
- **1448059** ↔ Agent 助手设计（非控件扫描主路径）。
- **ai-case-select** ↔ **ai-case-half-fill**：案例/业务数据统一软文本；主 Agent（agent_task）与 form assistant（`business_data`）都读 block+flat KV，不硬绑 `commandValue`。
- **1448055** ↔ Type B `save_form_snapshot`：产品隐藏 ≠ 删除；回放仍依赖入库检查点。
- **heal-locate** ↔ 级联脏录制（关系类型/实际控制人块）+ 单步自愈；先判定缺席再修闸门，禁止 scroll 猎场。
- **session-lifecycle-*** ↔ [`spec`](specs/2026-08-11-browser-session-lifecycle-design.md) / [`plan`](plans/2026-08-11-browser-session-lifecycle.md)；代码已落、湿测与 commit 待办。
- 控件视野主线细节仍以 [`backlog-visible-editable-controls.md`](backlog-visible-editable-controls.md) 为准；**未闭环跟踪以本文件为准**（本文件不重复已 Done 的 D1–D7 / T3 / FP / agent-final-save / legacy-section-retire 等）。

## 更新记录

| 日期 | 变更 |
|------|------|
| 2026-08-11 | 初建：缺陷表 + backlog 合并；标 1448054/53 已解决、1448057 转前端、1448061/50 本仓库已修、1448062 进行中 |
| 2026-08-11 | 待修加 `ai-case-select`：AI录制下拉忽略案例数据、默认选第一项 |
| 2026-08-11 | `ai-case-select`：agent_task 挂 KV 文本 + 全量阶段目录；撤回硬绑 |
| 2026-08-11 | 待修加 `ai-case-half-fill`：案例步骤设置后 AI 录制只填一半 |
| 2026-08-11 | `ai-case-half-fill`：form assistant 补 flat KV + 原样填写 prompt；确认助手应读案例面板 KV；交叉关系补 select↔half-fill |
| 2026-08-11 | **1448055** 本仓库已修：meta 步骤产品侧过滤 + 回放区间自动补检查点 |
| 2026-08-12 | 待优化加 **heal-locate**：回放自愈禁 scroll 猎场；级联缺席判定 + 高效定位序（traj#33 实际控制人单位电话） |
| 2026-08-12 | 自 backlog 转入未闭环：湿测状态对齐（挂起/P1）；补 **L1c-scan-py** / **session-lifecycle-wet|commit** / **sectionOf-dead-calls** / **T9** / **三大问题①** / **T7(不做)** |
