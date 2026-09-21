# 管线坑位（实测）

录制湿测管线中的常见坑与处置要点。操作员按 `dispatch-brief.md` 执行时须先读本节。

## prepare

- `POST /api/v2/trajectories/:id/record/prepare` **curl 超时 ≥600s**（租槽位 + 起 Chrome + 登录可能挂 10 分钟）。
- **只认 `ready===true`**：响应未就绪则停手回报，禁止继续 `start_record`。
- prepare 可能返回 CDP 端口；否则从 executor 状态查 `remoteSessionId` 所在 `slotIndex`。

## phaseIds

- `start_record` 请求体 `phaseIds` **必须是数据库数字 id**（`GET /api/v2/trajectories/:id` 的 `phases[].id`），**传 UUID 必 400**（#891）。
- `acceptedPhases` 只用 `analyze_trajectory` 结果；模型传入的 phases 忽略。
- 建单端点 `POST /api/v2/trajectories`（无 `/create` 后缀）；`create_trajectory` 参数必须是 `{}`（inputs 已由 `mark_inputs_ready` 锁定）。

## CDP 端口

- 默认 **CDP 端口 = 19242 + slotIndex**（每槽独立端口，避免 `CDP WebSocket not found`）。
- 若 prepare 响应已带端口，以返回为准；否则查 executor 槽位索引推算。
- `cdp_precheck` 前等页面稳定（约 30s）；枚举并关闭无关 `el-dialog` / `el-drawer` / 遮罩，可循环重跑直到干净。

## doneLogs 截断

- executor 源头对 `doneLogs` **约 400 字截断**，尾部不可恢复，标记 **`tailUnreliable`**。
- 勿依赖截断尾部做验收；结合 `poll-*.json`、`executor-main.log` 与落库 `steps[]` 交叉印证。

## 槽位释放

- **`detach` 才释放槽位**（Chrome + Python + executor slot）。
- `record/stop` 结束录制但**不**释放槽位；`stream/detach` 仅停 BiB，不关 Chrome。
- 管线末步必须 `detach_trajectory`，否则后续湿测可能无空闲槽。

## 值守与轮询

- `start_record` 期间每 **60s** 写 `poll-N.json` 并追加 `progress.log`；操作员**不在**轮询间隙改页面或改任务。
- 单次录制总长 **40 分钟**封顶；`start_record` 是同步长连，**curl/客户端超时 ≠ 失败**。超时后先 GET 轨迹状态；已在 recording 则**禁止再 POST**（#971）。
- 同一 action 参数级重复 ≥2 轮且当前阶段 `done_logs` 为空 → 立即 detach，结论 `BLOCKED_外部故障_SUT`（识别后移交引擎，不在此实现自旋守卫）。

## 日志取证时点

- **detach 前**：`GET /api/v2/recording/agent-stderr?trajectoryId=`（活跃期才有正文）。
- **detach 后**：该 API 变空；直读引擎 worktree `tmp/executor-main.log`，按 sid 过滤，摘录带行号与时间界（#970/#971）。重启会轮转日志。

## 工具顺序（不可跳步）

严格：`save_dispatch_brief` → `mark_inputs_ready` → `preflight_readonly` → `analyze_trajectory` → `accept_phases` → `create_trajectory` `{}` → `prepare_record` → `cdp_precheck` → `start_record` → `detach_trajectory` → `assert_steps` → `write_through_report`。

不可跳过 `analyze_trajectory` → `accept_phases` 再 create。  
`accept_phases` 前阶段粒度速查见 `phase-granularity.md`（勿把 engine-workaround 升格为铁律）。
