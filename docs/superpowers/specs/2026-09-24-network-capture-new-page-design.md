# Design: 新标签页复挂 network_capture 落库

**日期**：2026-09-24  
**状态**：已审阅；实现计划见 `docs/superpowers/plans/2026-09-24-network-capture-new-page.md`  
**范围**：录制线。只补「新 page 上表单相关请求落库断掉」这一条。逐步反馈、回放、过滤放宽不在本文。

## 1. 问题

`attach_network_capture` 只在 `session_runner` 启动时绑到当时的 current page。后开的标签页没有 `response` 监听，表单相关请求不会发出 `network_captured`。

逐步反馈里的接口错误已经跟着新标签页走了（XHR 钩子在每个 page 上复挂）。本设计不把落库内容再塞进 `[step-feedback]`。

## 2. 行为

| 项目 | 约定 |
|---|---|
| 挂载范围 | 每个录制 page，含 `ctx.on('page')` 后开的标签页 |
| 过滤 | 仍为现有「表单相关」判定，不放宽 |
| 事件 | 仍为 `network_captured`，只进记忆库 |
| 逐步反馈 | 不写 `[step-feedback]` |
| 同一 page | 不重复挂 |

## 3. 机制

走现有 `install_recording_page_hooks` → `_attach_page`。在 console / 原生弹窗 / XHR 之后调用一次 `attach_network_capture(target, store)`。

页面身份继续用钩子侧的弱引用去重。同一 page 第二次进入 `_attach_page` 时提前返回，因此不会双挂。

`session_runner` 启动时那一次单独的 `attach_network_capture` 删掉，只保留钩子路径，避免第一页挂两次。

每个 page 的 cleanup 收入钩子侧集合。会话结束时逐个调用；失败不炸会话，与现在 `_net_cleanup` 语义一致。

## 4. 模块边界

| 模块 | 职责 |
|---|---|
| `scripts/agent/page_feedback_hooks.py` | 在 `_attach_page` 挂 capture；收 cleanup；统一 teardown |
| `scripts/session_runner.py` | 删除启动时单独挂法；会话结束改走钩子 teardown |
| `scripts/controller/actions/network_capture.py` | 过滤与事件形状不动。可选：内部幂等；默认靠钩子去重即可 |

不改 `JS_TAKE_API_ERROR_TEXTS`、`step_notice` cue、回放。

## 5. 验收

源码 pin：

- `page_feedback_hooks` 导入并调用 `attach_network_capture`
- `session_runner` 的启动挂载段不再单独调用 `attach_network_capture`（钩子安装路径除外）
- 现有 `characterize-network-capture` 对 `attach_network_capture` / `_net_cleanup` 的断言若因接线改动而红，同步改成「经钩子挂载」口径，不得放宽过滤语义

不要求真机。合入后由测试在新标签页走一次表单请求，确认记忆库仍有 `network_captured`。

## 6. 明确不做

- 把落库内容写入 `[step-feedback]`
- 放宽为全量网络请求
- 改回放线或 Element 对话框扫描
- 第 1 点（控制台级别 / 谁来读）——另稿
