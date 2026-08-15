# Heal-Locate 优化 — 合并执行计划与预先设计（Handoff）

- **整理日期**：2026-08-15
- **仓库**：`D:\dev\JS-gen`，分支 `uara_V1.2`（当前领先 origin 9 个重构提交，**未 push**）
- **交付对象**：另一个执行会话（本文件为自包含交接文档，不依赖任何会话上下文）
- **源文档**（已整理承接，保留为历史底稿）：
  - `docs/superpowers/plans/2026-08-14-heal-locate-phase0-current-analysis-plan.md`
  - `docs/superpowers/plans/2026-08-14-heal-locate-phase1-design.md`
- **范围**：① 完成 Phase 0 现状调研收尾；② 实现 Heal-Locate 优化 Phase 1 MVP（Missing Reason Analyzer + Heal Contract + Prompt Assembly）
- **明确不做（本计划）**：不新建独立 Heal Agent；不重构 executor/session 传输协议；不修改 `/steps/replay` 产品协议；不改 Type B 表单结构自愈的持久化语义；不做真实浏览器 wet 实验（除非单列 P2）。
- **已拍板的设计决策**（见 §3，执行会话直接照做，不要重新做架构选型）：
  - MVP 的 Missing Reason Analyzer 是 **Node 侧纯函数规则引擎**（`src/services/trajectory/` 内，无 I/O）。
  - Python 侧只做 contract 解析 + mode 应用 + prompt 装配，不重复实现分析器。
  - 保持旧文本/字段完全向后兼容；新增结构化字段，不删旧字段。
  - MVP 阶段**不改变** Node 的 skip/retry/fail 路由；决策先写入 contract 与 instruction，供 prompt 与后续 P2 使用。

---

## 1. 现状基线（2026-08-15 已核对，路径为重构后路径）

### 1.1 当前 Heal 调用链

```
产品 live replay：POST /api/v2/trajectories/:id/steps/replay
  → src/services/trajectory/trajectory-session-replay.js
  → src/services/trajectory/replay-batch-runner.js（Type A 单步自愈）
      - buildStepHealInstruction(failedEntry, errorResult)
      - runHealStep(runtime, instruction, HEAL_MAX_STEPS, 'step')
  → src/services/trajectory/replay-heal-shared.js
      - forwardStdin({ event:'step', data:{ instruction, max_steps, phase_number:0, heal_type, healType } })
  → executor/session-handler.js → SessionManager.forward
  → Python Agent runtime（browser_use）
      - scripts/agent/service.py:
          detect_heal_mode(instruction, agent_task)
          apply_heal_mode(case_data_ref, heal_mode)
          contract = get_phase_intent(...)  # heal 时为 None
          system_msg = build_agent_system_message(contract)
      - scripts/controller/actions/phase/prompts.py:
          detect_heal_mode / apply_heal_mode / is_heal_mode
      - scripts/agent_utils.py:
          build_agent_system_message(contract) → packs 拼接

Type B 表单结构自愈：
  → src/services/trajectory/form-structure-heal.js
      - buildFormStructureHealInstruction(report)
      - runHealStep(runtime, instruction, FORM_STRUCTURE_HEAL_MAX_STEPS, 'form_structure')
```

### 1.2 关键实现事实（供 H0/H1 直接引用）

| 事实 | 位置 |
|---|---|
| `runHealStep` 定义与 forward 载荷 | `src/services/trajectory/replay-heal-shared.js:47-139` |
| forward 载荷字段 | 同上 `:126-137`：`instruction, max_steps, phase_number, heal_type, healType` |
| Type A instruction 模板 | `src/routes/browser-session/heal-instruction.js:12-34` |
| Type B instruction 模板 | 同上 `:43-77` |
| Type A 调用点 | `src/services/trajectory/replay-batch-runner.js`（约 `:250-274`，失败分类在 `:250-269`） |
| Type B 调用点 | `src/services/trajectory/form-structure-heal.js`（约 `:326-344`） |
| Python heal 检测 | `scripts/controller/actions/phase/prompts.py:136-150` |
| Python heal 状态写入 | 同上 `:153-177` |
| Python Agent heal 分支 | `scripts/agent/service.py:146-182`、`:415-426` |
| System message 装配 | `scripts/agent_utils.py:87-118` |

### 1.3 已确认的核心结论

1. Heal 入口和重试闭环已经存在，缺的不是入口，而是**失败原因语义分类层**。
2. 当前 `label-not-found` / `xpath-not-found` / `option-not-found` 基本统一进入“重做当前步”的 Type A instruction；没有区分 hidden、collapsed、wrong region、conditional absent、真实缺字段。
3. Python 已有 `heal_mode`（`'step' | 'form_structure'`）雏形，但：
   - 只存字符串，没有 contract/reason/strategy 结构；
   - heal 时 `contract=None`，`build_agent_system_message` 走 full fallback（全 packs），没有 heal 专用 prompt。
4. 不存在独立 Heal Agent，也不应新建；正确做法是扩展现有 Prompt Assembly。
5. 文档历史里写过的 `src/services/replay-service.js` 是旧组装回放路径，**已在 2026-08-15 架构统一重构中删除**；Heal-Locate 只关心上面的 live replay 链路。

---

## 2. 目标与非目标

### 2.1 目标

- 完成 H0 调研，产出 `docs/superpowers/specs/2026-08-15-heal-locate-current-analysis.md`。
- 实现 Phase 1 MVP：
  - `MissingReason` 结构化失败原因（category / confidence / evidence / suggestedAction）。
  - `HealContract`（mode / scope / strategy / reason / target / runtime），prompt 与 runtime 分离。
  - Type A/B 指令带上结构化失败分析；`runHealStep` 转发 contract。
  - Python 解析 contract，heal 模式装配 `agent-tools-heal.md`。
- 全部门禁与 characterization 保持绿色。

### 2.2 非目标（本轮不做）

- 独立 Heal Agent / 新 agent runtime。
- 用 LLM 做 MissingReason 分类（MVP 是确定性规则引擎；LLM 分类留 P2）。
- 改变 Node skip/retry/fail 路由（决策先只作建议，见 D10）。
- 修改 executor 协议与消息名；不 push 任何提交（执行会话负责 commit，绝不 push）。

---

## 3. 预先设计（执行会话照此实现）

### D1. 分层与归属

```
Node 控制面（决策/契约构建）
  missing-reason-analyzer.js  纯函数：失败信号 → MissingReason
  heal-contract.js            纯函数：MissingReason + 上下文 → HealContract
        ↓ forwardStdin 增加 heal_contract
Python Agent（消费契约）
  phase/prompts.py            解析 heal_contract → _heal_mode / _heal_contract
  agent_utils.py              mode=='heal' → 选择 heal prompt pack
  prompts/agent-tools-heal.md 恢复模式规则（新增）
```

### D2. MissingReason Schema

```json
{
  "category": "not_visible",
  "confidence": 0.91,
  "evidence": ["error=label-not-found", "action=fill_form_field"],
  "suggestedAction": "heal"
}
```

`category` 枚举：`conditional_absent | not_visible | not_loaded | changed_structure | permission_blocked | business_locked | unknown`。
`confidence`：0–1，规则引擎按证据条数/强信号取值；无强信号时 `unknown` 且 confidence ≤ 0.3。
`evidence`：字符串数组，**只能**来自输入信号的确定性事实，禁止编造页面状态。

### D3. MVP 分类规则（初版，可微调但需同步 characterization）

| category | 触发信号（或关系） | suggestedAction |
|---|---|---|
| `changed_structure` | `healType === 'form_structure'` 或 report 有 `added_required/missing_required` 非空 | `repair` |
| `conditional_absent` | error 命中缺席语义（如 `label-not-found` 且 action/entry 带 `is_absent_field_result` 等价信息，或已有 absent-skip 标记） | `skip` |
| `business_locked` | error 含 `disabled / read-only / readonly / no-permission / locked` | `skip` |
| `not_loaded` | error 含 `timeout / loading / page-idle / networkidle` 或 `runHealStep` timeout 上下文 | `retry` |
| `permission_blocked` | error 含 `403 / forbidden / unauthorized / 无权限` | `skip` |
| `not_visible` | error 含 `label-not-found / xpath-not-found / option-not-found / no-items / not-found / no-visible`，且不命中上面更高优先级规则 | `heal` |
| `unknown` | 无匹配 | `fail` |

优先级从高到低：`changed_structure` → `business_locked` → `permission_blocked` → `conditional_absent` → `not_loaded` → `not_visible` → `unknown`。
执行会话可补充 H0 调研中发现的真实错误串，但必须同步更新 characterization 的映射表。

### D4. Decision Policy（本轮只生成建议，不在 Node 执行）

| category | suggestedAction | 本轮行为 |
|---|---|---|
| conditional_absent | skip | 保持现有 absent-skip 逻辑；建议写入 contract |
| business_locked | skip | 同上 |
| not_loaded | retry | 保持现有 runHealStep 重试 |
| not_visible | heal | 保持现有 Type A heal |
| changed_structure | repair | 保持现有 Type B heal |
| permission_blocked | skip | 保持现有失败返回 |
| unknown | fail | 保持现有失败返回 |

### D5. HealContract Schema

```json
{
  "mode": "heal",
  "scope": "step",
  "strategy": "visibility_recovery",
  "reason": { "...": "MissingReason" },
  "target": {
    "action": "fill_form_field",
    "label": "客户名称",
    "xpath_smart": "//div[contains(@class,'el-form-item')][.//label[contains(.,'客户名称')]]//input",
    "option_text": ""
  },
  "runtime": { "retry_count": 1, "max_steps": 12 }
}
```

- prompt 侧只消费 `mode/scope/strategy/reason/target`；
- runtime 侧只消费 `runtime`；
- 两者在 Node 构建时分离，Python 不得混用。

### D6. 线协议（向后兼容，旧字段不删）

`runHealStep` forward `data` 追加：

```js
heal_contract: {
  mode: 'heal',
  scope: healType === 'form_structure' ? 'form_structure' : 'step',
  strategy, reason, target, runtime: { retry_count: 1, max_steps: maxSteps },
}
```

保留 `instruction / max_steps / phase_number / heal_type / healType` 原样。

### D7. Python 解析与状态

- `detect_heal_mode(instruction, task_text)` 优先级：
  1. `instruction.heal_contract` 存在且 `mode=='heal'` → 按 `scope` 返回 `step | form_structure`，并把 contract 暂存到 `instruction['_parsed_heal_contract']`（或返回三元组，由调用方写入 store）。
  2. 旧字段 `heal_type/healType`。
  3. 旧文本关键词（保持现状，作为兜底）。
- `apply_heal_mode` 追加 `case_data_store['_heal_contract'] = heal_contract`；heal 结束/清理时一并 pop。
- 仍用 `_heal_mode` 字符串供现有 recorder/emitter 逻辑使用，避免破坏 `scripts/agent/recorder_emitters.py` 和 `scripts/recorder.py`。

### D8. Prompt Assembly

- 新增 `scripts/prompts/agent-tools-heal.md`，只写恢复模式规则：
  - 模式说明：不是普通录制，只做失败步恢复；
  - strategy 含义（visibility_recovery / structure_repair / retry_current_step）；
  - reason 使用规则：evidence 用于定位，不得因 evidence 不全而自由发挥；
  - 禁止整表 auto-fill / 保存提交 / 导航 / 额外诊断；
  - done 判定说明（沿用现有单步与表单结构 done 语义）。
- `scripts/agent_utils.py:87-118` 修改：
  - 当 `contract.mode == 'heal'`：`packs = ['agent-core.md', 'agent-tools-common.md', 'agent-tools-heal.md']`。
  - 其他模式保持不变，`None` 的 full fallback 不变。
- `scripts/agent/service.py`：heal 模式下把 heal contract 传给 `build_agent_system_message`（不再传 `None`）。建议在 `:415-416` 附近：
  ```python
  if heal_mode and case_data_ref and case_data_ref.get('_heal_contract'):
      contract = {'mode': 'heal', 'heal': case_data_ref['_heal_contract']}
  else:
      contract = get_phase_intent(case_data_ref) if case_data_ref else None
  ```

### D9. Node 模块接口（MVP 签名）

```js
// src/services/trajectory/missing-reason-analyzer.js
export function analyzeMissingReason({
  action = '',
  params = {},
  errorResult = '',
  healType = 'step',
  formStructureReport = null,
  context = {},
} = {}) -> MissingReason

// src/services/trajectory/heal-contract.js
export function buildHealContract({
  failedEntry = {},
  errorResult = '',
  healType = 'step',
  maxSteps = 12,
  reason = analyzeMissingReason(...),   // 默认内部调用
  retryCount = 1,
} = {}) -> HealContract
```

纯函数、无 I/O、无环境变量分支；所有判定可被 characterization 以表驱动方式钉住。

### D10. 路由开关（本轮不实现，预留给 P2）

- 环境变量 `HEAL_LOCATE_DECISION_ENABLED !== '1'` 时，`suggestedAction` 只影响 instruction 与 contract，不改变 replay-batch-runner / form-structure-heal 的控制流。
- P2 再实现 `skip`（标记步骤 + 直接继续）、`fail`（不上 heal）、`retry`（有限重试）的真实路由。

---

## 4. 执行阶段与微步

### H0 — 现状调研收尾（只读，先做，产出 spec）

每个任务执行后把结论写回本计划对应小节，最终汇总进 spec。

- **H0.1 失败信号盘点** ✅：
  - 收集 `_replay.py` / `_helpers.py` / `js_snippets/*` 返回的所有失败串（`label-not-found`、`xpath-not-found`、`option-not-found`、`disabled`、`no-items`、`err-*` 等）。
  - 命令：`grep -R "not-found\|label-not-found\|disabled\|no-items" scripts/controller/actions`，输出 `error → 来源模块` 表。
- **H0.2 触发条件矩阵** ✅：完成 P0.2，确认哪些 error 实际进入 `replay-batch-runner` 的 Type A 分支、哪些被 absent-skip 提前吞掉。
- **H0.3 Heal 上下文清单** ✅：完成 P0.3，逐字段记录 `buildStepHealInstruction` 当前可用信息（action/params/error 与 runtime trajectoryId/sessionId）。
- **H0.4 Locator 能力矩阵** ✅：完成 P0.4，盘点 `xpath_smart / label / placeholder / text / DOM scan / region` 在 replay 与 heal 中的可用性。
- **H0.5 失败案例收集** ✅：只从 `docs/`、`.superpowers/`、`logs/` 中找已记录案例；**不得**新跑真实浏览器实验。每个案例一行：轨迹/步骤/error/根因/建议分类。
- **H0.6 输出 spec** ✅：
  - `docs/superpowers/specs/2026-08-15-heal-locate-current-analysis.md`
  - 包含调用链图、模块责任表、失败矩阵、上下文清单、优化缺口。
  - 把 H0 中发现的新 error 串补进 §D3 规则表。

### H1 — Node 契约与规则引擎（src/，需要 CHANGELOG）

- **H1.1** 新建 `src/services/trajectory/missing-reason-analyzer.js`（D3/D9 规则）。
- **H1.2** 新建 `src/services/trajectory/heal-contract.js`（D5/D9 契约）。
- **H1.3** 新建 `scripts/characterization/characterize-heal-locate.mjs`：
  - 表驱动断言 D3 每个 category 的触发串；
  - 断言优先级（组合信号时高优先级胜出）；
  - 断言 contract 字段完整性（mode/scope/strategy/reason/target/runtime）；
  - 断言 prompt/runtime 字段分离（target 与 runtime 不互相串）。
- **H1.4** 把新 characterization 加入 `scripts/refactor/verify-all.sh`。
- 验证：`node --check` 两个新模块；`node scripts/characterization/characterize-heal-locate.mjs`；`bash scripts/refactor/verify-all.sh` 全绿。

### H2 — Node 接线（src/，需要 CHANGELOG）

- **H2.1** `src/routes/browser-session/heal-instruction.js`：
  - `buildStepHealInstruction(failedEntry, errorResult, { reason, contract } = {})` 保持旧调用兼容；
  - 在旧文本**末尾追加**结构化段落 `【失败分析】category=... suggestedAction=... evidence=...`；旧文本一字不改，保证 Python 文本兜底检测仍工作。
  - Type B 同理追加 `category=changed_structure`。
- **H2.2** `src/services/trajectory/replay-batch-runner.js` 调用点：
  - 构造 analyzer 输入（failedEntry.action/params + failResult + healType='step' + 可选 context），
  - 生成 contract，传给 instruction 与 runHealStep。
- **H2.3** `src/services/trajectory/form-structure-heal.js` 调用点：
  - `healType='form_structure'` + formStructureReport → contract。
- **H2.4** `src/services/trajectory/replay-heal-shared.js`：
  - `runHealStep(runtime, instruction, maxSteps, healType, healContract)` 追加第五参数（旧调用兼容）；
  - forward data 追加 `heal_contract`（D6）。
- 验证：`node --check`；新增/现有 characterization；全门禁；手动 grep 确认旧 `heal_type/healType` 仍存在。

### H3 — Python contract + Prompt（scripts/，免 CHANGELOG，但 Python 仓库同步提示只在 H5 写）

- **H3.1** `scripts/controller/actions/phase/prompts.py`：
  - `detect_heal_mode` 解析 `heal_contract`（D7）；
  - `apply_heal_mode` 写/清 `_heal_contract`；
  - `is_heal_mode` 行为不变。
- **H3.2** `scripts/agent/service.py`：heal 时向 `build_agent_system_message` 传 heal contract（D8）。
- **H3.3** `scripts/agent_utils.py`：`mode == 'heal'` 选择 heal packs。
- **H3.4** 新建 `scripts/prompts/agent-tools-heal.md`（按 D8 内容模板；可先按本计划附录 A 草稿落地）。
- **H3.5** 扩展或新建 `scripts/characterization/characterize-heal-mode.py`：
  - `detect_heal_mode` 对 contract 的解析；
  - `apply_heal_mode` 写/清 contract；
  - `build_agent_system_message({'mode':'heal',...})` 包含 `agent-tools-heal.md` 内容且不包含 form/table/tree packs。
  - 加入 verify-all。
- 验证：`python -m py_compile` 相关文件；`python scripts/characterization/characterize-agent-prompt-packs.py`；新 characterization；全门禁。

### H4 — 可选 P2 预留（不默认执行）

- 环境变量 `HEAL_LOCATE_DECISION_ENABLED=1` 时，Node 按 `suggestedAction` 执行 skip/fail/retry 路由；
- 必须有专门 characterization 与一次真实 batch replay 冒烟（需要浏览器，单列任务，不在本计划默认范围）。

### H5 — 文档与汇报

- 更新 `docs/superpowers/specs/2026-08-15-heal-locate-current-analysis.md`（把 H0 最终结论补进去）。
- CHANGELOG `[Unreleased]` 追加：
  - Node 侧（services 组织 + replay heal 载荷新增 `heal_contract`，WS 事件形状不变）；
  - Python 同步提示：executor/agent 解析 `heal_contract` 提示词；协议兼容旧字段。
- 最终报告：完成项 / 验证输出结论 / 推迟项 / 既有失败基线 / CHANGELOG 条目。

---

## 5. 验证与门禁（执行会话必须遵守）

1. 每微步结束：
   - Node：`node --check <changed files>`
   - Python：`python -m py_compile <changed files>`
   - 相关 characterization
   - `bash scripts/refactor/verify-all.sh` 全绿才进下一步。
2. 当前机器已确认使用 `browser_use` Python 环境（`D:\anaconda3\envs\browser_use\python.exe`），pytorch 环境已删除。
3. 需要真实 Playwright 的 characterization（如 `characterize-tree-select-record.py`）可能需要可用 Chromium；若本地缺失，按仓库已有惯例处理，不得把临时浏览器目录提交进 git。
4. 子执行会话负责 commit，**绝不 push**；commit 粒度按 H0/H1/H2/H3/H5 分段。
5. 文件集不得触碰本会话重构留下的 `scripts/browser/factory.py` 未提交改动。

---

## 6. 风险与约束

- `runHealStep` 同时服务 Type A 与 Type B；任何改动必须双路径验证。
- Python `detect_heal_mode` 目前依赖文本关键词兜底；新增 contract 解析不得删除文本兜底。
- `_heal_mode` 字符串被 recorder/emitter 使用；只能新增 `_heal_contract`，不能改 `_heal_mode` 的现有值语义。
- instruction 旧文本是"只重做一步"的强约束；追加分析段落时不得放松这些约束。
- `replay-batch-runner.js` / `form-structure-heal.js` 的 done 判定有单独语义，不能因 contract 影响。
- 旧文档中 `replay-service.js` 相关结论已过时（该文件已删除），不要据此设计。

---

## 附录 A：`scripts/prompts/agent-tools-heal.md` 草稿

```markdown
# 恢复模式（Heal）规则

你当前处于【恢复模式】，不是普通录制执行。

## 模式
- scope: step | form_structure
- strategy: visibility_recovery | structure_repair | retry_current_step

## 总则
1. 只完成失败步的原意图（或表单结构报告指定的新增字段）。
2. evidence 是已确认事实，用于定位失败控件；禁止用 evidence 推断额外业务操作。
3. 禁止整表 auto-fill、禁止 sync_tasks_from_errors、禁止点保存/提交/确认。
4. 成功后立即 done(success=true)。

## strategy 说明
- visibility_recovery：目标控件未找到/不可见。尝试切换可见容器、展开折叠区域、
  等待加载后重试等价 Element UI 动作。
- structure_repair：按【失败分析】中的字段清单填写新增字段；不填已移除字段。
- retry_current_step：页面未就绪导致失败，等待稳定后重做原动作。

## done 语义
- 单步 heal 与表单结构 heal 的 done 由系统单独判定，弹窗仍打开是允许的。
```

## 附录 B：H0 问题执行答案（已写入 spec，2026-08-15）

1. **能**。`runReplayBatch` 持有 `actions` 数组，失败步下标 `i` 可用，`actions.slice(0, i)` 低成本可得。MVP 只取 `previousAction` 放入 `context.evidence`，不扩大传输面。
2. **需要归一化**。Node 侧 `failResult` 当前基本是字符串，但 `result?.error` 未来可能是对象；analyzer 首行统一 `String()`，对象走 `JSON.stringify`。
3. **不止**。实际 Type B report 还有 `error/count/expected_count/required_count/optional_count/hasRequiredChange/hasOptionalChange/reordered/fields`；analyzer 只依赖 `container/missing_required/added_required/missing_optional/added_optional` 五个稳定字段。
4. **无 schema 校验，但有两处白名单**。`src/executor-session-client.js`（`session.step`）与 `executor/session-handler.js`（`session.step`）都会丢弃未知字段；两处都必须把 `heal_contract` 显式透传。`executor/session-manager.js` 只透传 JSON，无需改。H2 会相应把这两处纳入接线范围（协议消息名不变）。
5. **未发现**。文档与 `.superpowers` 中没有 `heal_type=step` 但实为 `changed_structure` 的历史案例；D3 优先级保持不变。


---

## 执行结果（2026-08-15 会话）

### 已完成

- **H0**：现状调研收尾完成，产出 `docs/superpowers/specs/2026-08-15-heal-locate-current-analysis.md`；附录 B 五个问题已在 spec §8 回答并写回本计划。
- **H1**：`missing-reason-analyzer.js` + `heal-contract.js` 纯函数规则引擎落地；`characterize-heal-locate.mjs`（39 项断言）加入 verify-all。
- **H2**：Type A/B 指令追加【失败分析】；`runHealStep` 第五参转发 `heal_contract`；**H0.4 新发现**——`session.step` 在 `src/executor-session-client.js` 与 `executor/session-handler.js` 各有一处白名单，两处均已透传 `heal_contract`（消息名与旧字段不变）。
- **H3**：Python `detect_heal_mode` 优先解析 `heal_contract`；`apply_heal_mode` 写/清 `_heal_contract`；`build_agent_system_message` 在 `mode=='heal'` 时只装 `agent-core + agent-tools-common + agent-tools-heal`；`agent-tools-heal.md` 与 `characterize-heal-mode.py` 已落地并加入 verify-all。
- **H5**：CHANGELOG `[Unreleased]` 已追加 Node 与 Python 同步提示。

### 验证结论

- `node --check`：全部改动 JS 文件通过。
- `python -m py_compile`：全部改动 Python 文件通过（使用 `D:\anaconda3\envs\browser_use\python.exe`）。
- `bash scripts/refactor/verify-all.sh`：**ALL GREEN**（含新增两个 characterization）。
- 既有环境基线：WSL 默认 `python` 缺 `pydantic`，门禁必须用 browser_use 环境 Python（通过 PATH 前置 `python -> D:\anaconda3\envs\browser_use\python.exe`）。
- Playwright Chromium headless shell 1217 本地缺失：已用同版本完整 Chromium（AppData 目录，**仓库外**）补齐 headless-shell 预期路径，`characterize-tree-select-record.py` 恢复绿色；未把任何浏览器文件提交进 git。

### 推迟项（不默认执行）

- **H4 / P2**：`HEAL_LOCATE_DECISION_ENABLED=1` 的真实 skip/fail/retry 路由。
- 真实浏览器 wet 实验与单列 batch replay 冒烟。
- absent-skip 对真实缺字段的误吞重评估（依赖 P2）。

### 纪律确认

- 未修改 `scripts/browser/factory.py` 的未提交改动。
- 未 push；按 H0/H1/H2/H3/H5 分段 commit。
