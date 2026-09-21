# Radio Record/Replay Unify (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route product replay `click_radio` through `RadioEngine` (`mode='replay'` / `click_radio_for_replay`) so xpath vs label JS selection and evaluate live in one place—closing the form write-action dual line after select/fill.

**Architecture:** Skip `radio_dispatch`. Extend `RadioEngine.click_radio` with `mode='record'|'replay'`, prefer `JS_CLICK_RADIO_BY_XPATH` when xpath is available then fall back to `JS_CLICK_RADIO` (label). Add classmethod `click_radio_for_replay` using `_ReplayPageAdapter` / `_ReplayAutofillStub`. Thin the `replay_form_action` `click_radio` branch; keep `_with_xpath_first` only for locate annotation (tree-shaped). Cold pin forbids direct `page.evaluate(JS_CLICK_RADIO*)` on that branch.

**Tech Stack:** Python 3 + Playwright `page.evaluate`, cold characterization pins, existing `RadioEngine` / `replay_form_action.py` / select–fill replay adapters.

**Spec:** [`docs/superpowers/specs/2026-09-09-radio-record-replay-unify-design.md`](../specs/2026-09-09-radio-record-replay-unify-design.md)

## Global Constraints

- Spec O1–O3 binding: **no** `radio_dispatch`; locate may stay in `_with_xpath_first`; **autofill** radio direct-eval untouched; **`click_table_row_radio`** untouched.
- Mirror select/fill Phase B: page adapter, `_maybe_ensure_scanned`, plain strings in replay (unwrap `_ok` / ActionResult), skip `_record_action` / `_task_done`, keep absent-field skip.
- Do **not** touch: click family, login fills, `config/update-db-whitelist.ps1`, kb drafts, `.cursor/`, select/fill dispatch modules except importing shared helpers.
- Keep `characterize-fill-*` / `characterize-select-*` / `characterize-manual-radio-fill` GREEN (update needles only if symbols move).
- Repo Python: `./python/python.exe` (Windows: `D:\dev\JS-gen\python\python.exe`).
- Main session commits; subagents do not commit.

## File map

| File | Role |
|---|---|
| `scripts/characterization/cold/characterize-radio-replay-engine.py` | Cold pin: replay via RadioEngine; no direct JS evaluate |
| `scripts/controller/actions/form_action_engines.py` | `RadioEngine` mode + `click_radio_for_replay` + xpath→label JS |
| `scripts/controller/actions/replay_form_action.py` | Thin `click_radio` branch |
| `docs/superpowers/specs/2026-09-05-engine-actions-contract.md` | §2.4 `click_radio` row |
| `AGENTS.md` | One-liner next to fill/select unify |
| `scripts/refactor/verify-all.sh` | Register cold pin (final task) |
| `docs/superpowers/specs/2026-09-09-radio-record-replay-unify-design.md` | Status → landed |
| `docs/superpowers/specs/2026-09-09-fill-record-replay-unify-design.md` | §8 radio → done |

---

### Task 1: Red pin — replay must call RadioEngine

**Files:**
- Create: `scripts/characterization/cold/characterize-radio-replay-engine.py`
- Test: same (**not** in verify-all until Task 4)

**Interfaces:**
- Consumes: nothing
- Produces: FAIL until Tasks 2–3

- [ ] **Step 1: Write cold pin**

```python
"""Cold pin Phase B: replay click_radio must route through RadioEngine (not direct JS).

Not in verify-all until Task 4. Expected RED until Tasks 2–3 wire engine replay mode.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def phase_b_replay_uses_radio_engine() -> bool:
    replay = (ROOT / "scripts/controller/actions/replay_form_action.py").read_text(
        encoding="utf-8"
    )
    if "if action_name == 'click_radio':" not in replay:
        print("FAIL: missing click_radio branch")
        return False
    body = replay.split("if action_name == 'click_radio':", 1)[1].split(
        "if action_name == 'select_option':", 1
    )[0]
    if (
        "click_radio_for_replay" not in body
        and "mode='replay'" not in body
        and 'mode="replay"' not in body
    ):
        print("FAIL: click_radio replay must call RadioEngine replay entry")
        return False
    if "page.evaluate(JS_CLICK_RADIO" in body:
        print("FAIL: replay click_radio still evaluates JS_CLICK_RADIO* directly")
        return False
    engines = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(
        encoding="utf-8"
    )
    if "click_radio_for_replay" not in engines:
        print("FAIL: RadioEngine missing click_radio_for_replay")
        return False
    if "class RadioEngine" not in engines:
        print("FAIL: missing RadioEngine")
        return False
    # mode=replay must appear in RadioEngine.click_radio signature or body
    radio_src = engines.split("class RadioEngine", 1)[1].split("class TreeEngine", 1)[0]
    if 'mode="replay"' not in radio_src and "mode='replay'" not in radio_src and "mode == \"replay\"" not in radio_src and "mode == 'replay'" not in radio_src:
        if "mode: str" not in radio_src and 'mode="' not in radio_src and "mode='" not in radio_src:
            print("FAIL: RadioEngine.click_radio missing mode parameter")
            return False
    if "JS_CLICK_RADIO_BY_XPATH" not in radio_src:
        print("FAIL: RadioEngine must still use JS_CLICK_RADIO_BY_XPATH")
        return False
    if "JS_CLICK_RADIO" not in radio_src or radio_src.count("JS_CLICK_RADIO") < 2:
        # Need both BY_XPATH and label JS_CLICK_RADIO (import + evaluate)
        if "JS_CLICK_RADIO," not in engines and "JS_CLICK_RADIO\n" not in engines:
            # softer: label fallback string must appear in radio class body
            if "page.evaluate(JS_CLICK_RADIO," not in radio_src and "page.evaluate(JS_CLICK_RADIO ," not in radio_src:
                print("FAIL: RadioEngine must fall back to label JS_CLICK_RADIO")
                return False
    return True


def main() -> int:
    if not phase_b_replay_uses_radio_engine():
        print("FAILED: characterize-radio-replay-engine (Phase B red pin)")
        return 1
    print("ok: characterize-radio-replay-engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Simplify the dual-JS check in the real file to:

```python
    if "JS_CLICK_RADIO_BY_XPATH" not in radio_src:
        print("FAIL: RadioEngine must use JS_CLICK_RADIO_BY_XPATH")
        return False
    # Label fallback: bare JS_CLICK_RADIO evaluate (not only BY_XPATH)
    if "page.evaluate(JS_CLICK_RADIO," not in radio_src.replace("JS_CLICK_RADIO_BY_XPATH", "X"):
        # After stripping BY_XPATH name, still need evaluate(JS_CLICK_RADIO,
        stripped = radio_src.replace("JS_CLICK_RADIO_BY_XPATH", "XPATH_CONST")
        if "page.evaluate(JS_CLICK_RADIO," not in stripped:
            print("FAIL: RadioEngine must fall back to label JS_CLICK_RADIO")
            return False
```

- [ ] **Step 2: Run — expect FAIL**

```bash
./python/python.exe scripts/characterization/cold/characterize-radio-replay-engine.py
```

Expected: FAIL on missing `click_radio_for_replay` and/or direct `page.evaluate(JS_CLICK_RADIO`.

- [ ] **Step 3: Commit** (main session)

```bash
git add scripts/characterization/cold/characterize-radio-replay-engine.py
git commit -m "test(pin): red Phase B radio replay-via-RadioEngine"
```

---

### Task 2: RadioEngine `mode='replay'` + `click_radio_for_replay` + xpath→label JS

**Files:**
- Modify: `scripts/controller/actions/form_action_engines.py` — `RadioEngine` (~L2058–2092); imports from `_js_snippets` (add `JS_CLICK_RADIO` alongside `JS_CLICK_RADIO_BY_XPATH`)
- Test: Task 1 pin still FAIL on replay wiring; engines symbols present

**Interfaces:**
- Consumes: `_ReplayPageAdapter`, `_ReplayAutofillStub`, `_replay_engine_store`, `_maybe_ensure_scanned`, `_unwrap_action_result`, `is_absent_field_result`, `absent_field_skip_result`
- Produces:

```python
@classmethod
async def click_radio_for_replay(
    cls,
    page,
    label_text: str,
    option_text: str,
    *,
    xpath_smart: str = "",
    business_data_store: dict | None = None,
) -> str:
    """Replay entry: page adapter + mode=replay."""
    ...

async def click_radio(
    self,
    label_text: str,
    option_text: str,
    xpath_smart: str = "",
    *,
    mode: str = "record",
):
    ...
```

- [ ] **Step 1: Import `JS_CLICK_RADIO`**

In `form_action_engines.py` `_js_snippets` import list, add `JS_CLICK_RADIO` next to `JS_CLICK_RADIO_BY_XPATH` (confirm current import name; today only BY_XPATH is imported).

- [ ] **Step 2: Replace `RadioEngine` body**

```python
class RadioEngine(_FormActionEngineBase):
    @classmethod
    async def click_radio_for_replay(
        cls,
        page,
        label_text: str,
        option_text: str,
        *,
        xpath_smart: str = "",
        business_data_store: dict | None = None,
    ):
        """Replay entry: construct engine with page adapter and run mode=replay."""
        store = _replay_engine_store(business_data_store)
        bc = _ReplayPageAdapter(page)
        autofill = _ReplayAutofillStub()
        engine = cls(bc, store, autofill)
        return await engine.click_radio(
            label_text,
            option_text,
            xpath_smart,
            mode="replay",
        )

    async def click_radio(
        self,
        label_text: str,
        option_text: str,
        xpath_smart: str = "",
        *,
        mode: str = "record",
    ):
        is_replay = mode == "replay"
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._maybe_ensure_scanned(label_text, mode)
        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
        if resolved.error:
            err = resolved.error
            if is_replay:
                return _unwrap_action_result(err) if not isinstance(err, str) else str(err)
            return err
        label_resolved = resolved.label
        xp = (resolved.xpath_smart or "").strip()
        element = await _capture_element(
            page, label_resolved, target_kind='form_radio', xpath_smart=xp,
        )

        result = None
        if xp:
            result = await page.evaluate(JS_CLICK_RADIO_BY_XPATH, [xp, option_text])
        # Fall back to label JS when no xpath or xpath path did not ok / absent
        need_label = (
            not xp
            or (
                not is_absent_field_result(result)
                and not _is_ok_result(result)
            )
        )
        if need_label:
            result = await page.evaluate(JS_CLICK_RADIO, [label_resolved, option_text])

        if is_absent_field_result(result):
            if is_replay:
                sys.stderr.write(f'[form] skip absent radio label={label_resolved!r}\n')
                sys.stderr.flush()
                return absent_field_skip_result()
            if not _is_query_mode(self.business_data_store):
                _task_done_impl(label_resolved, self.business_data_store)
            sys.stderr.write(f'[form] skip absent radio label={label_resolved!r}\n')
            sys.stderr.flush()
            return _ok(_with_submit_cue(absent_field_skip_result(), self.business_data_store))

        if _is_ok_result(result):
            if is_replay:
                return str(result)
            xp_inv = stamp_recorded_xpath_smart(element, xp)
            _record_action(
                'click_radio',
                {
                    'label_text': label_resolved,
                    'option_text': option_text,
                },
                result,
                element=element,
            )
            _task_done_impl(
                label_resolved, self.business_data_store, value=option_text, xpath_smart=xp_inv,
            )
            return _ok(result)
        if is_replay:
            return str(result)
        return result
```

**Fallback rule (spec):** xpath first when present; on non-ok / non-absent failure, retry label JS. If xpath returns absent, do **not** label-retry (field truly gone)—return skip. Adjust `need_label` accordingly:

```python
        if xp:
            result = await page.evaluate(JS_CLICK_RADIO_BY_XPATH, [xp, option_text])
            if is_absent_field_result(result) or _is_ok_result(result):
                pass  # done
            else:
                result = await page.evaluate(JS_CLICK_RADIO, [label_resolved, option_text])
        else:
            result = await page.evaluate(JS_CLICK_RADIO, [label_resolved, option_text])
```

- [ ] **Step 3: Keep `_form.py` agent wrapper unchanged**

`click_radio(label_text, option_text, xpath_smart="")` still calls `_radio_engine.click_radio(...)` — default `mode='record'` preserves agent behavior.

- [ ] **Step 4: Run**

```bash
./python/python.exe scripts/characterization/cold/characterize-radio-replay-engine.py
./python/python.exe scripts/characterization/cold/characterize-manual-radio-fill.py
./python/python.exe scripts/characterization/cold/characterize-fill-replay-engine.py
./python/python.exe scripts/characterization/cold/characterize-select-replay-engine.py
```

Expected: radio-replay-engine still FAIL on `replay_form_action` wiring; manual-radio-fill + fill/select pins GREEN.

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/form_action_engines.py
git commit -m "feat(radio): RadioEngine click_radio mode=record|replay + for_replay"
```

---

### Task 3: Replay `click_radio` calls engine

**Files:**
- Modify: `scripts/controller/actions/replay_form_action.py` — `click_radio` branch (~L113–118); imports (`RadioEngine`; drop unused `JS_CLICK_RADIO` from this file if no longer referenced)
- Test: `characterize-radio-replay-engine.py` → GREEN

**Interfaces:**
- Consumes: `RadioEngine.click_radio_for_replay`
- Produces: same outer locate annotation via `_with_xpath_first`

- [ ] **Step 1: Thin branch (keep `_with_xpath_first` per O1)**

```python
    if action_name == 'click_radio':
        async def _radio():
            r = await RadioEngine.click_radio_for_replay(
                page,
                label,
                value,
                xpath_smart=xpath_smart or '',
            )
            await page.wait_for_timeout(WAIT_300_MS)
            return r
        return await _with_xpath_first(_radio)
```

Ensure `RadioEngine` is imported at top of `replay_form_action.py` (same style as `FillEngine` / `SelectEngine` / `TreeEngine`).

Remove `JS_CLICK_RADIO` from this module’s imports **only if** nothing else in the file uses it (legacy `tssc_multi_select` must not lose its imports).

- [ ] **Step 2: Run pins**

```bash
./python/python.exe scripts/characterization/cold/characterize-radio-replay-engine.py
./python/python.exe scripts/characterization/cold/characterize-fill-replay-engine.py
./python/python.exe scripts/characterization/cold/characterize-select-replay-engine.py
./python/python.exe scripts/characterization/cold/characterize-manual-radio-fill.py
./python/python.exe scripts/characterization/characterize-xpath-fill-select.py
```

All GREEN.

- [ ] **Step 3: Commit**

```bash
git add scripts/controller/actions/replay_form_action.py
git commit -m "refactor(replay): click_radio via RadioEngine mode=replay"
```

---

### Task 4: Contract + verify-all + docs close

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-engine-actions-contract.md` §2.4 `click_radio` row
- Modify: `AGENTS.md` — one-liner under fill/select unify bullets
- Modify: `scripts/refactor/verify-all.sh` — register pin near fill/select replay-engine
- Modify: `docs/superpowers/specs/2026-09-09-radio-record-replay-unify-design.md` status → landed + plan link
- Modify: `docs/superpowers/specs/2026-09-09-fill-record-replay-unify-design.md` §8 `click_radio` → done
- Modify: `docs/superpowers/agent-log.md` — 收工回链开工

**Interfaces:**
- Consumes: Tasks 1–3 GREEN
- Produces: gate in verify-all

- [ ] **Step 1: Contract row**

Replace §2.4 `click_radio` explanation with:

`label_text`、`option_text` | 经 `RadioEngine`（`click_radio_for_replay` / `mode=replay`）：有 xpath → `JS_CLICK_RADIO_BY_XPATH`，否则/失败回退 `JS_CLICK_RADIO`；禁止只改引擎或只改 `replay_form_action`。见 [`2026-09-09-radio-record-replay-unify-design.md`](./2026-09-09-radio-record-replay-unify-design.md)。

- [ ] **Step 2: AGENTS.md**

```markdown
- **Radio record/replay:** `click_radio` product replay routes through `RadioEngine` (`mode=replay` / `click_radio_for_replay`); xpath then label JS — see `docs/superpowers/specs/2026-09-09-radio-record-replay-unify-design.md`.
```

- [ ] **Step 3: verify-all**

```bash
run "characterize-radio-replay-engine" "$PY" scripts/characterization/cold/characterize-radio-replay-engine.py
```

Place immediately after `characterize-select-replay-engine`.

- [ ] **Step 4: Design status + fill §8**

Radio design header: `状态：已落地（RadioEngine mode=replay）— 计划 [../plans/2026-09-09-radio-record-replay-unify.md](...)`  
Fill §8: `done: click_radio（radio unify Phase B）`

- [ ] **Step 5: Run gate**

```bash
./python/python.exe scripts/characterization/cold/characterize-radio-replay-engine.py
bash scripts/refactor/verify-all.sh
```

If Git Bash unavailable on Windows, at minimum run the radio/fill/select cold pins listed in Task 3 plus any pins that import radio symbols.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-05-engine-actions-contract.md AGENTS.md scripts/refactor/verify-all.sh docs/superpowers/specs/2026-09-09-radio-record-replay-unify-design.md docs/superpowers/specs/2026-09-09-fill-record-replay-unify-design.md docs/superpowers/agent-log.md
git commit -m "docs: Phase B radio record/replay unify close + verify-all pin"
```

---

## Spec coverage checklist

| Spec item | Task |
|---|---|
| `mode=replay` / `click_radio_for_replay` | 2 |
| xpath → BY_XPATH, else label `JS_CLICK_RADIO` | 2 |
| Replay main path no direct evaluate | 1, 3 |
| `_with_xpath_first` locate keep (O1) | 3 |
| absent skip; no stamp/task_done in replay | 2 |
| Contract §2.4 + AGENTS | 4 |
| Cold pin + verify-all | 1, 4 |
| autofill / click family / table row radio Out | — (constraint) |
| No `radio_dispatch` | — (constraint) |

## Placeholder scan

No TBD. Fallback rule for absent-vs-retry is explicit in Task 2. Pin splitter uses `select_option` as end marker (matches current file order).

## Self-review notes

- Spec R1–R4 map to Tasks 2–4.
- Tree-shaped `_with_xpath_first` matches O1 default.
- Do not register pin in verify-all before Task 3 is GREEN.
