# KB 加固验收结论（reviewer → Lead）

> 日期：2026-09-09
> 审查者：DSH reviewer（验收 + 修复收尾）
> 被审区间：`fb9f3a5b..bb8c274a`（17 笔：15 实现 + 收尾 docs）
> 验收方式：plan §Reviewer Checklist（读 diff 不读自述 → 复跑 DoD → 独立探针 → 反作弊 → 判定）
> **最终结论：PASS（复验后）** — 初次验收为 **DONE_WITH_CONCERNS**（3 必须修复 + 4 登记风险），修复 commit 后复验全绿。

## 1. 结论

| 阶段 | 结论 |
|---|---|
| 初次验收（实施方交付态） | **DONE_WITH_CONCERNS**：功能全部达成、无任何反作弊触发；3 项必须修复（含 1 项实施方自查结论有误）+ 4 项登记风险 |
| 修复后复验（本文件） | **PASS**：3 项必须修复已闭环（2 项登记风险顺带修复），门禁/基线/lint 全绿 |

## 2. 我独立执行的验证（不采信自述）

| 验证 | 命令 / 手段 | 结果 |
|---|---|---|
| 全量门禁 | `bash scripts/refactor/verify-all.sh`（Git Bash；沙箱禁命名管道 → 升级沙箱重试） | **ALL GREEN，exit=0**；`characterize-kb-staging` / `-promote` 已在绿色横幅**之前**执行并通过（F-14 修复生效） |
| 五条基线 | 逐条自跑 | req-draft-traj **OK 53** / fk-guard **11/11** / kb-req-modules **OK 11** / flow-card-recall **15 passed** / py golden **24 entries, 5 divergences** |
| 迁移落库 | 自写 DB 探针（`config/database.js` getDB） | Batch **42/43/44** 已 apply；`req_atom_seq:int NOT NULL`、`req_source_hash:varchar(64)`、`req_chunk_id:varchar(191)` 就位；唯一索引 `traj_req_atom_uq` 三列皆 unique；`LEGACY_KEYS=0`、`DUP_ROWS=[]` |
| 行为探针 | `tmp/review-probe.mjs`（tmp 副本，不写库、不调 LLM） | atomKey 3 段且无 title ✓；fakeLLM/fallback 两路径键稳定 ✓；缓存 `cacheVersion=1`+64 位 `sourceHash` ✓；改链 commit → `STALE_PROPOSE_CACHE` ✓；改章节 commit → `skipped: stale_chapter_ref` ✓；archive → `400 no parseable step table` ✓；假 chainIds → `400 + 可用链清单` ✓；`maxAtoms:3 → truncated{dropped:23}` ✓；`chain-b:4`/`chain-c:2` → `reference_step` 且不进 atoms ✓ |
| lint 归因 | `npm run lint` + 逐条 `git blame -L n,n` 判定是否落在被审区间 | 初次：**3 条为本次新增**（F-A）；修复后全仓 **68 → 65 warnings / 0 errors**，本文件仅剩 4 条存量 |

## 3. 三处重点复核（Lead 指定）

### ① 召回金样例（24 条）——通过，含 1 处文案更正

- **语义抽查**：逐条打印 `query → 期望 stem → 卡 flow 名`，24/24 语义合理（`押品估值→押品估值管理`、`引入保证人→引入保证人`、`委托支付→受托支付发起与变更`、`客户360视图→客户360视图`…）；期望 stem 全部存在，`expectNodeId` 均存在于对应卡节点。
- **无 query 特判**：通读 `flow-card-recall.js`——语义词典由**卡片** vocabulary 构建，打分为 `idf×len` + 相对覆盖率 0.25；实现内仅有的中文常量是 `启用/禁用/下架`（spec §7.2 明令的极性消歧）。全仓实现文件对金样例 query 零命中（唯一命中是注释）。
- **计数更正**：报告称「8 条 spec 给定」，实为 **5 条**（spec §7.2）＋F-07 三反例（与其中 3 条重叠）；自 pin 实为 18–19 条。
- **文案更正（已修）**：第 3 条 note 原称「customer_360/customer_corp 系列卡在真实语料中不存在」不实——`customer_360` 存在（同 fixture 第 13 条即用它）；真实理由为「它是只读视图、无『客户信息维护』词条」。期望值本身可辩护。

### ② 既有断言修改（4 处）——通过

`git diff … -- scripts/characterization/ | grep '^-'` 仅 **14 行删除**，全部为行为变更同步：3 处 `writeProposeCache(...)` 旧签名（新增 `sourceHash`）、1 处 `assert.ok(chapter && /chapters\//)` → `.ref`、2 处 `/03-配置产品信息/` 改 `.ref`。**无 `assert.ok(true)`、无 `.skip`、无提前 `process.exit(0)`、无整块删除**。新增方向更强：chunkId 稳定 + sourceHash 内容绑定、validate≡commit skipped、`ER_DUP_ENTRY`→skipped；夹具 `seedFlowCommitCache` 由直写缓存升级为「写真实 through-chains.md + 计算 sourceHash」。

### ③ 迁移——通过（down 往返未执行，理由见 §5 R-1）

up/down 成对、`hasColumn` 守卫、唯一索引前有重复预检（重复则**显式抛错并输出行**）、回填迁移头部注明不可逆。落库状态见 §2。

## 4. 反作弊清单（逐项）

| 条目 | 结论 |
|---|---|
| 断言恒真化 / 删除 / 跳过 | 未触发 ✓ |
| 用 `force:true` 冒充幂等修复 | 未触发 ✓（唯一索引 + seq 真改） |
| 手改 `.draft-traj-propose.json` / `data/kb/flows/**` | 未触发 ✓（被审区间 28 个改动文件中无 `data/`） |
| 召回对金样例 query 特判 | 未触发 ✓ |
| 迁移 `down` 缺失 | 未触发 ✓ |
| api-docs 未同步 | 接口面已同步 ✓；实体列原缺登记 → 已补（R-4） |
| 越界改动他线文件 | 未触发 ✓（`config/` 零改动，仪表化已还原） |

## 5. 发现的问题与处置

### 已修复（本轮）

| ID | 问题 | 处置 |
|---|---|---|
| **F-A** | 引入 3 条新 lint warning（`flow-card-recall.js` 的 `normFlowName`/`corpusProfile` JSDoc），违反 R3，且实施方自查称「新增 0」 | 补 `@param`/`@returns` 描述；全仓 68→65，本文件仅剩存量 4 条 |
| **F-B** | 观测落盘硬编码 `<repo>/data/kb/staging`，无隔离 → 被测试/夹具污染（`propose-runs.jsonl` 201 行中 192 行 `demo-mod`；`recall-events.jsonl` 312 行中 308 行 `js`） | `propose.js` 改为 `observeDir()` + `KB_STAGING_DIR` 覆盖；两个 JS 套件设隔离目录并加 pin（断言仓库文件 mtime 不变）；清理测试行（**保留 4 条真实 py 召回**，原件归档 `tmp/review-observability-archive/`） |
| **F-C** | `matchFlowForAtom` JSDoc 承诺 `score` 但成功路径不返回 | 成功路径返回 `score`；补 pin（命中为 number>0，未命中为 null） |
| **F-D** | 金样例第 3 条 note 事实错误 | 更正为「customer_360 存在但为只读视图、无该词条」 |
| **R-3** | py 侧 `assert diverged` 绊线：py 收敛并清理 fixture 后**反而失败** | 改为「不得存在已收敛却仍登记的分歧」——收敛后自然通过，漏删才失败 |
| **R-4** | `reqSourceHash`/`reqChunkId`/`reqAtomSeq` 等出处列未入 api-docs | trajectory 详情 `desc` 补齐 9 个出处列语义与 `stale_chapter_ref` 关系 |

### 遗留（登记，不阻塞）

| ID | 风险 | 说明 |
|---|---|---|
| R-1 | 生产库迁移演练 | dev 库 `LEGACY_KEYS=0`，回填与唯一索引的**联合路径未行使**；若生产存在 F-01 漂移（同 chain/step 两个旧键），`233000` 会在重复预检处按设计中止并要求人工合并。**down 往返未执行**：三笔已 apply 且有唯一索引/列变更，dev 库虽无 req 数据但回滚会波及他线在用表，收益低于风险 |
| R-2 | 真实 LLM 路径未湿测 | atomKey 稳定性仅有确定性回退 + 单测 pin 覆盖（实施方已披露） |
| R-5 | 前端 §6.4 派单未做 | `canProposeAtoms` 门控 + `functionIdCandidates` 下拉，Vue 仓另改；api-docs 契约已就绪 |

## 6. 复验命令清单（可独立重跑）

```bash
bash scripts/refactor/verify-all.sh; echo exit=$?          # 期望 ALL GREEN / exit=0
npm run lint 2>&1 | Select-Object -Last 2                   # 期望 0 errors, 65 warnings
node scripts/characterization/characterize-req-draft-traj.mjs   # 期望 OK 53
node scripts/characterization/characterize-flow-card-recall.mjs # 期望 15 passed
node scripts/characterization/characterize-req-draft-fk-guard.mjs
node scripts/characterization/characterize-kb-req-modules.mjs
./python/python.exe scripts/characterization/characterize-kb-recall.py  # 期望 24 entries, 5 divergences
$env:KB_STAGING_DIR='tmp/review-observe'; node tmp/review-probe.mjs     # 行为探针（不写仓库）
```

## 7. 附：本次验收未改动的边界

- 未改任何 `data/kb/req/**`、`data/kb/flows/**` 语料；未调用 `prepare`/`record/start`/`detach`。
- 未提交他线 WIP（`config/update-db-whitelist.ps1`、`.cursor/` 保持原样）。
- 观测清理保留真实运行数据：`recall-events.jsonl` 现仅 4 条 py 实况召回。
