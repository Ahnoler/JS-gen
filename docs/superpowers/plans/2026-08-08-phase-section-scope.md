# Phase ↔ section scope (LLM-declared) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the LLM declare a UI `section` for pending / assistant / save; the write gate only blocks on fillable pending **inside that section**, so unrelated collapses (e.g. 征信「借款企业」) no longer block「系统评级结论」保存.

**Architecture:** Shared `scripts/actions/_section_scope.py` with `_section_matches` mirroring `JS_CLICK_SAVE_BUTTON` `secMatches`. `check_pending_write_gate` / `can_submit_writes` take optional `section`. Empty `section` + pending spanning ≥2 sections → `err-section-required`. `get_pending_tasks` / `run_form_assistant` gain optional `section=''`. Prompt steers LLM to pass `section=`; no contract regex.

**Tech Stack:** Python agent (`_form.py`, `_phase_intent.py`, `_phase_boundary.py`), `TaskItem.section_*`, characterization, `agent-prompt.md`.

**Spec:** `docs/superpowers/specs/2026-08-08-phase-section-scope-design.md`  
**E2E:** CDP 9242 — 征信 empty radios block global gate; `系统评级结论` section pending empty when filled; two「保存」in 系统评级结论 / 客户综合评价.

## 分层总览（LV）

| 层 | 中文名 | 交付物 | Task |
|----|--------|--------|------|
| **L1** | Section match helper | `_section_scope.py` + 表征 | Task 1 |
| **L2** | Save write gate | section-scoped gate + `err-section-required` | Task 2 |
| **L3** | get_pending_tasks | optional `section` filter + summary | Task 3 |
| **L4** | run_form_assistant | optional `section` autofill scope | Task 4 |
| **L5** | Prompt / CHANGELOG | agent-prompt + Unreleased + 全绿 | Task 5 |

```
L1 _section_scope ──► L2 click_save gate
       │
       ├──► L3 get_pending_tasks(section)
       └──► L4 run_form_assistant(section)
                    │
                    ▼
              L5 prompt / CHANGELOG
```

## Global Constraints

- LLM declares scope via `section=`; **no** regex/contract hard-parse of phase NL into section ids.
- Gate with non-empty `section`: only that section’s fillable pending blocks save.
- Gate with empty `section` + fillable pending in ≥2 sections → `err-section-required` (do not click).
- Public action **names** unchanged (`click_save`, `get_pending_tasks`, `run_form_assistant`).
- Section match must align with `JS_CLICK_SAVE_BUTTON` `secMatches` (exact id/title; strip `#n` suffix).
- Do not remove the write gate entirely; do not fix duplicate「保存」xpath dedupe in this plan.
- `docs/` gitignored — commit `scripts/` / `CHANGELOG.md` / prompts when user asks.
- TDD: characterization red → green per task.
- Prefer `scripts/actions/_section_scope.py` to avoid `_form` ↔ `_phase_boundary` import cycles.

## File map

| File | Role |
|------|------|
| `scripts/actions/_section_scope.py` | `_section_matches`, filter / `pending_by_section` (create) |
| `scripts/actions/_form.py` | Wire gate + pending + assistant |
| `scripts/actions/_phase_intent.py` | `check_pending_write_gate(..., section='')` |
| `scripts/actions/_phase_boundary.py` | `can_submit_writes(..., section='')` |
| `scripts/prompts/agent-prompt.md` | LLM section guidance |
| `scripts/characterization/characterize-phase-section-scope.py` | New gate (create) |
| `CHANGELOG.md` | Unreleased Changed |

## Canonical match (Task 1)

Mirror JS (`_js_snippets.py` ~2366–2374 `secMatches`):

```python
def norm_sec(s: str) -> str:
    return " ".join((s or "").split()).strip()


def strip_sec_suffix(s: str) -> str:
    import re
    return re.sub(r"#\d+$", "", norm_sec(s))


def section_matches(want: str, section_id: str = "", section_title: str = "") -> bool:
    want_norm = norm_sec(want)
    if not want_norm:
        return True
    sid = norm_sec(section_id)
    title = norm_sec(section_title)
    want_base = strip_sec_suffix(want_norm)
    return (
        sid == want_norm
        or title == want_norm
        or strip_sec_suffix(sid) == want_norm
        or strip_sec_suffix(sid) == want_base
        or title == want_base
    )
```

---

### Task 1（L1）：`_section_scope.py` + characterization

**Files:**
- Create: `scripts/actions/_section_scope.py`
- Create: `scripts/characterization/characterize-phase-section-scope.py`

**Interfaces:**
- Produces: `section_matches`, `pending_fillable_items`, `filter_pending_labels`, `pending_by_section`
- Consumes: `TaskItem.section_id` / `section_title`

- [ ] **Step 1: Write failing characterization**

Create `scripts/characterization/characterize-phase-section-scope.py`:

```python
#!/usr/bin/env python3
"""Characterize phase↔section scope (LLM-declared section for gate/pending)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._section_scope import (  # noqa: E402
    section_matches,
    pending_by_section,
    filter_pending_labels,
)
from scripts.models.task import TaskItem, TaskList  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_section_matches() -> None:
    assert_true(section_matches("", "征信信息", "征信信息"), "empty want matches all")
    assert_true(section_matches("系统评级结论", "系统评级结论", "系统评级结论"), "exact")
    assert_true(section_matches("系统评级结论", "系统评级结论#2", "系统评级结论"), "#n id")
    assert_true(not section_matches("系统评级结论", "征信信息", "征信信息"), "other section")


def test_filter_pending_excludes_other_section() -> None:
    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_id="征信信息", section_title="征信信息"),
            TaskItem(label="法定代表人", kind="radio", section_id="征信信息", section_title="征信信息"),
            TaskItem(label="理由说明", kind="input", section_id="系统评级结论", section_title="系统评级结论"),
        ]
    )
    labels = filter_pending_labels(tl, "系统评级结论")
    assert_true(labels == ["理由说明"], f"got {labels}")
    by = pending_by_section(tl)
    assert_true("征信信息" in by and "借款企业" in by["征信信息"], "by_section map")


def main() -> int:
    test_section_matches()
    test_filter_pending_excludes_other_section()
    print("characterize-phase-section-scope: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL**

```bash
python scripts/characterization/characterize-phase-section-scope.py
```

Expected: `ImportError` (`_section_scope` missing).

- [ ] **Step 3: Implement `scripts/actions/_section_scope.py`**

```python
"""Section scope helpers — LLM-declared section filter for pending/save/assistant."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from scripts.models.task import TaskList


def norm_sec(s: str) -> str:
    return " ".join((s or "").split()).strip()


def strip_sec_suffix(s: str) -> str:
    return re.sub(r"#\d+$", "", norm_sec(s))


def section_matches(want: str, section_id: str = "", section_title: str = "") -> bool:
    """Align with JS_CLICK_SAVE_BUTTON secMatches (exact id/title; strip #n)."""
    want_norm = norm_sec(want)
    if not want_norm:
        return True
    sid = norm_sec(section_id)
    title = norm_sec(section_title)
    want_base = strip_sec_suffix(want_norm)
    return (
        sid == want_norm
        or title == want_norm
        or strip_sec_suffix(sid) == want_norm
        or strip_sec_suffix(sid) == want_base
        or title == want_base
    )


def pending_fillable_items(tl: "TaskList") -> list:
    return [i for i in tl.pending if not i.needs_intervention and (i.label or "").strip()]


def filter_pending_labels(tl: "TaskList", section: str = "") -> list[str]:
    items = pending_fillable_items(tl)
    if norm_sec(section):
        items = [
            i for i in items
            if section_matches(section, i.section_id, i.section_title)
        ]
    return [i.label for i in items]


def pending_by_section(tl: "TaskList") -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for i in pending_fillable_items(tl):
        key = (i.section_title or i.section_id or "__root__").strip() or "__root__"
        out.setdefault(key, []).append(i.label)
    return out
```

- [ ] **Step 4: Run — expect PASS**

```bash
python scripts/characterization/characterize-phase-section-scope.py
```

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add scripts/actions/_section_scope.py scripts/characterization/characterize-phase-section-scope.py
git commit -m "feat: section scope helpers for phase-scoped pending"
```

---

### Task 2（L2）：Section-scoped save write gate

**Files:**
- Modify: `scripts/actions/_phase_intent.py`
- Modify: `scripts/actions/_phase_boundary.py`
- Modify: `scripts/actions/_form.py` (`click_save`)
- Modify: `scripts/characterization/characterize-phase-section-scope.py`

**Interfaces:**
- `check_pending_write_gate(store, section="") -> tuple[bool, list[str]]`
- `can_submit_writes(store, section="") -> tuple[bool, list[str]]`
- `click_save`: empty section + ≥2 pending sections → `err-section-required`

- [ ] **Step 1: Extend characterization**

```python
def test_gate_scoped_ignores_credit() -> None:
    from scripts.actions._phase_intent import check_pending_write_gate

    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_title="征信信息", section_id="征信信息"),
            TaskItem(label="法定代表人", kind="radio", section_title="征信信息", section_id="征信信息"),
        ]
    )
    store = {"task_list": tl.to_store(), "_force_refill_all": True}
    ok, labels = check_pending_write_gate(store, section="系统评级结论")
    assert_true(ok and labels == [], f"scoped gate should pass, got {ok} {labels}")
    ok2, labels2 = check_pending_write_gate(store, section="")
    assert_true(not ok2 and set(labels2) == {"借款企业", "法定代表人"}, "unscoped sees 征信")


def test_multi_section_map() -> None:
    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_title="征信信息", section_id="征信信息"),
            TaskItem(label="综合评价", kind="input", section_title="客户综合评价", section_id="客户综合评价"),
        ]
    )
    by = pending_by_section(tl)
    assert_true(len(by) >= 2, "multi-section pending")


def test_form_has_err_section_required() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("err-section-required" in form, "click_save surfaces err-section-required")
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Update `can_submit_writes`**

In `scripts/actions/_phase_boundary.py`:

```python
def can_submit_writes(case_data_store: dict | None, section: str = "") -> tuple[bool, list[str]]:
    b = get_phase_boundary(case_data_store)
    if not b or not b.get("requires_write_all_editable"):
        return True, []
    from scripts.models.task import TaskList
    from scripts.actions._section_scope import filter_pending_labels

    tl = TaskList.from_store((case_data_store or {}).get("task_list"))
    pending = filter_pending_labels(tl, section)
    return len(pending) == 0, pending
```

- [ ] **Step 4: Update `check_pending_write_gate`**

```python
def check_pending_write_gate(case_data_store: dict | None, section: str = "") -> tuple[bool, list[str]]:
    try:
        from ._phase_boundary import can_submit_writes, phase_boundary_active
        if phase_boundary_active(case_data_store):
            return can_submit_writes(case_data_store, section=section)
    except Exception:
        pass
    if not contract_force_refill(case_data_store):
        return True, []
    from scripts.models.task import TaskList
    from scripts.actions._section_scope import filter_pending_labels

    tl = TaskList.from_store((case_data_store or {}).get("task_list"))
    pending = filter_pending_labels(tl, section)
    return len(pending) == 0, pending
```

- [ ] **Step 5: Wire `click_save` in `_form.py`**

Import `pending_by_section` from `_section_scope`. Before calling the gate (non-picker path):

```python
sec = (section or "").strip()
# ... after query_ui / picker checks ...
if not is_picker_confirm:
    from ._phase_intent import contract_force_refill
    from ._phase_boundary import phase_boundary_active, get_phase_boundary
    from ._section_scope import pending_by_section

    needs_gate = False
    if phase_boundary_active(case_data_store):
        b = get_phase_boundary(case_data_store) or {}
        needs_gate = bool(b.get("requires_write_all_editable"))
    else:
        needs_gate = contract_force_refill(case_data_store)
    if needs_gate and not sec:
        tl0 = TaskList.from_store((case_data_store or {}).get("task_list"))
        by = pending_by_section(tl0)
        if len(by) >= 2:
            return _err(
                "err-section-required | pending_by_section="
                + json.dumps(by, ensure_ascii=False)
                + " | Pass section= for the phase block (judge from 阶段任务 / 阶段目录).",
                include_in_memory=True,
            )

gate_ok, pending_labels = check_pending_write_gate(case_data_store, section=sec)
```

Pass `section=sec` again after disabled prune re-check. Keep picker-confirm bypass unchanged (no `err-section-required`).

- [ ] **Step 6: Run characterization — PASS**

- [ ] **Step 7: Commit** (if user asked)

```bash
git commit -m "feat: section-scoped click_save pending write gate"
```

---

### Task 3（L3）：`get_pending_tasks(section='')`

**Files:**
- Modify: `scripts/actions/_form.py`
- Modify: `scripts/characterization/characterize-phase-section-scope.py`

- [ ] **Step 1: Characterization**

```python
def test_get_pending_signature() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    chunk = form.split("async def get_pending_tasks", 1)[1][:600]
    assert_true("section" in chunk, "get_pending_tasks accepts section")
    assert_true("pending_by_section" in form, "includes pending_by_section")
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```python
async def get_pending_tasks(section: str = ""):
    ...
    from ._section_scope import section_matches, pending_by_section
    tl = TaskList.from_store(case_data_store.get("task_list"))
    sec = (section or "").strip()
    pending_items = [
        i for i in tl.pending
        if not i.needs_intervention
        and section_matches(sec, i.section_id, i.section_title)
    ]
    # Keep existing serialization style (dict list from to_store / model_dump)
    pending_payload = []
    for i in pending_items:
        pending_payload.append(i.model_dump() if hasattr(i, "model_dump") else i)
    result = {
        "pending": pending_payload,
        "done": len(tl.done),
        "pending_by_section": pending_by_section(tl),
        "section_filter": sec or None,
    }
    # NEXT_ACTION / hint: if sec set, treat ready when section-local pending empty
    ...
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** (if user asked)

---

### Task 4（L4）：`run_form_assistant(section='')`

**Files:**
- Modify: `scripts/actions/_form.py`
- Modify: characterization

**Approach:** Set `case_data_store["_assistant_section_filter"] = sec` for the duration of assistant autofill; skip non-matching items in `_execute_round` / when building pending dicts; `finally: pop`.

```python
async def run_form_assistant(section: str = ""):
    ...
    sec = (section or "").strip()
    if sec:
        case_data_store["_assistant_section_filter"] = sec
    try:
        await _ensure_scanned("__run_form_assistant__", allow_autofill=True)
        ...
        payload["section_filter"] = sec or None
        return _ok(json.dumps(payload, ensure_ascii=False))
    finally:
        case_data_store.pop("_assistant_section_filter", None)
```

In `_execute_round` (or pending list build before it):

```python
filt = (case_data_store.get("_assistant_section_filter") or "").strip()
if filt:
    from ._section_scope import section_matches
    # skip field dict / task item when not section_matches(filt, ...)
```

- [ ] **Step 1: Characterization** — `async def run_form_assistant` chunk contains `section`; autofill path references `_assistant_section_filter` or `section_matches`.

- [ ] **Step 2–4: RED → implement → GREEN**

- [ ] **Step 5: Commit** (if user asked)

```bash
git commit -m "feat: run_form_assistant optional section filter"
```

---

### Task 5（L5）：Prompt + CHANGELOG + full green

**Files:**
- Modify: `scripts/prompts/agent-prompt.md`
- Modify: `CHANGELOG.md`
- Modify: `scripts/characterization/characterize-phase-section-scope.py`

- [ ] **Step 1: Prompt marker test**

```python
def test_prompt_section_scope() -> None:
    prompt = (ROOT / "scripts/prompts/agent-prompt.md").read_text(encoding="utf-8")
    assert_true("err-section-required" in prompt, "prompt documents err-section-required")
    assert_true("section=" in prompt or "section='" in prompt, "prompt steers section=")
```

- [ ] **Step 2: Update agent-prompt** near `click_save` / `run_form_assistant` / form-fill rules:

- Phase names a region → LLM **judges** the block from 阶段目录/当前任务 (code does not parse it).
- Prefer `run_form_assistant(section='…')`, `get_pending_tasks(section='…')`, `click_save('保存', section='…')`.
- `err-section-required` → choose section from `pending_by_section`; do not fill unrelated collapses to clear the gate.
- `err-pending-fields` with `section` set → only fields **in that section**.

- [ ] **Step 3: CHANGELOG under `[Unreleased]` → `### Changed`**

```markdown
- 2026-08-08: **阶段保存闸门按 LLM 声明的 section 收窄：** `click_save`/`get_pending_tasks`/`run_form_assistant` 可选 `section=`；只校验/填写该折叠块 pending。无 section 且 pending 跨多块 → `err-section-required`。不再因征信等无关块挡住「系统评级结论」保存。
  影响范围：录制表单阶段提交闸门、助手、pending 摘要、agent-prompt。
  文件：scripts/actions/_section_scope.py, scripts/actions/_form.py, scripts/actions/_phase_intent.py, scripts/actions/_phase_boundary.py, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-phase-section-scope.py
  Python 同步提示：无（scripts 子进程）；若控制面复述工具 schema 需为三动作增加可选 section。
```

- [ ] **Step 4: Full suite**

```bash
python scripts/characterization/characterize-phase-section-scope.py
python scripts/characterization/characterize-form-assistant.py
python scripts/characterization/characterize-xpath-primary-ops.py
python scripts/characterization/characterize-control-ops-closed-loop.py
```

Expected: all OK.

- [ ] **Step 5: Commit** (if user asked)

```bash
git commit -m "docs: phase section-scope prompt and CHANGELOG"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| LLM-declared `section=` (no contract regex) | 2–5 |
| Gate filters by section | 2 |
| Empty section + multi-section → `err-section-required` | 2 |
| `get_pending_tasks(section)` + `pending_by_section` | 3 |
| `run_form_assistant(section)` | 4 |
| Prompt guidance | 5 |
| E2E: 征信不挡 系统评级结论 | 2 |
| Duplicate 保存 xpath dedupe | out of scope |

## Self-review notes

- `_section_scope.py` avoids import cycles.
- Match rules documented to stay in sync with JS `secMatches`.
- Clear `_assistant_section_filter` in `finally`.
- Picker confirm path: no `err-section-required`.
