# Backlog: 可见可编辑控件 / Agent 视野（核实版 2026-08-09）

> 本文件记录「目标线」待办。**状态以代码/表征为准**，不以计划 checkbox 为准。

## 目标定稿（2026-08-09）

> AI 拥有**当前业务表面上所有可见、已分类、可编辑控件**的确定性清单，并由**主 Agent**决定操作。  
> **不是**裸全 DOM；**不是**清单触发 auto-fill；**壳层导航不进清单**。

| 锁定项 | 选择 |
|--------|------|
| 「全 DOM」语义 | **α** 业务控件全集（Source A/B/C + 后续扩展） |
| 可操作边界 | 仅已分类：input / select / date / radio / checkbox / button / tree |
| 壳层 | 不进清单（侧栏/顶栏导航另做） |
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

---

## T4 分期（当前主线）

| 阶段 | 状态 | 交付 | 规格/计划 |
|------|------|------|-----------|
| **T4-P0** | **已实施** | `scan_editable_summary`：只读摘要；`buttons[{text,section}]`；不写 store；不 auto-fill；单根扫描（`JS_GET_CONTAINER`） | [spec](specs/2026-08-09-scan-editable-summary-design.md) · [plan](plans/2026-08-09-scan-editable-summary.md) · commit `0b1105e` |
| **T4-P1** | **已实施** | 多 overlay 根合并去重；主内容去壳（`JS_SCAN_FORM_FIELDS mode:'multi'`）；`scan_editable_summary` 接线 | [plan](plans/2026-08-09-scan-editable-summary-p1-multiroot.md) · commits `d1696f2`… |
| **T4-P2** | **已实施** | 摘要旁路 → memory（`form_state` + `form_inventory` 聚合 facts；helper `inventory_emit.py`） | [spec](specs/2026-08-09-inventory-memory-factpack-design.md) · [plan](plans/2026-08-09-inventory-memory-factpack.md) |
| **T4-P3** | **已实施**（T6+T8） | Source B 空行首命名 + CTRL `selectOption` 懒加载 | [spec](specs/2026-08-09-t4-p3-t6-t8-design.md) · [plan](plans/2026-08-09-t4-p3-t6-t8.md) |
| **T4-P4** | 未做 | Playwright MCP a11y **对照/诊断**（灰度，不替换 Element 主路径） | MCP/灰度计划 |

---

## 其它未闭环

| ID | 状态 | 项 | 建议优先级 |
|----|------|----|------------|
| **T5** | 未做 | 非 `el-table` 自定义网格 | 需产品确认；T4-P3 后 |
| **T6** | **已实施** | Source B 空行首表格行命名 | — |
| **T7** | 不做 | API 改名 `control_*` | P3 |
| **T8** | **已实施** | CTRL `selectOption` 懒加载对齐 | — |
| **T9** | 部分 | 产品 `steps/replay` 常态验收 | 运维 |
| **T10** | 未做 | `save_form_snapshot` 回放 / form-structure checkpoint 修复 | **T4 收口后回访** |
| **T1r** | 残余 | tree / replay label 兜底 | T4-P3 后 |
| **T3r** | 残余 | T3 活录 CDP 对拍 | P2 |

---

## 易误判

| 误判 | 实际 |
|------|------|
| 「要先做全 DOM」 | 定稿为 **α 业务控件**；裸 DOM 非目标 |
| 「清单会自动填表」 | **禁止**；与三大问题①解耦 |
| 「表格还不能操作」 | 扫描+xpath 写+回放+T3 已通；缺的是 **Agent 只读摘要工具**（T4-P0） |
| 「element 双写还在」 | **T3 已修** |

---

## 推荐下一刀

1. **T10** — `save_form_snapshot` 回放 / form-structure checkpoint 修复  
2. 其后：**T5** 非 `el-table` 自定义网格，或 **T1r** tree / replay label 兜底  
3. 或三大问题①已填跳过（质量，非视野）

## 文档交叉

| 文档 | 启示 |
|------|------|
| `AI记忆系统初始化进度.md` | P2 再接 Fact Pack；勿拖慢主录制 |
| `AI录制三大问题分析.md` | 摘要化、禁清单 auto-fill；入库/toast 正交另排 |
| `JS-gen学习Codex与PlaywrightMCP集成计划.md` | a11y = P4 对照，非 P0 主路径 |
| `JS-gen灰度测试开发计划.md` | 只新增、可开关 |

## 分支

- 保持 `V2.1_dev`；T3 已在长支；继续其上实施 T4-P0。
