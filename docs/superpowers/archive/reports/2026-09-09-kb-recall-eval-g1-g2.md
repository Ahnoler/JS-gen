# KB 召回评测常态化 — G1 / G2 结论（reviewer）

> 日期：2026-09-09 · 审查者：DSH reviewer
> 被审区间：`55a558ab..f67d89f2`（7 commits）
> 规格/计划：[`specs/2026-09-09-kb-recall-eval-design.md`](../specs/2026-09-09-kb-recall-eval-design.md) / [`plans/2026-09-09-kb-recall-eval.md`](../plans/2026-09-09-kb-recall-eval.md)
> 结论：**G1 PASS** · **G2 PASS（无条件批准阈值提案，T4 可写入）**

## 0. 交付物范围核对

逐笔 `git show --stat` 复核 7 笔：文件集全部落在声明范围内（agent-log / fixture+spec / flow-card-recall+pin / runner / py / report / docs 收尾），**无越界改动**。
（注：区间 diff `55a558ab~1..f67d89f2` 会混入他线提交，不能作为范围判据——须逐笔看。）

## 1. G1：评测集独立抽检 —— **PASS**

**方法**：从 130 条按层抽 15 条（A3/B3/C3/D3/N3 + 全部 4 条 multi-gold）；**先只打印 query 不给 gold**；reviewer 只用 `data/kb/flows` 语料词表做纯 grep 自判（**未运行匹配器**）；判完再揭晓比对。

**结果：15/15 一致，0 分歧**（门禁：分歧 <2/15）。
其中 4 条（A-001 / A-014 / B-001 / N-001）是 reviewer 上轮 hold-out 种子，**不具检验力**；真正有检验力的是 **11 条团队新标，11/11 一致**。

| 项 | 结果 |
|---|---|
| 结构 | 130 条 = A40/B30/C15/D15/N30；覆盖 **62 卡**（≥50）；单卡 **≤3**（≤4）；query 无重复 |
| excluded 4 条 | **均为真歧义**且附语料实证（「征信」存在于 customer_360/rating 词表；「签合同」三卡可辩护；「查额度」两卡重叠；「客户管理」命中菜单层）——非滥用 |
| 陈旧 gold | **0**（全部 stem 在语料中存在） |
| FP 靶子 | N-002「计算 2 加 3 等于多少」在位，`whyNegative` 说明正确 |
| gold 反推迹象 | 无（15/15 独立复核一致，且团队另附盲态子智能体 15/15 记录） |

## 2. G2：阈值提案审查 —— **PASS（无条件批准）**

**算术**：`0.650−0.05=0.600 / 0.757−0.05=0.707 / 0.694−0.08=0.614 / 0.708−0.08=0.628 / 0.633−0.05=0.583 / 0.650−0.10=0.550` —— 与 spec §6 的 D11 余量上限**完全一致**。

**逻辑**：`compareWithBaseline`（`recall-eval.mjs:219-238`）为 `ok = current >= baseline − margin`，**比较方向正确**；延迟预算 `warmP95≤50ms / coldP95≤200ms` 一并强制。

**确定性论证**：评测集冻结 + 语料冻结 + 匹配器确定性 ⇒ **无运行间噪声**，假红风险≈0；余量仅覆盖「有意变更」的头部空间 ⇒ 作为**防回归下限**合理。

**reviewer 独立复核的 `--baseline` 双向验收**（团队声明，现已由 reviewer 亲自复现）：

| 用例 | 期望 | 实测 |
|---|---|---|
| v1 对自身基线 `baseline-v1.json` | exit 0 | **exit 0**，六项 OK（floor 0.600/0.707/0.614/0.628/0.583/0.550） |
| v1 对 hold-out 基线 `baseline.json` | exit 1 | **exit 1**，六项全 FAIL（floor 0.85/0.95/0.862/0.877/0.85/0.8） |

### ⚠️ 重要更正（撤回上一轮结论）

上一轮 review 曾把 `recall-eval.mjs:293` 的 `execSync('git rev-parse --short HEAD')` 列为 **「必改 · 阻断 T4」**，依据是当时 runner 以 exit=2 失败并报 `spawnSync ... EPERM`。
**该结论作废**：经复核，失败原因是我方审查环境的进程沙箱（禁止 spawn/piped stdio），**不是实现缺陷**。在放开沙箱后同一命令 `exit=0`，`--json` 正常产出 35KB 指标 JSON。团队**无需**为此改动代码。
（可选加固，非必须：把 `execSync` 包 try/catch 并回落 `gitHead: null`，可让 runner 在无 git 的容器里也能跑。）

## 3. reviewer 独立复现 vs 团队声明

| 指标 | 团队声明 | reviewer 实测 | 判定 |
|---|---|---|---|
| Acc@1 / Wilson 95% | 0.650 / [0.553, 0.736] | **0.650 / [0.553, 0.736]** | 精确一致 |
| MRR@5 / 拒答率 | 0.694 / 0.633 | **0.694 / 0.633** | 精确一致 |
| Recall@5 / nDCG@5 | 0.757 / 0.708 | 0.760 / 0.711（**二值口径**） | 口径差 0.003，见下 |
| 分层 Acc@1 | A1.00 / C0.87 / D0.33 / B0.23 | **同左** | 精确一致 |
| 噪声 Δ | 0.000 | **0.000** | 一致 |
| 失败条目数 | 35 | **35**（id 逐一核对一致） | 一致 |
| hold-out 探针 | 6/6 MATCH | **6/6 MATCH**（MRR 0.942 / nDCG 0.957 / 拒答 0.9 / 噪声 0.9） | 一致 |
| `matchFlowForAtom` 不变量 | 语义不变 | **130/130 与 `rankFlowCards(k=1)` 零差异** | 一致 |
| `characterize-flow-card-recall` | 17 passed | **17 passed** | 一致 |
| py 契约 + 一致率 | 24 条 + 62/100 | **24 entries, 5 divergences + 62/100 (62%)** | 一致 |
| T4 冻结纪律 | 未写入 | `characterize-kb-recall-eval.mjs` 不存在；`verify-all.sh` 无新行 | 一致 |

**口径提示（非阻塞）**：`Recall@5 / nDCG@5` 在多 gold 条目上存在「分摊 vs 二值」两种合理口径（差 0.003）。建议把该口径写进 runner JSDoc 与阈值文档，避免未来基线静默漂移。

## 4. 门禁现状（reviewer 实跑全量）

`bash scripts/refactor/verify-all.sh` → **FAILED，exit=1，5 条红**，与本线**零耦合**（对 5 个脚本 grep `kb-|recall|flow-card|req-draft` **零命中**）：

| 红套件 | 失败原因 | 归属 |
|---|---|---|
| `characterize-step-highlight` | `screenshotId=null must be 10615`（DB 数据依赖） | 引擎线 |
| `characterize-layer-tree` | `traj 33 存在有步骤的 phase_highlight 截图`（DB 数据） | 引擎线 |
| `characterize-export-v3` | 模块内抛异常（`.mjs:487`） | 存量 |
| `characterize-confirm-notification` | 源码 pin `all markers present` 失败 | 他线 WIP |
| `characterize-network-capture` | **单跑 OK 5**，门禁内偶发（python 探针环境） | 环境 |

> 与团队报告的「7 红」不一致：`fill/select/stc/capture-element-xpath` 本轮已绿，另两条新红。**红集随他线 WIP 与 DB 数据漂移**——属工程稳定性问题，建议 Lead 单独立项，不计入本线。

**KB 相关套件全绿**：`characterize-req-draft-traj` OK 63 / `fk-guard` 11/11 / `kb-req-modules` OK 11 / `flow-card-recall` 17 passed / py 契约 ok。

## 5. 对 0.650 vs 0.90 的定性（reviewer 背书）

**不是回归**：算法未动，reviewer 的 20 条 hold-out 仍 6/6 MATCH（Acc@1 0.90）。v1 按配额纳入 B 层纯改写与 D 层 ASCII 短码后，把「同义词鸿沟、camelCase 别名不进分词」这类**存量缺口第一次量化**——这正是旧 24 条（16/24 自证）看不到的价值。35 条失败清单可直接作为算法线（方向 5：混合检索）的目标列表。

## 6. 放行与遗留

- **G2 放行**：T4 可执行（阈值写入 + 新 characterization + `verify-all.sh` 只追加一行独立 commit + 阈值 +0.2 必红自证）。
- 遗留移交 Lead：
  1. 红集漂移（他线 WIP / DB 数据 / 门禁环境）——另立项；
  2. 并行线「flow-card-guided-propose」开工未写 agent-log 条目，其 WIP 曾使 `characterize-req-draft-traj` 短暂红（现 OK 63）；该线若改 `flow-card-recall.js` 须以 `5acbbbe4` 的 `rankFlowCards` 为基线；
  3. 阈值余量口径（多 gold 分摊 vs 二值）建议写入文档。
- **G3**：T4 完成后由 reviewer 按 plan 的 Reviewer Checklist 出终局结论。
