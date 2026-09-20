# JS-gen actions 层改动 → 同事引擎同步清单与移植记录（2026-09-16）

- 执行：ZCode 引擎线（lead + 4 子智能体：R1 挖 log / R2 引擎盘点 / C 实现 / D 本地 pin）
- 结论：**移植 2 项已提交**——tansun_ui_engine `TUE_1.0.1_LMY` commit **`24a1669`**（5 文件 +87/−55，未 push）；其余裁定见下表
- 状态：**收工条目待补 agent-log**（该文件正被 Cursor 线合并 PR #45，冲突态不触碰；本文件为持久替代，合并落地后由任一会话补一行指针）

## 一、同步清单（R1 挖出 24 条 actions 层改动 × R2 引擎现状交叉裁定）

### ✅ 已同步（本批之前，含引擎 commit）
| JS-gen 改动 | 引擎落点 |
|---|---|
| close_dialog 带空格按钮（b4b832e0） | `873d534` |
| date closePickerVm 状态级收盘（b9694d1b） | `013a67d` |
| 树选叶模式三级（6fd303a9/5e6d51fc/c60309e4） | `1cd1533` |
| 菜单按名/路由稳住/data-url 直达 + 导航门闩 + date 三闸门 | `f4c1345` |
| 树节点动态计数点击（上游 a6617f6） | `0db22e0` 合并收入 |
| 图标歧义守卫 | `41992f0`（引擎侧自研，JS-gen 无对应改动） |

### ✅ 本批移植（`24a1669`，见下「二」）
| 项 | 源 commit | 引擎落点 |
|---|---|---|
| 字段 label 匹配收敛（norm + exact-first 候选序） | `13cc5404` | `JS_FIELD_LABEL_NORM`/`JS_FIELD_ITEM_CANDIDATES` 家在 select_tree.py；select_tree×2 / radio label 模式 / 邻钮 = candidates 级；select_click / replay_adapter（快照驱动）= norm 级（与源 commit 未触碰 replay_js 同口径） |
| 树节点文本清洗（剥 (N) 计数与尾连字符，保留 [V-…]） | `7c13b820` | stripTreeVolatile 双侧应用于 JS_TREE_SEARCH_MATCHES / JS_TREE_CHECK_CONFIRM / JS_TREE_PICKER_CLICK / JS_TREE_POPOVER_OPEN / JS_TREE_DFS_PATH |

### ❌ 裁定不同步（录制/阶段侧，引擎不适用）
- `953c4be4`（select_trigger_click / mark_query_clicked / already-operated）——JS-gen 录制动作 click_element_by_index 语义；引擎无此动作
- `63209340`（already-filled 同值重填守卫）——录制态去重，回放引擎不适用
- `022f65a2` ①②（query 归类 / already-operated-this-phase）——阶段门禁；③日期范围契约引擎已有（date_action daterange 双 input+数组 emit，湿测 20 项已验）
- `3c1fc8ff`（autofill_round unwrap）/`711f9065`（clear_phase_section）/`b00ec873`（pending_refresh）/`23f58d0d`（按钮 identity 去重）/`c820ac76`（STC 回放标记）——JS-gen autofill/phase 机制专属
- `48c99419`/`96869ade`（JS_VERIFY_FORM_STRUCTURE 两修）——引擎无该检查点动作（Type B 回放概念）
- `67cb3286`（normalizeHost popper 重映射）——**引擎不持有 PAGE_LOCATOR_HELPERS 生成链**（已 grep 证实），录制侧修复，引擎自动受益
- `7f49d186`（rect_norm 直通）/picker 原子步骤落库/mapper 表格选行/read_business_date/done_rejected/err_with——录制采集/落库/编排侧
- `3763893d`（picker_closed 证据）/`b72e1150`（JS_FIELD_ITEM_PICK kind 探针）——kind 探针属 JS-gen fill/select 引擎录制态；引擎若日后做同型探针再议（13cc5404 的 norm+candidates 已覆盖其字面匹配收益）

### ⚠️ 对齐确认项（移交同事，不改码）
- select:click 主路径无 tssc 远程表格形态（回放路径有）——湿测 14/15 曾过，建议同事确认主路径是否需要补
- radio label-miss 记 absent-skip 当成功（radio.py:194-195）——疑似假成功，与「宁明确失败」原则相悖；JS-gen 对应语义待对齐后定
- replay_click 的 xpathSmart 参数与 xpath 同值（replay_adapter:401），smart 独立语义未实现

## 二、本批移植明细（`24a1669`）

- 5 文件：select_tree.py（+102/−26 附近：3 共享常量 + 2 自身接线 + 5 点树清洗）、replay_adapter.py（norm 接线）、select_click.py（两处 norm 接线）、radio.py（label 模式 candidates 化，pick() 未动）、click_subroutes.py（邻钮 candidates 化，关键词按钮优先保留）
- 刻意不动（对齐 13cc5404 源仓清单）：选项/按钮/菜单/单元格文本匹配、radio pick()、占位符、click.py 的 JS_FIND_TREE_NODE_BY_LABEL
- Lead 裁决一处：select_click/replay_adapter 为快照驱动定位，candidates 枚举模型不适用 → 接 norm 级（本地 pin 已按模块分级断言）
- 验证：imports OK（-W error::SyntaxWarning 零警告）、ruff 全过、14 个改动 JS 常量 node --check 全过、本地测试 **51 passed**（含 13 条新 pin；测试件按约定不入库）
