# 湿测派发 — {{PRODUCT_LABEL}}

## 固定参数

- 控制面：`{{BASE_URL}}`
- functionId：`{{FUNCTION_ID}}`
- systemAccountId：`{{SYSTEM_ACCOUNT_ID}}`
- 参考 traj：`{{REF_TRAJ}}`
- 证据目录：`{{EVIDENCE_DIR}}`
- phaseIds：须为 analyze 返回的**数据库数字 id**（勿猜 UUID）

## 业务目标

{{GOAL}}

落库级判据：动作名 + `paramsJson` / `elementJson` 字段须与目标一致（见 references/acceptance.md）。

## 风险预告

- 禁入：操作员不打开浏览器做业务点击；不 git commit；不改仓库。
- 遮挡弹窗 / 空查 / `already-operated-this-phase` → 停手或 `retry_new_traj`（须再次 `mark_inputs_ready`）。
- 假成功：约 1 分钟内全 phase_done 且 0 步 → `BLOCKED_`，勿报 DONE。
- 评级未生效、在途授信等前置未核 → `BLOCKED_前置未核`，禁止开单。
- 服务端拒绝为合法终局（`REJECTED_`）；不得伪造成功、不得擅自重录。

## 管线步骤

严格按序调用 recording-coach 工具（详见 references/pipeline-pits.md）：

1. `save_dispatch_brief`（本文件）
2. `mark_inputs_ready`（taskText 见 `task-text.md`，禁含 `POST /api/v2` / curl）
3. `preflight_readonly` — `GET /api/v2/executors` 须有空闲 connected 槽；probes 仅 GET `/api/v2/*`
4. `analyze_trajectory` → `accept_phases`
5. `create_trajectory` `{}`
6. `prepare_record` — 超时 **≥600s**，只认 `ready===true`
7. `cdp_precheck` — 端口 `19242+slotIndex` 或 prepare 返回端口
8. `start_record` — 值守上限 40 分钟，每 60s 落 `poll-*.json`
9. `detach_trajectory` — **detach 才释放槽位**
10. `assert_steps` → `write_through_report`

## 产出契约

- `through-report.md` — 完整验收叙述
- `close.txt` — 五行收尾（结论 / 报告 / 证据1–3）；**最后一条助手消息须与 close.txt 完全相同**
- 结论前缀仅：`CREATED_` / `REJECTED_` / `BLOCKED_` / `ERROR`
- 证据清单见 `evidence-checklist.md`；须含 `traj-final.json` 与至少一条 `poll-*.json`

关联 taskText 骨架：`{{TASK_BODY}}`（仅索引，正文在 `task-text.md`）
