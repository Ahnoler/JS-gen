# 产品要素库原子重录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 按 spec（修订 A）创建 T2–T4 原子草稿并串行湿测录制（fid=9000000468）；T1 废止。

**Architecture:** 参考遗留 → 写 task → analyze/create draft → prepare/start/detach ×3 → through-report。

**Tech Stack:** `/api/v2/trajectories/analyze|POST|record/*`，account=2，stamp `20260908-elem`。

## Global Constraints

- 只读 #61/#66/#503；不改引擎；不录产品侧 0740 要素配置。
- 图标新增走 tooltip；验收认 stamp/toast。
- **不重录 #693**；page-bind 读码路径必须关天元窗（empty-config 亦然）。

---

### Task 1: 任务文案 + 建 draft（已做；A 修订中）

**Files:** `tmp/product-element/task-T*.md`；API 建 traj

- [x] 写 T1–T4 task；建 #693–#696
- [x] `traj-ids.json`
- [ ] **A：** 废 `task-T1`；改写 `task-T2`（进入+双根前导）；PATCH #694 task + 重 analyze/sync phases

### Task 2: 串行录制 T2→T3→T4

- [ ] #694 prepare → start → detach（stepCount>0 + stamp 类型）
- [ ] #695 → #696 同上
- [ ] 失败则停该笔、写报告，不盲开下一笔

### Task 3: 验收报告 + agent-log 收工

- [ ] `tmp/product-element/through-report.md`
- [ ] agent-log 收工；commit 文档（tmp 可不上库）

## Spec coverage

| Spec | Task |
|---|---|
| T2–T4 原子（T1 废） | 1–2 |
| 0468 挂载 | 1 |
| 护栏/验收 | 2–3 |
| 不碰遗留 | Global |
