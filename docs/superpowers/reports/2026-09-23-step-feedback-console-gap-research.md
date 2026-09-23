# 录制线「逐步环境反馈」补齐调研报告（对标 Playwright MCP 观察机制）

- **日期**：2026-09-23 · 调研：ZCode 系统线（主会话 + 三路并行 Explore 子智能体，只读，零改动）
- **目的**：录制线（AI 录制 agent）对标 Playwright MCP 的高通过率机制，补齐「逐步环境反馈」缺口。**回放线明确不在范围内**（用户指示搁置）。
- **交付预期**：实施为录制线任务单元；改动面小（4-5 个文件），但护栏 pin 牵动面较大（见 §5）。
- **结论一句话**：反馈链路骨架已完备且默认开启（toast/新表单/新弹窗/XHR 业务错误四通道）；真实缺口是 **①console/pageerror 全盲 ②所有监听只挂启动时单 page（新 tab 全盲）③非 JSON 错误响应体不可见 ④api 反馈被 toast 抑制**，外加 3 处 prompt 过期文案。均为录制线小改，不碰回放、不碰引擎。

---

## 1. 对标基准：Playwright MCP 通过率好的机制拆解

| MCP 机制 | 本仓录制线现状 | 结论 |
|---|---|---|
| 观察优先 + 活引用（ref 同快照句柄） | semantic_snapshot / verify_context / 失败重观察分级（Z1-Z8 批次） | ✅ 已具备 |
| 观察纪律（prompt 层） | 单动作单观察、失败禁同参数重试、3-5 秒预算表 | ✅ 已具备且更严 |
| 内建可操作性等待 | Playwright locator 路径继承 | ✅ 基本具备 |
| **逐步环境反馈** | toast/新表单/新弹窗/XHR 已有；**console/pageerror/新 tab/非 JSON 错误页缺失** | ⚠️ 本报告主体 |

历史注：AI 录制管线讲解材料见 `docs/superpowers/archive/research/2026-09-16-ai-recording-pipeline-handover.md`。

## 2. 现状链路全景（实施前必读，全部 file:line 已核实）

### 2.1 注入链（每步自动，默认开启）

```
scripts/recorder.py:241  on_step_end → _emit_step_notice_scan
→ scripts/agent/recorder_emitters.py:1266
→ scripts/agent/step_notice.py:141  scan_and_emit_step_notices（开关 AI_STEP_NOTICE_SCAN 默认开，feature_flags.py:242-252）
→ 四类采集（下表）→ step_feedback.append_step_feedback 存 business_data_store._step_feedback（上限 40 条）
→ step_notice.py:301  agent._message_manager._add_message_with_tokens(HumanMessage("[step-feedback] …"))
```

- cue 时序已核实：browser_use 每步用 `message_manager.get_messages()` 全量历史构造 prompt（python/Lib/site-packages/browser_use/agent/message_manager/service.py:197-210 + agent/service.py:500），**step N 末注入的 cue 在 step N+1 必然可见**；token 超限时最旧消息会被裁掉（steering-only 设计，可接受）。
- 同通道旁证：导航 cue（`_emit_navigation_cue`，AI_CLICK_NAV_CUE）走完全相同的 `_add_message_with_tokens` 通道（recorder_emitters.py:1257-1258）。**新增反馈通道照抄此路即可，无需新机制。**

### 2.2 四类反馈源与 JS 钩子

| kind | 数据源 | JS 侧 | 备注 |
|---|---|---|---|
| toast | `__notify_log` 游标 | `JS_NOTIFY_HOOK`（js_snippets/error_notify.py:118-149）= MutationObserver 抓 `.el-notification` 插入（上限 20）；每次扫描前重装（step_notice.py:171） | 短命 toast 靠它留存 |
| toast（补充） | 实时 DOM 扫描 | `JS_SCAN_STEP_NOTICES`（js_snippets/step_notice.py:30-52，读 `.el-message`/`.el-notification` + 游标） | 指纹去重 take_new_notices |
| form / dialog | 实时 DOM 扫描 | `JS_SCAN_STEP_SURFACE`（js_snippets/step_notice.py:67-91，`.el-form-item__error` / dialog / drawer） | surface key 去重 |
| api | `window.__xhr_log` | `JS_TAKE_API_ERROR_TEXTS`（js_snippets/step_notice.py:94-115，按 seq 游标增量取） | hook 装于 session_runner.py:372-376 |

- XHR hook（js_snippets/xhr_log.py）：`XMLHttpRequest.prototype.open/send` + `window.fetch` 双 hook，`MAX=20` 环形、请求/响应体各截 2KB，**全量记录无 URL 过滤**；`add_init_script` 页级安装 + 立即 evaluate（session_runner.py:372-376）。
- 被动持久化旁路：`network_capture.py:141` `page.on('response')`（表单相关落库，与反馈链独立）。

### 2.3 agent 可用的读回动作（现状！）

- **`read_step_feedback` 唯一存在**（_observe.py:46-49，读 store 不扫页面）。
- **`read_xhr_log` / `read_error_notify` 动作已不存在**——曾从 _observe.py 删除，且有 pin **反断言其不得回归**（characterize-step-feedback.py:110-116、characterize-error-notify.py:41-43、characterize-xhr-log.py:54）。`JS_XHR_RECENT` 在生产代码零消费者（仅 characterization 引用）。**不要试图恢复这两个动作**；prompt 里也从未教过它们（全 prompts/ 零命中）。
- prompt 现有引用：`agent-core.md:113`、`agent-tools-common.md:14,130`、`agent-tools-form.md:107,129`、`agent-tools-table.md:13`、`planner-prompt.md:74`——均以「[step-feedback] 里已有文案，不要去读接口」为口径。

---

## 3. 差距清单（按杠杆排序，①② 为 P0）

### G1（P0）console / pageerror 全盲

AI 录制路径**没有任何** `page.on('console')` / `page.on('pageerror')` 监听（全仓 grep `pageerror` 零命中）。渲染异常、undefined 报错、组件级失败只进 console 不弹 toast，agent 完全看不见。这是与 MCP 差距最大的通道（MCP 的 `console_messages` 是一等公民）。
参照实现：manual_recorder 有现成模式——`scripts/manual_recorder/recorder.py:242` `target.on('console', on_console)` + `:82` `ctx.on('page')` + `:184` per-page `add_init_script`。

### G2（P0）全部监听/注入只覆盖启动时单 page，新 tab 全盲

现有全部 page 级挂载点都是「启动时 current page」一次性的：
- network_capture `page.on('response')`（network_capture.py:141，挂于 session_runner.py:365）
- dialog 自动 accept（browser/factory.py:394，挂于 session_runner.py:244）
- XHR init_script（session_runner.py:375，**page 级** init_script——新 page 既不继承也无复挂）
- replay_wait 的 request 监听（replay_wait.py:66-68）

`add_init_script` 在 Playwright 是 page 级；全仓仅 session_runner.py:375（AI 路径）与 manual_recorder/recorder.py:184（manual）两处调用。后果：SUT 新开 tab/弹新窗口后，**XHR api 反馈、dialog 处置、（若新增）console 反馈全部静默失效**。修法=manual_recorder 的 `ctx.on('page')` 复挂模式（context 级监听或逐 page 挂载）。

### G3（P1）api 反馈的三个盲点

1. **非 JSON 错误响应体不可见**：JS_TAKE_API_ERROR_TEXTS 对响应体做 `JSON.parse` 失败即 `continue`（js_snippets/step_notice.py:105-113）——**503/502 HTML 错误页对 step-feedback 完全隐形**。实证代价：D2 SUT 503 空转事件（#925，31m18s/10 步参数级重复空转，agent-log 在案）正是这类盲区。
2. **omit_api_if_ui 抑制**：有 toast 或 form 反馈时丢弃全部 api 项（step_feedback.py:53-57；dialog 不计入 has_ui）。设计意图是去重降噪，但「toast 已报 + api 详情」同现时会丢接口侧信息。
3. MAX=20 环形缓冲（xhr_log.py:34）：长步多请求时可能滚掉未读记录（seq 游标读法不受影响，但 seq>20 增量窗口外的记录会丢）。

### G4 原生 alert/confirm/prompt 被静默吞掉

factory.py:375-397 `_dismiss_native_js_dialogs` 一律 `dialog.accept()`（:384），文案只写 stderr——agent 永远看不到弹窗内容，confirm 恒为 true。与 MCP 的「dialog 阻断式必须处理」相反。改动需谨慎（自动 accept 是防挂死的既有决策），最低成本改法=把 dialog 文案也塞进 step-feedback（kind=dialog）。

### G5 prompt 过期文案 3 处（一行级修订，可与 P0 同 commit）

`agent-tools-common.md` 三处标「（接线中，若动作不存在先走 scan 兜底）」，但动作均已注册：`:64` list_todo_cards（_todo.py:17）、`:72` wf_submit_guard（_todo.py:40）、`:91` verify_context（_observe.py:36）。过期文案会引 agent 走更贵的兜底路径。

---

## 4. 修复建议（供接手 agent 直接立项）

**P0-A：console/pageerror 反馈通道（G1）**
- Python 侧：session_runner 启动时（同 network_capture 挂载点 session_runner.py:365 附近）`page.on('console')`（只收 type='error'）+ `page.on('pageerror')`，写入 per-page 环形缓冲（建议 Python 侧 deque，上限 ~20，clip 200 字符）；step_notice.py 的 scan_and_emit_step_notices 增读该缓冲产出 `kind=console` 反馈项，走既有 cue 注入路（step_notice.py:301 同款）。不新增动作、不恢复已删动作。
- 若用 JS 侧钩子（window.onerror/unhandledrejection 注入 `__notify_log` 或新游标 log）也可行，但 page.on 是标准做法、不受导航重注入影响（G2 修掉后按 page 复挂）。

**P0-B：context 级复挂（G2）**
- 参照 manual_recorder/recorder.py:82/213-214/242：`ctx.on('page')` 对每个新 page 复挂 console/pageerror 监听 + `add_init_script`（XHR hook）+ dialog handler。注意 network_capture/replay_wait 是否一并收编由实施时评估（牵动面大，可只做新通道）。

**P1-C：非 JSON 错误体兜底（G3.1）**：httpFail 且 body 非 JSON 时，用 `status + url` 生成兜底文本（如 `api:HTTP 503 <url 路径>`），防 503 类静默空转。

**P1-D：omit_api_if_ui 口径评估（G3.2）**：建议至少保留「api 错误 + toast 错误」并存（只抑制 api 成功类），改动前先看 characterize-step-feedback 对该函数的断言（step_notice.py:106-108 附近）。

**P1-E：prompt 3 行修订（G5）**：删三处「接线中」括注（同 commit 过 §5 pin 检查——agent-tools-common.md 有多个 pin 断言其文案，见 §5）。

**不建议**：恢复 read_xhr_log / read_error_notify 动作（pin 反断言在位，属有意设计）；cue 硬约束化（动作层拦截）——误拒风险未评估，需单独讨论。

**验收设计建议**：新增 characterization pin（登记 ui 域，与 step-notice-scan 同域）：断言 scan_and_emit_step_notices 消费 console 缓冲、cue 文案含 console 类条目、page 复挂逻辑存在；真机湿测一步：在 SUT 触发一个 console.error，观察下一步记忆 cue 出现 `console:err:`。

---

## 5. 护栏与验收（护栏盘点由子智能体全量核对过）

### 5.1 改 step_notice 链路必须同 commit 更新的 pin（均已注册 verify-all）

| pin | 域 | 断言要点 |
|---|---|---|
| characterize-step-notice-scan（cold/characterize-step-notice-scan.py，ui 域 verify-all.sh:251） | ui | step_notice.py:62,111（rewind/append/format 调用、无「【页面通知】」）、js_snippets/step_notice.py:30-44（导出与扫描目标）、recorder.py:130/131（_emit_step_notice_scan 导入调用）、recorder_emitters.py:132、_js_snippets.py:141 re-export、feature_flags 默认开 |
| characterize-step-feedback（cold/characterize-step-feedback.py，ui 域 verify-all.sh:252） | ui | `_step_feedback_xhr_cursor` 键、omit_api_if_ui 在 scan 路径、JS_TAKE_API_ERROR_TEXTS 返回形状 `{seq,len,texts}` 且 snippet 不含 `responseBody:`、_observe.py 有 read_step_feedback 且**不得**再出现 read_error_notify/read_xhr_log、agent-tools-common.md 断 `[step-feedback]`+`read_step_feedback`+`ok-closed` |

### 5.2 连带高风险 pin（动 recorder.py / recorder_emitters.py / _observe.py / prompts 时会红）

characterize-ops-step-line（core）、characterize-phase-runtime（phase）、characterize-replay-cancel-awareness（core+executor）、characterize-sut-spin-guard（phase）、characterize-recorder-phase-reset（phase）、characterize-phase-boundary（phase）、characterize-probe-donelog-and-suspect-noise（phase+misc）、characterize-field-value-match（fill+select）、characterize-real-click（click）、characterize-search-then-click-prompts（click+misc）、characterize-picker-atomic-recording（select）。

### 5.3 未注册但仍在的护栏（verify-all 不跑，动了照样红于验收流程）

characterize-error-notify、characterize-semantic-fixes、characterize-xhr-log、characterize-phase-overlay-buttons.mjs、characterize-recorder-emitters-url-capture、characterize-sut-spin-guard-live、characterize-close-dialog、characterize-set-vue-model、characterize-strip-dialogs、characterize-scan-assign-region-once。

### 5.4 两个坑

1. **`verify-all.sh --changed` 映射盲区**：`scripts/agent/*`、`recorder.py`、`prompts/*` 映射到 core+phase 域，`js_snippets/*` 映射到 xpath 域——但断言本链路最重的两个 pin 在 **ui 域**。改本链路文件后请手动 `bash scripts/refactor/verify-all.sh ui`（或全量），勿信 --changed。
2. **js_snippets 三个文件均为手写源**，无生成链（唯一 JS→Py 生成链是 `_locator_helpers_py.mjs` → `_locator_helpers_js.py`，与本任务无关，勿混淆）。

### 5.5 验收命令

```bash
bash scripts/refactor/verify-all.sh ui          # 微步（本链路域）
bash scripts/refactor/verify-all.sh             # 合并后验收必须全量（硬约定）
# 行为 pin：characterize-step-notice-scan / characterize-step-feedback 均在 ui 域内
```

---

## 6. 边界与禁入区（2026-09-23 调研时点）

- **工作区他线在途 WIP（禁入，动前先与该线协调）**：`scripts/agent/service.py`、`scripts/characterization/characterize-ops-page.mjs`、`scripts/kb/recall.py`、`src/dao/remote-session-dao.js`、`data/kb/flows/product_library.json` 及 `src/dashboard/ops-console/*`、`src/routes/v2/agent-stderr.js`、`src/routes/v2/kb.js`、`src/services/agent-stderr-log-service.js`、`src/services/kb-flow-cards.js` 等共 14 文件未提交改动。**注意 `scripts/agent/service.py` 恰在链路上**（hook 挂接点 service.py:640），实施前必须确认该 WIP 已合流。
- **禁入区**：回放线（`_replay.py` / 各 *Engine，用户明确搁置）；引擎 worktree（D:\dev\JS-gen-engine，verify-phase-token 在途）。
- 主检出分支：`uara_V2.0_dev`（每日 pull 上游即它）；**09-23 下午盘点：本地 ahead 12 / behind 6，pull 被他线 WIP 挡住（唯一冲突文件 `scripts/agent/service.py`）**。⚠️ behind 的 6 条提交（录制旁路门禁+按需识图 `51b4360c`、识图辅助开关 `79631d3b`）触及 recorder.py / recorder_emitters.py / feature_flags.py / agent-core.md / verify-all.sh 并新增 pin `characterize-record-sidepath`——**与 §5 护栏区高度重叠，实施前必须先 pull 并复核 §5 pin 清单**（本报告的 pin 盘点基于未含这 6 条的状态）。
- 本报告为调研产出，未 commit（他线 WIP 占工作区，避免卷入）；接手 agent 可随其开工提交一并入库。

## 7. 证据强度声明

- 「补齐后通过率会涨」是**机制推断，无本仓 A/B 实证**；录制通过率类指标验证成本高（参考 KB A/B 教训：n=12/臂只能测出 ≥30pp 差异）。G1/G2 的收益有间接实证（D2 SUT 503 空转 #925、manual_recorder 挂 console 的历史动因），量化收益待湿测观察。
- Playwright MCP 对标分析中「纪律已具备」部分曾有一处过度表述已收回：观察纪律 prompt 早已存在（agent-prompt.md:15-16、agent-tools-common.md:86-102），非待补项。
