# form_action_engines.py 按引擎拆分 — 设计 spec

> 2026-09-10 · 重构线。输入：两份调研（pin 清单 25 脚本、依赖图/符号归属矩阵）。
> 本 spec 是拆分的唯一设计依据；微步执行顺序见同日 plan。

## 1. 目标与非目标

**目标**：把 `scripts/controller/actions/form_action_engines.py`（2329 行，5 引擎类 + base + 适配器 + 4 个模块级 JS 常量）拆成每引擎一个文件 + 共享 base + barrel；全程 verify-all 每微步保持绿；25 个 read_text 特征化 pin 全部存活。

**非目标**：不改任何引擎行为；不动 `_form.py`/`replay_form_action.py`/`_replay.py` 等消费方（barrel 保兼容）；不动 ClickEngine（`click_action_engine.py`，已是独立自包含先例）；不处理 src/ 侧。

## 2. 模块布局与符号归属

| 新文件 | 内容（符号） | 独占依赖（随迁） |
|---|---|---|
| `form_engine_base.py` | `_FormActionEngineBase`、`_ReplayPageAdapter`、`_ReplayAutofillStub`、`_replay_engine_store`（F/S/R/T 四家 for_replay 构造三件套） | 零 actions 模块依赖（base 方法体不引用模块级符号——实施时复核） |
| `login_engine.py` | `LoginEngine`、`_wait_for_login_form` | `JS_CLICK_LOGIN_BUTTON`、`WAIT_3000_MS` |
| `fill_engine.py` | `FillEngine`、`_false_ok_empty_actual`、`_maybe_mark_stc_search_filled`、`STRICT_FILL_GUARDS` | fill_dispatch/`._replay`/`feature_flags` 的 **lazy import 必须保持函数内**；`PAGE_LOCATOR_HELPERS`/`JS_VISIBLE_OVERLAY_OF`/`JS_CHECK_SINGLE_FIELD`/`JS_GET_CONTAINER` 等 fill 独占 |
| `select_engine.py` | `SelectEngine`、`_select_replay_uses_exact`、`_select_js_option_arg`、`_select_failure_next_action`、JS 常量 `JS_SELECT_FILTERABLE_TYPED`/`JS_SELECT_PAGED_TRAVERSE`/`JS_SELECT_TRIGGER_MAIN_AREA` | `JS_SELECT_OPTION`/`JS_SELECT_TRIGGER_BY_XPATH`/`JS_SELECT_VALUE_BY_XPATH`/`JS_TSSC_MULTI_SELECT`/`resolve_select_dispatch`/`resolve_select_fallback`/`_pack_select_record` 等 select 独占；**不顶层 import form_autofill**（防软环，见 §4） |
| `radio_engine.py` | `RadioEngine`、`_unwrap_action_result` | `JS_CLICK_RADIO`/`JS_CLICK_RADIO_BY_XPATH` |
| `tree_engine.py` | `TreeEngine` | `JS_SELECT_TREE_OPTION`/`JS_EXPAND_ALL_EL_TREE`（js_snippets/select_tree.py）；fill 兜底 `JS_FILL_BY_XPATH`/`JS_FILL_FORM_FIELD` |
| `form_action_engines.py`（原地转 barrel） | 仅 re-export：`FillEngine, LoginEngine, RadioEngine, SelectEngine, TreeEngine, _FormActionEngineBase`（+ replay 三件套备用） | 无 |

共享 import（全引擎都用，各文件自带）：`_ok/_err/_is_ok_result/_wait_if_loading/_record_action/_resolve_control/_task_done_impl/_capture_element/stamp_recorded_xpath_smart`。

**死 import 处置**：现文件 ~30 个死 import（`emit_json`/`dataclass`/form_scan_utils 整批转出口等，调研确认无任何外部消费方）在 barrel 化时**直接删除**，不留兼容面。风险：个别 whole-concat pin 若借死名做存在性断言会在 S7 变红——红了再个案处理（恢复该 re-export 或改 pin 指向），不预防性保留。

## 3. pin 兼容策略（本设计的核心）

25 个特征化脚本对原文件做 `read_text` + 子串/类边界 chunk/拼接串断言，其中 **20 个是跨段 pin**（`text.find("class SelectEngine")` 切片、engines+_form 拼接、模块级符号与类体混打）。

**方案：顺序保真拼接读取（one-shot retarget）**。所有 25 个脚本在第 1 微步统一改为读取**固定顺序文件集**：

```
form_engine_base.py → login_engine.py → fill_engine.py → select_engine.py
→ radio_engine.py → tree_engine.py → form_action_engines.py(兜底尾)
```

- 顺序 = 原文件布局顺序（base→login→fill→select→radio→tree），保证相对顺序类 pin（“X 先于 Y”）不变。
- **不存在的文件跳过**（`if path.exists()`）——S1 改造时 6 个新文件尚不存在，拼接结果 = 原文件全文，当场绿；后续每搬一个引擎，内容从 barrel 消失、在新文件出现，拼接结果语义不变，**后续微步零脚本改动**。
- 类边界 chunk（`find("class SelectEngine")` → `split("class RadioEngine")`）在拼接串上依旧工作：类头字符串仍存在且相对次序不变。radio-replay-engine 依赖 RadioEngine→TreeEngine 同串切片：两引擎在拼接集中相邻（radio→tree），成立。
- 跨文件 chunk（engines尾+_form头，如 login chunk 以 `@controller.action` 截尾）：`@controller.action`/`scan_form_fields` 等右边界锚点只存在于 `_form.py`，中间插入的其余引擎文件不含这些锚点，`find` 落点不变。
- 负 pin（“不得包含 X”）：拼接全集 ≈ 原文件全集，语义不变。
- barrel 进兜底尾：最终 barrel 只剩 re-export 行，无类体，对 pin 无贡献也无污染。

**替代方案否决记录**：逐脚本改读单引擎文件——需重写 20 个脚本的 chunk 切片逻辑（5 个用类边界 find、5 个跨文件拼接），工作量和风险都数倍于拼接方案，且违背 `_form.py → form_autofill.py` 先例（测试读拼接文件）。

## 4. 循环 import 铁律

1. `fill_engine.py`：`_fill_form_field_replay_impl` 函数内 `from ._replay import ...` **必须保持函数内 lazy**（提升到顶层 = `_replay→replay_form_action→barrel→fill_engine→_replay` import 期环）。
2. `select_engine.py`：**不顶层 import `form_autofill`**（`FormAutofillEngine` 是死 import，直接删）；`autofill_round.py:348` 的 lazy `from .form_action_engines import SelectEngine` **保持经 barrel 且保持 lazy**，不改指 select_engine（零改动原则）。
3. 依赖方向唯一：base ← engines ← barrel ← 消费方（`_form.py`/`replay_form_action.py`/`form_save.py`/`autofill_round.py`）。

## 5. 消费方兼容面（barrel 最小契约）

| 消费方 | 依赖符号 | 处置 |
|---|---|---|
| `_form.py:35` | 5 个引擎类 | barrel re-export，零改动 |
| `replay_form_action.py:19` | 4 个引擎类 | 同上 |
| `form_save.py:25` | `_FormActionEngineBase` | 同上（S7 可顺手直指 form_engine_base，非必须） |
| `autofill_round.py:348`（lazy） | `SelectEngine` | 零改动 |
| `characterize-form-engine-wiring.py:21`（import） | 4 个引擎类 | 零改动 |

## 6. 微步序列（每步 verify-all 全绿后 commit）

S1 pin 拼接改造（25 脚本，4 个并行子智能体，文件集不相交）→ S2 base+适配器 → S3 login → S4 radio → S5 tree → S6 select（最大 JS 常量段）→ S7 fill（最大类）+ 死 import 清理 + form_save 直指 base → S8 收工审计。

排序理由：小而孤立的引擎先行验证搬运手法；select/fill 两大类放后（此时拼接机制已被 4 步实证）；fill 的 lazy import 陷阱最后单独处理。

## 7. 风险登记

| 风险 | 缓解 |
|---|---|
| 拼接 reader 改造漏掉某脚本的第二处 read_text | 子智能体逐脚本 grep `form_action_engines` 全部出现点并汇报改造处数 |
| 死 import 删除打破 whole-concat 借名断言 | S7 verify-all 红了个案处理（恢复 re-export 或改 pin） |
| 搬运时手滑改行为 | 微步只做移动不改行；每步 `git diff --stat` 核对零净增删行差（barrel 除外） |
| 他线在途冲突（Cursor click 线刚碰过 replay pin：f2c45d1d） | 开工声明已登记禁入区；S1 前重查 `git status` |
| cold 脚本不在门禁被漏验 | 4 个 cold 脚本由子智能体单独运行验证 |
