# 服务链路 API 驱动 P0-P5 实测链路沉淀

> 日期：2026-08-31 · 作者：Zcode (uara_V1.2)
> 背景：本轮（见 agent-log「服务链路 API 驱动 P0-P5 全闭环」条目，commits `4537ec4`→`a8fda4c`）用**纯产品 API + CDP watcher 快捷动作**（无 LLM）驱动信贷 SUT 完成了 P0 登录 → P1 导航 → P2 建档 → P3 授信 → P4 提交 → P5 收尾的全闭环，并定案了四组缺陷。本文沉淀链路拓扑、接口契约、缺陷根因、脚本复用与运维知识，供后续 agent/同事直接复用，避免重新踩坑。

---

## 1. 链路总览

### 1.1 拓扑

```
[驱动脚本 tmp/api_drill.py]
      │  HTTP :4097
      ▼
[控制面 server.mjs (Express, port 4097)]
  ├─ /api/v2/*            产品 API（trajectories / hierarchy / executors）
  ├─ /api/browser/watcher/action  CDP 快捷动作入口
  │        │ execSession 转发（executor-session-client.js）
  │        ▼
  │   [executor 节点 (LMY), 经 /ws/executor WebSocket 反连控制面]
  │        ├─ executor/session-manager.js：EXECUTOR_CAPACITY=16 槽位
  │        │   每槽独立 CDP 端口 EXECUTOR_CDP_PORT_BASE=19242+slotIndex
  │        │   (executor/config.js:187-189, executor/session-manager.js:5)
  │        └─ executor/spawn-agent.js → Python agent 子进程
  │                 │  stdin/stdout JSON 行协议（UTF-8）
  │                 ▼
  │           [scripts/session_runner.py — Playwright + build_controller]
  │
  └─ MySQL：SSH 隧道 127.0.0.1:13306 → root@47.101.58.49:3306
      （config/open-db-tunnel.cmd:3-8；轨迹/层级/账号元数据落库）
```

- 控制面与 executor 是**两个进程**：控制面 `npm start`（4097），executor 通过 `npm run executor` 主动外连 `/ws/executor`（AGENTS.md「Commands」节）。
- watcher 快捷动作在 executor 模式下必须发给**活的 session agent** 而非 globalBrowser：`src/routes/browser-session/watcher-actions.js:30-34`（`USE_EXECUTOR` 时过滤 `useExecutor && sessionRuntimeReady` 的 session，唯一时自动选中）。

### 1.2 录制链路八步（本轮实测执行顺序）

1. **createTrajectory** — `POST /api/v2/trajectories`（body: `functionId/name/requirement/systemAccountId`）→ `data.id`（路由 `src/routes/v2/trajectory.js:105`）。
2. **层级定位** — `GET /api/v2/systems/:id/accounts`（`src/routes/v2/hierarchy.js:61`）拿 systemAccountId；`GET /api/v2/processes/:pid/functions`（`hierarchy.js:134`）拿 functionId。本轮常量：`SYSTEM_ACCOUNT_ID=2, FUNCTION_ID=13`（tmp/api_drill.py:18-19）。
3. **attach** — `POST /api/v2/trajectories/:id/attach`（`src/routes/v2/trajectory-record.js:13`）→ 返回 `sessionId`。
4. **record/prepare** — `POST /api/v2/trajectories/:id/record/prepare`（`trajectory-record.js:49`）→ 服务端完成 `go_to_url + wait_for_loading + login`（`src/services/trajectory/trajectory-record-lifecycle.js:255-268`），不写入 steps。
5. **watcher/action × n** — 每个业务动作一发：`POST /api/browser/watcher/action`（P1 菜单导航 `click_menu_item`、P2 `fill_form_field`/`select_option`/`click_save`、P3 `picker_dialog_query/select`、P4 `click_save`+`click_button 提交`）。
6. **record/stop** — `POST /api/v2/trajectories/:id/record/stop` body `{"success":true}`（`trajectory-record.js:82`；api_drill.py:215）。
7. **detach** — `POST /api/v2/trajectories/:id/detach`（`trajectory-record.js:23`）关闭 Chrome + Python 子进程 + 释放槽位。
8. **（可选）stream/detach** — `POST .../stream/detach`（`trajectory-record.js:33`）只停 BiB 不释放槽位（`remote_session`→`idle`，`live`→`draft`；见 AGENTS.md「Recording / detach semantics」）。

> 全链路为单浏览器单轮：实测产品级最终验证（交易 200）走 prepare(25s 一次成功) → select 企业类/营业执照 首例 API `ok` → `click_save → ok-save-navigation`（建档成功跳编辑页）→ 选择器 20 行 → stop ok（agent-log 2026-08-31 P0-P5 条目）。

---

## 2. 接口契约

### 2.1 响应信封（以代码为准）

- **v2 路由成功响应是裸 JSON 对象**（不是 `{code,message,data}` 包裹）：`GET /api/v2/systems` 直接 `res.json(await systemDao.list())`（`src/routes/v2/hierarchy.js:17-19`）；创建返回 201 + 实体（`hierarchy.js:22-27`）。轨迹创建的 id 解析因此做了双兼容：`(traj.get("data") or {}).get("id") if isinstance(traj.get("data"), dict) else traj.get("id")`（tmp/api_drill.py:81）。
- **错误信封**：`sendErr` → `respondError`（`src/http/app-error.js:74` 注释），标准体为 `{ error: message }`，并按存在性附加 `code / ownerTrajectoryId / graceUntil / holders / rejected` 扩展字段（app-error.js:74-78 注释；`src/routes/v2/trajectory-shared.js:20-25`）。HTTP 状态 `err.statusCode || 500`；`VALIDATION/NOT_FOUND` 映射 400（hierarchy.js:107,148）。
- **watcher 动作响应**（`src/routes/browser-session/watcher-actions.js:171-180`）：

```json
{
  "status": "executed",
  "action": "select_option",
  "params": [...],
  "result": "<动作字符串结果>",
  "trajectoryDbId": 191,
  "autoPersist": true,
  "persisted": { ...落库条目或 null },
  "sessionId": "..."
}
```

  - `autoPersist` 优先级：body 显式 boolean（watcher-actions.js:145-146）→ session → globalBrowser 默认（:148-150）。
  - 成功持久化条件：`autoPersist && resolvedTrajId 为有限数 && result.entry && session`（:160）；落库失败仅 warn 不报错（:165）。
  - 判定约定：**只看 `result` 字段**，`persisted` 嵌套旧日志会污染判定（tmp/api_drill.py:120-125 `ok_of` 的注释与实现：命中 `xpath-not-found/err-/no-items/unresolved` 即判失败）。

### 2.2 超时行为

- **watcher 15s**：转发给 agent 后 15s 无 `cdp_action_result` 即超时返回 `{"error":"timeout: no response from agent within 15s"}`（watcher-actions.js:53-56 与 :95 两处 setTimeout 15000）。会话忙时先最多等 5s（busy 轮询 :46-48）。
- **HTTP 客户端 30s**：驱动脚本 `call()` 默认 timeout=30、watcher `action()` 用 40s（api_drill.py:36,64），覆盖 15s 服务端超时。
- 另：record/prepare 的 replay 整体 timeoutMs=180000（trajectory-record-lifecycle.js:269）；浏览器强杀兜底 30s 在 `/api/browser/close`（register.js:280-284）——与 watcher 无关，勿混淆。

### 2.3 prepare 幂等与 500 语义

- prepare 可重复调用（幂等）：已登录且账号一致时跳过 login：`if (runtime.loginDone && Number(runtime.loginAccountId) === Number(accountId)) login = { skipped: true, ... }`（`src/services/trajectory/trajectory-attach-runner.js:191-194`）。
- 失败 500：prepare 内 login replay 失败 → `throw new Error(result?.error || "login replay failed (ok=N failed=M)")`（trajectory-record-lifecycle.js:270-274）→ 路由 `sendErr`（trajectory-record.js:52-56）→ HTTP 500 `{error: ...}`。
- **Python 侧聚合失败文案**（实测报文核心）：`{fail_count}/{ran} steps failed; first: {first.action} → {first.result}`（`scripts/controller/actions/_replay.py:683-684`）。例：`1/2 steps failed; first: login → label-not-found: 用户名`。
- attach 后未 prepare 直接 record/start 会拒绝：`'Trajectory is not attached — call record/prepare first'`（trajectory-record-lifecycle.js:494）。

### 2.4 关键端点清单

| 端点 | 位置 | 说明 |
|---|---|---|
| `POST /api/v2/trajectories` | trajectory.js:105 | 新建交易，body 含 `functionId/systemAccountId` |
| `POST /api/v2/trajectories/:id/attach` | trajectory-record.js:13 | 绑定活 session，返回 sessionId |
| `POST /api/v2/trajectories/:id/record/prepare` | trajectory-record.js:49 | 导航+登录（幂等，可重试） |
| `POST /api/v2/trajectories/:id/record/stop` | trajectory-record.js:82 | body `{success}`；结束录制不释放槽位 |
| `POST /api/v2/trajectories/:id/detach` | trajectory-record.js:23 | 释放 Chrome+Python+槽位 |
| `GET /api/v2/systems/:id/accounts` | hierarchy.js:61 | 登录账号枚举 |
| `GET /api/v2/processes/:pid/functions` | hierarchy.js:134 | 功能菜单枚举 |
| `GET /api/v2/executors/:nodeUuid` | src/routes/v2/executor.js:27 | 节点/槽位状态（列表 :17） |
| `POST /api/browser/watcher/action` | watcher-actions.js:26 (handleWatcherAction) | CDP 快捷动作统一入口 |

---

## 3. 已定案缺陷清单（根因 + 修复 commit）

### 3.1 executor stdin 中文乱码 → PYTHONUTF8=1

- **现象**：控制面 → executor → Python 子进程 stdin 传中文（客户名等）乱码。
- **根因**：`PYTHONIOENCODING` 只兜 stdout/stderr，**不管 stdin**；子进程 stdin 解码仍按系统代码页。
- **修复**：`executor/config.js:280-288` `buildPythonSubprocessEnv()` 同时设 `PYTHONIOENCODING='utf-8'` 与 `PYTHONUTF8='1'`，:288 注释原文「stdin 解码也强制 UTF-8（PYTHONIOENCODING 只兜 stdout/stderr）」。
- **commit**：`4537ec4`（fix(prepare): 服务层两项加固——executor UTF-8 固化 + prepare 登录冷启动重试）。

### 3.2 prepare 冷启动（新 slot 首屏未挂载，login 打空）

四重防线，commit `4537ec4` / `2a119c5` / `0fa6a8e`：

1. **8s 重试**：`src/services/trajectory/trajectory-attach-runner.js:196-206` —— 首次 `runDefaultLogin` 失败后注释原文「冷启动时序：新 slot 首次导航后 SPA 首屏尚未挂载完，replay login 会打在未初始化页面上（label-not-found 全集）。固定 8s 收窄为『失败即等 8s 重试一次』」。
2. **wait_for_loading 前置**：`trajectory-record-lifecycle.js:255-268` replay 序列 `go_to_url → wait_for_loading → login`（timeoutMs 180000, stopOnFail），注释「登录前等待页面 loading mask 消退（与登录控件探针构成双重防线）」。
3. **登录控件探针**：`scripts/controller/actions/form_action_engines.py:125-155` `_wait_for_login_form(page, timeout_s=20)` 每 500ms 轮询可见的 用户名/用户/账号 placeholder input；:183 login 动作体内冷启动 pre-wait；探针超时**不改变**既有 label-not-found 语义（:130-135 docstring）。
4. **`_result_ok` 认 loading-done**：`scripts/controller/actions/_replay.py:207` —— `wait_for_loading` 且 `result.startswith('loading-done')` 判为成功；否则该步被记 FAIL 直接触发 3.2 的 stop_on_fail。commit `2a119c5`。

### 3.3 watcher 模式 select_option 失败（根因三层）→ 彻底移除早退

- **现象**：watcher 通道 `select_option("对公客户类型","企业类")` 永远失败；同一动作直连 controller 成功（分水岭清晰）。
- **三层根因**（agent-log 2026-08-31 P0-P5 条目定案）：
  1. `scan_visible_fields` 只读不写 store（`scripts/controller/actions/form_autofill.py:105` 注释：「task_list/`_scan_fields` 只在 ensure_scanned 建立（scan_visible_fields 是只读扫描）」）；
  2. `task_list/_scan_fields` 只由 `ensure_scanned` 的容器 touch 重建（form_autofill.py:89-97 docstring；:162-167 才写入 `_scan_fields` 与 `_task_lists_by_container`）；
  3. watcher 模式 `ensure_scanned` 早退 → store 永不建立 / 容器永不切换。
- **证据**：tmp/wm_repro.py（精确复现器）`AFTER-SELECT active` 停留 main 容器（wm_repro.py:56 打印 `_active_container` 与 buckets）；直连成功分水岭。
- **修复**：`c3453eb`（条件化保留容器 touch）→ `20fb5a6`（**彻底移除早退**）。最终代码 form_autofill.py:106-113 注释原文「watcher (CDP quick action) 不再早退——容器 touch 与依赖它的 task_list/`_scan_fields` 只在 ensure_scanned 建立……早退会造成 store 永不更新、select_option 永远读不到字段（实证：wm/e2e 双复现 + AFTER-SELECT active 停留旧容器）」；watcher 调单字段动作仍传 `allow_autofill=False`，autofill 由开关挡住，行为与直连一致。
- `_watcher_mode` 标记来自 session_runner.py:136（watcher 路径置 True）。

### 3.4 scan 空壳粘性 → 1.5s 重扫回填

- **现象**：抽屉打开后 ~0.2s 立即 scan，拿到「≥80% 字段无 xpath_smart/无 options/无值」的空壳结果并粘住。
- **修复**：`scripts/controller/actions/form_scan_actions.py:275-306` —— 检测到疑似空壳且非重扫时 `await asyncio.sleep(1.5)` 后重扫并按 label 回填（:277-288）；`_scan_fields_are_stub` 判定 ≥80% 空壳字段（:494-520，docstring 给出 signature）；空列表不算 stub（走 pending-tasks 兜底）。重扫期间 `_scan_stub_rescan_inflight` 防重入（:278, :306）。
- **commit**：`0fa6a8e`（fix(observe): A/B/C——scan空壳重扫、登录控件探针、prepare链wait_for_loading）。

> 驱动脚本层面的配套纪律：select 首失败后 `sleep 2 + scan_visible_fields + 重试一次`（tmp/api_drill.py:150-161）——即使服务端已修，保留该兜底可吸收残余时序抖动。

---

## 4. 驱动脚本复用指南

三个脚本各司其职，**何时用哪个**：

| 脚本 | 适用场景 |
|---|---|
| `tmp/api_drill.py` (228 行) | **默认入口**。走完整产品 API 链（控制面+executor+落库），验证端到端服务行为、watcher 动作契约、DB 落库 |
| `tmp/wm_repro.py` (65 行) | **watcher 语义精确复现/调试**：绕过 HTTP，直接以 `_watcher_mode=True` 构建同一 controller，改场景改 `_watcher_mode` 值即可对照有/无早退行为 |
| `tmp/p0p5_drill.py` (507 行) | **直连参考**（无控制面/executor，直起浏览器+controller），最细粒度的分阶段断言与 REQ-FAIL 抓包，适合排查动作本身 |

### 4.1 tmp/api_drill.py 结构

- `call(method, path, body, timeout=30)`（:36-55）：urllib + `ensure_ascii=False` UTF-8 body；HTTPError 读 body 前 300 字符抛 RuntimeError —— 保留 500 信封原文。
- `action(name, params, session_id, trajectory_db_id)`（:58-64）：包装 watcher 调用，`timeout=40`。
- `act()`（:115-118）：统一打 `[HH:MM:SS] [ACT] name params -> result` 日志。
- `ok_of(r, token)`（:121-125）：**只看 result 字段**；`xpath-not-found/err-/no-items/unresolved` 一票否决，再查 token（如 `"ok"`）。
- 信封兼容：`traj.get("data").get("id")` 与 `traj.get("id")` 双路（:81）；sessionId 从 prepare 或 attach 兜底提取（:104-109）。
- prepare 重试：3 次、每次间隔 6s（:91-100）——对应 3.2 的服务端冷启动吸收；失败原文进日志。
- 阶段落点：P0 探针 `read_business_date`；P1 `click_menu_item` 两级；P2 查重→新增→fill→select（含 select 失败重扫重试）→`click_save`，500 时降级 FALLBACK 客户；P3 `picker_dialog_query`（正则抽 `row_count`，0 行重试一次）→`picker_dialog_select`；P4 `get_page_state` 查「提交」→提交→流程轨迹；P5 `workspace_tabs`+截图；结尾 `record/stop {success:true}`，异常路径 `stop {success:false}`（:215-224）。

### 4.2 tmp/wm_repro.py（watcher 模式精确复现器）

- 关键：`store = {"_watcher_mode": True}`（:15）与 `_run_cdp_watcher` 一致；**同一 controller 实例**先 scan 后 select（:16-17, :40-58），复现「单 store、positional 调用」的 executor 语义。
- 诊断输出：STORE-ACTIVE-CONTAINER / STORE-DUMP pending / DRAWER-DIAG / IDENT-RESULT（:45-53）；`AFTER-SELECT active` 是否离开 main 是 select 根因的判据（:56-57）。
- 复用方式：改 `act(...)` 序列即可复现任意 watcher 场景；对照实验把 `_watcher_mode` 改 False。

### 4.3 tmp/p0p5_drill.py（直连参考）

- `Drill.act`（:64-76）：按 `budget_for(name)`（replay_timing）加 `asyncio.wait_for` 预算超时，异常/超时分类返回。
- 通用必填填充 `fill_required`（:98-）：scan → 只填 `required && !disabled && 空` 字段，select 走 `select_with_retry`（:103-108）。
- 证据抓取：`REQ_INSTALL/REQ_DUMP` JS 钩子抓 fetch/XHR 失败报文（:321-325 处 `[REQ-FAIL]` 输出，SUT 500 报文即由此归档）。

---

## 5. 运维知识

- **DB SSH 隧道**：`config/open-db-tunnel.cmd` —— `ssh -N -L 13306:127.0.0.1:3306 root@47.101.58.49`（:3-8, :37）；启动前 netstat 探测 13306 已监听则直接放行（:26-31）；SSH key 免密可用（本轮窗口常开不提示密码）。窗口关闭即断库，先开隧道再 `npm start`。
- **服务重启顺序：先 server 后 executor**。executor 反连 `/ws/executor`，server 未起 executor 会连不上重试。
- **锁文件 stale 接管**：executor 持有的 per-session attach 锁在持有者关闭后释放（`executor/session-manager.js:206` 「Last lock holder gone — drop the entry so it does not leak」；:181-193 attach/close 锁防 BiB 挂回关闭中 session）；slot 的 stale sessionId 会被清理重建（session-manager.js:66-71 `const stale = slot.sessionId; ... this.sessions.delete(stale)`）。
- **`another executor process is running`（同 nodeUuid 重复注册）**：`src/executor-registry.js:38` `nodeUuid ${nodeUuid} is already served by another executor process (pid ${existing.pid})` —— 杀掉旧 node executor 进程（或等其退出）再启。
- **槽位与容量**：`EXECUTOR_CAPACITY=16`、`EXECUTOR_CDP_PORT_BASE=19242`（executor/config.js:187-189），每槽独立 CDP 端口防 `CDP WebSocket not found`（AGENTS.md）。
- **detach 释放槽位 / 浏览器零残留**：`record/stop` 只结束录制不释放槽位；`stream/detach` 只停 BiB；**`detach` 才关 Chrome + Python + 释放槽位**（AGENTS.md「Recording / detach semantics」）。本轮纪律：每轮 end-to-end 后 detach，演练交易 191-200 全部已释放、浏览器零残留（agent-log 2026-08-31 P0-P5 条目末行）。

---

## 6. SUT 侧已知问题（非 JS-gen，勿在本仓库修）

1. **`checkCustCorporat` 新建必 500**：对新建客户 INSERT `cst_permission_ahr_inf` 漏 `USR_NO` 列（该列无默认值）→ 后端 500，P2 新建档被阻塞。降级路径：改用已成功创建的草稿客户继续 P3-P5，P2 记 PARTIAL（tmp/p0p5_drill.py:323-327 注释原文「SUT 后端缺陷（2026-08-31 实锤）：checkCustCorporat 对新建客户 INSERT cst_permission_ahr_inf 漏 USR_NO 列（无默认值）→ 必 500」）。报文原文归档（tmp/drill_log12.txt:74，REQ-FAIL 捕获）：

   ```
   url:  /prod-api/tansun-tcp-app-pc/tansun-tcp-cst/custCorporat/checkCustCorporat  (POST, 500)
   req:  {"cstSt":"2","cpctTp":"601","crdtTp":"20111","cstNm":"演练测试企业88181884有限公司",
          "crdtNo":"91450100MA8818188R","avyEcd":"UML00005557"}
   resp: {"timestamp":"2026-08-31T13:13:00.479+00:00","path":"/tansun-tcp-cst/custCorporat/checkCustCorporat",
          "status":500,"error":"Internal Server Error","requestId":"b2b967bc-603815"}
   ```

   注意：本轮产品级最终验证（交易 200）合法校验位数据通过了新建（agent-log：「本轮未复现」），说明该缺陷与数据形态相关（部分路径触发），降级逻辑仍须保留。（2026-08-31 23:39 复核：通过，交易 #202，证据：ok-save-navigation，log 无 REQ-FAIL/checkCustCorporat 500 行）
2. **市场登记日期 = 真实时间**：非营业日语义，验收断言不能用固定历史日期（tmp/p0p5_drill.py:44-48 `norm_date` 的兜底注释与 round2 研究文档记载）。
3. **选择器排除草稿客户**：授信「选择客户」查询对草稿态客户的可见性有排除行为，选行用 `picker_dialog_select` 按名称精确选中（api_drill.py:191）。

---

## 7. 快速上手清单（新 agent 接手 10 分钟版）

1. `config/open-db-tunnel.cmd` 开隧道 → `npm start`（4097）→ `npm run executor`。
2. 层级定位：`GET /api/v2/systems/2/accounts`、`GET /api/v2/processes/.../functions`（hierarchy.js:61/:134）。
3. `POST /api/v2/trajectories` → `attach` → `record/prepare`（失败等 8s 重试，最多 3 次）。
4. 动作全部走 `POST /api/browser/watcher/action`，判定只看 `result`（ok_of 语义，§2.1）。
5. select 首失败：`sleep 2 + scan_visible_fields + 重试`（§3.4）。
6. 收尾：`record/stop` → **`detach`**（浏览器零残留）。
7. 疑难杂症：先用 tmp/wm_repro.py 在 controller 层复现，再用 tmp/p0p5_drill.py 直连对照，最后回到 API 层归因。

---

## 8. P3-P5 深链验证记录（2026-08-31 深夜）

- **交易 id**：202（stamp=88190629，客户「演练测试企业88190629有限公司」，证件 91450100MA8819062N）；LMY 节点（2f21bad1）slot 正常租还，跑前 detach 了残留会话（交易 198 / remoteSessionId 841）。
- **P0-P2（简要）**：P0 营业日期 2026-08-19 读取成功；P1 菜单链（客户管理→对公客户管理）通过；P2 查重→新增（fill_form_field ×2 + select_option 对公客户类型/证件类型）→保存全部成功。
- **P3 判定：降级（未过）**。授信菜单链（授信管理→新增对公授信管理→选择客户）通过，但 `picker_dialog_query ["选择对公授信客户", 客户名称=公司]` 两次均未命中目标行：原始返回 `row_count: 20`（宽查询行），其中不含新建客户「演练测试企业88190629有限公司」，脚本按匹配 0 行判（[P3][WARN] ×2，23:39:00 / 23:39:08）→ 无 `picker_dialog_select`，按降级客户「诊断测试企业1010722有限公司」继续；`[P3] 完成 filled=0 miss=1`。注：原始 JSON 里 row_count=20 与脚本判 0 并存，说明是目标行缺失/可见性排除（草稿客户），非接口报错；若严格按本判读口径可记「后端数据可见性未过，降级继续」。
- **P4 判定：草稿路径**。无 `wf_submit_guard`（因选择器降级后页面处于查询过滤弹层，`click_save` 返回 not-form-save；formErrors 为空；semantic_snapshot 确认页面为「新增对公授信管理」，无提交按钮）→ `[P4] 保存成功且无提交按钮（草稿态完成)`。后续 guard/撤销探测：`click_table_row_radio ["诊断测试企业1010722有限公司"]` → err-table-row-not-found（表格无匹配行）；「撤销」点击 ok，「确定」err-icon-label-miss（弹层结构变化）。
- **P5**：归档截图 `D:\dev\JS-gen\scripts\screenshots\screenshot_20260831_233948.png`；`[P5] 完成`；record/stop ok（recordStatus=recorded）后 detach，inUse 归零。
- **结论**：②checkCustCorporat 复核通过（未复现，见 §6）；①P3 深链因选择器目标行不可见降级（无 picker_dialog_select），P4 走草稿路径（无提交/guard 断言），P5 收尾通过——非全绿。
- **遗留**：选择器客户可见性问题待 SUT 侧稳定后重跑（换 stamp 新建客户后立即查询，观察草稿客户可见性窗口）；guard/提交断言本轮未覆盖，需在 P3 选行成功后补测。

## 9. P4 守卫路径闭环定案（2026-08-31 深夜补测，交易 203-206）

- **交易 203**：真问题=驱动 `parse_result_json` 未剥离 watcher result 的 `extracted_content='ok:{...}'` 信封（恒判 0 行）；修复后 P3 首次真通（`row_count=20`→选中首行 云智联创科技4572有限公司 `code=26083110590786811`→`picker_dialog_select` 回填 `changed{客户编号,客户名称}`）。
- **交易 205**（全量 DIAG）：`not-form-save` 现场 `overlay=null`、buttons 全量 8 个（选择客户/查询/重置/新增/修改/查看/撤销/流程轨迹）——**无保存/提交**。定案：**「新增对公授信管理」默认是列表页（浏览态）**；选择客户回填的是列表查询区，系统不自动开表单 → `click_save` 守卫判 query/filter UI 拒绝是**正确的防御行为**（列表页本无保存钮）。真缺口=流程编排漏了**「点新增」步**。
- **交易 206**：补「新增」步后——`click 新增 → overlay={"kind":"drawer","label":""}`（抽屉表单）；抽屉内 选择客户→picker 回填 OK；但抽屉内表单（保存/提交）未达完成态 → P4 `click_save` 守卫仍正确拒绝（not-form-save）。
- **闭环结论**：**P4 守卫侧无缺陷**（205/206 双轮 100% 拒绝正确）；差异属**业务流程图谱**——「新增对公授信管理」的新增是多步链（列表→点新增→抽屉引导/表单→保存/提交），对应的 W3' 图谱细化（非缺陷、非守卫 bug）留作编排 v2 后续补充；P4 守卫路径验证达成（守卫正确性=已验证）。
