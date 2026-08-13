# Backlog: 可见可编辑控件 / Agent 视野（核实版 2026-08-11）

> 本文件记录「目标线」地图与已实施证据。**状态以代码/表征为准**，不以计划 checkbox 为准。  
> **未闭环执行清单：** 已迁到 [`todo-list.md`](todo-list.md)（湿测 / 工程债 / 穿插项）；本文件「其它未闭环」作对照，改状态时两边同步。  
> **下一刀（优先）：** 见 todo-list — 湿测（L1-picker / AG / L1c / page-state / session-lifecycle）；聚焦 commit（`option_text=first`、session-lifecycle）。`legacy-section-retire` 产品面 Done。  
> 2026-08-11 湿测：`log.txt` **agent-final-save 通过**（阶段2 引入袁玲 → `picker confirm → submit-ready` → `ok-save-success` → `done() accepted after introduce`）。  
> 已提交：`d12a515` agent-final-save · `441a228` page-state-gen · `c87b448` L1c · legacy-section slices · `dfb2293` slice-3。

## 目标定稿（2026-08-10 修订）

> AI 拥有**当前页面上所有可见、已分类、可操作控件**的确定性清单（含顶栏/左侧导航），并由**主 Agent**决定操作。  
> **不是**裸全 DOM；**不是**清单触发 auto-fill。  
> **扫描结构**：L1 区域/容器 → L2 全页可见可操作控件 → 按位置归位（见 [fullpage scan design](specs/2026-08-10-fullpage-visible-controls-scan-design.md)）。

| 锁定项 | 选择 |
|--------|------|
| 「全 DOM」语义 | **α** 已分类可操作控件全集（非整棵 HTML 树） |
| 可操作边界 | input / select / date / radio / checkbox / button / icon / tree / **menu_item** |
| 壳层（顶栏/侧栏） | **进入清单**（2026-08-10 改；旧「不进清单」作废） |
| 容器 | 仅作 L1 归位，**不作** L2 准入门槛 |
| 与 auto-fill | **永不**由清单触发；主 Agent 控制填写 |
| 消费者 | **C**：先 Agent 工具，记忆 Fact Pack 第二刀 |
| 消歧主信号 | **L1 `region_*` + titlebox + page-state**；旧 D3 产品面已退役（锚 xpath 保留） |

## 核实方法

- 表征：`characterize-form-scan-control-first` / `characterize-control-ops-closed-loop` / `characterize-xpath-primary-ops` / `characterize-capture-element-xpath` → 均 OK  
- 近刀：`characterize-l1c-region-classify` / `characterize-page-state-gen` / `characterize-wizard-next-page-state` / `characterize-phase-runtime` → OK  
- 代码：`scripts/controller/actions/*` / `js_snippets/` / `_replay.py` / `src/ctrl-actions.js` / `src/cdp/page-locator-helpers.js`  
- 规格：活 = **`2026-08-09-scan-editable-summary-*`** + L1 / page-state 系列；已落地见 [`archive/`](archive/README.md)

---

## 已实施（勿再当未做）

| ID | 项 | 证据 |
|----|----|------|
| **D1 / T-scan** | Source B `el-table` 扫描 + `xpath_smart` | `SCAN_SOURCE_B_EL_TABLE`；表征 OK |
| **D2 / T1+T2** | xpath-primary Phase A+B 主路径 | `_resolve_control`；fill/select/date/radio + round xpath-only |
| **D3** | control-ops 分块 + buttons + `click_save(section)` | `sectionOf` / `SCAN_SOURCE_C_BUTTONS` — **仍在用；退役见 legacy-section-retire** |
| **D4** | date/radio/checkbox xpath helpers | `JS_FILL_DATE_BY_XPATH` / `JS_CLICK_RADIO_BY_XPATH` |
| **D5** | Phase Intent `all_editable` | `_phase_intent` / `_phase_context` |
| **D6** | 回放 params-first fill/select + 回读 | `_resolve_replay_xpath`；湿跑 25/25 |
| **D7（产品侧）** | `JS_SELECT_OPTION` 懒加载滚底 | `SELECT_LAZY_LOAD_ON_MISS` |
| **T3** | 录制 `element ≡ params` xpath | `JS_CAPTURE_FROM_XPATH`；commits `a35d7d1`…`ffac550` |
| **T6** | Source B 空行首表格行命名 `row#N` | `SOURCE_B_EMPTY_LEADING` / `SOURCE_B_ROW_INDEX_XPATH` |
| **T8** | CTRL `selectOption` 懒加载对齐 Agent | `SELECT_LAZY_LOAD_ON_MISS` in `src/ctrl-actions/select.js` |
| **T10-P0** | unsafe checkpoint `confirmed=0` 但不 abort 批次 | `form-structure-heal.js` / `replay-batch-runner.js` · `6b0bf7f` |
| **T10-P1** | verify Source A+B | `VERIFY_SOURCE_B_EL_TABLE` · commits `db38d9a`…`2337537` |
| **FP-P0..P2** | 全页 L2 + L1 归位 + icon/chrome 降噪 | [fullpage scan](specs/2026-08-10-fullpage-visible-controls-scan-design.md) · P2 noise |
| **dual-save** | 双「保存」section-anchored xpath + sticky 门禁 | [spec](specs/2026-08-10-dual-save-section-xpath-design.md)；湿跑 PASS |
| **wizard-next** | 「下一步/上一步」page-state 相对 xpath | [spec](specs/2026-08-10-wizard-next-page-state-xpath-design.md)；湿跑 PASS |
| **dialog-TL** | 弹窗 TaskList `multi` + `mark_done` 同 label 全清 | `characterize-dialog-tasklist-scope` OK |
| **L1-picker** | 歧义 resolve：`region_*` 预览 + Vue 选择器 | [spec](specs/2026-08-10-resolve-ambiguous-section-preview-design.md)；**BiB 湿测挂起** |
| **L1-titlebox** | 同 needle 碰撞 → titlebox `region_*` + 锚定 xpath | `b207372` · [spec](specs/2026-08-10-resolve-collision-finer-l1-titlebox-design.md) |
| **AG-fullpage** | 自动抓取 inventory + 可选过滤 + infer actionType | [spec](specs/2026-08-10-auto-grab-fullpage-inventory-design.md)；**UI/BiB 湿测按需** |
| **L1c-LLM** | feature card → 控制面 LLM；`POST /api/v2/regions/classify`；`L1C_LLM` 默认关 | `c87b448` · [spec](specs/2026-08-10-l1c-llm-region-classify-design.md)；scan Python / LLM 湿测待跟进 |
| **L1d-cache** | `systemId` + signature → role（进程内 TTL；含于 L1c） | 见 L1c spec |
| **page-state-gen** | 碰撞可点击：步骤条→dialog/drawer→breadcrumb 锚 `xpath_smart` | `441a228` · [spec](specs/2026-08-10-page-state-gen-clickable-anchor-design.md)；dialog 碰撞湿测待做 |
| **P2-noise+** | 黑名单「标签」对齐「页签」 | `characterize-scan-fullpage-p2` |
| **agent-final-save** | 引入确认（含 index「确认」）→ `_submit_ready`；create/modify +4 步；倒二步 urgency；缺 toast_ok 不再被 introduce_ok 放过 | `d12a515` · `characterize-phase-runtime` PASS |

---

## T4 分期

| 阶段 | 状态 | 交付 | 规格/计划 |
|------|------|------|-----------|
| **T4-P0..P3** | **已实施** | summary / multi-root / memory factpack / T6+T8 | 见历史 plans |
| **T4-P4** | 未做 | Playwright MCP a11y **对照/诊断**（灰度，非写路径） | 可与 Vision 并行 |

---

## 其它未闭环（对照表 → 执行跟踪见 [todo-list.md](todo-list.md)）

| ID | 状态 | 项 | 建议优先级 |
|----|------|----|------------|
| **form-actions-split** | **Open** | 拆 `_form.py`（~2k）注册仓：select / click_save / autofill 分文件；行为零 diff | **P2** · [TODO](todos/2026-08-11-split-form-actions.md) |
| **legacy-section-retire** | **Done（slice-1–3）** | 产品面优先 `region=`；`section=` 兼容；Vue 写 region_*；D3 锚 xpath 仍保留 | **P1 完成** · [TODO](todos/2026-08-11-remove-legacy-section-chunking.md) |
| **L1c-wet / scan-py** | 挂起 | L1c：`L1C_LLM=1` BiB 湿测；Python scan 接入 classify | P1 |
| **page-state-wet** | 挂起 | dialog/drawer 同文案按钮碰撞湿测 | P1 |
| **L1-picker-wet** | 挂起 | BiB 重载 + 多「新增」Vue 选择器冒烟 | 挂起 · 等执行机 |
| **AG-fullpage-wet** | 按需 | BiB / UI 自动抓取冒烟 | 按需 |
| **session-lifecycle** | 代码未提交 / 湿测挂起 | `grace_until` + SessionLifecycle；A→B 409 湿测 | 见 todo-list |
| **L1-vision** | 未做 | 争议容器裁图辅助定角色 | P2+ |
| **T4-P4** | 未做 | a11y ⟷ L2 对拍诊断 | P2 |
| **T5** | 暂缓 | 非 `el-table` 自定义网格 | 需另页证据 · [gap](specs/2026-08-10-t5-credit-scan-gap-design.md) |
| **T7** | 不做 | API 改名 `control_*` | P3 |
| **T9** | 部分 | 产品 `steps/replay` 常态验收 | 运维 |
| **T1r** | 残余 | tree / replay label 兜底 | 可穿插 |
| **T3r** | 残余 | T3 活录 CDP 对拍 | P2 |

---

## 易误判

| 误判 | 实际 |
|------|------|
| 「要先做全 DOM」 | 定稿为 **α 业务控件**；裸 DOM 非目标 |
| 「清单会自动填表」 | **禁止**；与三大问题①解耦 |
| 「壳层不进清单」仍有效 | **2026-08-10 已改**：顶栏/侧栏进清单 |
| 「element 双写还在」 | **T3 已修** |
| 「L1 预览 = 勾选控件给 LLM 填」 | **否**：仅歧义时给人看区域标签 |
| 「L1c / page-state 已合入」 | **代码+表征已绿，工作树未聚焦 commit** |
| 「旧 section = 新 region」 | **否**：产品面已改 `region=`；D3 `sectionAnchor*` 仍是 xpath 锚实现 |
| 「末步 empty-act 可点保存」 | **否**：browser-use 末步 Done-only；靠引入后 `_submit_ready` + 倒二步 urgency |

---

## 推荐下一刀

> **以 [`todo-list.md`](todo-list.md) 为准**（2026-08-12 已转入）。摘要：  
> 1. 湿测：L1-picker / AG-fullpage / L1c(+scan-py) / page-state / **session-lifecycle**  
> 2. 聚焦 commit：`session-lifecycle` · `option_text=first`  
> 3. （可选）`sectionOf` 死调用清理；穿插 T1r / 三大问题① / T5 / T4-P4 / L1-vision / form-actions-split  
> ~~agent-final-save~~ PASS · ~~legacy-section 分刀 commit~~ Done

> 参照：Cursor browser MCP / Playwright MCP（先控件池，后区域标签）。T4-P4 = 对照，非主路径。

## 文档交叉

| 文档 | 启示 |
|------|------|
| `AI记忆系统初始化进度.md` | Fact Pack / 命名另排；勿拖慢主录制 |
| `AI录制三大问题分析.md` | 摘要化、禁清单 auto-fill；入库/toast 正交另排 |
| `JS-gen学习Codex与PlaywrightMCP集成计划.md` | a11y = P4 对照，非 P0 主路径 |
| `JS-gen灰度测试开发计划.md` | 只新增、可开关 |

## 分支

- `V2.1_dev`。聚焦提交已落；残留 WIP：`select.js` / `select_option.py` / `phase/prompts.py` / `_tmp_*` 探针（勿混入上表功能）。
