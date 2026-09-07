# 阶段步数预算动态加成方案（Spec）

> 状态：待评审
> 日期：2026-08-21
> 前置：reviewer 缩进 bug 修复（create/modify 无条件 +4 `_CREATE_RECOVERY_BUFFER`，同日，characterize-phase-reviewer 已钉）
> 关联事故：traj 33 P2「客户转正-填写基本信息」10 步预算耗尽被迫 `done(success=False)`，引入子流程未执行

---

## 1. 背景：当前 max_steps 决策链

每阶段 agent 预算由三层决定（`scripts/agent/service.py:274-292` → `scripts/controller/actions/phase/reviewer.py:resolve_phase_max_steps`）：

1. **ceiling**：控制面下发的 `PHASE_MAX_STEPS`（默认 300），硬上限，只降不升。
2. **评审合约**：phase reviewer（LLM）按阶段目标产出 contract——`estimated_steps` / `effort` / `mode` / `submit.required`。
3. **静态公式**：`est+2`（或 effort 档位 5/15/30）→ submit.required 时 `+3` 空动作余量 → create/modify `+4` 恢复预算 → clamp 到 ceiling。

修复缩进 bug 后，traj 33 P2 同合约可得 14 步。但静态 +4 仍是**钝器**：

- 评审器估 `estimated_steps≈8` 是因为 `run_form_assistant` 把 100+ 字段折叠成 1 步——估算模型**看不见**引入子流程（每个 disabled+button 字段要点旁钮 → 弹窗检索选择 → 回填验证，3-5 步/个）；
- 预算在 `agent.run()` 之前**一次性定死**，而真实工作量信号（扫描后的 `needs_intervention` / pending / `_assistant_needs_agent`）在第 1-2 步 run 内才产生——先有鸡还是先有蛋。

## 2. 目标 / 非目标

**目标**

- 预算按**可观测的工作量**动态加成：引入型字段（needs_intervention / disabled+button）、剩余 pending、tree-select 各自折算步数；
- 预算耗尽且工作未完时**续跑**而非接受失败；
- 总步数永远 ≤ ceiling，扩展轮次有硬闸，防失控与 token 灾难。

**非目标**

- 不动 ceiling（PHASE_MAX_STEPS）与评审器 LLM 提示词估算本身；
- 不处理「最后阶段 success=False 仍 isSuccessful=1」的语义传导（另议）；
- 不做 mid-run 修改 `agent.state.max_steps`（browser_use 无此接口，避免 hack 框架内部）。

## 3. 方案：两段式预算（预算法 + 质量门驱动续跑）

### 3.1 第一段：预算法（现状 + 微调）

维持现有 `resolve_phase_max_steps` 公式不变（含已修复的 +4）。唯一调整：评审合约透传 `needs_agent_hint`（可选，见 §5 备选 B 的兼容位），预算法不依赖它。

### 3.2 第二段：续跑（core）

挂点在 `scripts/agent/service.py` 的 run 后质量门（`:458-496`，已有 `QUALITY FAIL` 检测）——**预算耗尽 + 工作未完**时，对同一 Agent 实例二次 `agent.run(max_steps=extension)` 续跑（browser_use `run()` 为 `for step in range(max_steps)`，同实例二次调用即在原 history/browser/controller 上继续，已验证）。

**触发条件（全部满足）**：

1. 预算耗尽：`agent._done_fired` 为假（done 从未触发，run 循环自然走完），或 done 显式 `success=False` 且失败原因属「工作未完」类；
2. 工作未完：`check_pending_write_gate` 不通过（pending_fields），或 task_list 存在 `needs_intervention` 项，或 `_assistant_needs_agent` 非空；
3. 闸门：`已用步数 + extension ≤ ceiling`，且 `扩展轮次 < _BUDGET_EXTEND_MAX_ROUNDS(2)`。

**extension 成本模型**（新纯函数 `compute_budget_extension(pending_state) -> int`，放 reviewer.py）：

```
引入型字段数 × 4        # needs_intervention / disabled+button：点旁钮+弹窗检索+选择+回填验证
普通 pending 字段数 × 2  # fill/select 直填
tree-select 字段数 × 1   # 额外检索开销（已含在普通 ×2 内的加成项）
+ 2                     # verify + done 收尾
clamp 到 (ceiling - 已用步数)
```

**流程**：

```
agent.run(max_steps=chosen)
loop (≤2 轮):
    quality-gate 评估 → 未触发续跑条件 → break
    extension = compute_budget_extension(从 case_data_store 读 task_list/_assistant_needs_agent)
    extension ≤ 0 或 已用+extension > ceiling → break（记 QUALITY FAIL）
    stderr: [budget] extend round=N +M steps (introduce=X pending=Y)
    agent.run(max_steps=extension)   # 同实例续跑
```

### 3.3 观测与落库

- 续跑决策写 stderr（`[budget] extend ...`）+ 并入 `phase_end` observability payload（`budgetExtensions: [{round, steps, introduce, pending}]`）——湿测与事后审计可见；
- 最终仍失败时沿用现有 `QUALITY FAIL reasons`（pending_fields 已含），不在本 spec 新增失败语义。

## 4. 验收

1. **characterization**（纯函数层）：
   - `compute_budget_extension`：引入 2 + pending 3 + tree 1 → 2×4+3×2+1+2 = 17；clamp 边界；全空 → ≤0 不续跑；
   - 续跑闸门：轮次、ceiling 用尽不续；
   - 回归：现有 `resolve_phase_max_steps` 断言不动、全绿。
2. **湿测场景**：重录 traj 33 P2（引入 刘伟/刘玲）——预算 14 步耗尽后检测到引入字段未完 → 续跑 → 引入完成 → done(success=True)；或续跑 2 轮后仍失败且 QUALITY FAIL 落库（可接受下限）。
3. **verify-all.sh** ALL GREEN。

## 5. 备选方案（否决记录）

| 方案 | 否决原因 |
|------|----------|
| A. 静态大 buffer（create/modify +20） | 无工作量的简单阶段同样烧预算；治标 |
| B. 把扫描数据喂给评审器重估 | 鸡生蛋：扫描在 run 内才发生；需 run 前预扫一页，成本与延迟更高（保留 `needs_agent_hint` 合约位作远期兼容） |
| C. mid-run 改 `agent.state.max_steps` | 依赖框架内部实现，无公开接口；升级即碎 |

## 6. 风险与对策

- **续跑循环失控**：轮次 ≤2 + 总步 ≤ceiling 双闸；每轮质量门重评，不满足即停。
- **续跑时 history 已长、LLM 上下文膨胀**：extension 轮开始注入一条「续跑指令：仅完成以下剩余字段…」精简 task 前缀（复用 phase preamble 机制），抑制漫游。
- **引入字段永远无法完成**（DOM 缺失/闸门未开）：2 轮后接受失败，QUALITY FAIL pending_fields 如实记录——与 heal-locate 的缺席判定语义衔接（远期：引入失败直接走 skip 标注）。
