# Native Dialog Step Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During AI recording, auto-accept native `alert` and `beforeunload`, and let the recording model accept or dismiss `confirm` / `prompt` inside the blocked click, writing the outcome into `[step-feedback]`.

**Architecture:** A pure helper parses the one-line model answer, applies a fake-or-real dialog, and queues a feedback item on the session store. `scan_and_emit_step_notices` drains that queue at step end. The Playwright listener is the existing per-page hook; the startup always-accept bind is removed so the first page is not stuck with it. The model call is a tool-free `ainvoke` from inside the dialog handler, with a 20 second timeout.

**Tech Stack:** Python 3, Playwright dialog events, LangChain `HumanMessage` / `ainvoke`, existing characterization pins (`characterize-step-feedback.py`, `characterize-step-notice-scan.py`).

## Global Constraints

- Recording line only. Do not change replay, Element `el-dialog` / `el-drawer` scanning, console warning/log capture, or `network_capture` page attachment.
- Do not add an agent action. Do not restore `read_xhr_log` or `read_error_notify`.
- `alert` and `beforeunload`: do not call the model; accept immediately.
- `confirm` / `prompt`: one model question inside the blocked click. Do not defer the choice to the next agent step.
- Timeout, model exception, or unparseable answer: accept. Prompt value is the browser default, or empty if there is none. Decision text is `timeout-accepted`, not `accepted`.
- Timeout is **20 seconds** (`ASK_TIMEOUT_SEC = 20`).
- Empty dialog message is stored as `（无文案）`.
- Reply grammar, case-insensitive, first non-empty line only: `accept`, `dismiss`, or `accept:<text>`. `confirm` ignores text after the colon. `accept:` with nothing after the colon fills an empty string and does not use the default.
- Cue strings: `dialog:alert:<文案>`, `dialog:confirm:<文案> | accepted` or `| dismissed`, `dialog:prompt:<文案> | accepted:<文字>` or `| dismissed`, `dialog:beforeunload:<文案> | accepted`, and `| timeout-accepted` for the timeout path.
- Existing Element cues stay: `dialog:流程选人`, `drawer:…`.
- Native dialog items must not go through the Element overlay surface-key dedupe.
- The helper module must not import browser launch code. The factory must not build the prompt.
- Spec: `docs/superpowers/specs/2026-09-23-native-dialog-step-feedback-design.md`.

---

## File structure

- Create `scripts/agent/native_dialog.py` — parse answers, build feedback items, push/take the session buffer, apply a dialog object.
- Modify `scripts/agent/step_feedback.py` — extend `format_step_feedback_cue` for the four native surfaces.
- Modify `scripts/agent/step_notice.py` — drain the buffer inside `scan_and_emit_step_notices`.
- Modify `scripts/browser/factory.py` — `attach_native_dialog_accept` delegates to `apply_native_dialog`. `_dismiss_native_js_dialogs` stops binding a page.
- Modify `scripts/agent/page_feedback_hooks.py` — pass `ask_dialog` into every page attach, including `ctx.on('page')`.
- Modify `scripts/session_runner.py` — build the ask callback from the recording `llm`; stop calling `_dismiss_native_js_dialogs`.
- Modify `scripts/characterization/cold/characterize-step-feedback.py` — behavior tests.
- Modify `scripts/characterization/cold/characterize-step-notice-scan.py` — source pin that startup no longer auto-binds the first page.

---

### Task 1: Parse answers and format cues

**Files:**
- Create: `scripts/agent/native_dialog.py`
- Modify: `scripts/agent/step_feedback.py` (`format_step_feedback_cue`, around the `kind == "dialog"` branch)
- Test: `scripts/characterization/cold/characterize-step-feedback.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `ASK_TIMEOUT_SEC: int = 20`
  - `EMPTY_DIALOG_TEXT: str = "（无文案）"`
  - `parse_dialog_answer(raw: str) -> tuple[str, str] | None` — `("accept"|"dismiss", suffix)`
  - `dialog_display_text(message: str) -> str`
  - `native_dialog_item(dialog_type: str, message: str, decision: str, value: str = "") -> dict` with keys `kind`, `surface`, `text`, `decision`, `value`

- [ ] **Step 1: Write the failing test**

Append this function to `scripts/characterization/cold/characterize-step-feedback.py` and call it from `main()` before the final print:

```python
def test_native_dialog_parse_and_cue() -> None:
    from scripts.agent.native_dialog import (
        EMPTY_DIALOG_TEXT,
        dialog_display_text,
        native_dialog_item,
        parse_dialog_answer,
    )
    from scripts.agent.step_feedback import format_step_feedback_cue

    assert_true(parse_dialog_answer("accept") == ("accept", ""), "accept")
    assert_true(parse_dialog_answer("  DISMISS  ") == ("dismiss", ""), "case")
    assert_true(parse_dialog_answer("\n\naccept:同意") == ("accept", "同意"), "skip blank lines")
    assert_true(parse_dialog_answer("accept:") == ("accept", ""), "empty prompt value")
    assert_true(parse_dialog_answer("nope") is None, "garbage")
    assert_true(parse_dialog_answer("") is None, "empty")
    assert_true(dialog_display_text("  ") == EMPTY_DIALOG_TEXT, "blank message")
    assert_true(dialog_display_text("确认删除？") == "确认删除？", "keep message")

    cue = format_step_feedback_cue(["click_button"], [
        native_dialog_item("alert", "会话即将过期", "accepted"),
        native_dialog_item("confirm", "确认删除？", "dismissed"),
        native_dialog_item("prompt", "请输入原因", "accepted", "同意"),
        native_dialog_item("prompt", "请输入原因", "timeout-accepted", ""),
        native_dialog_item("beforeunload", "", "accepted"),
        {"kind": "dialog", "surface": "dialog", "text": "流程选人"},
        {"kind": "dialog", "surface": "drawer", "text": "引入"},
    ])
    assert_true("dialog:alert:会话即将过期" in cue, cue)
    assert_true("dialog:confirm:确认删除？ | dismissed" in cue, cue)
    assert_true("dialog:prompt:请输入原因 | accepted:同意" in cue, cue)
    assert_true("dialog:prompt:请输入原因 | timeout-accepted" in cue, cue)
    assert_true("dialog:beforeunload:（无文案） | accepted" in cue, cue)
    assert_true("dialog:流程选人" in cue and "drawer:引入" in cue, cue)
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-feedback.py
```

Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.agent.native_dialog'` (or an assertion on the cue if the import is stubbed).

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/agent/native_dialog.py`:

```python
"""Parse a native-dialog reply and build the step-feedback item."""
from __future__ import annotations

import re

from scripts.agent.step_feedback import clip_text

ASK_TIMEOUT_SEC = 20
EMPTY_DIALOG_TEXT = "（无文案）"
_ANSWER = re.compile(r"^(accept|dismiss)(?::(.*))?$", re.IGNORECASE)


def parse_dialog_answer(raw: str) -> tuple[str, str] | None:
    """Return (action, suffix) for the first non-empty line, or None."""
    for line in str(raw or "").splitlines():
        line = line.strip()
        if not line:
            continue
        match = _ANSWER.match(line)
        if not match:
            return None
        suffix = match.group(2)
        return match.group(1).lower(), "" if suffix is None else suffix
    return None


def dialog_display_text(message: str) -> str:
    """Blank messages become a visible placeholder so the cue is not dropped."""
    text = clip_text(message)
    return text or EMPTY_DIALOG_TEXT


def native_dialog_item(dialog_type: str, message: str, decision: str, value: str = "") -> dict:
    """One step-feedback row for a native browser dialog."""
    return {
        "kind": "dialog",
        "surface": str(dialog_type or "alert"),
        "text": dialog_display_text(message),
        "decision": str(decision or "accepted"),
        "value": "" if value is None else str(value),
    }
```

In `format_step_feedback_cue`, replace the `kind == "dialog"` branch with:

```python
        elif kind == "dialog":
            surface = str(it.get("surface") or "dialog")
            if surface == "alert":
                parts.append(f"dialog:alert:{text}")
            elif surface == "beforeunload":
                parts.append(f"dialog:beforeunload:{text} | {it.get('decision') or 'accepted'}")
            elif surface == "confirm":
                parts.append(f"dialog:confirm:{text} | {it.get('decision') or 'accepted'}")
            elif surface == "prompt":
                decision = str(it.get("decision") or "accepted")
                if decision == "accepted":
                    parts.append(f"dialog:prompt:{text} | accepted:{clip_text(it.get('value'))}")
                else:
                    parts.append(f"dialog:prompt:{text} | {decision}")
            else:
                surface = surface if surface in ("dialog", "drawer") else "dialog"
                parts.append(f"{surface}:{text}")
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-feedback.py
```

Expected: `characterize-step-feedback: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/native_dialog.py scripts/agent/step_feedback.py scripts/characterization/cold/characterize-step-feedback.py
git commit -m "test(record): 钉住原生弹窗回答解析和反馈文案"
```

---

### Task 2: Apply a dialog object and queue the item

**Files:**
- Modify: `scripts/agent/native_dialog.py`
- Modify: `scripts/agent/step_notice.py` (immediately after the `take_console_feedback` loop, around line 291)
- Test: `scripts/characterization/cold/characterize-step-feedback.py`

**Interfaces:**
- Consumes: `parse_dialog_answer`, `native_dialog_item`, `ASK_TIMEOUT_SEC` from Task 1
- Produces:
  - `push_native_dialog(store: dict | None, item: dict) -> None`
  - `take_native_dialogs(store: dict | None) -> list[dict]`
  - `async def apply_native_dialog(dialog, store, ask) -> None`
  - `ask` is `async (dialog_type: str, message: str, default_value: str) -> str`, or `None`

- [ ] **Step 1: Write the failing test**

Add to `characterize-step-feedback.py` and call it from `main()`:

```python
def test_apply_native_dialog() -> None:
    import asyncio
    from scripts.agent.native_dialog import apply_native_dialog, take_native_dialogs

    class FakeDialog:
        def __init__(self, dtype, message, default_value=""):
            self.type = dtype
            self.message = message
            self.default_value = default_value
            self.calls = []

        async def accept(self, text=None):
            self.calls.append(("accept", text))

        async def dismiss(self):
            self.calls.append(("dismiss", None))

    asks = []

    async def ask(dtype, message, default_value):
        asks.append((dtype, message, default_value))
        return "dismiss"

    alert = FakeDialog("alert", "会话即将过期")
    store = {}
    asyncio.run(apply_native_dialog(alert, store, ask))
    assert_true(alert.calls == [("accept", None)], alert.calls)
    assert_true(asks == [], "alert must not ask")
    rows = take_native_dialogs(store)
    assert_true(rows[0]["surface"] == "alert" and rows[0]["text"] == "会话即将过期", rows)
    assert_true(take_native_dialogs(store) == [], "drain once")

    leaving = FakeDialog("beforeunload", "")
    asyncio.run(apply_native_dialog(leaving, store, ask))
    assert_true(leaving.calls == [("accept", None)], leaving.calls)
    assert_true(asks == [], "beforeunload must not ask")
    assert_true(take_native_dialogs(store)[0]["surface"] == "beforeunload", store)

    confirm = FakeDialog("confirm", "确认删除？")
    asyncio.run(apply_native_dialog(confirm, store, ask))
    assert_true(confirm.calls == [("dismiss", None)], confirm.calls)
    assert_true(take_native_dialogs(store)[0]["decision"] == "dismissed", store)

    async def accept_prompt(dtype, message, default_value):
        return "accept:同意"

    prompt = FakeDialog("prompt", "请输入原因", "默认")
    asyncio.run(apply_native_dialog(prompt, store, accept_prompt))
    assert_true(prompt.calls == [("accept", "同意")], prompt.calls)

    async def accept_empty(dtype, message, default_value):
        return "accept:"

    blank = FakeDialog("prompt", "请输入原因", "默认")
    asyncio.run(apply_native_dialog(blank, store, accept_empty))
    assert_true(blank.calls == [("accept", "")], blank.calls)

    async def boom(dtype, message, default_value):
        raise RuntimeError("down")

    timed = FakeDialog("prompt", "请输入原因", "默认")
    asyncio.run(apply_native_dialog(timed, store, boom))
    assert_true(timed.calls == [("accept", "默认")], timed.calls)
    last = take_native_dialogs(store)[-1]
    assert_true(last["decision"] == "timeout-accepted", last)

    src = (ROOT / "scripts/agent/step_notice.py").read_text(encoding="utf-8")
    body = src[src.find("async def scan_and_emit_step_notices"):]
    assert_true("take_native_dialogs" in body, "scan drains native dialogs")
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-feedback.py
```

Expected: FAIL with `ImportError` for `apply_native_dialog` or `take_native_dialogs`.

- [ ] **Step 3: Write the minimal implementation**

Add to `scripts/agent/native_dialog.py`:

```python
import asyncio

_PENDING = "_native_dialog_pending"


def push_native_dialog(store: dict | None, item: dict) -> None:
    if not isinstance(store, dict) or not item:
        return
    store.setdefault(_PENDING, []).append(item)


def take_native_dialogs(store: dict | None) -> list[dict]:
    if not isinstance(store, dict):
        return []
    rows = list(store.get(_PENDING) or [])
    store[_PENDING] = []
    return rows


async def apply_native_dialog(dialog, store, ask) -> None:
    """Accept, dismiss, or timeout-accept one Playwright dialog and queue feedback."""
    dtype = str(getattr(dialog, "type", "") or "")
    raw_message = str(getattr(dialog, "message", "") or "")
    default_value = str(getattr(dialog, "default_value", "") or "")
    if dtype in ("alert", "beforeunload"):
        await dialog.accept()
        push_native_dialog(store, native_dialog_item(dtype, raw_message, "accepted"))
        return
    if dtype not in ("confirm", "prompt"):
        await dialog.accept()
        push_native_dialog(store, native_dialog_item(dtype or "alert", raw_message, "accepted"))
        return
    try:
        if ask is None:
            raise TimeoutError("no dialog ask callback")
        raw = await asyncio.wait_for(
            ask(dtype, raw_message, default_value),
            timeout=ASK_TIMEOUT_SEC,
        )
        parsed = parse_dialog_answer(raw)
        if parsed is None:
            raise ValueError("unparsed dialog answer")
        action, suffix = parsed
        if action == "dismiss":
            await dialog.dismiss()
            push_native_dialog(store, native_dialog_item(dtype, raw_message, "dismissed"))
            return
        if dtype == "prompt":
            await dialog.accept(suffix)
            push_native_dialog(
                store, native_dialog_item(dtype, raw_message, "accepted", suffix)
            )
            return
        await dialog.accept()
        push_native_dialog(store, native_dialog_item(dtype, raw_message, "accepted"))
    except Exception:
        if dtype == "prompt":
            await dialog.accept(default_value)
        else:
            await dialog.accept()
        push_native_dialog(store, native_dialog_item(dtype, raw_message, "timeout-accepted"))
```

In `scan_and_emit_step_notices`, immediately after the `take_console_feedback` loop and its `except`, add:

```python
    try:
        from scripts.agent.native_dialog import take_native_dialogs
        for row in take_native_dialogs(business_data_store):
            feedback_items.append(row)
    except Exception as e:
        sys.stderr.write(f"[recorder] step-feedback native dialog scan failed: {e}\n")
        sys.stderr.flush()
```

Do not append these rows inside the Element overlay `_take_new_surface_keys` loop.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-feedback.py
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-notice-scan.py
```

Expected: both print `OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/native_dialog.py scripts/agent/step_notice.py scripts/characterization/cold/characterize-step-feedback.py
git commit -m "feat(record): 按模型回答关闭原生弹窗并写入逐步反馈"
```

---

### Task 3: Bind the handler on every page and drop startup auto-accept

**Files:**
- Modify: `scripts/browser/factory.py` (`attach_native_dialog_accept` around line 378, `_dismiss_native_js_dialogs` around line 419)
- Modify: `scripts/agent/page_feedback_hooks.py` (`_attach_page` around line 71, `install_recording_page_hooks` around line 95, both `_attach_page` call sites)
- Modify: `scripts/session_runner.py` (import and call at lines 36 and 244; `install_recording_page_hooks` call around line 373)
- Test: `scripts/characterization/cold/characterize-step-notice-scan.py`
- Test: `scripts/characterization/cold/characterize-step-feedback.py`

**Interfaces:**
- Consumes: `apply_native_dialog` from Task 2
- Produces:
  - `attach_native_dialog_accept(page, store=None, ask=None) -> None` (name kept; the notice-scan pin matches this string)
  - `install_recording_page_hooks(browser_context, business_data_store=None, ask_dialog=None)`
  - `session_runner._ensure_browser_and_cdp` no longer calls `_dismiss_native_js_dialogs`
  - `run_session` passes an ask callback closed over `llm`

- [ ] **Step 1: Write the failing test**

In `test_scan_reads_console_and_pages_rebind`, keep the existing `attach_native_dialog_accept` assertion and add:

```python
    assert_true("ask_dialog" in hooks, "dialog ask callback passed to new pages")
    ensure = runner.split("async def _ensure_browser_and_cdp", 1)[1].split("async def ", 1)[0]
    assert_true("_dismiss_native_js_dialogs" not in ensure, "startup must not bind always-accept")
    assert_true("ask_dialog" in runner or "_ask_native_dialog" in runner, "runner builds dialog ask")
```

In `characterize-step-feedback.py` `main()`, after the read of `_observe.py` that already asserts the deleted actions, add:

```python
    assert_true("async def read_error_notify" not in observe, "error notify stays gone")
    assert_true("async def read_xhr_log" not in observe, "xhr log action stays gone")
    assert_true("answer_dialog" not in observe, "no answer_dialog action")
```

The first two lines already exist. Add only the `answer_dialog` line if it is not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-notice-scan.py
```

Expected: FAIL with `dialog ask callback passed to new pages` or `startup must not bind always-accept`.

- [ ] **Step 3: Write the minimal implementation**

Replace the body of `attach_native_dialog_accept` so the handler calls the helper. Keep the idempotent page set and the strong task ref. Signature:

```python
def attach_native_dialog_accept(page, store=None, ask=None) -> None:
    """Handle one page's native dialogs. A second call on the same page is a no-op."""
```

Inside `_on_dialog`:

```python
        async def _on_dialog(dialog):
            try:
                from scripts.agent.native_dialog import apply_native_dialog
                await apply_native_dialog(dialog, store, ask)
            except Exception as exc:
                sys.stderr.write(f'WARN: native dialog handling failed: {exc}\n')
                sys.stderr.flush()
                try:
                    await dialog.accept()
                except Exception:
                    pass
```

Change `_dismiss_native_js_dialogs` so it does not call `attach_native_dialog_accept`. Leave the function in place because `session_runner` re-exports it. Body:

```python
async def _dismiss_native_js_dialogs(browser_context) -> None:
    """Deprecated. Native dialogs are bound by install_recording_page_hooks."""
    return None
```

Delete the call `await _dismiss_native_js_dialogs(browser_context)` from `_ensure_browser_and_cdp` (line 244). Keep the import so the re-export remains.

Change `_attach_page` to accept `ask` and pass it:

```python
async def _attach_page(page, xhr_hook: str, store, ask=None) -> None:
```

```python
        attach_native_dialog_accept(target, store, ask)
```

Change `install_recording_page_hooks(browser_context, business_data_store=None, ask_dialog=None)`.

Both call sites (`ctx.on('page')` and the existing-pages loop) must pass `ask_dialog`:

```python
_attach_page(new_page, JS_XHR_HOOK, business_data_store, ask_dialog)
```

```python
await _attach_page(page, JS_XHR_HOOK, business_data_store, ask_dialog)
```

In `run_session`, define this next to the hook install and pass it. `llm` already exists:

```python
    async def _ask_native_dialog(dialog_type, message, default_value):
        from langchain_core.messages import HumanMessage
        prompt = (
            "Native browser dialog is blocking the page. "
            "Reply with one line only: accept, dismiss, or accept:<text>.\n"
            f"type: {dialog_type}\n"
            f"message: {message}\n"
            f"default: {default_value}\n"
        )
        result = await llm.ainvoke([HumanMessage(content=prompt)])
        content = getattr(result, "content", result)
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict):
                    parts.append(str(part.get("text", "")))
                else:
                    parts.append(str(part))
            content = "".join(parts)
        return str(content)

    await install_recording_page_hooks(
        browser_context, business_data_store, _ask_native_dialog
    )
```

Do not give this call tools or the agent message history.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-notice-scan.py
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-feedback.py
```

Expected: both print `OK`.

Then the ui domain, which also runs these pins:

```bash
PYTHONUTF8=1 PYTHON_EXE="<project python>" bash scripts/refactor/verify-all.sh ui
```

Expected: `characterize-step-notice-scan` and `characterize-step-feedback` OK. `characterize-layer-tree` and `characterize-step-highlight` may fail with MySQL `Access denied` when `DB_PASS` is unset. That failure is environmental. Any other new failure in this diff must be fixed before the commit.

- [ ] **Step 5: Commit**

```bash
git add scripts/browser/factory.py scripts/agent/page_feedback_hooks.py scripts/session_runner.py scripts/characterization/cold/characterize-step-notice-scan.py scripts/characterization/cold/characterize-step-feedback.py
git commit -m "fix(record): 录制启动不再抢先自动接受原生弹窗"
```
