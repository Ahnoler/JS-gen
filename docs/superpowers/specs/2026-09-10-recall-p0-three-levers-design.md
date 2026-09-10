# KB 召回 P0 三杠杆 — 设计（血缘作用域 / ASCII 分词 / 受控词表）

> 日期：2026-09-10  
> 状态：**已确认**（2026-09-10 Lead 裁定：全部按 reviewer 推荐，进入 [`plans/2026-09-10-recall-p0-three-levers.md`](../plans/2026-09-10-recall-p0-three-levers.md)）  
> 作者：DSH reviewer（依据 2026-09-09 OSS 调研结论 + reviewer 对 v1 评测集 35 条失败清单的实测分类）  
> 相关：[`reports/2026-09-09-kb-recall-eval-g3.md`](../reports/2026-09-09-kb-recall-eval-g3.md) §8.3 承接条件 · [`reports/2026-09-09-kb-recall-eval-baseline.md`](../reports/2026-09-09-kb-recall-eval-baseline.md) §T3  
> 冻结基线（v1，不得回退）：**Acc@1 0.650 · Recall@5 0.757 · MRR@5 0.694 · nDCG@5 0.708 · 拒答 0.633 · 噪声 0.650**；分层 **A 1.00 / C 0.867 / D 0.333 / B 0.233**

## 1. 目标

用**三条零依赖杠杆**把召回质量从「词面匹配」推到「有结构、有词法、有业务词汇」的水平；每条独立度量、独立回退，不达标不连坐。

成功终点（可机械验证）：

1. **血缘资产建成且可审计**：≥84% 的流程卡可追溯到来源模块（reviewer 实测上限 72/84 = 86%），**未映射卡必须显式列出**；
2. **作用域杠杆**：跨模块误召回类失败（实测 11 条）**至少半数转正**，且**无血缘卡不受伤**（10 条 gold 无血缘的失败项不得再退化）；
3. **分词杠杆**：D 层 Acc@1 由 0.333 上行（实测 9/10 条直接返回 `null`），A/C 层不回退；
4. **词表杠杆**：B 层上行，且**构建集与验证集分离**（禁止在同一批失败上建表又验证）；
5. 全程 `node scripts/kb/recall-eval.mjs --baseline tmp/kb-eval/baseline-v1.json` 可量化、门禁保持可证伪；**floor 只升不降**。

## 2. 范围

### In

- `data/kb/flow_lineage.json`（新资产：卡 → 模块血缘）+ 生成脚本 + 未映射清单。
- `rankFlowCards` 的**作用域调整**（boost/轻罚/中性三态）。
- 查询与卡片的 **camelCase / ASCII 别名分词**。
- `data/kb/synonyms.json`（新资产：业务受控词表）+ 查询扩展。
- 三条杠杆各自的 characterization pin；评测门禁沿用（不新增门禁文件）。

### Out（不做）

- embedding / BM25 / 向量库（**另立项**；本版不引任何新依赖）。
- 评测集 v2 扩版（另立项；本版 T3 只在既有 v1 上做**构建/验证分离**）。
- 切片父子块、版面解析（归「方向 4：切片」）。
- py 侧召回算法（D3 既定：只保持一致性断言）。
- `src/services/req-draft-traj/propose.js`（他线热区，本版不动）。

## 3. 现状与实测证据（reviewer 亲测 2026-09-10）

### 3.1 血缘现状：晋升即丢失

| 事实 | 证据 |
|---|---|
| 流程卡**无模块字段** | `data/kb/flows/*.json` 全量 84 张，顶层字段为 `flow, aliases, menu_path, biz_key_prefix, hash_markers, keywords, preconditions, nodes, field_deps, state_actions, rules, exceptions, source`——**`moduleKey` 命中 0** |
| 草稿卡**有** | `data/kb/req/*/drafts/*.json` 177/177 均带 `moduleKey` |
| 丢失点 | `scripts/kb/promote_draft.mjs` 读得到 `moduleKey`（用于筛选/报告），但 `convertDraft` 输出不含它 → **晋升后血缘只残存在自由文本 `source` 里** |

### 3.2 可重建性：86%

按草稿卡的 `flow`/`aliases` 反查：**72/84 张卡可追溯到模块（86%）**，其中**仅 1 张**同时归属多个模块。不可追溯的 12 张（多为非需求线产出的早期手工卡）：`guarantee_intro`、`duigong_contract_sign`、`customer_360`、`session_login`、`customer_query`、`collateral_seizure`、`guaranty_contract`、`loan_account`、`collateral-func-warning`、`loan-retail-erheyi-apply` 等。

### 3.3 35 条失败的实测分类（决定杠杆归属）

| 类别 | 条数 | 代表 | 可救杠杆 |
|---|---|---|---|
| **跨模块误召回** | **11** | `两家机构合并怎么登记`：asset-preserve-ops → 应 system-mgmt；`股东与实际控制人关系登记`：customer-group → 应 customer-common；`受托支付`：limit-ctrl-api → 应 disburse | **作用域** |
| **D 层 ASCII/camelCase 直接 null** | **9** | `W0`、`lmtRgst`、`doOcpRevoke`、`cstInfQuery`、`enqrPdInf`、`mntPdStg`、`cpctMgtPg`、`FS00006502` 全部返回 `null` | **分词** |
| **同义词鸿沟** | 约 11 | `把额度临时止付再恢复`（止付↔冻结）；`估算一下抵押物值多少钱`（抵押物↔押品）；`逾期了安排人上门要账`（要账↔催收） | **受控词表** |
| **同模块近邻混淆** | 余量 | `看看评级最终结果和审批过程`：rating → 应 rating-query-view | 词表/节点级（部分重叠） |

> 关键约束：**10 条失败的 gold 卡本身没有血缘**（customer_360 / session_login / customer_query 等）。若作用域实现为「只给同模块卡加分」，这些卡会被相对压低 → **必须设计成对未映射卡中性**。

## 4. 设计决策

| # | 决策 | 理由 | 备选 |
|---|---|---|---|
| **D1** | 作用域三态：**同模块 boost / 异模块轻罚 / 未映射中性** | 实测 12 张卡无血缘、10 条失败 gold 无血缘；硬过滤或"只加不减"都会误伤 | 硬过滤（会杀掉跨模块正确命中，且对无血缘卡致命） |
| **D2** | 血缘资产落 `data/kb/flow_lineage.json`（**不放 `flows/`**） | `listFlowCards*`（JS）与 `store.load_flows`（PY）都遍历 `flows/`，非卡 JSON 会触发 warn；`dict_alias.json` 已有「手工表放 data/kb」先例 | 放 `flows/_lineage.json`（会被当卡扫到） |
| **D3** | 同时给 `promote_draft.mjs` 补写 `moduleKey` | 防未来再丢；本次重建只覆盖存量 | 只重建不回写（下次晋升又丢） |
| **D4** | 分词契约：camelCase 拆分（`enqrPdInf` → `enqr`+`pd`+`inf`）+ **保留整词** + 大小写不敏感；**不改 IDF/覆盖率/阈值口径** | 实测 9 条 D 层失败是「匹配器完全没看见」而非排序错 | 只加整词（`lmtRgstAndOcp` 与 `lmtRgst` 无法互相命中） |
| **D5** | 受控词表落 `data/kb/synonyms.json`；扩展词以**低权重附加**（不改原词权重） | 词表是人工资产，需可审计可回滚 | 直接把查询改写成同义词（丢失原词语境，拒答率风险大） |
| **D6** | **防泄漏**：词表构建集 = v1 失败清单的**一半**，验证集 = 另一半（分层抽，保证 B 层两边都有） | 在同一批失败上建表又验证 = 训练集泄漏，会把 G1/G2/G3 建立的可信度作废 | 先扩 v2 再建表（更干净但更慢，见 §11 待确认） |
| **D7** | 三杠杆**独立 commit、独立度量、独立回退** | 单项不达标不连坐；便于定位 | 一把梭（无法归因） |
| **D8** | 阈值与口径**不动**（只升不降） | §8.3 承接条件 | — |

## 5. 数据模型

### 5.1 `data/kb/flow_lineage.json`

```json
{
  "lineageVersion": "v1",
  "generatedAt": "2026-09-10T00:00:00+08:00",
  "source": "data/kb/req/*/drafts/*.json（flow/aliases 反查）",
  "cards": { "product_library": ["product-mgmt"], "credit_application": ["credit-corp"] },
  "unmapped": ["session_login", "customer_360", "customer_query", "..."],
  "ambiguous": [{ "stem": "...", "modules": ["a", "b"] }]
}
```

- **`unmapped` 与 `ambiguous` 必须显式列出**，作为审计与中性策略的依据；
- 生成脚本 `scripts/kb/build-flow-lineage.mjs`（只读 drafts → 写单个文件；可重复运行、幂等）；
- 血缘**只做"卡 → 模块"**，不做反向推断；别名碰撞（一张卡多模块）只入 `ambiguous`，运行时按「任一匹配即视为同模块」处理。

### 5.2 `data/kb/synonyms.json`

```json
{
  "synonymVersion": "v1",
  "entries": [
    { "term": "冻结", "expand": ["止付", "封存"], "scope": "limit", "source": "B-001 失败反推" },
    { "term": "押品", "expand": ["抵押物", "担保物"], "scope": null, "source": "业务通识" }
  ]
}
```

- `scope` 可空=全局生效；有值=仅当查询所属模块匹配时生效（与 D1 协同，降低跨域误扩）；
- 每条必须写 `source`（业务通识 / 失败反推 / 需求文档），便于审计与追责。

## 6. 算法契约

### 6.1 作用域调整（在 `rankFlowCards` 打分之后）

```js
score_final = score_raw × scopeFactor(card, queryModuleKey)
scopeFactor = SAME_MODULE_BOOST (默认 1.30) | OTHER_MODULE_PENALTY (默认 0.85) | 1.0（未映射/无 moduleKey）
```

- 常量必须**具名导出**（便于 pin 与调参审计）；`queryModuleKey` 缺省时一律 1.0（保持既有调用点行为）；
- **先乘系数再走既有 `MIN_CARD_SCORE` / `MIN_CARD_COVERAGE` 判定**，避免改变拒答语义之外的东西。

### 6.2 分词（camelCase / ASCII）

新增 `tokenizeCodes(text)`：按非字母数字切分 + camelCase 边界拆分 + 整词保留 + 转小写；在 `profileTokens`（卡侧）与 `extractQueryTokens`（查询侧）**同源**调用。**不改 IDF 公式与覆盖率地板。**

### 6.3 词表扩展

查询侧对命中词表的词，注入 `expand` 项，权重 = 该词原权重 × `SYNONYM_WEIGHT`（默认 0.5）；`scope` 不匹配则不注入。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| `flow_lineage.json` 缺失/坏 | 作用域退化为**中性**（等价于现状），打 warn，不红 |
| `synonyms.json` 缺失/坏 | 扩展退化为不扩展，打 warn，不红 |
| 血缘指向不存在的卡 | 生成脚本报错并列出（**不允许静默**） |
| 词表 term 在所有卡中 0 命中 | 允许（同义词未必出现在卡面），但 `expand` 项必须至少有一个能在查询侧被分词命中，否则生成期 warn |
| 未映射卡 | 一律中性；其相关失败项在 DoD 中作为**不许退化**的回归集 |

## 8. 验收

| 杠杆 | 主指标 | 不许退化 | 证据 |
|---|---|---|---|
| 血缘（T1a） | 可追溯卡 ≥84%；`unmapped` 显式 | 评测指标不变（纯资产，无算法改动） | `tmp/kb-p0/T1-lineage.json` |
| 作用域（T1b） | 11 条跨模块失败**≥6 条**转正 | **A 1.00 保持**；10 条无血缘 gold 不退化；拒答 ≥0.633 | `recall-eval.mjs --baseline` exit 0 + 逐条 diff |
| 分词（T2） | D 层 Acc@1 **≥0.60**（现 0.333） | A/C 不回退；拒答 ≥0.633 | 同上 |
| 词表（T3） | B 层 Acc@1 **≥0.35**（现 0.233），且**验证集**上行（非仅构建集） | A/C 不回退；N-002 FP 靶子不得恶化 | 构建/验证分离报告 |
| 全局 | 门禁 `characterize-kb-recall-eval` 4 passed；`--baseline` exit 0 | `npm run lint` 新增 warning = 0 | `tmp/kb-p0/gate.txt` |

> 门槛值为主指标下限；**实际提升多少由实现决定，但不得低于上表**。任一项不达标 → 该杠杆单独回退，其余可保留。

## 9. 测试策略

- **pin**：`characterize-flow-card-recall` 增补三组最小断言（分词拆词/作用域三态/扩展权重与 scope 门控），并保证既有 17 条不变；
- **门禁**：沿用 `characterize-kb-recall-eval`（阈值不变）；本线**不再改 `verify-all.sh`**（已注册）；
- **独立性**：T3 必须给出「构建集 / 验证集」两套数字与条目清单；
- **回归靶子**：N-002（`计算 2 加 3 等于多少` → FP）与 10 条无血缘 gold 必须显式复测。

## 10. 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | boost 过强导致 A 层（现 1.00）回退 | 系数具名可调 + A 层作为硬回归项；先小步（1.30/0.85） |
| R2 | 无血缘卡被误伤 | D1 三态 + 10 条无血缘 gold 列为不许退化集 |
| R3 | 同义词过拟合 v1 | D6 构建/验证分离；`source` 必须写清来源 |
| R4 | 口径被顺带改动 | §8.3 承接条件；改口径 = 改基线 = 须 Lead 批准 |
| R5 | 血缘脚本误判（同名别名碰撞） | `ambiguous` 显式列出；multi-module 按"任一匹配即同模块" |
| R6 | 与 `propose.js` 他线冲突 | **允许动**（当前无在途声明覆盖，工作区干净；基线 `b927a170`），但须在开工声明中列入文件集，冲突先协调；注入只加参数不改既有语义 |

## 11. 决策确认（2026-09-10 已定）

Lead 裁定：**全部按 reviewer 推荐执行**，不再逐项回问。

| # | 决策项 | 采纳结论 |
|---|---|---|
| 1 | **D6 防泄漏方案** | **(a) 在 v1 上做构建/验证五五分离**（今天可开工）。附加三条硬约束：① 划分落盘后不得再改；② 分层平衡（B 层与 D 层各自两边各半）；③ 报告必须给 **verify 集逐条结果**，不得只报 build 聚合。未来评测集扩 v2 后，词表须在 v2 新查询上复验 |
| 2 | **作用域系数** | **先取保守值 1.15 / 0.92**（A 层 1.00 零容错）。若 11 条跨模块靶子转正 <6 条，可升至 1.30 / 0.85，但**升级必须在同 commit 附对比度量** |
| 3 | **DoD 门槛** | **认可下限**（T2 D ≥0.60 / T3 B ≥0.35），并追加三条硬约束：A 层 **1.00 不得回退**；T2 的 9 条 null **≥6 条转正**；T3 **verify 集必须单独上行**（只在 build 上行 = 判过拟合） |
| 4 | **组织方式** | **接受**「三杠杆同一 spec、独立 commit、独立度量、独立回退」——不达标项单独回退，不连坐 |
| 5 | **`propose.js` 注入** | **允许动**（当前无在途声明覆盖；工作区干净；基线 `b927a170`）。要求：开工声明列入文件集；注入只**新增** `moduleKey` 参数与 `_modules` 传递，不改既有语义；若与他线冲突先协调再动 |

实施按 plan T0 → T4 推进；每个 Task 交付后把 commit + 证据交 reviewer 复核（G1 数据资产 / G2 纪律 / G3 算法与度量）。
