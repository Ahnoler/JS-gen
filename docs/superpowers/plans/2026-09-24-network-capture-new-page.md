# Network Capture New-Page Rebind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach form-related `network_capture` on every recording page (including tabs opened later) via `page_feedback_hooks`, and stop the startup-only bind on the first page.

**Architecture:** `_attach_page` calls `attach_network_capture` after console/dialog hooks. Cleanups live in a module-level list and run through `teardown_network_captures()` at session end. `session_runner` deletes its one-shot attach/`_net_cleanup` path so the first page is not double-bound. Filtering and `network_captured` event shape stay unchanged; nothing is written to `[step-feedback]`.

**Tech Stack:** Python 3, Playwright `page.on('response')`, existing characterization pins (`characterize-network-capture.mjs`, `characterize-step-notice-scan.py`).

## Global Constraints

- Recording line only. Do not change replay, Element dialog/drawer scan, or step-feedback cue formatting.
- Do not widen the form-related filter in `network_capture.py`.
- Do not write capture payloads into `[step-feedback]`.
- Do not add idempotency inside `attach_network_capture` unless a pin forces it; default dedupe is the hooks-side weak set.
- Same page must not get two `response` listeners.
- Cleanup failures must not raise out of teardown (same best-effort as today's `_net_cleanup`).
- Spec: `docs/superpowers/specs/2026-09-24-network-capture-new-page-design.md`.

---

## File structure

- Modify `scripts/agent/page_feedback_hooks.py` — call `attach_network_capture` in `_attach_page`; keep cleanups; export `teardown_network_captures`.
- Modify `scripts/session_runner.py` — remove startup attach and `_net_cleanup`; call `teardown_network_captures` before memory flush.
- Modify `scripts/characterization/characterize-network-capture.mjs` — pin hooks wiring instead of session_runner direct attach.
- Modify `scripts/characterization/cold/characterize-step-notice-scan.py` — one source pin that hooks call `attach_network_capture`.
- Do not modify `scripts/controller/actions/network_capture.py` (filter/event shape stay).

---

### Task 1: Characterization pins for hooks wiring

**Files:**
- Modify: `scripts/characterization/characterize-network-capture.mjs` (section 4)
- Modify: `scripts/characterization/cold/characterize-step-notice-scan.py` (`test_scan_reads_console_and_pages_rebind`)

**Interfaces:**
- Consumes: nothing
- Produces: failing pins that expect `attach_network_capture` / `teardown_network_captures` in hooks, and no startup `_net_cleanup` in `session_runner`

- [ ] **Step 1: Rewrite the session_runner wiring section in characterize-network-capture.mjs**

Replace the block labeled `// 4. session_runner.py source wiring` (the `sessionRunnerSrc` asserts around lines 57–67) with:

```javascript
// 4. page_feedback_hooks rebinds network capture; session_runner only tears down
const hooksSrc = readFileSync(
  path.join(ROOT, 'scripts', 'agent', 'page_feedback_hooks.py'),
  'utf8',
);
assert(
  hooksSrc.includes('attach_network_capture'),
  'page_feedback_hooks.py calls attach_network_capture',
);
assert(
  hooksSrc.includes('teardown_network_captures'),
  'page_feedback_hooks.py exports teardown_network_captures',
);
ok('page_feedback_hooks.py wires attach_network_capture + teardown');

const sessionRunnerSrc = readFileSync(
  path.join(ROOT, 'scripts', 'session_runner.py'),
  'utf8',
);
assert(
  sessionRunnerSrc.includes('teardown_network_captures'),
  'session_runner.py tears down network captures via hooks',
);
assert(
  !sessionRunnerSrc.includes('from .controller.actions.network_capture import attach_network_capture'),
  'session_runner.py must not import attach_network_capture (hooks own attach)',
);
assert(
  !sessionRunnerSrc.includes('_net_cleanup'),
  'session_runner.py must not keep _net_cleanup (moved to hooks teardown)',
);
ok('session_runner.py uses hooks teardown, not startup attach');
```

Keep sections 1–3 and 5 unchanged (dao/service/memory persist + `_normalize_url` probe).

- [ ] **Step 2: Add a source pin in characterize-step-notice-scan.py**

Inside `test_scan_reads_console_and_pages_rebind`, after the `attach_native_dialog_accept` assert, add:

```python
    assert_true("attach_network_capture" in hooks, "network capture rebind on each page")
    assert_true("teardown_network_captures" in hooks, "network capture teardown exported")
```

- [ ] **Step 3: Run pins to verify they fail**

Run:

```bash
node scripts/characterization/characterize-network-capture.mjs
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-notice-scan.py
```

Expected: FAIL — hooks missing `attach_network_capture` / `teardown_network_captures`, and/or session_runner still has the old import/`_net_cleanup`.

- [ ] **Step 4: Commit**

```bash
git add scripts/characterization/characterize-network-capture.mjs scripts/characterization/cold/characterize-step-notice-scan.py
git commit -m "test(pin): network_capture 经 page hooks 挂载与 teardown"
```

---

### Task 2: Attach capture inside `_attach_page` and export teardown

**Files:**
- Modify: `scripts/agent/page_feedback_hooks.py`

**Interfaces:**
- Consumes: `attach_network_capture(page, business_data_store=None) -> cleanup callable` from `scripts.controller.actions.network_capture`
- Produces:
  - `teardown_network_captures() -> None` — drain and call every stored cleanup, swallow exceptions
  - `_attach_page` side effect: each new target gets one `attach_network_capture` call; cleanup appended to module list

- [ ] **Step 1: Add module state and teardown**

Near the other module-level sets (after `_page_hook_tasks`), add:

```python
_network_pages: weakref.WeakSet = weakref.WeakSet()
_network_ids: set[int] = set()
_network_cleanups: list = []


def teardown_network_captures() -> None:
    """Detach every page response listener collected during the session."""
    while _network_cleanups:
        cleanup = _network_cleanups.pop()
        try:
            cleanup()
        except Exception:
            pass
```

- [ ] **Step 2: Call attach inside `_attach_page`**

In `async def _attach_page`, after the native-dialog `try/except` block and **before** the XHR `add_init_script` / `evaluate` block, insert:

```python
    try:
        from scripts.controller.actions.network_capture import attach_network_capture

        if not _seen(_network_pages, _network_ids, target):
            cleanup = attach_network_capture(target, store)
            if callable(cleanup):
                _network_cleanups.append(cleanup)
            _remember(_network_pages, _network_ids, target)
    except Exception as exc:
        sys.stderr.write(f"[network-capture] page hook failed: {exc}\n")
        sys.stderr.flush()
```

Do not change the early `return` on XHR failure — network attach already ran. Do not put capture behind `console_ok`.

- [ ] **Step 3: Update the install docstring**

Change `install_recording_page_hooks` docstring to mention network capture, e.g.:

```python
    """Install xhr, console/pageerror, dialog accept, and network capture on current and future pages."""
```

- [ ] **Step 4: Smoke-import teardown**

Run:

```bash
PYTHONUTF8=1 python -c "from scripts.agent.page_feedback_hooks import teardown_network_captures; teardown_network_captures(); print('OK')"
```

Expected: prints `OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/page_feedback_hooks.py
git commit -m "feat(hooks): 每个录制 page 复挂 network_capture 并统一 teardown"
```

---

### Task 3: Remove startup attach; call hooks teardown from session_runner

**Files:**
- Modify: `scripts/session_runner.py`

**Interfaces:**
- Consumes: `teardown_network_captures` from `scripts.agent.page_feedback_hooks`
- Produces: no direct `attach_network_capture` import; session end calls hooks teardown before `flush_memory_writer`

- [ ] **Step 1: Drop the top-level import**

Delete this line near the other controller imports:

```python
from .controller.actions.network_capture import attach_network_capture
```

- [ ] **Step 2: Remove startup attach block**

Delete the `_net_cleanup` initializer and the whole Task 9 attach block, i.e. remove:

```python
    _net_cleanup = None  # network capture detach closure (None until attached)
```

and:

```python
    # Task 9: attach passive network capture (form-related XHR/fetch → memory events).
    # Failure to attach must never break the recording session.
    try:
        _page_for_capture = await browser_context.get_current_page()
        _net_cleanup = attach_network_capture(_page_for_capture, business_data_store)
    except Exception as _net_err:
        _net_cleanup = None
        sys.stderr.write(f"[network-capture] attach failed (ignored): {type(_net_err).__name__}: {_net_err}\n")
        sys.stderr.flush()
```

Keep the later `install_recording_page_hooks(...)` call as the sole attach path. Do not move that call earlier unless a pin requires it — hooks already cover the current page list.

- [ ] **Step 3: Replace end-of-session `_net_cleanup` with hooks teardown**

Replace:

```python
    # Task 9: detach network capture listener (best effort, before memory flush)
    if _net_cleanup:
        try:
            _net_cleanup()
        except Exception:
            pass
```

with:

```python
    # Detach network capture listeners collected by page hooks (best effort, before memory flush)
    try:
        from scripts.agent.page_feedback_hooks import teardown_network_captures
        teardown_network_captures()
    except Exception:
        pass
```

Keep this **before** `flush_memory_writer(timeout=2.0)`.

- [ ] **Step 4: Run pins to verify they pass**

Run:

```bash
node scripts/characterization/characterize-network-capture.mjs
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-notice-scan.py
PYTHONUTF8=1 python scripts/characterization/cold/characterize-step-feedback.py
```

Expected: all three print OK / exit 0.

- [ ] **Step 5: Domain verify**

Run:

```bash
bash scripts/refactor/verify-all.sh kb,ui
```

Expected: exit 0 for the pins touched by this change. If an unrelated pin fails for a known environmental reason (portable Python / DB), note it in the commit body; do not weaken this feature's pins.

- [ ] **Step 6: Commit**

```bash
git add scripts/session_runner.py
git commit -m "refactor(session): network_capture 只经 page hooks 挂载，会话结束统一 teardown"
```

---

## Self-review

1. **Spec coverage:** Mount on every page including new tabs → Task 2 `_attach_page` + existing `ctx.on('page')`. Remove startup-only attach → Task 3. Cleanup at session end → Task 2 teardown + Task 3 call. No step-feedback / no filter widen / no `network_capture.py` edit → Global Constraints + File structure. Pins → Task 1 + Task 3 Step 4.
2. **Placeholders:** none — steps have concrete code and commands.
3. **Type consistency:** `teardown_network_captures` name matches across hooks, session_runner, and both pins. `attach_network_capture(target, store)` matches existing signature.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-24-network-capture-new-page.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks

**2. Inline Execution** — execute tasks in this session with checkpoints

Which approach?
