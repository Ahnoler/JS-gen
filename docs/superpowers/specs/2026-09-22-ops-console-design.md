# 执行机与日志页设计（/ops MVP）

> **状态**：待实现。用户已逐段确认（2026-09-22）。本文件只描述设计，不含实现。
> **用途**：把 `/api/docs` 里的执行机监视和待上传截图挪到独立页面，给用户看执行机资源和步骤日志。前端同事之后只改这一个目录。

## 1. 结论

新增 `GET /ops`，页面文件全部在 `src/dashboard/ops-console/`。两个标签：「执行机」右侧是日志，「待上传截图」时日志隐藏。日志是小卡片，点开居中弹窗看全文。不新增 HTTP 接口，不加构建。

## 2. 页面

| 文件 | 职责 |
|---|---|
| `src/dashboard/ops-console/index.html` | 页头、两个标签、两块空面板。`<script type="module">` 加载 `app.js`，样式链到 `ops.css` |
| `ops.css` | 只服务这一页 |
| `app.js` | 切换标签；共用 `fetch` 解包和 HTML 转义 |
| `executor-panel.js` | 槽位表、原有操作、把日志交给卡片模块 |
| `screenshots-panel.js` | 待上传列表及上传、预览、删除 |
| `log-cards.js` | 把日志文本解析成卡片并渲染弹窗 |

`server.mjs` 在现有 `GET /` 旁边增加 `GET /ops`，`sendFile` 上述 `index.html`。`/src/dashboard` 已托管该目录，不再加静态挂载。

`/api/docs`：`api-docs.html` 侧栏加到 `/ops` 的链接。`catalog.js` 的 `API_GROUPS` 去掉 `GROUP_SLOT_MONITOR` 和 `GROUP_PENDING_SCREENSHOTS`。`app.js` 去掉这两处 `import` 和挂载。删除 `slot-monitor.js`、`pending-screenshots.js`。`api-docs.css` 里的 `mon-*` 规则留下，登录/登出录制面板还在用。登录/登出录制面板留在文档页。

鉴权与 `/api/docs` 相同，本页不另加。

## 3. 执行机标签

打开即请求 `GET /api/v2/executors` 与 `GET /api/v2/recording/agent-stderr/active`，合成槽位表（节点、在线、占用/容量、交易、CDP、会话）。工具栏：刷新、每 5 秒自动刷新、显示离线执行机。自动刷新只重画槽位表，不重新拉日志，不打断日志滚动。

操作与现页面相同，破坏性操作先 `confirm`。推流画面直接请求。

| 操作 | 请求 |
|---|---|
| 断开画面 | `POST /api/v2/trajectories/:id/stream/detach` |
| 推流画面 | `POST /api/v2/trajectories/:id/attach` |
| 释放浏览器 | `POST /api/v2/trajectories/:id/detach` |
| 关闭孤儿会话 | `POST /api/v2/executors/:nodeUuid/sessions/:sessionId/close` |
| 清空日志 | `POST /api/v2/recording/agent-stderr/clear` |
| 打开日志 | `POST /api/v2/recording/agent-stderr`，`format=text` |

点槽位行和点「日志」都是打开日志。复制全文留在日志面板上。

## 4. 待上传截图标签

切到此标签时隐藏执行机和日志，日志内容留在内存，切回仍在。数据来自 `GET /api/v2/screenshots/pending`。一键上传 `POST /api/v2/screenshots/pending/upload`，单行上传 `POST /api/v2/screenshots/:id/upload`，删除 `DELETE /api/v2/screenshots/:id`，预览新窗口打开 `/api/v2/screenshots/:id/image`。刷新和每 5 秒自动刷新独立计时。一键上传和删除先 `confirm`。进行中再次点击无效。

## 5. 失败

每个标签一条状态条。响应为 `{ code, data }` 且 `code !== 200`，或 HTTP 非成功，状态条变红并显示服务端消息。列表失败时表格区显示「无法加载」。拉日志失败时，日志区显示这次的错误文本，槽位选中行保持不变。

## 6. 日志卡片

解析前去掉行首 `[slot:N sid:…]` 与 `[session …]`（与 `stripLinePrefix` 相同）。卡片按时间顺序排在阶段标题下。面上各一行，超出用省略号。点卡片打开居中弹窗，同一时间只开一个；点遮罩或「关闭」关掉。弹窗内部滚动，不再按字数截断。新卡片出现时滚到最新；用户往上滚则暂停跟随，面板提供「回到底部」再打开跟随。

成卡的只有下面三类。其余行（含仍会打印的短行、空操作提示、导航提示）收进该段「其他」，默认折起。

### 6.1 阶段标题

`Phase N: … (max_steps=…)` 是标题，不是卡片。`Phase N done` 不单独成卡。

### 6.2 信息卡 `[card]`

写入方另打一行，页面只认这一行做信息卡：

```text
[card] {"kind":"…","phase":1,"title":"…","score":100,"text":"…"}
```

整行是 `[card] ` 加上一次 `json.dumps(对象, ensure_ascii=False)`，不要手写拼接。因此正文里的引号和换行不会把日志拆成多行。`text` 等于当时追加进 Agent 的那一段，日志侧不再切片。已有的生成侧上限保持不动：流程摘要 `flow_summary_text` 的 800 字、阶段前言 `_PREAMBLE_TOTAL_MAX` 的 8000 字。卡片展示的是 Agent 真正拿到的字符串。

| kind | 何时写 | title | text |
|---|---|---|---|
| `phase-task` | `format_phase_preamble` 返回之后 | `阶段 N` | 该返回值全文 |
| `kb` | 把流程摘要追加进 `agent_task` 时 | 流程名 | 追加的摘要全文（含特殊元素兜底，若有）；`score` 为召回分 |
| `fact-pack` | 事实包文本非空并追加时 | `事实包` | 追加全文 |
| `refill` | `recording_refill_hint` 非空并追加时 | `补填提示` | 追加全文 |
| `contract` | `contract_summary_hint` 非空并追加时 | `阶段合约` | 追加全文 |
| `success-gates` | 硬性成功门闩非空并追加时 | `成功门闩` | 追加全文 |
| `business-data` | `format_business_data_hint` 非空并追加时 | `业务数据` | 追加全文 |
| `kb-dict` | 码表候选非空并追加时 | `码表` | 追加的 `【KB 码表】…` 全文 |
| `scenario` | 场景摘要注入成功时 | `场景摘要` | 注入的 summary 全文。stderr 短行 `summary[:80]` 与 `emit_json` 的 `summary[:300]` 保持原样，不作为卡片正文 |

面上：阶段任务显示当前任务第一行；知识库显示流程名和 score；其余显示 `text` 第一行。弹窗显示 `title` 与完整 `text`。

现有短行继续打印，便于检索：`kb_flow injected:`、`agent_task preview:`、`Phase N:` 以外的说明行、`[scenario_describer] injected … summary[:80]`。页面不把它们解析成卡片。

### 6.3 步骤卡 `[step]`

`scripts/recorder.py` 的 `[step]` 行去掉三处截断：`goal[:200]`、`act[:500]`、`_compact_last_result` 的 `max_chars=120`。不新增配置项。

全文可能含换行或 ` | `。新写入把 `goal`、`act`、`res`、`err` 各自 `json.dumps` 成一行里的 JSON 字符串，形态仍以 `[step N] done=yes|no stopped=yes|no` 开头：

```text
[step 4] done=yes stopped=no | goal="…" | act="…" | res="…" | err=""
```

`res` / `err` 为完整 `extracted_content` / `error`，空则 JSON 空字符串。不再调用按字数压缩的摘要。

旧日志没有这层 JSON 引号。解析时：`goal=` 之后若以 `"` 开头，按 JSON 字符串读四个字段；否则按今天的 ` | goal=` / ` | act=` / ` | res=` 拆（` | err=` 可缺）。样例文件走旧路径。

卡片状态按此顺序只取一条：`err` 非空或 `stopped=yes` 为失败（红）；否则 `done=yes` 为阶段完成（绿）；否则 `act` 为空、`{}`，或 `res` 为 `None` 为空操作（橙）；其余为成功（绿）。面上三行是目标、操作（动作名加关键参数，如「点击元素 1」）、结果第一行。弹窗是四个字段的全文，外加拼回的原文行。

`_ACTION_LOG`（目标 120 字、结果 400 字）不改。`scripts/agent_utils.py` 里 JSON 事件的 `next_goal[:200]` 不改。

### 6.4 回放卡 `[replay]`

`[replay] [i/n] <action> <params>` 与紧随的同一 `[i/n]` 的 `OK →` 或失败行合成一张卡。目标由动作推出：`go_to_url` 为打开该 URL，`fill_form_field` 为填写 `label_text`，带 `text` 的点击为点击该文本，其余用动作名。操作是动作名，结果是 OK/失败行。弹窗是这两行原文。状态：OK 为成功（绿），否则失败（红）。

### 6.5 阶段标题全文

`scripts/agent/service.py` 的 `Phase {n}: {task_text[:80]}` 改为写入完整 `task_text`。任务文本里的换行换成 `\n` 两个字符，保证仍是一行，后缀仍是 ` (max_steps=…)`。

## 7. 验收

1. 控制面启动后 `GET /ops` 返回新的 `index.html`。浏览器打开 `/ops`：执行机标签能列出槽位；点一行出现日志区；截图标签能列出待上传项，上传、预览、删除仍可用；来回切换后上次日志还在。`/api/docs` 有到 `/ops` 的链接，导航里没有「执行机监视」和「待上传截图」，登录/登出录制面板还在。
2. 用 `logs/agent-stderr/700fced0-2bd9-4137-aa3a-1733ef87a23a.log` 做旧格式解析：至少一张回放卡（`go_to_url`）、一张步骤卡（目标含「点击「确 定」」）、一个「阶段 1」标题。这条旧日志没有 `[card]` 行。
3. 用一条构造的 `[card]` 文本（`text` 长于 200 字且含换行）断言解析后的 `text` 与写入前相同。
4. 源码检查：`recorder.py` 的 `[step]` 拼接不再包含 `[:200]`、`[:500]`、`max_chars=120`。`service.py` 的 `Phase` 行不再包含 `task_text[:80]`。新 pin 登记进 `scripts/refactor/verify-all.sh`（域拿不准则进 core）。
5. 不新写接口测试。不改 `_ACTION_LOG`、不改 `flow_summary_text` 的 800 字上限、不改 `_PREAMBLE_TOTAL_MAX`。

## 8. 实现时的文件边界

本设计的实现单元才会改：`server.mjs`、`api-docs.html`、`src/dashboard/api-docs/app.js`、`src/dashboard/api-docs/catalog.js`、删除两块旧面板脚本、新增 `src/dashboard/ops-console/`、`scripts/recorder.py`、`scripts/agent/service.py`、`scripts/controller/actions/_scenario_describer.py`（只追加 `[card]` 行）、新 pin 与 `verify-all.sh` 一行。

开工前再看 `agent-log`。若当时已有声明把 `recorder.py` 或 `service.py` 列为正在修改的文件，先错开再改。
