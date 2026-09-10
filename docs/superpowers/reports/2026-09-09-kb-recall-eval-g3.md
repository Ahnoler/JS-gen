# KB 召回评测常态化 — G3 终局结论（reviewer）

> 日期：2026-09-09 · 审查者：DSH reviewer
> 被审区间：**T4 交付 `62aa956f..a197f77e`**（5 commits），承接 `55a558ab..f67d89f2`（T0–T7）
> 计划：[`plans/2026-09-09-kb-recall-eval.md`](../plans/2026-09-09-kb-recall-eval.md) · 规格：[`specs/2026-09-09-kb-recall-eval-design.md`](../specs/2026-09-09-kb-recall-eval-design.md)
> 前序：G1/G2 见 [`reports/2026-09-09-kb-recall-eval-g1-g2.md`](./2026-09-09-kb-recall-eval-g1-g2.md)
> **最终结论：PASS**

## 1. Reviewer Checklist 逐项

| 检查 | 结果 |
|---|---|
| **读 diff 不读自述** | 5 笔逐笔 `git show --stat`：范围合规（agent-log / 门禁套件 / verify-all **恰好 1 行**独立 commit / 三条建议 / 报告收尾）。门禁套件 136 行逐行读毕 |
| **复跑 DoD 矩阵** | `characterize-kb-recall-eval` **4 passed, exit 0**（单跑 + 全量门禁内均 ok）；`flow-card-recall` **17 passed**；`req-draft-traj` **OK 63**；`kb-req-modules` OK 11；py **24 契约 + agreement 62/100** |
| **独立抽检 gold** | 沿用 G1：15 条盲判 **15/15 一致**（其中 11 条团队新标全对）；T4 后再次核验评测集内容未变（见 §4），结论仍有效 |
| **门禁自证（reviewer 亲手）** | 见 §2，三态全部符合预期 |
| **反作弊六项** | 逐项见 §3，**无一项触发** |

## 2. reviewer 亲手门禁自证（未采信实施方 selfproof）

对 `scripts/characterization/characterize-kb-recall-eval.mjs` 现场改动 → 运行 → `git checkout` 还原：

| 步骤 | 操作 | 实测 |
|---|---|---|
| **A** | 仅把 `APPROVED.accuracyAt1` 0.6 → 0.8（模拟"只抬阈值"） | **exit 1**，被 **lockstep 绊线**拦下：`✗ gate margins stay in lockstep with runner DEFAULT_MARGINS` |
| **B** | 同时位移绊线字面量 0.65 → 0.85（模拟"完整篡改"） | **exit 1**，被 **floor 断言**拦下：`✗ approved metric floors hold … metrics below approved floors: accuracyAt1` |
| **C** | 还原 | **exit 0**，工作区干净（`git status` 无残留） |

结论：**绊线非循环自证**——它把 `APPROVED_BASELINE` 钉在硬编码字面量上（`characterize-kb-recall-eval.mjs:88-95`），任一侧改余量即红；**floor 断言可证伪**，非恒真门禁。实施方 selfproof 的 [A]/[B]/[C] 结构得到独立复现。

## 3. 反作弊六项

| 项 | 判据与结果 |
|---|---|
| gold 反推 | G1 盲判 15/15、11 条新标全对；无「实现输出即真值」迹象 ✓ |
| 条目删改 | T4 对冻结文件仅元数据级改动：**id/query/gold/tier 零变化**，条目 130→130、excluded 4→4；10 条 `whyNegative` 去 seed 前缀 + 30 条 `seed:true`；changeLog 记批准来源 = G2 报告 §五.2 ✓（裁定见 §4） |
| excluded 滥用 | 4 条未变，均为真歧义且附语料实证 ✓ |
| 阈值恒真 | **由 §2 [A]/[B] 证伪** ✓ |
| `--baseline` 绕过 | 改后复测双向：对自身基线 **exit 0** / 对更严 hold-out 基线 **exit 1** ✓（未读可被篡改的落盘基线做判据） |
| 仅头部卡覆盖 | 62 张卡（≥50）、单卡 ≤3（≤4）、无重复 query、无陈旧 gold ✓ |

## 4. 冻结文件变更裁定（D7）

`56b52af3` 修改了已冻结的 `kb-recall-eval.v1.json`。reviewer 裁定 **追认（metadata-only）**，依据：

1. **内容零漂移**：id / query / gold / tier / 条目数 / excluded 全部未变（reviewer 用 `git show 0e8a9f64:<fixture>` 与现行逐条 diff 实证）；
2. **指标未漂移**：改后独立复算 = **0.650 / 0.757 / 0.694 / 0.708 / 0.633 / 0.650**，与 G2 基线逐位一致；
3. **变更本身源自 reviewer 建议**（G2 §五.2 种子标记统一），changeLog 已记录来源；
4. 过程披露属实：首版重写产生 1174 行 diff → 回滚改行级手术编辑（66 行），其余 98 条字节未动。

> 流程建议（非阻塞）：D7 的批准人应为 Lead。本次建议由 reviewer 提出、实施方执行，**建议 Lead 在 todo 上补一句追认**即可闭环。

## 5. 门禁现状（reviewer 实跑全量）

`bash scripts/refactor/verify-all.sh` → **FAILED / exit=1 / 5 条红**，与本线零耦合（前次已 grep 验证 + 单跑复现）：

`characterize-step-highlight`（DB 截图数据）· `characterize-layer-tree`（traj 33 数据）· `characterize-export-v3`（模块内异常）· `characterize-confirm-notification`（他线源码 pin）· `characterize-network-capture`（单跑 OK 5，门禁内偶发）

**本线新增门禁在全量门禁内通过**：`characterize-kb-recall-eval: 4 passed → ok`（`verify-all.sh:159`）。

## 6. 遗留与建议

| # | 事项 | 处置 |
|---|---|---|
| 1 | **A 层第七项下限未加**（实施方未捆绑落地，正确） | **reviewer 认可挂起**。加门禁属新批准轮次；建议 Lead 下一轮批 `A ≥ 0.95`（现 1.00，40 条容 2 错）——聚合 floor 0.600 对 B/D 崩塌不敏感，A 层是最灵敏的检索回归探测器。届时须同样走 lockstep 纪律 |
| 2 | 结构断言用 `entries.length >= 130` | nit：允许**无批准新增条目**（D7 语义）。风险低（新增会改变指标并由 floor 兜底），建议改 `=== 130` 或加 changeLog 守卫 |
| 3 | 冻结文件批准人 | 见 §4，建议 Lead 补追认 |
| 4 | 门禁红集漂移（他线 WIP / DB 数据 / 环境偶发） | 与两条 KB 线均无关，建议 Lead 单独立项；本次已第 3 次观测到集合变化 |

## 7. 结论

**PASS。** 交付达成 spec §1 的五条成功终点：

1. 130 条独立标注评测集（A40/B30/C15/D15/N30，62 卡，冻结带 `evalVersion`/`changeLog`）✓
2. 一条命令产出标准指标 JSON（Acc@1/Recall@5/MRR@5/nDCG@5/拒答/噪声/延迟冷热 + 逐条明细 + byTier）✓
3. 指标写入门禁且**可证伪**（reviewer 亲手三态自证）✓
4. 基线与趋势固化（`reports/2026-09-09-kb-recall-eval-baseline.md`）✓
5. JS/PY 对同一评测集正样本断言 + 分歧登记（62/100，非阻塞）✓

**放行**：本线可关闭；后续召回算法改动（方向 5：混合检索）须以本门禁为护栏，任何 floor 变更走 Lead 批准 + lockstep 同 commit。
