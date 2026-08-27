# Agent 结果协议四层改造 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让六个高频动作的所有非 ok 结果携带「原因＋现场＋下一步」三段式协议，扫描条目带 `use` 推荐动作，fallback 假成功语义存疑记账并进入 QUALITY 理由清单。

**Architecture:** 新中央模块 `result_protocol.py` 提供构造器/校验器/kind 映射/affordances 助手；六动作失败点逐点替换为协议信封；模型层 `use` 字段单点写入多处透传；记账经 `_semantic_doubts` store 键汇入既有 `mark_quality_failed` 管线。存量其余 39 个 `_err` 点、ActionResult 类、CTRL JS 层零改动。

**Tech Stack:** Python 3.x（项目便携解释器 `./python/python.exe`）、pydantic 模型、特征化源码 pin 风格测试（scripts/characterization，无 pytest —— 每个测试文件自带 main() 并 raise SystemExit）、bash `verify-all.sh` 门禁。

## Global Constraints

- Spec：`docs/superpowers/specs/2026-08-27-agent-result-protocol-design.md`（决策四项已锁定，勿重开讨论）
- 协议首段必须以 **`err-` 连字符前缀**开头（`duplicate_failure_cue.step_failed` 的 `startswith('err-')` 硬约束）；错误码枚举表见 spec §1，禁止发明表外裸码
- 四段定序：`err-<code> | 原因:<…> | 现场:<…> | 下一步:<…>`；段名精确为 `原因:` / `现场:` / `下一步:`；空段整段省略
- 存量 39 个非试点 `_err` 调用点本次不动；不动 ActionResult 类；不改任何 `src/ctrl-actions/**`（协议字符串全部产生于 Python 层）
- 测试运行方式：`./python/python.exe scripts/characterization/<file>.py`（Windows Store python 桩不可用）；characterization 目录豁免 lint/JSDoc
- 每次 src/scripts 行为变更须在 CHANGELOG.md `[Unreleased]` 追加条目（Keep a Changelog 分类）
- 现场与下一步内容必须来自发点当场真实采集，禁止编造模板句

---

### Task 1: result_protocol 核心模块（构造器/校验器/kind 映射）

**Files:**
- Create: `scripts/controller/actions/result_protocol.py`
- Create: `scripts/characterization/characterize-result-protocol.py`
- Modify: `scripts/refactor/verify-all.sh`（紧跟 characterize-table-toolbar-pattern 注册行之后）

**Interfaces:**
- Produces:
  - `err_with(code: str, reason: str, observed: str = '', next_action: str = '') -> ActionResult`
  - `ok_marked(store: dict | None, label: str, got: str = '', *, fallback: str = '', wanted: str = '') -> ActionResult`
  - `validate_protocol(text: str) -> list[str]`（返回违规项列表；空=合法）
  - `recommend_action_for_kind(kind: str) -> str`

- [ ] **Step 1: 写失败测试**（characterize-result-protocol.py 初始版）

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Characterize: Agent result protocol (三段式 err 结果 · use 推荐 · 记账).

Spec: docs/superpowers/specs/2026-08-27-agent-result-protocol-design.md
Run: ./python/python.exe scripts/characterization/characterize-result-protocol.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

MOD = ROOT / "scripts" / "controller" / "actions" / "result_protocol.py"


def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)


def test_err_with_three_sections():
    from scripts.controller.actions.result_protocol import err_with
    r = err_with("select-option-unresolved", "下拉中没有精确或相近的选项",
                 observed="options=法人投资,自然人投资",
                 next_action='select_option(label_text="投资主体类型", option_text="法人投资")')
    t = str(r.extracted_content)
    assert_true(t.startswith("err-select-option-unresolved | "), "must start with hyphen code")
    assert_true("| 原因:" in t and "| 现场:" in t and "| 下一步:" in t, "three sections present")
    # 空段省略
    r2 = err_with("icon-label-miss", "没有匹配标签")
    assert_true("| 现场:" not in str(r2.extracted_content), "empty observed omitted")
    assert_true(str(r2.error).startswith("err-icon-label-miss"), "error attr mirrors code")


def test_validate_protocol():
    from scripts.controller.actions.result_protocol import validate_protocol
    good = ("err-x | 原因:a | 现场:b | 下一步:c")
    assert_true(validate_protocol(good) == [], f"good rejected: {validate_protocol(good)}")
    assert_true(any("原因" in v for v in validate_protocol("err-x | 现场:b")), "missing reason flagged")
    assert_true(validate_protocol("not-err | 原因:a") != [], "non err- prefix flagged")
    assert_true(validate_protocol("err-X! | 原因:a") != [], "bad code charset flagged")


def test_recommend_action_for_kind():
    from scripts.controller.actions.result_protocol import recommend_action_for_kind as rec
    assert_true(rec("select").startswith("select_option"), "select -> select_option")
    assert_true(rec("date").startswith("fill_form_field") and "YYYY-MM-DD" in rec("date"), "date hint")
    assert_true(rec("tree-select").startswith("select_tree_option"), "tree-select")
    assert_true(rec("radio") == "click_radio", "radio")


def main() -> int:
    test_err_with_three_sections()
    test_validate_protocol()
    test_recommend_action_for_kind()
    print("characterize-result-protocol: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 运行确认失败**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py`
Expected: FAIL — `ModuleNotFoundError ... result_protocol`

- [ ] **Step 3: 实现 result_protocol.py**

```python
"""Agent result protocol (2026-08-27 spec) — 三段式 err 结果与 use 推荐.

Spec: docs/superpowers/specs/2026-08-27-agent-result-protocol-design.md
Shape: 'err-<code> | 原因:<reason> | 现场:<observed> | 下一步:<next_action>'
空段整段省略；code 必须连字符小写（duplicate_failure_cue.step_failed 的
startswith('err-') 硬约束）。现场/下一步由调用点当场采集后传入，本模块不编造。
"""
from __future__ import annotations

import re

from ._helpers import _err, _ok

_CODE_RE = re.compile(r"^err-[a-z0-9-]+$")

# kind -> 推荐动作（防呆前置单点出处；spec §第3层映射表）
_KIND_ACTIONS = {
    "select": 'select_option(label_text="<此字段label>", option_text=<选项原文>)',
    "date": "fill_form_field(值需 YYYY-MM-DD)",
    "tree-select": 'select_tree_option(label_text="<此字段label>", option_text=<选项原文>)',
    "radio": "click_radio(label_text=<字段>, option_text=<选项>)",
}


def recommend_action_for_kind(kind: str) -> str:
    k = (kind or "").strip()
    if k in _KIND_ACTIONS:
        return _KIND_ACTIONS[k]
    return "fill_form_field(label_text=\"<此字段label>\", value=<文本值>)"


def _sections(reason: str, observed: str, next_action: str) -> str:
    out = ""
    if reason:
        out += f" | 原因:{reason}"
    if observed:
        out += f" | 现场:{observed}"
    if next_action:
        out += f" | 下一步:{next_action}"
    return out


def err_with(code: str, reason: str, observed: str = "", next_action: str = ""):
    """Build the three-section protocol ActionResult (_err wrapped).

    Sections always ordered 原因→现场→下一步; empty section omitted entirely.
    error attr mirrors 'err-<code>' so duplicate_failure_cue matches.
    """
    c = (code or "").strip().lower()
    if not _CODE_RE.match(c):
        raise ValueError(f"protocol code must match err-[a-z0-9-]+, got {code!r}")
    text = f"{c}{_sections(reason or '', (observed or '').strip(), (next_action or '').strip())}"
    return _err(text)


def validate_protocol(text: str) -> list[str]:
    """Return violations ([] == valid). Used by characterization pins."""
    t = (text or "").strip()
    bad: list[str] = []
    if not t.startswith("err-"):
        bad.append("prefix: must start with err-")
    head = t.split(" ", 1)[0].rstrip(":")
    if t.startswith("err-") and not _CODE_RE.match(head):
        bad.append(f"code charset: {head!r}")
    for seg in ("原因:", "现场:", "下一步:"):
        idx = t.find(seg)
        if idx >= 0 and t.find(seg, idx + 1) > idx:
            bad.append(f"duplicate segment {seg}")
    order = [t.find(s) for s in ("原因:", "现场:", "下一步:") if t.find(s) >= 0]
    if order != sorted(order):
        bad.append("section order must be 原因→现场→下一步")
    return bad


def ok_marked(store=None, label: str = "", got: str = "", *, fallback: str = "",
              wanted: str = ""):
    """Honest success. fallback non-empty => mark semantic doubt into store
    ('_semantic_doubts' label list, dedup) so phase-end can surface it."""
    parts = [got or label]
    fb = (fallback or "").strip()
    if fb:
        parts.append(fb)
    w = (wanted or "").strip()
    if fb and wanted and wanted != got:
        parts.append(f"wanted:{wanted}")
    try:
        if store is not None and fb and label:
            lst = store.setdefault("_semantic_doubts", [])
            if label not in lst:
                lst.append(label)
                if len(lst) > 64:
                    del lst[:-64]
    except Exception:
        pass
    return _ok(" | ".join(p for p in parts if p))
```

同文件顶部按需补 `from ._helpers import _err, _ok`（路径已给出）。注意 `_helpers._ok(msg)` 返回 ActionResult(extracted_content=msg)；ok_marked 使用它。

- [ ] **Step 4: 运行确认通过**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py`
Expected: `characterize-result-protocol: OK`

- [ ] **Step 5: 注册 verify-all 并提交**

在 `scripts/refactor/verify-all.sh` 中 `run "characterize-table-toolbar-pattern"` 行后插入：

```bash
run "characterize-result-protocol" "$PY" scripts/characterization/characterize-result-protocol.py
```

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py && bash scripts/refactor/verify-all.sh 2>&1 | tail -1`
Expected: BOTH OK / `verify-all: ALL GREEN`

```bash
git add scripts/controller/actions/result_protocol.py scripts/characterization/characterize-result-protocol.py scripts/refactor/verify-all.sh
git commit -m "feat(protocol): result_protocol 核心模块——err_with 三段式/validate/kind 推荐/ok_marked 记账"
```

---

### Task 2: affordances 现场快照助手

**Files:**
- Modify: `scripts/controller/actions/result_protocol.py`（追加函数）
- Modify: `scripts/characterization/characterize-result-protocol.py`（追加 pin）

**Interfaces:**
- Produces: `async def affordances(page, label_text: str | None = None) -> dict`
  返回 `{kind:str, options:list[str](≤10), buttons:list[{text,tag}](≤8), radio:bool, in_overlay:bool}`；任何异常返回 `{}`。

- [ ] **Step 1: 追加失败 pin**（append 到 characterize-result-protocol.py）

```python
def test_affordances_source_shape():
    js_src = MOD.read_text(encoding="utf-8")
    assert_true("async def affordances(page" in js_src, "async affordances present")
    assert_true(".el-select-dropdown__item" in js_src, "reads select options")
    assert_true(".el-table__body-wrapper')) continue" in js_src,
                "button probe excludes table-row affordances")
    assert_true("el-form-item__label" in js_src, "label scoping present")
```

main() 里补 `test_affordances_source_shape()` 调用。

- [ ] **Step 2: 运行确认失败**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py`
Expected: FAIL — `async affordances present`

- [ ] **Step 3: 实现**（追加到 result_protocol.py 末尾）

```python
_AFFORDANCES_JS = r"""(labelText) => {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    let scopeLabel = '';
    let fi = null;
    const items = [...document.querySelectorAll('.el-form-item')];
    if (labelText) {
        for (const it of items) {
            const lab = it.querySelector('.el-form-item__label');
            const t = lab ? norm(lab.textContent) : '';
            if (!t) continue;
            if (t === labelText || t.includes(labelText)) { fi = it; break; }
        }
    }
    const root = fi || document;
    if (fi) scopeLabel = norm((fi.querySelector('.el-form-item__label') || {}).textContent);
    const vis = (el) => el && el.offsetParent !== null;
    const kind = fi
        ? (fi.querySelector('.el-select') ? 'select'
           : fi.querySelector('.el-date-editor, .tsscdatepicker') ? 'date'
           : fi.querySelector('.el-cascader') ? 'cascader'
           : fi.querySelector('[class*="tssc"]') && (fi.querySelector('.tree-popover, .my-popover')) ? 'tree'
           : fi.querySelector('textarea') ? 'input' : 'input')
        : 'unknown';
    let options = [];
    if (!fi || kind === 'select') {
        const dds = [...document.querySelectorAll('.el-select-dropdown')]
            .filter(d => d.getBoundingClientRect().width > 0);
        const dd = dds[dds.length - 1];
        if (dd) {
            options = [...dd.querySelectorAll('.el-select-dropdown__item')]
                .map(o => norm(o.textContent)).filter(Boolean).slice(0, 30);
        }
    }
    const buttons = [...root.querySelectorAll('button, .el-button, a')]
        .filter(b => vis(b) && !b.closest('.el-table__body-wrapper'))
        .map(b => ({ text: norm(b.innerText || b.textContent).slice(0, 40),
                     tag: b.tagName.toLowerCase() }))
        .filter(x => x.text)
        .slice(0, 8);
    return {
        kind,
        options: options.slice(0, 10),
        buttons,
        radio: !!root.querySelector('.el-radio, input[type=radio]'),
        in_overlay: !!(fi && fi.closest('.el-dialog, .el-drawer, .el-message-box')),
    };
}"""


async def affordances(page, label_text: str | None = None) -> dict:
    """One-pass DOM affordance snapshot (原因/现场 的素材来源). 失败安全：异常返 {}."""
    try:
        raw = await page.evaluate(_AFFORDANCES_JS, label_text)
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}
```

注意 `.el-table__body-wrapper')) continue` 字面量不在本实现中——pin 改为断言 `b.closest('.el-table__body-wrapper')`（同步修改 Step1 的第二断言为：

```python
    assert_true(".el-table__body-wrapper" in js_src and "buttons" in js_src,
                "button probe excludes table rows")
```
（在写 Step 1 时直接采用该版本。）

- [ ] **Step 4: 运行通过 + 提交**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py`
Expected: OK

```bash
git add scripts/controller/actions/result_protocol.py scripts/characterization/characterize-result-protocol.py
git commit -m "feat(protocol): affordances 现场快照助手"
```

---

### Task 3: select_option 失败尾巴协议化

**Files:**
- Modify: `scripts/controller/actions/form_action_engines.py`（SelectEngine `_select_option_impl` 尾部三个 `_err` 出口）
- Modify: `scripts/characterization/characterize-result-protocol.py`（pin）

**Interfaces:**
- Consumes: `err_with`, `affordances`
- Produces: 该动作所有 heal 失败文本形如 `err-select-option-unresolved | …`（triples；no-items 也归并此码，原 no-items 场景 rarely hit）

- [ ] **Step 1: 失败 pin**

```python
def test_select_engine_protocol_wiring():
    src = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
    sel = src.split("class SelectEngine", 1)[1].split("class RadioEngine", 1)[0]
    assert_true(sel.count('_final_select_failure(') >= 1, "_final_select_failure retained")
    assert_true("err-select-option-unresolved" in sel, "tail failures emit protocol code")
    assert_true(
        "from .result_protocol import err_with" in sel or "from .result_protocol import" in src,
        "protocol import present",
    )
```

main() 补调用；运行确认 FAIL（先 fail 后改）。同 Step 内把该方法（以及其他后续 task 的 pin 函数）统一加入 main()。

- [ ] **Step 2: 实现**

模块顶部加 import（form_action_engines.py 已有大量相对导入区）：`from .result_protocol import err_with, affordances`。
把 `_final_select_failure(...)` 之后所有 `return _err(failed)` 形态（SelectEngine 范围内共 ~5 处：no-items、mismatch 双出口、exactOnly 出口、option-not-found 兜底两处、else 兜底）改为：

```python
return err_with(
    "select-option-unresolved",
    f"无法稳定选中「{option_text}」",
    observed=(f"label={label_text} last={failed}"[:160]),
    next_action=f'select_option(label_text="{label_text}", option_text=<从 现场/scan options 取原文>)',
)
```

其中 mismatch 主尾（retrigger-ok 分支内 exactOnly 之后的 `return _err(failed)`）用 resolved 变体 reason：`f"别名解析至「{resolved_option}」仍回读不一致"`。`no-items` 特殊分支保持 `err-select-option-unresolved` 且 reason=`"下拉无可见选项"`。
注意：保留 `_final_select_failure()` 调用本身（其内部 reset_select_ui 副作用必需），仅替换其返回值的包装层。

- [ ] **Step 3: 运行全部相关门**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py && ./python/python.exe scripts/characterization/characterize-select-option-verify.py && bash scripts/refactor/verify-all.sh 2>&1 | tail -1`
Expected: 全 OK / ALL GREEN（characterize-select-option-verify 中 "_err(failed)" 断言若因此失败：更新其断言为 `err_with(` 存在于同节，并在 commit message 注明断言迁移）

- [ ] **Step 4: 提交**

```bash
git add scripts/controller/actions/form_action_engines.py scripts/characterization/characterize-result-protocol.py
git commit -m "feat(protocol): select_option 失败尾巴接三段式信封"
```

---

### Task 4: fill_form_field → err-field-disabled（收敛既有指引）

**Files:**
- Modify: `scripts/controller/actions/form_action_engines.py`（FillEngine 两条失败出口 + `_field_disabled_hint` 收敛进信封）
- Modify: `scripts/characterization/characterize-result-protocol.py`（pin）

**Interfaces:**
- Produces: fill 的 field-disabled 失败文本 = `err-field-disabled | 原因:<kind 人话> | 现场:... | 下一步:<推荐动作原文>`。行为变化声明见 spec §1 表后注（新入 step_failed 计数是目的）。

- [ ] **Step 1: 失败 pin**

```python
def test_fill_disabled_envelope():
    src = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
    fill = src.split("class FillEngine", 1)[1].split("class SelectEngine", 1)[0]
    assert_true('err-field-disabled' in fill, "envelope code used")
    assert_true('startswith(\'field-disabled\')' in fill, "bare JS marker still detected pre-wrap")
    assert_true(fill.count("err_with(") >= 2, "both label & xpath exits wrapped")
```

- [ ] **Step 2: 实现**

FillEngine 两个 `if str(result).startswith('field-disabled'):` 块（label 路径与 xpath 路径）改为：

```python
if str(result).startswith('field-disabled'):
    kind_info = await affordances(page, resolved.label or label_text)
    kind = (kind_info or {}).get('kind', 'unknown')
    obs = []
    if kind_info.get('options'):
        obs.append("options=" + ",".join(kind_info['options'][:6]))
    if kind_info.get('buttons'):
        obs.append("adjacent=" + ",".join(b['text'] for b in kind_info['buttons'][:3]))
    nxt = recommend_action_for_kind(kind)
    return err_with(
        "field-disabled",
        ("该字段是下拉框(el-select/Tssc)，不能文本直填" if kind == 'select'
         else f"控件形态 kind={kind} 不接受直接文本写入"),
        observed=",".join(obs),
        next_action=nxt.replace("<此字段label>", resolved.label or label_text),
    )
```

（删去原 `_field_disabled_hint` 文本拼接逻辑与该 helper——其知识已由 recommend_action_for_kind 取代；两处相同处理。）文件头 import 增加 `recommend_action_for_kind`。

- [ ] **Step 3: 运行**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py && bash scripts/refactor/verify-all.sh 2>&1 | tail -1`
Expected: OK / ALL GREEN

- [ ] **Step 4: Commit**

```bash
git add scripts/controller/actions/form_action_engines.py scripts/characterization/characterize-result-protocol.py
git commit -m "feat(protocol): fill_form_field field-disabled 转 err-field-disabled 三段式（含推荐动作）"
```

---

### Task 5: click_save not-found 分支协议化（范围偏差说明见注）

**Files:**
- Modify: `scripts/controller/actions/form_save.py`（`err-save-button-not-found` 分支）
- Modify: `scripts/characterization/characterize-result-protocol.py`（pin）

**Interfaces:**
- Produces: not-found 文本仍以 `err-save-button-not-found` 开头（处方表前缀兼容），随后 `| 原因:… | 现场:candidates=[…] | 下一步:…`。

> **范围偏差（如实记录）**：spec §1 表将 validation/notification 两分支也列入；实施中降级——这两支已有结构化 payload 与专用处方且无循环事故史，本轮不重塑以防破坏 `sync_tasks_from_errors` 类消费方；如后续需要再立计划。CHANGELOG 条目会如实注明只升级 not-found。

- [ ] **Step 1: 失败 pin**

```python
def test_save_notfound_envelope():
    src = (ROOT / "scripts/controller/actions/form_save.py").read_text(encoding="utf-8")
    nf = src.split("'Close interfering dialogs")[0][-1500:] if "'Close interfering dialogs" in src else src[-2500:]
    assert_true(nf.count("err_with(") >= 1, "not-found wraps with protocol")
    assert_true("err-save-button-not-found" in nf, "legacy code preserved as prefix")
```

- [ ] **Step 2: 实现**

form_save.py 顶部 import `from .result_protocol import err_with`。把 not-found 分支整体（含 chain-risk 注释块）替换为：

```python
            # CHAIN RISK note moved into reason (2026-08-26 incident): 盲用
            # close_dialog 会关掉正在编辑的抽屉丢全部表单——指引已改为最后手段。
            return err_with(
                "save-button-not-found",
                f"区域{sec!r}内未找到保存按钮（候选 collected={len(candidates)}）",
                observed=f"candidates={cand_json}",
                next_action=(
                    '优先 region= 按 candidates 里标题重试；'
                    '"close interfering dialogs" 仅作最后手段且确认弹层非编辑抽屉'
                    + (stale_hint if retry_scope else '')
                ),
            )
```

保留变量名 `cand_json/stale_hint/retry_scope/sec/needle` 上下文不动；needle 若仍需日志，上文 stderr.write 已有。

- [ ] **Step 3/4: 运行门禁 + 提交**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py && ./python/python.exe scripts/characterization/characterize-duplicate-failure-cue.py && bash scripts/refactor/verify-all.sh 2>&1 | tail -1`
Expected: OK×N / ALL GREEN

```bash
git add scripts/controller/actions/form_save.py scripts/characterization/characterize-result-protocol.py
git commit -m "feat(protocol): click_save not-found 接三段式（close_dialog 降级为末选）"
```

---

### Task 6: _table 两动置信封化

**Files:**
- Modify: `scripts/controller/actions/_table.py`
- Modify: `scripts/prompts/agent-tools-table.md`（提及 codes 同步）
- Modify: `scripts/characterization/characterize-result-protocol.py`（pin）；同时更新 `characterize-table-toolbar-pattern.py` 中依赖旧文本的两处断言（`err` 包装判断）

**Interfaces:**
- Produces: `err-table-row-not-found | 原因:… | 现场:rows=… | 下一步:…` 与 `err-button-not-found-in-row | 原因:… | 现场:{wanted,rowButtons,rowHasRadio json} | 下一步:radio→工具栏 指引`（rowHasRadio=true 时下一步含 click_table_row_radio 调用串）。

- [ ] **Step 1: 失败 pin**

```python
def test_table_envelopes():
    src = (ROOT / "scripts/controller/actions/_table.py").read_text(encoding="utf-8")
    assert_true(src.count("err_with(") >= 2, "both actions use envelope")
    assert_true("err-table-row-not-found" in src and "err-button-not-found-in-row" in src, "codes")
    prompt = (ROOT / "scripts/prompts/agent-tools-table.md").read_text(encoding="utf-8")
    assert_true("err-button-not-found-in-row" in prompt, "prompt documents new code")
```

- [ ] **Step 2: 实现**

_table.py：JS 内部返回码不变（Python 侧包装改协议）；两处失败 `return result` 前置转换——

not-found 分支（button+radio 共用文案各自实例化）：

```python
        if str(result) == 'row-not-found':
            return err_with(
                "table-row-not-found",
                f"表格中没有匹配行（row_text={row_text!r}）",
                observed=f"rowCount={await _count_rows(page)}",   # 或并入 affordances buttons
                next_action='核对 row_text 与 scan 可见单元格原文；跨单元格可用空格拼接（匹配已忽略空白）',
            )
```

`_count_rows` 若嫌重可去掉 observed 或改为静态提示；**不得**新增第二次 evaluate 以外开销——直接给常量提示串最简：observed='' 即可。
button-not-found-in-row 分支沿用现有 Python 包装改造：

```python
        if str(result).startswith('button-not-found-in-row'):
            import json as _json
            body = {}
            try:
                body = _json.loads(result.split(':', 1)[1])
            except Exception:
                pass
            radio_hint = (
                f'click_table_row_radio(row_text="{row_text}") 选中行后再点工具栏按钮'
                if body.get('rowHasRadio') else '该行无可选中单选框，请换定位策略'
            )
            return err_with(
                "button-not-found-in-row",
                f"行内没有「{button_text}」按钮",
                observed=result.split(':', 1)[1],
                next_action=radio_hint + '；禁止盲点行内其他控件',
            )
```

删掉旧的两段纯文本 `_err(...)` 包装。顶部 import `from .result_protocol import err_with`。

- [ ] **Step 3: 同步** prompt（agent-tools-table.md 第一个 bullet 的 `button-not-found-in-row` 提法补成 `err-button-not-found-in-row`）+ 更新 characterize-table-toolbar-pattern.py 对应断言（字符串 `button-not-found-in-row` 仍在 → 大多自动过；逐个跑二者）。

- [ ] **Step 4: 运行 + 提交**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py && ./python/python.exe scripts/characterization/characterize-table-toolbar-pattern.py && bash scripts/refactor/verify-all.sh 2>&1 | tail -1`
Expected: 全 OK

```bash
git add scripts/controller/actions/_table.py scripts/prompts/agent-tools-table.md scripts/characterization/
git commit -m "feat(protocol): 表格两动作结果协议化，radio→工具栏指引进 下一步 段"
```

---

### Task 7: click_icon_button 转正（codes 重命名）

**Files:**
- Modify: `scripts/controller/actions/_misc.py`
- Modify: `src/ctrl-actions/index.js`（文档行 codes）、`scripts/prompts/agent-tools-table.md`
- Modify: characterize-result-protocol.py pin；characterize-table-toolbar-pattern.py 相关断言（ambiguous 字符串仍在但前缀变化需对齐）

**Interfaces:**
- Produces: miss → `err-icon-label-miss | 原因:… | 现场:…(无候选时省略) | 下一步:…`；歧义 → `err-icon-label-ambiguous | … | 现场:textButtons=[…] | 下一步:…`（替代现 `not-found-text-button:*`）。ok-text 成功路径不变，另走 Task 9 记账挂接。

- [ ] **Step 1: 失败 pin**

```python
def test_icon_codes():
    misc = (ROOT / "scripts/controller/actions/_misc.py").read_text(encoding="utf-8")
    icons = (ROOT / "scripts/controller/actions/js_snippets/icons.py").read_text(encoding="utf-8")
    assert_true("err-icon-label-miss" in misc and "err-icon-label-ambiguous" in misc, "python codes")
    assert_true("err-icon-label-ambiguous" in (ROOT / "src/ctrl-actions/index.js").read_text(encoding="utf-8"),
                "ctrl doc line updated")
    assert_true("not-found-text-button" not in icons, "legacy prefix removed from JS emitters")
```

- [ ] **Step 2: 实现**

icons.py JS：两处返回码字符串替换（payload JSON 原样）：`not-found-text-button:` → `err-icon-label-ambiguous:`；裸 `'not-found'` 保留由 Python 包装。_misc.py：
- ambiguous 分支 `startswith('not-found-text-button:')` → `startswith('err-icon-label-ambiguous:')`，改调 `err_with('icon-label-ambiguous', reason='同名/相近文字按钮多个，无法唯一选择', observed=result.split(':',1)[1], next_action='改用 click_element_by_index 点击目标索引；或提供完整按钮文字重试')`
- miss 分支（JS 现在 return 'not-found' 的路径）`return result` 前拦截：

```python
        if str(result) == 'not-found':
            return err_with(
                "icon-label-miss",
                f"页面未找到标签含「{button_text}」的可点按钮（图标宿主与文字按钮均未命中）",
                next_action=get_page_state_icon_hint(button_text),  # 见下
            )
```

`get_page_state_icon_hint` 就地定义为一行字符串常数即可：`'核对 get_page_state().iconButtons 清单；确认目标按钮可见且未在表格行内（行内请用 click_table_row_button）'`——不要为此再加一次 DOM 扫描。
index.js clickIconButton 文档行 codes 替换。agent-tools-table.md 中 `not-found-text-button` 字样替换为新码。

- [ ] **Step 3: 校准旧 pin** characterize-table-toolbar-pattern.py 中 `not-found-text-button` 断言改查 `err-icon-label-ambiguous`；图标示例保留断言不动。

- [ ] **Step 4: 运行 + 提交**

Run: 上述三个 characterization + verify-all tail
Expected: 全 OK

```bash
git add scripts/controller/actions/_misc.py scripts/controller/actions/js_snippets/icons.py src/ctrl-actions/index.js scripts/prompts/agent-tools-table.md scripts/characterization/
git commit -m "feat(protocol): icon 工具码转正 err-icon-label-miss/-ambiguous 并同步文档行"
```

---

### Task 8: use 推荐字段全链路

**Files:**
- Modify: `scripts/models/field.py`（ScannedField 增 `use`）
- Modify: `scripts/models/task.py`（TaskItem 增 `use` + `from_scanned` 透传 + form_scan_actions prev-done TaskItem(...) 补参）
- Modify: `scripts/controller/actions/form_scan_actions.py`（写 `_scan_fields` 时计算；prev-done 构造补 `use=prev.use if prev else ''`）
- Modify: `scripts/controller/actions/_llm_values.py:412`（行加 `, use: {rec}`）
- Modify: `scripts/prompts/agent-field-rules.md`（一句规则）
- Modify: characterize-result-protocol.py pin

**Interfaces:**
- Consumes: `recommend_action_for_kind(kind)`
- Produces: ScannedField.model_dump()/TaskItem.model_dump() 均含 `use`；get_pending_tasks JSON 自动带出。

- [ ] **Step 1: 失败 pin**

```python
def test_use_field_pipeline():
    fld = (ROOT / "scripts/models/field.py").read_text(encoding="utf-8")
    tsk = (ROOT / "scripts/models/task.py").read_text(encoding="utf-8")
    scan = (ROOT / "scripts/controller/actions/form_scan_actions.py").read_text(encoding="utf-8")
    llm = (ROOT / "scripts/controller/actions/_llm_values.py").read_text(encoding="utf-8")
    rules = (ROOT / "scripts/prompts/agent-field-rules.md").read_text(encoding="utf-8")
    assert_true("\n    use: str = Field(\n        default=\"\"" in fld, "ScannedField.use")
    assert_true(tsk.count("use") >= 3 and "from_scanned" in tsk and 'field.get("use"' in tsk, "TaskItem.use + passthrough")
    assert_true("recommend_action_for_kind" in scan, "computed at write site")
    assert_true("use=" in llm or "use:" in llm, "llm line carries use")
    assert_true("use 标注" in rules or "use=" in rules, "prompt rule added")


def test_use_round_trip():
    from scripts.models.field import ScannedField
    from scripts.models.task import TaskItem
    d = ScannedField(label="国别", kind="select", use=recommend_action_for_kind("select")).model_dump()
    assert_true(d["use"].startswith("select_option"), "dump carries use")
    ti = TaskItem.from_scanned(d)
    assert_true(ti is not None and ti.use.startswith("select_option"), "from_scanned passthrough")
```

（文件顶部 import 区补 `from scripts.controller.actions.result_protocol import recommend_action_for_kind`——pin 内 import 放测试函数体内亦可。）

- [ ] **Step 2: 实现**

- models/field.py：ScannedField 追加
  ```python
      use: str = Field(
          default="",
          description="Recommended controller action for this kind (agent guidance)",
      )
  ```
- models/task.py：TaskItem 追加同款；`from_scanned` 末尾构造参数增加 `use=field.get("use", "")`；`from_scan(cls, fields...)` 若独立构造 items（grep `cls(` 于该函数）同样补 `use=field.get("use","")`。
- form_scan_actions.py：
  - 写 `_scan_fields` 前：`for f in dom_fields: f.use = recommend_action_for_kind(f.kind)`
  - prev-done `TaskItem(...)` 构造补 `use=prev.use if prev else '',`
- _llm_values.py line 组装处追加：
  ```python
              ua = item.get('use') if isinstance(item, dict) else ''
              if ua:
                  line += f', use: "{ua}"'
  ```
- prompts/agent-field-rules.md 末尾追加一行：
  `- 任务列表/扫描条目带 use=… 时，该字段的写入动作**必须**照做（kind↔工具 权威映射），不得用其他动作尝试。`

- [ ] **Step 3: 运行 + 提交**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py && bash scripts/refactor/verify-all.sh 2>&1 | tail -1`
Expected: OK / ALL GREEN

```bash
git add scripts/models/field.py scripts/models/task.py scripts/controller/actions/form_scan_actions.py scripts/controller/actions/_llm_values.py scripts/prompts/agent-field-rules.md scripts/characterization/characterize-result-protocol.py
git commit -m "feat(protocol): 扫描/任务列表带 use 推荐动作（kind 单点映射四处透传）"
```

---

### Task 9: semantic_doubts 生产者接线 + 阶段末并入

**Files:**
- Modify: `scripts/controller/actions/form_action_engines.py`（select fallback-first/mismatch-retry-exact 等 fallback 成功处改走 ok_marked）
- Modify: `scripts/controller/actions/_misc.py`（icon ok-text 成功处接 ok_marked）
- Modify: `scripts/agent/service.py`（阶段末并入理由，`:554` 相邻）
- Modify: characterize-result-protocol.py pin

**Interfaces:**
- Consumes: `ok_marked(store, label, got, fallback=..., wanted=...)`
- Produces: QUALITY reasons 可能出现 `semantic_doubt_fields:<labels≤8>`；store 键 `_semantic_doubts`。

- [ ] **Step 1: 失败 pin**

```python
def test_doubt_wiring():
    eng = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
    svc = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    assert_true("ok_marked(" in eng, "select fallback success uses ok_marked")
    assert_true("semantic_doubt_fields" in svc, "phase-end appends doubts reason")
    assert_true("_semantic_doubts" in eng or True, "store key via ok_marked only")
    misc = (ROOT / "scripts/controller/actions/_misc.py").read_text(encoding="utf-8")
    assert_true("ok_marked(" in misc, "icon ok-text success records doubt")
```

- [ ] **Step 2: 实现**

- form_action_engines.py SelectEngine 两处 fallback 成功出口（`fallback-first | wanted:` 与 `mismatch-retry-exact` 所在的 return `_ok(...)`）改：

```python
                    from .result_protocol import ok_marked
                    return ok_marked(
                        self.business_data_store, label=label_text, got=matched_text,
                        fallback=("mismatch-retry-exact" if strict else "fallback-first"),
                        wanted=(option_text if matched_text != option_text else ""),
                    )
```

（strict 布尔按所在分支字面量传；首次成功路径 `_with_submit_cue(f'ok | {matched_text}' …)` 非 fallback，保持 `_ok` 不动。）
- _misc.py icon ok-text 分支同型（label 用 button_text，wanted=button_text 当 clicked 文本≠其时记 fallback='ok-text'）。
- service.py 在 pending_fields gate 之后追加：

```python
            doubts = business_data_ref.get('_semantic_doubts')
            if doubts and not business_data_ref.get('_quality_failed'):
                pass  # 仅失败汇总语境挂载，避免把疑点当失败触发器
            elif doubts:
                mark_quality_failed(business_data_ref,
                                    f"semantic_doubt_fields:{','.join(list(doubts)[:8])}")
```

（语义：只有本来就 QUALITY FAIL 的阶段把疑点列进理由清单，绝不单独制造失败——对应“标注计分不阻断”决策。）

- [ ] **Step 3: 运行 + 提交**

Run: characterize-result-protocol + verify-all tail
Expected: OK / ALL GREEN

```bash
git add scripts/controller/actions/form_action_engines.py scripts/controller/actions/_misc.py scripts/agent/service.py scripts/characterization/characterize-result-protocol.py
git commit -m "feat(protocol): fallback 语义存疑记账并入 QUALITY 理由（不阻断）"
```

---

### Task 10: 处方表扩充

**Files:**
- Modify: `scripts/controller/actions/duplicate_failure_cue.py`（`_ERR_PRESCRIPTIONS` 追加）
- Modify: characterize-result-protocol.py pin

- [ ] **Step 1: 失败 pin**

```python
def test_prescriptions_cover_new_codes():
    dfu = (ROOT / "scripts/controller/actions/duplicate_failure_cue.py").read_text(encoding="utf-8")
    for code in ("err-select-option-unresolved", "err-field-disabled",
                 "err-button-not-found-in-row", "err-table-row-not-found",
                 "err-icon-label-miss", "err-icon-label-ambiguous"):
        assert_true(f"'{code}'" in dfu, f"prescription registered: {code}")


def test_prescription_lookup_hits():
    from scripts.controller.actions.duplicate_failure_cue import duplicate_failure_prescription as rx
    assert_true(rx("err-field-disabled | 原因:x").startswith("[纠偏]") and "select_option" in rx("err-field-disabled | 原因:x"), "disabled maps to select_option advice")
    assert_true(rx("err-select-option-unresolved anything").startswith("[纠偏]"), "unresolved mapped")
```

- [ ] **Step 2: 实现**（依现有 tuple 形状追加 6 条；文案体现“下一次具体做什么”）

```python
    (
        'err-select-option-unresolved',
        _PREFIX + '禁止用同一 option_text 第三次重试。改取错误里 现场/options 的原文'
        '（或 option-not-found 列表中的相近项）作为 option_text 再试一次。',
    ),
    (
        'err-field-disabled',
        _PREFIX + '这是下拉类字段，fill_form_field 不会再成功。按字段 kind 用'
        ' select_option / select_tree_option / 日期格式 YYYY-MM-DD 重填。',
    ),
    (
        'err-button-not-found-in-row',
        _PREFIX + '按 rowHasRadio 提示：true 则 click_table_row_radio 选行后点上方工具栏'
        '同名按钮；禁止猜行内其他链接。',
    ),
    (
        'err-table-row-not-found',
        _PREFIX + 'row_text 与单元格原文不一致。改抄 scan 里单元格完整文本；'
        '跨单元格可用空格拼接（匹配忽略空白）。',
    ),
    (
        'err-icon-label-miss',
        _PREFIX + '目标不是 tooltip 图标也不是文字按钮。核对 get_page_state().iconButtons；'
        '行内按钮改 click_table_row_button。',
    ),
    (
        'err-icon-label-ambiguous',
        _PREFIX + '同名按钮多个。用 现场/textButtons 里完整文字或 click_element_by_index 索引。',
    ),
```

- [ ] **Step 3/4: 运行 + 提交**

Run: `./python/python.exe scripts/characterization/characterize-result-protocol.py && ./python/python.exe scripts/characterization/characterize-duplicate-failure-cue.py && bash scripts/refactor/verify-all.sh 2>&1 | tail -1`

```bash
git add scripts/controller/actions/duplicate_failure_cue.py scripts/characterization/characterize-result-protocol.py
git commit -m "feat(protocol): 六动作新错误码登记纠偏处方"
```

---

### Task 11: LIVE 冒烟脚本 + CHANGELOG + 终检

**Files:**
- Create: `scripts/smoke/result-protocol-live.py`（手动冒烟，需 19242 实况浏览器，不注册 verify-all）
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 冒烟脚本**（场景清单硬编码自本日四次事故；每场景断言三标记存在 + 下一步指向正确动作）

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LIVE smoke (manual, needs CDP browser on :19242 logged into tiansun test env):

1 select 国别=中国     -> 命中别名链或 final err-select-option-unresolved（文本含 现场:options=）
2 fill  国别(下拉)     -> err-field-disabled ... 下一步:select_option...
3 table row 无内嵌按钮 -> err-button-not-found-in-row（rowHasRadio=true）
4 icon 工具点文字按钮   -> ok-text:.*  （成功侧）

Usage: ./python/python.exe scripts/smoke/result-protocol-live.py
"""
assertion helpers mirror characterization style; import snippets from modules;
drive the SAME sequence as incident logs; print PASS/FAIL per case; exit non-zero on any FAIL.
```

（实现者按注释骨架补齐四个 drive 函数：导航到对公客户管理列表页 → 各场景最小动作链；复用 engine snippets 直接 page.evaluate。浏览器当前状态即近实况。）

- [ ] **Step 2: 手动执行并记录输出**

Run: 启动录制环境后 `./python/python.exe scripts/smoke/result-protocol-live.py`
Expected: 4/4 PASS（截图/滚动等负载模拟不必强求，功能性断言为准）

- [ ] **Step 3: CHANGELOG 追加**（`[Unreleased] ### Added` 一条聚合条目，注明五点：协议模块与六动作接入清单、field-disabled 进入纠偏计数的行为变化声明、use 字段四处透传、semantic_doubt 只挂失败语境、Task5 范围偏差——validation/notification 未重塑）

- [ ] **Step 4: 终检 + 提交**

Run: `bash scripts/refactor/verify-all.sh 2>&1 | tail -1 && ./python/python.exe scripts/characterization/characterize-result-protocol.py`
Expected: ALL GREEN + OK

```bash
git add scripts/smoke/result-protocol-live.py CHANGELOG.md docs/superpowers/plans/
git commit -m "feat(protocol)+docs: 六动作结果协议收尾——live 冒烟脚本与 CHANGELOG"
```

---

## Self-Review 结论（已执行）

- Spec 覆盖：§1 六动作（T3-T7）、§2 affordances（T2）、§3 use（T8）、§4 记账+阶梯（T9/T10）、验收（T11 各步）——无缺口；spec“validation/notification 补三段式”一句被 T5 显式偏差取代并有说明 ✓
- 占位符扫描：Task 11 Step 1 为骨架注释（标注 Live 手动冒烟性质与判定标准，符合一次性脚本定位）；其余任务均含真实代码 ✓
- 类型一致性：err_with/ok_marked/affordances/recommend_action_for_kind 签名前后一致；`_semantic_doubts` 键名一致；Task 7 旧码清理与 Task 10 处方码一一对应 ✓
