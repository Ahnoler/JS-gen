# 客户信息查询 KB 贯通（档位 B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 独立 KB 卡「客户信息查询」可召回 + 本产品新建交易挂 `functionId=9000000039` 浅录证：列表查询可见 stamp `KB测客户-20260905-1315`。

**Architecture:** 对标 `product_query.json` 与档位 A 贯通路径：锚点快照 → 新建 `customer_query.json` → 任务文案 → analyze/create → prepare/record → source 回填。与 `customer_onboarding`（fid=7）分离，避免抢召。

**Tech Stack:** `data/kb/flows/customer_query.json`；`POST /api/v2/trajectories/analyze` + CRUD + `record/prepare|start`；`scripts/kb/recall.py` 召回抽查；可选 CDP `127.0.0.1:19242+slot`；Python `D:/anaconda3/python.exe`。

## Global Constraints

- 挂载 **functionId=9000000039**（客户信息查询；`RES28003` / `ZJJK00104552`）。勿挂 `7`、勿挂 `9000000283`（查询对公客户分配）。
- 成功判据=列表可见 stamp **`KB测客户-20260905-1315`**（复用档位 A；cstNo 参考 `26090513160716537`）。
- OCR / 影像 / 新增建档禁入；不做详情/360/导出深录。
- 勿改 `_kb.py` / promote / prompts（除非召回强制且 agent-log 声明）。
- 勿碰用信/授信/产品/推流 WIP；`config/.env*`；他线 docs 三文件删除。
- 证据目录：`tmp/customer-mgmt/query/`（gitignore）。
- 设计：`docs/superpowers/specs/2026-09-05-customer-query-kb-design.md`（`91d4f86`）。

---

## File map

| Path | Role |
|------|------|
| `tmp/customer-mgmt/query/function-anchors.md` | 锚点快照（fid=9000000039） |
| `data/kb/flows/customer_query.json` | 新卡（主交付） |
| `tmp/customer-mgmt/query/task-requirement.md` | 任务文案 |
| `tmp/customer-mgmt/query/through-report.md` | 贯通报告 |
| `docs/superpowers/agent-log.md` / `todo-list.md` | 开工已有；收工更新 |
| `docs/superpowers/plans/2026-09-05-customer-query-kb.md` | 本计划（勾选） |

---

### Task 1: 功能锚点快照

**Deliverable:** `tmp/customer-mgmt/query/function-anchors.md`

**Consumes:** 控制面 `http://localhost:4097`；process 4 functions API。  
**Produces:** 文件中写明 `functionId=9000000039`、`RES28003`、`ZJJK00104552`、`menuXpath`、勿挂列表。

- [x] **Step 1:** `GET /api/v2/processes/4/functions`，过滤 `id==9000000039`，确认 `intermediateFlag=0`、`name=客户信息查询`。
- [x] **Step 2:** 可选 `GET /api/v2/trajectories?functionId=9000000039` 摘要条数（只读）。
- [x] **Step 3:** 写入 `function-anchors.md`（表格：id / RES / pageId / xpath / 勿挂 7 与 9000000283）。

**Verify:** 文件含字面量 `9000000039`、`RES28003`、`ZJJK00104552`。

---

### Task 2: 新建 `customer_query.json` + 召回抽查

**Depends:** Task 1

**Deliverable:** `data/kb/flows/customer_query.json`

**Consumes:** Task 1 锚点；模板 `data/kb/flows/product_query.json` 结构。  
**Produces:** 可 parse 的流程卡；召回命中本卡 flow 名。

- [x] **Step 1:** 创建卡，建议字段（湿测前 hash 可用 pageId/RES；进页后补专有 hash 段）：

```json
{
  "flow": "客户信息查询",
  "aliases": ["查询客户信息", "客户查询", "cstInfQuery"],
  "menu_path": "客户管理→客户信息查询（functionId=9000000039；menu //li[@data-id='RES28003']；pageId=ZJJK00104552；勿挂对公建档 7 / 勿挂 9000000283）",
  "hash_markers": ["ZJJK00104552", "RES28003", "UML00091140"],
  "keywords": ["客户信息查询", "客户名称", "查询", "重置", "证件号码"],
  "preconditions": [
    "入口：客户管理→客户信息查询；挂 functionId=9000000039",
    "查询对象优先 stamp KB测客户-20260905-1315（档位 A 已建）",
    "OCR/影像/新增建档禁入；成功=列表 stamp 可见",
    "账号：systemAccountId=2"
  ],
  "nodes": [
    {"id": "qry_home", "page": "客户信息查询主页", "enter": "菜单进入", "buttons": ["查询", "重置"], "fields": ["客户名称"], "note": "筛选项以页面实标为准，湿测回写"},
    {"id": "qry_filter", "page": "条件查询", "enter": "填 stamp→查询", "note": "成功判据=列表命中 stamp"},
    {"id": "qry_hit", "page": "列表命中", "enter": "核对行含 stamp", "note": "不强制打开详情/360"}
  ],
  "field_deps": [],
  "state_actions": [],
  "rules": [
    {"keyword": "functionId", "rule": "挂 9000000039；禁止 7 / 9000000283"},
    {"keyword": "成功判据", "rule": "列表查询可见 KB测客户-20260905-1315 即成功"},
    {"keyword": "OCR", "rule": "OCR识别与影像入口一律禁入"},
    {"keyword": "召回区分", "rule": "勿因 cstMgt 公共前缀误召 customer_onboarding；优先 RES28003/ZJJK00104552"}
  ],
  "exceptions": [
    {"when": "stamp 客户不可见", "do": "报告阻塞；经 Lead 可改查 #515 stamp 或现场挑一行"},
    {"when": "AI 过早 phase_done", "do": "CDP 补查询；以列表 stamp 为准"}
  ],
  "source": "2026-09-05 档位 B 设计；湿测后回填 traj"
}
```

- [x] **Step 2:** 召回抽查（在仓库根）：

```bash
D:/anaconda3/python.exe -c "from scripts.kb.recall import find_flow_for_task; from scripts.kb import store as kb_store; flows=kb_store.load_flows(); hit,s=find_flow_for_task(flows,'客户信息查询 按客户名称查询 KB测客户-20260905-1315'); print(hit and hit.get('flow'), s); hit2,s2=find_flow_for_task(flows,'对公客户建档 新增客户', page_hash='#/cstMgt/csinfMnt/cpctMgt/cpctMgtPg'); print('onboarding?', hit2 and hit2.get('flow'), s2)"
```

Expected: 第一行 flow 含「客户信息查询」；第二行应为建档卡（或至少不是查询卡独占错误）。

- [x] **Step 3:** Commit 卡草稿（可与 Task 5 合并；若单独提交 message 含 `customer_query`）。

**Verify:** JSON parse OK；召回命中本卡。

---

### Task 3: 任务文案 + analyze + 建交易

**Depends:** Task 2

**Deliverable:** `tmp/customer-mgmt/query/task-requirement.md` + traj id 文件

**Stamp / 关键数据（固定）：**

- 客户名称：`KB测客户-20260905-1315`
- 参考 cstNo：`26090513160716537`
- USCC（仅核对用，本线不新建）：`91310115MA260915A1`

- [x] **Step 1:** 写 `task-requirement.md`，编号步骤示例：

```
【硬性成功门闩】列表查询可见「KB测客户-20260905-1315」前不得 done；禁止 OCR/影像/新增建档。
1、进入客户管理，点击「客户信息查询」，等待列表加载。
2、在查询条件「客户名称」（或以页面实标为准）填「KB测客户-20260905-1315」，点「查询」。
3、核对列表至少 1 行含该 stamp；本阶段不再改数据。
关键数据：客户名称=KB测客户-20260905-1315；stamp=20260905-1315
```

- [x] **Step 2:** `POST /api/v2/trajectories/analyze`，body 含 `functionId: 9000000039` 与 requirement 全文；审 phases（期望 ≥2：进页 / 查询核对）。
- [x] **Step 3:** `POST /api/v2/trajectories`：`name` 含 `KB贯通-客户信息查询-20260905`、`systemAccountId: 2`、`functionId: 9000000039`、requirement+phases；保存 `tmp/customer-mgmt/query/traj-id.txt`。

**Verify:** 交易 `draft`；`phaseCount≥1`；`task` 非空；fid=9000000039。

---

### Task 4: 贯通录制

**Depends:** Task 3

**Deliverable:** recorded（或明确失败根因）+ `tmp/customer-mgmt/query/through-report.md`

- [x] **Step 1:** 确认 LMY（或空闲 executor）online；`POST .../record/prepare`（timeout 宜 ≥600s）。
- [x] **Step 2:** `POST .../record/start`（可带全部 phaseIds）；监控；若假成功则 CDP：导航到查询页 → 填 stamp → 查询 → 写 `cdp-list-check.json`。
- [x] **Step 3:** 进页后把实标筛选项名与 URL hash 回写到 `customer_query.json` 的 `nodes`/`hash_markers`（最小补丁）。
- [x] **Step 4:** `POST .../detach`；写 through-report（traj id、fid、stamp、阶段表、列表 hit、CDP 路径）。

**Verify:** 列表可见 stamp **或** 报告写明阻塞与下一步（stamp 失踪时按 exceptions 升级 Lead）。

---

### Task 5: source 回填 + Lead 收工

**Depends:** Task 4

- [x] **Step 1:** `customer_query.json` `source` 挂湿测 traj id + stamp + 列表证据一句。
- [x] **Step 2:** `todo-list.md` ⑦：档位 B 标闭环（或写明剩余缺口）。
- [x] **Step 3:** `agent-log.md` 收工回链 18:08 开工；勾选本计划 checkbox。
- [x] **Step 4:** Commit（仅本线：卡 / 计划勾选 / todo / agent-log；勿带 `.env` / docs 三文件删除 / 他线 WIP）。

**Verify:** source 含 traj id；收工回链开工条目。

---

## Spec coverage (self-check)

| Spec 要求 | Task |
|-----------|------|
| 新卡 customer_query + fid 9000000039 | 2 |
| 浅成功 stamp 1315 | 3–4 |
| 召回不误召建档 | 2 Step 2 |
| analyze→录制→source | 3–5 |
| OCR/新增禁入 | 2 rules + 3 文案 |
| Out：详情/360/引擎门闩 | 未排任务（故意） |
