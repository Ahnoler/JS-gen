# 录制本步页面反馈

> **状态**：待评审。用户已逐段确认（2026-09-22），并明确不把失败原因写入阶段、交易或步骤。本文件只描述设计，不含实现。
> **用途**：录制时每步动作结束后，由系统记下这一步新带出的页面反馈，交给下一步的模型。模型不再自己去读会消失的提示。

## 1. 结论

限时提示在动作结束时由系统记下，写入下一步上下文，并留在当次录制的会话内存里。模型用新动作 `read_step_feedback` 回看更早的步骤。不写入轨迹步骤、阶段 `done_logs`、交易 `trajectory_log` / `failed_reason`，也不新增落库列。

`read_error_notify` 与 `read_xhr_log` 从工具表移除。`close_notification` 只关闭通知，不再承担读文案。

## 2. 动作

| 动作 | 处置 |
|---|---|
| `read_error_notify` | 取消注册。提示词、工具说明、工程步骤名单里的名字一并删除。 |
| `read_xhr_log` | 取消注册。同上。模型不查看接口。 |
| `close_notification` | 保留。只关闭当前可见的 `el-notification`。关掉返回 `ok-closed`，没有可关的返回 `no-notification`。返回值不含通知原文。系统不代关。 |
| `get_page_state`、`scan_visible_fields` | 保留原职。提示词不再把它们写成抓刚消失通知的办法。 |
| `scroll_to_first_error`、`sync_tasks_from_errors` | 保留。校验红字会留在字段上，这两个动作还负责滚动和改任务列表。 |
| `click_save` | 保留。它内部已经轮询保存结果，不改成事后再读。 |
| `read_step_feedback` | 新增。只读会话里已经记下的反馈，不扫当前页面。 |

录制开始时安装现有的请求钩子，只用于在第 3 节的条件下抽出错误提示原文。模型没有读取接口的动作。没有提示原文时不记 api 项。

## 3. 每步记下什么

扫描挂在现有每步结束处（现在注入 `【页面通知】` 的位置），沿用开关 `AI_STEP_NOTICE_SCAN`（默认开）。关闭时不扫描、不注入、不记历史。动作一结束就扫，不等模型下一轮。只记录相对上一次扫描**新出现**的内容。动作前已经在的不重复报。没有新反馈的轮次不产生记录，也不注入空提示。

一条记录对应一个 agent 步骤：

| 字段 | 含义 |
|---|---|
| `step` | 该轮序号 |
| `actions` | 这一轮的业务动作名，按顺序。工程类观察动作不记入 |
| `items` | 本轮新反馈 |

同一轮有多个业务动作时，整段新反馈归这一轮，不猜测是哪一次点击。提示词仍要求单动作单观察。

每条 `items` 只留短字段。toast 文案、校验红字、对话框或抽屉标题、接口错误提示，各自最长 **200 个中文字符**，超出截断。

| 种类 | 内容 |
|---|---|
| toast | `el-message`、`el-notification`、`el-message-box`。`level` 为 error / success / info，加文案 |
| form | `.el-form-item__error` 的字段名 + 文案 |
| dialog | 新打开的对话框或抽屉：`dialog` 或 `drawer`，加标题 |
| api | 仅当本轮请求报错，且本轮没有新 toast、也没有新红字。内容只有错误提示原文，不写路径、状态码、响应体 |

页面上已经有 toast 或红字时，不加 api 这一条。

## 4. 交给模型

有新反馈时注入一条，取代现在的 `【页面通知】`，避免两套提示各说一遍。前缀用英文：

```
[step-feedback] click_save | toast:err:利率不能为空；form:利率:不能为空；dialog:流程选人
```

接口错误且页面无提示时，同一行里加 `api:利率不能为空`。

`read_step_feedback(last=5)`：`last` 为最近若干条**有反馈**的步骤，默认 5。返回每条的 `step`、`actions`、`items`。没有记录时返回 `no-step-feedback`。工具说明用英文短句：read feedback already recorded for recent steps; does not scan the page。

提示词写明：刚发生的反馈已经在 `[step-feedback]` 里，不必为了看刚才去调用；只有要核对更早某一步带出过什么时才调用。

记忆在当次录制的会话里，录制结束即丢。最多保留最近 40 条有反馈的步骤，更早的丢掉。

扫描或写记忆失败只打日志，不中断录制，不改变 `done` 判定，不改变 `record_status`。

## 5. 提示词

从 `scripts/prompts/agent-tools-common.md`、`agent-tools-form.md`、`agent-tools-table.md`、`agent-core.md`、`planner-prompt.md` 删除：

- `read_error_notify`、`read_xhr_log` 的说明，以及「保存后去读接口」「事后去读 toast」的句子。
- 把 `close_notification` 当成读服务端错误的说法。`no-notification` 不再被解释成「读过了但没有通知」。保存成功仍只看 `click_save` 的返回。

`close_notification` 只保留：通知挡住下一步时关掉。文案以 `[step-feedback]` 和 `read_step_feedback` 为准。

`scripts/agent/step_notice.py` 里引导模型用 `close_notification` 去读错误的那句，改为指向 `[step-feedback]`。

## 6. 验收

- 一步之后新出现的 toast、红字、对话框或抽屉标题，出现在下一步上下文的 `[step-feedback]` 里，单段文案可到 200 个中文字符。
- 限时 toast 消失后，`read_step_feedback` 仍能按步骤读到已记下的文案，且该动作不扫描当前页面。
- 工具表中不再有 `read_error_notify`、`read_xhr_log`。
- `close_notification` 只关通知，返回值不含原文。
- 接口报错且页面无提示时，反馈里只有错误提示原文。
- 反馈不出现在轨迹步骤、阶段 `done_logs`、交易 `trajectory_log` 或 `failed_reason` 里。
- 步骤折叠与 `done` 判定的现有行为不变。

钉住 `read_error_notify`、`read_xhr_log` 旧契约的 characterization，在实现时改为钉住「这两个动作不再注册」以及本文件的新契约。

## 7. 不包含

- 不把页面错误写入轨迹（缺陷 `record-page-errors` 的落库不在本设计内）。
- 不新增 `page_errors_json`、`block_reasons`，不往阶段 `done_logs` 追加失败原文。
- 不改步骤折叠，不改 `done` 判定，不因页面拒绝改 `record_status`。
- 不自动关闭通知。
