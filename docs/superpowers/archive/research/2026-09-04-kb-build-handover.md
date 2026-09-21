# 信贷知识库（KB）搭建交接文档

> 写于 2026-09-04，供新开会话（产品管理知识库完善线）快速了解既有 KB 体系。
> 本文档只做事实交接，不动任何代码/数据；工作区另有并行会话的未提交改动，**勿触碰勿混 commit**。

## 1. KB 是什么、给谁用

信贷被测系统（test.creditv5p2）业务流程知识库，供 Python 引擎 Agent（`scripts/`）在录制/回放/自主跑链时**召回业务知识**（码值、页面形态、校验陷阱、操作配方），把"LLM 试错"变成"查卡照做"。已实证增益：用信申请启用 KB 召回后 err 3→0、步数 9→6、耗时 -17%（KB-4 A/B 对照）。

## 2. 体系架构（五层）

| 层 | 位置 | 说明 |
|---|---|---|
| 流程卡 | `data/kb/flows/*.json` | **当前 24 张**（每卡 = 一个业务流程，含 rules/evidence） |
| 码表字典 | `data/kb/dicts_normalized.json` + `dict_alias.json` | 源头是 localStorage `vue_Tansun_dict` 单 key（1333 字典类型金矿） |
| staging | `data/kb/staging/staged_flows.jsonl` | 湿测发现的候选知识先进 staging |
| 晋升工具 | `scripts/kb/promote.py`（`--apply`） | staging → 正式卡；pin：`characterize-kb-promote.py` |
| 召回动作 | `scripts/controller/actions/_kb.py` + `_todo.py` | `kb_flow` / `kb_dict` / `kb_rule` 动作 + 待办卡解析器 |
| 注入层 | agent prompt 注入（KB-I） | 真机验证 score=100，use_special_element 5/5 |

## 3. 已完成里程碑（时间序）

- **五层架构 + 6 个 kb_* 召回动作 + 20 张流程卡**（SDD 全落地，含授信向导全链卡：双重硬前置=生效评级+无在途申请）。
- **KB-4 湿测全绿 + A/B 实证增益**（见上）。
- **K6 扩卡**：合同/押品/催收三模块。
- **链 A（授信→用信）实机贯通**：冻结额度申请链**纯引擎 100% 自主闭环**（292s，EDDJ20260902024034，KB-I5 湿测七轮）；用信链 5 笔提交进审批（012/013/019/020/029，多实例批复 DGYXPF 前缀生效）。
- **放款链首通**：真实建档 FK20260904056009（卡点=放款账户表 0 行，业务合理锁定）。
- **KB 扩卡 20→24 张**（3f16901 已推送）：approval_chain / guarantee_intro / loan_account / rating_flow。
- **引擎动作谱系沉淀**（`scripts/controller/actions/`）：树三兄弟（select_tree_option/tree_picker_click/tree_check_confirm）、real_click（CDP trusted 事件）、close_visible_dialog/strip_stale_dialogs、三杠杆（read_xhr_log / save_section / set_vue_model，`bc336e5`）、fill_table_cell（表头定列序第 5 参）、read_error_notify、introduce_guarantor。

## 4. 关键方法论（新线直接复用）

1. **卡片级知识 = 湿测发现 → staging → promote → pin 验证**；回灌用真实请求体/落库核对做 evidence。
2. **对比实验定根因**：过闸单 vs 被拒单字段级 diff（范例 `tmp/e2e/cmp_guarantee.md`）。
3. **落库铁证标准**：真点击 + model 回读 + 分区保存 + reload 后状态仍在 + 请求体核对。
4. **码值真相**优先查 `vue_Tansun_dict`（如 抵押1/质押2/保证3/信用4）。
5. 引擎 vs 知识分工：**LLM 想 / 引擎做**；高频多步易错页面形态 → 专用动作一次注入。

## 5. 遗留待办（信贷线，与产品线不冲突）

1. **引擎 100% 自主闭环最后一拍**：r13 已实证的担保修复序列（set_vue_model+分区保存+reload 验证+意见页显式点选+real_click 流程提交）编码进驱动/prompt，零新代码。
2. **run21 定案卡点**：引入保证人弹窗「确认」静默失败（需原生 mousedown 链或逐格 blur 提交行编辑）+ click_table_row_radio 无序号语义（文本包含误命中首行）。
3. **A7 上传签署影像**（wf_ctrcontsign_com 3 步向导）：需专门录制文件上交流程 → ctrSt 3→6 →放款→借据→贷后。
4. KB-I5 五缺口（2026-08-31 research §12）：抽屉作用域按钮遮蔽、向导抽屉误判、picker 回填空、watcher intent 门、孤儿 Chrome 复用登录必败。
5. `list_todo_cards()`/`wf_submit_guard()` 未实机湿验（提示词标"接线中，scan 兜底"）。
6. `characterize-kb-actions.py` 在 HEAD 存量失败（断言与卡内容未对齐：撤销 vs 流程取回）。
7. run12 起 YXPC 编号捕获回归（7 跑空）待查；分页下拉 5s 预算约 11 页。

## 6. 新线（产品管理知识库）注意事项

- **目录约定**：产品线知识建议另立 `data/kb/flows/` 同构卡片或独立子目录（避免与信贷卡混写）；召回动作 `_kb.py` 若需扩展须先读既有 kb_* 动作的注入契约。
- **共享文件**（禁并行写）：`data/kb/staging/staged_flows.jsonl`、`_kb.py`、`scripts/kb/promote.py`、prompts。如需改动，先在 agent-log 声明。
- **环境坑**：本机裸 `python` 是 WindowsApps 桩（exit 49），用 `D:/anaconda3/python.exe` 或 `./python/python.exe`；改 js_snippets 须重启 executor 才生效。
- **双开纪律**：工作区现有未提交改动（error_notify/guarantee_intro_snippet/table_cell/replay_timing 等）属信贷线并行会话，勿触碰；收工在 `docs/superpowers/agent-log.md` 顶部写条目。
- **卡片 menu_path 书写规范（2026-09-05 KB Insights 实施后新增）**：一律用 `/` 分隔的段路径（段名与系统树节点名一致，建议不含系统层以外的自由后缀）；**不要用 `→` 分隔或括号自由文本**——Node 侧新增的只读分析面（`GET /api/v2/kb/stale-cards`，见 `src/services/menu-path-matcher.js`）按 `/` 段解析到系统树，`→` 或含括号的写法会被判 `unparsed`（不算失效但失去漂移检测能力）。括号补充说明可放卡片其他字段。另有可反查溯源字段 `source_refs`（`{trajectory_ids,tx_nos,dates}`，可选）——新卡/改卡建议顺手带上，详见 `docs/superpowers/specs/2026-09-05-kb-insights-design.md` §2。

## 7. 延伸阅读

- 锚点：`tmp/e2e/chain_a_anchor.md`
- E2E 报告：`docs/superpowers/research/2026-09-01-e2e-chain-a.md`
- 全链卡计划：`docs/superpowers/research/2026-09-01-full-flow-cards-plan.md`
- 回放管线交接：`docs/superpowers/research/2026-09-01-replay-pipeline-handover.md`
- agent-log 与 todo-list：`docs/superpowers/agent-log.md` / `docs/superpowers/todo-list.md`
