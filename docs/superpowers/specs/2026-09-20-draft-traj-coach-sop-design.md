# Design: Draft-Traj Coach SOP（旁路 OpenCode）

> 日期：2026-09-20  
> 状态：已批准（会话拍板：形态 C、交付 C、人闸 A、接活 C、改链 B）  
> Runtime：后置的 `tools/draft-traj-coach/src` OpenCode plugin 现由 [`2026-09-24-draft-traj-coach-runtime-design.md`](2026-09-24-draft-traj-coach-runtime-design.md) 规定（runtime 实现以该较新设计为准）。  
> Skill 真源：`tools/draft-traj-coach/skill/SKILL.md`  
> 相关：`2026-09-07-req-to-draft-traj-design.md`、`2026-09-18-recording-coach-opencode-design.md`、`req-doc-to-kb`

## 1. 目标

为团队提供与 recording-coach 同构的**旁路 SOP**：用 OpenCode（或 Cursor Agent）加载 skill，编排 `/api/v2/kb/req-modules` 的 parse → propose → 人确认 → validate/commit，提升原子草稿质量；**不**把 OpenCode SDK 焊进产品 `propose.js`。

成功判据：

1. 操作员可在无旁路工具实现时，仅靠 skill + HTTP 跑通纪律（人闸不可破）。
2. 人未确认 `atomKeys` 不得 commit。
3. 允许改 `through-chains.md`（备份+diff），`chapters/` 只读。
4. 终点为 `draft` 交易；无 prepare/record。

## 2. 非目标（本版）

| 非目标 | 说明 |
|--------|------|
| 实现 `tools/draft-traj-coach/src` OpenCode plugin | 后置；skill 预留工具名 |
| 产品路径 `engine: opencode` | AGENTS：standalone 为产品 LLM |
| 自动录制 / 批量抢槽 | 与 recording-coach / batch 分离 |
| 改 chapters / 写 flows | 切片与晋升另线 |

## 3. 决策摘要

| 项 | 选择 |
|----|------|
| 形态 | 旁路 skill（目录 `tools/draft-traj-coach/skill/`） |
| 人闸 | A：确认 atomKeys 前禁止 commit |
| 接活 | C：有源可 parse；已 sliced 直接 propose |
| 改链 | B：可改 through-chains；chapters 只读 |
| 交付 | C：先 SOP；工具名与相变预留 |

## 4. 相变与工具

见 skill 正文。权威态未来落证据目录 `workflow.json`（与 recording-coach 同构）。

## 5. 与产品 API 关系

Coach 是控制面的**客户端**；原子化真源与硬闸仍在 `src/services/req-draft-traj/*`。Coach 多轮价值 = 读 rejected、改链、重 propose、整理人审清单——不是绕过硬闸。

## 6. 验收与演进

- Skill 纪律评测（可选）：`skill/evals/evals.json` 三条 prompt（人闸 / 改链 / commit）；**不**作为质量主门禁。
- **质量标准（skill 自洽）**：`tools/draft-traj-coach/skill/references/taskdraft-quality.md` + `taskdraft-gold-examples.md` + `taskdraft-thin-examples.md`。不依赖 handoff 外链；历史评审全文可另存于 reports，但操作员只读 skill 包。
- **质量主门禁**：按金样分拣建议勾选；编排者终裁；闸门通过 ≠ 达标。
- 工程后置：plugin tools；规则变更只改 skill/references，勿让操作员去翻 data/kb 或 reports。
