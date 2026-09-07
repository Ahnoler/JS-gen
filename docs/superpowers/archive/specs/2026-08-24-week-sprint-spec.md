# 本周冲刺 Spec：partition-via-pid + budget-extend + v3-payload-size ②③

> 状态：已评审（用户确认 2026-08-24）
> 日期：2026-08-24
> 硬约束：周三（8/26）EOD 前全部完成
> 关联：830 任务③分区推送改 PID；todo-list `partition-via-pid` / `budget-extend` / `v3-payload-size ②③`
> 调研：3 份 Explore 子智能体报告（partition-via-pid / budget-extend / v3-payload-size），已审查

---

## 0. 执行顺序与文件依赖

```
D1 (8/24)  partition-via-pid 实施  ←─┐
           budget-extend 实施       ←─┘ 并行（文件不相交）

D2 (8/25)  partition-via-pid characterization + 湿测
           budget-extend characterization + 湿测 traj 33 P2
           v3-payload-size ②③ 开工（等 partition 落地后接续，同改 export-v3.js）

D3 (8/26)  v3-payload-size ②③ 收尾 + verify-all ALL GREEN
```

**文件不相交确认**：
- partition-via-pid → `src/services/transaction-export-v3.js`, `src/services/partner-platform.js`
- budget-extend → `scripts/agent/service.py`, `scripts/controller/actions/phase/reviewer.py`, `scripts/agent_utils.py`
- v3-payload-size ②③ → `src/services/transaction-export-v3.js`（与 partition 同文件，故排在 partition 之后）

---

## 1. partition-via-pid：分区数据改 propertiesID/propertiesPID 父子树

### 1.1 目标

用现有的 `propertiesID`（自身 id）和 `propertiesPID`（父 id）两个字段表达完整分区层级，不加新字段。消费方通过 PID 父子树重建分区层级，区分同页同名控件（如两个"保存"按钮落在不同分区节点下 → pid 不同 → 可区分）。

### 1.2 非目标

- 不改截图采集 / element_json 录入侧（region_id 链仍照常录制，仅在导出构建期重新编码进 PID 树）
- 不在分区节点上保留角色信息（角色已在控件 xpath 中体现，分区节点只满足"分级"需求）
- 不改页面级截图覆盖校验的阻断语义（只改 pid 解析方式）

### 1.3 核心方案：插入中间分区节点

在 `buildV3Properties`（`transaction-export-v3.js:362-514`）构建期，为 region_id 链的每个分区段创建中间节点，插入 page 与 ele 之间。

**树结构示例**：

```
page#1 (type=page, pid=0, screenshot=[url])
  └ section#N   (type=section, pid=1, propertiesName="客户基本信息")     ← tab:客户基本信息
      └ section#N+1 (type=section, pid=N, propertiesName="对公客户概况")  ← section:对公客户概况
          └ ele#M   (type=ele, pid=N+1, propertiesName="填写名称")
          └ ele#M+1 (type=ele, pid=N+1, propertiesName="点击保存")
  └ section#N+2 (type=section, pid=1, propertiesName="主区")             ← main
      └ ele#M+2 (type=ele, pid=N+2, propertiesName="点击修改")
```

嵌套分区链（`tab:...|section:...|titlebox:...`）产生嵌套 section 节点，逐层 pid 指向父 section。单层分区（`main`/`table`/`shell-header`）产生 1 个 section 节点。

### 1.4 分区节点字段约定

| 字段 | 值 | 说明 |
|------|-----|------|
| `propertiesID` | 顺序号（续截图条目之后） | 与 page/ele 同一编号空间 |
| `propertiesPID` | 父节点 id（page 或父 section） | 根分区 → page 截图 id；嵌套子分区 → 父 section id |
| `type` | `'section'` | 新 type 值（非新字段）；湿测 400 fallback 见 §1.8 |
| `propertiesName` | 分区显示名 | 取 region_id 段的 label 部分（`role:label` → label） |
| `realLabel` | 同 propertiesName | 供消费方显示 |
| `screenshot` | `[]` | 分区节点无截图 |
| `rect` | `''`（空） | 分区节点无坐标 |
| `elementType`/`eventTypeValue`/`eventTypeName`/`mothed`/`options`/`objectValue`/`transcationType` | 空 / 默认 | 分区节点非操作步骤 |

### 1.5 ID 编号顺序

```
1..A   → page/dialog 截图条目（type=page/dialog，screenshot 非空）
A+1..B → section 分区节点（type=section，screenshot 空）
B+1..C → ele 控件步骤条目（type=ele，screenshot 空）
```

截图条目在前（保持现有顺序），分区节点居中（按首次出现顺序编号），ele 在后。

### 1.6 构建流程（`buildV3Properties` 改造）

```
1. 遍历 traj.steps，解析每个 step 的 element_json.region_id 链
2. 提取分区段：segments = region_id.split('|').filter(seg => !seg.startsWith('page:') && !seg.startsWith('overlay:'))
   - 跳过 page: 段（已有 page 截图条目承载）
   - 跳过 overlay: 段（popup 控件已通过 popupKey 链到 dialog 截图）
   - 兼容无 page 前缀的 legacy 数据：用 page_level_key / lastPageKey 补页面归属
3. 维护 sectionCache: Map<partitionKey, entryId>
   partitionKey = pageEntryId + '|' + segments.slice(0,i+1).join('|')
4. 逐段创建/复用 section 节点：
   for (i, seg) in segments:
       parent = (i==0) ? pageOrDialogEntryId : prevSectionId
       key = pageOrDialogEntryId + '|' + segments.slice(0,i+1).join('|')
       if sectionCache.has(key) → reuse entryId
       else → create section node: id=nextId++, pid=parent, propertiesName=label(seg)
              sectionCache.set(key, id)
       prevSectionId = sectionCache.get(key)
5. ele 节点的 pid = 最后一个 section 的 id
   无分区段 → pid = page/dialog 截图 id（保持原逻辑）
   无 element_json → pid = lastPageKey 对应截图 id（保持原 page-context 继承逻辑）
```

**sectionCache 复用**：同页同分区下多个 ele 共享 1 个 section 节点。两个同名"保存"按钮若在不同分区段下 → 不同 section 节点 → 不同 pid → 可区分。

### 1.7 覆盖校验适配（`validatePageLevelCoverage`）

当前代码（`transaction-export-v3.js:522-562`）直接检查 `shotIds.has(pid)`——ele 的 pid 直接指向 page/dialog。改造后 ele 的 pid 指向 section，需**沿 PID 链向上追溯**：

```js
function resolveRootScreenshotId(prop, propsById) {
  let cur = prop;
  while (cur && cur.type !== 'page' && cur.type !== 'dialog') {
    const pid = String(cur.propertiesPID || '0');
    if (pid === '0') return null;
    cur = propsById.get(pid);
  }
  return cur ? String(cur.propertiesID) : null;
}
```

- `shotIds` 仍只含 page/dialog 条目
- ele 的覆盖判定改为：`resolveRootScreenshotId(ele)` 返回的 id 在 `shotIds` 中
- `isLocatable` / `exempt` 逻辑不变
- section 节点本身不参与覆盖校验（只扫描 `type === 'ele'`）
- 存量兼容：legacy 模式 ele pid 直指 page，向上追溯一步到位

### 1.8 type='section' 伙伴接受度风险与 fallback

**无证据**伙伴接受 `type='section'`（现有证据只有 page/dialog/ele 被接受过）。

**策略**：section 优先推送，湿测首推即验。
- 伙伴返回 200 → section 方案确立
- 伙伴返回 400 → fallback：section 节点改用 `type='ele'` + `elementType='partition'`，消费方按 elementType='partition' 区分分区容器与控件

**fallback 实现**：在 `toPartnerImportPayload`（`partner-platform.js:147-171`）中加一个配置开关 `PARTNER_SECTION_TYPE`（默认 `'section'`，fallback 时改 `'ele'`），section 节点的 type 和 elementType 按此开关适配。不改变本仓构建逻辑（构建期始终用 `type='section'`），只在发送侧适配。

### 1.9 存量兼容

- legacy 模式（`coverageMode='legacy_phase_fallback'`）：ele 无 region_id 或无分区段 → pid 直指 page 截图，不创建 section 节点 → 与现有行为完全一致
- `validatePageLevelCoverage` 向上追溯对 legacy 数据天然兼容（pid 直指 page，一步到位）
- 现有 characterization 断言需同步更新（first ele id 不再 = shotCount+1，因为 section 节点插入在中间）

### 1.10 工具同步更新（供产品需求验证）

partition-via-pid 落地后，`scripts/tools/` 下的两个可视化工具需同步适配 section 节点，以便人工检查 PID 父子树是否满足"同页同名控件可区分"的产品需求。

**`scripts/tools/lightup-phase-screenshot.mjs`**（阶段图控件点亮 viewer）：
- 当前按 `metadata.elements[]` 在阶段长图上画框点亮控件。需新增 **PID 树视图**：读取 V3 payload（`--file` 模式）的 `transcationProperties[]`，按 propertiesID/propertiesPID 渲染父子树（page → section → section → ele），每个节点显示 propertiesName + type。
- section 节点显示为可折叠的容器节点（无画框，无坐标）；ele 节点保留现有画框点亮。
- 同页同名控件（如两个"保存"）在树中落在不同 section 父节点下 → 一目了然可区分。
- 用途：验证分区 PID 树的层级正确性和歧义消解效果。

**`scripts/tools/layer-tree-from-properties.mjs`**（元素分层树工具）：
- 当前从 `element_json.layers[]` 或 properties 构建分层树。需同步识别 `type='section'` 节点，将其作为树的非叶子层纳入渲染（而非忽略或当 ele 处理）。
- 三模式（`--file`/`--shot`/`--trajectory`）中 `--file` 模式读 V3 payload 时，按 PID 父子链重建树（而非只看 layers[]）。
- 用途：验证推送 payload 中的分区层级与录制时 element_json 的 layers[] 一致。

**验收方式**：用 traj 33 或 traj 182 的 V3 payload（dry-run 生成）跑两个工具，人工检查：
1. PID 树层级与 region_id 链分段一致（tab → section → titlebox 逐层嵌套）
2. 同页同名控件落在不同 section 下 → pid 不同
3. section 节点无画框/坐标，ele 节点有画框/坐标

### 1.11 实施文件清单

| 文件 | 改动 |
|------|------|
| `src/services/transaction-export-v3.js` | `buildV3Properties`：分区节点创建 + sectionCache + ele pid 改指向 section；`validatePageLevelCoverage`：向上追溯 pid 链；新增 `resolveRootScreenshotId` |
| `src/services/partner-platform.js` | `PARTNER_SECTION_TYPE` 开关 + section 节点 type/elementType 适配（fallback 时） |
| `scripts/tools/lightup-phase-screenshot.mjs` | 新增 PID 树视图：按 propertiesID/propertiesPID 渲染父子树，section 为可折叠容器节点，同页同名控件可区分 |
| `scripts/tools/layer-tree-from-properties.mjs` | 识别 type='section' 节点纳入树渲染；`--file` 模式按 PID 父子链重建树 |
| `scripts/characterization/characterize-export-v3-pid.mjs` | 新增：section 节点创建/复用、嵌套层级、ele pid 指向、同页同名区分、覆盖校验向上追溯 |
| `scripts/characterization/characterize-export-v3.mjs` | 更新：first ele id 断言（因 section 插入编号变化） |
| `scripts/refactor/verify-all.sh` | 注册 `characterize-export-v3-pid.mjs` |
| `src/dashboard/api-docs/groups/export-mgmt.js` | api-docs 补 type='section' 说明 |
| `CHANGELOG.md` | [Unreleased] Changed 追加条目 |

---

## 2. budget-extend：阶段步数预算动态加成 + 耗尽续跑

### 2.1 目标

预算耗尽且工作未完时，对同一 Agent 实例二次 `agent.run(max_steps=extension)` 续跑，而非接受失败。总步数 ≤ ceiling，扩展轮次 ≤2，防失控。

### 2.2 非目标

- 不动 ceiling（`PHASE_MAX_STEPS`）与评审器 LLM 提示词估算本身
- 不做 mid-run 修改 `agent.state.max_steps`（browser_use 无此接口）
- 不处理「最后阶段 success=False 仍 isSuccessful=1」的语义传导（另议）

### 2.3 done 检测（修正 spec 原硬伤）

原 spec 假设 `agent._done_fired` 存在——**调研确认该属性不存在**（browser_use 0.1.48 与本仓均无）。

**修正方案**：在 `make_done_callback`（`agent_utils.py:399-408`）闭包内设置 flag，写入 `case_data_store['_done_fired']`：
- done 回调被触发时 `case_data_store['_done_fired'] = True`（含 success=True/False 两种情况）
- run 后质量门检查 `case_data_store.get('_done_fired', False)` 判断 done 是否触发
- 每次 `_run_agent_step` 开头重置为 `False`

### 2.4 引入字段计数（修正 spec 原硬伤）

原 spec 假设引入字段从 task_list 读——**调研确认 `TaskItem.from_scanned` 丢弃 disabled 字段，task_list 几乎不含引入字段**。

**修正方案**：从 `case_data_store['_scan_fields']` 读引入字段：
```python
def count_introduce_fields(case_data_store):
    scan_fields = case_data_store.get('_scan_fields', [])
    return sum(1 for f in scan_fields
               if f.get('disabled') and f.get('hasButton'))
```
`_assistant_needs_agent` 作为辅助参考（LLM 识别的引入字段子集），不作为主计数源。

### 2.5 run() 二次调用验证（修正 spec 原硬伤）

原 spec 声称"同实例二次调用已验证"——**调研确认无测试依据**。框架状态设计支持（`AgentState` 在 `__init__` 创建一次跨 run 持久，`n_steps` 累加），但需新增 characterization 钉住。

**新增 characterization**（`characterize-budget-extend.py`）：
- 注入 fake controller/llm 的 Agent，`run(1)` + `run(1)` 断言 `n_steps` 累加（2）
- history 延续（第二轮的 history 不为空）
- `AgentStepInfo.step_number` 每轮从 0 起算（框架行为，不影响 n_steps 累加）

### 2.6 续跑触发条件（全部满足）

1. **预算耗尽**：`case_data_store.get('_done_fired', False)` 为假（done 从未触发，run 循环自然走完）；或 done 显式 `success=False` 且失败原因属「工作未完」类
2. **工作未完**：`check_pending_write_gate` 不通过（pending_fields），或 `_scan_fields` 存在 disabled+hasButton 项（引入字段未完），或 `_assistant_needs_agent` 非空
3. **闸门**：`agent.state.n_steps + extension ≤ ceiling`，且 `扩展轮次 < _BUDGET_EXTEND_MAX_ROUNDS(=2)`

### 2.7 extension 成本模型

新增纯函数 `compute_budget_extension(pending_state) -> int`，放 `reviewer.py`：

```python
def compute_budget_extension(pending_state):
    introduce = pending_state['introduce_fields']   # disabled+hasButton 计数
    pending = pending_state['pending_fields']       # 普通 pending 计数
    tree_select = pending_state['tree_select_fields']
    raw = introduce * 4 + pending * 2 + tree_select * 1 + 2  # verify + done 收尾
    return max(0, min(raw, pending_state['ceiling'] - pending_state['used_steps']))
```

### 2.8 控制流改造（`service.py:457-509`）

现质量门在 run 后无条件执行一次并 emit phase_end。改为循环：

```python
case_data_store['_done_fired'] = False
await agent.run(max_steps=max_steps, ...)

round = 0
while round < _BUDGET_EXTEND_MAX_ROUNDS:
    # 评估续跑条件
    done_fired = case_data_store.get('_done_fired', False)
    pending_ok, pending_labels = check_pending_write_gate(case_data_store, section=_sec)
    introduce_count = count_introduce_fields(case_data_store)
    needs_agent = case_data_store.get('_assistant_needs_agent', [])

    if done_fired and (pending_ok or not contract.get('refill') == 'all_editable'):
        break  # done 触发且工作完成 → 不续跑
    if pending_ok and introduce_count == 0 and not needs_agent:
        break  # 工作完成 → 不续跑

    used = agent.state.n_steps
    extension = compute_budget_extension({
        'introduce_fields': introduce_count,
        'pending_fields': len(pending_labels),
        'tree_select_fields': count_tree_select(case_data_store),
        'ceiling': ceiling,
        'used_steps': used,
    })
    if extension <= 0 or used + extension > ceiling:
        break  # 预算用尽 → 不续跑

    round += 1
    stderr: [budget] extend round={round} +{extension} steps (introduce={introduce_count} pending={len(pending_labels)})
    case_data_store['_done_fired'] = False  # 重置，续跑轮可能再次触发 done
    await agent.run(max_steps=extension, ...)

# 循环结束后：质量门最终评估 + emit phase_end
ok_pending, labels = check_pending_write_gate(case_data_store, section=_sec)
# ... 现有质量门逻辑（QUALITY FAIL 检测、phase_end payload 组装）
```

**关键约束**：
- 续跑轮不提前落 `_quality_failed`（只在循环结束后最终评估）
- 续跑不走 `_close_agent()`（`service.py:96` 每次 `_run_agent_step` 开头关闭旧 agent——续跑在同一 `_run_agent_step` 内复用同实例，不触发该路径）
- 续跑前检查 `cancel_flag_path` / `agent.state.stopped`（已取消则不续跑）
- 续跑轮注入精简 task 前缀（复用 `format_phase_preamble` 机制，抑制漫游）

### 2.9 可观测性

- 续跑决策写 stderr：`[budget] extend round=N +M steps (introduce=X pending=Y)`
- `phase_end` payload 增加 `budgetExtensions: [{round, steps, introduce, pending}]`（可选字段，向后兼容）
- 在 `service.py:496-509` 组 phase_payload 时并入

### 2.10 实施文件清单

| 文件 | 改动 |
|------|------|
| `scripts/controller/actions/phase/reviewer.py` | 新增 `compute_budget_extension` 纯函数 |
| `scripts/agent_utils.py` | `make_done_callback` 闭包内设置 `case_data_store['_done_fired']` |
| `scripts/agent/service.py` | run 后质量门改为续跑循环；新增 `count_introduce_fields`；`budgetExtensions` 并入 phase_end payload |
| `scripts/characterization/characterize-budget-extend.py` | 新增：`compute_budget_extension` 成本模型 + 闸门 + run() 二次调用验证 |
| `scripts/characterization/characterize-phase-runtime.py` | 更新：续跑循环控制流断言（如有必要） |
| `scripts/refactor/verify-all.sh` | 注册 `characterize-budget-extend.py` |
| `CHANGELOG.md` | [Unreleased] Changed 追加条目 |

---

## 3. v3-payload-size ②③：字段完整性校验 + 推送前自检 + 降级/截断

### 3.1 目标

防信息丢失：构建期字段完整性校验/缺失统计、推送前自检；鲁棒性：缺字段降级、超长截断策略。**不改 payload 契约**（字段名/类型不变）。

### 3.2 非目标

- 不做 v3-payload-size ①（精简传输：去 params、收敛 target——契约变更需消费方对齐，稳定版后另刀）
- 不阻断推送（只统计告警，不 block）

### 3.3 字段完整性校验

新增纯函数 `validateFieldCompleteness(entry)`，放 `transaction-export-v3.js`（紧邻 `validatePageLevelCoverage`）：

```js
export function validateFieldCompleteness(entry) {
  const props = Array.isArray(entry?.transcationProperties) ? entry.transcationProperties : [];
  const missing = [];
  for (const p of props) {
    const issues = [];
    if (p.type === 'ele') {
      if (!String(p.elementType || '').trim() && !String(p.realLabel || '').trim())
        issues.push('missingElementTypeAndLabel');
      if (String(p.propertiesPID || '0') === '0')
        issues.push('orphanPid');
    }
    if (p.type === 'page' || p.type === 'dialog') {
      const shots = Array.isArray(p.screenshot) ? p.screenshot : [];
      if (shots.length === 0) issues.push('emptyScreenshot');
    }
    if (!String(p.propertiesName || '').trim()) issues.push('emptyName');
    if (issues.length) missing.push({ propertiesID: p.propertiesID, type: p.type, issues });
  }
  return { ok: missing.length === 0, missing };
}
```

**兼容 section 节点**：section 节点 `type='section'`——无 elementType/realLabel/screenshot 是正常的，不报 issue。校验只对 `type='ele'` 检查 elementType/realLabel，对 `type='page'|'dialog'` 检查 screenshot。

### 3.4 超长截断策略

构建期对超长字段截断（字段名/类型不变，只截值），在 `buildV3Properties` / `buildScreenshotEntries` 序列化前：

| 字段 | 上限 | 截断方式 |
|------|------|----------|
| `elementType`（xpath） | 2000 字符 | 尾部截断 + `...truncated` 后缀 |
| `options`（select inventory JSON） | 4000 字符 | 尾部截断 + `...truncated`（消费方需完整 options 的场景另议） |
| `objectValue` | 500 字符 | 尾部截断 + `...truncated` |
| `propertiesName` | 100 字符 | 尾部截断（不加后缀，保持简洁） |

截断在 `uniquifyPropertiesNames` 之前执行（避免截断后产生新的碰撞）。

### 3.5 推送前自检

在 `pushImportDemand`（`partner-platform.js:289-312`）入口，`toPartnerImportPayload` 之后，检查 wire payload：

```js
function preflightCheck(wirePayload) {
  const list = wirePayload?.transcationEventTypeList || [];
  const issues = [];
  for (const entry of list) {
    for (const p of entry.transcationProperties || []) {
      // undefined 值检测（JSON.stringify 静默丢弃 undefined key → 信息丢失）
      for (const [k, v] of Object.entries(p)) {
        if (v === undefined) issues.push({ id: p.propertiesID, field: k, issue: 'undefinedValue' });
      }
      // page/dialog 必须有 screenCapture
      if ((p.type === 'page' || p.type === 'dialog') && !p.screenCapture)
        issues.push({ id: p.propertiesID, issue: 'emptyScreenCapture' });
    }
  }
  return { ok: issues.length === 0, issues };
}
```

只统计不阻断。issues 写 stderr 供审计。

### 3.6 stats 扩展

`buildTransactionEntryV3.stats`（`transaction-export-v3.js:651-659`）扩展：

```js
stats: {
  // 现有
  absoluteFallback, missingOptions, noRectControls,
  coverageMode, coverageExemptSteps, missingPageLevelScreenshots, missingPageLevelKeys,
  // 新增
  fieldCompletenessIssues: completeness.missing.length,
  fieldCompletenessDetail: completeness.missing,  // 每条 {propertiesID, type, issues[]}
  truncatedFields: { elementType, options, objectValue, propertiesName },  // 各字段截断计数
}
```

`wrapTransactionListV3.stats`（`:717-725`）聚合 `fieldCompletenessIssues` 和 `truncatedFields`。batch 响应（`export-mgmt.js:681-689`）surface `merged.stats`。

### 3.7 实施文件清单

| 文件 | 改动 |
|------|------|
| `src/services/transaction-export-v3.js` | 新增 `validateFieldCompleteness`；截断逻辑；stats 扩展 |
| `src/services/partner-platform.js` | 新增 `preflightCheck`；`pushImportDemand` 入口调用 |
| `src/routes/v2/export-mgmt.js` | batch 响应 surface `merged.stats`；单推路径同步 |
| `scripts/characterization/characterize-export-v3-field-completeness.mjs` | 新增：字段完整性校验 + 截断 + preflight |
| `scripts/refactor/verify-all.sh` | 注册新 characterization |
| `CHANGELOG.md` | [Unreleased] Changed 追加条目 |

---

## 4. 验收标准

### 4.1 partition-via-pid

1. characterization `characterize-export-v3-pid.mjs`：
   - 单层分区（main/table/shell-header）→ 1 个 section
   - 嵌套分区（tab|section|titlebox）→ 3 个嵌套 section
   - ele pid 指向最近 section；无分区段 ele pid 指向 page（原逻辑）
   - sectionCache 复用：同页同分区多个 ele 共享 1 个 section
   - 同页同名 ele 在不同分区下 → pid 不同 → 可区分
   - 覆盖校验向上追溯命中 page 截图
   - 回归：现有 V3 断言（截图合并/rect 字符串/screenCapture）不动
2. 湿测：推送一条含 section 节点的交易到伙伴平台，验证 200 且 section 条目被接受；400 则 fallback
3. verify-all ALL GREEN

### 4.2 budget-extend

1. characterization `characterize-budget-extend.py`：
   - `compute_budget_extension`：引入 2 + pending 3 + tree 1 → 17；clamp 边界；全空 → ≤0 不续跑
   - 续跑闸门：轮次、ceiling 用尽不续
   - run() 二次调用：n_steps 累加、history 延续
   - done 检测：闭包 flag 正确设置
   - 回归：现有 `resolve_phase_max_steps` 断言不动、全绿
2. 湿测：重录 traj 33 P2（引入 刘伟/刘玲）——预算耗尽后续跑 → 引入完成 → done(success=True)；或续跑 2 轮后仍失败且 QUALITY FAIL 落库（可接受下限）
3. verify-all ALL GREEN

### 4.3 v3-payload-size ②③

1. characterization `characterize-export-v3-field-completeness.mjs`：
   - `validateFieldCompleteness`：ele 缺 elementType+realLabel → issue；orphan pid → issue；page 无 screenshot → issue；section 节点不报 issue
   - 截断：超长字段截断后长度 ≤ 上限；`...truncated` 后缀
   - preflight：undefined 值检测；page 无 screenCapture → issue
   - 回归：现有 V3 断言不动
2. verify-all ALL GREEN

---

## 5. 风险与对策

| 风险 | 对策 |
|------|------|
| type='section' 伙伴 400 | §1.8 fallback（type='ele'+elementType='partition'） |
| run() 二次调用框架行为异常 | §2.5 新增 characterization 钉住；续跑前检查 stopped/cancel |
| 续跑轮 _quality_failed 提前污染 | §2.8 循环结束后才最终评估 |
| 引入字段计数不准 | §2.4 从 _scan_fields 读（主）+ _assistant_needs_agent（辅） |
| 截断后 uniquifyPropertiesNames 碰撞 | 截断在 uniquify 之前执行 |
| 浏览器插件伙伴格式对齐 | section 节点结构写入 CHANGELOG + api-docs 供伙伴对齐 |
| payload size 未减 | 本 spec 只做完整性校验+截断，精简传输①另刀 |
