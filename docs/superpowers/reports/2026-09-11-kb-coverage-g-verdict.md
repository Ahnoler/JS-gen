# KB 覆盖回溯 — G1/G2/G3 结论（reviewer）

> 日期：2026-09-11 · 审查者：DSH reviewer
> 被审区间：**`ca4763b6..7b3f1fae`**（7 笔）
> 规格/计划：[`specs/2026-09-11-kb-coverage-retrospective-design.md`](../specs/2026-09-11-kb-coverage-retrospective-design.md) · [`plans/2026-09-11-kb-coverage-retrospective.md`](../plans/2026-09-11-kb-coverage-retrospective.md)
> 交付报告：[`reports/2026-09-11-kb-coverage-retro.md`](2026-09-11-kb-coverage-retro.md)
> **总判定：数据面与门禁通过；M5 线与报告三处口径/事实必须重做（D1/D2/D3/D8），门禁 floor 组合须调整（D4）。**

## 1. 三个 Gate

| Gate | 结果 |
|---|---|
| **G1 数据/脱敏** | fixture **501,636 B**、键集合严格落白名单（31 条键路径，无越界）；全量扫描 >40 字字符串仅 **3 条**且全为元数据（changeLog / redaction.forbidden / contentSha256）；`region_label` 最长 **38** 字，无客户名/证件号。**回库抽检 10 条**（每 40 条取一）：`functionId/recordStatus/pageId/phaseCount/stepCount` **全部一致**；`actionCounts` 聚合抽 3 条与库 `GROUP BY action_type` **逐型相等**；fixture 416 个 id 与库 **完全同集**（inter 416 / dbOnly 0 / fxOnly 0）。**轻问题 1 项（D5）** |
| **G2 纪律** | `src/**`、评测集、阈值、`verify-all.sh`、`data/kb/req/**` **零改动**（区间 diffstat 仅 8 个本线文件）；DB 仅 SELECT（脚本核对 `mysql2` 只读查询）；反作弊成立——`mapTrajectory` 只用 `pageId/urlCodes/resPath`，`task` 文本不参与匹配，`functionId` 仅出现在 `functionIdFacts`（fact 不作映射键）。**问题 2 项（D1 根因 / D6 观察）** |
| **G3 度量** | **M1/M2/M3/M4/M6 我逐位复现**：M1 **72/84=0.857**（12 张无码卡）、M2 **69/335=0.206**、M3 **27/84=0.321**（dead 57）、M4 **266** 条未映射、M6 **33/132=0.250**（stale 38）；链分布 **ZJJK 58 / FS 0 / ROUTE 58** —— 与报告完全一致。**门禁两侧证伪我都亲手跑了**：塞 `task` → `non-whitelisted data-area keys: traj.task` **红 exit 1**；`m5.nodeCoverage` 抬 +0.2 → **红 exit 1**；还原 → **3 passed exit 0**。**M5 及其结论不成立（D2/D3），报告 §4 头条建议是事实错误（D8）** |

## 2. 独立复算明细

| 项 | 报告值 | 我的实测 | 判 |
|---|---|---|---|
| M1 joinability | 0.857（72/84，12 无码卡） | 72/84 = 0.8571，无码卡 12 | ✓ |
| M2 coverage | 0.206（69/335） | 69/335 = 0.2060（eligible 345） | ✓ |
| M3 utilization | 0.321（27/84，57 死卡） | 27/84 = 0.3214，dead 57 | ✓ |
| M4 uncovered | 266 条 / 263 页 | 未映射 266 / 有 page_id 的 335 | ✓ |
| M6 freshness | 0.250（33/132，38 陈旧卡） | 33/132 = 0.250，staleCards 38 | ✓ |
| 链分布 | ZJJK 58 / FS 0 / ROUTE 58 | 同（FS 链确为 0） | ✓ |
| 歧义率 | 0.101（34 条多卡） | 34/335 ≈ 0.101 | ✓ |
| 门禁 | 3 passed；两侧可证伪 | 3 passed；两侧我自己跑红 | ✓ |
| 确定性 | 连跑两次逐位一致 | 我的复算与引擎输出同值；fixture contentSha256 `375329fd…` 与报告一致 | ✓ |

## 3. 发现清单

### D1（必改 · 根因）：快照的"40 字守卫"把 M5 的主键整段丢掉了

`coverage-snapshot.mjs` 的 `extractStructural()`（:84-102）对**结构键**也套用了自由文本上限：`if (s.length > 0 && s.length <= MAX_TEXT) return s; return null;`（`MAX_TEXT = 40`）。而 `page_level_key` 的实际取值形如
`page:http://test.creditv5p2.tansun.com.cn#/cstMgt/...` —— **库内长度 min 47 / max 135 / avg 91.6**，全部超限 → 一律返回 `null`。

后果链（我逐项验证）：`page_level_key` 在库里 **28 条轨迹 / 314 步**有值 → fixture 里 `visitedRegions[]` 共 **2408 条、非空 key = 0** → spec §4 给 M5 定的**主键（page_level_key）实际未参与计算**，只退化成 `region_label`。报告未披露这一点。

**修法**：结构键（`page_level_key`/`locator_scope` 等）免于 40 字守卫，且**只保留 `host#/route` 前缀、剥掉 query**（query 里才有业务值），或存路由路径的哈希；然后重冻 fixture 并重算 M5。

### D2（必改 · 结论）：M5 量的是"词表重合度"，不是"卡与实跑是否一致"

我做了上限分析（同一 matcher、逐轨迹取**最优卡**）：

| 量 | 值 |
|---|---|
| M5 实测 nodeCoverage | **0.1309** |
| 该 matcher 的**理论上限**（任意卡最优） | **0.1424**（池化 0.1520 = 366/2408） |
| 实测/上限 | **91.9%** |
| orderAgreement 实测 | **0.0117** = "精确字符串相等"的**上界**（已饱和） |
| 访问条目里通用区域名占比 | **47.5%**（主区 424 / 顶栏 353 / 侧栏 276 / 弹层 45 …） |

即：`region_label`（主区/表格/dialog/…）与卡 `nodes[].page`（待办任务页/审批页/…）**不是同一类词表**，M5 已经顶到结构上限，无法区分"agent 跑偏"与"两边词表不重合"。→ 报告 §1 的 M5 一句话解读与 §6.3「卡描述的节点序列与实跑路径系统性脱节」**必须改写**为："当前输入下 M5 不可解释为脱节证据；它测到的是标签词表重合 ≈14%（已近上限）"。

### D3（必改 · 实现与文档不符）：`primaryCard` 实为字母序，而非链优先级

引擎头注释（:11-13）写 "primaryCard = 最高优先级链（ZJJK > FS > ROUTE）的命中卡，同链取字母序"，但 `mapTrajectory` 返回的是 `[...hits.keys()].sort()`（纯字母序），`computeCoverage` 直接取 `cs[0]`（:213-214）。**我实测：69 条映射轨迹中 24 条（34.8%）的 `cs[0]` 不是最高优先级链的卡**。M5 因此可能拿一张**与页面码无关的卡**去做节点比对。

### D4（必改 · 门禁设计）：把 M5 两项设为 floor 会制造错误激励

`m5.nodeCoverage` / `m5.orderAgreement` 目前是 floor。由于这两个量的分子完全由**卡节点页名的用词**决定，只要把卡里 `nodes[].page` 改成与 region 标签一致（或反之）就能"提升"指标——**无意义的改动会被门禁奖励**。建议：M5 重建前把这两项从 floor 移出（改为 informational / 上限约束），floor 只留 M1/M2/M3（结构性、不可 gaming）。

### D8（必改 · 事实错误）：§4 的"最有价值的单点发现"不成立

报告 §4 写：「**对公客户评级申请**（6 条轨迹，最大真实缺口）…**补一个 marker 即可让 6 条真实录制接入覆盖体系**，是性价比最高的单一改动」。
**实测：这 6 条（id 597/598/599/600/601/604，入口页 `ZJJK00070599`）已经被映射** —— 卡 `rating.json` 的 `hash_markers` 含路由片段 `rtgMgt`/`cpctRtg`/`cpctRtgAplyMgtPg`，而该页 `res_path = /rtgMgt/cpctRtg/cpctRtgAplyMgtPg`，**ROUTE 链已全部命中**（我的复算 6/6 mapped，且 M4 的 266 条未映射清单里没有评级族）。**真实 Top 缺口**是：`智能控制执行日志列表 ZJJK00171540PDCP ×3`、`查询交易信息管理页 ZJJK00069541 ×2`，以及 18 条 AILZ 组件码（各 ×1）。
→ 这条建议会误导下一条线去"补一个不需要补的码"，必须删改。

### D5（轻 · 冻结资产健壮性）：`createdDate` 存成了 `"Wed Jul 22"`

`coverage-snapshot.mjs:134` 用 `String(r.created_at).slice(0, 10)` —— mysql2 默认返回 `Date` 对象，`String(Date)` 是 `"Wed Jul 22 2026 08:00:00 GMT+0800"`，切 10 位即 **无年份 + 随本机时区浮动**。后果：换机器/换时区重跑快照会得到不同 `createdDate` → **不同 `contentSha256`**，与"同一份数据同一份资产"的承诺冲突。修法：`toISOString().slice(0,10)` 或连接串加 `dateStrings: true`。不进任何指标，故列为轻。

### D6（观察）：ROUTE 链的泛化精度需在报告里标注

170 个路由片段里，最泛的 `lmtMgt`（→`limit` 卡）命中 **43** 个页面、`cstMgt`（→`customer_onboarding`）命中 **32** 个，共 **5 个片段命中 ≥10 页**。M2/M3 里由 ROUTE 贡献的 58 条轨迹中因此含一定比例的低精度归属（把"客户管理域任意页"记到"对公客户建档"卡上）。不是错误，但报告 §1 应给出该链的精度区间与这 5 个泛片段，供后续复核。

## 4. 裁定

| 项 | 判定 |
|---|---|
| 数据面（fixture 忠实性 + 脱敏） | **通过**（10 条回库一致、417→416 id 同集、白名单无越界）；D5 修完后重冻 |
| 纪律与边界 | **通过**（只读、零产品代码改动、反作弊成立） |
| M1/M2/M3/M4/M6 | **通过并已复现**——这四项是可信产出，可直接用于决策（"84 张卡只解释 20.6% 真实录制 / 27 张活卡 / 38 张带陈旧码"） |
| M5 及其结论 | **不通过**：D1 根因 + D2 饱和 + D3 实现漂移 → **M5 数字与 §6.3 结论作废**，重建后重出 |
| 报告可执行建议 | **D8 必须删改**（否则误导下一线）；真实 Top 缺口见上 |
| 门禁 | 形状/脱敏可证伪 **通过**；floor 组合 **须调整**（D4） |

**建议的 T5 小迭代（一 commit 一改，可回退）**：
1. 修 D1（结构键免守卫 + 剥 query）→ 重冻 fixture（`changeLog` 记版本）→ 修 D5 一并做；
2. 用 `page_level_key`（页面序列）重建 M5：与卡 `nodes[].page` 做**同类比较**（页面名/路由对页面名/路由），并保留"未映射页面"清单；
3. 修 D3（primaryCard 按链优先级取，注释与实现对齐）；
4. 调 D4（M5 重建前移出 floor）；
5. 改报告 §1 M5 行 / §4 头条 / §6.3 结论 + 补 D6 精度标注。

**线状态：PARTIAL（数据面可用，M5 作废待重建）。**

## 7. T5 迭代复核（2026-09-11 追加）——七项全关闭，新增 E1/E3 收口项

> 被审区间：**`ed2ef2cb..1060f61e`**（5 笔）· fixture **v1.1**（sha `33ad3e617280d07f…`，510,795 B）
> **结论：D1/D2/D3/D4/D5/D6/D8 全部按判决处置到位，我逐项独立复现；线判 PARTIAL→PASS（数据面+门禁），M5 v2 保持 informational。**

| 项 | 我的独立复核 | 判 |
|---|---|---|
| **D1** | fixture v1.1 中 `visitedRegions[].key` 非空 **110 条 / 28 条轨迹**（== 我此前的 DB 实测）；**回库验证：314 条原始 `page_level_key` 经其 `redactPageKey` 规则 reduce 后 314/314 落入 fixture key 集合，且 28/28 轨迹的 key 集合完全被覆盖**；key 中 `?` **0** 个、`%`/`=` 残留 **0** 个、`scheme/page:` 前缀 **0** 个；键路径仍严格白名单（39 条） | **关闭 ✓** |
| **D1 pin 可证伪** | 我把某条 key 污染成 `…?cstNm=%E6%B5%8B…` → 第 4 条 pin 红（`page keys must be query-stripped`）**exit 1**；还原 → **4 passed exit 0** | **真 pin ✓** |
| **D3** | `primaryCardOf()` 已按 `stemRank` 排序（ZJJK>FS>ROUTE）+ 字母序 tiebreak；`attribution.primaryCardMisaligned=24` 留档，与我实测的 24/69 一致；报告明确"只影响 M5 拿哪张卡算，M2/M3 为多标签计数不受影响"（正确） | **关闭 ✓** |
| **D2** | M5 已换同类比较（页面 key ↔ 卡 ROUTE marker），`orderAgreement` 废除换 `entryOnCardRate`，`ceiling` 随输出（=1.000）；旧 label 版结论已作废 | **关闭（口径见 E1）** |
| **D4** | 引擎 `--baseline` 与门禁 `FLOORS` 同步为 M1/M2/M3；baseline 增 `floorPolicy.{floors,margin,removed,removedReason}`；门禁打印 M5 INFO 行 | **关闭 ✓** |
| **D5** | `createdDate` 全部 `YYYY-MM-DD`（我抽样 416 条全为 ISO） | **关闭 ✓** |
| **D6** | §1 链分布段补 ROUTE 精度区间（5 片段 ≥10 页、`lmtMgt` 43 页/`cstMgt` 32 页；ROUTE 只作模块级归因） | **关闭 ✓** |
| **D8** | §4 评级族行已删、头条显式撤回并写明原因是"那 6 条早已 ROUTE 链 6/6 命中"；真实缺口改为 智能控制执行日志 ×3 / 查询交易信息 ×2 / 对私用信 ×2 / AILZ ×18；§6.2 同步订正 | **关闭 ✓** |
| 门禁 | **4 passed exit 0**；`m2.coverage` 抬 +0.2 → **红 exit 1**；还原 → 0。**M1/M2/M3/M4/M6 与重冻前逐位相同**（0.857 / 0.206 / 0.321 / 266 / 0.250）——重冻未引入度量漂移 | ✓ |
| 边界 | `src/**`、评测集、阈值、`verify-all.sh`、`data/kb/req/**` 零改动；一 Task 一 commit | ✓ |

### E1（必改 · 口径）：M5 v2 的 1.000 是**构造性饱和**，不是"小样本面事实"

实测：**18/18 条带 key 的轨迹都只有 1 个去重页面 key**（`key counts = [1×18]`）→ `nodeCoverage` **恒等于** `entryOnCardRate`（我逐条验证 18/18 相等），该度量在当前数据下**无法表达任何序列/覆盖信息**。且 18 条的 primaryCard **全部由 ZJJK 链命中**（rank 1），所以"卡的路由 marker 也覆盖入口页路由"是一句**薄但可证**的正向事实。

→ 报告 §1 M5 行「非 matcher 伪影」与 §6.3「这是『路由面卡片描述与实跑一致』的正向证据」应改为：**当前数据下 M5 v2 无判别力（恒等于入口页命中率）；可证的唯一结论是"18 条 ZJJK 命中的卡其 route marker 与入口页路由一致"**。另建议把 `m5.nodeCoverage` 更名为 `pageKeyOnCardRate`（"node" 会误导），或在 `metricNote` 写明退化条件。**纯文档/命名级修正，不动数字。**

### E3（轻 · 门禁）：fixture↔baseline 没锁死

baseline 里有 `fixtureSha256`，但门禁只断言 `fixture.contentSha256` 是 64 字符串，**没断言两者相等** → fixture 被静默替换不会被发现。加一行 `assert.equal(fixture.contentSha256, baseline.fixtureSha256)` 即可。

### E4（观察 · 体积）：旧 fixture 入库用途需注明

`tmp/kb-coverage/fixture-v1-archived.json`（≈500 KB / 21,684 行）已随 D1 修复入库，作为判决取证可以接受；建议在报告注明它是**取证快照、非门禁输入**，避免后人误当第二份 fixture。

**线状态：PASS（数据面 M1–M4/M6 + 门禁；M5 v2 informational）。** 收口只需一个 E-commit：E1 口径与命名、E3 一行断言、E4 一句注明。
