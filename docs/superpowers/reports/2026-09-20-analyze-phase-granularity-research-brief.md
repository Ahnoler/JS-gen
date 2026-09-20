# Analyze 阶段粒度经验挖掘 — 研究需求说明（转交 ZCode）

> **日期**：2026-09-20  
> **发起**：Cursor / recording-coach skill 线  
> **承接建议**：ZCode 合约湿测线（`D:\dev\JS-gen-contract`，湿测目录与会话现场）  
> **本轮范围**：**仅**「单笔 traj」的 `analyze_trajectory` → `accept_phases` 阶段粒度；**不含**草稿 atom（`draft-traj/propose`）拆分完成度  
> **本轮不做**：改 `trajectory-meta-service.js` 提示词、改 `accept_phases` 机械门禁、改引擎行为  

---

## 1. 背景与目的

湿测里经常出现两类人工纠偏：

- **过碎**：analyze 拆出过多阶段（例：13 段，把「删除确认」「重搜核验」都拆成独立阶段），操作员手工合并回合理粒度（例：6 段，#924 阶段 2462–2467）。
- **过粗**：analyze 合并过猛（例：展开「更多」并入填+查），create 前须手工拆回（移交报告 B-5，#861 / #866）。

仓库里**没有**可打分的「阶段合理粒度 / task 完成度」标准：

| 层 | 现状 |
|----|------|
| Atom 拆分（propose） | 有较硬标准（另案，本轮不挖） |
| Analyze 阶段拆分 | 仅有服务端提示词启发式（规则 1–10 / 3.1 弹窗边界 / 「复杂不宜超 8」） |
| `accept_phases` | 仅机械门：段数 ≤10、描述 ≥20 字——**不评**过碎/过粗 |
| 落库验收 | 评 `steps[]`，不评阶段设计好坏 |

**目的**：从真实操作经验抽出可复现样本，供 Cursor 侧内化为 **recording-coach skill** 里的阶段粒度标准（`tools/recording-coach/skill/references/`），让操作员在 `accept_phases` **之前**有可执行检查清单，而不是事后靠记忆合并。

本轮交付物是 **案例卡样本集**，不是最终 skill 正文（定稿由 Cursor 线根据样本写）。

---

## 2. 需要 ZCode 交付什么

### 2.1 主交付：案例卡清单（8–15 条即可定 v1）

每条一张卡，建议落盘：

`docs/superpowers/reports/2026-09-20-analyze-phase-granularity-cases.md`  
（或合约 worktree 等价路径；提交/推送后告知 Cursor 线路径即可）

**单卡必填字段**（Markdown 小节或 JSON 数组均可，字段名请保持一致）：

| 字段 | 说明 |
|------|------|
| `id` | 稳定 id，如 `wet9-924-merge-13to6` |
| `scene` | 业务能力一句话（非步骤流水账） |
| `trajId` / `phaseIdRange` | 能定位的轨迹或阶段区间；没有则写 `n/a` + 证据路径 |
| `analyzeCount` | analyze **原始**阶段数 |
| `analyzePhases` | 原始各阶段标题或首行描述（可截断，保留「预期结果：」若有） |
| `finalCount` | 人工终态阶段数；若未改则与 analyze 相同 |
| `finalPhases` | 终态列表（同上） |
| `opType` | 四选一：`merge过碎` / `split过粗` / `keep` / `engine-workaround` |
| `rationale` | 人话 1–3 句：为何合/拆/保留；触及哪条直觉 |
| `evidence` | tmp 文件路径、agent-log 时刻、会话截图说明、JSON 相对路径等 |
| `skillWorthy` | `yes` / `no-workaround` / `unsure` |

### 2.2 覆盖要求（抽样优先级）

至少尽量各覆盖一类（同类可多条）：

1. **过碎 → 合并**：确认弹窗单独成段、重搜/核验单独成段、单点「确定」成段、总段数明显高于任务设计（目标例：13→6）
2. **过粗 → 拆分**：跨页/跨稳定态合并；「更多展开」并入填+查等（对照 B-5）
3. **应拆且只拆一刀**：3.1 状态边界——触发打开确认弹窗 vs 弹窗内确定（合法拆分，不要标成过碎）
4. **引擎规避（必须分栏）**：因 `already-operated-this-phase`、搜索族重填等**被迫**拆独立阶段 → `opType=engine-workaround`，`skillWorthy=no-workaround`（避免写进长期粒度铁律）

### 2.3 附带可选（有则更好）

- 同 traj 的 `taskText` 作者意图段数（若任务文案按节设计）vs analyze 段数对照一行表
- 一句「若当时有 checklist，会在哪一步拦下」

### 2.4 明确不需要

- 不改引擎 / 不改 analyze prompt / 不改 `accept_phases` API
- 不挖 draft-traj atom 边界（另立项）
- 不追求全库穷尽；**8–15 条高质量卡**优于 50 条无对照

---

## 3. 建议挖掘入口（合约现场）

按可信度优先：

1. **`tmp/contract-wet*-*`**（含 wet9）中 analyze / phases / create 相关 JSON：对比「原始 analyze」与「最终建单/录制用阶段」
2. **ZCode 会话日志**：含「过碎」「手工合并」「拆回」「合理粒度」等表述的回合（例：#924 13→6）
3. **`docs/superpowers/reports/2026-09-18-wet-test-defect-handover.md` §B-5** 及其中 traj #861 / #866
4. 同单 `task-*.md` 与 analyze 输出并列（意图 vs 模型）

若原始 analyze 已被覆盖写掉：用 git / 备份 / 聊天粘贴的阶段列表 + 终态 DB/API 阶段列表做对照，并在 `evidence` 注明「原始仅聊天残留」。

---

## 4. 验收标准（研究侧 Done）

- [ ] 案例卡 ≥8 条，且 `merge过碎` 与 `split过粗` **至少各 2 条**
- [ ] 每条有可核对 `evidence`（路径或 traj id）
- [ ] `engine-workaround` 与真正粒度问题 **未混标** 为 `yes`
- [ ] 文首用 5–10 行总结：反复出现的合/拆理由（供 Cursor 抽规则）
- [ ] 本文件回链：在案例报告顶部写 `依据：2026-09-20-analyze-phase-granularity-research-brief.md`

Cursor 侧后续（**不在本研究工单内**）：根据案例写 skill reference（过碎/过粗/必拆/可合）+ `accept_phases` 前检查清单；可选 Tier A 题。

---

## 5. 约束与协作约定

| 项 | 约定 |
|----|------|
| 文件集 | 优先写 `docs/superpowers/reports/**`；勿动 `tools/recording-coach/**`（Cursor 在途 skill 线） |
| 禁入 | `src/services/trajectory/**` analyze 提示词、Python 录制热区（非本工单） |
| 沟通 | 案例报告 push 后在 agent-log 留一条收工回执，@ Cursor 线路径即可 |
| 冲突 | 与引擎湿测并行时：只读 tmp + 写 reports，不抢运行态重启窗口 |

---

## 6. 参考锚点（已知样例，请扩成正式卡）

| 线索 | 方向 | 备注 |
|------|------|------|
| wet9 / #924：analyze 13 段 → 手工并 6 段（阶段 2462–2467）；「删除确认」「重搜核验」曾独立成段 | `merge过碎` | 会话明示；请补原始/终态列表 |
| B-5：#861、#866 create 前手工拆回 | `split过粗` | `2026-09-18-wet-test-defect-handover.md` |
| analyze 提示词 3.1：触发开弹窗 vs 弹窗内确定 | 合法拆分对照 | `trajectory-meta-service.js` 规则块；用于标定「不是过碎」 |
| #917 相关：同阶段重填搜索关键字曾被门禁打断，配方侧或拆阶段规避 | `engine-workaround` | 勿写入 skill 永久粒度标准 |

服务端现有启发式（只读参考，本轮不改）：`src/services/trajectory/trajectory-meta-service.js` 中「阶段拆分规则」1–10、3.1、示例 6。

---

## 7. 一句话任务书（可直接贴给 ZCode）

> 请按 `docs/superpowers/reports/2026-09-20-analyze-phase-granularity-research-brief.md` 从合约湿测 tmp / 会话 / B-5 挖 **8–15 条** analyze 阶段粒度案例卡（过碎合并、过粗拆分、3.1 合法拆、引擎规避分栏），写成报告 push；**不改引擎**。交付后 Cursor 据样本写 recording-coach skill 标准。
