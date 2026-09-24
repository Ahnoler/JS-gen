# Design: 录制时原生弹窗交给模型选择

**日期**：2026-09-23  
**状态**：已审阅（2026-09-23 用户确认继续）。实现计划：`docs/superpowers/plans/2026-09-23-native-dialog-step-feedback.md`  
**范围**：录制线。回放线、Element 对话框（`el-dialog` / `el-drawer`）、控制台 warning/log、`network_capture` 新标签页不在本文。

## 1. 问题

原生 `alert` / `confirm` / `prompt` 在录制里一律 `accept()`。文案只写 stderr。模型看不到弹窗，`confirm` 永远是确定，`prompt` 永远是空或浏览器默认值。

一律自动接受是为了不让录制挂死。这次保留这个底线，但让 `confirm` 和 `prompt` 的结果由模型决定。

## 2. 行为

同一时刻页面上只有一个原生弹窗。新开的标签页用同一套规则。

| 类型 | 是否问模型 | 页面结果 | 反馈文案 |
|---|---|---|---|
| `alert` | 不问 | 立即接受 | `dialog:alert:<文案>` |
| `confirm` | 问一次 | 按回答接受或取消 | `dialog:confirm:<文案> \| accepted` 或 `\| dismissed` |
| `prompt` | 问一次 | 接受时带上填入文字；取消不填 | `dialog:prompt:<文案> \| accepted:<文字>` 或 `\| dismissed` |
| `beforeunload` | 不问 | 立即接受（让导航继续） | `dialog:beforeunload:<文案> \| accepted` |

文案为空时，反馈里的文案位置写 `（无文案）`，避免现有 cue 格式因为空文本把整条丢掉。

问模型超过 **20 秒**、调用抛错、或回答解析失败：自动接受。`prompt` 使用浏览器给出的默认文字，没有则为空。反馈决策段写 `timeout-accepted`，不用 `accepted`。

## 3. 机制

问和放行发生在被卡住的那一次点击里面。不新开录制步骤，不新增动作。

Playwright 在弹窗被接受或取消之前不会把这次点击还回来。因此不能把选择留到下一步，否则点击和模型互相等待。

录制模型在浏览器起来之前已经创建。页面钩子挂上时把「用这个模型问一句」的回调传进去。全进程只保留这一个弹窗处理函数。启动路径上现在那套「一律接受」必须去掉，否则第一个页面先被旧函数占住，新函数挂不上去。

`confirm` / `prompt` 的请求不带工具、不带对话历史。内容只有弹窗类型、全文，以及 `prompt` 的默认文字。要求模型只回一行：

- `accept`
- `dismiss`
- `accept:` 后面跟要填的字（仅 `prompt` 使用；`confirm` 忽略冒号后的内容）

大小写不敏感。取第一条非空行。其余内容算解析失败，走超时接受。`accept:` 后面没有文字时，`prompt` 填入空字符串，不用浏览器默认值。默认值只用于超时接受。

这次请求和正在等待的点击并行：点击在等弹窗关闭，弹窗在等这次回答。回答本身不再调用浏览器动作，所以不会和主循环死锁。

`alert` 与 `beforeunload` 不发这次请求。

## 4. 反馈怎么进下一步

决定写入与 console 相同的逐步反馈通道，在本步结束的 `scan_and_emit_step_notices` 里取走并注入 `[step-feedback]`。

现有 `kind=dialog` 只认 `dialog` / `drawer` 两种 surface，其它会被收成 `dialog:`。实现时扩展格式化，使上表四种前缀原样出现，且现有 Element 对话框标题（`dialog:流程选人`、`drawer:…`）保持不变。

原生弹窗条目不要占用 Element 对话框的 surface 去重键，避免「确认删除？」被当成已经见过的抽屉标题。

## 5. 模块边界

| 模块 | 职责 |
|---|---|
| 新的录制侧助手（建议 `scripts/agent/native_dialog.py`） | 解析回答、超时决定、把待注入条目放进会话缓冲 |
| `scripts/browser/factory.py` | 绑定 Playwright `dialog` 事件：`alert` / `beforeunload` 直接接受；`confirm` / `prompt` 调用上面的助手后 `accept` / `dismiss` |
| `scripts/agent/page_feedback_hooks.py` | 把问模型的回调和会话缓冲交给每个 page（含后开的 page） |
| `scripts/session_runner.py` | 用录制模型构造那个回调，并停止安装「一律接受」 |
| `scripts/agent/step_feedback.py` | cue 格式扩展 |
| `scripts/agent/step_notice.py` | 扫描时取走缓冲 |

助手不 import 浏览器启动代码。工厂不自己拼 prompt。

## 6. 验收

不打开浏览器：

- 解析：`accept`、`dismiss`、`accept:同意`、空行后的有效行、废话、大小写。
- 超时与调用失败得到 `timeout-accepted`，`prompt` 用默认文字。
- `alert` 路径不调用问模型的回调。
- 假弹窗对象：`confirm` 按回答调用接受或取消；`prompt` 接受时把文字传给 `accept`。

源码 pin（与 `characterize-step-feedback` 一起，ui 域）：

- cue 含 `dialog:alert:`、`dialog:confirm:` 的 `accepted` / `dismissed`、`dialog:prompt:` 的 `accepted:`、`timeout-accepted`。
- 录制启动不再把第一个页面绑成一律接受。
- 不新增动作，不恢复 `read_xhr_log` / `read_error_notify`。

真机不在本设计的门禁里。合入后由测试在新录制会话里点一次会弹出 `confirm` 的按钮，看模型选择是否和页面结果一致。

## 7. 明确不做

- 三种弹窗都停住等模型（`alert` 不值得多一轮）。
- 新增 `answer_dialog`，把选择留到下一步。
- 改回放线、Element 对话框扫描、控制台级别、`network_capture` 的挂载范围。
