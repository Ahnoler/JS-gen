# Backlog: 可见可编辑控件 / Agent 视野（核实版 2026-08-10）

> 本文件记录「目标线」待办。**状态以代码/表征为准**，不以计划 checkbox 为准。  
> 下一刀：执行机空闲后再做 **L1-picker / AG-fullpage BiB/UI 湿测**（按需）。并行可选 **page-state-gen** / **L1c-LLM** 规格。  
> 2026-08-10 已修：弹窗 TaskList 重建用 `multi`（勿 fullpage 混入列表/树过滤）+ `mark_done` 同 label 全清；collision titlebox 细化 + 保存保留 `xpath_smart`。

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

## 核实方法

- 表征：`characterize-form-scan-control-first` / `characterize-control-ops-closed-loop` / `characterize-xpath-primary-ops` / `characterize-capture-element-xpath` → 均 OK  
- 代码：`scripts/controller/actions/*` / `js_snippets/` / `_replay.py` / `src/ctrl-actions.js`  
- 规格：活 = **`2026-08-09-scan-editable-summary-*`**；已落地见 [`archive/`](archive/README.md)（form-scan / control-ops / xpath-primary / params-replay / capture）

---

## 已实施（勿再当未做）

| ID | 项 | 证据 |
|----|----|------|
| **D1 / T-scan** | Source B `el-table` 扫描 + `xpath_smart` | `SCAN_SOURCE_B_EL_TABLE`；表征 OK |
| **D2 / T1+T2** | xpath-primary Phase A+B 主路径 | `_resolve_control`；fill/select/date/radio + round xpath-only |
| **D3** | control-ops 分块 + buttons + `click_save(section)` | `sectionOf` / `SCAN_SOURCE_C_BUTTONS` |
| **D4** | date/radio/checkbox xpath helpers | `JS_FILL_DATE_BY_XPATH` / `JS_CLICK_RADIO_BY_XPATH` |
| **D5** | Phase Intent `all_editable` | `_phase_intent` / `_phase_context` |
| **D6** | 回放 params-first fill/select + 回读 | `_resolve_replay_xpath`；湿跑 25/25 |
| **D7（产品侧）** | `JS_SELECT_OPTION` 懒加载滚底 | `SELECT_LAZY_LOAD_ON_MISS` |
| **T3** | 录制 `element ≡ params` xpath | `JS_CAPTURE_FROM_XPATH`；commits `a35d7d1`…`ffac550`；[archive spec](archive/specs/2026-08-08-capture-element-from-xpath-design.md) |
| **T6** | Source B 空行首表格行命名 `row#N` | `SOURCE_B_EMPTY_LEADING` / `SOURCE_B_ROW_INDEX_XPATH`；[plan](plans/2026-08-09-t4-p3-t6-t8.md) |
| **T8** | CTRL `selectOption` 懒加载对齐 Agent | `SELECT_LAZY_LOAD_ON_MISS` in `src/ctrl-actions/select.js`；[plan](plans/2026-08-09-t4-p3-t6-t8.md) |
| **T10-P0** | unsafe checkpoint `confirmed=0` 但不 abort 批次 | `form-structure-heal.js` / `replay-batch-runner.js`；[spec](specs/2026-08-09-save-form-snapshot-replay-design.md) · [plan](plans/2026-08-09-save-form-snapshot-replay-p0.md) · commit `6b0bf7f` |
| **T10-P1** | verify Source A+B（`JS_VERIFY_FORM_STRUCTURE` / CTRL `verifyFormStructure`） | `misc.py` / `structure.js` `VERIFY_SOURCE_B_EL_TABLE`；[spec](specs/2026-08-09-save-form-snapshot-replay-design.md) · [plan](plans/2026-08-09-save-form-snapshot-replay-p1.md) · commits `db38d9a`…`2337537` |
| **FP-P0** | 全页 L2 + 规则 L1 + `mode:'fullpage'` → summary | [spec](specs/2026-08-10-fullpage-visible-controls-scan-design.md) · [plan](plans/2026-08-10-fullpage-visible-controls-scan-p0.md) |
| **FP-P1** | Source A/B/C rebase → fullpage；壳层不进 fillable | [plan](plans/2026-08-10-fullpage-visible-controls-scan-p1.md) |
| **FP-P2** | icon / chrome 菜单硬剔除降噪 | [spec](specs/2026-08-10-fullpage-p2-icon-chrome-noise-design.md) · [plan](plans/2026-08-10-fullpage-p2-icon-chrome-noise.md) |
| **dual-save** | 双「保存」section-anchored xpath + sticky 门禁 | [spec](specs/2026-08-10-dual-save-section-xpath-design.md)；湿跑 PASS |
| **wizard-next** | 「下一步/上一步」page-state 相对 xpath（防 coalesce） | [spec](specs/2026-08-10-wizard-next-page-state-xpath-design.md)；湿跑 PASS；commits `4ff7233`…`99b2946` |
| **dialog-TL** | 弹窗 `_rebuild_task_list` → `tasklist_scan_mode`=`multi`；滤树过滤/行内 radio；`mark_done` 同 label 全清 | `characterize-dialog-tasklist-scope` OK；9242 湿跑 fullpage fillable=8(含列表双份) → multi=6 干净 |

---

## T4 分期（当前主线）

| 阶段 | 状态 | 交付 | 规格/计划 |
|------|------|------|-----------|
| **T4-P0** | **已实施** | `scan_editable_summary`：只读摘要；`buttons[{text,section}]`；不写 store；不 auto-fill；单根扫描（`JS_GET_CONTAINER`） | [spec](specs/2026-08-09-scan-editable-summary-design.md) · [plan](plans/2026-08-09-scan-editable-summary.md) · commit `0b1105e` |
| **T4-P1** | **已实施** | 多 overlay 根合并去重；主内容去壳（`JS_SCAN_FORM_FIELDS mode:'multi'`）；`scan_editable_summary` 接线 | [plan](plans/2026-08-09-scan-editable-summary-p1-multiroot.md) · commits `d1696f2`… |
| **T4-P2** | **已实施** | 摘要旁路 → memory（`form_state` + `form_inventory` 聚合 facts；helper `inventory_emit.py`） | [spec](specs/2026-08-09-inventory-memory-factpack-design.md) · [plan](plans/2026-08-09-inventory-memory-factpack.md) |
| **T4-P3** | **已实施**（T6+T8） | Source B 空行首命名 + CTRL `selectOption` 懒加载 | [spec](specs/2026-08-09-t4-p3-t6-t8-design.md) · [plan](plans/2026-08-09-t4-p3-t6-t8.md) |
| **T4-P4** | 未做 | Playwright MCP a11y **对照/诊断**（灰度，不替换 Element 主路径） | MCP/灰度计划 · 见下方「动态 L1 / 诊断」 |

---

## 其它未闭环

| ID | 状态 | 项 | 建议优先级 |
|----|------|----|------------|
| **L1-picker** | **代码已实施；湿测挂起** | 歧义 `resolve-element`：L1 `region_*` 预览 + Vue 选择器；表征 PASS；CDP 对拍过顶栏/主区。**BiB 重载 + 多「新增」UI 冒烟**等执行机空闲 | 挂起 · [spec](specs/2026-08-10-resolve-ambiguous-section-preview-design.md) · [plan](plans/2026-08-10-resolve-ambiguous-l1-region-preview.md) |
| **L1-titlebox** | **代码已实施**（`b207372`） | 同 needle 同粗 L1 碰撞 → titlebox 细化 `region_*` + 锚定 xpath；算法 B | [spec](specs/2026-08-10-resolve-collision-finer-l1-titlebox-design.md) · [TODO 后续 AG](todos/2026-08-10-auto-grab-fullpage-same-name.md) |
| **AG-fullpage** | **代码已实施；湿测按需** | **自动抓取** fullpage inventory：`mode=inventory` + 可选 `actionType`/`labelText` 过滤；无 label 必弹选择器；选中后 infer `actionType`；同名 L1/titlebox + `xpath_smart`。表征 inventory + titlebox PASS；**BiB 重载 + UI 冒烟**按需 | [spec](specs/2026-08-10-auto-grab-fullpage-inventory-design.md) · [plan](plans/2026-08-10-auto-grab-fullpage-inventory.md) |
| **L1c-LLM** | **规格 Draft** | 动态 L1：低置信度 / other·custom **feature card → 控制面 LLM**；同步 + **L1d** 同刀；scan + resolve 共用 `classifyRegions` | P1 · [spec](specs/2026-08-10-l1c-llm-region-classify-design.md) · [fullpage §Dynamic L1](specs/2026-08-10-fullpage-visible-controls-scan-design.md) |
| **L1d-cache** | **含于 L1c 同刀** | `systemId` + 特征签名 → `region_role` | 见 L1c spec |
| **L1-vision** | 未做 | Vision：仅对争议容器裁图辅助定角色 | P2+ |
| **T4-P4** | 未做 | Playwright MCP a11y ⟷ 我方 L2 **对拍诊断**（灰度） | 可与 L1c 并行；非写路径 |
| **T5** | 未做（本页漏扫后暂缓） | 非 `el-table` 自定义网格 | 对公评级页无 vxe/ag → [gap spec](specs/2026-08-10-t5-credit-scan-gap-design.md)；需另页证据 |
| **T6** | **已实施** | Source B 空行首表格行命名 | — |
| **T7** | 不做 | API 改名 `control_*` | P3 |
| **T8** | **已实施** | CTRL `selectOption` 懒加载对齐 | — |
| **T9** | 部分 | 产品 `steps/replay` 常态验收 | 运维 |
| **T10** | **P0+P1 已实施** | `save_form_snapshot` 回放；P0=soft-fail continue；P1=verify Source A+B | [spec](specs/2026-08-09-save-form-snapshot-replay-design.md) |
| **T1r** | 残余 | tree / replay label 兜底 | 可穿插 |
| **T3r** | 残余 | T3 活录 CDP 对拍 | P2 |
| **page-state-gen** | 推迟 | 凡「相对 xpath 同、页态不同」的可点击都锚（不止下一步/上一步） | wizard [spec §4](specs/2026-08-10-wizard-next-page-state-xpath-design.md) |
| **P2-noise+** | **已实施** | 黑名单「标签」对齐「页签」（关所有标签含固定） | [spec](specs/2026-08-10-fullpage-p2-icon-chrome-noise-design.md)；表征 `characterize-scan-fullpage-p2` |

---

## 易误判

| 误判 | 实际 |
|------|------|
| 「要先做全 DOM」 | 定稿为 **α 业务控件**；裸 DOM 非目标 |
| 「清单会自动填表」 | **禁止**；与三大问题①解耦 |
| 「壳层不进清单」仍有效 | **2026-08-10 已改**：顶栏/侧栏进清单；见 fullpage scan design |
| 「element 双写还在」 | **T3 已修** |
| 「L1 预览 = 勾选控件给 LLM 填」 | **否**：仅 `resolve-element` 多匹配时给人看区域标签消歧 |

---

## 推荐下一刀（2026-08-10 修订）

1. ~~全页两层扫描 P0 / P1 / P2~~ — **已实施 + 湿跑**  
2. ~~双保存 section-xpath / wizard 下一步 page-state xpath~~ — **已实施 + 湿跑**  
3. ~~**L1-picker** / **L1-titlebox** 代码~~ — **已实施**；**湿测挂起**（等 BiB 可重载）  
4. **执行机空闲时：** L1-picker BiB 重载 + 多「新增」UI 冒烟  
5. ~~**AG-fullpage** — 自动抓取 fullpage inventory + infer actionType~~ — **代码已实施**；湿测按需（[spec](specs/2026-08-10-auto-grab-fullpage-inventory-design.md)）  
6. **不依赖执行机时可并行：** ~~**P2-noise+**~~（已实施）· **page-state-gen** 规格 · **L1c-LLM** 规格；随后 L1d / Vision；**T4-P4** 对照  
7. 穿插：T1r；三大问题①；T5（另页证据）

> 参照：Cursor browser MCP / Playwright MCP（先控件池，后区域标签）。T4-P4 = 对照，非主路径。

## 文档交叉

| 文档 | 启示 |
|------|------|
| `AI记忆系统初始化进度.md` | Fact Pack / 命名另排；勿拖慢主录制 |
| `AI录制三大问题分析.md` | 摘要化、禁清单 auto-fill；入库/toast 正交另排 |
| `JS-gen学习Codex与PlaywrightMCP集成计划.md` | a11y = P4 对照，非 P0 主路径 |
| `JS-gen灰度测试开发计划.md` | 只新增、可开关 |

## 分支

- 保持 `V2.1_dev`；L1-picker 代码已合入本支；湿测与可选小刀并行。
