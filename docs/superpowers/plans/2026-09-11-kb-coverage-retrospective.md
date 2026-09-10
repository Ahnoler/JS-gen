# KB 覆盖回溯 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从生产库只读快照出"真实录制 × 流程卡"的可复算数据，算出 M1–M6 六项覆盖指标与两张清单，固化成带脱敏断言的门禁。

**Architecture:** 三条映射链（页面码 ZJJK → FS 码 → 路由片段）把 416 条轨迹接到 84 张卡；快照**聚合+白名单脱敏**后冻结成 fixture；度量引擎离线复算；门禁管形状/脱敏/floor。

**Spec:** `docs/superpowers/specs/2026-09-11-kb-coverage-retrospective-design.md`
**基线事实（reviewer 已实测）:** 见 spec §2（416 轨迹 / 370 带 page_id / 11,114 步 / 84 卡 / 688 页 / 卡 markers 分布）

## Global Constraints

- DB **只读**（`SELECT` only）；不写库、不跑浏览器、不碰 SUT。
- **不改产品代码**（`src/**` 零改动）、不动评测集/阈值/`verify-all.sh`/`data/kb/req/**`；不碰他线 WIP。
- 脱敏白名单（spec §3）是硬约束：fixture 里出现白名单外的键或长自由文本 = FAIL。
- 一 Task 一 commit；开工/收工按 agent-log 协议；阈值只升不降。

---

### Task 0: 快照（DB → 脱敏 fixture）

**Files:** Create `scripts/kb/coverage-snapshot.mjs`、`scripts/characterization/fixtures/kb-coverage.v1.json`

- [ ] **Step 1: 起隧道**（口令由 Lead 提供，交互输入；不在任何文件里留口令）
  ```bash
  config\open-db-tunnel.cmd        # 或 ssh -N -L 13306:127.0.0.1:3306 -p 22 root@47.101.58.49
  ```
  连 `127.0.0.1:13306`，凭据取 `config/.env` 的 `DB_USER/DB_PASS/DB_NAME`。
- [ ] **Step 2: 快照脚本**：读 `trajectory`（白名单字段）、`trajectory_step`（**按轨迹聚合**成 `visited_regions` 序列 + `action_type` 计数）、`system_page`（`page_id/page_name/res_path`）；写 fixture（含 `snapshotVersion`/`capturedAt`/`changeLog`/行数/**内容 sha256**）。
- [ ] **Step 3: 自检**：fixture 体积 < 1 MB；`JSON.parse` 通过；白名单外键计数 = 0；>40 字自由文本计数 = 0。
- [ ] **Step 4: Commit**（fixture + 脚本；commit message 写明行数与 sha256）

**DoD**：fixture 入库且过三项自检；`covers = {trajectories: 416, withPageId: 370, steps: 11114}` 之类的计数与库一致（允许后续增量，须在 `changeLog` 记录）。

---

### Task 1: 度量引擎（M1–M6）

**Files:** Create `scripts/kb/kb-coverage.mjs`

- [ ] **Step 1: 映射实现**（三链，各自记命中来源；多标签 + `primaryCard`；歧义率单列）
- [ ] **Step 2: 指标实现**：M1 `joinability`、M2 `coverage`、M3 `utilization` + dead-card、M4 `uncovered` Top20、M5 `nodeCoverage/orderAgreement/offCardRate`、M6 `freshness` + 陈旧清单
- [ ] **Step 3: CLI**：`--fixture`（默认 v1）、`--json`、`--baseline <path>`（复用 `compareWithBaseline` 的口径：floor = baseline − margin）
- [ ] **Step 4: 跑出基线**：`node scripts/kb/kb-coverage.mjs --json > tmp/kb-coverage/baseline.json`
- [ ] **Step 5: Commit**

**DoD**：六项指标 + 两张清单可复现；同一 fixture 连跑两次输出逐位一致（确定性）。

---

### Task 2: 门禁 + 冻结

**Files:** Create `scripts/characterization/characterize-kb-coverage.mjs`

- [ ] **Step 1: 形状断言**：fixture 版本键齐、计数 > 0、`page_id` 集合与 `system_page` 交集 > 0
- [ ] **Step 2: 脱敏断言（硬）**：遍历整个 fixture 的键集合 ⊆ 白名单；统计长度 > 40 的自由文本 = 0；**这条必须能独立失败**（往 fixture 临时塞一个 `task` 字段 → 必红）
- [ ] **Step 3: floor**：M1/M2/M3/M5 四项以实测基线 − 不变 margin 为 floor（初始 margin 取 `0.05`，与既有评测体系一致），**只升不降**；M4/M6 是清单不进 floor
- [ ] **Step 4: 证伪自证**：把任一 floor 抬 0.2 → 门禁必红 → 还原 → 绿（把两次输出贴进 commit message）
- [ ] **Step 5: Commit**

**DoD**：门禁绿；脱敏断言与 floor 各被证伪一次。

---

### Task 3: 基线报告

**Files:** Create `docs/superpowers/reports/2026-09-11-kb-coverage-retro.md`

- [ ] **Step 1: 报告**：M1–M6 基线（含分母）、Top20 缺口清单（`page_id`×计数 + 页面名）、dead-card 清单、陈旧卡清单、映射链命中分布、歧义率
- [ ] **Step 2: 结论**：KB 的**实际覆盖边界**（哪些真实业务根本没卡）、**下一步该补哪些卡**（按真实使用频次排序）、以及"值不值得继续投"的证据
- [ ] **Step 3: Commit**

---

### Task 4: 台账

- [ ] **Step 1**: agent-log 收工 + todo-list 更新（本线状态与遗留）
- [ ] **Step 2: Commit**

---

## DoD 矩阵

| Task | 验收命令 | 期望 |
|---|---|---|
| 0 | `node scripts/kb/coverage-snapshot.mjs` | fixture 生成；白名单外键 0；>40 字文本 0；< 1 MB |
| 1 | `node scripts/kb/kb-coverage.mjs --json` ×2 | 两次输出逐位一致 |
| 2 | `node scripts/characterization/characterize-kb-coverage.mjs` | 绿；抬 floor → 红；塞 `task` 字段 → 红 |
| 3 | 报告 vs 引擎 | 六项数字逐位一致 |
| 4 | `git status` | 本线文件干净、无他线文件 |

## Reviewer Checklist

1. **脱敏**：reviewer 抽 10 条 fixture 记录回库比对字段级一致，并确认无客户名/证件号；
2. **指标**：reviewer 用自写探针独立复算 M1/M2/M3/M6，与交付逐位比对；
3. **门禁**：确认脱敏断言与 floor 都能被证伪（reviewer 亲测一次）；
4. **口径**：确认没有把 `task` 文本当匹配依据（那是 agent 口令体）；`function_id` 未被当作卡片映射；
5. **边界**：`src/**`、评测集、`verify-all.sh`、`data/kb/req/**` 零改动。
