# Decision: 控制台「谁来读 / 级别」维持现状（第 1 点关闭）

**日期**：2026-09-24  
**状态**：已确认，不实施  
**范围**：录制线逐步反馈中的浏览器 console / pageerror 通道。回放线不在本文。

## 1. 背景

对照 Playwright MCP 时，第 1 点曾列为开放项：MCP 用工具按需读控制台；本仓每步自动把 `console.error` / `pageerror` 推进 `[step-feedback]`，且不收 `warning` / `log`。

相关缺口（G1 全盲、新 tab 复挂）已在此前合入；本决定只处理「还要不要改产品口径」。

## 2. 决定

**选 D：维持现状，第 1 点关闭。**

| 项目 | 约定（不变） |
|---|---|
| 采集级别 | 仅 `console` 事件的 `type=error`，以及 `pageerror` |
| 投递方式 | 每步结束经 `take_console_feedback` 自动注入下一步 `[step-feedback]` |
| 工具面 | 不新增读控制台动作；不恢复 `read_xhr_log` / `read_error_notify` |
| cue | 仍为 `console:err:…` / `console:pageerror:…` |

## 3. 理由

- 与 toast / 表单 / 接口逐步反馈同为自动推送，避免再引入「模型自己决定要不要读」的第二套纪律。
- Vue / Element 页上 `warning` / `log` 噪音高，扩级别易淹掉真正错误。
- 无湿测证据表明「只漏 warning、没有 toast/error」导致录制空转；无实证则不改。

## 4. 明确不做

- 不做成 MCP 式按需 `console_messages` 工具。
- 不把 `warning` / `log` / `info` / `debug` 写入逐步反馈。
- 不改回放线，不改 `network_capture` 过滤。

## 5. 何时可重开

湿测中若反复出现：页面只有 `console.warn`（或同类），无 toast / form / api / `console.error` / `pageerror`，且因此空转——再单独立项，优先评估「仅加 `warning`、仍自动推送」的窄改，不做按需工具。

## 6. 关联

- 调研：`docs/superpowers/reports/2026-09-23-step-feedback-console-gap-research.md`（G1）
- 已落地：`scripts/agent/console_feedback.py`、`page_feedback_hooks._bind_console`
- 同批已关项：第 2/3/5（api/prompt）、第 4（原生弹窗）、第 6（network_capture 新 tab）
