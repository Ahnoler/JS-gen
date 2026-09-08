# 知识库链路加固 — 设计（切片 / 存储 / 召回 / 草稿交易）

> 日期：2026-09-08  
> 状态：**已确认**（2026-09-08 决策按推荐全部采纳，进入 [`plans/2026-09-08-kb-remediation.md`](../plans/2026-09-08-kb-remediation.md) 实施）  
> 审查者：DeepSeek Harness（reviewer）  
> 被审快照：HEAD `93cd430f`（审查期间由 `475328d4` 推进而来）→ 现行快照 `e8127000`（pageCodes 特性 `atom-keydata.js` 与死代码清理线已落地，基线 characterization 25 → 26）  
> 相关：[`2026-09-07-req-to-draft-traj-design.md`](./2026-09-07-req-to-draft-traj-design.md)、[`2026-09-08-atom-record-flow-card-recall-design.md`](./2026-09-08-atom-record-flow-card-recall-design.md)、[`2026-09-08-req-draft-wizard-ui-design.md`](./2026-09-08-req-draft-wizard-ui-design.md)  
> 依据：CodeGraph v1.6.0 定位 + 全量 characterization 实跑 + 行为探针（复现命令见 plan 附录 A）

## 1. 目标

对「需求切片 → 草稿交易 → 录制」链路做**工程加固**：不改变已确认的产品语义（人审勾选、不自动录制、出处硬约束），只修正确性、可复现性与召回质量。

成功终点（每条可机械验证）：

1. 同一 `(moduleKey, chainId, stepIndex)` 在任意次 LLM 重跑下产出**同一** `req_atom_key`；同键重复 commit 在任何生命周期状态下都被 skip（`force` 例外，且不违反唯一约束）。
2. propose 缓存**可失效**：源 `through-chains.md` 变更后，commit 必须拒绝并要求重新 propose，而不是静默沿用旧原子。
3. 不可解析的作业区（无步骤表）调用 propose **返回明确 4xx + reason**，不再返回 200 空数组。
4. 召回在固定金样例（≥20 条）上 flowRef 全部命中；单原子召回耗时 < 200 ms（基线 654 ms@800 字）；Python 与 JS 两侧对同一金样例的 flowRef 一致。

## 2. 范围

### In

- 幂等键稳定化与唯一性保障（含历史数据回填）。
- propose 缓存失效策略（`sourceHash` / `cacheVersion`）与原子写。
- propose 错误语义 + 前端门控契约（前端仓库另改）。
- 出处锚点：`req_source_hash` / `req_chunk_id` 两列 + commit 回查。
- 召回确定性升级（术语化 + IDF + 极性消歧）+ 性能上界。
- 召回跨语言金样例（Python/JS 共用 fixture）。
- functionId 候选建议（`functionIdCandidates`）。
- commit 预校验端点 `draft-traj/validate` + 操作人 `paasUserId`。
- 观测指标（append-only JSONL）。
- 门禁与卫生修复（`verify-all.sh` 顺序、缓存 gitignore、drafts 归档）。

### Out（本版不做）

- 不重切 30 个模块语料；chapters 段落级锚点（`<!-- chunk:NN -->`）另立项（见 D2）。
- 不引入向量库 / embedding 服务 / BM25 依赖（见 D6）。
- 不改 SPA 向导实现（前端仓库 `D:/dev/ui-auto-recording-agent-vue-master/vue-project`），仅给出契约要求。
- 不做操作组件晋升、批量 Excel 录制合并（`todo-list.md` ⑧′）。
- 不实施湿测判定词扩项（`readonly-partial`，需 Lead 批准，见 §11 风险 R4）。

## 3. 现状与问题（审查结论）

### 3.1 基线数据（2026-09-08 实测）

| 指标 | 基线值 |
|---|---|
| req 模块 | 30（`canProposeAtoms=true` 29 / 30，archive=false） |
| 湿测叶 | 1,958（match 1,006 / drift 118 / blocked 686 / not-found 148 / pending 0） |
| 草稿流程卡 | 177（gate 白名单 pass/full/match 63；partial 110） |
| 正式流程卡 | 84（389 KB） |
| propose 缓存 | 10 个未跟踪文件；3 个有原子，7 个空壳 79 B |
| product-mgmt 原子 | 20（`suggestedFunctionId` 全 null；节点召回 4/20 挂错） |
| 召回成本 | 800 字 654 ms / 2,000 字 2,796 ms（单原子） |
| 幂等键漂移 | 同一 `chain-a:2` 两次 propose → 两个不同键 |

### 3.2 缺陷清单

| ID | 严重度 | 问题 | 位置 | 证据要点 | 归属 |
|---|---|---|---|---|---|
| F-01 | **P0** | atomKey 混入 LLM 生成的 title → 幂等键不稳定 | `parse-through-chains.js:238` | 两次 propose 得 `…:2:新增一级分类` / `…:2:新增一级分类-父层级空-层级-1` | Task 1 |
| F-02 | **P0** | 幂等查重只认 `record_status='draft'`；无唯一约束/事务 | `trajectory-dao.js:578-591`、`migrations/20260907120000…:16` | 草稿转 recorded 后同键再 commit 不 skip；并发可重复 | Task 2 |
| F-03 | **P0** | propose 缓存未 gitignore、无 sourceHash、stale 静默 | `propose-cache.js:10,37-48`、`commit.js:74-77` | `git check-ignore` 退出 1；10 个 `??`；loan-corp 空壳缓存重跑可得 35 原子 | Task 3 |
| F-04 | **P0** | 不可解析模块静默返回空；文档记 29/29 与实测 29/30 不符 | `propose.js:408-488`、`parse-through-chains.js:113,183` | archive 散文体 → 200 + 空数组 | Task 4 |
| F-05 | P1 | 出处只到「文件 + H1 标题」，无锚点/哈希，commit 不回查 | `provenance.js:173-178`、`commit.js:91-95` | 章节改名/重切后出处静默失效 | Task 5 |
| F-06 | P1 | 召回为全长度子串 n-gram：成本 O(L²)、精度差 | `flow-card-recall.js:22-39,13-15` | `启用产品`→node `prod_disable_dlg`；`对公客户主页 点击客户转正`→`rating` | Task 6 |
| F-07 | P1 | 召回双实现（Python/JS）结果不一致，无共享金样例 | `scripts/kb/recall.py:20` vs `flow-card-recall.js:100` | `维护客户信息并保存` → py 产品要素库 / js customer-group-cluster | Task 7 |
| F-08 | P1 | `suggestedFunctionId` 实测全 null → commit 必须逐条 override | `propose.js:369` | product-mgmt 20/20 null | Task 8 |
| F-09 | P1 | 无 dry-run 预校验；未写操作人 `paasUserId` | `routes/v2/kb.js:69-90`、`commit.js` | `trajectory-meta-service.js:218-239` 已支持透传但未用 | Task 9 |
| F-10 | P2 | 粒度守卫靠 prompt + 正则；引用型/非写步骤进 atoms | `propose.js:42-43` | `chain-b:3 副本复制`、`chain-b:4 回主链 A 第 6-9 步` | Task 13 |
| F-11 | P2 | `maxAtoms` 静默截断；`rejected` 不含被截断项 | `propose.js:468-470` | 调用方无法感知丢弃数量 | Task 13 |
| F-12 | P2 | KB 无 schemaVersion/校验；promote 后 drafts 双真相 | `scripts/kb/store.py:52-55`、`promote_draft.mjs` | 只检查 `flow` 键；apply 不删 drafts | Task 12 |
| F-13 | P2 | 源文档仓外绝对路径 + 上传 501 → KB 不自包含 | `provenance.js:36`、`routes/v2/kb.js:54-56` | 换机即失效 | Task 11 |
| F-14 | P2 | 两条 KB characterization 排在 `ALL GREEN` 之后，永不生效 | `scripts/refactor/verify-all.sh:148-155` | 失败不影响退出码 | Task 12 |
| F-15 | P2 | 证据面错位：湿测禁写操作，而草稿交易原子全是写操作 | `SKILL.md:102-104` | blocked 686（35%）；草稿卡可晋升仅 63/177 | Task 14（另批） |
| F-16 | P1 | 章节解析魔法分 + 每原子全量读 chapters | `provenance.js:84-165,205-210` | N 原子 × M 章节重复 IO | Task 6 |

### 3.3 评分

| 维度 | 得分 | 结论 |
|---|---|---|
| 切片 | 6.5 / 10 | 湿测证据链是最硬资产；切片产物无 ID/版本/锚点，解析契约脆弱且失败静默 |
| 存储 | 5.5 / 10 | 文件即真相务实；propose 缓存是仓内未忽略隐藏文件且无失效策略 |
| 召回 | 4.5 / 10 | 纯子串匹配；两套实现结果不一致；精度与成本双差 |
| 构建草稿交易 | 6.5 / 10 | 流程设计正确（人审 + 出处硬约束 + 不自动录制）；幂等与可执行性不足 |
| **加权** | **6.0 / 10** | 设计意图优秀，工程质量是短板 |

## 4. 设计决策

| # | 决策 | 理由 | 备选 |
|---|---|---|---|
| D1 | 幂等用「`req_atom_seq` 列 + 唯一索引 `(req_module_key, req_atom_key, req_atom_seq)`」 | 保留 `force` 逃生舱，同时获得 DB 级唯一保障；MySQL 无 partial index | claim 表（更重，不采纳） |
| D2 | 出处锚点**分两阶段**：本版只做 `req_source_hash` + 稳定 `req_chunk_id` | 段落级锚点需重切 30 模块语料，成本高，另立项 | 直接上 `<!-- chunk:NN -->`（本版不做） |
| D3 | 召回跨语言先**共享金样例**，不立刻合并实现 | 合并涉及架构（Python 调 HTTP），风险大于收益；先建立一致性契约 | Python 改调控制面（另议） |
| D4 | `atomKey` 去 title，历史数据**回填**（旧键截前 3 段） | `slugPart` 已把 `:` 归一为 `-`，截断安全 | 不回填（会留下 3 条孤儿键） |
| D5 | 观测指标用 append-only JSONL（`data/kb/staging/`） | 零迁移、与现有 staging 语义一致、已 gitignore | 新建 MySQL 表（后置） |
| D6 | 本版不引入向量/BM25 依赖 | 保持离线可控；先用确定性升级把精度与成本拉到可接受线 | 引入 rerank（需 Lead 决策） |

## 5. 数据模型

### 5.1 迁移一：`req_atom_key` 稳定化回填（D4）

- 无列变更；数据回填：`UPDATE trajectory SET req_atom_key = SUBSTRING_INDEX(req_atom_key, ':', 3) WHERE req_atom_key LIKE '%:%:%:%'`（逐行应用，先 `SELECT` 出清单）。
- 不可逆：`down` 仅注释说明，不做还原。

### 5.2 迁移二：幂等与并发（D1）

| 列 / 索引 | 定义 |
|---|---|
| `req_atom_seq` | `int not null default 0`，`force=true` 时取该 `(module, atom)` 现有最大 seq + 1 |
| `traj_req_atom_uq` | `unique(req_module_key, req_atom_key, req_atom_seq)` |

迁移前必须检测历史重复（`GROUP BY req_module_key, req_atom_key HAVING COUNT(*)>1`）：有重复则**迁移显式报错并输出行**，由人决定合并，禁止静默去重。

### 5.3 迁移三：出处锚点（D2 Phase 1）

| 列 | 类型 | 含义 |
|---|---|---|
| `req_source_hash` | `string(64)` nullable | 解析出处时章节文件的 sha256 |
| `req_chunk_id` | `string(191)` nullable | `<chapter-file-stem>#<h1-slug>`（slug 走 `normalizeHint` 规则，与原文标点无关） |

### 5.4 propose 缓存结构（D5 / F-03）

```json
{
  "cacheVersion": 1,
  "updatedAt": "2026-09-08T00:00:00.000Z",
  "sourceHash": "<sha256 of through-chains.md>",
  "inputHash": "<sha256 of JSON.stringify({chainIds, maxAtoms})>",
  "atoms": [],
  "rejected": [],
  "truncated": { "dropped": 0, "requestedMax": null }
}
```

- 写入用 tmp + rename 原子替换。
- commit 校验 `cacheVersion` 与 `sourceHash`；不一致 → `STALE_PROPOSE_CACHE`。

## 6. API 契约增量

### 6.1 `POST /api/v2/kb/req-modules/:moduleKey/draft-traj/propose`

- 新增 4xx：`through-chains.md` 无步骤表 → `code: VALIDATION`，message `'through-chains.md has no parseable step table'`；`chainIds` 过滤后为空 → message `'chainIds matched no chains'`（附可用 chainId）。
- 原子新增字段：`pageCodes`（已落地，见 `atom-keydata.js`）、`functionIdCandidates: [{id, name, score, reason}]`、`kind: 'write'|'nav'`。
- 响应新增 `truncated: { dropped, requestedMax }`；`rejected` 不再被 `maxAtoms` 截断。

### 6.2 `POST …/draft-traj/commit`

- body 增 `paasUserId`（透传 `createTransactionWithPhases`）。
- 新增 skip reason：`stale_chapter_ref`（章节文件缺失或哈希不一致）、`reference_step`（引用型步骤，见 F-10）。
- 幂等：任意 `record_status` 命中即 skip；`force=true` 走 `req_atom_seq` 递增。

### 6.3 新增 `POST …/draft-traj/validate`

- body 同 commit；返回 `{ ok: [atomKey], problems: [{atomKey, code, message}] }`；**不写库、不调 LLM**。
- 与 commit 共用同一纯函数 `validateCommitAtoms()`，防止逻辑漂移。

### 6.4 前端契约要求（前端仓库另改）

- 作业区禁用条件：`hasThroughChains` → **`canProposeAtoms===true`**，行 tooltip 给出原因。
- 展示 `functionIdCandidates` 作为下拉候选；commit 仍以 `functionIdOverrides` 为准。

## 7. 关键算法

### 7.1 atomKey（F-01）

形如 `<module-slug>:<chain-slug>:<step-index>`（例 `product-mgmt:chain-a:2`）；`stepIndex` 非法时用 `0`；与 title 完全解耦。

### 7.2 召回打分（F-06）

- 卡片侧：归一化术语集 = `flow|aliases|keywords|hash_markers|nodes[].id|page|enter`，FS/ZJJK 码整词保留。
- 查询侧：CJK **只取 bigram** + 码整词 + 最长匹配优先（删除长度 2..L 全枚举）。
- 打分：`score = Σ idf(term) × len(term)`，`idf = log(1 + N/df)`。
- 阈值：相对阈值 `cardScore / maxPossible ≥ 0.25` 且 `nodeScore ≥ cardScore × 0.5`（保留 `MIN_CARD_SCORE` / `MIN_NODE_SCORE` 常量名以兼容 pin）。
- 极性消歧：title 含 `启用` 时排除 id/page 含 `disable|禁用|下架` 的节点，反之亦然。

### 7.3 章节出处解析（F-16）

魔法分改为可解释加权（ZJJK 命中 > 标题命中 > 文件名命中 > 正文命中），权重为具名常量并注释来源；章节内容按 `moduleDir + mtime` 进程内缓存，避免 N×M 重复读盘。

### 7.4 幂等与并发（F-02）

`validate → 查重（任意状态）→ force 时 seq++ → 建轨迹`；唯一索引兜底，捕获 `ER_DUP_ENTRY` 转为 `skipped: duplicate_draft`。

## 8. 错误处理摘要

| 情况 | 行为 |
|---|---|
| through-chains 无步骤表 | propose 400 `VALIDATION` |
| chainIds 无匹配 | propose 400 `VALIDATION` |
| 缓存缺失 | commit 400（现状保留） |
| 缓存版本/源哈希不符 | commit 4xx `STALE_PROPOSE_CACHE` |
| 章节缺失/哈希不符 | 该原子 `skipped: stale_chapter_ref` |
| 引用型步骤 | 该原子 `rejected/skipped: reference_step` |
| 同键已存在（任意状态） | 默认 `skipped: duplicate_draft`；`force` 递增 seq |
| 唯一索引冲突 | 转 `skipped: duplicate_draft`（不 500） |
| analyze 失败 | 该原子 `skipped`，其余继续（现状保留） |

## 9. 验收

1. plan 的 DoD 矩阵逐行 PASS（命令 + 期望输出 + 证据落盘路径）。
2. `bash scripts/refactor/verify-all.sh` ALL GREEN，且**故意让 `characterize-kb-staging` 失败时整体 FAIL**（自证门禁生效）。
3. 金样例表（§7.2 五条 + F-07 三反例）在 Python 与 JS 两侧 flowRef 一致。
4. product-mgmt 真实模块重跑：两次 propose 的 `atomKey` 集合完全一致；commit 同键第二次为 `duplicate_draft`。
5. 全程无 `prepare` / `record/start` / `detach` 调用。

## 10. 测试策略

- **characterization 是 pin**：改实现必须同 commit 更新 `scripts/characterization/*` 断言；禁止恒真化/删除。
- 新增 fixture：`scripts/characterization/fixtures/kb-recall-golden.json`（≥20 条，Python/JS 共用）。
- 缓存与迁移类改动用 **tmp 副本**验证，禁止手改 `data/kb/req/**/.draft-traj-propose.json` 与 `data/kb/flows/**`。
- 每 Task 证据落 `tmp/kb-remediation/<task-id>/`。

## 11. 风险

| 风险 | 缓解 |
|---|---|
| R1 回填 `req_atom_key` 不可逆 | 迁移前导出 `SELECT` 清单到 `tmp/kb-remediation/T1/`；`down` 注明不可还原 |
| R2 唯一索引遇历史重复 | 迁移显式报错并输出行，人工合并；禁止静默 dedupe |
| R3 `force` 语义变化影响前端文案 | api-docs + 向导文案同步说明「seq 递增」 |
| R4 湿测证据面错位（F-15）未解决 → 草稿卡晋升率仍低 | 本版仅登记；T14 需 Lead 批准后另开任务 |
| R5 召回改造引入回归 | 金样例 + 性能上界断言 + 保留旧阈值常量名 |
| R6 并发会话正在改 `propose.js`（pageCodes 在途） | 开工前检查并发态；未收尾时只做 D 线任务 |

## 12. 参考对标（开源，star 数 2026-09-08 用 `gh` 核验）

| 方向 | 项目 | Star | 可借鉴 |
|---|---|---|---|
| 需求→用例 | [Echoxiawan/AITestCase](https://github.com/Echoxiawan/AITestCase) | 63 | 页面 + 需求文档结合生成用例（该方向**无高星项目**，最高为 Kiwi TMS 1,252） |
| 切片/召回 | [langgenius/dify](https://github.com/langgenius/dify) | 154,960 | 父子块 small-to-big（治「出处太粗」） |
| 切片/召回 | [infiniflow/ragflow](https://github.com/infiniflow/ragflow) | 90,263 | DeepDoc 解析 + 模板化切块 + 混合检索 + rerank |
| 切片/召回 | [messkan/rag-chunk](https://github.com/messkan/rag-chunk) | 119 | 切块策略基准工具（可量化选型） |
| UI 录制 | [mobile-dev-inc/Maestro](https://github.com/mobile-dev-inc/Maestro) | 15,533 | YAML 声明式步骤模型（步骤与执行解耦） |
| UI Agent | [browserbase/stagehand](https://github.com/browserbase/stagehand) | 24,172 | action caching：首次 LLM，命中后确定性回放 |
| UI Agent | [web-infra-dev/midscene](https://github.com/web-infra-dev/midscene) | 14,806 | GUI Agent for E2E Testing（定位最接近） |

**结论**：端到端「需求 → 切片 → 用例 → UI 录制」在开源界**无成熟等价物**（该链路是本项目差异化资产）；但**召回层**明显落后 RAG 生态，应借鉴而非自研。

## 13. 决策确认（2026-09-08 已定）

Lead 裁定：**全部按 reviewer 推荐执行**，不再逐项回问。

| # | 决策项 | 采纳结论 |
|---|---|---|
| 1 | §4 D1~D6 | 全部接受。D1 用 `req_atom_seq` + 唯一索引；D6 本版不引入向量/BM25 |
| 2 | §5.1 历史键回填 | **执行**（旧键截前 3 段；涉及 687/688/689，回填清单先落 `tmp/kb-remediation/T1/`） |
| 3 | §6.4 前端契约 | **同步派给前端仓库**（禁用条件改 `canProposeAtoms`；展示 `functionIdCandidates`） |
| 4 | §2 Out 两项 | 确认本版不做：段落级锚点、湿测判定词扩项 |
| 5 | D3（Python 召回改调 HTTP） | 不做；先共享金样例（Task 7） |
| 6 | D4（上传中间件） | **复用现成** `multer ^2.2.0` + `src/http/upload-xlsx.js`，不新增依赖 |
| 7 | D5（已晋升 drafts） | 打 `promotedAt` 标记，保留存档（不移文件） |

实施按 plan Task 0 → 各线推进；每个 Task 交付后由 reviewer 按 plan 的 Reviewer Checklist 复核。
