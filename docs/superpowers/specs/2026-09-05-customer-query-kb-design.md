# 客户信息查询 KB 贯通 — 设计（档位 B）

> 日期：2026-09-05  
> 状态：已选方案 **1**（独立新卡 + 贯通湿测）+ 成功档 **A**（浅：列表 stamp 命中）  
> Lead：本会话（Cursor）；前置档位 A：`customer_onboarding` / traj #515+#524  
> 用户确认：2026-09-05（选项 1→成功 A→查询对象复用 stamp→方案 1→§1–§3 允许落 spec）

## 1. 目标

在信贷 SUT（`test.creditv5p2`）**客户管理 → 客户信息查询**，沉淀可召回独立 KB 卡，并走本产品贯通路径：

**新卡 → 任务文案（复用建档 stamp）→ analyze → 新建交易 → prepare → record/start**。

成功终态（最小集）：

1. `data/kb/flows/customer_query.json` 可被 `kb_flow` 正确召回（菜单/hash 对齐 **客户信息查询**，不误召建档卡）。
2. 新建一条交易：`functionId=9000000039`，`task`/`requirement` 非空，phases 来自 analyze。
3. SUT 证据：查询列表可见 stamp **`KB测客户-20260905-1315`**（cstNo 参考 `26090513160716537`）。

## 2. 范围

### In

- 菜单：客户管理 → **客户信息查询**（正式叶子）。
- **挂载 functionId = `9000000039`**（`RES28003` / `pd_cmpt_ecd=ZJJK00104552` / `umlEcd=UML00091140`；`intermediateFlag=0`）。
- 主链（浅）：进页 → 按客户名称（或页面实标等价筛选项）填 stamp → 查询 → 列表 ≥1 行命中。
- 新卡：`menu_path` / `hash_markers` / `preconditions` / `nodes` / `rules` / `exceptions` / `source`；**OCR / 影像 / 新增建档禁入**。
- 账号：优先 `systemAccountId=2`。
- 证据：`tmp/customer-mgmt/query/`（gitignore）。

### Out（本轮不做）

- 详情 / 360 / 导出 / 重置深录（成功档 B/C）。
- 改建档卡 `customer_onboarding.json` 的主链语义（可在卡内交叉引用 stamp 来源）。
- 个人/集团等其它客户叶子；移交；进件；征信；黑名单。
- 「查询对公客户分配」`9000000283` 等易混叶子（本卡只挂 9000000039）。
- 改 `_kb.py` / `promote.py` / 共享 prompts（除非召回缺口强制，且先 agent-log 声明）。
- 引擎 `phase_done` 证据门闩（另案）；触碰用信/授信/产品/推流 WIP。

## 3. 架构与数据流

```
锚点 9000000039 + product_query 卡模板 + 档位 A stamp
        │
        ▼
  data/kb/flows/customer_query.json
        │
        └─► POST /api/v2/trajectories/analyze  (functionId=9000000039)
                │
                ▼
            POST /api/v2/trajectories  (requirement+phases, systemAccountId=2)
                │
                ▼
            record/prepare → record/start
                │
                ▼
            列表 stamp 命中 → source 回填 + through-report
```

卡 schema 对齐既有：`flow` / `aliases` / `menu_path` / `hash_markers` / `keywords` / `preconditions` / `nodes` / `rules` / `exceptions` / `source`。

召回隔离：建档卡挂 fid=**7** / `cpctMgtPg`；查询卡挂 **9000000039** / 查询页 hash（湿测补全，写入 `hash_markers`）。

假成功：允许 CDP 补填条件并点查询核对列表；不改引擎。

## 4. 验证路径

1. `GET /api/v2/processes/4/functions` 确认叶子 9000000039（锚点写入 `tmp/customer-mgmt/query/function-anchors.md`）。
2. 定稿任务文案：进「客户信息查询」→ 客户名称=`KB测客户-20260905-1315` → 查询 → 列表见 stamp；禁 OCR/新增。
3. 写卡 → 召回抽查。
4. analyze → 建交易 → prepare → start → detach。
5. through-report：trajectoryId、fid、stamp、阶段表、列表证据路径。

API 等价路径允许；最终证据须含「含任务的新交易」+「列表 stamp」。

## 5. 纪律

- Python：`D:/anaconda3/python.exe` 或 `./python/python.exe`。
- 双开：空闲槽；不抢用信 Playwright/槽位。
- 收工：`docs/superpowers/agent-log.md`；todo⑦ 增档位 B；commit 按协议。
- stamp 客户若被删不可见：报告阻塞；经 Lead 确认可改查 #515 stamp（`KB测客户-20260905-1245`）或现场挑一行。

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 筛选项文案≠「客户名称」 | 以页面实标写入卡 nodes/fields |
| 与「查询对公客户分配」等叶子混淆 | 卡与任务明文只写 9000000039 / RES28003 |
| AI 过早 phase_done | CDP 补查；引擎门闩另案 |
| hash 过短误召建档卡 | markers 用查询页专有段 + fid 文案 |

## 7. 非目标回顾

不做查询旁路深录；不扩个人客户；不与档位 A 合并为一张卡。
