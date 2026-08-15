# Heal-Locate Phase 0 Current Analysis Plan

> **状态（2026-08-15）**：本文档已由 `2026-08-15-heal-locate-handoff-plan.md` 整理承接；后续执行请以 handoff 计划为准，本文保留为调研记录底稿。


> 日期：2026-08-14
>
> 目标：在开始 Heal-Locate 优化前，建立当前实现事实基线。
>
> 原则：先分析，不改代码；所有发现持续更新到本文档。

## Phase 0 总目标

完整还原当前 Heal-Locate 链路：

```
Trajectory Step
    ↓
Replay Engine
    ↓
Action Executor
    ↓
Locator Resolver
    ↓
Element Not Found
    ↓
Heal Trigger
    ↓
Heal Agent
    ↓
Repair / Retry / Skip
```

最终产出：

- 当前架构链路图
- 当前模块责任划分
- 当前失败模式分类
- 当前优化缺口

## P0.1 Replay 到 Heal 调用链分析

状态：⬜ TODO

目标：

找到一次 replay 失败后进入 Heal 的完整调用路径。

检查内容：

- replay API 入口
- step 执行入口
- action executor
- locator resolver
- error handler
- heal trigger

## P0.2 Heal 触发条件分析

状态：⬜ TODO

目标：

确认哪些失败会进入 Heal-Locate。

检查内容：

- ElementNotFound 类型
- timeout
- selector failed
- detached DOM
- page state mismatch
- label-not-found

输出：

失败类型 → 当前处理策略矩阵

## P0.3 Heal 上下文分析

状态：⬜ TODO

目标：

确认 Heal Agent 当前收到的信息。

检查：

- target 信息
- page state
- previous actions
- visible elements
- screenshot
- region 信息

## P0.4 Locator 能力分析

状态：⬜ TODO

目标：

建立当前定位能力矩阵。

检查：

- xpath_smart
- label matching
- placeholder
- text matching
- DOM scan
- region locate
- screenshot assist

## P0.5 失败案例收集

状态：⬜ TODO

目标：

收集真实 Heal-Locate 失败案例。

重点：

- 级联隐藏字段
- 折叠区域
- Tab 错误
- Dialog 状态错误
- 真实字段不存在

## P0.6 输出 Current Analysis

状态：⬜ TODO

产出：

```
docs/superpowers/specs/
2026-08-14-heal-locate-current-analysis.md
```

执行过程中持续更新本文档。

## Phase 0.1 执行记录：Replay → Heal 调用链分析

状态：🟡 分析中

初步发现：

1. 当前存在两类 Heal 路径：

- Type A：单步回放失败后的 step heal
- Type B：表单结构变化后的 form structure heal

共享入口：

```
src/services/trajectory/replay-heal-shared.js
```

该文件负责：

- 向 Agent 转发 heal instruction
- 等待 phase_done / phase_error
- 记录 heal decision memory


## 当前发现的调用关系（第一版）

```
Replay / Step Execution
        |
        v
CTRL Action
        |
        v
Element Resolver
        |
        +---- success
        |
        +---- failure(result: label-not-found 等)
                    |
                    v
              Heal Instruction
                    |
                    v
              Agent step execution
```

关键文件：

|模块|文件|
|-|-|
|Replay编排|src/services/replay-service.js|
|Heal共享执行|src/services/trajectory/replay-heal-shared.js|
|Heal指令生成|src/routes/browser-session/heal-instruction.js|
|CTRL动作层|src/ctrl-actions/*|


## P0.1.2 CTRL Failure → Heal Trigger Analysis（执行中）

### 已确认

- CTRL 层存在标准失败结果：`label-not-found`。
- 该结果主要来自表单类动作定位失败。
- 现有 Heal 设计仍偏向“失败后重新尝试当前步骤”。

### 初步调用关系

```
CTRL Action
    ↓
返回失败结果
    ↓
Replay/Agent Runtime 判断失败
    ↓
构造 Heal Instruction
    ↓
run Heal Step
    ↓
Agent 再执行当前意图
```

### 当前发现问题

当前链路已经具备失败恢复入口，但缺少失败原因分析层：

```
label-not-found
        |
        +--> 当前：直接进入 Heal
        |
        +--> 目标：Missing Analyzer
                 |
                 +-- hidden
                 +-- collapsed
                 +-- wrong region
                 +-- condition blocked
                 +-- real missing
```

### 下一步

继续确认：

- CTRL 返回值具体在哪里被 Replay 捕获。
- Heal Trigger 的真实调用文件。
- Python Agent 接收 instruction 后的执行入口。

## P0.1.3 Execution Record - Heal Instruction Layer

状态：进行中

发现：

1. Heal Instruction 位于：
   src/routes/browser-session/heal-instruction.js

2. 当前 Type A 单步自愈策略：
   - 输入 failedEntry + errorResult
   - 目标是重新执行失败动作
   - 明确禁止额外诊断和下一步操作

3. 当前 Type B 表单结构变化自愈：
   - 针对新增/删除字段
   - 只处理结构变化字段

4. 当前设计特点：
   Heal 主要承担 Action Retry，而不是 Missing Reason Diagnosis。

待继续确认：
- Replay Service 捕获 CTRL 返回值的位置
- Node 到 Agent 的实际执行链
- label-not-found 到 Heal Trigger 的判断逻辑


## P0.1.4 Analysis Update

发现当前项目已有缺席字段处理能力：

- label-not-found
- ok-skip:label-not-found

已有规则位置：
- scripts/controller/actions/_replay.py
- scripts/controller/actions/_helpers.py
- scripts/prompts/heal-prompt.md

结论：

当前问题不是所有 label-not-found 都进入 Heal。

真实问题：

现有 Missing Reason 判断逻辑分散在多个模块，需要收敛为统一决策层。

Phase 3 调整为：
Unified Missing Reason Analyzer。

目标：

MissingReason {
 type,
 confidence,
 evidence,
 action
}

## P0.1.5 Execution Record - Node Agent Execution Chain (in progress)

Confirmed from source:

- replay-heal-shared.js
  - runHealStep() listens for session events:
    - phase_done
    - phase_error
    - agent_stopped
  - sends session event:
    - event: step
    - data: instruction, max_steps, phase_number, heal_type

- replay-batch-runner.js
  - Type A heal flow:
    failed action
      -> buildStepHealInstruction()
      -> runHealStep()
      -> continue replay after phase_done

- executor/session-handler.js
  - session.step maps to SessionManager.forward(sessionId, 'step', ...)

Current confirmed chain:

Replay Runner
  -> runHealStep
  -> executor-session-client
  -> session.step
  -> SessionManager
  -> Python Agent

Remaining:
- confirm SessionManager.forward implementation
- confirm Python Agent step event handler
- complete sequence diagram

## P0.1.5 Prompt Assembly & Agent Runtime Analysis Update

Status: IN PROGRESS

Confirmed:

1. Heal reuses the same browser-use Agent runtime loop.

Flow:

Replay Session
 -> runHealStep()
 -> Agent Runtime
 -> browser_use.Agent
 -> CTRL Action

2. Agent mode switching already exists through task context detection.

Relevant runtime behavior:

- instruction enters _run_agent_step()
- detect_heal_mode(instruction, agent_task)
- apply_heal_mode(case_data_ref, heal_mode)
- phase_intent_obs emits heal_mode

3. Prompt assembly is not a standalone heal prompt system.

Current architecture:

Task Context
 + Phase Context
 + Task Mode
 + Heal Context
        |
        v
build_agent_system_message()
        |
        v
browser_use.Agent(override_system_message)

4. Current optimization direction confirmed:

Do not create a separate Heal Agent.
Extend existing Prompt Assembly with Heal Context.

Pending:

- inspect build_agent_system_message implementation
- inspect PLANNER_SYSTEM_PROMPT composition
- identify final insertion point for Heal Context
