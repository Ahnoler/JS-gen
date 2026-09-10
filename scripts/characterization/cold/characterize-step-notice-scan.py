#!/usr/bin/env python3
"""Pin lightweight per-step notice scan (no persistent business MutationObserver).

After each agent step, scan visible el-message / el-notification (+ __notify_log
cursor) and inject a short 【页面通知】cue into agent memory when new.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_feature_flag_default_on() -> None:
    from scripts.feature_flags import step_notice_scan_enabled
    import os

    os.environ.pop("AI_STEP_NOTICE_SCAN", None)
    assert_true(step_notice_scan_enabled() is True, "default on")


def test_js_snippet_pins() -> None:
    src = (
        ROOT / "scripts/controller/actions/js_snippets/step_notice.py"
    ).read_text(encoding="utf-8")
    assert_true("JS_SCAN_STEP_NOTICES" in src, "JS_SCAN_STEP_NOTICES export")
    assert_true(".el-notification" in src and ".el-message" in src, "scans toast surfaces")
    assert_true("__notify_log" in src, "reads notify log cursor")
    assert_true("successNotifs" in src or "level" in src, "classifies success/error")


def test_format_and_dedupe() -> None:
    from scripts.agent.step_notice import (
        format_notice_cue,
        notice_fingerprint,
        take_new_notices,
    )

    items = [
        {"level": "success", "text": "操作成功"},
        {"level": "error", "text": "客户名称不能为空"},
        {"level": "success", "text": "操作成功"},
    ]
    store: dict = {}
    fresh = take_new_notices(store, items)
    assert_true(len(fresh) == 2, f"dedupe to 2 got {fresh}")
    seen = store.get("_step_notice_seen") or set()
    assert_true(notice_fingerprint(items[0]) in seen, "fingerprints remembered")
    fresh2 = take_new_notices(store, items)
    assert_true(fresh2 == [], "second pass empty")
    cue = format_notice_cue(fresh)
    assert_true("【页面通知】" in cue, "cue header")
    assert_true("操作成功" in cue and "客户名称不能为空" in cue, "both texts")
    assert_true("勿 done" in cue, "error guidance present")


def test_rewind_when_notify_log_shrinks() -> None:
    """P2-toast-cursor: navigation resets __notify_log → must rewind cursor + clear seen."""
    from scripts.agent.step_notice import rewind_notify_cursor_if_shrunk

    store = {
        "_step_notice_log_cursor": 12,
        "_step_notice_seen": {"success|旧页成功"},
    }
    assert_true(
        rewind_notify_cursor_if_shrunk(store, 3) is True,
        "log_len < cursor → rewind",
    )
    assert_true(store.get("_step_notice_log_cursor") == 0, "cursor reset to 0")
    assert_true("_step_notice_seen" not in store, "seen cleared on rewind")
    store2 = {"_step_notice_log_cursor": 5}
    assert_true(
        rewind_notify_cursor_if_shrunk(store2, 5) is False,
        "equal length → no rewind",
    )
    assert_true(store2.get("_step_notice_log_cursor") == 5, "cursor unchanged")
    assert_true(
        rewind_notify_cursor_if_shrunk(store2, 8) is False,
        "log grew → no rewind",
    )


def test_scan_source_rewinds_before_advancing_cursor() -> None:
    src = (ROOT / "scripts/agent/step_notice.py").read_text(encoding="utf-8")
    assert_true("rewind_notify_cursor_if_shrunk" in src, "helper wired")
    # After shrink, must re-evaluate with cursor 0 (not keep stale slice).
    assert_true(
        "JS_SCAN_STEP_NOTICES" in src and "rewind_notify_cursor_if_shrunk" in src,
        "scan path references rewind",
    )
    idx = src.find("async def scan_and_emit_step_notices")
    body = src[idx : idx + 2200]
    assert_true(
        "rewind_notify_cursor_if_shrunk" in body,
        "scan_and_emit calls rewind helper",
    )


def test_recorder_wires_step_end() -> None:
    rec = (ROOT / "scripts/recorder.py").read_text(encoding="utf-8")
    assert_true("_emit_step_notice_scan" in rec, "recorder imports/calls step notice")
    emitters = (ROOT / "scripts/agent/recorder_emitters.py").read_text(encoding="utf-8")
    assert_true(
        "async def _emit_step_notice_scan" in emitters
        or "_emit_step_notice_scan" in emitters,
        "emitter defines step notice",
    )


def test_reexport_js() -> None:
    js = (ROOT / "scripts/controller/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true("JS_SCAN_STEP_NOTICES" in js, "_js_snippets re-exports")


def main() -> int:
    test_feature_flag_default_on()
    test_js_snippet_pins()
    test_format_and_dedupe()
    test_rewind_when_notify_log_shrinks()
    test_scan_source_rewinds_before_advancing_cursor()
    test_recorder_wires_step_end()
    test_reexport_js()
    print("characterize-step-notice-scan: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
