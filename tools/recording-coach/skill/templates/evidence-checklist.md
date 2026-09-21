# 证据目录清单

每轮湿测须在 `{{EVIDENCE_DIR}}` 保留下列文件（失败轮次同样落盘）。

## 必留

| 文件 | 说明 |
|------|------|
| `workflow.json` | 相状态与 inputs 锁定记录 |
| `dispatch-brief.md` | 操作员五段式任务书 |
| `task-text.md` | 业务 taskText（含硬性门闩，无 API/curl） |
| `poll-*.json` | `start_record` 期间每 60s 快照 |
| `traj-final.json` | detach 后轨迹终态（含 `steps[]`） |
| `close.txt` | 五行收尾契约 |
| `through-report.md` | 完整验收报告 |

## 建议留

| 文件 | 说明 |
|------|------|
| `progress.log` | 轮询追加日志 |
| `analyze-*.json` | analyze / accept 响应 |
| `create-*.json` | create_trajectory 响应 |
| `prepare-*.json` | prepare_record 响应（含 `ready`） |
| `start-*.json` | start_record 响应 |
| `preflight-*.json` | preflight_readonly 结果 |
| `hypothesis.txt` | 可选假设标签（`init-evidence --label`） |
| executor 日志摘录 | `doneLogs` 注意 ~400 字截断 / `tailUnreliable` |

## 验收前自检

- [ ] `dispatch-brief.md` 五标题齐全（固定参数 / 业务目标 / 风险预告 / 管线步骤 / 产出契约）
- [ ] `task-text.md` 以 `【硬性成功门闩` 开头，≥80 字，无 `POST /api/v2` / curl
- [ ] `traj-final.json` 中 `steps[]` 含目标动作与字段
- [ ] `close.txt` 结论前缀为 `CREATED_` / `REJECTED_` / `BLOCKED_` / `ERROR` 之一
- [ ] 最后一条助手消息与 `close.txt` 逐字一致

参考：`references/acceptance.md`、`references/pipeline-pits.md`
