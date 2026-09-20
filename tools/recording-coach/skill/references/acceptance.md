# 落库验收口径

湿测验收以**落库步骤**为准，不以控制面状态字段单独过关。

## 看什么、不看什么

| 看 | 不看 |
|----|------|
| `stepCount`、真实 **`steps[]`** | 仅 `recordStatus=recorded` |
| 目标 `actionType` + `paramsJson` / `elementJson` | 仅 `isSuccessful=1` |
| `doneLogs`、executor-main.log（注意截断） | 阶段全 `completed` 就当 PASS |

**核心原则：看 `steps[]`，不看仅 `recordStatus`。**

## 假成功

约 1 分钟内全 `phase_done` 且 **0 步** → 结论前缀 **`BLOCKED_`**，勿报 `CREATED_` 或 `DONE`。

阶段全 completed 但落库无目标动作，一律按假成功处理，在 `through-report.md` 写明现象与 poll 证据。

## 动作名归一

索引点击可能归一为 `click_table_row_radio`（看落库字段）。Agent 常走 `click_element_by_index` 再归一成表行/树动作；验收时看**最终落库动作名与字段**，不以中间索引点击为准。

典型归一：`click_table_row_radio`（查 `paramsJson` 中 `row_text` 等字段）。

## 结论前缀

`write_through_report` / `close.txt` 结论行只允许：

- **`CREATED_`** — 落库步骤满足业务判据
- **`REJECTED_`** — 服务端业务拒绝（合法终局）
- **`BLOCKED_`** — 前置未核、假成功、环境阻断等
- **`ERROR`** — 工具/管线异常

禁止用 `DONE` 作结论行。

## 诚实失败

服务端拒绝（评级未生效、在途授信等）是**合法终局**：照抄提示原文 + 全局流水号（记在 `doneLogs`），结论前缀 **`REJECTED_`**。

- **不得擅自重录**：诚实失败后禁止再开一单，除非用户**本回合**明确要求重试。
- 湿测路径默认 `honestReject.enabled: true`（`assert_steps` / `write_through_report`），除非调用方显式 `false`。

## assert_steps 要点

- 对照 `dispatch-brief.md` 中的落库级判据（动作名 + params/element 字段）。
- 主线程应独立复核 DB/API，不采信子代理单方回报。
- 每轮保留 `analyze`/`create`/`prepare`/`start` JSON、`traj-*-final.json`、`poll-*.json`、日志摘录。
