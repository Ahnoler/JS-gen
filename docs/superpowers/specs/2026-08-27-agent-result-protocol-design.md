# Agent 结果协议四层改造 · 设计文档

日期：2026-08-27
状态：待用户审阅
关联：本会话四次录制事故复盘（国别 value-mismatch 循环 / click_table_row_button 盲点 / click_icon_button 死循环 / field-disabled 空转 + 懒加载竞态）

## 1. 问题与目标

四次事故共因：**底层动作返回写给"确定性调用者"的状态码，而消费者是没有世界模型的 LLM**。失败结果缺"原因/现场/下一步"三要素时，Agent 只能同参重试直到 cycle 检测或预算耗尽；部分兜底返回假成功（ok-fallback、fallback-first 静默记 done），污染录制轨迹。

**目标**：让每一次非 ok 结果可解释（为什么失败）、含现场（世界里现在有什么）、可执行（具名下一个动作）；让每一处工具误用在选择前就被字段级标注规避；让语义存疑的成功可见且计分。

**已确认的四个决策**（用户拍板）：
1. 范围：高频六动作试点（select_option / fill_form_field / click_save / click_table_row_button+radio / click_icon_button / click_adjacent_button）
2. 载体：单字符串固定分段约定（不引入结构化 data 字段）
3. 防呆挂载：扫描条目带 `use` 字段（数据源头一次写入）
4. 记账强度：fallback 成功标注 wanted/got 并入 QUALITY 理由清单，不阻断提交

## 2. 四层设计

### 第 1 层 · 统一结果协议

新模块 `scripts/controller/actions/result_protocol.py`：

```python
def err_with(code: str, reason: str, observed: str = '', next_action: str = '') -> ActionResult:
    """构造 err-<code> | 原因:… | 现场:… | 下一步:… 的 ActionResult(_err)。
    code 必须是 [a-z0-9-]+；任一可选段为空则整段省略。"""

def ok_marked(label: str, got: str = '', *, fallback: str = '', wanted: str = '') -> ActionResult:
    """成功 + fallback 标注：ok | <got或label> [ | <fallback词> [| wanted:X] ]。"""

def validate_protocol(text: str) -> list[str]:
    """返回违反项列表；空列表=合法。特征化强制使用。"""
```

字符串规范（**注意：code 用连字符前缀 `err-`，兼容 `duplicate_failure_cue.step_failed` 的 startswith('err-') 判定**）：

```
err-<code> | 原因:<一句中文人话> | 现场:<紧凑事实 ≤8 条> | 下一步:<具名动作调用>
```

规则：
- 四段定序，段名精确为 `原因:` `现场:` `下一步:`；除首段外空段整段省略
- `<code>` 从受控枚举取值（见 §5 处方表），禁止一次性裸码
- 现场/下一步内容必须来自发点当场真实采集（affordances 或该动作已有候选数据），禁止编造模板句

试点六动作及其引擎实现落点：

| 动作 | 实现位置 | 主要失败点 → 新 code |
|------|---------|---------------------|
| select_option | form_action_engines.py `_select_option_impl`（value-mismatch 尾部、option-not-found 尾部、no-items） | `err-select-option-unresolved` |
| fill_form_field | 同文件 `FillEngine.fill_form_field` 两条路径（label/xpath）尾部 field-disabled | `err-field-disabled`（沿用现有裸码升级为协议形） |
| click_save | form_save.py not-found/validation/notification 分支 | `err-save-button-not-found`（保留现有码，补三段式体） |
| click_table_row_button / radio | _table.py 两动作 not-found 分支 | `err-table-row-not-found` / `err-button-not-found-in-row`（现有码转正） |
| click_icon_button | _misc.py not-found / ambiguous 分支 | `err-icon-label-miss` / `err-icon-label-ambiguous`（现为 not-found-text-button:*，转正） |
| click_adjacent_button | form_action_engines.py 相邻按钮节 | `err-no-adjacent-button` |

> 行为变化声明：`field-disabled` 现为裸串（不以 err- 开头），不参与 step_failed 失败判定；转正后将**新进入** duplicate_failure 计数与处方注入——这是有意设计（本会话正是它空转了 10+ 步而未被任何纠偏机制察觉）。

存量其余 39 个 `_err` 调用点本次不动。

### 第 2 层 · 现场快照助手

同模块内：

```python
async def affordances(page, label_text: str | None = None) -> dict:
    """一次 DOM 遍历返回紧凑可供性：
    {kind:'select|date|cascader|tree|input|unknown',
     options:[≤10 首选项文本], buttons:[{text,tag}≤8 排除表格行内],
     radio:bool, in_overlay:bool}
    label_text 给定时以该 form-item 为中心裁剪 scope。"""
```

六动作失败点按需引用子集拼"现场"段。取代本会话在 save/_table/icons/select 四处各写一遍的临时枚举。

### 第 3 层 · 防呆前置 use 字段

映射函数与表置于 result_protocol.py 内（单一出处）：

| kind | use |
|------|-----|
| select | `select_option(label_text=…, option_text=…)` |
| date | `fill_form_field(值需 YYYY-MM-DD)` |
| radio | `click_radio / click_table_row_radio` |
| tree-select | `select_tree_option(label_text=…, option_text=…)` |
| 其余/input | `fill_form_field` |

注入点：
- `scripts/models/field.py ScannedField` 增加 `use` 字段（默认空串），`form_scan_actions.py:129` 写 `_scan_fields` 时逐条计算
- `models/task.py TaskItem` 增加同名透传 → `get_pending_tasks_impl` JSON 自然带出
- `_llm_values.py:412` 表单助手 field_lines 行追加 `use=…`
- prompt 文档 agent-field-rules.md 追加一句：「任务列表/扫描条目若带 use 标注，优先照做」

### 第 4 层 · 记账 + 升级阶梯

**记账**：`ok_marked()` 在 fallback/wanted≠got 场景把 label 追加进 `store['_semantic_doubts']`。阶段末 `service.py:554` 附近：若 store 非空且已有其他 fail 理由，`mark_quality_failed(store, f'semantic_doubt_fields:{labels[:8]}')`——复用现有 variadic+去重管线，不新增触发失败的独立条件（按"标注+计分不阻断"决策）。

**升级阶梯**：`duplicate_failure_cue._ERR_PRESCRIPTIONS` 表新增 §1 表中全部新 code 的专用处方；现有 `[纠偏] HumanMessage` 注入机制自动生效，无需改 emitter 管线。

## 3. 测试与验收

1. 新特征化 `scripts/characterization/characterize-result-protocol.py`（注册 verify-all.sh）：
   - validate_protocol 合法/非法样例断言
   - 六动作源码 pin：每动作至少一条失败路径 emit 三标记文本
   - affordances 函数存在、ScannedField/TaskItem 带 use、_scan_fields 写入调用存在
   - ok_marked → _semantic_doubts 记账、service.py 阶段末并入、处方表新条目存在
2. CDP 19242 回归脚本（一次性验证脚本）：重放四次事故场景，逐个断言输出含三标记且指引指向正确动作
3. 全量 `verify-all.sh` ALL GREEN；CHANGELOG Added 条目

## 4. 边界（YAGNI）

- 不改 ActionResult 类/browser_use 通道；不加 data 字段
- 不迁移其余 39 个 `_err` 点（后续推广）
- 不做 fallback 值语义相似度智能判定——只诚实标注，不替业务判断对错
- 不加 feature flag（本会话行为等价性已多轮人工验证）
- CTRL 层零改动：协议字符串全部产生于 Python 动作层，CTRL 只回状态码

## 5. 已核实的接线锚点（供实施计划直接引用）

- `duplicate_failure_cue.py:68` `startswith('err-')` ——协议码前缀硬约束来源
- `_ERR_PRESCRIPTIONS` 位于 `duplicate_failure_cue.py:22-57`
- `_scan_fields` 写入：`form_scan_actions.py:129`；pending JSON：`:358/:369`
- 助手 LLM kind 行：`_llm_values.py:408-429`
- 质量理由：`phase/intent_gates.py:293 mark_quality_failed(*reasons)`；消费于 `service.py:541-577`
- pilot 六动作注册声明集中在 `_form.py`（实现在 form_action_engines.py/form_save.py）；click_icon_button 在 `_misc.py:189`；table 两动在 `_table.py`
