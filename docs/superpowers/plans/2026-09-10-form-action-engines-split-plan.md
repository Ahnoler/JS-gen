# form_action_engines.py 拆分 — 执行 plan

> 2026-09-10 · 重构线。设计依据：`docs/superpowers/specs/2026-09-10-form-action-engines-split-design.md`。
> 门禁：每个 S 步结束 `bash scripts/refactor/verify-all.sh` 全绿后 commit。

## S1 — pin 拼接改造（25 脚本，4 并行子智能体，文件集不相交）

统一改造模式：脚本内所有对 `scripts/controller/actions/form_action_engines.py` 的 `read_text` 调用，替换为**顺序保真拼接**（跳过不存在的文件；Python 3.8 兼容，不用海象符）：

```python
src = ""
for _fname in (
    "form_engine_base.py", "login_engine.py", "fill_engine.py",
    "select_engine.py", "radio_engine.py", "tree_engine.py",
    "form_action_engines.py",
):
    _fpath = ROOT / "scripts/controller/actions" / _fname
    if _fpath.exists():
        src += _fpath.read_text(encoding="utf-8")
```

- 变量名/缩进按各脚本现场适配；多文件拼接脚本只动 engines 那一段，其余 read 不动。
- 每个脚本改造后必须**独立运行验证**：`./python/python.exe scripts/characterization/<path>.py`（python.exe 不可用则退 `python`），全部 PASS 才算完成。
- 分批（文件集互斥）：
  - **B1**（login/radio/tree/small，6）：characterize-login-action.py、cold/characterize-click-scope-picker-login.py、cold/characterize-radio-replay-engine.py、characterize-tree-select-record.py、cold/characterize-scan-assign-region-once.py、cold/characterize-adjacent-button.py
  - **B2**（fill，5）：characterize-field-value-match.py、characterize-result-protocol.py、cold/characterize-fill-replay-engine.py、cold/characterize-fill-dispatch.py、characterize-introduce-query-fill.py
  - **B3**（select-A，6）：characterize-select-option-verify.py、characterize-select-option-stamp.py、characterize-select-option-substring.py、characterize-select-option-suggest-field.py、cold/characterize-select-replay-engine.py、cold/characterize-select-dispatch.py
  - **B4**（select-B+跨段，8）：characterize-select-state-boundary.py、characterize-xpath-fill-select.py、cold/characterize-kb-i5-gaps-2.py、cold/characterize-tssc-multi-select.py、characterize-form-assistant.py、characterize-capture-element-xpath.py、characterize-xpath-primary-ops.py、characterize-form-engine-wiring.py（此脚本无 read_text，仅核对 import 不需改）
- 汇报格式：每脚本 改造处数 + 运行 PASS/FAIL；**子智能体不 commit**。
- 主线程：回收后 `verify-all` + `git diff` 抽查 + commit。

## S2 — form_engine_base.py

搬 `_FormActionEngineBase`(173-197)、`_ReplayPageAdapter`(1387-1396)、`_ReplayAutofillStub`(1397-1403)、`_replay_engine_store`(1404-1405)。新文件零 actions 模块依赖（实施时复核 base 方法体）。barrel 顶部 `from .form_engine_base import ...` 并 re-export。验收：verify-all 绿。

## S3 — login_engine.py

搬 `LoginEngine`(199-345)、`_wait_for_login_form`(141-168)；随迁 `JS_CLICK_LOGIN_BUTTON`、`WAIT_3000_MS` 的 import。barrel re-export `LoginEngine`。

## S4 — radio_engine.py

搬 `RadioEngine`(2092-2178)、`_unwrap_action_result`(1381-1385)；随迁 `JS_CLICK_RADIO`/`JS_CLICK_RADIO_BY_XPATH`。barrel re-export `RadioEngine`。

## S5 — tree_engine.py

搬 `TreeEngine`(2183-2329)；随迁 `JS_SELECT_TREE_OPTION`/`JS_EXPAND_ALL_EL_TREE`/`JS_FILL_BY_XPATH`/`JS_FILL_FORM_FIELD` import。barrel re-export `TreeEngine`。

## S6 — select_engine.py

搬 `SelectEngine`(1408-2085)、`_select_replay_uses_exact`(1371-1375)、`_select_js_option_arg`(1377-1379)、`_select_failure_next_action`(87-138)、JS 常量 `JS_SELECT_FILTERABLE_TYPED`(1019-1136)/`JS_SELECT_PAGED_TRAVERSE`(1138-1324)/`JS_SELECT_TRIGGER_MAIN_AREA`(1326-1368)。**铁律：不顶层 import form_autofill**。barrel re-export `SelectEngine`。

## S7 — fill_engine.py + barrel 终态

搬 `FillEngine`(360-1008)、`_false_ok_empty_actual`(348-355)、`_maybe_mark_stc_search_filled`(72-84)、`STRICT_FILL_GUARDS`(69)。**铁律：`from ._replay import ...` 保持函数内 lazy**。barrel 清死 import（调研清单 ~30 个）、仅剩 re-export；form_save.py:25 顺手直指 form_engine_base。验收：verify-all 绿 + `grep -c "class " form_action_engines.py` == 0。

## S8 — 收工

`verify-all` 终跑 + 全量 25 脚本单独复跑抽查（重点 4 个 cold）+ spec/plan 状态回写 + agent-log 收工条目（含各步 commit hash）。

## 回滚预案

任一步 verify-all 红且 30 分钟内修不动：`git revert` 该步 commit（每步独立 commit 保证可单步回退）；S1 的拼接 reader 对"文件不存在即跳过"意味着回退任一搬运步都自动恢复绿。
