# Backlog: 可见可编辑控件 / Agent 视野（核实版 2026-08-08）

> 本文件记录「目标线」待办。**状态以代码/表征为准**，不以计划 checkbox 为准。

## 核实方法

- 表征：`characterize-form-scan-control-first` / `characterize-control-ops-closed-loop` / `characterize-xpath-primary-ops` → 均 OK  
- 代码：`_form.py` / `_helpers.py` / `_js_snippets.py` / `_replay.py` / `src/ctrl-actions.js`  
- 规格：`2026-08-07-form-scan-*` / `control-ops-*` / `xpath-primary-*` / `xpath-params-replay-*`

---

## 已实施（勿再当未做）

| ID | 项 | 证据 |
|----|----|------|
| **D1 / T-scan** | Source B `el-table` 扫描 + `xpath_smart` | `SCAN_SOURCE_B_EL_TABLE`；表征 OK；CHANGELOG 2026-08-07 |
| **D2 / T1+T2** | xpath-primary Phase A+B 主路径 | `_resolve_control`；fill/select/date/radio + `_execute_round` xpath-only；可选 `xpath_smart`；prompt；表征 OK；commits `0c6a099`…`306b4e7`/`233cd4c` |
| **D3** | control-ops 分块 + buttons + `click_save(section)` | `sectionOf` / `SCAN_SOURCE_C_BUTTONS`；表征 OK |
| **D4** | date/radio/checkbox xpath helpers | `JS_FILL_DATE_BY_XPATH` / `JS_CLICK_RADIO_BY_XPATH` |
| **D5** | Phase Intent `all_editable` | `_phase_intent` / `_phase_context` |
| **D6** | 回放 params-first fill/select + 回读 | `_resolve_replay_xpath`；湿跑 25/25；commits 本周 `088b338`…`d483fc2` |
| **D7（产品侧）** | `JS_SELECT_OPTION` 懒加载滚底 | `SELECT_LAZY_LOAD_ON_MISS` 已在 `_js_snippets.py` |

---

## 真正未实施 / 未闭环

| ID | 状态 | 项 | 为何算「未做」 | 建议优先级 |
|----|------|----|----------------|------------|
| **T3** | **未做** | 录制写路径统一 `element ≡ params` xpath | `_capture_element` 仍 `JS_SMART_LOCATOR(label)` 按 form-item 再生 xpath；params 写 scan xpath、element 常写死 form-item（双写根因仍在） | **P0** |
| **T4** | **未做** | 整页 Agent DOM 可见可编辑清单 | 无整页 inventory action；扫描仍限 `JS_GET_CONTAINER`；规格 Future TODO | **P1**（产品愿景） |
| **T5** | **未做** | 非 `el-table` 自定义网格扫描 | 规格明确 non-goal；代码无适配器 | P2（需产品确认再开） |
| **T6** | **未做** | 空行首表格行控件命名 | Source B：`if (!rowText) continue` 直接跳过无行首文案行 | P2 |
| **T7** | **未做（刻意）** | 对外 API 改名 `control_*` | 规格 non-goal；无改名 | P3 / 不做 |
| **T8** | **未做（CTRL 轨）** | `CTRL.selectOption` 懒加载对齐产品 JS | `src/ctrl-actions.js` `selectOption` 无滚底加载循环；产品 `JS_SELECT_OPTION` 已有 | P2（组装/CTRL 注入路径） |
| **T9** | **部分** | 产品 `steps/replay` 常态验收 | CDP 湿跑已通；产品 UI 验收属运维，非代码缺口 | 运维跟进 |
| **T1r** | **残余** | xpath-primary 边缘未硬切 | ① 登录硬编码 label fill（规格允许）② tree `no-tree-component` 仍可 `JS_FILL_FORM_FIELD` / `JS_FIND_LABELED_*` ③ `_replay` 无 xpath 时仍有 label 兜底 | P2（按需） |

---

## 易误判为「未做」实则已做

| 误判 | 实际 |
|------|------|
| 计划 md 里仍是 `- [ ]` | 勾选未更新；commits + 表征证明已做 |
| 「表格还不能操作」 | 扫描+助手+回放 params 已通；若失败多半是 **element 双写**（→ T3）或产品未走新回放 |
| 「select 懒加载没做」 | **产品 agent JS 已做**；缺的是 **CTRL 注入副本**（→ T8） |
| 「xpath-primary 没做」 | Phase A/B **已做**（→ 已实施表） |

---

## 推荐下一刀（核实后）

1. **T3** — 录制 `_capture_element` / persist 以已解析 `xpath_smart` 写入 element，禁止 label 盲生成覆盖表格 xpath（闭环本周回放根因）。  
2. **T4** — 整页 Agent DOM（需单独 brainstorm 拆切）。  
3. **T1r** — 收紧 tree 误分类 / replay label 兜底（小刀）。
