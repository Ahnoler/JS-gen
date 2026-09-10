# Click Index+Button Record/Replay Unify (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route product replay `click_element_by_index` and `click_button` through `ClickEngine` (`mode='replay'` / `*_for_replay`) so durable click evaluate lives in one place; replay layer only supplies params, locate annotation, and batch scheduling.

**Architecture:** Skip `click_dispatch`. Add `scripts/controller/actions/click_action_engine.py` with `ClickEngine`. Replay path delegates to existing `_replay_click_by_index` / `_JS_CLICK_DURABLE` **inside the engine** (no third copy). Record path: move current `_misc.py` bodies into `ClickEngine` (`mode='record'`); `_misc` becomes thin wrappers. Close-group shell (`_replay_close_dialog_idempotent`) stays; only the `click_button` kernel switches to the engine. Menu/close/adjacent/table-row remain on `_replay_click_by_index` until a later design.

**Tech Stack:** Python 3 + Playwright, cold characterization pins, existing `replay_click.py` / `_replay.py` / `_misc.py`.

**Spec:** [`docs/superpowers/specs/2026-09-10-click-record-replay-unify-design.md`](../specs/2026-09-10-click-record-replay-unify-design.md)

## Global Constraints

- Spec O1–O3: engine file **`click_action_engine.py`**; `click_button` stays inside `_replay_close_dialog_idempotent` shell (kernel → engine); **do not** change record index to durable-only.
- **No** `click_dispatch`. Out: menu / close / switch_tab / adjacent / table-row-button / `click_menu_xpath` / `click_table_row_radio`.
- Do **not** weaken search-then-click record guards; do not touch form fill/select/radio engines except shared adapter reuse if needed.
- Do **not** touch: `config/update-db-whitelist.ps1`, kb drafts, `.cursor/`, unrelated WIP.
- Keep close-dialog / search-then-click / radio-replay pins GREEN (update needles only if symbols move).
- Repo Python: `./python/python.exe` (Windows: `D:\dev\JS-gen\python\python.exe`).
- Main session commits; subagents do not commit.

## File map

| File | Role |
|---|---|
| `scripts/characterization/cold/characterize-click-replay-engine.py` | Cold pin: index+button via ClickEngine; no bare durable on those paths |
| `scripts/controller/actions/click_action_engine.py` | `ClickEngine` + `*_for_replay` + mode |
| `scripts/controller/actions/replay_click.py` | Keep `_replay_click_by_index` / settle; called **from engine** (and still from Out actions in `_replay.py`) |
| `scripts/controller/actions/_replay.py` | Index branch + `click_button` kernel → engine |
| `scripts/controller/actions/_misc.py` | Thin wrappers → `ClickEngine` `mode=record` |
| `docs/superpowers/specs/2026-09-05-engine-actions-contract.md` | §2.2 / §2.3 |
| `AGENTS.md` | One-liner |
| `scripts/refactor/verify-all.sh` | Register pin (final task) |
| Design / fill §8 / agent-log | Status close |

---

### Task 1: Red pin — replay must call ClickEngine for index + button

**Files:**
- Create: `scripts/characterization/cold/characterize-click-replay-engine.py`
- Test: same (**not** in verify-all until Task 5)

**Interfaces:**
- Consumes: nothing
- Produces: FAIL until Tasks 2–3

- [ ] **Step 1: Write cold pin**

```python
"""Cold pin Phase B: replay click_element_by_index + click_button via ClickEngine.

Not in verify-all until Task 5. Expected RED until Tasks 2–3 wire engine replay.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _replay_src() -> str:
    return (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")


def _engine_src() -> str:
    path = ROOT / "scripts/controller/actions/click_action_engine.py"
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")


def phase_b_index_uses_engine() -> bool:
    replay = _replay_src()
    # Index branch near _CLICK_BY_INDEX / click_element_by_index
    if "click_element_by_index_for_replay" not in replay and "ClickEngine" not in replay:
        print("FAIL: _replay.py must reference ClickEngine / for_replay for index")
        return False
    # Heuristic: the dedicated index arm must not be the only call site pattern
    # `result = await _replay_click_by_index(page, entry, params)` without engine.
    # Allow _replay_click_by_index elsewhere (menu/close Out).
    marker = "elif action_name == _CLICK_BY_INDEX:"
    if marker not in replay:
        # alternate spelling
        marker = "action_name == _CLICK_BY_INDEX"
    if marker in replay:
        arm = replay.split(marker, 1)[1].split("elif action_name", 1)[0].split("else:", 1)[0]
        if "click_element_by_index_for_replay" not in arm and "ClickEngine" not in arm:
            print("FAIL: click_element_by_index branch must call ClickEngine for_replay")
            return False
        if "await _replay_click_by_index(page, entry, params)" in arm:
            print("FAIL: index branch still calls _replay_click_by_index directly")
            return False
    return True


def phase_b_button_uses_engine() -> bool:
    replay = _replay_src()
    # Inside close-group helper: click_button kernel
    if "click_button_for_replay" not in replay and (
        "ClickEngine" not in replay or "click_button" not in replay
    ):
        # Require explicit for_replay symbol for button
        if "click_button_for_replay" not in replay:
            print("FAIL: _replay.py must call click_button_for_replay for click_button")
            return False
    # When mapping click_button text, subsequent durable call must be engine
    close_fn = ""
    if "async def _replay_close_dialog_idempotent" in replay:
        close_fn = replay.split("async def _replay_close_dialog_idempotent", 1)[1]
        close_fn = close_fn.split("\nasync def ", 1)[0]
    else:
        print("FAIL: missing _replay_close_dialog_idempotent")
        return False
    if "click_button_for_replay" not in close_fn:
        print("FAIL: close-group must call click_button_for_replay")
        return False
    eng = _engine_src()
    if not eng:
        print("FAIL: missing click_action_engine.py")
        return False
    if "class ClickEngine" not in eng:
        print("FAIL: missing ClickEngine")
        return False
    if "click_element_by_index_for_replay" not in eng or "click_button_for_replay" not in eng:
        print("FAIL: ClickEngine missing for_replay entrypoints")
        return False
    if "_JS_CLICK_DURABLE" not in eng and "_replay_click_by_index" not in eng:
        print("FAIL: ClickEngine must own durable path (direct or via _replay_click_by_index)")
        return False
    return True


def main() -> int:
    ok = True
    if not phase_b_index_uses_engine():
        ok = False
    if not phase_b_button_uses_engine():
        ok = False
    if not ok:
        print("FAILED: characterize-click-replay-engine (Phase B red pin)")
        return 1
    print("ok: characterize-click-replay-engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL**

```bash
./python/python.exe scripts/characterization/cold/characterize-click-replay-engine.py
```

- [ ] **Step 3: Commit** (main session)

```bash
git add scripts/characterization/cold/characterize-click-replay-engine.py
git commit -m "test(pin): red Phase B click index+button replay-via-ClickEngine"
```

---

### Task 2: Implement `ClickEngine` + `*_for_replay` (replay path)

**Files:**
- Create: `scripts/controller/actions/click_action_engine.py`
- Test: Task 1 pin still FAIL on `_replay` wiring; engine file exists

**Interfaces:**
- Consumes: `replay_click._replay_click_by_index`, `_post_click_settle` (unchanged location OK)
- Produces:

```python
class ClickEngine:
    @classmethod
    async def click_element_by_index_for_replay(
        cls, page, entry: dict, params: dict,
    ) -> str:
        """Replay durable click; ignores ephemeral highlight index."""
        ...

    @classmethod
    async def click_button_for_replay(
        cls, page, entry: dict, params: dict,
    ) -> str:
        """Replay click_button via same durable path (params already text-mapped)."""
        ...

    async def click_element_by_index(self, index: int, *, mode: str = "record"):
        """Record path filled in Task 4; replay not used via instance for product API."""
        ...

    async def click_button(self, button_text: str, *, mode: str = "record"):
        ...
```

- [ ] **Step 1: Minimal replay implementation**

```python
"""ClickEngine: click_element_by_index / click_button record+replay (Phase B)."""
from .replay_click import _replay_click_by_index


class ClickEngine:
    @classmethod
    async def click_element_by_index_for_replay(cls, page, entry: dict, params: dict) -> str:
        return await _replay_click_by_index(page, entry or {}, params or {})

    @classmethod
    async def click_button_for_replay(cls, page, entry: dict, params: dict) -> str:
        # Caller maps button_text → text; durable path shared with index
        return await _replay_click_by_index(page, entry or {}, params or {})
```

Keep `_JS_CLICK_DURABLE` evaluate **only** inside `replay_click.py` (engine-owned call chain). Do not duplicate the evaluate in `_replay.py` for index/button after Task 3.

- [ ] **Step 2: Stub `mode=record` methods** that raise `NotImplementedError` **or** temporarily re-export by importing from a private helper — prefer **defer full record move to Task 4**; for Task 2 only ship `*_for_replay` classmethods if `_misc` still holds record bodies. Pin only requires for_replay symbols + durable ownership.

- [ ] **Step 3: Run**

```bash
./python/python.exe scripts/characterization/cold/characterize-click-replay-engine.py
```

Expected: still FAIL on `_replay` wiring; not on missing engine file.

- [ ] **Step 4: Commit**

```bash
git add scripts/controller/actions/click_action_engine.py
git commit -m "feat(click): ClickEngine for_replay durable entrypoints"
```

---

### Task 3: Wire `_replay.py` index + `click_button` kernel

**Files:**
- Modify: `scripts/controller/actions/_replay.py` (~L71 import; ~L643–644 index; ~L545–568 button kernel)
- Test: `characterize-click-replay-engine.py` → GREEN for replay wiring; Out actions may still call `_replay_click_by_index`

**Interfaces:**
- Consumes: `ClickEngine.click_element_by_index_for_replay`, `click_button_for_replay`

- [ ] **Step 1: Import**

```python
from .click_action_engine import ClickEngine
```

Keep `from .replay_click import _post_click_settle, _replay_click_by_index` for Out actions / settle.

- [ ] **Step 2: Index branch**

Replace:

```python
elif action_name == _CLICK_BY_INDEX:
    result = await _replay_click_by_index(page, entry, params)
```

with:

```python
elif action_name == _CLICK_BY_INDEX:
    result = await ClickEngine.click_element_by_index_for_replay(page, entry, params)
```

- [ ] **Step 3: `click_button` inside `_replay_close_dialog_idempotent`**

Where today (after text mapping) the shared line is:

```python
result = await _replay_click_by_index(page, entry, click_params)
```

Change so **`click_button` uses the engine**; other group actions keep `_replay_click_by_index`:

```python
if result is None and (_element_xpath_smart(entry) or click_params.get('text')):
    if action_name == 'click_button':
        result = await ClickEngine.click_button_for_replay(page, entry, click_params)
    else:
        result = await _replay_click_by_index(page, entry, click_params)
    # close_dialog ctrl-fallback unchanged below...
```

Do **not** move `close_dialog` idempotent `JS_COUNT_OVERLAYS` probe.

- [ ] **Step 4: Run pins**

```bash
./python/python.exe scripts/characterization/cold/characterize-click-replay-engine.py
./python/python.exe scripts/characterization/cold/characterize-radio-replay-engine.py
./python/python.exe scripts/characterization/cold/characterize-search-then-click-guard.py
```

All GREEN (or search-then-click unchanged).

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/_replay.py
git commit -m "refactor(replay): click_element_by_index + click_button via ClickEngine"
```

---

### Task 4: Record path — `_misc` thin-delegate into `ClickEngine`

**Files:**
- Modify: `scripts/controller/actions/click_action_engine.py` (add `mode=record` bodies)
- Modify: `scripts/controller/actions/_misc.py` (`click_button` ~388+, `click_element_by_index` ~622+)
- Test: existing click / stc / capture-xpath pins that mention these names

**Interfaces:**
- Produces: agent-facing `_misc` wrappers call engine `mode='record'`; behavior preserved

- [ ] **Step 1: Move bodies**

Cut the current nested `async def click_button` / `async def click_element_by_index` implementations from `_misc.py` into `ClickEngine` methods:

```python
async def click_button(self, button_text: str, *, mode: str = "record"):
    if mode == "replay":
        raise ValueError("use click_button_for_replay(page, entry, params)")
    # paste existing _misc body (record-only); keep search-then-click / JS paths
    ...

async def click_element_by_index(self, index: int, *, mode: str = "record"):
    if mode == "replay":
        raise ValueError("use click_element_by_index_for_replay(...)")
    # paste existing _misc body
    ...
```

Wire construction like other engines: `_misc` already has `browser_context` / stores — instantiate `ClickEngine(...)` the same way `RadioEngine` is wired in `_form.py`, **or** pass deps into `ClickEngine.__init__` matching `_misc` closure needs.

If moving the full closure is too large for one reviewable commit: **minimum bar** = `_misc` wrappers call `ClickEngine` methods that still live as module-level helpers in `click_action_engine.py` extracted verbatim from `_misc` (behavior-preserving move). Do not change guard order.

- [ ] **Step 2: Thin `_misc`**

```python
async def click_button(button_text: str):
    return await _click_engine.click_button(button_text, mode="record")

async def click_element_by_index(index: int):
    return await _click_engine.click_element_by_index(index, mode="record")
```

- [ ] **Step 3: Run**

```bash
./python/python.exe scripts/characterization/cold/characterize-click-replay-engine.py
./python/python.exe scripts/characterization/cold/characterize-search-then-click-guard.py
./python/python.exe scripts/characterization/characterize-capture-element-xpath.py
```

Update needles only if function location strings break (prefer keeping `async def click_element_by_index` name on the engine method so pins that split on that name still work — check `characterize-capture-element-xpath.py` / stc pins).

- [ ] **Step 4: Commit**

```bash
git add scripts/controller/actions/click_action_engine.py scripts/controller/actions/_misc.py
git commit -m "refactor(click): record click_button/index via ClickEngine mode=record"
```

---

### Task 5: Contract + verify-all + docs close

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-engine-actions-contract.md` §2.2 / §2.3
- Modify: `AGENTS.md`
- Modify: `scripts/refactor/verify-all.sh` — register pin after radio-replay-engine
- Modify: design status → landed; fill §8 index+button → done
- Modify: `docs/superpowers/agent-log.md` 收工

- [ ] **Step 1: Contract**

§2.3 `click_element_by_index`: 经 `ClickEngine`（`click_element_by_index_for_replay` / durable）；禁止只改引擎或只改 `_replay.py`。见 click unify design。

§2.2 note for `click_button`: 组外壳仍 `_replay_close_dialog_idempotent`；内核经 `ClickEngine.click_button_for_replay`。

- [ ] **Step 2: AGENTS**

```markdown
- **Click record/replay (index+button):** product replay routes through `ClickEngine` (`*_for_replay` / durable); see `docs/superpowers/specs/2026-09-10-click-record-replay-unify-design.md`.
```

- [ ] **Step 3: verify-all**

```bash
run "characterize-click-replay-engine" "$PY" scripts/characterization/cold/characterize-click-replay-engine.py
```

- [ ] **Step 4: Run**

```bash
./python/python.exe scripts/characterization/cold/characterize-click-replay-engine.py
bash scripts/refactor/verify-all.sh
```

If full gate has known unrelated reds, document; **click pin must GREEN**.

- [ ] **Step 5: Commit**

```bash
git commit -m "docs: Phase B click index+button record/replay unify close"
```

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| `ClickEngine` + `*_for_replay` | 2 |
| Replay index + button via engine | 3 |
| No bare durable on those paths (pin) | 1, 3 |
| Record thin `_misc` → engine | 4 |
| Ephemeral index preserved (via `_replay_click_by_index`) | 2–3 |
| menu/close Out still may call `_replay_click_by_index` | 3 |
| Contract + AGENTS + verify-all | 5 |
| No `click_dispatch` | — (constraint) |

## Placeholder scan

No TBD. Record move size called out with minimum bar. Pin explicitly allows Out actions to keep `_replay_click_by_index`.

## Self-review notes

- C1–C4 map to Tasks 2–5.
- O2 honored: button stays in close-group shell.
- O3 honored: record index not forced to durable.
