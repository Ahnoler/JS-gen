# 产品要素库原子重录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 按 spec 创建 T1–T4 原子草稿并串行湿测录制（fid=9000000468）。

**Architecture:** 参考遗留 → 写 task → analyze/create draft → prepare/start/detach ×4 → through-report。

**Tech Stack:** `/api/v2/trajectories/analyze|POST|record/*`，account=2，stamp `20260908-elem`。

## Global Constraints

- 只读 #61/#66/#503；不改引擎；不录产品侧 0740 要素配置。
- 图标新增走 tooltip；验收认 stamp/toast。

---

### Task 1: 任务文案 + 建 4 条 draft

**Files:** Create `tmp/product-element/task-T1.md` … `task-T4.md`；API 建 traj

- [ ] 写 T1–T4 task（含硬门闩、stamp、图标纪律）
- [ ] 各 `POST /analyze` → `POST /trajectories`（functionId=9000000468, systemAccountId=2）
- [ ] 记下 traj ids → `tmp/product-element/traj-ids.json`

### Task 2: 串行录制 T1→T4

- [ ] 每笔：prepare（timeout≥600）→ start 全 phaseIds → 轮询 stderr/phases → detach
- [ ] 失败则停该笔、写报告，不盲开下一笔（T2 失败则 T3/T4 改用已有类型或中止）

### Task 3: 验收报告 + agent-log 收工

- [ ] `tmp/product-element/through-report.md`
- [ ] agent-log 收工；commit 文档（tmp 可不上库）

## Spec coverage

| Spec | Task |
|---|---|
| T1–T4 原子 | 1–2 |
| 0468 挂载 | 1 |
| 护栏/验收 | 2–3 |
| 不碰遗留 | Global |
