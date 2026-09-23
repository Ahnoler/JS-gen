# Design: 同表单项多控件扫描分发，与保存否定句

**日期**：2026-09-23  
**状态**：已审阅（2026-09-23 用户确认）。实现计划：`docs/superpowers/plans/2026-09-23-same-family-scan-and-save-negation.md`  
**触发**：轨迹 985 阶段 5。未启用产品「林业贷（对公-流动资金）[V-1.0.1]」的「保证金比例」已可见且非禁用，仍没有 `field_slot` 落库。  
**证据**：`logs/agent-stderr/a17ef65d-5d93-40cd-98be-2d62e47c661f.log`；Playwright `tmp/field-slot-playwright-20260923.md`。  
**相关**：`docs/superpowers/specs/2026-09-16-form-field-intra-slot-xpath-design.md`（点到控件之后的 xpath 消歧，本设计不重做）。

---

## 1. 问题

「产品基础参数」里「保证金比例」是同一个 `.el-form-item` 内的四个控件，从左到右：数字输入、下拉（TsscMultiSelect）、字面「值」、下拉、数字输入。标签都是「保证金比例」。

轨迹 985 里两件事叠在一起：

1. **扫描把整行收成一个下拉。** `JS_SCAN_FORM_FIELDS` 对每个 `.el-form-item` 只 `pushField` 一次，`classify(item)` 给出一个种类。行内有下拉时，种类是 `tssc-multi-select`，`xpath_smart` 落在第一枚下拉 `(…el-select…)[1]`。数字输入不出现在字段列表里。`fill_form_field(label_text=保证金比例, value=9)` 返回 `err-use-tssc-multi-select`，不落库。Playwright 在同一页能把 `9` 写入左边的数字框。
2. **「不点保存」被签成必须保存。** 阶段描述含「全程不点保存」。`_SAVE_TERMINAL_RE` 在全文里匹配「保存」，否定句也算。阶段意图评审超时后走规则兜底，签成 `mode=create`、`submit.required=true`、`click_save(保存)`、成功条件 `toast_ok|url_change`。超时日志是 `[phase_reviewer] failed:` 后面没有正文。

之后的模型 `500 fetch failed` 和 10 分钟空闲看门狗是填写被拒绝之后的收尾，不在本设计里修。

## 2. 引擎：扫描与分发

### 2.1 扫描

`scan_form_fields` 与 `scan_visible_fields` 都走 `JS_SCAN_FORM_FIELDS`。Phase 1（`.el-form-item`）改为按控件出条。

同一表单项内，**某一类叶子不少于两个**时，该类每个叶子一条。类按 9 月 16 日的同族划分，互不混编：

| 类 | 叶子 |
|---|---|
| 数字/文本输入 | 不在 `.el-select` 内的 `input` / `textarea` |
| 下拉 | `.el-select`（含包在 `.tssc-multi-select` 里的） |
| 日期、单选、多选、级联、树选择 | 与现有 `formFieldXpathSmartOf` 的同类规则一致 |

保证金比例这一行出四条：

| 文档序 | kind | field_slot | xpath |
|---|---|---|---|
| 左数字 | `input` | `A` | 该 input 的 `xpath_smart` |
| 左下拉 | `tssc-multi-select` | `A` | 该下拉的 `xpath_smart`，含 `[1]` |
| 右下拉 | `tssc-multi-select` | `B` | 含 `[2]` |
| 右数字 | `input` | `B` | 该 input 的 `xpath_smart` |

每条：

- `label` 仍是归一化后的「保证金比例」，不拼 `-A`。
- `field_slot` 在**该类内部**按文档序从 `A` 起编。
- `xpath_smart` 用现有 `formFieldXpathSmartOf` 指向这一枚叶子，沿用已有的 class-token 与字段内 `[n]`。
- 增加 `display_label` = `label + '-' + field_slot`，仅当有槽位。

只有一个同类叶子的表单项保持今天的一条字段，不带 `field_slot`，不带 `display_label`。「业务产品编号」属于这种。

字面「值」不是控件，不单独成条。

### 2.2 填写与选择

`fill_form_field` 和 `select_option`：

1. 调用带了非空 `xpath_smart`：只操作该定位命中的那一个控件。命中的是输入框时，按输入框填写，不因为同一表单项里还有 Tssc 下拉而返回 `err-use-tssc-multi-select`。命中的是下拉时，走该下拉自己的种类（tssc 或普通 select），不把兄弟输入框卷进来。
2. 调用只有标签、且该标签下**需要的那一类**控件多于一个：返回 `err-ambiguous-field-slot`，正文列出每个槽位的 `field_slot` 与 `xpath_smart`。不写入，不按第几次调用往后排。
3. 调用只有标签、且该类只有一个控件：保持今天的单控件路径。

禁用判断看被定位到的那一个控件。同一表单项里另一个控件禁用，不把当前这一个判成只读。

### 2.3 不做什么

- 不改 `label_text` 的语义，不把槽位拼进标签。
- 不回填历史轨迹。
- 不按调用次数自动选择下一枚控件。
- 不在本设计里改模型 500 或 10 分钟空闲看门狗。
- 不把跨表单项的同名标签纳入本规则（仍走现有精确标签 / 区域链）。

## 3. 合约：保存否定句

### 3.1 判定

`_has_save_terminal`（`boundary_contract.py`）不再把否定句里的词当成终态。

不算保存终态，同样句式套在「提交」「确认」「确定」上也不算：

- `不点保存`、`不要保存`、`勿点保存`、`禁止保存`、`禁止点击保存`
- 中间可以有「点击」或引号，例如 `全程不点「保存」`

算保存终态的肯定句保持今天的效力，例如 `点击保存`、`点保存`、`保存按钮`、`保存成功`、`保存后`、`并保存`，提交同理。

同一段里既有否定又有肯定时，肯定优先，仍要求保存。

填写阶段在「没有保存终态」时维持现有规则：`submit.required=false`，`success.kinds` 为空。有保存终态时仍是 `click_save` 加 `toast_ok|url_change`。

### 3.2 评审超时

评审失败或超时后，仍然用第 3.1 节的规则兜底，不另签一套合同。超时日志写 `phase_reviewer timeout`，不用空的异常消息。

## 4. 验收

离线：

- 保证金比例夹具：扫描四条，槽位与种类如上；无 `xpath_smart` 的 `fill_form_field("保证金比例")` 得到 `err-ambiguous-field-slot` 且不落库；带左数字定位的填写写入该输入框，不返回 `err-use-tssc-multi-select`；带左下拉定位的 `select_option` 只作用于那一枚下拉。
- 单控件字段：一条、无槽位，只传标签仍可填写。
- 「全程不点保存」的填写阶段：`submit.required` 为假，成功条件为空。
- 「填写后点击保存」：仍要求 `click_save`。
- 已有保存阶段的 characterization 保持通过。

湿测不在本设计的实现计划里自动开录。实现合并后，用未启用的「林业贷（对公-流动资金）[V-1.0.1]」再录一笔：左数字 `9`、左下拉、右下拉、右数字，步骤带 `field_slot` A/B，且不要求为了过门去点保存。

## 5. 自检

- 扫描出条、调用带定位、歧义不写入、否定句不算保存、肯定句优先、超时日志，均已写死。
- 与 9 月 16 日设计一致：槽位按同类编号，`label_text` 不改。
- 模型 500 与空闲看门狗明确排除。
