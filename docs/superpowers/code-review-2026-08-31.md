# 代码审查报告（2026-08-31）

> 方法：4 个只读 Explore 子智能体并行静态审查，文件集互不重叠（routes / services+基础设施 / Python agent / 仓库卫生横切面）。
> 范围：工作区全部源码（排除 node_modules、logs、tmp）。
> 性质：静态审查发现，**修复前须逐条实锤验证**；P0 已派发修复（见文末），P1/P2 待排期。
> 汇总口径：P0 = 正确性/安全缺陷须立即修；P1 = 质量债应尽快修；P2 = 风格/次要。

---

## 一、P0（已派发修复）

### 安全类

| # | 位置 | 问题 | 修法 |
|---|------|------|------|
| P0-1 | `config/.env.example:59,81-84,95` | 真实凭据入库：`MINIO_SECRET_KEY=tansun@123` 为真实密码；内网 MinIO 地址、公网 DB IP 47.101.58.49 + root、弱 token `devtoken123` 均在被 git 跟踪的文件中（与既有 .env 泄漏事故同类习惯） | example 占位化；**MinIO 密钥与现网 EXECUTOR_TOKEN 须人工轮换（仓库外动作）** |
| P0-2 | `src/routes/browser-session/register.js:131,138`、`heal-instruction.js:266-279` | `rerun` 的 `log_file`/`action_file` 直接 `path.resolve(PROJECT_DIR, …)` 后 `readFileSync`，无目录包含校验 → 路径遍历读任意文件，且内容经 SSE 回传客户端 | resolve 后校验路径位于 PROJECT_DIR 内，否则拒绝 |
| P0-3 | `src/routes/setup.js:22` | `POST /api/setup/save` 无鉴权即可覆盖 `.env`（写入 LLM API Key / 网关地址） | 仅允许本机回环调用或加首次配置 token |
| P0-4 | `src/routes/v2/auth.js:24` | `auth/me` 的 `await getAccessUser(token)` 无 try/catch 也未用 asyncHandler，rejection → unhandledRejection（与 2026-08-29 事故同型） | 包 asyncHandler |

### 正确性类

| # | 位置 | 问题 | 修法 |
|---|------|------|------|
| P0-5 | `src/routes/browser-session/register.js:262-290` | DELETE `/api/browser/browser`：30s 强杀分支先 `res.json('closed (force killed)')`，进程 `exit` 事件再 `res.json('closed')` → `ERR_HTTP_HEADERS_SENT` 可崩进程；两分支重复 8 行清理 | exit 回调判 `res.writableEnded`；抽公共 cleanup |
| P0-6 | `scripts/state.py:421` | `title.replace(r'\s+', ' ')` 用原始字符串做**字面量**替换而非正则折叠空白 → 标题含换行/多空格时 popup_key 不稳定 | `re.sub(r'\s+', ' ', title).strip()[:40]` |
| P0-7 | `scripts/session_runner.py:346-361` | `_ensure_browser_and_cdp`（190-240）已完整等待 CDP ready 并返回，`run_session` 312 行拿到返回值后 347-361 行原样重算（含 45s `_wait_cdp_http`），最坏双重等待 90s 且返回值被覆盖 | 删除重复段，直接用 312 行返回值 |

---

## 二、P1 摘要（按区域）

### src/routes（重构收尾 + 复制粘贴）

- 两套同名 `asyncHandler` 行为分叉：`src/http/app-error.js:96-105` vs `src/routes/v2/trajectory-shared.js:22-31`（后者附加 holders/rejected/graceUntil，前者丢弃）→ v2 错误响应形状不一致。
- 60+ 老路由（trajectory/memory/remote-session/system-mgmt/messages 等 10 文件）仍手写 try/catch + 裸 `{error}` 响应，asyncHandler 迁移收了一半（hierarchy、operation-component、system-ref-data、trajectory-batch 已迁）。
- `export-mgmt.js`（802 行）：`/transactions` 与 `/transactions-v3` 两个 ~150 行 handler 逐行复制；`maybePushSingle` vs `maybePushSingleV3` 90% 重复；「err instanceof AppError ? throw : 重包装」try/catch 复制 8 次。
- `register.js`（672 行）：`save-business-data` 往共享 `gb.process.stdout` 挂 per-request 监听器，并发请求交叉响应（第三处复制的 stdout 解析器）；删除会话构造的归档 record 从未落库却响应 `archived`；`runSessionStep` 不 await 不 catch。
- `export-mgmt.js:296`：push 成功后 `markExported` 失败 → 客户端收 500 但实际已推送，无幂等标记，重试重复推送。
- `llm-proxy.js:23,49`：`/models` fetch 无 AbortSignal.timeout（上游挂起占死连接）；错误响应回显内部 `LLM_BASE_URL`。
- `system-mgmt.js`：头注释宣称统一信封 `{code,message,data}`，实际全部裸 `res.json`；`startScan(...).catch(() => {})` 完全吞错。

### src/services + 基础设施（并发/生命周期）

- `menu-scan-job.js:47-77`：startScan 单飞检查与赋值间隔 3 次 await → TOCTOU 双开扫描。
- `remote-session-service.js:409-421`：attach 失败路径直接 close 不清挂载 → trajectory.remote_session_id 幽灵（用户持续看到 409 占用）；`attachLive`（281-431）对共享 Map 多步读改写未包 `withTrajectoryLock`。
- `server.mjs:182-185`：`server.timeout/requestTimeout/headersTimeout` 全部置 0 → slowloris 可长期占连接。
- `executor/spawn-agent.js:63-79`：`netstat | findstr :922` 子串匹配（922 命中 19222/92220）→ 可能误杀无关进程。
- `menu-scan-apply.js:138-139`：phase2 fallback 合并只重指向 `trajectory` 未重指向 `batch_recording_job`，RESTRICT 外键令事务回滚。
- 巨型函数：`trajectory-recording-runner.js:261-813`（~550 行）、`replay-batch-runner.js:78-550`（~470 行，8 处重复退出样板）。
- `config/database.js:33`：`DB_POOL_MAX` 代码默认 '10'，与池 max=20 的预期不符（环境变量缺失时上限只有 10）。
- 其他：`server.mjs` gracefulShutdown 未关 httpServer/WSS/registry；`agent-process.js` POSIX killTree 因未 `detached:true` 静默失败且与 `executor/spawn-agent.js` 双源；`dedup.js:65-103` 导出面疑似死代码；`ws-server.js` broadcast 无 try/catch；`scanJobs` Map 只增不删。

### scripts/ Python agent

- `_misc.py:734,754`：f-string 拼 `{amount}` 进 `page.evaluate` → 协议层唯一 JS 注入面（入口 `int()` 强转即可）。
- `recorder.py:198`：裸 `except: pass`（吞 KeyboardInterrupt）。
- `agent/service.py:300-318 vs 378-401`：max_steps 预算解析复制粘贴两份，`empty_buffer` 死变量；`_run_agent_step_prepare` 343 行。
- 拆分遗漏的 200+ 行函数 6 个：`form_scan_actions.py:5908`（click_save 491 行）、`_misc.py:397`（335）、`form_save.py:30`（452）、`autofill_round.py:144`（369）、`form_action_engines.py:458`（352）、`event_dispatch.py:41`（264）。
- 其他：`session_runner.py` CDP watcher 异常路径硬编码重置 source='agent' 污染标记；`state.py:727` 结果为 False/0 时记为空串丢语义；`memory/writer.py` 只 flush 不 shutdown 队尾事件可能丢；replay 每事件重建 controller registry。

### 仓库卫生

- `README.md:390`、`AGENTS.md:44` 引用已不存在的 `scripts/smoke/accept-replay-apis.mjs`。
- migrations：2 组重复时间戳前缀（20260818120000×2、20260819000000×3）；14 个存量迁移无幂等保护（新版已用探测式写法，存量有 knex 记录兜底，保持现状即可）。
- 11 个文件被跟踪却与 .gitignore 冲突（`.idea/*`×7、`scripts/smoke/*`、`.codex/config.toml` 等）；`docs/*` 忽略+反向白名单交错易误伤。
- `tmp/db_newpass.txt`（未入库）含疑似线上库明文密码 `NEWPASS=...`，须确认已轮换或清理。
- `undici ^8.3.0` 全仓仅 discover.js 一处使用，可移除。

---

## 三、正面确认（审查通过项）

- **注入面干净**：SQL 全部 knex 参数化/事务，未发现拼接；spawn/taskkill 参数均为数字或常量。
- **.env 本体未泄漏**：config/.env 未被 git 跟踪，全历史无记录；logs/、tmp/（200+ 临时文件）均未入库。
- **8-29 事件枢纽事故已闭环**：waitForSessionEvent 自免疫在各调用点落实到位。
- **Python 协议层健壮**：stdin JSON Lines 对畸形行/EOF 处理到位；js_snippets 动态值一律经 `xpathLiteral`/JSON.stringify，无模板注入。
- **依赖精简**：dependencies/devDependencies 划分正确，无废弃包。
- 迁移后期质量高（探测式幂等、注释详尽），seeds 幂等。

---

## 四、建议修复顺序

1. ~~P0-1 凭据轮换 + example 占位化~~（占位化已派发；**轮换是仓库外人工动作，未完成**）
2. P0-2/P0-3 两个安全端点（路径遍历 + setup 鉴权）
3. P0-4~P0-7 一行级正确性修复
4. P1 渐进收尾：asyncHandler 迁移完成 + 双 asyncHandler 收敛 → menu-scan TOCTOU / attachLive 幽灵挂载 → export-mgmt 拆分 → 两个巨型 runner 拆分

## 五、P0 修复派发记录（2026-08-31）

按 docs/orchestration 规范（文件集不相交、提示词自包含、共享文件归主线程）派发 3 个 general-purpose 子智能体：

| 子任务 | 可写文件集 | 覆盖 |
|--------|-----------|------|
| A-node-routes-p0 | register.js、heal-instruction.js、setup.js、v2/auth.js | P0-2/3/4/5 |
| B-python-p0 | scripts/state.py、scripts/session_runner.py | P0-6/7 |
| C-env-example | config/.env.example | P0-1（占位化部分） |

集成验证（主线程）：`bash scripts/refactor/verify-all.sh` + `npm run lint` + 语法/越界复核。凭据轮换（MinIO、现网 EXECUTOR_TOKEN）为仓库外人工事项，**不在本次修复范围**。

### 派发结果（2026-08-31 回收）

3 个子任务全部完成、blockers 为空、无越界改动。主线程逐文件 diff 复核通过：修复均最小侵入、无误删无关代码；`node --check`/`py_compile`/模块 import 全过；lint 0/0（顺带清掉 `partner-platform.js` 2 个存量 JSDoc warning，恢复 0/0 基线）。

verify-all 有 2 个失败项，**经 stash 对照实验确认均为存量问题、与本次 P0 改动无关**（干净树上同样失败；且两个特征化脚本不引用任何被改文件）：

1. `characterize-export-v3`：抽样 rect 与 DB bbox 一致（42/115）——读远程库（47.101.58.49）真实数据对拍，疑为数据漂移或另一会话推送所致，需会话负责方核对。
2. `characterize-system-import-json`：pageType pin 期望 managePage、实际 guidePage——**派发期间另一并行会话已在修**（正在改 menu-json-import.js 与该特征化脚本），由其收尾。

⚠️ 本次执行期间确认有并行会话在同一工作区活动（CHANGELOG.md / menu-json-import.js / characterize-system-import-json.mjs / api-docs/overview.js 有未提交改动），提交前须先协调。

## 六、P1 第一轮修复派发记录（2026-08-31）

用户指定 5 项，按文件集不相交派发 5 个并行子智能体，全部回收、blockers 为空、无越界改动：

| 子任务 | 文件集 | 结果 |
|--------|--------|------|
| P1-A attachLive 幽灵挂载 | remote-session-service.js | 失败/超时路径补 `clearOwnershipOnClose`；attachLive 关键段包 `withTrajectoryLock`，并改为 AsyncLocalStorage 可重入包装（真实串行仍由 state.js promise 链承担，主线程已核实链路健康） |
| P1-B executor 误杀 | executor/spawn-agent.js | `findstr :922` 子串匹配改为 `parseListeningPids` 精确解析（`:(?!\\d)` 数字边界），真实 netstat 样本对拍通过 |
| P1-C 双 asyncHandler 收敛 | http/app-error.js + v2/trajectory-shared.js | respondError 透传 5 个扩展字段（AppError.body 优先）；sendErr/asyncHandler 薄委托单源；status-only 错误的 500 语义用 options.status 显式保留 |
| P1-D 老路由迁移 | v2/ 10 个文件 | 约 84 个 handler 迁移至 asyncHandler；形状特殊的错误体用 `AppError(msg,{status,body})` 显式保留；multer 回调与 5 个 sendErr 端点按规则保留；无 no-op 文件 |
| P1-E export-mgmt 去重 | v2/export-mgmt.js | 802→659 行；V2/V3 handler 合并为参数化工厂；push 函数合并；8 处 try/catch 收敛为共享 helper（**未按原建议直删**——重包装块保护的是非 AppError 的 statusCode/自定义字段，直删会改状态码，改为收敛保留） |

集成复核（主线程）：19 个改动文件 `node --check` 全过；lint 0/0（partner-platform.js 两个 JSDoc warning 在 stash 实验中丢失，已重打）；verify-all 仅剩 1 个失败 = 已知存量项（characterize-export-v3 的 rect 远程库对拍 42/115），system-import-json 已由并行会话修复。**本文件第一节表格中的 P0-1~P0-7 与本节 5 项均已修复，待统一提交。**

### P1 剩余待办（后续轮次）

- menu-scan TOCTOU、menu-scan-apply fallback 漏重指向（第一轮未纳入，用户指定范围外）
- server.mjs 超时收紧、llm-proxy timeout/脱敏
- Python：_misc.py scroll int() 强转、recorder.py 裸 except、agent/service.py 预算段收敛、6 个 200+ 行函数
- characterize-export-v3 rect 对拍 42/115 存量失败：需核对远程库数据漂移（非代码问题）
