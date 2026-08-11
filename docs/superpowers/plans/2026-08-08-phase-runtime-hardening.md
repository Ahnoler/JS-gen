# Phase Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden AI recording runtime so section-scoped phases can finish after save, empty LLM actions get legal NEXT_ACTION cues, submit phases get empty-act budget padding, auto-section uses fresh buttons + phase memory, and missing success tokens are visibly marked on `phase_end`.

**Architecture:** Keep Phase Intent Contract as policy. Add thin helpers on `_section_scope.py` (remember/resolve section, empty-act detection, empty-act cue text) and wire them into `_form.py`, `recorder.py`, `session_runner.py`, `_phase_reviewer.py`. Do not fork browser-use step counting.

**Tech Stack:** Python 3.12 agent scripts, characterization scripts (assert-based), existing recorder HumanMessage injection pattern.

**Spec:** `docs/superpowers/specs/2026-08-08-phase-runtime-hardening-design.md`

## Global Constraints

- Guiding principle: prescriptions must be **legal executable** actions for the current step (never `click_save` on last step; `done` when save already OK).
- `done()` pending gate still only when `refill=all_editable`; only the `section=` argument changes via `resolve_phase_section`.
- `_EMPTY_ACT_BUFFER=3` only when `submit.required`.
- No `phase_error` for quality failures.
- Do not block index-click of「暂存」.
- Characterization: `python scripts/characterization/characterize-*.py` (no pytest required unless already used).
- Update `CHANGELOG.md` `[Unreleased]` when behavior lands.
- Commits: small, one logical unit per task.

## File map

| File | Responsibility |
|------|----------------|
| `scripts/actions/_section_scope.py` | `remember_phase_section`, `clear_phase_section`, `resolve_phase_section`, `is_empty_effective_actions`, `empty_act_prescription_message` |
| `scripts/actions/_phase_intent.py` | Clear `_phase_section` / `_empty_act_streak` in `clear_phase_intent` |
| `scripts/actions/_phase_reviewer.py` | `_EMPTY_ACT_BUFFER` in `resolve_phase_max_steps` |
| `scripts/actions/_form.py` | Remember section on assistant/save; rescan + resolve order for naked `click_save` |
| `scripts/recorder.py` | Scoped `done` gate; empty-act cue injection |
| `scripts/session_runner.py` | Scoped soft pending; `QUALITY FAIL` stderr; `phase_end` quality fields |
| `scripts/characterization/characterize-phase-runtime.py` | New characterization covering resolver, buffer, empty-act, wiring greps |
| `CHANGELOG.md` | Unreleased notes |

---

### Task 1: Section memory + resolve helpers (TDD)

**Files:**
- Modify: `scripts/actions/_section_scope.py`
- Create: `scripts/characterization/characterize-phase-runtime.py`
- Test: same characterization file

**Interfaces:**
- Produces:
  - `remember_phase_section(store: dict | None, section: str) -> None`
  - `clear_phase_section(store: dict | None) -> None`
  - `resolve_phase_section(store: dict | None, *, task_text: str = "") -> str`
- Consumes: `norm_sec`, `get_phase_intent` (lazy import inside resolve to avoid cycles)

- [ ] **Step 1: Write failing characterization for remember/resolve**

Create `scripts/characterization/characterize-phase-runtime.py`:

```python
#!/usr/bin/env python3
"""Characterization: phase runtime hardening (section scope, empty buffer, empty-act)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._section_scope import (  # noqa: E402
    remember_phase_section,
    clear_phase_section,
    resolve_phase_section,
)
from scripts.actions._phase_reviewer import resolve_phase_max_steps  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_remember_and_resolve_memory() -> None:
    store: dict = {}
    remember_phase_section(store, "系统评级结论")
    assert_true(store.get("_phase_section") == "系统评级结论", "remember writes")
    assert_true(resolve_phase_section(store) == "系统评级结论", "resolve prefers memory")
    clear_phase_section(store)
    assert_true(not store.get("_phase_section"), "clear removes")


def test_resolve_infer_unique_and_longest() -> None:
    store = {
        "_phase_intent": {
            "goal": "在系统评级结论区域选择建议评级并保存",
            "in_scope": ["填写理由说明"],
            "submit": {"required": True},
        },
        "_scan_buttons": [
            {"label": "保存", "section_title": "系统评级结论", "section_id": "系统评级结论"},
            {"label": "保存", "section_title": "客户综合评价", "section_id": "客户综合评价"},
        ],
    }
    assert_true(
        resolve_phase_section(store, task_text="") == "系统评级结论",
        f"unique title in goal → {resolve_phase_section(store)!r}",
    )
    store2 = {
        "_phase_intent": {"goal": "保存全部", "in_scope": [], "submit": {"required": True}},
        "_scan_buttons": store["_scan_buttons"],
    }
    assert_true(resolve_phase_section(store2) == "", "ambiguous / no unique → empty")


def main() -> None:
    test_remember_and_resolve_memory()
    test_resolve_infer_unique_and_longest()
    print("PASS characterize-phase-runtime (partial task1)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run — expect FAIL (imports missing)**

```bash
python scripts/characterization/characterize-phase-runtime.py
```

Expected: `ImportError` or `AssertionError` for missing symbols.

- [ ] **Step 3: Implement helpers in `_section_scope.py`**

Append (preserve existing helpers):

```python
def remember_phase_section(store: dict | None, section: str) -> None:
    if not store:
        return
    sec = norm_sec(section)
    if sec:
        store["_phase_section"] = sec


def clear_phase_section(store: dict | None) -> None:
    if not store:
        return
    store.pop("_phase_section", None)


def resolve_phase_section(store: dict | None, *, task_text: str = "") -> str:
    """Return phase section scope or '' (full-table gate).

    Order: memory → unique/longest NL infer against button/task titles → ''.
    """
    if not store:
        return ""
    mem = norm_sec(str(store.get("_phase_section") or ""))
    if mem:
        return mem

    titles: list[str] = []
    seen: set[str] = set()
    for b in store.get("_scan_buttons") or []:
        if not isinstance(b, dict):
            continue
        t = norm_sec(b.get("section_title") or "") or norm_sec(b.get("section_id") or "")
        if t and t != "__root__" and t not in seen:
            seen.add(t)
            titles.append(t)
    try:
        from scripts.models.task import TaskList
        tl = TaskList.from_store(store.get("task_list"))
        for i in list(tl.pending) + list(tl.done):
            t = norm_sec(getattr(i, "section_title", "") or "") or norm_sec(
                getattr(i, "section_id", "") or ""
            )
            if t and t != "__root__" and t not in seen:
                seen.add(t)
                titles.append(t)
    except Exception:
        pass
    if not titles:
        return ""

    blob_parts: list[str] = []
    try:
        from ._phase_intent import get_phase_intent
        c = get_phase_intent(store) or {}
        blob_parts.append(str(c.get("goal") or ""))
        for x in c.get("in_scope") or []:
            blob_parts.append(str(x))
    except Exception:
        pass
    blob_parts.append(task_text or "")
    blob = norm_sec(" ".join(blob_parts))
    if not blob:
        return ""

    hits = [t for t in titles if t and t in blob]
    if not hits:
        return ""
    if len(hits) == 1:
        return hits[0]
    # nested substring: uniquely longest wins
    longest = max(hits, key=len)
    if sum(1 for t in hits if len(t) == len(longest)) == 1:
        return longest
    return ""
```

- [ ] **Step 4: Run characterization — expect PASS (partial)**

```bash
python scripts/characterization/characterize-phase-runtime.py
```

Expected: `PASS characterize-phase-runtime (partial task1)`

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_section_scope.py scripts/characterization/characterize-phase-runtime.py
git commit -m "feat: phase section remember/resolve helpers"
```

---

### Task 2: Clear section on phase reset; remember on assistant/save entry

**Files:**
- Modify: `scripts/actions/_phase_intent.py` (`clear_phase_intent`)
- Modify: `scripts/actions/_form.py` (`run_form_assistant` start; `click_save` after `sec` resolved — full resolve order in Task 5; this task only remember + clear)
- Modify: `scripts/characterization/characterize-phase-runtime.py` — grep/wiring asserts

**Interfaces:**
- Consumes: `remember_phase_section`, `clear_phase_section`
- Produces: `_phase_section` cleared with intent; set when assistant/save has section

- [ ] **Step 1: Extend characterization**

```python
def test_clear_phase_intent_clears_section() -> None:
    from scripts.actions._phase_intent import clear_phase_intent, apply_phase_contract
    store = {"_phase_section": "系统评级结论", "_empty_act_streak": 2}
    clear_phase_intent(store)
    assert_true("_phase_section" not in store, "clear_phase_intent drops section")
    assert_true("_empty_act_streak" not in store, "clear_phase_intent drops empty streak")


def test_form_wires_remember() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    assert_true("remember_phase_section" in form, "form remembers section")
```

Call these from `main()`.

- [ ] **Step 2: Run — expect FAIL** on clear/streak / remember wiring.

- [ ] **Step 3: Implement clear + early remember**

In `clear_phase_intent`, add to the `for key in (...)` tuple:

```python
'_phase_section',
'_empty_act_streak',
```

At start of `run_form_assistant` body (after parsing `section`):

```python
sec = (section or "").strip()
if sec:
    from ._section_scope import remember_phase_section
    remember_phase_section(case_data_store, sec)
```

In `click_save`, after the existing auto-bind block that sets `sec` (Task 5 will expand resolve order; for now keep current auto-bind and add):

```python
if sec:
    from ._section_scope import remember_phase_section
    remember_phase_section(case_data_store, sec)
```

Place remember **before** pending gate returns.

- [ ] **Step 4: Run characterization PASS**

- [ ] **Step 5: Commit**

```bash
git add scripts/actions/_phase_intent.py scripts/actions/_form.py scripts/characterization/characterize-phase-runtime.py
git commit -m "feat: clear/remember phase section across phase lifecycle"
```

---

### Task 3: Scoped `done()` pending gate (recorder + session_runner)

**Files:**
- Modify: `scripts/recorder.py` (~write gate on done)
- Modify: `scripts/session_runner.py` (phase-end soft pending)
- Modify: `scripts/characterization/characterize-phase-runtime.py`

**Interfaces:**
- Consumes: `resolve_phase_section(store)`, `check_pending_write_gate(store, section=...)`

- [ ] **Step 1: Failing test — scoped gate behavior via `check_pending_write_gate`**

```python
def test_scoped_pending_gate_ignores_other_section() -> None:
    from scripts.models.task import TaskList, TaskItem
    from scripts.actions._phase_intent import check_pending_write_gate, apply_phase_contract

    tl = TaskList(
        pending=[
            TaskItem(label="理由说明", kind="input", section_title="系统评级结论", section_id="系统评级结论"),
            TaskItem(label="综合评价", kind="input", section_title="客户综合评价", section_id="客户综合评价"),
        ],
        done=[],
    )
    store = {"task_list": tl.to_store(), "_force_refill_all": True, "_phase_section": "系统评级结论"}
    apply_phase_contract(store, {
        "mode": "modify",
        "allow_form_assistant": True,
        "refill": "all_editable",
        "goal": "系统评级结论",
        "in_scope": [],
        "out_of_scope": [],
        "done_when": "",
        "submit": {"required": True, "via": "click_save", "button_text": "保存"},
        "success": {"kinds": ["toast_ok"], "evidence": []},
        "source": "test",
    })
    store["_phase_section"] = "系统评级结论"  # re-set after apply clears
    # mark 理由说明 done
    tl2 = TaskList.from_store(store["task_list"])
    tl2.mark_done("理由说明", value="x")
    store["task_list"] = tl2.to_store()
    sec = resolve_phase_section(store)
    ok, labels = check_pending_write_gate(store, section=sec)
    assert_true(ok and labels == [], f"scoped gate ok got {ok} {labels}")
```

Also assert recorder source contains `resolve_phase_section`.

- [ ] **Step 2: Run — FAIL until wiring**

- [ ] **Step 3: Wire recorder**

Replace:

```python
ok_pending, pending_labels = check_pending_write_gate(case_data_store)
```

with:

```python
from .actions._section_scope import resolve_phase_section
_sec = resolve_phase_section(case_data_store)
ok_pending, pending_labels = check_pending_write_gate(case_data_store, section=_sec)
```

Update rejection message to include section when `_sec`:

```python
f'Premature done() rejected: pending fields remain {pending_labels[:8]}'
+ (f' in section={_sec!r}' if _sec else '')
+ f'. Write each editable field then click_save(button_text="保存"'
+ (f', section={_sec!r}' if _sec else '')
+ ').'
```

- [ ] **Step 4: Wire session_runner soft gate**

```python
from .actions._section_scope import resolve_phase_section
_sec = resolve_phase_section(case_data_ref)
ok_pending, labels = check_pending_write_gate(case_data_ref, section=_sec)
```

- [ ] **Step 5: Run characterization PASS + commit**

```bash
git add scripts/recorder.py scripts/session_runner.py scripts/characterization/characterize-phase-runtime.py
git commit -m "fix: scope done() pending gate with resolve_phase_section"
```

---

### Task 4: Empty-act buffer on submit.required

**Files:**
- Modify: `scripts/actions/_phase_reviewer.py`
- Modify: `scripts/characterization/characterize-phase-reviewer.py`
- Modify: `scripts/characterization/characterize-phase-runtime.py`
- Modify: `scripts/session_runner.py` (log `empty_buffer=`)

**Interfaces:**
- Produces: `resolve_phase_max_steps` includes +3 when submit required

- [ ] **Step 1: Failing asserts**

In `characterize-phase-reviewer.py`:

```python
assert resolve_phase_max_steps(30, {
    'estimated_steps': 4,
    'submit': {'required': True},
}) == 11  # max(8, 4+2) + 3
assert resolve_phase_max_steps(30, {
    'effort': 'short',
    'submit': {'required': False},
}) == 5  # no empty buffer
```

Update old assert that expected `== 8` for submit+est=4 to `== 11`.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```python
_EMPTY_ACT_BUFFER = 3
```

After computing `chosen = min(ceil, max(floor, int(raw)))` when raw is not None:

```python
chosen = min(ceil, max(floor, int(raw)))
if coerce_bool(submit.get('required')):
    chosen = min(ceil, chosen + _EMPTY_ACT_BUFFER)
return chosen
```

When `raw is None` and submit required, keep returning `ceil` (full ceiling — do not force +buffer below ceiling).

- [ ] **Step 4: Log in session_runner**

Add `empty_buffer=` (3 if submit.required else 0) to existing max_steps stderr line.

- [ ] **Step 5: Run both characterizations PASS + commit**

```bash
git add scripts/actions/_phase_reviewer.py scripts/characterization/characterize-phase-reviewer.py scripts/session_runner.py scripts/characterization/characterize-phase-runtime.py
git commit -m "feat: empty-act max_steps buffer for submit.required phases"
```

---

### Task 5: `click_save` section resolve order + button rescan

**Files:**
- Modify: `scripts/actions/_form.py` (`click_save`)
- Optionally add `async def refresh_scan_buttons(page, case_data_store)` helper in `_form.py`
- Modify: `scripts/characterization/characterize-phase-runtime.py`

**Interfaces:**
- Consumes: `remember_phase_section`, `unique_button_section`, existing scan helpers
- Order: explicit `section` → `_phase_section` → rescan+unique → `""`

- [ ] **Step 1: Failing source/behavior asserts**

```python
def test_click_save_section_order_in_source() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    # memory before unique; refresh when no section
    assert_true("_phase_section" in form and "unique_button_section" in form, "order ingredients present")
    assert_true("refresh_scan_buttons" in form or "rescan" in form.lower() or "_scan_buttons" in form,
                "rescan path present")
```

- [ ] **Step 2: Implement resolve block replacing current auto-only bind**

Pseudo inside `click_save` after `sec = (section or "").strip()`:

```python
if not sec:
    mem = norm from case_data_store.get('_phase_section')
    if mem:
        sec = mem
if not sec:
    # refresh_scan_buttons: evaluate JS_SCAN_FORM_FIELDS (or buttons-only if available),
    # case_data_store['_scan_buttons'] = _scan_buttons_from_result(result)
    auto_sec = unique_button_section(case_data_store.get('_scan_buttons'), compact_btn)
    if auto_sec:
        sec = auto_sec
if sec:
    remember_phase_section(case_data_store, sec)
```

Reuse the same scan call path used by `run_form_assistant` / form rescan (call existing internal helper if one exists; otherwise thin wrapper around `JS_SCAN_FORM_FIELDS` + `_scan_buttons_from_result`). Skip refresh when caller passed explicit section.

- [ ] **Step 3: Run characterization PASS + commit**

```bash
git add scripts/actions/_form.py scripts/characterization/characterize-phase-runtime.py
git commit -m "fix: click_save prefers phase section then rescans buttons"
```

---

### Task 6: Empty-act detection + legal prescription (recorder)

**Files:**
- Modify: `scripts/actions/_section_scope.py` (or keep helpers there)
- Modify: `scripts/recorder.py` (step callback after action logging)
- Modify: `scripts/characterization/characterize-phase-runtime.py`

**Interfaces:**
- Produces:
  - `is_empty_effective_actions(actions_raw, *, next_goal: str = "") -> bool`
  - `empty_act_prescription_message(store, *, last_step: bool, save_ok: bool) -> str`
- Consumes: `resolve_phase_section`, `has_contract_success` / `_last_save_ok`

- [ ] **Step 1: Failing unit asserts**

```python
def test_empty_effective_and_prescription() -> None:
    from scripts.actions._section_scope import (
        is_empty_effective_actions,
        empty_act_prescription_message,
    )
    assert_true(is_empty_effective_actions([], next_goal="Execute AgentOutput"), "empty list")
    assert_true(
        "done(" in empty_act_prescription_message({"_last_save_ok": True}, last_step=False, save_ok=True),
        "save_ok → done",
    )
    assert_true(
        "done(" in empty_act_prescription_message({}, last_step=True, save_ok=False),
        "last_step → done only",
    )
    msg = empty_act_prescription_message(
        {"_phase_section": "系统评级结论", "_phase_intent": {"submit": {"required": True}}},
        last_step=False,
        save_ok=False,
    )
    assert_true("click_save" in msg and "系统评级结论" in msg, f"scoped save cue: {msg}")
    assert_true("click_save" not in empty_act_prescription_message({}, last_step=True, save_ok=False),
                "no click_save on last step")
```

- [ ] **Step 2: Implement helpers**

```python
def is_empty_effective_actions(actions_raw, *, next_goal: str = "") -> bool:
    goal = (next_goal or "").strip()
    if not actions_raw:
        return True
    actives = []
    for a in actions_raw:
        try:
            d = a.model_dump(exclude_none=True) if hasattr(a, "model_dump") else {}
        except Exception:
            d = {}
        active = {k: v for k, v in (d or {}).items() if v is not None}
        if active:
            actives.append(active)
    if not actives:
        return True
    # treat unknown sole key AgentOutput as empty
    if len(actives) == 1 and set(actives[0].keys()) <= {"AgentOutput"}:
        return True
    if goal.startswith("Execute AgentOutput") and not any(
        k != "AgentOutput" for a in actives for k in a
    ):
        return True
    return False


def empty_act_prescription_message(store, *, last_step: bool, save_ok: bool) -> str:
    if last_step:
        ok = bool(save_ok or (store or {}).get("_last_save_ok"))
        return (
            f'[SYSTEM] Empty action on last step. NEXT_ACTION: done(success={"true" if ok else "false"}). '
            'No other actions allowed this step.'
        )
    if save_ok or (store or {}).get("_last_save_ok"):
        return (
            '[SYSTEM] Empty action but save already succeeded. '
            'NEXT_ACTION: done(success=true). Do NOT click_save again.'
        )
    sec = resolve_phase_section(store)
    sec_part = f", section='{sec}'" if sec else ""
    return (
        '[SYSTEM] Empty/invalid action. Return exactly one tool call. '
        f"NEXT_ACTION: click_save(button_text='保存'{sec_part}). "
        'Do not return empty actions.'
    )
```

- [ ] **Step 3: Wire recorder** after building `_actions_raw` / `_next_goal` (same callback that logs the step):

```python
from .actions._section_scope import (
    is_empty_effective_actions,
    empty_act_prescription_message,
)
if case_data_store is not None and is_empty_effective_actions(_actions_raw, next_goal=_next_goal or ''):
    streak = int(case_data_store.get('_empty_act_streak') or 0) + 1
    case_data_store['_empty_act_streak'] = streak
    # last_step: best-effort from agent.settings / history length vs max — if unavailable, False
    last_step = False
    try:
        # Prefer step_info if accessible; else False (buffer covers)
        last_step = bool(getattr(agent.state, 'is_last_step', False))
    except Exception:
        last_step = False
    save_ok = bool(case_data_store.get('_last_save_ok'))
    msg = HumanMessage(content=empty_act_prescription_message(
        case_data_store, last_step=last_step, save_ok=save_ok,
    ))
    agent._message_manager._add_message_with_tokens(msg)
    sys.stderr.write(f'[recorder] Injected empty-act cue (streak={streak} last_step={last_step} save_ok={save_ok})\n')
    sys.stderr.flush()
else:
    if case_data_store is not None:
        case_data_store['_empty_act_streak'] = 0
```

**Last-step detection:** Prefer reading `AgentStepInfo` if the callback closure can see it; if not available in this codebase path, pass `last_step=False` and document — optional improvement: compare `agent.state.n_steps` to instruction max_steps stored on `case_data_store['_phase_max_steps']` (set in session_runner when calling `agent.run`). **Required in this task:** session_runner sets `case_data_store['_phase_max_steps'] = max_steps` before `agent.run`; recorder uses `n_steps >= max_steps` as last_step.

- [ ] **Step 4: session_runner set `_phase_max_steps`**

Before `await agent.run(...)`:

```python
if case_data_ref is not None:
    case_data_ref['_phase_max_steps'] = int(max_steps)
```

Recorder:

```python
max_s = int((case_data_store or {}).get('_phase_max_steps') or 0)
last_step = bool(max_s and agent.state.n_steps >= max_s)
```

- [ ] **Step 5: Run PASS + commit**

```bash
git add scripts/actions/_section_scope.py scripts/recorder.py scripts/session_runner.py scripts/characterization/characterize-phase-runtime.py
git commit -m "feat: inject legal NEXT_ACTION on empty LLM actions"
```

---

### Task 7: QUALITY FAIL visibility on phase_end

**Files:**
- Modify: `scripts/session_runner.py` (phase-end block)
- Modify: `scripts/characterization/characterize-phase-runtime.py` (source grep)

- [ ] **Step 1: Failing assert**

```python
def test_quality_fail_logging_in_session_runner() -> None:
    src = (ROOT / "scripts/session_runner.py").read_text(encoding="utf-8")
    assert_true("QUALITY FAIL" in src, "stderr marker present")
```

- [ ] **Step 2: Implement** after soft gates / before or after `emit_json(phase_end)`:

```python
if case_data_ref.get('_quality_failed'):
    reasons = list(case_data_ref.get('_quality_failed_reasons') or [])
    sys.stderr.write(
        f"[session] QUALITY FAIL phase={step_index} reasons={reasons}\n"
    )
    sys.stderr.flush()
    phase_payload["quality_failed"] = True
    phase_payload["quality_failed_reasons"] = reasons
```

Ensure this runs even when reasons were set earlier; keep existing payload merge. Do **not** emit `phase_error`.

- [ ] **Step 3: Run PASS + commit**

```bash
git add scripts/session_runner.py scripts/characterization/characterize-phase-runtime.py
git commit -m "feat: surface QUALITY FAIL on phase_end"
```

---

### Task 8: CHANGELOG + full characterization sweep

**Files:**
- Modify: `CHANGELOG.md`
- Run all related characterizations

- [ ] **Step 1: Add Unreleased Fixed/Changed entry** summarizing: scoped done gate, empty-act buffer+cue, click_save section memory/rescan, QUALITY FAIL visibility. Python sync: 无（scripts）.

- [ ] **Step 2: Run**

```bash
python scripts/characterization/characterize-phase-runtime.py
python scripts/characterization/characterize-phase-reviewer.py
python scripts/characterization/characterize-phase-section-scope.py
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG phase runtime hardening"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| remember/resolve section C | 1–3 |
| done gate scoped + all_editable only | 3 |
| EMPTY_ACT_BUFFER submit-only | 4 |
| Empty-act detect + legal cue | 6 |
| click_save memory → rescan → unique | 5 |
| QUALITY FAIL + phase_end | 7 |
| Characterization + CHANGELOG | 1,4,6,8 |
| No phase_error / no 暂存 block / no browser-use fork | Global constraints |

## Placeholder / consistency self-review

- No TBD left in tasks.
- `resolve_phase_section` / `remember_phase_section` names consistent across tasks.
- Submit buffer math: `max(8, est+2)+3` with est=4 → 11; characterization must match Task 4.
- Last-step detection via `_phase_max_steps` + `n_steps` documented in Task 6.
