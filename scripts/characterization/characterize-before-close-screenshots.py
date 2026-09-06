#!/usr/bin/env python3
"""Characterize 关键状态前置截图（session-end / before-close / close_notification）.

Source-assertion style (mirrors characterize-batch-actions.py): pins the
screenshot-before-transition wiring in scripts/state.py, scripts/session_runner.py
and scripts/controller/service.py. No browser / DB required.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.state import _SKIP_SCREENSHOT_ACTIONS, should_skip_screenshot_action  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def index_of(src: str, needle: str) -> int:
    idx = src.find(needle)
    assert_true(idx >= 0, f"missing: {needle!r}")
    return idx


def function_body(src: str, marker: str) -> str:
    """Slice the source from a function def marker to the next top-level def."""
    idx = index_of(src, marker)
    tail = src[idx:]
    m = re.search(r"\n(?=(async def |def ))", tail)
    return tail[: m.start()] if m else tail


def test_g3_close_notification_out_of_skip_list() -> None:
    assert_true(
        'close_notification' not in _SKIP_SCREENSHOT_ACTIONS,
        "close_notification removed from _SKIP_SCREENSHOT_ACTIONS",
    )
    assert_true(
        not should_skip_screenshot_action('close_notification'),
        "should_skip_screenshot_action('close_notification') is False",
    )
    state_src = read("scripts/state.py")
    assert_true(
        "'close_notification'" not in state_src[
            state_src.index('_SKIP_SCREENSHOT_ACTIONS'):
            state_src.index('_SKIP_SCREENSHOT_ACTIONS') + 600
        ],
        "skip set no longer lists close_notification",
    )


def test_g3_notification_selectors() -> None:
    body = function_body(read("scripts/state.py"), "async def capture_dialog_png_b64_from_page")
    assert_true(".el-notification:visible" in body, "selector loop includes .el-notification:visible")
    assert_true(".el-notification__title" in body, "title selector includes .el-notification__title")


def test_g1_captured_at_param() -> None:
    body = function_body(read("scripts/state.py"), "async def register_current_page_screenshot")
    assert_true("captured_at: str = 'phase-end'" in body, "captured_at param defaults to phase-end")
    assert_true("'capturedAt': captured_at" in body, "meta capturedAt uses captured_at")


def test_g1_session_end_insertion() -> None:
    src = read("scripts/session_runner.py")
    assert_true(
        "register_current_page_screenshot(browser_context, captured_at='session-end')" in src,
        "session_runner registers final shot with captured_at='session-end'",
    )
    assert_true(
        index_of(src, "register_current_page_screenshot(browser_context, captured_at='session-end')")
        < index_of(src, "await browser_context.close()"),
        "session-end shot runs before browser_context.close()",
    )
    assert_true(
        "[session-end] FAILED: " in src,
        "final shot wrapped in try/except (non-blocking, logs failure)",
    )


def test_g2_close_dialog_pre_capture() -> None:
    src = read("scripts/controller/service.py")
    func_call = index_of(src, "result = await func(*args, **kwargs)")
    pre_branch = index_of(src, "if action_name == 'close_dialog':")
    assert_true(
        pre_branch < func_call,
        "close_dialog pre-dialog branch sits in the before phase (before func call)",
    )
    assert_true(
        src.count("capture_dialog_png_b64(browser_context)") >= 2,
        "pre + post dialog capture call sites present",
    )
    assert_true(
        "pre_dialog_meta['capturedAt'] = 'before-close'" in src,
        "pre-dialog meta stamped capturedAt=before-close",
    )
    assert_true(
        "await register_popup_screenshot(" in src[:func_call],
        "pre-dialog capture registers a popup screenshot",
    )
    assert_true(
        "dialog_b64 = pre_dialog_b64" in src,
        "step screenshot dialog param reuses pre_dialog_b64",
    )
    post_branch = index_of(src, "action_name != 'close_dialog'")
    assert_true(
        post_branch > func_call,
        "post phase skips dialog capture for close_dialog",
    )


def test_verify_all_registration() -> None:
    src = read("scripts/refactor/verify-all.sh")
    assert_true(
        "characterize-before-close-screenshots" in src,
        "verify-all.sh registers characterize-before-close-screenshots",
    )


def main() -> int:
    test_g3_close_notification_out_of_skip_list()
    test_g3_notification_selectors()
    test_g1_captured_at_param()
    test_g1_session_end_insertion()
    test_g2_close_dialog_pre_capture()
    test_verify_all_registration()
    print("ok: characterization before-close-screenshots")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
