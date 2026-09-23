# Recording Step Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each recording step, store new page feedback in the session and show it to the model as `[step-feedback]`, without writing it onto the trajectory.

**Architecture:** A pure Python module owns clipping, history, and the cue string. The existing per-step scan calls it, and adds form errors, new dialogs, and an API error sentence only when the page showed nothing. Two old read actions are unregistered. `close_notification` only closes. `read_step_feedback` reads the session list and does not touch the page.

**Tech Stack:** Python characterization pins, browser-use `@controller.action`, existing `JS_XHR_HOOK` / `JS_SCAN_STEP_NOTICES`. No new table. No migration.

## Global Constraints

- Feedback lives in `business_data_store` for the current recording only. Do not write `trajectory_step`, `trajectory_phase.done_logs`, `trajectory.trajectory_log`, `trajectory.failed_reason`, `page_errors_json`, or `block_reasons`.
- Do not change step coalesce in `scripts/state.py` `_record_action`. Do not change `done` judgment. Do not change `record_status` because a page error appeared. Do not auto-close notifications.
- Text cap is 200 characters per toast, form error, dialog title, and API error sentence.
- API item is only the error sentence. No path, status code, or response body. Omit it when this step already has a new toast or a new form error. Omit it when the body has no error sentence.
- Cue prefix is exactly `[step-feedback]`. Do not inject a line when there is nothing new.
- `read_step_feedback` does not call `page.evaluate` and does not scan the DOM.
- `read_error_notify` and `read_xhr_log` are not registered actions. Leave `js_snippets/error_notify.py` and `js_snippets/xhr_log.py` on disk (`characterize-semantic-fixes.py` still pins the snippet strings).
- `close_notification` returns `ok-closed` or `no-notification` and the return value does not contain the notification text.
- Flag `AI_STEP_NOTICE_SCAN` stays default-on. When off: no scan, no cue, no history.
- History keeps the latest 40 steps that had feedback. `read_step_feedback` default `last` is 5.
- Do not edit `scripts/characterization/fixtures/kb-coverage.v1.json`.
- Do not edit `docs/superpowers/specs/2026-09-22-telemetry-to-component-draft-design.md`.
- Before editing `scripts/recorder.py`, `scripts/session_runner.py`, or `scripts/agent/service.py`, re-read `docs/superpowers/agent-log.md`. If another open declaration lists those files, stop.
- Commit messages in Chinese: first line says what changed and why.

---

### Task 1: Session feedback model

**Files:**
- Create: `scripts/agent/step_feedback.py`
- Create: `scripts/characterization/cold/characterize-step-feedback.py`
- Modify: `scripts/refactor/verify-all.sh` (the `PINS_UI` block, next to `characterize-step-notice-scan`)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `TEXT_MAX = 200`, `HISTORY_MAX = 40`
  - `clip_text(value) -> str`
  - `business_action_names(raw_actions) -> list[str]`
  - `format_step_feedback_cue(actions: list[str], items: list[dict]) -> str`
  - `append_step_feedback(store: dict, step: int, actions: list[str], items: list[dict]) -> None`
  - `read_step_feedback_rows(store: dict, last: int = 5) -> list[dict]`
  - `omit_api_if_ui(items: list[dict]) -> list[dict]`
  - `extract_api_error_text(body: str, status: int | None) -> str` empty when there is no error sentence

- [ ] **Step 1: Write the failing pin**

Create `scripts/characterization/cold/characterize-step-feedback.py`:

```python
"""Pin session step-feedback: clip, cue, history, api-vs-ui. No browser."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    from scripts.agent.step_feedback import (
        append_step_feedback,
        business_action_names,
        clip_text,
        extract_api_error_text,
        format_step_feedback_cue,
        omit_api_if_ui,
        read_step_feedback_rows,
    )

    assert_true(len(clip_text("错" * 250)) == 200, "clip 200")
    assert_true(clip_text("  a\nb  ") == "a b", "collapse space")

    names = business_action_names([
        {"click_save": {"button_text": "保存"}, "done": None},
        {"read_step_feedback": {"last": 5}},
    ])
    assert_true(names == ["click_save"], f"names {names}")

    items = [
        {"kind": "toast", "level": "error", "text": "利率不能为空"},
        {"kind": "form", "label": "利率", "text": "不能为空"},
        {"kind": "dialog", "surface": "dialog", "text": "流程选人"},
        {"kind": "api", "text": "不应出现"},
    ]
    kept = omit_api_if_ui(items)
    assert_true(all(it["kind"] != "api" for it in kept), "drop api when ui present")
    assert_true(len(omit_api_if_ui([{"kind": "api", "text": "闸门拒绝"}])) == 1, "keep api alone")

    cue = format_step_feedback_cue(["click_save"], kept)
    assert_true(cue.startswith("[step-feedback] click_save | "), cue)
    assert_true("toast:err:利率不能为空" in cue, cue)
    assert_true("form:利率:不能为空" in cue, cue)
    assert_true("dialog:流程选人" in cue, cue)
    assert_true("【页面通知】" not in cue, cue)
    assert_true(format_step_feedback_cue(["click_save"], []) == "", "empty cue")

    store: dict = {}
    append_step_feedback(store, 3, ["click_save"], [{"kind": "toast", "level": "error", "text": "x"}])
    append_step_feedback(store, 4, ["click_button"], [])
    assert_true(len(store["_step_feedback"]) == 1, "skip empty")
    for i in range(45):
        append_step_feedback(store, 100 + i, ["click_button"], [{"kind": "toast", "level": "info", "text": str(i)}])
    assert_true(len(store["_step_feedback"]) == 40, "cap 40")
    rows = read_step_feedback_rows(store, 5)
    assert_true(len(rows) == 5, "last 5")
    assert_true(read_step_feedback_rows({}, 5) == [], "missing store")

    assert_true(extract_api_error_text('{"code":100,"description":"证件重复"}', 200) == "证件重复", "biz text")
    assert_true(extract_api_error_text('{"code":200,"description":"操作成功"}', 200) == "", "success ignored")
    assert_true(extract_api_error_text("not-json", 500) == "", "no sentence")
    assert_true("http" not in extract_api_error_text('{"code":100,"description":"证件重复","url":"/x"}', 400), "no url")
    print("characterize-step-feedback: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the pin and confirm it fails**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: FAIL with `ModuleNotFoundError` for `scripts.agent.step_feedback`.

- [ ] **Step 3: Implement the module**

Create `scripts/agent/step_feedback.py`:

```python
"""Session-only record of page feedback produced by one agent step."""
from __future__ import annotations

import json
import re

TEXT_MAX = 200
HISTORY_MAX = 40
_STORE_KEY = "_step_feedback"

_OBSERVE_ACTIONS = frozenset({
    "semantic_snapshot",
    "read_error_notify",
    "read_xhr_log",
    "read_step_feedback",
    "read_business_date",
    "kb_flow",
    "verify_context",
    "get_page_state",
    "scan_form_fields",
    "scan_visible_fields",
    "scan_editable_summary",
    "done",
})

_WS = re.compile(r"\s+")


def clip_text(value) -> str:
    text = _WS.sub(" ", str(value or "")).strip()
    return text[:TEXT_MAX]


def business_action_names(raw_actions) -> list[str]:
    names: list[str] = []
    for raw in raw_actions or []:
        data = raw
        if hasattr(raw, "model_dump"):
            data = raw.model_dump()
        elif hasattr(raw, "dict"):
            data = raw.dict()
        if not isinstance(data, dict):
            continue
        for key, val in data.items():
            if val is None:
                continue
            if key not in _OBSERVE_ACTIONS:
                names.append(str(key))
            break
    return names


def omit_api_if_ui(items: list[dict]) -> list[dict]:
    has_ui = any(it.get("kind") in ("toast", "form") for it in items or [])
    if not has_ui:
        return list(items or [])
    return [it for it in items if it.get("kind") != "api"]


def format_step_feedback_cue(actions: list[str], items: list[dict]) -> str:
    if not items:
        return ""
    head = actions[-1] if actions else "step"
    parts: list[str] = []
    for it in items[:8]:
        kind = it.get("kind")
        text = clip_text(it.get("text"))
        if not text:
            continue
        if kind == "toast":
            level = {"error": "err", "success": "ok"}.get(str(it.get("level") or ""), "info")
            parts.append(f"toast:{level}:{text}")
        elif kind == "form":
            parts.append(f"form:{clip_text(it.get('label'))}:{text}")
        elif kind == "dialog":
            surface = it.get("surface") if it.get("surface") in ("dialog", "drawer") else "dialog"
            parts.append(f"{surface}:{text}")
        elif kind == "api":
            parts.append(f"api:{text}")
    if not parts:
        return ""
    return f"[step-feedback] {head} | " + "；".join(parts)


def append_step_feedback(store: dict, step: int, actions: list[str], items: list[dict]) -> None:
    if store is None or not items:
        return
    rows = store.setdefault(_STORE_KEY, [])
    rows.append({
        "step": int(step),
        "actions": list(actions),
        "items": list(items),
    })
    if len(rows) > HISTORY_MAX:
        del rows[:-HISTORY_MAX]


def read_step_feedback_rows(store: dict | None, last: int = 5) -> list[dict]:
    rows = []
    if isinstance(store, dict):
        raw = store.get(_STORE_KEY)
        if isinstance(raw, list):
            rows = raw
    try:
        n = int(last)
    except (TypeError, ValueError):
        n = 5
    if n < 1:
        n = 1
    return list(rows[-n:])


def extract_api_error_text(body: str, status: int | None) -> str:
    try:
        payload = json.loads(body) if body else None
    except (TypeError, ValueError):
        payload = None
    if not isinstance(payload, dict):
        return ""
    code = payload.get("code")
    biz_fail = code is not None and str(code) not in ("0", "200") and code not in (0, 200)
    http_fail = isinstance(status, int) and (status < 200 or status >= 400)
    if not biz_fail and not http_fail:
        return ""
    for key in ("description", "message", "msg", "error"):
        text = clip_text(payload.get(key))
        if text:
            return text
    return ""
```

Register the pin in `scripts/refactor/verify-all.sh` inside `PINS_UI`, on the line after `characterize-step-notice-scan`:

```
characterize-step-feedback|"$PY" scripts/characterization/cold/characterize-step-feedback.py
```

- [ ] **Step 4: Run the pin**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: `characterize-step-feedback: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/step_feedback.py scripts/characterization/cold/characterize-step-feedback.py scripts/refactor/verify-all.sh
git commit -m "feat: 会话内本步反馈的裁剪、历史和提示行"
```

---

### Task 2: Scan forms, dialogs, and replace the cue

**Files:**
- Modify: `scripts/controller/actions/js_snippets/step_notice.py`
- Modify: `scripts/controller/actions/_js_snippets.py` (re-export `JS_SCAN_STEP_SURFACE`)
- Modify: `scripts/agent/step_notice.py` (`scan_and_emit_step_notices`)
- Modify: `scripts/agent/recorder_emitters.py` (`_emit_step_notice_scan`)
- Modify: `scripts/recorder.py` (the call already passes through the emitter; only change the emitter)
- Modify: `scripts/characterization/cold/characterize-step-notice-scan.py`

**Interfaces:**
- Consumes: `format_step_feedback_cue`, `append_step_feedback`, `omit_api_if_ui`, `business_action_names`, `clip_text` from Task 1
- Produces: `JS_SCAN_STEP_SURFACE` evaluated with no args, returns `{forms:[{label,text}], overlays:[{surface,text}]}`. `scan_and_emit_step_notices(agent, store, *, step: int, raw_actions)` still stamps `toast_ok` and now appends history. Signature change is the only caller update.

- [ ] **Step 1: Extend the existing notice pin so the old cue fails**

In `test_format_and_dedupe`, stop requiring `【页面通知】` and `勿 done`. After implementation the injected cue is built by `format_step_feedback_cue`, so this test should import that and assert `[step-feedback]`. Replace the cue assertions with:

```python
    from scripts.agent.step_feedback import format_step_feedback_cue
    cue = format_step_feedback_cue(
        ["click_save"],
        [
            {"kind": "toast", "level": "success", "text": "操作成功"},
            {"kind": "toast", "level": "error", "text": "客户名称不能为空"},
        ],
    )
    assert_true(cue.startswith("[step-feedback] click_save | "), cue)
    assert_true("toast:ok:操作成功" in cue and "toast:err:客户名称不能为空" in cue, cue)
    assert_true("close_notification" not in cue, cue)
```

Add a source assertion on `scripts/agent/step_notice.py` inside `scan_and_emit_step_notices`: the body contains `format_step_feedback_cue` and `append_step_feedback`, and does not contain `【页面通知】`. Assert `format_notice_cue` does not contain `close_notification`.

Add a source assertion that `JS_SCAN_STEP_SURFACE` in `js_snippets/step_notice.py` contains `.el-form-item__error`, `.el-dialog__title`, and `.el-drawer`.

- [ ] **Step 2: Run the pin and confirm it fails**

Run: `python scripts/characterization/cold/characterize-step-notice-scan.py`

Expected: FAIL on missing `[step-feedback]` or missing `JS_SCAN_STEP_SURFACE`.

- [ ] **Step 3: Add the surface snippet**

Append to `scripts/controller/actions/js_snippets/step_notice.py`:

```python
JS_SCAN_STEP_SURFACE = r'''() => {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 200);
  const visible = (el) => {
    try {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    } catch (e) { return false; }
  };
  const forms = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('.el-form-item__error')) {
    if (!visible(el)) continue;
    const text = norm(el.textContent);
    if (!text) continue;
    const item = el.closest('.el-form-item');
    const label = norm(item && item.querySelector('.el-form-item__label') && item.querySelector('.el-form-item__label').textContent);
    const key = label + '|' + text;
    if (seen.has(key)) continue;
    seen.add(key);
    forms.push({ label, text });
  }
  const overlays = [];
  for (const d of document.querySelectorAll('.el-dialog')) {
    if (!visible(d)) continue;
    const text = norm(d.querySelector('.el-dialog__title') && d.querySelector('.el-dialog__title').textContent);
    if (text) overlays.push({ surface: 'dialog', text });
  }
  for (const d of document.querySelectorAll('.el-drawer')) {
    if (!visible(d)) continue;
    const text = norm(d.getAttribute('aria-label') || (d.querySelector('.el-drawer__header') && d.querySelector('.el-drawer__header').textContent));
    if (text) overlays.push({ surface: 'drawer', text });
  }
  return { forms, overlays };
}'''
```

Re-export `JS_SCAN_STEP_SURFACE` from `scripts/controller/actions/_js_snippets.py` next to `JS_SCAN_STEP_NOTICES`.

- [ ] **Step 4: Record history and inject the new cue**

In `scan_and_emit_step_notices`, add keyword-only parameters `step: int = 0` and `raw_actions=None`. Keep the toast scan, the rewind, and the `toast_ok` stamp. Delete the `format_notice_cue` / `【页面通知】` inject.

After toasts are known, evaluate `JS_SCAN_STEP_SURFACE`. Build `items`:

- each fresh toast (existing `take_new_notices` result) → `{"kind":"toast","level": level,"text": clip_text(text)}`
- each form whose `label|text` is not in `store["_step_feedback_form_seen"]` → `{"kind":"form","label","text"}`, then add the key to that set (cap the set at 80 the same way `take_new_notices` caps fingerprints)
- each overlay whose `surface|text` is not in `store["_step_feedback_overlay_seen"]` → `{"kind":"dialog","surface","text"}`, then remember it. On rewind (`rewind_notify_cursor_if_shrunk` returns true), also clear `_step_feedback_form_seen` and `_step_feedback_overlay_seen`.

In `format_notice_cue`, replace the sentence that tells the model to call `close_notification` with: `错误文案已在 [step-feedback]。` Leave the function in place so older imports do not break. The scan path must not call it.

Call `items = omit_api_if_ui(items)` (no api items yet; Task 3 adds them before this call). Then:

```python
    actions = business_action_names(raw_actions)
    append_step_feedback(business_data_store, step, actions, items)
    cue = format_step_feedback_cue(actions, items)
    if cue:
        agent._message_manager._add_message_with_tokens(HumanMessage(content=cue))
```

Wrap the surface evaluate in the existing try/except. A failure logs `[recorder] step-feedback scan failed` and returns without raising.

Change `_emit_step_notice_scan` to:

```python
async def _emit_step_notice_scan(agent, business_data_store, step: int = 0, raw_actions=None) -> None:
    """Per-step page feedback → [step-feedback] (steering-only, session memory)."""
    try:
        from scripts.agent.step_notice import scan_and_emit_step_notices
        await scan_and_emit_step_notices(
            agent, business_data_store, step=step, raw_actions=raw_actions,
        )
    except Exception as e:
        sys.stderr.write(f'[recorder] step-notice skipped: {e}\n')
        sys.stderr.flush()
```

In `scripts/recorder.py` `on_step_end`, change the call to:

```python
            await _emit_step_notice_scan(
                agent, business_data_store,
                step=int(getattr(agent.state, 'n_steps', 0) or 0),
                raw_actions=_actions_raw,
            )
```

- [ ] **Step 5: Run both pins**

Run: `python scripts/characterization/cold/characterize-step-notice-scan.py`

Expected: `characterize-step-notice-scan: OK`

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: `characterize-step-feedback: OK`

- [ ] **Step 6: Commit**

```bash
git add scripts/controller/actions/js_snippets/step_notice.py scripts/controller/actions/_js_snippets.py scripts/agent/step_notice.py scripts/agent/recorder_emitters.py scripts/recorder.py scripts/characterization/cold/characterize-step-notice-scan.py
git commit -m "feat: 每步扫描红字和新弹层，注入 [step-feedback]"
```

---

### Task 3: API error sentence, only when the page is quiet

**Files:**
- Modify: `scripts/controller/actions/js_snippets/step_notice.py` (add `JS_TAKE_API_ERROR_TEXTS`)
- Modify: `scripts/controller/actions/_js_snippets.py` (re-export it)
- Modify: `scripts/agent/step_notice.py` (consume it before `omit_api_if_ui`)
- Modify: `scripts/session_runner.py` (install `JS_XHR_HOOK` once at session start, next to the network-capture try)
- Modify: `scripts/characterization/cold/characterize-step-feedback.py` (source pins)

**Interfaces:**
- Consumes: `extract_api_error_text` is not used in the page; the JS returns sentences only. `omit_api_if_ui` from Task 1.
- Produces: `JS_TAKE_API_ERROR_TEXTS` `(cursor) => ({ len, texts: string[] })`. Store key `_step_feedback_xhr_cursor`.

- [ ] **Step 1: Add failing source assertions**

In `characterize-step-feedback.py`, assert:

- `js_snippets/step_notice.py` contains `JS_TAKE_API_ERROR_TEXTS` and `description`, and the function does not return `responseBody` or `url` as a field name in the returned object (the snippet may read `rec.responseBody` locally). Assert the returned object literal is `{ len, texts }` by checking `return { len: log.length, texts }` is present and `responseBody:` is absent from the return.
- `scripts/session_runner.py` contains `JS_XHR_HOOK` and `add_init_script`.
- `scripts/agent/step_notice.py` contains `_step_feedback_xhr_cursor` and `omit_api_if_ui`.

- [ ] **Step 2: Run the pin and confirm it fails**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: FAIL with `MISSING` on `JS_TAKE_API_ERROR_TEXTS`.

- [ ] **Step 3: Add the snippet and install the hook**

Append to `js_snippets/step_notice.py`:

```python
JS_TAKE_API_ERROR_TEXTS = r'''(cursor) => {
  const log = Array.isArray(window.__xhr_log) ? window.__xhr_log : [];
  const start = Math.max(0, Number(cursor) || 0);
  const texts = [];
  const clip = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 200);
  for (let i = start; i < log.length; i++) {
    const rec = log[i] || {};
    const status = rec.status;
    const httpFail = typeof status === 'number' && (status < 200 || status >= 400);
    let payload = null;
    try { payload = JSON.parse(rec.responseBody || ''); } catch (e) { payload = null; }
    if (!payload || typeof payload !== 'object') continue;
    const code = payload.code;
    const bizFail = code != null && String(code) !== '0' && String(code) !== '200' && code !== 0 && code !== 200;
    if (!httpFail && !bizFail) continue;
    const text = clip(payload.description || payload.message || payload.msg || payload.error);
    if (text) texts.push(text);
  }
  return { len: log.length, texts };
}'''
```

Re-export it from `_js_snippets.py`.

In `session_runner.py`, immediately after the network-capture try/except (around the `_page_for_capture` block), add:

```python
    try:
        from scripts.controller.actions._js_snippets import JS_XHR_HOOK
        _page_for_xhr = await browser_context.get_current_page()
        if _page_for_xhr is not None:
            await _page_for_xhr.add_init_script(JS_XHR_HOOK)
            await _page_for_xhr.evaluate(JS_XHR_HOOK)
    except Exception as _xhr_err:
        sys.stderr.write(
            f"[step-feedback] xhr hook install failed (ignored): {type(_xhr_err).__name__}: {_xhr_err}\n"
        )
        sys.stderr.flush()
```

In `scan_and_emit_step_notices`, before `omit_api_if_ui`:

```python
    cursor = int(business_data_store.get("_step_feedback_xhr_cursor") or 0)
    api_raw = await page.evaluate(JS_TAKE_API_ERROR_TEXTS, cursor)
    api_data = _as_dict(api_raw)
    if int(api_data.get("len") or 0) >= cursor:
        business_data_store["_step_feedback_xhr_cursor"] = int(api_data.get("len") or 0)
    for text in api_data.get("texts") or []:
        clipped = clip_text(text)
        if clipped:
            items.append({"kind": "api", "text": clipped})
    items = omit_api_if_ui(items)
```

If `page.evaluate` throws, log and continue with the UI items already collected. Do not raise.

- [ ] **Step 4: Run the pin**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: `characterize-step-feedback: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/js_snippets/step_notice.py scripts/controller/actions/_js_snippets.py scripts/agent/step_notice.py scripts/session_runner.py scripts/characterization/cold/characterize-step-feedback.py
git commit -m "feat: 页面无提示时才记下接口错误原文"
```

---

### Task 4: Replace the read actions

**Files:**
- Modify: `scripts/controller/actions/_observe.py` (delete `read_error_notify` and `read_xhr_log`; add `read_step_feedback`)
- Modify: `src/models/meta-step-actions.js` (`ENGINEERING_STEP_ACTIONS`)
- Modify: `scripts/characterization/cold/characterize-error-notify.py`
- Modify: `scripts/characterization/cold/characterize-xhr-log.py`
- Modify: `scripts/characterization/cold/characterize-step-feedback.py`

**Interfaces:**
- Consumes: `read_step_feedback_rows(store, last) -> list[dict]` from Task 1
- Produces: controller action `read_step_feedback(last: int = 5) -> str`. Empty history returns the string `no-step-feedback`. Otherwise `json.dumps` of the rows. No `page.evaluate`, no `_record_action`.

- [ ] **Step 1: Pin the absence and the new action**

Append to `characterize-step-feedback.py` `main()`:

```python
    observe = (ROOT / "scripts/controller/actions/_observe.py").read_text(encoding="utf-8")
    assert_true("async def read_step_feedback" in observe, "action registered")
    assert_true("does not scan the page" in observe, "tool description")
    assert_true("async def read_error_notify" not in observe, "error notify gone")
    assert_true("async def read_xhr_log" not in observe, "xhr log action gone")
    body = observe.split("async def read_step_feedback", 1)[1].split("async def ", 1)[0]
    assert_true("page.evaluate" not in body and "_record_action" not in body, "no page scan")
    meta = (ROOT / "src/models/meta-step-actions.js").read_text(encoding="utf-8")
    assert_true("'read_step_feedback'" in meta, "engineering list")
    assert_true("'read_error_notify'" not in meta and "'read_xhr_log'" not in meta, "old names dropped")
```

Rewrite `characterize-error-notify.py` checks so `_observe.py` is no longer required to contain `read_error_notify`. Keep the `js_snippets/error_notify.py` needles (`JS_READ_ERROR_NOTIFY`, `异常信息`, `el-message`, `el-notification`, `errors`). Add an anti-check: `_observe.py` must not contain `async def read_error_notify`.

Rewrite `characterize-xhr-log.py` so `_observe.py` must not contain `async def read_xhr_log`. Keep the `js_snippets/xhr_log.py` needles and the `_js_snippets.py` `xhr_log` needle. Remove the prompt needles (`read_xhr_log(url_filter='NextCheck')`, `historyTraced`, `saveOrUpdate`) from this file in Task 6, not here — leave them for now so this task still passes against the current prompts.

- [ ] **Step 2: Run the pins and confirm the new assertions fail**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: FAIL because `async def read_step_feedback` is missing. If the anti-checks on the old actions fail first, the functions are still present; that is the same red.

- [ ] **Step 3: Edit the controller and the engineering list**

Delete the `read_xhr_log` and `read_error_notify` functions from `_observe.py`, including their `@controller.action` decorators. Drop unused imports `JS_XHR_RECENT` and `JS_READ_ERROR_NOTIFY` if nothing else in the file uses them. Keep `JS_XHR_HOOK` only if still referenced; after the delete it is not, so remove that import too. `JS_NOTIFY_HOOK` stays only if still used in this file; after deleting `read_error_notify` it is unused here — remove it. `step_notice.py` still imports `JS_NOTIFY_HOOK` from `_js_snippets`.

Add:

```python
    @controller.action(
        'read feedback already recorded for recent steps; does not scan the page'
    )
    async def read_step_feedback(last: int = 5):
        from scripts.agent.step_feedback import read_step_feedback_rows
        rows = read_step_feedback_rows(business_data_store, last)
        if not rows:
            return 'no-step-feedback'
        return json.dumps(rows, ensure_ascii=False)
```

`_observe.py` needs `import json` if it does not already have it.

In `ENGINEERING_STEP_ACTIONS`, remove `'read_error_notify'` and `'read_xhr_log'`. Add `'read_step_feedback'`.

- [ ] **Step 4: Run the pins**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: `characterize-step-feedback: OK`

Run: `python scripts/characterization/cold/characterize-error-notify.py`

Expected: `ok: characterize-error-notify (read_error_notify pinned)`

Run: `python scripts/characterization/cold/characterize-xhr-log.py`

Expected: `OK characterize-xhr-log`

Run: `node scripts/characterization/cold/characterize-meta-step-filter.mjs`

Expected: the script's existing OK line (it does not name the removed actions).

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/_observe.py src/models/meta-step-actions.js scripts/characterization/cold/characterize-error-notify.py scripts/characterization/cold/characterize-xhr-log.py scripts/characterization/cold/characterize-step-feedback.py
git commit -m "feat: 用 read_step_feedback 替换事后读取提示的动作"
```

---

### Task 5: close_notification only closes

**Files:**
- Modify: `scripts/controller/actions/_misc.py` (`close_notification`, about line 461)
- Modify: `scripts/characterization/cold/characterize-step-feedback.py`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `close_notification()` returns `_ok('ok-closed')` when a visible `.el-notification` was closed, otherwise the string `no-notification`. The function body does not contain `ok-notification` or `notif_text`.

- [ ] **Step 1: Pin the return contract**

```python
    misc = (ROOT / "scripts/controller/actions/_misc.py").read_text(encoding="utf-8")
    start = misc.find("async def close_notification")
    end = misc.find("async def close_dialog")
    body = misc[start:end]
    assert_true("ok-closed" in body, "closed token")
    assert_true("no-notification" in body, "empty token")
    assert_true("ok-notification" not in body, "text return removed")
    assert_true("notif_text" not in body, "text not read for return")
```

- [ ] **Step 2: Run the pin and confirm it fails**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: FAIL with `ok-notification` still present or `ok-closed` missing.

- [ ] **Step 3: Change the action**

Replace the decorator string with:

```python
    @controller.action(
        'Close the visible el-notification. Returns ok-closed, or no-notification when none is visible. Does not return the notification text.'
    )
```

Delete the `notif_text` evaluate. Keep the close-button click and the DOM-dispatch fallback. On success `return _ok('ok-closed')`. When `notif is None`, keep `return 'no-notification'`.

- [ ] **Step 4: Run the pin**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: `characterize-step-feedback: OK`

Run: `python scripts/characterization/characterize-before-close-screenshots.py`

Expected: the script's existing OK line. `close_notification` stays registered, so the screenshot skip-list pin still holds.

- [ ] **Step 5: Commit**

```bash
git add scripts/controller/actions/_misc.py scripts/characterization/cold/characterize-step-feedback.py
git commit -m "fix: close_notification 只关闭通知，不再返回文案"
```

---

### Task 6: Prompt copy

**Files:**
- Modify: `scripts/prompts/agent-tools-common.md`
- Modify: `scripts/prompts/agent-tools-form.md`
- Modify: `scripts/prompts/agent-tools-table.md`
- Modify: `scripts/prompts/agent-core.md`
- Modify: `scripts/prompts/planner-prompt.md`
- Modify: `scripts/characterization/characterize-save-section.py`
- Modify: `scripts/characterization/cold/characterize-xhr-log.py`
- Modify: `scripts/characterization/cold/characterize-step-feedback.py`

**Interfaces:**
- Consumes: cue prefix `[step-feedback]` and action name `read_step_feedback` from earlier tasks
- Produces: prompt text only

- [ ] **Step 1: Pin the copy**

In `characterize-step-feedback.py`:

```python
    common = (ROOT / "scripts/prompts/agent-tools-common.md").read_text(encoding="utf-8")
    assert_true("read_error_notify" not in common, "common dropped error notify")
    assert_true("read_xhr_log" not in common, "common dropped xhr log")
    assert_true("[step-feedback]" in common and "read_step_feedback" in common, "common points at session feedback")
    assert_true("ok-closed" in common, "close token documented")
    form = (ROOT / "scripts/prompts/agent-tools-form.md").read_text(encoding="utf-8")
    assert_true("read_xhr_log" not in form and "read_error_notify" not in form, "form prompt")
    assert_true("ok-notification" not in form, "form dropped text token")
    table = (ROOT / "scripts/prompts/agent-tools-table.md").read_text(encoding="utf-8")
    assert_true("read_error_notify" not in table, "table prompt")
    core = (ROOT / "scripts/prompts/agent-core.md").read_text(encoding="utf-8")
    assert_true("read_error_notify" not in core and "read_xhr_log" not in core, "core prompt")
    planner = (ROOT / "scripts/prompts/planner-prompt.md").read_text(encoding="utf-8")
    assert_true("ok-notification" not in planner, "planner")
    assert_true("[step-feedback]" in planner, "planner cue")
```

In `characterize-save-section.py`, remove the needle `read_xhr_log(url_filter='saveOrUpdate')`. Add needle `[step-feedback]` on `agent-tools-form.md`.

In `characterize-xhr-log.py`, remove the `agent-tools-common.md` check entirely.

- [ ] **Step 2: Run the new assertions and confirm they fail**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: FAIL because the prompts still mention `read_xhr_log` or `read_error_notify`.

- [ ] **Step 3: Replace the sentences**

`agent-tools-common.md` bullet for `close_notification` becomes:

```markdown
- close_notification() — 关闭可见的 el-notification。关掉返回 `ok-closed`，没有则返回 `no-notification`。不返回通知原文。通知挡住下一步时才关。刚发生的文案在 `[step-feedback]`；要回看更早的步骤才调用 `read_step_feedback`。
```

Delete the paragraph that starts `前端把服务端拒绝静默吞掉` and the following bullet that tells the model to call `read_xhr_log(url_filter='saveOrUpdate')`. Replace that whole block with:

```markdown
页面没有 toast、也没有校验红字、但这一步被拒绝时，错误提示原文已经写在 `[step-feedback]` 的 `api:` 段。不要去读接口。
```

`agent-tools-form.md`:

- Replace `在执行操作前若页面已有可见 el-notification，先 close_notification() 读取文本。` with `通知挡住下一步时调用 close_notification()。文案已经在 [step-feedback]，不要为了读文字去关。`
- Delete the bullets that define `"ok-notification: ..."` and that define `"no-notification"` as 不等于保存成功.
- In the save-failure list, replace `禁止仅因 close_notification→no-notification 而 done(success=true)` with `禁止把 close_notification 的 ok-closed 或 no-notification 当成保存成功`.
- Replace `先 close_notification() 读错误文本，修字段后` with `按 [step-feedback] 里的错误文案修字段后`.
- Keep the sentence that success toasts disappear in 2–3 seconds and that `click_save` polls internally. Delete the clause about slowly calling `close_notification` in the hope the toast is still there.
- Delete `保存后紧跟 read_xhr_log(url_filter='saveOrUpdate') 核对请求体关键字段（见 common）。`

`agent-tools-table.md`: in the `introduce_guarantor` bullet, replace `确认 → read_error_notify` with `确认。拒绝文案看 [step-feedback]`。

`agent-core.md`: replace `禁止仅凭 close_notification→no-notification 冒充成功` with `禁止把 close_notification 的返回当成保存成功`. Replace the bullet that says to read notifications from `get_page_state()` and then `close_dialog()` with: `错误文案以 [step-feedback] 为准。通知挡住操作时 close_notification()。不要用 get_page_state 去抓已经消失的 toast。`

`planner-prompt.md` row for `close_notification()` becomes:

```markdown
| `close_notification()` | Closes a visible el-notification. `ok-closed` or `no-notification`. Neither is save success. Error text is already in `[step-feedback]`. |
```

- [ ] **Step 4: Run the pins**

Run: `python scripts/characterization/cold/characterize-step-feedback.py`

Expected: `characterize-step-feedback: OK`

Run: `python scripts/characterization/characterize-save-section.py`

Expected: the script's existing OK line.

Run: `python scripts/characterization/cold/characterize-xhr-log.py`

Expected: `OK characterize-xhr-log`

- [ ] **Step 5: Commit**

```bash
git add scripts/prompts/agent-tools-common.md scripts/prompts/agent-tools-form.md scripts/prompts/agent-tools-table.md scripts/prompts/agent-core.md scripts/prompts/planner-prompt.md scripts/characterization/characterize-save-section.py scripts/characterization/cold/characterize-xhr-log.py scripts/characterization/cold/characterize-step-feedback.py
git commit -m "docs: 提示词改为本步反馈，不再让模型去读会消失的提示"
```

---

### Task 7: Gate

**Files:**
- Modify: none, unless a pin from Tasks 1–6 failed to register

**Interfaces:**
- Consumes: `characterize-step-feedback` registered in Task 1

- [ ] **Step 1: Run the affected pins**

Run:

```bash
python scripts/characterization/cold/characterize-step-feedback.py
python scripts/characterization/cold/characterize-step-notice-scan.py
python scripts/characterization/cold/characterize-error-notify.py
python scripts/characterization/cold/characterize-xhr-log.py
python scripts/characterization/characterize-save-section.py
python scripts/characterization/characterize-before-close-screenshots.py
node scripts/characterization/cold/characterize-meta-step-filter.mjs
```

Expected: each script prints its OK line and exits 0.

- [ ] **Step 2: Run the UI domain gate**

Run: `bash scripts/refactor/verify-all.sh ui`

Expected: `characterize-step-feedback` and `characterize-step-notice-scan` are listed and pass. On Windows, if `bash` is unavailable, run the two python pins above and record that the shell gate was not run.

- [ ] **Step 3: Commit only if Step 1 or 2 forced a fix**

If nothing changed, do not create an empty commit.
