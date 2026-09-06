# 方案A：modify 阶段「泛指填表」refill 判定修正 — 设计规格

日期：2026-08-27　分支：uara_V1.2　模式：主控(review/spec/plan) + 3 个不相交子代理并行

## 背景（根因取证结论）

草稿客户修改录制只写了法定责任人 + 必填兜底，其余表单项留空。根因链：
1. phase_reviewer 将泛指文案「填写信贷潜在客户的基本信息」判为 `refill=touched`
   （phase-reviewer-prompt.md 规则4「部分修改」，无泛指/点名 tie-breaker；
   业务数据仅 1 个点名字段 → 更倒向 touched）。
2. `form_modify_partial_hint()` 内部自相矛盾：第1行「每个可编辑字段执行写动作」
   vs 第1a行「只改任务点名的字段」。Agent 按 1a 执行。
3. `agent-tools-form.md:93`（表单修改=全字段）与 :48/:59（只改点名字段）互相矛盾。

行为本身合约合规——但用户预期为整表采集可操作元素，故修判定与一致性。

## 决策（用户已拍板方案A）

- **D1 判定层**：phase-reviewer-prompt.md 增加「泛指 vs 点名」tie-breaker：
  泛指 + 需保存的 create/modify → 一律 `refill=all_editable` + allow 助手；
  仅逐个列字段才 touched；拿不准倾向 all_editable；业务数据键少 ≠ 部分修改。
- **D2 提示层**：`form_modify_partial_hint()` 重写消除矛盾——明确「只改点名字段」，
  保留必填校验兜底处方提示；标题改为「— 部分字段」与全部字段版对称。
- **D3 文档层**：agent-tools-form.md 表单修改条目改为按合约 `refill` 条件化描述。
- **D4 不动项**：reviewer.py 清洗逻辑、classify/boundary/rules 兜底关键词、
  feature_flags 双 flag 默认值、CTRL/回放链路 —— 均不改。
- 变更面全部位于 `scripts/**`（Python 子进程层），按 AGENTS 约定可不写 CHANGELOG。

## 终稿文本（唯一权威，子代理照抄）

### F1 phase-reviewer-prompt.md 规则4 替换（Sub-A）

旧（line 42 整行）：
```
4. **部分修改**（只改个别字段）：`mode=modify`，`allow_form_assistant=false`，`refill=none` 或 `touched`。
```
新：
```
4. **部分修改**（阶段文案或业务数据**逐个点名**了要改的字段）：`mode=modify`，`allow_form_assistant=false`，`refill=touched`（点名要求含糊、无法构成字段集合时才可用 `none`）。
```

### F2 phase-reviewer-prompt.md 追加规则9（Sub-A，插在规则8 行之后、"## submit / success 约束" 标题之前）

```
9. **泛指 vs 点名判定基准**（规则 3 与规则 4 的分界）：
   - 阶段文案对填写范围是**泛指**（如「填写…信息」「完善…资料」「维护表单」），且未列出具体字段清单时，即使提到「修改」，也按整表维护处理：新增类走规则 2、修改类走规则 3——即 `refill=all_editable`、`allow_form_assistant=true`。
   - 仅当阶段文案或业务数据**逐个列出**目标字段（如「把法定责任人改为吴芳军」）才适用规则 4 的部分修改。
   - 拿不准是否点名字段时，倾向选 `refill=all_editable`：宁可全量覆盖录入以采集可操作元素，也不漏字段。
   - 业务数据键数少 ≠ 部分修改：业务数据通常只给关键取值，不得作为缩小填写范围的依据。
```

### F3 prompts.py `form_modify_partial_hint()` 整函数替换（Sub-B）

```python
def form_modify_partial_hint() -> str:
    """Phase preamble: modify named fields only — write task-named editable fields."""
    return (
        '\n\n【任务类型：表单修改 — 部分字段】\n'
        '本阶段只修改任务点名的字段，不是全量录入。\n'
        '1. 对任务点名的可编辑字段必须执行写动作（可同值重填）；未点名字段保留原值。\n'
        '2. 禁止调用 run_form_assistant；禁止盲目重选未点名字段。\n'
        '3. 禁止仅 check_field_value / 核对回显就点确认。\n'
        '4. 改完后 click_save(button_text="确认"或"保存")；成功 = 操作成功 或 页面跳转；'
        '保存被校验拦截时按 err-save-validation 信封处方补齐必填后再存。\n'
    )
```
约束：函数名/签名/位置不变；禁删相邻函数任何一行。

### F4 agent-tools-form.md 表单修改条目替换（Sub-B）

旧（"**表单修改：** 对每个可编辑字段执行写动作…" 整行）：
```
**表单修改：** 对每个可编辑字段执行写动作（**可同值重填**，为录制可操作元素）→ `click_save` → ok-save-success **或** ok-save-navigation **或** ok-save-no-feedback → `done`。
```
新：
```
**表单修改：** 写入范围以合约 `refill` 为准——`all_editable`=对每个可编辑字段执行写动作（**可同值重填**，为录制可操作元素）；`touched`/`none`=只写任务点名字段、其余保留原值。之后 `click_save` → ok-save-success **或** ok-save-navigation **或** ok-save-no-feedback → `done`。
```
（48/59 行既有「只改任务点名的字段」句与新语义一致，保留不动。）

## 波次与文件集不相交矩阵

| 子代理 | 独占文件 | 内容 |
|---|---|---|
| A | scripts/prompts/phase-reviewer-prompt.md | F1+F2 |
| B | scripts/controller/actions/phase/prompts.py ; scripts/prompts/agent-tools-form.md | F3+F4 |
| C | scripts/characterization/characterize-refill-contract.py(新建) ; scripts/refactor/verify-all.sh(追加1行) | 回归 pin |

终稿文本已在 spec 定死 → 三方可并发，C 的断言以本文件终稿为准。

## 验收门禁（主控终审执行）

1. `bash scripts/refactor/verify-all.sh` → ALL GREEN（含新登记 characterize-refill-contract）
2. `git diff` 复核三处无越界改动、F1–F4 与 spec 逐字一致
3. 负样本回归：涉 refill 的既有特征化（result-protocol / intent-contract 等）全绿由门禁覆盖
