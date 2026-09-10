# KB 价值 A/B（方向 2）— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 12 条真实需求 × 2 臂的对照录制，测出"注入流程卡提示"对录制成功率与成本的影响，并留下可复算的原始证据。

**Spec:** `docs/superpowers/specs/2026-09-11-kb-value-ab-design.md`
**已知事实（reviewer 实测）:** 需求池 `batch_recording_item.requirement` 去重 **36 条**；recorded+completed **345 条 / 均 27 步**；LLM 778ms、SUT HTTP 200、库经 SSH 隧道、Playwright+Chrome 就绪、本地控制面未起。

## Global Constraints

- **不改产品代码**（`src/**` 零改动）；提示块用既有 `buildFlowTemplateHint` 产出，本线只做装配与收数。
- SUT 共享：写入数据一律 `KBAB<runId>-` 前缀；只做可回滚操作；跑完清理并留证；**不动他人 `KB测…` 遗留**。
- 单条串行、固定账号、成对同窗、臂顺序交替；失败不重试（例外须标 `retryOf`）。
- 冻结后不改臂定义/卡映射/需求集（改动 = 新 manifest 版本）。
- 一 Task 一 commit；开工/收工按 agent-log 协议。

---

### Task 0: 需求集与卡映射冻结（T0，**先做 pilot 判定**）

- [ ] **Step 1**: 从库导出去重后的 36 条需求（只读）：`SELECT DISTINCT requirement FROM batch_recording_item WHERE requirement <> ''`
- [ ] **Step 2**: 人工筛 **12 条可跑需求**（标准：能在测试环境完整跑、可回滚、不涉敏感数据、单条 ≤10 分钟）；每条给出：需求文本、模块、预期终点、清理动作
- [ ] **Step 3**: **需求→卡映射**：为每条需求指定**正确的流程卡**（离线人工，参照 `data/kb/flows/*.json` 的 `flow/aliases/menu_path`；**禁用 v2 评测集**）
- [ ] **Step 4**: 写 `scripts/kb/kb-ab-manifest.v1.json`（含臂分配/顺序/账号/前缀/清理清单/`frozenAt`/`changeLog`）
- [ ] **Step 5**: **pilot 2 条 × 2 臂**（+可选 C 臂 2 条）→ 记录 A 臂成功率
- [ ] **Step 6**: **天花板判定**：A 臂 ≥0.9 → 按 spec §4 换难度锚（真实失败族），重写 manifest v1.1；否则进 Task 1
- [ ] **Step 7**: Commit（manifest + pilot 原始记录）

**DoD**：manifest 里每条需求可追溯到库里的原始 `requirement`；卡映射每条都能在 `data/kb/flows` 找到；pilot 结果与天花板判定写进报告草稿。

---

### Task 1: 运行装配（不改产品代码）

- [ ] **Step 1**: 写装配脚本 `scripts/kb/kb-ab-setup.mjs`：按 manifest 调产品 API（`POST /api/v2/trajectories`）建轨迹；**B 臂**用 `buildFlowTemplateHint` 生成提示块并前置到首个 phase description（与 `prepare` 注入格式一致）；**A 臂**不加
- [ ] **Step 2**: 臂标记：在轨迹 `name` 上写 `KBAB<runId>-<arm>-<reqId>`，**description 里不写臂标记**（避免 agent 看见元信息）
- [ ] **Step 3**: 干跑校验：建 2 条（A/B 各 1）→ dump 出 description，断言 B 含 `【流程卡模板】`、A 不含，其余文本逐字相同（**这是本线的纯度断言**）
- [ ] **Step 4**: Commit

**DoD**：`A.description === B.description.replace(hintBlock, '')` 逐字成立。

---

### Task 2: 跑批（人机协作）

- [ ] **Step 1**: `npm start` 起控制面 + executor + Chrome；确认 4097 与 executor 就绪
- [ ] **Step 2**: 按 manifest 顺序逐条跑：`prepare` → 录制台执行 → `record/stop`；每条记录 trajectory id 与起止时间
- [ ] **Step 3**: 每条跑完立即执行该需求的清理动作；把清理结果写回 manifest 的 `cleanupLog`
- [ ] **Step 4**: Commit（`tmp/kb-ab/runlog.jsonl`，一条 run 一行）

**DoD**：24 条（pilot 另计）全部有 id 与结果；无 `KBAB` 前缀数据残留。

---

### Task 3: 收数引擎 + 协议门禁

- [ ] **Step 1**: `scripts/kb/kb-ab-eval.mjs`：按 manifest 收 P1–P6（成功、步数、phase、墙钟、manual 步占比、error 步数、遵循度、越界），`--json`；同一输入连跑两次逐位一致
- [ ] **Step 2**: `scripts/characterization/characterize-kb-ab.mjs`：① manifest 形状与冻结校验；② **配对完整**（每条需求两臂都有且 id 不同）；③ **臂平衡**（两臂条数相等）；④ **无跨臂污染**（B 的 description 含标记、A 不含，且臂外文本逐字相同）；⑤ 收数完备（每条 id 都能在库查到）；⑥ **不设成功率 floor**
- [ ] **Step 3**: 证伪自证（必做）：把某条 run 的臂标记改掉 → ④ 必红；从 manifest 删一条 run → ② 必红；两次输出贴进 commit message
- [ ] **Step 4**: Commit

**DoD**：门禁绿，且两条断言各被证伪一次。

---

### Task 4: 报告

- [ ] **Step 1**: `docs/superpowers/reports/2026-09-11-kb-ab-report.md`：**原始逐 run 表**（id/臂/需求/结果/步数/时长）+ 每臂成功率 + 差值 + Wilson CI + 成本对比 + 遵循度/越界 + 天花板说明 + 明确的"证据不足"边界
- [ ] **Step 2**: 结论只写三类：① 大效应成立；② 无差异；③ 证据不足（并给出若要下结论所需的 n）
- [ ] **Step 3**: Commit

---

### Task 5: 台账

- [ ] **Step 1**: agent-log 收工 + todo-list 更新
- [ ] **Step 2**: Commit

---

## DoD 矩阵

| Task | 验收 | 期望 |
|---|---|---|
| 0 | manifest | 12 条需求 + 卡映射可追溯；pilot 天花板判定已记录 |
| 1 | 纯度断言 | A/B description 除提示块外逐字相同 |
| 2 | runlog | 全部 run 有 id/结果；无残留数据 |
| 3 | 门禁 | 绿 + 两条断言各证伪一次；引擎两次输出一致 |
| 4 | 报告 | 原始逐 run 表 + CI + "证据不足"边界 |
| 5 | 台账 | 一致 |

## Reviewer Checklist

1. **纯度**：reviewer 亲自 diff A/B 的 description（除提示块外必须逐字相同），并确认臂标记没进 description；
2. **收数**：reviewer 用自写探针按 id 独立收一遍 P1/P2，与报告逐位比对；
3. **样本完整性**：逐 run 核对 `aborted`/重试的登记，确认没有"按结果剔除"；
4. **清理**：查库确认无 `KBAB` 残留、未动他人 `KB测…` 数据；
5. **边界**：`src/**` 零改动、未使用 v2 评测集需求。
