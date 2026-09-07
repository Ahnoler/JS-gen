# Ghost Pending Live-Prune Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `click_save` live-prune sticky pending that is `label-not-found` or `visible===false`, so ghost fields like #614「法人机构」no longer permanently block save.

**Architecture:** Extend `JS_CHECK_SINGLE_FIELD` with a `visible` boolean (display/visibility/zero-rect only — not viewport). Extend the existing disabled prune loop in `form_save.py` to also move not-found / not-visible items to `done`, log `pruned ghost pending`, and re-run `check_pending_write_gate`.

**Tech Stack:** Python Playwright controller actions; browser JS string snippets in `scan_form.py`; characterization via source substring pins.

## Global Constraints

- Scheme A only — no scan-admit tighten (B), no gate-on-summary (C), no `isSuccessful` fake-success fix, no #614 re-record in this plan.
- Do not edit `scripts/session_runner.py` or uncommitted trajectory-dao / v2 trajectory query WIP.
- Visible rule: ancestor `display:none` / `visibility:hidden` OR `getBoundingClientRect` width/height ≤ 0; do **not** use “in viewport”.
- Ghost items go to `tl.done` (same as disabled prune) so they are not sticky-pending forever.
- New characterization must not weaken existing `pruned disabled pending` cue.

---

## File map

| File | Role |
|---|---|
| `scripts/controller/actions/js_snippets/scan_form.py` | `JS_CHECK_SINGLE_FIELD` +`visible` |
| `scripts/controller/actions/form_save.py` | ghost prune branches + stderr |
| `scripts/characterization/characterize-ghost-pending-prune.py` | source pins (new) |
| `scripts/refactor/verify-all.sh` | register new characterize |
| `docs/superpowers/specs/2026-09-07-ghost-pending-prune-design.md` | mark status implemented when done |
| `docs/superpowers/agent-log.md` | 收工 |

---

### Task 1: Characterization pins (fail first)

**Files:**
- Create: `scripts/characterization/characterize-ghost-pending-prune.py`
- Modify: `scripts/refactor/verify-all.sh` (one `run` line near other form characterizes)

**Interfaces:**
- Consumes: none
- Produces: failing pins that Task 2–3 must satisfy

- [ ] **Step 1: Write characterize script**

```python
#!/usr/bin/env python3
"""Pin click_save ghost-pending live-prune (scheme A / #614 法人机构)."""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCAN = (ROOT / "scripts/controller/actions/js_snippets/scan_form.py").read_text(encoding="utf-8")
SAVE = (ROOT / "scripts/controller/actions/form_save.py").read_text(encoding="utf-8")

def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)

def test_js_check_exposes_visible() -> None:
    # JS_CHECK_SINGLE_FIELD body must compute and return visible
    start = SCAN.find("JS_CHECK_SINGLE_FIELD")
    assert_true(start >= 0, "JS_CHECK_SINGLE_FIELD defined")
    body = SCAN[start : start + 3500]
    assert_true("visible" in body, "CHECK_SINGLE returns/computes visible")
    assert_true("label-not-found" in body, "not-found sentinel preserved")
    assert_true("display" in body and "visibility" in body, "style-based visibility")
    assert_true("getBoundingClientRect" in body, "zero-rect visibility")

def test_form_save_ghost_prune() -> None:
    assert_true("pruned disabled pending" in SAVE, "disabled prune log kept")
    assert_true("pruned ghost pending" in SAVE, "ghost prune log present")
    assert_true("label-not-found" in SAVE, "consumes not-found sentinel")
    assert_true("visible" in SAVE and "not-visible" in SAVE, "consumes visible===false")
    # prune still re-runs gate
    assert_true("check_pending_write_gate" in SAVE, "gate re-check after prune")

def main() -> int:
    test_js_check_exposes_visible()
    test_form_save_ghost_prune()
    print("characterize-ghost-pending-prune: OK")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Register in verify-all.sh**

Add near other form characterizes:

```bash
run "characterize-ghost-pending-prune" "$PY" scripts/characterization/characterize-ghost-pending-prune.py
```

- [ ] **Step 3: Run — expect FAIL**

```bash
node -e "require('child_process').spawnSync(process.env.PY||'python',['scripts/characterization/characterize-ghost-pending-prune.py'],{stdio:'inherit'})"
```

On Windows prefer: find python via verify-all or `where.exe python`. Expected: AssertionError missing `visible` / `pruned ghost pending`.

- [ ] **Step 4: Commit pins + verify-all registration**

```bash
git add scripts/characterization/characterize-ghost-pending-prune.py scripts/refactor/verify-all.sh
git commit -m "test: pin click_save ghost-pending live-prune (red)"
```

---

### Task 2: `JS_CHECK_SINGLE_FIELD` +`visible`

**Files:**
- Modify: `scripts/controller/actions/js_snippets/scan_form.py` (`JS_CHECK_SINGLE_FIELD` ~792–829)

**Interfaces:**
- Consumes: existing CHECK_SINGLE helpers (`classify`, `isDisabled`, …)
- Produces: JSON field objects include boolean `visible`; unmatched still `'label-not-found'`

- [ ] **Step 1: Add visibility helper inside the snippet**

Inside `JS_CHECK_SINGLE_FIELD`, before the pass loop (or inline before return), compute:

```javascript
const fieldVisible = (el) => {
  let n = el;
  while (n && n.nodeType === 1) {
    const st = window.getComputedStyle(n);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    n = n.parentElement;
  }
  const r = el.getBoundingClientRect();
  return !(r.width <= 0 || r.height <= 0);
};
```

Use **form-item root** `item` for the check (covers hidden tab panes wrapping the item).

- [ ] **Step 2: Include `visible: fieldVisible(item)` in the returned JSON.stringify object**

Do not change the `'label-not-found'` return path.

- [ ] **Step 3: Run characterize — JS half should pass; form_save half still fail**

```bash
# expect AssertionError on pruned ghost pending until Task 3
```

- [ ] **Step 4: Commit**

```bash
git add scripts/controller/actions/js_snippets/scan_form.py
git commit -m "feat(scan): JS_CHECK_SINGLE_FIELD reports visible"
```

---

### Task 3: `form_save.py` ghost prune

**Files:**
- Modify: `scripts/controller/actions/form_save.py` (~139–168)

**Interfaces:**
- Consumes: `JS_CHECK_SINGLE_FIELD` → `'label-not-found'` or `{..., visible: bool}`
- Produces: stderr `pruned ghost pending: [...]` with reasons; gate re-run

- [ ] **Step 1: Extend prune loop**

Replace the single disabled branch with:

```python
pruned_disabled = []
pruned_ghost = []  # list of "label:reason"
for item in list(tl.pending):
    if item.needs_intervention:
        kept.append(item)
        continue
    try:
        raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, [item.label, btn_kw])
        info = json.loads(raw) if isinstance(raw, str) and raw.startswith('{') else {}
    except Exception:
        sys.stderr.write(
            f"[click_save] prune-check JS_CHECK_SINGLE_FIELD failed label={item.label!r}\n"
        )
        sys.stderr.flush()
        kept.append(item)
        continue
    if raw == 'label-not-found' or (isinstance(raw, str) and raw == 'label-not-found'):
        tl.done.append(item)
        pruned_ghost.append(f"{item.label}:not-found")
        continue
    if info and info.get('visible') is False:
        tl.done.append(item)
        pruned_ghost.append(f"{item.label}:not-visible")
        continue
    if info.get('disabled') and not info.get('hasButton'):
        item.disabled = True
        tl.done.append(item)
        pruned_disabled.append(item.label)
        continue
    kept.append(item)
if pruned_disabled or pruned_ghost:
    tl.pending = kept
    if self.business_data_store is not None:
        self.business_data_store['task_list'] = tl.to_store()
    if pruned_disabled:
        sys.stderr.write(f'[click_save] pruned disabled pending: {pruned_disabled}\n')
    if pruned_ghost:
        sys.stderr.write(f'[click_save] pruned ghost pending: {pruned_ghost}\n')
    sys.stderr.flush()
    gate_ok, pending_labels = check_pending_write_gate(self.business_data_store, section=sec)
```

Notes:
- On evaluate exception: **keep** pending (do not treat as ghost).
- Spec log uses reason `not-found` / `not-visible` inside the ghost list entries.

- [ ] **Step 2: Run characterize-ghost-pending-prune — expect OK**

- [ ] **Step 3: Run verify-all (or at least this pin + characterize-phase-section-scope / dual-save if they touch form_save)**

```bash
bash scripts/refactor/verify-all.sh
```

Expected: ALL GREEN including `characterize-ghost-pending-prune`.

- [ ] **Step 4: Commit + agent-log 收工 + mark spec status**

```bash
git add scripts/controller/actions/form_save.py docs/superpowers/agent-log.md docs/superpowers/specs/2026-09-07-ghost-pending-prune-design.md
git commit -m "fix(save): prune not-found/not-visible sticky pending on click_save"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `visible` on CHECK_SINGLE | Task 2 |
| display/visibility/zero-rect; not viewport | Task 2 |
| prune not-found | Task 3 |
| prune not-visible | Task 3 |
| keep disabled prune + log | Task 3 |
| `pruned ghost pending` log | Task 3 |
| re-run gate | Task 3 |
| characterization pins | Task 1 |
| verify-all registration | Task 1 |
| No B/C / no fake-success / no #614 re-record | Global |

## Execution

User said「继续」after spec OK → **Inline Execution** in this session (executing-plans).
