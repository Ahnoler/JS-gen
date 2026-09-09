# Fill Record/Replay Unify (A→B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share one fill locate/JS-attempt order between recording and replay (Phase A), then have replay call `FillEngine` in `mode='replay'` so the same Python path emits `JS_FILL_*` (Phase B).

**Architecture:** Introduce `scripts/controller/actions/fill_dispatch.py` with `resolve_fill_attempt_order` returning ordered `FillAttempt` path enums (`xpath` | `label` | `placeholder` | `xpath_full`) plus payloads (xpath, hint). Phase A rewires `_replay_form_action` fill branch and aligns `FillEngine.fill_form_field` attempt order to that list. Phase B adds `mode='record'|'replay'` / `fill_form_field_for_replay(page, …)` (reuse select’s page adapter), moves false_ok empty-actual fallback into engine replay, and forbids direct `page.evaluate(JS_FILL_*)` on the replay fill main path.

**Tech Stack:** Python 3 + Playwright `page.evaluate`, cold characterization pins, existing `FillEngine` / `replay_form_action.py` / select unify adapters.

**Spec:** [`docs/superpowers/specs/2026-09-09-fill-record-replay-unify-design.md`](../specs/2026-09-09-fill-record-replay-unify-design.md)

## Global Constraints

- Spec O1–O3 binding: module name **`fill_dispatch.py`**; false_ok empty-actual may stay in replay for A, **must** enter engine replay in B; **login** internal fills untouched.
- Mirror select unify patterns: page adapter, `_maybe_ensure_scanned`, plain strings in replay mode, main-session commits / subagents do not commit.
- Do **not** weaken: xpath_smart → label → placeholder → xpath_full order; ignore `params.xpath_smart` for locate; tssc/tree reject-on-fill in engine (and in replay mode).
- Do **not** touch: click family, `config/update-db-whitelist.ps1`, kb drafts, `.cursor/`, select_dispatch (except if importing shared helpers).
- Keep `characterize-xpath-fill-select.py` and select pins GREEN (update needles if symbols move; do not delete semantics).
- Repo Python: `./python/python.exe` (Windows: `D:\dev\JS-gen\python\python.exe`).

## File map

| File | Phase | Role |
|---|---|---|
| `scripts/controller/actions/fill_dispatch.py` | A | `FillAttempt`, `resolve_fill_attempt_order` |
| `scripts/characterization/cold/characterize-fill-dispatch.py` | A→B | Pure + dual wiring pins |
| `scripts/controller/actions/replay_form_action.py` | A/B | Fill branch via dispatch; later engine |
| `scripts/controller/actions/form_action_engines.py` | A/B | FillEngine uses attempt order; later `mode=` / `for_replay` |
| `scripts/characterization/cold/characterize-fill-replay-engine.py` | B | Red then green Phase B pin |
| `docs/superpowers/specs/2026-09-05-engine-actions-contract.md` | A | §2.4 fill_form_field |
| `AGENTS.md` | A | One-line pointer to fill unify spec |
| `scripts/refactor/verify-all.sh` | A/B | Register cold pins |

---

### Task 1: Red pin — fill_dispatch + dual wiring

**Files:**
- Create: `scripts/characterization/cold/characterize-fill-dispatch.py`
- Test: same

**Interfaces:**
- Consumes: nothing
- Produces: FAIL until Tasks 2–4

- [ ] **Step 1: Write cold pin**

```python
"""Pin fill_dispatch: shared fill attempt order for record + replay (unify spec A)."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]


def main() -> int:
    path = ROOT / "scripts/controller/actions/fill_dispatch.py"
    if not path.is_file():
        print("FAIL: missing fill_dispatch.py")
        return 1
    src = path.read_text(encoding="utf-8")
    for needle in (
        "class FillAttempt",
        "def resolve_fill_attempt_order",
        "xpath",
        "label",
        "placeholder",
        "xpath_full",
    ):
        if needle not in src:
            print(f"FAIL: fill_dispatch.py missing {needle!r}")
            return 1

    engines = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(
        encoding="utf-8"
    )
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
        encoding="utf-8"
    )
    if "resolve_fill_attempt_order" not in engines:
        print("FAIL: form_action_engines.py must call resolve_fill_attempt_order")
        return 1
    if "resolve_fill_attempt_order" not in replay:
        print("FAIL: replay_form_action.py must call resolve_fill_attempt_order")
        return 1

    # Replay fill branch must not keep a private full ladder copy as the only strategy.
    fill_body = replay.split("if action_name == 'fill_form_field':", 1)[1].split(
        "# Widget ops:", 1
    )[0]
    if "resolve_fill_attempt_order" not in fill_body:
        print("FAIL: fill branch must invoke resolve_fill_attempt_order")
        return 1

    sys.path.insert(0, str(ROOT))
    from scripts.controller.actions.fill_dispatch import resolve_fill_attempt_order

    attempts = resolve_fill_attempt_order(
        entry={
            "element": {
                "xpath_smart": "//div[@class='el-form-item'][1]//input",
                "xpath_full": "/html/body/div[1]/input",
            }
        },
        params={"label_text": "名称", "value": "x"},
        use_relative=True,
        label="名称",
        placeholder="",
    )
    paths = [a.path for a in attempts]
    if paths[:2] != ["xpath", "label"]:
        print(f"FAIL: expected xpath then label first, got {paths!r}")
        return 1
    if "xpath_full" not in paths:
        print(f"FAIL: expected xpath_full in order, got {paths!r}")
        return 1

    print("ok: characterize-fill-dispatch")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL** (`missing fill_dispatch.py`)

```bash
./python/python.exe scripts/characterization/cold/characterize-fill-dispatch.py
```

- [ ] **Step 3: Commit** (main session)

```bash
git add scripts/characterization/cold/characterize-fill-dispatch.py
git commit -m "test(pin): red fill_dispatch dual-wiring for record/replay unify A"
```

---

### Task 2: Implement `fill_dispatch.py`

**Files:**
- Create: `scripts/controller/actions/fill_dispatch.py`
- Modify: `characterize-fill-dispatch.py` if API needs tiny adjust

**Interfaces:**
- Produces:

```python
@dataclass(frozen=True)
class FillAttempt:
    path: str          # "xpath" | "label" | "placeholder" | "xpath_full"
    xpath: str = ""    # for xpath / xpath_full
    locate_src: str = ""  # "element" | "full" | "label" | "placeholder"
    hint: str = ""     # label or placeholder passed to JS_FILL_BY_XPATH
    js_kind: str = ""  # "by_xpath" | "form_field"  — which JS constant family


def resolve_fill_attempt_order(
    *,
    entry: dict | None,
    params: dict | None,
    use_relative: bool,
    label: str = "",
    placeholder: str = "",
) -> list[FillAttempt]:
    """Order matches current replay: smart xpath → label → placeholder → full.

    Never consult params['xpath_smart'] for locate (dirty-param lesson).
    """
```

Implementation sketch (encode current replay order exactly):

```python
def resolve_fill_attempt_order(...):
    from scripts.controller.actions._replay import (
        _element_xpath_full,
        _element_xpath_smart,
        _resolve_replay_xpath,
    )
    # Prefer importing xpath helpers without circular import:
    # if circular, duplicate the small xpath extractors here OR pass xp/full in.
    attempts: list[FillAttempt] = []
    xp, src = _resolve_replay_xpath(entry or {}, params or {}) if use_relative else ("", "")
    # When called from FillEngine without entry, pass synthetic entry from resolved xpath.
    if xp:
        attempts.append(FillAttempt(
            path="xpath", xpath=xp, locate_src=src or "element",
            hint=(label or placeholder), js_kind="by_xpath",
        ))
    if label:
        attempts.append(FillAttempt(
            path="label", locate_src="label", hint=label, js_kind="form_field",
        ))
    if placeholder and placeholder != label:
        attempts.append(FillAttempt(
            path="placeholder", locate_src="label", hint=placeholder, js_kind="form_field",
        ))
    if not label and placeholder:
        attempts.append(FillAttempt(
            path="placeholder", locate_src="placeholder", hint=placeholder,
            xpath="", js_kind="by_xpath",  # JS_FILL_BY_XPATH ['', value, placeholder]
        ))
    full = _element_xpath_full(entry) if use_relative and entry else ""
    if full and full != xp:
        attempts.append(FillAttempt(
            path="xpath_full", xpath=full, locate_src="full",
            hint=(label or placeholder), js_kind="by_xpath",
        ))
    return attempts
```

**Circular import note:** If `fill_dispatch` → `_replay` → `replay_form_action` → `fill_dispatch`, instead copy `_element_xpath_smart` / `_element_xpath_full` / `_resolve_replay_xpath` into `fill_dispatch` as thin re-exports from a tiny `replay_xpath.py`, **or** pass precomputed `xpath_smart`/`xpath_full` into `resolve_fill_attempt_order`. Prefer **pass precomputed xpaths** from callers to keep `fill_dispatch` free of `_replay` imports:

```python
def resolve_fill_attempt_order(
    *,
    label: str = "",
    placeholder: str = "",
    xpath_smart: str = "",
    xpath_smart_src: str = "",
    xpath_full: str = "",
) -> list[FillAttempt]:
    ...
```

Update Task 1 pin accordingly if this signature is chosen (recommended).

- [ ] **Step 1: Implement module with precomputed-xpath API (recommended)**

- [ ] **Step 2: Adjust pin pure smoke to new signature**

- [ ] **Step 3: Commit**

```bash
git add scripts/controller/actions/fill_dispatch.py scripts/characterization/cold/characterize-fill-dispatch.py
git commit -m "feat(fill): add resolve_fill_attempt_order shared strategy"
```

---

### Task 3: Wire replay fill branch through dispatch

**Files:**
- Modify: `scripts/controller/actions/replay_form_action.py` (fill branch ~L67–142)
- Test: `characterize-fill-dispatch.py`, `characterize-xpath-fill-select.py`

**Interfaces:**
- Consumes: `resolve_fill_attempt_order`
- Produces: same runtime behavior as today’s ladder

- [ ] **Step 1: Replace inline ladder**

```python
if action_name == 'fill_form_field':
    from .fill_dispatch import resolve_fill_attempt_order
    xp, src = _resolve_replay_xpath(entry, params)
    full = _element_xpath_full(entry) if use_relative else ''
    attempts = resolve_fill_attempt_order(
        label=label,
        placeholder=placeholder,
        xpath_smart=xp,
        xpath_smart_src=src,
        xpath_full=full if use_relative else '',
    )
    result = 'label-not-found'
    element_xp = _element_xpath_smart(entry) if use_relative else ''

    for att in attempts:
        if att.js_kind == 'by_xpath':
            # reuse existing _try_xpath_fill logic (keep false_ok empty-actual fallback here in A)
            xpath_result = await _try_xpath_fill(att.xpath, att.locate_src, hint=att.hint)
            if xpath_result:
                return xpath_result
            continue
        # form_field
        key = att.hint  # label or placeholder text
        result = await page.evaluate(JS_FILL_FORM_FIELD, [key, value])
        if isinstance(result, str) and result.startswith('ok'):
            # keep existing element_xp classify / annotate behavior
            ...
            return ...
    # absent skip + final annotate — same as today
```

Keep `_try_xpath_fill` nested helper in A (false_ok fallback). Do not delete classify helpers.

- [ ] **Step 2: Run pins**

```bash
./python/python.exe scripts/characterization/cold/characterize-fill-dispatch.py
./python/python.exe scripts/characterization/characterize-xpath-fill-select.py
```

Expected: fill-dispatch still FAIL on engines missing call; xpath-fill GREEN.

- [ ] **Step 3: Commit**

```bash
git add scripts/controller/actions/replay_form_action.py
git commit -m "refactor(replay): fill_form_field attempts via resolve_fill_attempt_order"
```

---

### Task 4: Wire FillEngine through dispatch

**Files:**
- Modify: `scripts/controller/actions/form_action_engines.py` (`FillEngine.fill_form_field`)
- Test: fill-dispatch pin → GREEN; existing fill characterizations

**Interfaces:**
- Consumes: `resolve_fill_attempt_order`
- Produces: engine attempts xpath then label in same order when both available

- [ ] **Step 1: After kind rejects / resolve control**

When `resolved.xpath_smart` present, build attempts via dispatch (synthetic):

```python
from .fill_dispatch import resolve_fill_attempt_order

attempts = resolve_fill_attempt_order(
    label=resolved.label or label_text,
    placeholder="",  # engine historically label-centric; OK
    xpath_smart=(resolved.xpath_smart or "").strip(),
    xpath_smart_src="element",
    xpath_full="",
)
# Iterate: prefer by_xpath then form_field — but keep existing strict_xpath /
# use_label_fallback / Z-guard branches. Minimum bar for pin: call
# resolve_fill_attempt_order somewhere in fill_form_field body and honor
# xpath-before-label when both exist.
```

Do **not** gut Z2/Z4 / tssc reject. If full iteration is too risky in one task, minimum acceptable: call `resolve_fill_attempt_order` and use its order to choose between existing xpath vs label code paths (if/else driven by `attempts[0].path`).

- [ ] **Step 2: Run**

```bash
./python/python.exe scripts/characterization/cold/characterize-fill-dispatch.py
# expect GREEN
./python/python.exe scripts/characterization/characterize-xpath-fill-select.py
```

- [ ] **Step 3: Commit**

```bash
git add scripts/controller/actions/form_action_engines.py
git commit -m "refactor(fill): FillEngine attempt order via resolve_fill_attempt_order"
```

---

### Task 5: Contract docs + verify-all + Phase A close

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-engine-actions-contract.md` §2.4 `fill_form_field`
- Modify: `AGENTS.md` (fill unify one-liner next to select unify)
- Modify: fill unify design status → Phase A landed
- Modify: `scripts/refactor/verify-all.sh` — register `characterize-fill-dispatch.py`
- Modify: `docs/superpowers/agent-log.md`

- [ ] **Step 1: Contract row**

Note: locate/JS 选用经 `resolve_fill_attempt_order`（`fill_dispatch`）；禁止只改 FillEngine 或只改 replay。

- [ ] **Step 2: AGENTS one-liner** pointing at fill unify spec.

- [ ] **Step 3: verify-all register**

```bash
run "characterize-fill-dispatch" "$PY" scripts/characterization/cold/characterize-fill-dispatch.py
```

(near select-dispatch entry)

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: fill_dispatch contract + Phase A close notes"
```

**Phase A exit:** fill-dispatch GREEN; xpath-fill GREEN; replay/engine both call dispatch.

---

### Task 6: Phase B red pin — replay must call FillEngine

**Files:**
- Create: `scripts/characterization/cold/characterize-fill-replay-engine.py` (**not** in verify-all until Task 9)

```python
def phase_b_replay_uses_fill_engine() -> bool:
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(encoding="utf-8")
    body = replay.split("if action_name == 'fill_form_field':", 1)[1].split("# Widget ops:", 1)[0]
    if (
        "fill_form_field_for_replay" not in body
        and "mode='replay'" not in body
        and 'mode="replay"' not in body
    ):
        print("FAIL: fill_form_field replay must call FillEngine replay entry")
        return False
    if "page.evaluate(JS_FILL_FORM_FIELD" in body or "page.evaluate(JS_FILL_BY_XPATH" in body:
        print("FAIL: replay fill still evaluates JS_FILL_* directly")
        return False
    engines = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
    if "fill_form_field_for_replay" not in engines and (
        "mode" not in engines or "replay" not in engines
    ):
        print("FAIL: FillEngine missing replay mode / for_replay")
        return False
    return True
```

- [ ] **Step 1: Create pin; run expect FAIL**

- [ ] **Step 2: Commit**

```bash
git commit -m "test(pin): red Phase B fill replay-via-FillEngine"
```

---

### Task 7: FillEngine `mode='replay'` + `fill_form_field_for_replay`

**Files:**
- Modify: `scripts/controller/actions/form_action_engines.py` (`FillEngine`)

**Interfaces:**

```python
async def fill_form_field(
    self, label_text: str, value: str, xpath_smart: str = "",
    *, mode: str = "record", element: dict | None = None,
) -> ...:
    ...

@classmethod
async def fill_form_field_for_replay(
    cls, page, label_text: str, value: str, *,
    xpath_smart: str = "", element: dict | None = None,
    placeholder: str = "",
) -> str:
    # Reuse _ReplayPageAdapter / _ReplayAutofillStub from select Phase B
    ...
```

- [ ] **Step 1: Thread mode**

Replay: skip `_record_action` / `_task_done`; `_maybe_ensure_scanned`; plain strings (unwrap `err_with`/`_ok`); keep tssc/tree reject; keep Z guards; use `resolve_fill_attempt_order` + evaluate internally; **include false_ok empty-actual fallback** (move from replay helper into engine replay path per O2).

- [ ] **Step 2: Record path unchanged for agent**

- [ ] **Step 3: Run Phase A pins GREEN; Phase B pin still FAIL on replay wiring**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(fill): FillEngine fill_form_field mode=record|replay"
```

---

### Task 8: Replay fill calls engine

**Files:**
- Modify: `scripts/controller/actions/replay_form_action.py` fill branch
- Possibly update fill-related characterization needles

- [ ] **Step 1: Thin fill branch**

```python
if action_name == 'fill_form_field':
    raw = await FillEngine.fill_form_field_for_replay(
        page, label, value,
        xpath_smart=xp or '',
        element=el,
        placeholder=placeholder,
    )
    # map to ok:locate=… / false_ok / ok-skip using existing helpers
    return mapped
```

No `page.evaluate(JS_FILL_*)` in fill branch body.

- [ ] **Step 2: Run ALL**

```bash
./python/python.exe scripts/characterization/cold/characterize-fill-replay-engine.py
./python/python.exe scripts/characterization/cold/characterize-fill-dispatch.py
./python/python.exe scripts/characterization/characterize-xpath-fill-select.py
./python/python.exe scripts/characterization/cold/characterize-select-dispatch.py
./python/python.exe scripts/characterization/cold/characterize-select-replay-engine.py
```

All GREEN.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(replay): fill_form_field via FillEngine mode=replay"
```

---

### Task 9: Phase B gate + docs close

**Files:**
- Modify: `verify-all.sh` — register `characterize-fill-replay-engine.py`
- Modify: fill unify design status → A+B landed
- Modify: `agent-log.md` close

- [ ] **Step 1: Register pin in verify-all**

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: Phase B fill record/replay unify close"
```

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| `fill_dispatch` / attempt order | 2 |
| Replay wiring A | 3 |
| Engine wiring A | 4 |
| Contract + AGENTS + verify-all A | 5 |
| Dual-wiring cold pin | 1, 4 |
| Phase B engine mode + for_replay | 7 |
| Replay via engine; no direct JS_FILL | 6, 8 |
| false_ok empty-actual in engine B | 7–8 |
| login untouched | — (constraint) |
| clicks out | — (constraint) |

## Placeholder scan

Circular-import mitigation is explicit (precomputed xpath API). No TBD deliverables.
