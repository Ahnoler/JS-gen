#!/usr/bin/env python3
"""Characterization: recorder phase reset (done-guard rejects / save-key cleanup / emitter runId).

Pins three 2026-09-08 fixes:
1. recorder_emitters._guard_done_on_step_end reject branches must `return True`
   (bare `return` made the recorder.py caller guard dead code — rejected done()
   kept executing on_step_end's tail).
2. clear_phase_intent must drop the three save keys (_last_save_ok /
   _success_tokens / _url_before_save) so stale save_ok cannot leak into the
   next phase's first done().
3. state.py emitters (action_log_sync / step_screenshot / page_level_screenshot)
   must attach the current runId (flat key, omitted when None for legacy compat)
   so Node-side runId ownership filtering takes effect.
"""
from __future__ import annotations
import re
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_OK = 0


def assert_true(cond: bool, msg: str) -> None:
    global _OK
    if not cond:
        raise AssertionError(msg)
    _OK += 1


def _fn_src(text: str, header: str) -> str:
    """Extract a function source segment: header line → next top-level def."""
    start = text.find(header)
    if start < 0:
        return ""
    candidates = [
        x for x in (
            text.find("\ndef ", start + len(header)),
            text.find("\nasync def ", start + len(header)),
        )
        if x > 0
    ]
    end = min(candidates) if candidates else len(text)
    return text[start:end]


def test_guard_done_rejects_return_true() -> None:
    src = (ROOT / "scripts/agent/recorder_emitters.py").read_text(encoding="utf-8")
    seg = _fn_src(src, "async def _guard_done_on_step_end")
    assert_true(bool(seg), "_guard_done_on_step_end present")
    branches = re.findall(r"if _guard_done_reject_\w+\(", seg)
    assert_true(len(branches) >= 5, f"reject branches >= 5, got {len(branches)}")
    followed = re.findall(r"if _guard_done_reject_\w+\([^)]*\):\s*return True", seg)
    assert_true(
        len(followed) == len(branches),
        f"every reject branch returns True: {len(followed)}/{len(branches)}",
    )
    assert_true(
        re.search(r"^\s*return\s*$", seg, re.M) is None,
        "no bare `return` left in _guard_done_on_step_end",
    )
    # Tail / happy path unchanged: still falls through to accept + persist + return False.
    assert_true("return False" in seg, "tail return False kept")
    assert_true("_guard_done_accept_success(" in seg, "accept_success still wired")
    assert_true("_guard_done_persist_outcome(" in seg, "persist_outcome still wired")


def test_clear_phase_intent_drops_save_keys() -> None:
    # Behavior: real import via the same facade path as characterize-phase-runtime.
    from scripts.controller.actions._phase_intent import clear_phase_intent

    store = {
        "_phase_intent": {"goal": "新增客户", "submit": {"required": True}},
        "_last_introduce_ok": True,
        "_last_save_ok": True,
        "_success_tokens": ["toast_ok"],
        "_url_before_save": "https://example.com/form",
        "_quality_failed": True,
        "unrelated": 1,
    }
    clear_phase_intent(store)  # must not raise
    for key in ("_phase_intent", "_last_introduce_ok", "_last_save_ok", "_success_tokens", "_url_before_save", "_quality_failed"):
        assert_true(key not in store, f"clear_phase_intent drops {key}")
    assert_true(store.get("unrelated") == 1, "unrelated keys untouched")
    assert_true(clear_phase_intent(None) is None, "None store tolerated")

    # Text pin: the three save keys live in the cleanup tuple, after _last_introduce_ok.
    src = (ROOT / "scripts/controller/actions/phase/intent_contract.py").read_text(encoding="utf-8")
    seg = _fn_src(src, "def clear_phase_intent")
    assert_true(bool(seg), "clear_phase_intent present")
    for key in ("'_last_save_ok'", "'_success_tokens'", "'_url_before_save'"):
        assert_true(key in seg, f"cleanup tuple contains {key}")
    intro_pos = seg.find("'_last_introduce_ok',")
    assert_true(
        all(seg.find(k) > intro_pos >= 0 for k in ("'_last_save_ok'", "'_success_tokens'", "'_url_before_save'")),
        "save keys inserted after _last_introduce_ok",
    )


def test_state_emitters_carry_run_id() -> None:
    # Text pin: each emitter attaches the flat runId key via get_current_run_id.
    src = (ROOT / "scripts/state.py").read_text(encoding="utf-8")
    for name, header in (
        ("_emit_action_log_sync", "def _emit_action_log_sync"),
        ("emit_step_screenshot", "def emit_step_screenshot"),
        ("_emit_page_level_screenshot", "def _emit_page_level_screenshot"),
    ):
        seg = _fn_src(src, header)
        assert_true(bool(seg), f"{name} present")
        assert_true("runId" in seg, f"{name} attaches runId")
        assert_true("get_current_run_id" in seg, f"{name} reads get_current_run_id")
        assert_true("if rid is not None" in seg, f"{name} omits runId when None (legacy compat)")

    # Behavior: monkeypatch emit_json sink, drive the three emitters both runId states.
    import scripts.state as state_mod

    saved = sys.modules.get("scripts.agent_utils")
    fake = types.ModuleType("scripts.agent_utils")
    captured: list = []
    fake.emit_json = lambda payload: captured.append(payload)  # noqa: E731
    sys.modules["scripts.agent_utils"] = fake
    try:
        state_mod.set_current_run_id("run-char-1")
        state_mod.emit_step_screenshot("entry-1", "b64before", "b64after")
        assert_true(
            captured[-1]["event"] == "step_screenshot"
            and captured[-1]["data"]["runId"] == "run-char-1",
            "step_screenshot carries runId",
        )
        state_mod._emit_action_log_sync()
        assert_true(
            captured[-1]["event"] == "action_log_sync"
            and captured[-1]["data"]["runId"] == "run-char-1",
            "action_log_sync carries runId",
        )
        snap = {"levelKey": "page:x"}
        state_mod._emit_page_level_screenshot(snap)
        assert_true(
            captured[-1]["event"] == "page_level_screenshot"
            and captured[-1]["data"]["runId"] == "run-char-1",
            "page_level_screenshot carries flat runId",
        )
        assert_true("runId" not in snap, "registry snapshot dict not mutated")

        state_mod.set_current_run_id(None)
        state_mod.emit_step_screenshot("entry-2", "b64before", None)
        assert_true("runId" not in captured[-1]["data"], "step_screenshot omits runId when None")
        state_mod._emit_action_log_sync()
        assert_true("runId" not in captured[-1]["data"], "action_log_sync omits runId when None")
        state_mod._emit_page_level_screenshot({"levelKey": "page:y"})
        assert_true("runId" not in captured[-1]["data"], "page_level_screenshot omits runId when None")
    finally:
        state_mod.set_current_run_id(None)
        if saved is None:
            sys.modules.pop("scripts.agent_utils", None)
        else:
            sys.modules["scripts.agent_utils"] = saved


def main() -> None:
    tests = [
        test_guard_done_rejects_return_true,
        test_clear_phase_intent_drops_save_keys,
        test_state_emitters_carry_run_id,
    ]
    for t in tests:
        try:
            t()
        except AssertionError as exc:
            print(f"FAIL characterize-recorder-phase-reset {t.__name__}: {exc}")
            sys.exit(1)
    print(f"PASS characterize-recorder-phase-reset ({_OK} checks OK)")


if __name__ == "__main__":
    main()
