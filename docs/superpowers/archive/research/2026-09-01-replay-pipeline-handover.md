# 回放管线讲解材料（接手培训用）

> 2026-09-01 四路子智能体调研汇总。所有结论均有 file:line 依据；讲解时可直接引用。
> 一句话总纲：**回放 = 产品 API `steps/replay` 受理 → Node 编排逐批下发 `replay_actions` → executor WS 通道 → Python `_replay.py` 纯脚本执行（不走 LLM）→ 定位走 xpath_smart 语义链 → 结果回写 `trajectory_step.confirmed`，进度经 WS 广播。**

---

## 1. 端到端调用链（一张图讲完）

```
前端 / 演示脚本
  POST /api/v2/trajectories/:id/steps/replay   {stepIds, isReplay}   (src/routes/v2/trajectory-steps.js:20)
    └→ acceptTrajectoryStepsReplay             (src/services/trajectory/trajectory-session-replay.js:53)
        ├─ prepareReplayBatch (:172)
        │    ├ 必须已 attach（runtime.sessionId），否则 400
        │    ├ DB 取 trajectory_step，按 step_number/action_index 排序
        │    ├ 自动补 META_STEP_ACTIONS 检查点（save_form_snapshot）到选区
        │    └ session.busy 检查 → 忙则 409
        ├─ session.busy=true / abortReplay=false / suppressStepPersist（回放动作不再落新步）
        ├─ setImmediate 后台 runReplayBatch   (replay-batch-runner.js:78)
        └─ 立即返回 202 accepted（进度走 WS，不走 HTTP）

runReplayBatch（单轨迹批执行器）
  ├─ replay:started
  ├─ 菜单导航 navigateToFunctionMenu（menu-navigation.js，失败仅 warn 不阻断）
  ├─ 逐步循环：
  │    ├ emit replay:step {status:'running', index, total}   ← [N/M] 的来源，N=本批次第几步，M=本批次动作数
  │    ├ save_form_snapshot 步 → Type B 表单结构检查点（form-structure-heal.js:126）
  │    ├ 普通步 → runReplayActions(src/services/replay-actions.js, stopOnFail=true)
  │    │    └ forwardStdin/WS: replay_actions → executor → Python
  │    │         event_dispatch.py:211 → _replay.replay_action_entries (_replay.py:533)
  │    │         ← WS 'replay_done' {count, ok, failed, error, results, stoppedAt}
  │    └ 失败 → Type A 单步 AI 自愈：confirmed=0 → buildHealContract → heal-decision
  │         → runHealStep（最多 12 步，HEAL_MAX_STEPS, replay-heal-shared.js:15）→ 广播 recording:replay_heal
  └─ replay:finished {successCount, failedCount, failedStepIds}；finally 清 busy

结果落库：不新建任务表，直接写 trajectory_step.confirmed / confirmed_at
  markStepReplayOk / markStepReplayFailed (trajectory-step-service.js:63,:73)

停止：POST .../steps/replay/stop (trajectory-steps.js:43)
  → stopTrajectoryStepsReplay (session-replay.js:144)：abortReplay=true + forwardStdin cancel_step
  循环边界/执行后/heal 内多处检查 abort；幂等，不改 recordStatus
```

**要点（讲解时强调）：**
- 回放**不自己开 executor slot**——复用已 attach 会话的 session；互斥靠 `session.busy`（同时只能一个 AI 录制或一个回放）。
- **没有持久化任务队列**：steps/replay 是"即发即后台跑"；真正有排队的是批量录制 batch 管线（trajectory-batch-service.js，interval pump 5s + slot 租约），别混为一谈。
- 旧装配式回放（`/api/v2/trajectories/:id/replay/*`、`/api/test/assemble|run`）已整体下线；现在唯一产品路径是 live `steps/replay`（README:318-324）。

## 2. Python 执行引擎（scripts/controller/actions/）

| 文件 | 职责 |
|---|---|
| `_replay.py` (700 行) | 主循环 `replay_action_entries` + 直派动作注册表 |
| `replay_form_action.py` | 表单动作（fill/select/tree/radio） |
| `replay_click.py` / `replay_table.py` | 持久化点击 / 表格行 radio |
| `replay_js.py` (616 行) | `_JS_CLICK_DURABLE`、回读 JS blob |
| `replay_wait.py` / `replay_timing.py` | 保存后 idle 等待 / `ACTION_BUDGET_S` 预算表 |
| `replay_names.py` | 动作名归一化别名 |
| `js_snippets/` | JS 片段按 widget 域拆分，`_js_snippets.py` 聚合 re-export |

**主循环（_replay.py:533-700）：**
1. 入口置 `_watcher_mode=True` 抑制 auto-fill（回放期间不触发录制侧的自动填表）。
2. 每步：归一化动作名 → `_normalize_params` → 分派（直派表 / close 组 / 表单 / controller 注册表兜底）。
3. **每步后重新 `get_current_page()`**（tab 切换后 page 对象失效），每步前 `_wait_if_loading`（_helpers.py:293）。
4. 汇总 `{count, ok, failed, error, results, stoppedAt}`。

**单步示例链（fill_form_field）：**
`_replay_form_action → _try_xpath_fill(JS_FILL_BY_XPATH, 内含 LABEL_HINT_DISAMBIG) → 回读 _read_value_by_xpath → 空则 _read_value_by_label → _classify_fill_result（回读不等 → false_ok 判失败）`

**Element UI 关键实现：**
- **Native setter**：`js_snippets/fill_core.py:99-108`——原型 setter + 合成 input/change/blur 事件，绝不只靠 page.fill()。
- **el-select**：不用 Playwright selectOption；`select_trigger.py:263` 真实 mousedown/mouseup/click 开下拉，`select_option.py:5` 在下拉内点击选项（exactOnly 防漂移，no-items 时 reset→重触发最多 3 次），事后回读 + option-mismatch 校验。legacy 哨兵（first/any）只接受 `ok-already`，绝不自选第一项。
- 每步前 `reset_select_ui` 收起残留下拉。

## 3. 定位器链（讲解重点）

**生成链（单一语言面）：**
```
src/cdp/page-locator-helpers.js  ← 真源（PAGE_LOCATOR_HELPERS / JS_POLL_UTIL）
        │ node scripts/_gen_locator_helpers_py.mjs
        ▼
scripts/controller/actions/js_snippets/_locator_helpers_js.py  ← 生成物，禁止手改
（消费方：Node 录制注入 Runtime.evaluate；Python 回放 page.evaluate —— 同一套 JS）
```
手改生成物会在下次生成时被无提示覆盖，并造成录制/回放行为分叉。改法：改 JS → 跑生成器 → 提交两文件。

**xpath_smart 锚点优先级（录制期 dispatcher.js:31-215）：**
form label（精确匹配，含 */冒号剥离）> placeholder > 稳定属性（data-testid…id/name/aria-label/title）> 文本可点击兜底；容器 scope（dialog/drawer）+ occurrence `[n]`。

**消歧升级链（录制期 buildLocatorSnap，page-locator-helpers.js:1541-1716）：**
多命中时逐级：① region 锚 → ② titlebox 锚 → ③ page-state 锚（向导步/弹窗标题/抽屉标题/面包屑）→ ④ 兜底 [n]；每级都验证唯一命中才采纳；区域锚在仍不唯一则放弃导出，回落 xpath_full。

**回放期选取（`_resolve_replay_xpath`，_replay.py:317-333）：**
element.xpath_smart → xpath_full。**params.xpath_smart 被故意忽略**（历史脏参数教训，注释 :319-323）。

**点击阶梯 `_JS_CLICK_DURABLE`（replay_js.py:70-409）：**
xpath_smart（含可见弹层重写：`[last()]` 指向隐藏残留时改到 lastVisibleDialog/Drawer 内重试）→ 树节点 volatile strip（剥 `[V-x.y]`/`(N)`）→ 图标工具栏（el-icon class → hover tooltip 文本比对）→ 菜单/待办卡片 → 绝对 xpath → 文本（drawer→dialog→document，exact→fuzzy）→ Playwright get_by_role/get_by_text `.last` 兜底。

**Z 系列加固生效范围：**
- Z2 `resolveLocatorStrict` + Z4 弹层作用域闸：**代码强制，但仅挂在填表引擎**（form_action_engines.py:369-399，0 命中=strict-locator-not-found，多命中=ambiguous-locator 拒绝盲试）。
- semantic_snapshot / verify_context：agent 提示词层软约束，回放失败后由 heal 的 agent 重观察使用，非代码强制。
- 点击无 strict 闸，靠录制期 `locator_verified` + `_JS_CLICK_DURABLE` 文本一致性兜底。

## 4. 参数、状态与数据模型

| 参数 | 默认 | 位置 |
|---|---|---|
| stopOnFail | Node 侧全部显式 true → **steps/replay 语义=首败即停**（Python 签名默认 false 但被覆盖） | replay-actions.js:42, replay-batch-runner.js:197 |
| isReplay | true → suppressStepPersist，回放动作不落新步；is_replay 列已删（迁移 20260807160000） | replay-actions.js:43 |
| timeoutMs | REPLAY_STEP_TIMEOUT_MS=300000 | config/config.js:169 |
| HEAL_MAX_STEPS | 12；retry 上限 3 | replay-heal-shared.js:15 |

**表结构链：** `remote_session → trajectory → trajectory_phase → trajectory_step`（migrations/20260713190555）。回放核心字段：
- `trajectory_step.element_json`（JSON）——定位元数据载体（xpath_smart/xpath_full/formLabel/attr/rect_norm）。
- `trajectory_step.confirmed / confirmed_at`——回放结果直接回写此列（迁移 20260803110000）。
- `action_id` 唯一键（uk_traj_action）——控制面重启后幂等补写步骤的依据。
- 截图已从 BLOB 改 MinIO 引用（storage_type/storage_path，迁移 20260819000000）。

## 5. 必讲的已知坑（全部踩过）

1. **[N/M] 是本批次计数，不是轨迹总步数**——batch-runner 每步 emit index=i+1, total=actions.length。
2. **stop_on_fail 使每个失败步单独成批**——"1/2 steps failed" 是单批文案，别当全轨迹失败率。
3. **fill/回读不对称**：fill 可能落在 label/placeholder 分支，回读按同一 xpath 读空 → 假 false_ok。已有 `_read_value_by_label` 回退，但只接在主路径，label 分支与 select 回读仍不对称（残留）。
4. **params.xpath_smart 被忽略**是设计不是 bug（脏参数曾压过 element_json）。
5. **prepare 冷启动打空页面**：新 slot 首屏未挂载 → 登录全 label-not-found；8s 重试 + wait_for_loading + 登录控件探针四重防线（trajectory-attach-runner.js:196-206）。
6. **executor stdin 中文乱码**：须 `PYTHONUTF8=1`（PYTHONIOENCODING 不兜 stdin，executor/config.js:280-288）。
7. **回放等待 promise 孤儿超时**曾打崩进程；replay-actions.js 统一预挂 no-op catch。
8. **select_option fallback-first 伪成功**（wanted 不在下拉点首项报 ok）已双层根修。
9. 回放等待超时的语义 = **重观察再换定位，不是同参数重试**（replay_timing.py 预算表注释；声明先行，预算尚未接线）。

## 6. 演示路径（明天可现场跑）

无 CLI 一键回放命令；按 API 顺序演示（参考 `docs/superpowers/research/2026-08-31-api-drive-chain.md` §1.2 的 8 步闭环与 `tmp/api_drill.py`）：
```
create → attach → record/prepare（含登录）→ record/stop → steps/replay → 盯 WS replay:step → finish
```
产品入口：前端对已录制轨迹选步骤点回放；接口文档 http://localhost:4097/api/docs（replay 事件约定见 src/dashboard/api-docs/groups/recording.js:160-186）。

## 7. 推荐阅读顺序（给接手人）

1. README.md「### 回放」节 + 数据库模型节（概览）
2. `docs/superpowers/research/2026-08-31-api-drive-chain.md`（API 驱动全链拓扑 + 已定案缺陷清单）
3. 代码三入口：trajectory-steps.js:20 → replay-batch-runner.js:78 → _replay.py:533
4. 定位链：page-locator-helpers.js（buildLocatorSnap）+ replay_js.py（_JS_CLICK_DURABLE）
5. 坑史：CHANGELOG.md replay 条目 + 本材料 §5
