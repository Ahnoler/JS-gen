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

    step_notice_js = (
        ROOT / "scripts/controller/actions/js_snippets/step_notice.py"
    ).read_text(encoding="utf-8")
    assert_true("JS_TAKE_API_ERROR_TEXTS" in step_notice_js, "MISSING JS_TAKE_API_ERROR_TEXTS")
    assert_true("description" in step_notice_js, "MISSING description in api snippet")
    assert_true(
        "return { len: log.length, texts }" in step_notice_js,
        "MISSING api error return shape",
    )
    xhr_snip_start = step_notice_js.find("JS_TAKE_API_ERROR_TEXTS")
    xhr_snip_end = step_notice_js.find("'''", xhr_snip_start + 1)
    xhr_snip = step_notice_js[xhr_snip_start:xhr_snip_end] if xhr_snip_start >= 0 else ""
    assert_true("responseBody:" not in xhr_snip, "responseBody must not be returned field")

    runner_src = (ROOT / "scripts/session_runner.py").read_text(encoding="utf-8")
    assert_true("JS_XHR_HOOK" in runner_src, "MISSING JS_XHR_HOOK in session_runner")
    assert_true("add_init_script" in runner_src, "MISSING add_init_script for xhr hook")

    agent_notice_src = (ROOT / "scripts/agent/step_notice.py").read_text(encoding="utf-8")
    assert_true("_step_feedback_xhr_cursor" in agent_notice_src, "MISSING xhr cursor store key")
    assert_true("omit_api_if_ui" in agent_notice_src, "MISSING omit_api_if_ui in scan")

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

    service_src = (ROOT / "scripts/controller/service.py").read_text(encoding="utf-8")
    assert_true(
        "_register_observe_actions(controller, browser_context, business_data_store)" in service_src,
        "observe actions must receive business_data_store",
    )

    print("characterize-step-feedback: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
