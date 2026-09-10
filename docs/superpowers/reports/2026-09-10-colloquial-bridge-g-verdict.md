# 口语桥接线 — G1/G2/G3 结论（reviewer）

> 日期：2026-09-10 · 审查者：DSH reviewer
> 被审区间：**`d41cb787..eec00a06`**（6 笔，一 Task 一 commit）
> 规格/计划：[`specs/2026-09-10-recall-colloquial-bridge-design.md`](../specs/2026-09-10-recall-colloquial-bridge-design.md) · [`plans/2026-09-10-recall-colloquial-bridge.md`](../plans/2026-09-10-recall-colloquial-bridge.md)
> 交付报告：[`reports/2026-09-10-colloquial-bridge-report.md`](2026-09-10-colloquial-bridge-report.md)
> **总判定：T3 FAIL 成立、未达标处置合规（跳过 T4 / 资产 archived / 本版不计成果）。**
> 附 **2 项必改**（均为文档口径与证据留存，**不改判决**）、1 项质量观察、1 项归档语义提醒。

## 1. 三个 Gate

| Gate | 结果 |
|---|---|
| **G1 资产** | 67 条**全部回原文复核**（我自写探针逐条读回源文件）：A **49/49** ✓（卡 JSON 内 alias/keyword 双侧命中，与 `evidence` 描述一致）、B **10/10** ✓（引文行确含「term（expand）」括号式替代）、C **8/8** ✓（引文行确为 `wording` 行且同时含 SUT/文档两侧字符串、叶号对得上）；**grounding 67/67** 可回溯 `T2-verified.json`（term+expand+sourceKind 三元组全等，0 条未接地）；**0 条来自评测失败**（与旧失败反推表 `data/kb/synonyms.json` 的 term 交集 **0**）；反作弊：E 层 50 条 query 中 table **term 命中 0 / expand 命中 0**，且无一条 expand 是 E 层 gold 卡名。**但发现口径错误 1 项（F-1）与裁决深度不足（F-3）** |
| **G2 纪律** | 建表三脚本 **零 import 召回/评测模块**（`build-colloquial-bridge.mjs` 只 import `node:fs`/`node:path`；`t2-verify.mjs` 同；`t2-build-table.mjs` 只 import `node:fs`）✓；**建表期零读评测文件**（源码内无任何 eval fixture 路径；评测集/失败清单在本区间零改动）✓；`data/kb/synonyms.json` **未复活未照抄**（status 仍 `unvalidated`，零改动）✓；门禁文件 / 阈值 / 评测集 / `verify-all.sh` / `data/kb/req/**` **零改动** ✓；**未接线**——`propose.js` 零改动（`grep colloquial\|synonyms` 无命中，区间 diffstat 无 `src/**`）✓；一 Task 一 commit、文件集与开工声明一致、**未携带他线 WIP** ✓。**唯一扣分：证据留存不完整（F-2）** |
| **G3 度量** | reviewer **独立复算**（不跑交付的 CLI，直接 import `runRecallEval` 自算）：OFF/ON 六项 + 分层 **与交付逐位一致**（0.600/0.725/0.653/0.667/拒答 0.382；A 1.00/B 0.400/C 0.900/D 0.900/E 0.100）✓；**提交物可复现**：`T3-off.json`/`T3-on.json` 与我的重跑**逐位相同**（除 `generatedAt`/`gitHead`/`corpusCards`/延迟计时）✓；**FP 34→34，新增 0 / 移除 0**，`negatives` 数组逐位不变 ✓；**门禁活门证伪**：`characterize-kb-recall-eval` 5 passed、`characterize-flow-card-recall` **26 passed**（3 条新 pin 全绿）、`--baseline` exit 0，我把 baseline 的 `accuracyAt1` 抬到 0.75（floor 0.70 > 实测 0.60）→ **exit 1**，还原 → exit 0 ✓ |

## 2. 独立复算明细

| 项 | 交付值 | 我的实测 | 判 |
|---|---|---|---|
| 候选池 | 409 = A 131 / B 255 / C 23 | `candidates.json` total 409，实际数组 409，三类计数同 | ✓ |
| 双向校验 | 183 = A 131 / B 39 / C 13 | `stats = {total 409, expandOk 183, termOk 409, both 183}`；verified 分类 131/39/13 | ✓ |
| 非子集单 expand | 44 = B 32 / C 12 | 池内重算 `term/expand 互不为子串且单 expand` = 44，分类 32/12 | ✓ |
| 落表 | 67 = A 49 / B 10 / C 8 | 表内计数一致 | ✓ |
| 配比 | A+B 88.1% / C 11.9% | 59/67 = 88.06%、8/67 = 11.94% | ✓ |
| 引文回原文 | —（交付称可回溯） | A 49/49、B 10/10、C 8/8 全部命中原文 | ✓ |
| OFF 指标 | 0.600/0.725/0.653/0.667/拒答 0.382 | 同（含分层 A1.00/B0.400/C0.900/D0.900/E0.100） | ✓ |
| ON 指标 | 与 OFF 逐位相同 | 同 | ✓ |
| 翻转（计功口径 = rank/ok 变） | 0（fresh-ground 0 < 4 FAIL） | **0**；仅 2 条 query 的 `top5` 尾部 5→3（A-015、C-013），`rank=1`/`ok=true` 不变 | ✓ |
| E 层 term 字面包含 | A 17/55、B 1/45、C 10/20、D 1/20、**E 0/50** | 逐位相同 | ✓ |
| 门禁 | 5 passed / 26 passed / `--baseline` exit 0 | 三项全部复现，且 `--baseline` 抬阈值可证伪 | ✓ |
| 接线 | 未接线（T4 跳过） | `propose.js` 零改动、全仓无 src 引用 | ✓ |

**reviewer 补强量化（交付未给）**：全表 67 条中，**27 条**的 term 能在 v2 某条 query 里字面出现；把条目**逐条单独注入**后，`(条目 × query)` 命中对共 **30 对**，其中 **17 对**确实改变了 `rankFlowCards` 返回对象（多为分数/尾部），**0 对**改变 gold 名次——与交付"机制点火但 top1 零翻转"的结论一致，且证明 ON 不是静默空跑。

## 3. 发现清单

### F-1（必改 · 口径）："A 类 131 条全是子串式" 是抽取规则的产物，不是语料事实

报告 §1/§2 把「A 类卡面候选**全部为子串式短长形**，无一对互不为子串」当作**三类素材的性质**来支撑结构性归因。核 `build-colloquial-bridge.mjs` `extractCardSynonyms()`：它**只在** `a.includes(k)` 或 `k.includes(a)` 时才产出候选——**物理上不可能产出非子串对**。这是一条自证结论。

我的独立普查（`data/kb/flows/*.json` 全量）：卡面内**非子串**且共享 ≥2 字的 **alias↔alias 对就有 438 对**（例：`退回上一步 | 退回指定步骤`、`审批处理 | 流程审批`、`待办任务 | 任务事项`、`委外清收登记 | 委外清收管理`）。

**影响**：结论不变（这些仍是"领域措辞↔领域措辞"，够不着口语层），但**证据句必须改**：正确表述是"A 源**按抽取规则**只取子串对（alias×keyword）"，而不是"卡面素材里没有非子串同义对"。
（附注：`keyword×keyword` 之间大量"对"本就不是同义——同行关键字是并列描述不是变体，所以 A 规则只配 `alias×keyword` 是**合理选择**；问题只出在陈述方式。）

### F-2（必改 · 证据留存）：报告指向的"逐条裁决理由"既不在版本库、也不存在于该文件

`tmp/kb-bridge/T2-bridge.txt:18` 与报告 §2 都写「裁决规则与**逐条理由**见 `tmp/kb-bridge/t2-build-table.mjs` 头注释」。实测两处都不成立：

1. `tmp/` 被 `.gitignore` 忽略（`:20`），本线只 `-f` 追了 **9 个 json/txt** 证据文件；`git ls-files tmp/kb-bridge` 不含 `t2-verify.mjs`、`t2-build-table.mjs`，`git log -- <两文件>` **计数 0** → 这两个脚本**零 git 历史**，clone 出去即消失；
2. 我读了 `t2-build-table.mjs` 头注释：里面是**汇总裁决原则**（剔纯句片段 / 过泛词 / 纯管理尾缀 / 状态短语 / 规则主页垃圾形），**没有逐条理由**；条目级信息只有 `FINAL` 手写清单 + grounding 断言（未接地即非零退出，这点做得对）。

**要求**：① 两个脚本 `git add -f`（或把规则+条目级取舍挪进受管控文件）；② 把"逐条理由"改为"汇总规则"，需要条目级辩护时用抽样复核记录补。

### F-3（质量观察 · 建议改口径）：B 侧括号抽取把"UI 位置/组件注释"当成了同义对

我逐条读回原文核了 B 类 10 条：**4 条真同义**（`拨款系数→拨款转换系数`、`数标→数据指标`、`产品要素管理→产品要素库`、`退回→打回`）；**6 条不是查询同义**，是位置/组件/动作注释——`征信结果→查看征信报告`（9.3 节名 vs 动作）、`流程跟踪信息主页→流程轨迹弹窗`、`弹审批意见窗→签署意见`、`影像信息→公共影像组件`、`组织管理→路由管理`、`引入客户→客户放大镜`。b2 规则只要求"括号串与原词共享 ≥2 字"，因此全部放行。

**影响**：本版为 **0**（零翻转、零新增 FP、已归档，且注入走 `SYNONYM_WEIGHT=0.5` 低权）。**但这是"增量 0"的一部分成因**——表里一半条目本来就不具备桥接能力。若将来复用此表，B 侧需收紧到"词法变体"（同头词/同尾词，或最长公共子串 ≥ 半长）。

配套口径：183 条候选的裁决发生在 **~7 分钟内**（T1 `3c802f3d` 23:24 → T2 `3ea6bab5` 23:31）。这与"逐条人工裁决"的描述不符，实际是**按规则批量裁决 + 快速人工过一遍**。建议如实写为"规则批量裁决 + 抽样复核"，避免下一次复用时高估该表的论证强度。

### F-4（归档语义提醒 · 不改判、需 Lead 决定是否加硬拦）

`loadSynonyms()`（`scripts/kb/recall-eval.mjs:305`）**不读 `status`**，所以 `status:"archived"` 是**文档性标记，不具强制力**：任何一行只要跑 `--synonyms data/kb/colloquial-bridge.json`，这 67 条仍全量生效（**我本次复算 ON 就是靠这一点**在归档后的工作区跑出来的）。与 P0 线 `unvalidated` 同口径，故**不算违规**。
**建议**：① 表内 `scopePolicy` 旁补一句「archived：不得接线，仅作续跑基线」；② 若要硬拦，需给 loader 加 `status` 过滤——**口径变更，须 Lead 批**（会同时影响 P0 线那张 `unvalidated` 表）。

## 4. 裁定

| 项 | 裁定 |
|---|---|
| T3 双判据 | **FAIL 成立**：E 层 Acc@1 0.100 < 0.25；全新地面增量 **0** < 4。两条我都独立复算过 |
| 未达标处置 | **合规**：跳过 T4、`propose.js` 零改动、表置 `archived`、报告写明"本版不计成果、不接受接近达标" —— 与计划未达标路径逐条对上 |
| 护栏面 | **全绿且我复核过**：A 1.00 / B 0.400 / C 0.900 / D 0.900 不掉；拒答 0.382 不变；FP 34→34 零新增；三条新 pin 是可证伪的真 pin（scope 不匹配 → 分数逐位相同；匹配 → 分数上升） |
| 方向 5 净结论 | **采纳**：「词面桥接」已被两套方法证尽——失败反推（泛化 1/115）与语料正向建表（增量 0/245），E 层 0/50 字面重叠是**构造性**的，不是调参问题 |
| E 层后续路径 | **采纳报告两条**：① 回收口语语料（生产轨迹 LLM 意图描述 → query 侧口语）；② embedding 立项（Lead 决策项不变）。**两条都需要 Lead 先定边界**，不在本线范围 |
| 本版成果 | **不计成果**（reviewer 确认）。产出价值 = 反证 + 3 条永久 pin + 归档资产 |

**必改项（可在收尾 commit 一次做完）**：F-1 修正口径表述；F-2 `git add -f` 两个脚本（或迁规则）+ 改"逐条理由"措辞；F-3 记录 B 侧规则收紧与裁决方式口径（可并入 F-1 同段）。
**待 Lead 决策**：F-4（loader 是否加 `status` 硬拦）；embedding 立项边界。

**线状态：CLOSED（FAIL，不计成果）。** 判决与交付自评一致，无需返工；上述必改项是文档与证据耐久性修正，不触及结论。

## 5. 收尾增量复核（2026-09-10 追加）

> 收尾区间：**`598df438`**（落实 4 文件）+ **`5e3fde12`**（agent-log 回执）
> **增量裁定：判决维持 FAIL、不计成果；F-1 / F-3 / F-4 关闭；F-2 半落地（保持 OPEN）；新增 F-5（轻必改）。**

| # | 逐项对账 | 复核结果 |
|---|---|---|
| F-1 | 报告 §1/§2 改为「A 源**按抽取规则**只取子串对」，登记 438 对普查事实，结论不变 | **关闭 ✓** 措辞与我的普查一致，结论未被稀释 |
| F-2 | ①两脚本 `git add -f` 入库 ②§2 + `T2-bridge.txt` 指向改「汇总原则」 | **①关闭 ✓**（`git ls-files` 已含两脚本，import 面仍只有 `node:fs`/`node:path`）；**②半落地 ✗**——见下 |
| F-3 | 报告 §2 如实登记「规则批量 + 快速人工 ~7 分钟」与 B 类 4/10 真词义、6 条注释性关系 | **关闭 ✓** 与我的发现逐条对齐 |
| F-4 | 表内补 `archivedSemantics` 注记，loader 零改动，留 Lead | **关闭 ✓** `entries` 逐位未变（sha `eb4ec272…`，67 条），新字段对 `loadSynonyms` 与 pin 无影响 |

### F-2 ② 半落地（保持 OPEN）

`598df438` 的 diffstat 只有 4 个文件（表 / 报告 / 两脚本），**`tmp/kb-bridge/T2-bridge.txt` 不在其中**：`git status` 显示它仍是 ` M`，`git show HEAD:tmp/kb-bridge/T2-bridge.txt` 仍是旧文本「裁决规则与**逐条理由**见 t2-build-table.mjs 头注释」。即：**修正只存在于工作区，HEAD 里的悬空指向没修掉**，而报告 §8 台账的 F-2 行已写「§2 与 `T2-bridge.txt` 指向改为汇总原则」——陈述与 HEAD 不符。
差一步：`git add -f tmp/kb-bridge/T2-bridge.txt`（工作区那处改动就是 `note` 一行，+1/−1，与生成脚本 :155 的新 note 一致，产物与脚本自洽）。

### F-5（新增 · 轻必改）：已入库的生成脚本会把归档资产静默还原

`t2-build-table.mjs` 现在在库里，其产物字面量为 `status: 'candidate'`，且**不含** `archiveNote` / `archivedSemantics`；脚本头还写着常规用法 `Run: node tmp/kb-bridge/t2-build-table.mjs`。**任何人按头注释重跑一次，`data/kb/colloquial-bridge.json` 会被覆盖回 `candidate` 并抹掉 F-4 注记**（同时把 `.txt` 一起重写）。这正是 F-2 想消除的"文档与产物不一致"，只是方向反了过来。

**修法（二选一，都只是一行级改动）**：① 脚本产物对齐归档态（`status: 'archived'` + 两个注记字段），使重跑成为幂等 no-op；② 或在脚本头加显式警示（「重跑会重置归档态与 F-4 注记，勿为再生成 .txt 而运行」）。**在此之前不要为了提交那个 .txt 去跑脚本**——直接 `git add -f` 即可。

### 本次复核同时通过（不再挂账）

- 表 `entries` **逐位未变**（`sha256 eb4ec272…`，67 条，与 `3ea6bab5` 完全相同）→ **T3 度量不受影响，无需重跑**（我仍复核了 off/on 数字口径：0.600/0.725/0.653/0.667/拒答 0.382、E 0.100 的**唯一**改动面只有新增注记字段）。
- 改后 `characterize-flow-card-recall` 我复跑 **26 passed / exit 0** ✓。
- `5e3fde12`：agent-log 回执为 **+6 行纯新增**，插在 Cursor Lead 的 23:42/23:44 条目**之下**、本会话 23:32 条目**之上**，未删改他线条目 ✓；两笔 commit **均未携带他线 WIP** ✓。

**收尾要求（一个 commit 即可关线）**：① `git add -f tmp/kb-bridge/T2-bridge.txt`；② 按 F-5 二选一改 `t2-build-table.mjs`（推荐①幂等对齐）；③ 若②选了幂等对齐，顺手在报告 §8 F-2 行补一句「`.txt` 于 `<hash>` 入库」以对齐陈述。**无需重跑任何门禁、无需重跑 T3**。
