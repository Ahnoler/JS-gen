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
        {"kind": "api", "text": "证件重复"},
    ]
    kept = omit_api_if_ui(items)
    assert_true(any(it.get("text") == "证件重复" for it in kept), "keep api error beside toast")
    dropped = omit_api_if_ui([
        {"kind": "toast", "level": "success", "text": "操作成功"},
        {"kind": "api", "level": "success", "text": "操作成功"},
    ])
    assert_true(all(it.get("kind") != "api" for it in dropped), "drop success api when ui present")
    assert_true(len(omit_api_if_ui([{"kind": "api", "text": "闸门拒绝"}])) == 1, "keep api alone")

    cue = format_step_feedback_cue(["click_save"], kept)
    assert_true(cue.startswith("[step-feedback] click_save | "), cue)
    assert_true("toast:err:利率不能为空" in cue, cue)
    assert_true("form:利率:不能为空" in cue, cue)
    assert_true("dialog:流程选人" in cue, cue)
    assert_true("【页面通知】" not in cue, cue)
    assert_true(format_step_feedback_cue(["click_save"], []) == "", "empty cue")

    console_cue = format_step_feedback_cue(
        ["click_save"],
        [
            {"kind": "console", "level": "error", "text": "Cannot read properties of undefined"},
            {"kind": "console", "level": "pageerror", "text": "x is not defined"},
        ],
    )
    assert_true("console:err:Cannot read properties of undefined" in console_cue, console_cue)
    assert_true("console:pageerror:x is not defined" in console_cue, console_cue)
    mixed = omit_api_if_ui([
        {"kind": "toast", "level": "error", "text": "保存失败"},
        {"kind": "console", "level": "error", "text": "TypeError"},
        {"kind": "api", "text": "闸门"},
    ])
    assert_true(any(it.get("text") == "闸门" for it in mixed), "toast keeps api error")
    assert_true(any(it["kind"] == "console" for it in mixed), "console survives toast suppression")

    from scripts.agent.console_feedback import RING_MAX, push_console_line, take_console_feedback

    cstore: dict = {}
    push_console_line(cstore, level="error", text=" boom ")
    push_console_line(cstore, level="pageerror", text="长" * 250)
    rows = take_console_feedback(cstore)
    assert_true(len(rows) == 2, f"console rows {rows}")
    assert_true(rows[0] == {"kind": "console", "level": "error", "text": "boom"}, rows[0])
    assert_true(rows[1]["level"] == "pageerror" and len(rows[1]["text"]) == 200, rows[1])
    assert_true(take_console_feedback(cstore) == [], "console cursor advanced")
    for i in range(30):
        push_console_line(cstore, level="error", text=f"e{i}")
    assert_true(len(cstore["_step_console_ring"]) == RING_MAX, "ring cap 20")
    taken = take_console_feedback(cstore)
    assert_true(len(taken) == RING_MAX, f"unread window {len(taken)}")
    assert_true(taken[0]["text"] == "e10" and taken[-1]["text"] == "e29", taken)

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

    step_notice_js = (
        ROOT / "scripts/controller/actions/js_snippets/step_notice.py"
    ).read_text(encoding="utf-8")
    assert_true("JS_TAKE_API_ERROR_TEXTS" in step_notice_js, "MISSING JS_TAKE_API_ERROR_TEXTS")
    assert_true("description" in step_notice_js, "MISSING description in api snippet")
    assert_true(
        "return { seq: newestSeq, len: log.length, texts }" in step_notice_js,
        "MISSING api error return shape",
    )
    xhr_hdr = "JS_TAKE_API_ERROR_TEXTS"
    xhr_snip_start = step_notice_js.find(xhr_hdr)
    q_open = step_notice_js.find("'''", xhr_snip_start + len(xhr_hdr)) if xhr_snip_start >= 0 else -1
    q_close = step_notice_js.find("'''", q_open + 3) if q_open >= 0 else -1
    xhr_snip = step_notice_js[q_open + 3 : q_close] if q_open >= 0 and q_close > q_open else ""
    assert_true("rec.seq" in xhr_snip, "MISSING seq filter in api snippet")
    assert_true("responseBody:" not in xhr_snip, "responseBody must not be returned field")
    assert_true("HTTP " in xhr_snip, "non-json http status fallback")
    _assert_non_json_http_fallback(xhr_snip)

    common_prompt = (ROOT / "scripts/prompts/agent-tools-common.md").read_text(encoding="utf-8")
    assert_true("接线中" not in common_prompt, "stale 接线中 notes")

    from scripts.agent.step_notice import rewind_xhr_cursor_if_shrunk

    xhr_store = {"_step_feedback_xhr_cursor": 55, "_step_feedback_xhr_log_len": 20}
    assert_true(
        rewind_xhr_cursor_if_shrunk(xhr_store, 8) is True,
        "xhr log shrink → rewind seq",
    )
    assert_true(xhr_store.get("_step_feedback_xhr_cursor") == 0, "xhr seq reset")
    xhr_store2 = {"_step_feedback_xhr_cursor": 10, "_step_feedback_xhr_log_len": 15}
    assert_true(
        rewind_xhr_cursor_if_shrunk(xhr_store2, 20) is False,
        "xhr log grew → no rewind",
    )

    runner_src = (ROOT / "scripts/session_runner.py").read_text(encoding="utf-8")
    assert_true("install_recording_page_hooks" in runner_src, "runner installs page hooks")
    hooks_src = (ROOT / "scripts/agent/page_feedback_hooks.py").read_text(encoding="utf-8")
    assert_true("JS_XHR_HOOK" in hooks_src, "MISSING JS_XHR_HOOK")
    assert_true("add_init_script" in hooks_src, "MISSING add_init_script for xhr hook")
    assert_true("pageerror" in hooks_src, "MISSING pageerror listener")
    assert_true("on('page'" in hooks_src, "MISSING new-page rebind")

    agent_notice_src = (ROOT / "scripts/agent/step_notice.py").read_text(encoding="utf-8")
    assert_true("_step_feedback_xhr_cursor" in agent_notice_src, "MISSING xhr cursor store key")
    assert_true("omit_api_if_ui" in agent_notice_src, "MISSING omit_api_if_ui in scan")

    observe = (ROOT / "scripts/controller/actions/_observe.py").read_text(encoding="utf-8")
    assert_true("async def read_step_feedback" in observe, "action registered")
    assert_true("does not scan the page" in observe, "tool description")
    assert_true("async def read_error_notify" not in observe, "error notify stays gone")
    assert_true("async def read_xhr_log" not in observe, "xhr log action stays gone")
    assert_true("answer_dialog" not in observe, "no answer_dialog action")
    body = observe.split("async def read_step_feedback", 1)[1].split("async def ", 1)[0]
    assert_true("page.evaluate" not in body and "_record_action" not in body, "no page scan")
    meta = (ROOT / "src/models/meta-step-actions.js").read_text(encoding="utf-8")
    assert_true("'read_step_feedback'" in meta, "engineering list")
    assert_true("'read_error_notify'" not in meta and "'read_xhr_log'" not in meta, "old names dropped")

    service_src = (ROOT / "scripts/controller/service.py").read_text(encoding="utf-8")
    assert_true(
        "_register_observe_actions(controller, browser_context, business_data_store)" in service_src,
        "observe actions must receive business_data_store",
    )

    misc = (ROOT / "scripts/controller/actions/_misc.py").read_text(encoding="utf-8")
    start = misc.find("async def close_notification")
    end = misc.find("async def close_dialog")
    body = misc[start:end]
    assert_true("return _ok('ok-closed')" in body, "closed token")
    assert_true("no-notification" in body, "empty token")
    assert_true("ok-notification" not in body, "text return removed")
    assert_true("notif_text" not in body, "text not read for return")

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

    test_native_dialog_parse_and_cue()
    test_apply_native_dialog()

    print("characterize-step-feedback: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
def _assert_non_json_http_fallback(xhr_snip: str) -> None:
    """503 HTML must become HTTP status text; JSON business errors stay."""
    import subprocess
    import tempfile

    probe = (
        "const fn = " + xhr_snip + ";\n"
        "global.window = { __xhr_log: [\n"
        "  { seq: 1, status: 503, url: 'https://sut.example/api/save?x=1', responseBody: '<html>unavailable</html>' },\n"
        "  { seq: 2, status: 200, url: 'https://sut.example/api/ok', responseBody: JSON.stringify({ code: 100, description: '证件重复' }) },\n"
        "  { seq: 3, status: 200, url: 'https://sut.example/api/html', responseBody: '<html>ok</html>' },\n"
        "] };\n"
        "const out = fn(0);\n"
        "const texts = out.texts || [];\n"
        "const hit = texts.some(t => t.indexOf('HTTP 503') === 0 && t.indexOf('/api/save') >= 0);\n"
        "if (!hit) { console.error('missing 503 fallback ' + JSON.stringify(out)); process.exit(1); }\n"
        "if (texts.indexOf('证件重复') < 0) { console.error('missing biz text ' + JSON.stringify(out)); process.exit(1); }\n"
        "if (texts.some(t => String(t).indexOf('HTTP 200') === 0)) { console.error('200 html must stay quiet ' + JSON.stringify(out)); process.exit(1); }\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(probe)
        path = fh.name
    proc = subprocess.run(["node", path], capture_output=True, text=True, encoding="utf-8")
    assert_true(proc.returncode == 0, (proc.stderr or proc.stdout or "node probe failed").strip())
