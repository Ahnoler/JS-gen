## Heal-Locate Optimization

**状态：** ✅ **开发完成**（2026-08-15 合入 `uara_V1.2`） · characterization 全绿 · **Phase 7 live 湿测待跑**（见 `heal-locate-wet`）

**总目标：**

将当前 Heal-Locate 从「元素不存在 → 盲目寻找 → 重复失败」升级为「定位失败 → 页面状态诊断 → 原因分类 → 自动修复 / 合理跳过 / 有限重试」。

最终目标：Agent 能理解“为什么找不到”，而不是只知道“没找到”。

### Phase 0：现状分析（Current State Analysis） ✅

- [x] 梳理 Replay → Action → Locator → Heal 调用链
- [x] 确认 Heal 触发条件
- [x] 分析当前 heal prompt 输入信息
- [x] 梳理当前 Locator 能力
- [x] 收集已有失败案例
- [x] 输出当前 Heal-Locate 架构图

产出：`docs/superpowers/specs/2026-08-15-heal-locate-current-analysis.md`。

### Phase 1：Heal-Locate Design ✅

- [x] 定义 Missing Element 分类体系
- [x] 定义 Heal Decision Tree
- [x] 定义定位优先级
- [x] 定义 Repair / Skip / Retry 策略

核心分类：

- Invisible
- Collapsed
- Conditional Hidden
- Wrong Page State
- Wrong Region
- Really Missing

> 分类体系已收敛为 MissingReason categories：`conditional_absent | not_visible | not_loaded | changed_structure | permission_blocked | business_locked | unknown`，并映射 `repair | skip | retry | heal | fail`。

### Phase 2：Locator Pipeline 优化 ✅

- [x] 建立 Locator Priority
- [x] 增加 semantic locate
- [x] 增加 region-aware locate
- [x] 限制 scroll 行为
- [x] 增加定位证据记录

> H0.4 已确认既有 `xpath_smart` / semantic / region 定位能力；`HealContract.target` 结构化携带 `action/label/xpath_smart/option_text`，`reason.evidence` + decision memory 记录定位证据；反 scroll 猎场禁令保留在 `heal-prompt.md`，live heal 由 strategy 约束。

### Phase 3：Missing Analyzer ✅

- [x] 设计缺席原因 Schema
- [x] 实现缺席分析器
- [x] 接入 Replay 流程
- [x] 增加诊断日志

> 落地为 Unified Missing Reason Analyzer：`src/services/trajectory/missing-reason-analyzer.js`（纯函数规则引擎）→ `heal-contract.js` → `runHealStep` 转发 → Python 解析。

### Phase 4：Heal Prompt 优化 ✅

- [x] 重构 heal prompt
- [x] 禁止无意义 scroll 搜索
- [x] 增加诊断流程
- [x] 增加结构化输出约束

> Type A/B instruction 旧文本不变，末尾追加【失败分析】`category/suggestedAction/evidence`；新增 `scripts/prompts/agent-tools-heal.md`，heal 模式只装配 `agent-core + agent-tools-common + agent-tools-heal`。

### Phase 5：Repair Action 扩展 ✅

- [x] expand section
- [x] switch tab
- [x] open dialog
- [x] select prerequisite option
- [x] refresh state
- [x] retry locate

> 既有工具已覆盖（`expand_all_el_tree` / `switch_tab` / `close_dialog` / `select_option` / `wait_for_loading` 等），本轮不新增工具；`agent-tools-heal.md` 的 strategy 约束优先使用等价恢复动作。

### Phase 6：Heal Trace & Memory ✅

- [x] 设计 heal_trace
- [x] 记录失败 → 原因 → 修复 → 结果链路
- [x] 关联 trajectory
- [x] 支持经验复用

> 落地为 decision memory：`runHealStep` 写入 `healType / maxSteps / healContract(mode,scope,strategy,category)` 并关联 `trajectoryId/sessionId`，作为失败→原因→修复→结果的审计沉淀，供经验复用。

### Phase 7：测试与验证 ⏳（live 湿测待跑）

- [ ] 级联隐藏字段测试
- [ ] 折叠区域测试
- [ ] Tab 状态错误测试
- [ ] Dialog 缺失测试
- [ ] 真实字段不存在测试

> 单元/契约 characterization 已绿（`characterize-heal-locate.mjs` 39 项、`characterize-heal-decision.mjs` 9 项、`characterize-heal-mode.py`）；以下 5 个真实浏览器场景尚未跑，统一登记为 `heal-locate-wet`。


## Heal-Locate Optimization TODO Adjustment (2026-08-14)

### Phase 3 调整

原目标：
- Missing Element Analyzer

调整为：
- Unified Missing Reason Analyzer

原因：
- 当前系统已经存在 label-not-found / ok-skip:label-not-found 等缺席字段处理逻辑。
- 不应重新建设独立缺席分析器，而应统一现有散落规则。

新的目标：

统一处理：
- label-not-found
- ok-skip:label-not-found
- field-disabled
- option-not-found
- select-disabled
- 页面状态导致的定位失败

形成统一决策模型：

MissingReason {
  type,
  confidence,
  evidence,
  action
}

决策结果：

- repair
- skip
- retry
- fail

Phase 3 后续以规则收敛和决策统一为主。
