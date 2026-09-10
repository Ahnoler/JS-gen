# KB 覆盖回溯（Coverage Retrospective）— 设计

> 日期：2026-09-11 · 作者：DSH reviewer（Lead 委托）
> 上游：方向 5 收口（[`2026-09-11-direction5-r3-go-nogo.md`](../reports/2026-09-11-direction5-r3-go-nogo.md)，`d73c6c85`）· 裁定书 [`2026-09-10-colloquial-bridge-closeout-decisions.md`](2026-09-10-colloquial-bridge-closeout-decisions.md) §5
> **一句话：用已落库的 416 条真实录制，量出 84 张流程卡到底覆盖了多少真实业务、哪些卡是死的、卡与实跑差多少——**零风险只读**，并把它固化成可长期复跑的门禁。**

## 1. 目标与非目标

**目标（六项指标 + 缺口清单 + 门禁）**
1. **可连接率**：84 张卡里有多少能在生产数据里被"页面码/路由"定位（今天已知 37 张带 ZJJK、28 张带 FS 码、7 张带 wf 码、**11 张一个码都没有**）。
2. **覆盖率**：有 `page_id` 的已录制交易中，能映射到 ≥1 张卡的比例。
3. **利用率**：84 张卡中被真实录制命中过的比例（输出 **dead-card 清单**）。
4. **缺口**：未映射记录按页面族聚类 → **"真实业务有、KB 无卡"清单**（Top N，带计数）。
5. **节点一致性**：能映射的交易，其实跑访问序列 ↔ 卡 `nodes`：节点覆盖率 / 顺序一致率 / 卡外步骤率。
6. **新鲜度**：卡 `hash_markers` 是否仍存在于 `system_page`（688 行 / 381 个 `page_id`）→ **陈旧卡清单**。

**非目标（硬边界）**：不改产品代码；不跑浏览器/不碰 SUT；不动召回算法、阈值、评测集、`data/kb/req/**`；不写库（**只读**）；不与在途线（`flow-card-guided-propose`）争文件。

## 2. 已核实的可行性事实（reviewer 实测，2026-09-11）

| 事实 | 值 |
|---|---|
| `trajectory` | 416 行；`recorded` 311 / `completed` 34 / `draft` 55 / `failed` 16 |
| 带 `page_id`（ZJJK 码） | 370（`recorded` 304/311、`completed` 31/34）——**映射主键** |
| `page_id` Top | `ZJJK00066153`×21、`ZJJK00110131`×17、`ZJJK00095902`×7… |
| `trajectory_step` | **11,114** 行 / 392 条轨迹；`action_type` Top：click_button 2074、semantic_snapshot 1819、fill_form_field 1447、select_option 1152、**click_menu_item 1024** |
| `element_json` 结构键 | `xpath_smart`/`region_id`/`region_label`/**`page_level_key`**/`locator_scope`/`locator_strategy` → **可脱敏地还原"访问了哪些页面/区域"** |
| `system_page` | 688 行 / 381 个 `page_id`（`ZJJK…`）+ `page_name` + `res_path`（如 `/filesMgt/filesRet/…`） |
| 卡 `hash_markers` | 113 个 ZJJK / 34 个 FS / 10 个 wf / 175 个路由片段（`cltlMgt` 等） |
| 卡 `nodes` | **84/84 非空**（`{"id","page","enter","buttons",…}`）→ 节点一致性可算 |

**映射链路（三条，按优先级）**：① `trajectory.page_id` ↔ 卡 `hash_markers` 中的 ZJJK；② URL 里的 `fcnScnEcd=FS…` ↔ 卡 FS 码；③ `res_path` 片段/菜单名 ↔ 卡 `menu_path`。**每条都记命中来源**，便于复核与归因。

## 3. 数据与脱敏（硬约束）

**来源**：`js_gen` 只读快照（SSH 隧道 `127.0.0.1:13306`，见 R-3 报告 §1）。快照 → **冻结 fixture**（入 git，供离线复跑与门禁）。

**白名单（只允许这些键进 fixture）**
- 轨迹级：`id`、`function_id`、`record_status`、`is_successful`、`page_id`、`phase_count`、`step_count`、`created_date`（**截到日**）、`url_codes`（只保留 `fcnScnEcd`/`part` 等**码**，丢弃 query 业务值）
- 步骤级（**聚合后**，不存原始 11k 行）：每轨迹的 `visited_regions` = 去重、保序、截断的 `{page_level_key|region_label}` 序列 + 每类 `action_type` 计数
- 页面级：`page_id`、`page_name`、`res_path`

**禁止入库（门禁断言）**：`task`/`name`/`url` 的 query 业务值、`element_json.text`/`attributes`、`params_json.value`、`extracted_content`、`error`、`done_logs`、任何客户名/证件号。**门禁断言**：fixture 中出现白名单以外的键 = FAIL；出现长度 > 40 的自由文本 = FAIL。

## 4. 指标定义（v1，全部可离线复算）

| # | 指标 | 定义 | 记功口径 |
|---|---|---|---|
| M1 | `joinability` | 至少带 1 个可连接码（ZJJK/FS/路由片段）的卡 / 84 | 分母固定 84 |
| M2 | `coverage` | 映射到 ≥1 张卡的 `recorded`+`completed` 轨迹 / 有 `page_id` 的同类轨迹 | 只看 recorded+completed |
| M3 | `utilization` | 被 ≥1 条 `recorded`+`completed` 轨迹命中的卡 / 84 | dead-card = 未命中 |
| M4 | `uncovered` | 未映射轨迹按 `page_id`（缺则 `res_path` 家族）聚类，输出 Top20 + 计数 | 清单，不进 floor |
| M5 | `nodeCoverage` / `orderAgreement` / `offCardRate` | 映射轨迹的 `visited_regions` 序列 ↔ 卡 `nodes[].page`/`id`：覆盖率 = 命中节点/卡节点总数；顺序一致率 = LCS/序列长；卡外率 = 卡上找不到的访问占比 | **只在映射轨迹上算**，分母写进报告 |
| M6 | `freshness` | 卡 `hash_markers` 中仍存在于 `system_page` 的 ZJJK/FS 比例 | 输出陈旧清单 |

**反作弊/口径守则**：不按 `task` 文本匹配（那是 agent 口令体，见 R-3 报告 §2）；不为了让 M5 好看而改卡；`function_id` 不作为唯一映射依据（它是产品交易 id，不是卡）。

## 5. 交付物

| 交付 | 路径 | 说明 |
|---|---|---|
| 快照脚本 | `scripts/kb/coverage-snapshot.mjs` | DB 只读 → 脱敏聚合 → 写 fixture；带 provenance（时间/行数/内容哈希） |
| 冻结 fixture | `scripts/characterization/fixtures/kb-coverage.v1.json` | 目标体积 < 1 MB；`snapshotVersion/changeLog/capturedAt` |
| 度量引擎 | `scripts/kb/kb-coverage.mjs` | `--fixture`/`--json`/`--baseline`，输出 M1–M6 + 清单 |
| 门禁 | `scripts/characterization/characterize-kb-coverage.mjs` | 形状 + **脱敏断言** + floor + baseline lockstep |
| 基线报告 | `docs/superpowers/reports/2026-09-11-kb-coverage-retro.md` | M1–M6 基线 + Top20 缺口 + 陈旧卡 + 结论 |

## 6. 验收（DoD）

1. fixture 过脱敏断言（白名单外键 0、长自由文本 0），且体积 < 1 MB、可 `JSON.parse`；
2. 六项指标可从 fixture 独立复算，报告与引擎输出**逐位一致**；
3. 门禁绿（含 floor），并且**可证伪**：把任一 floor 抬高 0.2 → 必红；还原 → 绿；
4. 缺口清单每条可回溯到具体 `page_id` × 计数，陈旧卡清单每条可回溯到具体 marker；
5. 全仓无产品代码改动、无 `data/kb/req/**` 改动、评测集/阈值/`verify-all.sh` 零改动。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| DB 只有通过 SSH 隧道可达，实施方无口令 | Lead 转发口令或由 reviewer 代产 fixture（**fixture 是输入数据**，度量与门禁仍由实施方做）；两条路都不改变验收 |
| 脱敏漏项（业务名随 `text` 混入） | 白名单 + 门禁断言 + reviewer 抽检 10 条回原文比对 |
| 覆盖率天然偏低（只有部分卡带码） | **这本身就是结论**（M1 joinability），不设"必须高"的期望；floor 从实测基线起，只升不降 |
| 映射歧义（一条轨迹跨多张卡） | 多标签：全部命中都记，另记 `primaryCard`（入口 `page_id` 所属卡）；歧义率单独报 |
| 与在途 `flow-card-guided-propose` 线冲突 | 本线只新增文件（`scripts/kb/`、`scripts/characterization/`、报告），**不碰 `src/services/req-draft-traj/**`** |
