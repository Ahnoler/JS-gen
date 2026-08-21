# 批量动作显式化方案（Spec）

> 状态：待评审
> 日期：2026-08-21
> 前置：调研报告 docs/superpowers/research/2026-08-21-batched-actions-grounding-research.md（结论：链路已按动作粒度全通，批量"半接入"）
> 决策（用户已确认默认建议）：O1 表单 5 / 导航 3、可调；O2 截图维持现状（每动作一对）；O3 轮次归属落库一期不做；O4 批内失败接受 browser_use break 语义，一期不注入恢复

---

## 1. 背景：批量能力现状（已调研核实）

- browser_use 0.1.48 原生支持一轮多动作：`AgentOutput.action` 为列表（site-packages `browser_use/agent/views.py:150-154`），`multi_act` 顺序执行（`agent/service.py:1001-1069`），"页面不变"前置由框架强制（任一动作 error/done、index 元素 hash 变化、出现新元素即 break）。
- `max_actions_per_step` 默认 **10**（`agent/service.py:144`），但项目构造 Agent 时**未传参**（`scripts/agent/service.py:425-434`）→ 实际生效但不可控、不可配。
- 项目 prompt **已允许批量输出**：`scripts/prompts/agent-core.md:15`「一次输出 MULTIPLE 个动作，前提是页面不变化时全部成功」；已有单条限制：每步最多 1 个 `select_option`（`agent-tools-form.md:56`）。
- 持久化/装配/回放全按动作粒度：`trajectory_step` 有 `(step_number, action_index)` 双列（`migrations/20260713190555_create_all_tables.js:97-99`），Node 所有读取/回放按双列排序（`trajectory-dao.js:463`、`trajectory-step-dao.js:50/134`、`trajectory-session-replay.js:178/201/210`）；`script_assembler.py:181-293` 按条目扁平生成；`_replay.py:313-526` 逐条目回放；dedup 在动作条目层（`state.py:624-637` + `src/dedup.js:56-89`）。→ **无需架构改造**。

## 2. 目标 / 非目标

**目标**

- 批量上限**显式可控**：`max_actions_per_step` 参数化，按阶段模式给默认值（表单类 5、导航类 3），全局可调；
- prompt 补一条批量纪律：批内禁止 DOM 结构变更类动作（点击/导航/select 展开下拉），降低批内失效与 false-ok；
- 运行可观测：批量配置写入 stderr 日志与 phase 观测载荷。

**非目标**

- 不做 `batch_turn_id`/step_group 轮次归属落库（UI"一步含 N 动作"分组展示 → 二期，见 O3 记录）；
- 不改变截图策略（维持每动作 before/after+dialog 一对，O2）；
- 不注入批内失败恢复提示（接受 browser_use break 丢批尾语义，O4；模型下一轮自然补救）；
- 不改 dedup / script_assembler / _replay.py / ctrl-actions / migrations。

## 3. 方案

### 3.1 参数透传链（core，约 10-20 行）

```
config/.env:  MAX_ACTIONS_PER_STEP=4            # 全局默认（0/空 = 不覆盖，走框架默认 10）
config/config.js: export const MAX_ACTIONS_PER_STEP = _resolve('MAX_ACTIONS_PER_STEP', '');   # 照 LLM 配置块（config.js:58-65）模式
trajectory-recording-runner.js:358-362 stepData 增加:
    max_actions_per_step: MAX_ACTIONS_PER_STEP || undefined,   # 空则不传
scripts/agent/service.py:83 旁读取:
    max_actions_per_step = instruction.get('max_actions_per_step')
scripts/agent/service.py:425-434 Agent(...) 构造增加:
    max_actions_per_step=resolved,
```

**解析规则**（新纯函数 `resolve_max_actions_per_step(instruction_value, contract_mode)`，放 scripts/agent/service.py 或 agent_utils.py，便于 characterization）：

```
1. instruction_value 非空（Node 显式传）→ 用之（全局开关）
2. 否则按 contract 模式映射（Python 侧已有 get_phase_intent/contract，service.py:420-423）：
   create / modify / introduce_pick → 5
   navigate / query / login / 其它/None → 3
3. clamp 到 [1, 10]
```

> 模式映射放 Python 侧的理由：phase 的 mode 由评审合约在 Python 侧解析（service.py:420-423），Node 侧拿不到；Node 全局配置作为显式覆盖优先。

### 3.2 prompt 纪律（可选小改）

`scripts/prompts/agent-tools-common.md` 动作清单区追加：

- **批量输出纪律**：同一轮可输出多个动作，但批内**禁止**改变 DOM 结构的动作（`click_element`/导航/菜单/下拉展开/`select_option` 等）与表单保存类动作；仅允许对**已存在元素**的连续填充/选择（多个 `fill_form_field`、`click_radio`）。已有 `agent-tools-form.md:56`「每步最多 1 个 select_option」维持不变。

### 3.3 观测

- `scripts/agent/service.py` 构造 Agent 前 stderr：`[batch] max_actions_per_step=N (source=config|mode|default)`；
- `phase_end` observability payload 增加 `maxActionsPerStep`（复用现有 phase_end 结构，trajectory-recording-runner 已透传 phase_end 数据，无需改事件契约）。

## 4. 验收

1. **characterization（纯函数层）**：
   - `resolve_max_actions_per_step`：显式值优先（含 0/空→模式映射）；create→5 / navigate→3 / None→3；clamp 边界（1、10）；
   - 回归：现有 `resolve_phase_max_steps` 断言不动、全绿。
2. **湿测场景**：表单阶段录制——观察 stderr `[batch]` 日志与 LLM 单轮多动作输出（GLM-5 网关实际行为）；录制产物 step 编号连续、回放 `_replay.py` 逐条执行成功；批量轮截图事件量与单动作一致（每动作一对）。
3. **verify-all.sh** ALL GREEN；`characterize-ctrl.mjs` 不动（CTRL parity 零影响）。

## 5. 备选方案（否决记录）

| 方案 | 否决原因 |
|------|----------|
| A. 不传参，维持框架默认 10 | 不可控；一轮 10 个 tool calls 放大 token 与整轮重试（max_failures=5 按轮重试，service.py:557-560）；R5 |
| B. Node 侧按 phase 描述解析模式给默认 | mode 在 Python 合约侧，Node 拿不到；双份模式解析易漂移 |
| C. 批量轮次归属落库（batch_turn_id/step_group） | 唯一需要 schema 变更的点；UI 展示暂无需求，二期按需做（O3） |
| D. 批内失败注入恢复提示 | browser_use break 语义已保证"页面不变"前置；恢复提示需要改 multi_act 或钩子，一期收益不确定（O4） |

## 6. 风险与对策

- **R1 批内 error/done 丢批尾**（service.py:1055）：接受语义；默认值 3-5 控制批量规模，损失有限；湿测覆盖。
- **R2 批内 DOM 变化致过期定位**：prompt 纪律（3.2）禁止 DOM 结构变更动作入批；动作内部 re-query DOM 已有（AGENTS.md 规则）；湿测观察 false-ok。
- **R3 截图事件线性增长**：维持现状（O2）；persist-live FK 容错已有（persist-live.js:62）。
- **R5 整轮重试成本**：默认 3-5 而非 10；失败步不批量。
- **兼容性**：改 `src/`（config.js + trajectory-recording-runner.js）按 AGENTS.md 同步约定写 CHANGELOG（`[Unreleased]` 追加条目）；仅改 `scripts/` 可不写。

## 7. 关联

- 调研：docs/superpowers/research/2026-08-21-batched-actions-grounding-research.md 第一节
- 后续（二期候选）：批量轮 UI 分组展示（O3）、批内失败恢复（O4）
