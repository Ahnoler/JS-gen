# KB Insights 设计——溯源 ID 化 / 覆盖分析 / 变更影响反查（A 级三项）

> 日期：2026-09-05 ｜ 状态：设计定稿（用户已确认），待实施计划
> 来源：`docs/superpowers/research/2026-09-05-partner-exchange-research.md` A 级建议，吸收伙伴「全景AI」交流会的溯源/覆盖分析/变更分析理念。
> 用户拍板决策：单 spec 三部分；覆盖判定=存在性+明细元数据；A3 含 possibly-stale 只读检测；存量回填后置；架构=Node 单向只读 KB 文件（方案甲）。

## 0. 目标与非目标

**目标**：把 KB 与轨迹从「两个孤岛」变成可互相反查的资产——
1. A1：知识的来源可程序化反查（卡片 ↔ 轨迹/交易号 ID 级关联）。
2. A2：功能树的执行覆盖可度量、可出报表（未覆盖功能清单）。
3. A3：菜单变更的影响面可反查（变更 → 受影响轨迹 + 受影响 KB 卡），KB 卡失效可检测（只读报告）。

**非目标**（明确不做，防止蔓延）：
- 不改 Python KB 侧任何代码（`scripts/kb/**` 零改动）。
- 不写 `data/kb/**` 任何文件（stale 只报告不标记；A1 回填脚本就绪但**后置执行**）。
- 不做向量/语义召回、知识地图 UI、缺陷单关联（C/B 级，另立）。
- 不引入定时刷新/物化表（当前规模实时查询足够）。

## 1. 总体架构（方案甲：Node 单向只读 KB 文件）

```
新增：
  src/services/kb-flow-cards.js         KB 卡只读器（共享基础）
  src/services/coverage-service.js      A2 聚合（rollup 纯函数导出）
  src/services/change-impact-service.js A3 反查 + stale 检测（匹配器纯函数导出）
  src/routes/v2/kb.js                   GET /api/v2/kb/cards、GET /api/v2/kb/stale-cards
  migrations/backfill-kb-source-refs.mjs A1 存量回填（一次性，后置执行）
  scripts/characterization/characterize-kb-insights.mjs 特征化
修改（各一小块）：
  src/routes/v2/hierarchy.js            + GET /api/v2/hierarchy/coverage
  src/routes/v2/system-mgmt.js          + GET /api/v2/system-mgmt/nodes/:id/change-impact
  src/dao/trajectory-dao.js             + statsByFunctionIds()（additive）
  src/dao/batch-recording-dao.js        + statsByFunctionId()（additive）
  src/routes/v2/__init__.js             注册 kb 路由
  src/dashboard/api-docs/catalog.js + groups/ 新 kb 组 + 两个既有组补条目
```

依赖方向：routes → services → (dao, fs)。`kb-flow-cards.js` 只依赖 `node:fs` + 路径解析，不 import 任何 dao；`coverage-service.js` 依赖 hierarchy-tree-query（树获取）与两个 dao 统计方法；`change-impact-service.js` 依赖 menu-change-log-dao、trajectory 查询与 kb-flow-cards。无环。

**KB 卡只读器**（`kb-flow-cards.js`）：
- `listFlowCards()`：读 `data/kb/flows/*.json`，返回 `[{ flow, menu_path, source, source_refs }]`（按文件名排序，确定性）。
- 容错与 `scripts/kb/store.py:46-58` 对齐：目录缺失 → `[]`；单卡 JSON 解析失败或非 dict 或缺 `flow` 键 → 跳过 + `console.warn`（文件名入日志）。
- KB 数据目录路径：复用仓内相对根（`data/kb/flows`），不做配置化（与 Python 侧 `KB_DATA_DIR` 环境变量解耦——控制面只用真源目录；若未来 exec 环境无该目录，容错返回空数组即自洽）。

## 2. A1：source_refs 结构化溯源

### 2.1 Schema（卡片可选字段，load_flows 宽容透传，已验证 store.py:53-56）

```json
"source_refs": {
  "trajectory_ids": ["26081317115618826"],
  "tx_nos": ["009", "012"],
  "dates": ["2026-09-01"]
}
```

- 三数组均为可选、元素为字符串；空对象允许；字段缺失=未结构化（向后完全兼容）。
- 原 `source` 自由文本**保留不动**（人读），`source_refs` 是机读结构层，两者并存。
- 正向约定：今后新卡/改卡（含 KB 线）按此 schema 写；实施时在 agent-log 留言知会 Cursor KB 线。

### 2.2 回填脚本（`migrations/backfill-kb-source-refs.mjs`，后置执行）

- 正则解析存量 `source` 文本：轨迹号（≥18 位连续数字）、交易号（「交易 #?NNN」形态）、日期（YYYY-MM-DD）。
- **默认 `--dry-run`**：打印解析结果表不写盘；`--apply` 才写。仅当三数组至少一项非空才写 `source_refs`；解析置信度低（无可识别模式）→ 跳过该卡并列入报告。
- 只增改 `source_refs` 键，**绝不触碰卡片其他任何字段**；写盘保持原有缩进风格（2 空格）与键序（JSON.stringify 重建允许，但键序按原 key 顺序 + source_refs 追加尾部）。
- 执行时机：**后置**——KB 线 WIP 全部提交、`data/kb/flows/` 无未提交改动后，由专门任务单元跑（agent-log 声明协调）；本 spec 的实施波次不执行它。
- migrations/ 目录惯例：一次性脚本，eslint ignore 区域，无需 JSDoc 全量。

### 2.3 消费面

`GET /api/v2/kb/cards` 返回每卡的 `{ flow, menu_path, source, source_refs }`——溯源信息即时可见。「按轨迹反查支撑了哪些卡」的数据面就此绪（消费方可自行在 cards 响应上过滤 source_refs.trajectory_ids），专门反查端点留待有实证需求再加（YAGNI）。

## 3. A2：覆盖分析

### 3.1 API：`GET /api/v2/hierarchy/coverage`

查询参数：
- `systemId`（可选）：限定某系统子树；缺省=全树。
- `type`（可选）：`function`（默认，只出 type=3 功能节点行）/ `all`（含系统/模块行以看聚合）。

### 3.2 数据流

1. 树：`hierarchy-tree-query.js` 取全量节点（含 id/parentId/type/name）。
2. 轨迹统计：`trajectory-dao.statsByFunctionIds(functionIds)` → `{ functionId → { trajCount, lastExecutedAt } }`。lastExecutedAt 取该 functionId 下轨迹 `updated_at` 最大值（SQL 聚合，一次查询，防 N+1）。
3. 批量统计：`batch-recording-dao.statsByFunctionId()` → `{ functionId → { batchTotal, batchSuccess } }`（join batch_recording_job 取 job.functionId，item.status='success' 计成功；一次查询）。
4. KB 卡数（明细列）：menu_path 匹配器（与 A3 共享，见 §4.3）把每张卡解析到功能节点，`{ functionId → kbCards }`。
5. rollup 纯函数 `rollupCoverage(nodes, stats)`：功能节点 `covered = trajCount > 0`；模块/系统行（`type=all` 时）聚合自身+子孙的计数；`coverageRate = coveredFunctions / totalFunctions`。

### 3.3 响应形状（扁平行，便于表格渲染）

```json
{
  "rows": [{
    "nodeId": 12, "type": 3, "name": "新增对公授信管理",
    "path": "信贷系统/授信管理/对公授信管理/新增对公授信管理",
    "trajCount": 4, "lastExecutedAt": "2026-09-01T14:30:00.000Z",
    "batchTotal": 12, "batchSuccess": 10, "kbCards": 1, "covered": true
  }],
  "summary": { "totalFunctions": 386, "coveredFunctions": 57, "coverageRate": 0.148 }
}
```

- **覆盖判定（已拍板）**：存在性——有 functionId 绑定的轨迹即 covered；lastExecutedAt/batch*/kbCards 是明细元数据，不参与判定。
- 未覆盖清单 = `covered:false` 的行（前端按此过滤即得，不单独出端点）。
- 节点 path 由服务端拼好（含系统名），前端零拼接逻辑。

## 4. A3：变更影响反查 + possibly-stale 检测

### 4.1 API：`GET /api/v2/system-mgmt/nodes/:id/change-impact`

- `:id` = 系统节点 id；query：`version`（可选，变更版本过滤）、`limit`（可选，默认 200，与既有 menu-change-log 路由对齐）。
- 数据流：`menu-change-log-dao.listBySystem(id, {version, limit})` → 变更行 → 逐行推导影响面：
  - **受影响轨迹**：变更行携带的节点 id（删除/迁移类变更取子树全集）→ 匹配 `trajectory.functionId` 绑定集（一次 `whereIn` 查询，返回轨迹 id+name 列表）。
  - **受影响 KB 卡**：变更行的新旧节点名 → menu_path 匹配器命中（卡路径含被改名/删除段名）的卡列表。
- 响应：`{ changes: [{ changeLogRow…, affectedTrajectories: [{id,name}], affectedKbCards: [flow] }], summary: { changes, affectedTrajectoryCount, affectedKbCardCount } }`。
- 无变更记录 → 200 空列表（非错误）。
- **实施前置核查**：menu_change_log 表实际列名/是否携带 nodeId 与新旧名——实施第一步读 `src/dao/menu-change-log-dao.js` 与写入侧（menu-scan-apply.js / menu-json-import.js）确认；若列不足（如无 nodeId），降级为按「系统内全部变更 + 名字段匹配」推导，并在实现注释说明。

### 4.2 API：`GET /api/v2/kb/stale-cards`

逐卡将 `menu_path` 按名字路径解析到当前树：

- 段以 `/` 切分，逐段去空格后与树节点名精确匹配（从系统层开始，逐层下行）。
- 三态结果：`matched`（解析到功能/模块节点，附 nodeId）/ `possibly-stale`（某段在对应层找不到，附缺失段名与已解析前缀）/ `unparsed`（自由文本——含括号/「未采到」等非路径形态、或段数<2，**不算 stale**）。
- 响应：`{ cards: [{ flow, menu_path, matchStatus, matchedNodeId?, missingSegment?, resolvedPrefix? }], summary: { total, matched, possiblyStale, unparsed } }`。
- **只读**：永不写卡、永不改召回行为。

### 4.3 menu_path 匹配器（共享纯函数）

`matchMenuPath(cards, treeNodes)` / `resolveMenuPathSegments(segments, treeNodes)`：
- 规范化：段与节点名 `str.replace(/\s+/g,'')` 后比较（与 Python 侧 `_norm_name` 语义一致）。
- 层级语义：第 1 段匹配系统名，其后逐段匹配子孙；允许路径深度少于树深度（卡停在模块层）。
- 段名在同级重复时取首个匹配并在结果中标注 `ambiguous:true`（树内同名兄弟罕见，但删除/重建期可能出现）。
- 导出供特征化与 A2/A3 两个 service 复用。

## 5. 错误处理

- KB 目录缺失/单卡损坏：只读器跳过+warn（§1），相关端点降级为「无卡数据」而非 500。
- 树/DB 查询失败：沿用所在路由文件现状——hierarchy.js/system-mgmt.js 均已接 AppError/asyncHandler（波次 5-B 统一），新 handler 同风格。
- 参数非法（systemId 非数字等）：AppError VALIDATION → 400。
- `change-impact` 的 `:id` 不存在 → 404 NOT_FOUND。

## 6. 测试与验证

- **特征化** `scripts/characterization/characterize-kb-insights.mjs`（确定性，不依赖真实 data/kb 与 DB）：
  - 匹配器：常规三级路径 / 段名带空格 / 自由文本→unparsed / 缺段→possibly-stale / 同名兄弟→ambiguous。
  - rollup：覆盖卷积（功能覆盖上卷到模块/系统）、rate 计算、空树。
  - source 解析器：轨迹号/交易/日期正则样例 + 低置信跳过。
  - fixture 用临时目录（与 characterize-kb-actions.py 的 KB_DATA_DIR 隔离手法同思路）。
- **verify-all 接线**：实施时先查 agent-log 在途声明——`scripts/refactor/verify-all.sh` 若被其他线占用（近 5 天被碰 6 次），本次先不入闸、后续冷区窗口补一行。
- API 手工冒烟：起本地 server 后 curl 四端点（连真实 DB），核对 coverage 数字与既有批量报表一致性。
- 门禁：`node --check` / `npx eslint` 0 warning（新函数 JSDoc 中文齐全）/ verify-all 与基线一致。

## 7. 执行约束（热区与协议）

- 禁入不变量：`scripts/kb/**`、`data/kb/**` 零改动；回填脚本只创建不执行。
- `hierarchy.js`/`system-mgmt.js`/`trajectory-dao.js`/`batch-recording-dao.js` 当前为冷区，实施前复核 agent-log 在途声明；不相交才动。
- 实施走既有协议：开工声明（含子智能体代声明）→ 并行子智能体文件集不相交 → 主线程验收 → 收工回报。
- 建议拆分（writing-plans 细化）：①匹配器独立小模块 `src/services/menu-path-matcher.js` + 特征化（先行，无外部依赖）②两个 dao 方法 + A2 coverage 路由 + catalog③kb 路由 + cards/stale 端点 + A3 change-impact 路由。依赖关系：②③都 import ①的匹配器——执行顺序 **① 合入后 ②③ 并行**（并行子智能体文件集仍不相交）。

## 8. 验收标准

1. `GET /api/v2/hierarchy/coverage` 返回全树功能节点覆盖行+汇总，`?systemId` 限域生效；covered 判定与 DB 实际绑定一致（抽样比对）。
2. `GET /api/v2/system-mgmt/nodes/:id/change-impact` 对既有菜单变更流水返回受影响轨迹/卡；无变更→200 空表。
3. `GET /api/v2/kb/stale-cards` 三态正确（真实 25+ 卡上 unparsed 与 possibly-stale 分布合理，人工抽查 3 张）。
4. `GET /api/v2/kb/cards` 返回全部卡片含 source_refs 字段（回填前为空对象/缺失，端点不报错）。
5. 特征化全绿；verify-all 与基线一致；/api/docs 四端点可见可试（tryable）。

## 9. 实施遗留（deferred minors，2026-09-05 终审分诊：全部 keep-deferred）

> 实施期间派发通道持续故障（captcha verify failed ×6），Task 4 起主线程实施+代评审；10 条 Minor 均不影响合并，留此备查（原 SDD ledger 已按流程清理）。

1. 特征化缺 `resolvedPrefix === ''` 断言（matcher 首段即缺失场景）、`normSegName` 无直测、`unparsed` 结果无多余键断言。
2. 特征化 cards 段的 fixture `writeFileSync` 在 try/finally 之外（写入抛出会泄漏 tmpdir；plan-mandated 原样）。
3. `kb-flow-cards.js` warn 标签未区分「读失败」与「JSON 解析失败」（跳过行为正确）。
4. `.JSON` 大写扩展静默排除（与 `store.py` 行为一致，跨语言侥幸对齐）。
5. 特征化段 3 的 `run` 标签文案仍写「success 计数」（实际钉 `'recorded'`，语义成立）。
6. 接口字段名 `batchSuccess` 与底层 `'recorded'` 语义有命名错位（为稳定 Task 4/5 消费契约保留）。
7. coverage 的无效 `systemId`（不存在的节点）静默返回空表而非 404（spec 只对 change-impact 的 `:id` 要求 404）。
8. **KB 卡 `menu_path` 存在 `→` 分隔形态**（产品线新卡）——三态检测对此不崩溃（判 unparsed），但失去漂移检测能力；书写规范建议已落 `docs/superpowers/research/2026-09-04-kb-build-handover.md` §6。
9. 特征化对「审批待办」类真实漂移的 stale 发现依赖人工查看 stale-cards 输出（无自动断言——真实树数据不适合 fixture 化，接受）。
10. 回填脚本 `--apply` 尚未执行（定案即后置；待 `data/kb/flows/` 无未提交改动时单独任务单元跑，跑完把结果表回贴 agent-log）。
