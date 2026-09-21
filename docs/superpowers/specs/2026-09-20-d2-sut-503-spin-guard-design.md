# D2 设计稿：SUT 服务端错误导致的阶段空转守卫（#925 续）

| 项 | 内容 |
|---|---|
| 状态 | **代码已实施（2026-09-21 引擎线，分支 `engine/d2-spin-guard-20260921`，默认 off，未合并待批）**；湿测验收（§8.1）待在线 SUT+执行机，实施记录见文末 §12 |
| 前置条件 | 在线 SUT + 执行机，可复现 #925 类 `Service Unavailable` 场景 |
| 关联 | D1（`de18502d`）已修复 already-matched `select_option` 跨阶段重复落库；D2 处理同一根因的另一面——目标不可达时 agent 仍持续空转 |
| 目标读者 | 后续负责实施/评审 D2 的 Agent/工程师 |

## 1. 术语表

| 术语 | 含义 |
|---|---|
| **SUT 不可达** | SUT 返回 503/504/Service Unavailable，或页面关键结构长时间缺失，导致 agent 动作无法产生有效业务结果 |
| **阶段无进展** | 在最近 N 个 agent 步骤内，没有新的字段被 `_task_done_impl` 标记为完成，也没有发生页面级导航/弹窗打开等可能改变任务状态的事件 |
| **软门闩** | 触发时给当前 phase 标记 `phase_error` 并附带独立 reason，但**不立即停止 agent**；用于观测阶段 |
| **硬门闩** | 触发时设置 `agent.state.stopped = True`，直接结束当前 phase |
| **观测模式** | 只打日志/事件，不改行为；用于收集误报率 |

## 2. 问题定义

### 2.1 #925 实证

- SUT 页面/接口返回 `Service Unavailable`（503），目标不可达；
- 当前机制：阶段仅有 **10 分钟无活动 idle watchdog**，但 agent 仍有 stderr/动作输出 → 不触发 idle；
- 结果：同一阶段空转到 `max_steps` 上界，#925 实测空转 **30 分钟+**，落下 **10 步**，最终 failed；
- 影响：资源浪费、轨迹被污染、等待时间长、回放也会继承这些空转步骤。

### 2.2 根因

agent 的动作循环没有**业务进展**感知：只要动作能执行（点击、下拉选择等），即使页面状态没变、字段没完成、SUT 持续报错，也会继续执行到 `max_steps`。现有的 `max_steps` 是硬性上限，不是智能止损。

## 3. 现有机制审计（为什么不足以解决 D2）

| 机制 | 作用 | 为什么解决不了 D2 |
|---|---|---|
| `_record_action` 连续同元素 coalesce（`scripts/state.py`） | 同源连续操作同一元素 → 保留后一条 | 只处理**连续**操作；跨步骤空转是**非连续**的 |
| `already-operated-this-phase` 阶段门（`controller/actions/phase/element_guard.py`） | 同阶段同一 identity 第二次成功写/选/点击 → 拒绝执行 | 按身份不分值、每阶段清零；对「SUT 503 导致所有动作失败重试」的场景不敏感 |
| `max_steps` + 步数上限（`scripts/agent/service.py`） | 硬性阻止无限循环 | 只是**最后兜底**，在到达上限前仍空转大量时间 |
| 10 分钟无活动 idle watchdog | 无任何动作/网络活动时触发 | agent 在 503 场景下**仍有动作输出**（重试、扫描等），不会触发 |
| D1 已匹配 select 去重（`de18502d`） | 去掉 already-matched 的重复落库 | 只减少**落库步骤数**，不阻止 agent **执行动作**和空转 |

## 4. 设计目标与非目标

### 4.1 目标

- 在 SUT 不可达 **且** 阶段无实质进展时，**提前结束 phase**，避免空转到 `max_steps`；
- 整个过程**可观测、可灰度、可回滚**；
- 不误杀正常长阶段（多轮填写、树搜索、分页选择等）。

### 4.2 非目标

- 不修改 LLM 系统提示（避免改变 agent 全量行为）；
- 不替代 `max_steps` 和 idle watchdog（只作为补充止损）；
- 不影响回放逻辑；
- 不影响人工录制路径；
- 不解决 SUT 本身不可用的问题（那是 SUT 侧故障）。

## 5. 判定模型

采用 **A + B 双条件同时成立** 才触发，避免单一条件误杀。

### 5.1 条件 A：SUT 不可达信号

按优先级分层检测，任一命中即认为条件 A 成立：

| 优先级 | 检测方式 | 实现位置建议 | 说明 |
|---|---|---|---|
| A1 | 页面 body/title 出现 `Service Unavailable` / `503 Service Unavailable` / `服务不可用` | `scripts/recorder.py` 的 `on_step_end` 中通过 `page.evaluate` 读取 `document.body.innerText` / `document.title` | 最直接，#925 有页面文本证据 |
| A2 | 最近 M 秒内所有接口调用返回 5xx（通过 `attach_network_capture` 写入 `business_data_store` 的网络状态） | 复用 `scripts/state.py` 或 `controller/actions/network_capture.py` 的捕获结果 | 页面未刷新但后端持续报错时使用 |
| A3 | 当前 URL 长时间停留在 SUT 错误页（如路径含 `/error`、`/503` 等，需产品化配置） | `on_step_end` 中检查 `page.url()` | 兜底，避免漏检 |
| A4 | 关键业务 DOM 连续 K 步缺失（如 `.el-form`、`.el-table` 等） | `page.evaluate` 检查标志性选择器 | 用于页面骨架都没加载出来的极端情况 |

**默认值建议（湿测后调优）：**
- A1 文本匹配：即时生效；
- A2 网络 5xx：最近 3 个步骤内 ≥2 次 5xx；
- A3 URL 错误页：连续 2 步；
- A4 DOM 缺失：连续 3 步。

### 5.2 条件 B：阶段无实质进展

**定义**：最近 N 个 agent 步骤内，同时满足：
1. `_task_done_impl` 没有新增任何字段完成（`task_list.done` 数量未增加）；
2. 没有发生页面级导航（URL pathname 变化，query/hash 变化不算）；
3. 没有打开新的弹窗/抽屉（container 切换事件，通过 `_switch_task_list_container` 可观测）；
4. 没有成功的保存/提交动作（`click_save` / `click_button` 返回成功且非 `already-operated`）。

**排除项**（避免误杀正常等待）：
- 当前步骤是 `wait_for_loading` 且仍在等待；
- 最近 N 步内有 `go_to_url` 或 `click_navigation`；
- 当前处于 query/filter 模式（`_is_query_mode` 为 True）；
- 当前处于 heal/replay 模式（D2 只影响录制）。

**默认值建议**：N = 5-8 步。

### 5.3 组合触发条件

```
触发 = 条件 A（SUT 不可达） AND 条件 B（最近 N 步无进展） AND 非排除项
```

## 6. 实现架构

### 6.1 Hook 点

推荐在 `scripts/recorder.py` 的 `build_recording_hooks().on_step_end` 中新增一个辅助函数 `_guard_spin_on_step_end(agent, business_data_store)`，调用位置在 `on_step_end` 的末尾、`_guard_done_on_step_end` 之前。原因：
- 该 hook 每步都执行，天然适合统计；
- 可直接访问 `agent.state.n_steps`、`business_data_store`、`_actions`、`_last_result`；
- 可通过 `agent.state.stopped = True` 停止 agent，符合现有模式；
- 不侵入 `controller/actions/` 业务引擎。

备选方案（记录在此，不推荐）：
- 在 `scripts/session_runner.py` 的 `_run_step` 外层检查：太粗，无法拿到每步动作结果；
- 在 Node 控制面监听 `action_log_sync`：无法读取 `business_data_store` 的 task_list 进展。

### 6.2 状态机

```
[phase start]
   │
   ▼
[观测/正常执行] ──A+B 成立？──否──▶ [继续下一步]
   │
   是
   ▼
[触发 spin guard]
   │
   ├─ 模式=observation ──▶ 只发 [spin-guard] observed 日志，继续执行
   ├─ 模式=soft ─────────▶ 设置 business_data_store['_spin_guard_soft_triggered']=True
   │                        本 step 结束时 emit phase_error(reason='sut_unavailable_spin_guard')
   │                        并停止 agent
   └─ 模式=hard ─────────▶ 设置 agent.state.stopped = True
                            emit phase_error(reason='sut_unavailable_spin_guard')
```

### 6.3 新增/修改文件清单

| 文件 | 变更 |
|---|---|
| `scripts/recorder.py` | `build_recording_hooks().on_step_end` 中调用 `_guard_spin_on_step_end`；新增该辅助函数 |
| `scripts/controller/actions/task_completion.py` | 可选：`_task_done_impl` 增加每步完成数字段写入 `business_data_store['_tasks_done_this_step']`，便于无进展统计 |
| `scripts/state.py` | 可选：`_record_action` 在记录导航/保存/container 切换类动作时写入 `business_data_store['_last_progress_step_num']` |
| `scripts/characterization/characterize-sut-spin-guard.py` | 新增 pin（见 §8） |
| `scripts/refactor/verify-all.sh` | 注册新 pin |
| `docs/superpowers/specs/2026-09-20-d2-sut-503-spin-guard-design.md` | 本文件（已存在） |

### 6.4 配置与默认值

通过环境变量控制，便于灰度和回滚：

| 环境变量 | 取值 | 默认值 | 说明 |
|---|---|---|---|
| `SUT_SPIN_GUARD_MODE` | `off` / `observation` / `soft` / `hard` | `off` | 阶段 1/2/3 开关 |
| `SUT_SPIN_GUARD_PROGRESS_WINDOW` | 正整数 | `6` | 条件 B 的 N 步窗口 |
| `SUT_SPIN_GUARD_503_TEXT_WINDOW` | 正整数 | `1` | 条件 A1 连续命中步数 |
| `SUT_SPIN_GUARD_NET_5XX_WINDOW` | 正整数 | `3` | 条件 A2 观察窗口 |
| `SUT_SPIN_GUARD_NET_5XX_THRESHOLD` | 正整数 | `2` | 条件 A2 窗口内 5xx 次数阈值 |
| `SUT_SPIN_GUARD_DOM_MISSING_WINDOW` | 正整数 | `3` | 条件 A4 连续缺失步数 |

### 6.5 事件与日志

触发时统一输出：

```
stderr: [spin-guard] <mode> phase=<phase> step=<n_steps> reason=sut_unavailable_spin_guard sut=<A_signal> progress_window=<N>/<window>
```

`phase_error` 事件 payload：

```json
{
  "phase": 3,
  "name": "...",
  "message": "阶段在 SUT 不可达且无实质进展时停止（sut_unavailable_spin_guard）",
  "reason": "sut_unavailable_spin_guard",
  "runId": "...",
  "spinGuard": {
    "mode": "soft",
    "sutSignal": "page_text_503",
    "progressWindow": 6,
    "stepsSinceProgress": 6
  }
}
```

### 6.6 与已有 gate 的协作

- 与 `already-operated-this-phase`：D2 在**动作已执行后**判断，门在**动作执行前**拒绝；两者互补，D2 不修改门逻辑；
- 与 `_guard_done_on_step_end`：spin guard 在 `on_step_end` 早期运行，若触发直接停止 agent，不再进入 done() 门禁；
- 与 D1 已匹配去重：D1 减少重复落库，D2 阻止空转执行；D2 触发时可能仍伴随 already-matched 动作，D1 会正确吞掉重复落库。

## 7. 分阶段落地路径

### 阶段 1：观测模式（零代码风险）

- `SUT_SPIN_GUARD_MODE=observation`；
- 只收集 `[spin-guard] observed` 日志，**不停止 agent**；
- 跑若干条真实轨迹，包括：
  - #925 复现场景（必须命中）；
  - 正常长阶段成功轨迹（必须不命中）；
  - 含等待加载、多弹窗切换的成功轨迹（必须不命中）。
- 输出观测报告，调优 N、A1/A2/A4 阈值。

### 阶段 2：软门闩

- `SUT_SPIN_GUARD_MODE=soft`（默认仍 `off`，按需开启）；
- 触发时 emit `phase_error`，reason = `sut_unavailable_spin_guard`；
- 前端/日志可识别独立 reason，便于台账统计；
- 继续跑湿测，确认不误杀。

### 阶段 3：硬门闩

- `SUT_SPIN_GUARD_MODE=hard` 设为默认值；
- 触发时 `agent.state.stopped = True`，直接结束 phase；
- 保留 `SUT_SPIN_GUARD_MODE=off` 作为紧急回滚开关。

## 8. 验收标准与 Characterization Pin

### 8.1 湿测验收

1. #925 复现场景在 hard 模式下不再空转到 `max_steps`，`trajectory_step` 不再出现大量 503 后的重复步骤；
2. 正常长阶段轨迹在 hard 模式下步数/结果与基线一致；
3. 观测模式下 #925 场景命中日志，正常场景不命中；
4. `phase_error` 事件包含独立 reason `sut_unavailable_spin_guard`。

### 8.2 离线 Pin

新增 `scripts/characterization/characterize-sut-spin-guard.py`，断言：

1. `scripts/recorder.py` 中存在 `_guard_spin_on_step_end` 或等效函数；
2. `build_recording_hooks` 的 `on_step_end` 中调用该函数；
3. 存在对 `SUT_SPIN_GUARD_MODE` 的读取路径；
4. `phase_error` reason 字符串 `sut_unavailable_spin_guard` 在 `scripts/recorder.py` 或 `session_runner.py` 中存在；
5. 存在 `business_data_store` 进度统计相关的 key（如 `_tasks_done_this_step` 或 `_last_progress_step_num`）。

### 8.3 回归

- 跑 `bash scripts/refactor/verify-all.sh`；
- 与基线比对：允许已有的 RED 项，**不允许新增 RED**；
- `npx eslint src/ executor/ scripts/` = 0 errors（基线一致）。

## 9. 风险与回滚

| 风险 | 缓解措施 |
|---|---|
| 误杀正常长阶段 | 双条件触发 + 排除项 + 观测阶段收集误报率 + N 可调 |
| 与现有 gate 冲突 | hook 点放在 `on_step_end` 早期，触发即停止，不进入后续 gate；不修改门逻辑 |
| SUT 瞬态恢复被误停 | 条件 A 要求连续多步或最近窗口内多次命中，避免单步抖动 |
| 人工录制受影响 | 人工录制走 `manual_recorder/recorder.py` 直连 `_record_action`，不进入 `scripts/recorder.py` 的 agent hook |
| 回放受影响 | 回放路径不调用 `build_recording_hooks`，D2 只在录制时生效 |

**回滚**：
- 设置 `SUT_SPIN_GUARD_MODE=off` 立即关闭；
- 若已设为 hard 默认，改环境变量即可，无需重新部署；
- 只影响新 run，不修改历史轨迹。

## 10. 后续可扩展（不本次做）

- 把 spin guard 统计暴露到控制面 dashboard，便于运维观察；
- 对 `Service Unavailable` 做自动重试 + 指数退避（与 D2 止损互补）；
- 结合 LLM 失败识别（`agent-llm-error`）做更统一的失败分类。

## 11. 变更决策记录

| 决策 | 选项 | 选择 | 理由 |
|---|---|---|---|
| 实施层 | Python agent hook / Node 控制面 | Python agent hook | 需要 `business_data_store` 的 task_list 进展 |
| 触发条件 | 单条件 / 双条件 | 双条件 A+B | 降低误杀 |
| 首次实施 | 直接 hard / observation→soft→hard | observation→soft→hard | 高风险面必须渐进 |
| 默认开关 | 默认 on / 默认 off | 默认 off → 湿测后 hard | 避免未验证就影响生产 |
| 是否改 prompt | 是 / 否 | 否 | 避免改变 agent 全量行为 |

---

**结论**：D2 是有必要的，但必须在可观测、可灰度、可回滚的前提下分阶段实施。等执行机 + SUT 在线后，从阶段 1（观测模式）开始。

## 12. 实施记录（2026-09-21 引擎线）

代码已落地（分支 `engine/d2-spin-guard-20260921`，自 `origin/uara_V2.0` 切出；commit 见 agent-log 收工条目）：`scripts/agent/recorder_emitters.py` 新增 `_guard_spin_on_step_end`（A/B 判定+模式分发+`phase_error` 直发）、`scripts/recorder.py` on_step_end 调用点（位于 `_guard_done_on_step_end` 之前）、`scripts/agent/service.py` 续跑循环补 `goal_tracker['stopped']` break、pin `scripts/characterization/characterize-sut-spin-guard.py`（73 断言，RED→GREEN）入 verify-all。两个系统线勘误均已吸收（①纯读操作空转由 idle watchdog 兜底、观测模式以此为边界；②`reason` 字段纯加法）。实施中的三项裁定（设计稿授权范围内的实现选择）：

1. **A2（网络 5xx）缓发**：§5.1 假设「通过 attach_network_capture 写入 business_data_store 的网络状态」可读——实查 `network_capture.py` 仅 `emit_memory_event('network_captured')` 内存事件、store 无该键，读取路径不存在。落地 A1+A3+A4（A1 覆盖 #925 实证形态）；A2 若湿测期需要，须先挂 memory writer 旁路再评估。
2. **soft/hard 进程内同构**：§6.2 状态机读字面两者均为「emit phase_error(reason) + 停 agent」——照此实现；真正的分级旋钮是环境默认档位，进程内差异仅 payload 的 mode 字段与 `_spin_guard_soft_triggered` 标志（soft 档）。
3. **条件 B 三信号**：task_list done 数增长 / URL pathname 变化 / 新容器首开（**重开已见容器不算进展**——防 #925 型「重开下拉」循环把容器翻转误计为进展）；§5.2 第(4)项「成功保存/提交」不单设信号（实践必伴随前三者之一）。

补充语义（实施时固化，pin 已钉）：stall 窗口未满**零页面 I/O**（off 与未满窗两档）；进展发生时 A 计数与 stall 一并清零；阶段号变化自动重置全部状态；**触发幂等=phase+runId 双键作用域**（终审 F1 修正：重录路径〔runner 同 runtime 换 runId 再录、失败收尾不关 session〕存在同进程同 store 同相位重入，「同阶段作用域」会 neuter 重录相位的 on_step_end 尾段且守卫不再武装——重置条件含 runId 维度、重置块清触发戳重新武装，重录/阶段推进自动重武装，pin 10a/10b 钉死；runId=None 的 legacy 场景退化为按相位幂等，行为与初版一致）；observation 满窗后每步探测一次并覆写 `_spin_guard_observed_last`（持续观测误报率=设计意图）。

**余下**：§8.1 湿测验收（#925 复现必须命中 observation 日志 + 正常长阶段不得误杀）待在线 SUT+执行机；按湿测数据逐级升档（observation→soft→hard），默认值升为 hard 前须 Lead 批准（§6.4 沿用）。
