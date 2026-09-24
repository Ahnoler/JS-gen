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
    assert_true("JS_SCAN_STEP_SURFACE" in src, "JS_SCAN_STEP_SURFACE export")
    assert_true(
        ".el-form-item__error" in src
        and ".el-dialog__title" in src
        and ".el-drawer" in src,
        "surface scan selectors",
    )


def test_format_and_dedupe() -> None:
    from scripts.agent.step_notice import notice_fingerprint, take_new_notices

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
    notice_src = (ROOT / "scripts/agent/step_notice.py").read_text(encoding="utf-8")
    fn_start = notice_src.find("def format_notice_cue")
    fn_end = notice_src.find("\nasync def", fn_start)
    fn_block = notice_src[fn_start:fn_end] if fn_start >= 0 and fn_end > fn_start else ""
    assert_true(
        fn_block and "close_notification" not in fn_block,
        "format_notice_cue must not mention close_notification",
    )
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
    body = src[idx : idx + 3200]
    assert_true(
        "rewind_notify_cursor_if_shrunk" in body,
        "scan_and_emit calls rewind helper",
    )
    assert_true("format_step_feedback_cue" in body, "scan uses step-feedback cue")
    assert_true("append_step_feedback" in body, "scan appends step-feedback history")
    assert_true("【页面通知】" not in body, "scan path dropped old header")
    assert_true("take_console_feedback" in src, "scan consumes console ring")


def test_recorder_wires_step_end() -> None:
    rec = (ROOT / "scripts/recorder.py").read_text(encoding="utf-8")
    assert_true("_emit_step_notice_scan" in rec, "recorder imports/calls step notice")
    emitters = (ROOT / "scripts/agent/recorder_emitters.py").read_text(encoding="utf-8")
    assert_true(
        "async def _emit_step_notice_scan" in emitters
        or "_emit_step_notice_scan" in emitters,
        "emitter defines step notice",
    )


def test_scan_reads_console_and_pages_rebind() -> None:
    src = (ROOT / "scripts/agent/step_notice.py").read_text(encoding="utf-8")
    idx = src.find("async def scan_and_emit_step_notices")
    body = src[idx:]
    assert_true("take_console_feedback" in body, "scan drains console buffer")
    hooks = (ROOT / "scripts/agent/page_feedback_hooks.py").read_text(encoding="utf-8")
    assert_true("pageerror" in hooks, "pageerror listener")
    assert_true("on('page'" in hooks or 'on("page"' in hooks, "new page rebind")
    assert_true("add_init_script" in hooks and "JS_XHR_HOOK" in hooks, "xhr hook rebind")
    assert_true("attach_native_dialog_accept" in hooks, "dialog accept rebind")
    assert_true("ask_dialog" in hooks, "dialog ask callback passed to new pages")
    runner = (ROOT / "scripts/session_runner.py").read_text(encoding="utf-8")
    assert_true("install_recording_page_hooks" in runner, "runner installs page hooks")
    ensure = runner.split("async def _ensure_browser_and_cdp", 1)[1].split("async def ", 1)[0]
    assert_true("_dismiss_native_js_dialogs" not in ensure, "startup must not bind always-accept")
    assert_true("ask_dialog" in runner or "_ask_native_dialog" in runner, "runner builds dialog ask")


def test_reexport_js() -> None:
    js = (ROOT / "scripts/controller/actions/_js_snippets.py").read_text(encoding="utf-8")
    assert_true("JS_SCAN_STEP_NOTICES" in js, "_js_snippets re-exports notices")
    assert_true("JS_SCAN_STEP_SURFACE" in js, "_js_snippets re-exports surface")


def main() -> int:
    test_feature_flag_default_on()
    test_js_snippet_pins()
    test_format_and_dedupe()
    test_rewind_when_notify_log_shrinks()
    test_scan_source_rewinds_before_advancing_cursor()
    test_recorder_wires_step_end()
    test_scan_reads_console_and_pages_rebind()
    test_reexport_js()
    print("characterize-step-notice-scan: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
