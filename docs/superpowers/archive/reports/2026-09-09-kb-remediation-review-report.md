# KB 链路加固验收报告（实施方 → reviewer）

> 日期：2026-09-09（实施 2026-09-08 晚）
> 线：KB 链路加固（切片 / 存储 / 召回 / 草稿交易），spec [`specs/2026-09-08-kb-remediation-design.md`](../specs/2026-09-08-kb-remediation-design.md)（状态已标「已实施」）+ plan [`plans/2026-09-08-kb-remediation.md`](../plans/2026-09-08-kb-remediation.md)
> 实施方：ZCode KB 加固线（主会话连续执行，无子智能体改文件）
> commit 区间：**`fb9f3a5b..bb8c274a`**（开工声明与 spec/plan 携带入库 → 收尾 docs，实现 15 笔）
> 请求：按 plan「Reviewer Checklist」出具 `PASS` / `FAIL`（附复现命令）/ `DONE_WITH_CONCERNS`（写明 concerns）。本报告是导航索引，不替代 diff 与复跑。

## 1. 任务交付与 commit 对照

| Task | commit | 核心变更 | DoD 关键期望 | 证据 |
|---|---|---|---|---|
| 0 门禁修复 | `38142025` | kb-staging/kb-promote 移到 ALL GREEN 横幅前 | 故意失败时整体 exit=1 | `tmp/kb-remediation/D0/gate-selfproof-fail.txt`（末行 exit=1） |
| 1 稳定 atomKey | `9ca808f3` | `buildAtomKey` 去 title（3 段键）；回填迁移 `20260908231500` | 两次 propose 键集合相同 | `T1/probe-atomkey.mjs`、`T1/backfill-rows.json`（dev 库 0 行存量=no-op） |
| 2 幂等+唯一索引 | `55bce80c` | 查重去 draft 限定；force 走 `req_atom_seq+1`；`ER_DUP_ENTRY`→skipped；迁移 `20260908233000` | 真库同键 seq=0 被拒 | `T2/verify-unique-out.txt`（dup-rejected=true） |
| 9 validate+审计 | `e04c72ec` | 抽 `validateCommitAtoms` 共用；`POST …/draft-traj/validate`；paasUserId 透传 | problems≡skipped | `T9/verify-all.txt`；pin「validate problems match commit skipped」 |
| 3 缓存加固 | `f09635e7` | cacheVersion=1+sourceHash/inputHash+tmp/rename 原子写；commit 侧 `STALE_PROPOSE_CACHE`；.gitignore | check-ignore 命中；改链 commit 4xx | `T3/probe-out.txt`、`T3/verify-all.txt` |
| 4 propose 4xx | `712e40fd` | 散文体→400 "no parseable step table"；chainIds 空匹配→400 附可用链 | 真实 HTTP 4xx | `T4/archive-propose.json`、`T4/fake-chainids.json`（4098 隔离实例） |
| 8 functionId 候选 | `941b00b2` | `computeFunctionIdCandidates`（page_code>name_match>menu_path，≤3 条）；仅 suggestedFunctionId 为 null 时附 | product-mgmt ≥60% 有候选 | `T8/probe-candidates-out.txt`（28/28=100%；抽查 5 条合理） |
| 13 引用步+truncated | `4e13dd98` | `REF_STEP_RE`→rejected reference_step；`kind`；截断优先保留 write；`truncated{dropped,requestedMax}` | chain-b:4 不在 atoms | `T13/probe-out.txt`（b:4 与 c:2 均出局；maxAtoms:3 dropped=23） |
| 6 召回重写 | `359809cb` | bigram+码整词+语义词典最长匹配（消费去重）；`idf×len`+相对阈值 0.25；极性消歧；provenance 具名权重+章节 mtime+size 缓存 | 金样例全命中；800 字<200ms | `T6/probe-recall-out4.txt`（24/24；2ms，基线 654ms） |
| 7 跨语言契约 | `4cf1827f` | fixture `fixtures/kb-recall-golden.json`（24 条）；py 侧断言 pyFlowRef；AGENTS.md 补唯一跨语言契约 | 两侧 flowRef 一致或登记分歧 | `T7/py-golden-probe.py`（py 19/24 直配+5 条 divergenceAccepted） |
| 5 出处锚点 | `f6f34f54` | `resolveChapterRef`→`{ref, chunkId, sourceHash}`；commit 回查漂移→`stale_chapter_ref`；迁移 `20260908235000` | 改章节后 commit skip | `T5/verify-columns.out`（列已核）、pin「stale_chapter_ref」 |
| 10 观测 | `d967367b` | propose-runs.jsonl+recall-events.jsonl（py 侧同写，source:'py'）；`scripts/kb/propose-stats.mjs` | 连跑两次=2 行字段全 | `T10/verify-all.txt`、pin「observation lines」 |
| 11 source 上传 | `35a0fbe1` | `src/http/upload-file.js`（multer 复用）+落盘 source/+link.json 哈希；`loadSourceDoc` 副本优先、缺副本回退 | 上传后 propose sourceDoc=副本 | `T11/upload-resp.json`（一次性探针模块 kb-t11-probe 已删净） |
| 12 promotedAt | `dbe12376` | `--apply` 成功后草稿卡打 `promotedAt/promotedTo`，存档保留 | 已晋升卡带标记 | `T12/`（沙箱实证，真实 data/kb 未动） |
| 14 F-15 登记 | `4693e5cb` | todo ⑧′ 登记 readonly-partial 提案（只登记不实施） | — | todo-list ⑧′ |

收尾：`9caadef9`（agent-log 收工条目）、`bb8c274a`（spec 状态+todo 待办）。

## 2. 复跑入口（reviewer 独立执行用）

```bash
# 门禁（应 ALL GREEN）
bash scripts/refactor/verify-all.sh; echo exit=$?

# 门禁自证：临时把 verify-all.sh 中 characterize-kb-staging 指向不存在文件 → 整体 FAIL（exit=1），还原

# 五条基线
node scripts/characterization/characterize-req-draft-traj.mjs      # 期望 OK 52
node scripts/characterization/characterize-req-draft-fk-guard.mjs
node scripts/characterization/characterize-kb-req-modules.mjs
node scripts/characterization/characterize-flow-card-recall.mjs    # 期望 14 passed（含金样例+性能断言）
./python/python.exe scripts/characterization/characterize-kb-recall.py   # 期望 golden 24 entries, 5 accepted divergences

# 附录 A 探针（均在 tmp 副本/离线桩上跑，不碰真实 data/kb、不调 LLM）
node tmp/kb-remediation/T1/probe-atomkey.mjs        # A.1 改编：标题改写键不变
node tmp/kb-remediation/T3/probe-stale-cache.mjs    # A.2 loan-corp 副本 fallback+新格式缓存
node tmp/kb-remediation/T6/probe-recall.mjs         # A.3 金样例+800 字耗时
node tmp/kb-remediation/T13/probe-t13.mjs           # reference_step + truncated
node tmp/kb-remediation/final/probe-spec9.mjs       # product-mgmt 两次 propose 26/26 键全同
```

迁移状态：三笔已在 dev 库 apply（knex Batch 42/43/44），列/索引经 `SHOW COLUMNS`/`SHOW INDEX` 核实。**reviewer 若要求 down 往返实证**：dev 库 `req_*` 数据列当前无生产数据，可现场安全执行，实施方配合。

## 3. 主动披露（对照反作弊清单自查 + 自知弱点）

1. **金样例期望值方法论**：24 条中 8 条（spec §7.2 五条+F-07 三反例）是 spec 预先给定；其余 16 条是**以新算法在真实语料上的输出为期望**（pin 现状语义）。实现为通用算法、fixture 为外部数据文件，无任何 query 特判（可 diff `flow-card-recall.js` 证实）；但该 16 条证明的是确定性而非业务真值，可人工抽查语义对应（如 `押品估值`→`collateral_valuation`）。
2. **既有断言修改清单**（均为行为变更同步 pin，无恒真化/删除/跳过）：`resolveChapterRef` 两条 pin 改 `.ref` 形状（Task 5 返回值变更）；`characterize-flow-card-recall` 两个 commit 夹具补 through-chains.md+sourceHash（Task 3 缓存契约）；Task 2 新增「断言已去掉状态限定」pin 为 F-02 规定的行为方向。
3. **py 分歧护栏设计代价**：`characterize-kb-recall.py` 内 `assert diverged` 非空——防静默漂移，但未来 py 收敛、从 fixture 移除 `pyFlowRef` 时**须同步改这条断言**。候选 CONCERNS 项，接受修改建议。
4. **propose 真实 LLM 路径未湿测**：全程离线桩+4098 隔离实例（规避网关挂起、不烧执行机）；LLM 路径下 atomKey 稳定性只有确定性回退实证+单元 pin。
5. **夹具 `GOOD_ATOM.atomKey` 仍为旧 4 段形态**：seedCache 直写缓存不经 buildAtomKey，断言对象是 commit 行为非键格式（键格式另有 pin 与 api-docs 覆盖）。
6. **排障痕迹已还原**：Task 8 期间对 `config/database.js` 做过 getDB 插桩定位连接泄漏，`git diff` 干净可证；T11 探针模块与 4098 实例均已清理。
7. **lint**：改动文件现存 warning 全为存量（对比 HEAD 证实，新增 0）；`trajectory-dao.js` 存量 18 条属死代码清理线点名事项，未在本计划范围。

## 4. 遗留移交（均已在 agent-log 收工条目/todo 落盘）

- 前端派单（spec §6.4）：`canProposeAtoms` 门控+`functionIdCandidates` 下拉，Vue 仓另改；api-docs 契约已就绪。
- 服务器部署跑三笔迁移（233000 遇历史重复显式报错属设计，人工合并后重跑）。
- F-15 readonly-partial 待 Lead 批准（todo ⑧′）。
- py 召回 5 条分歧（F-07 三反例在内）以 divergenceAccepted 登记，收敛属 D3 另议。
- `data/kb/staging/recall-events.jsonl` py 侧运行期增长待观察。

—— 实施方 ZCode KB 加固线
