#!/usr/bin/env python3
"""Cold pin: action_log_sync emits delta by default (not full O(n) every step).

Run: D:\\anaconda3\\envs\\browser_use\\python.exe scripts/characterization/cold/characterize-action-log-sync-delta.py
"""
from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _install_emit_sink():
    import scripts.state as state_mod

    captured: list = []
    fake = types.ModuleType("scripts.agent_utils")
    fake.emit_json = lambda payload: captured.append(payload)
    sys.modules["scripts.agent_utils"] = fake
    # Reset sync bookkeeping between tests
    state_mod._ACTION_LOG.clear()
    state_mod._ACTION_LOG_SYNCED_IDS.clear()
    state_mod._ACTION_LOG_SYNC_TICK = 0
    return state_mod, captured


def test_second_record_is_delta_only_new():
    state_mod, captured = _install_emit_sink()
    state_mod.set_current_run_id("run-delta-1")
    e1 = state_mod._record_action("click_button", {"button_text": "A"}, "ok")
    e2 = state_mod._record_action("click_button", {"button_text": "B"}, "ok")
    assert_true(e1 and e2, "two entries recorded")
    syncs = [c for c in captured if c.get("event") == "action_log_sync"]
    assert_true(len(syncs) >= 2, f"expected >=2 syncs, got {len(syncs)}")
    first, second = syncs[0]["data"], syncs[1]["data"]
    assert_true(first.get("syncMode") in ("full", "delta"), "first has syncMode")
    assert_true(second.get("syncMode") == "delta", f"second should be delta, got {second.get('syncMode')}")
    assert_true(len(second.get("entries") or []) == 1, "delta carries only the new entry")
    assert_true(second["entries"][0]["id"] == e2["id"], "delta entry is the second action")
    assert_true(second.get("count") == 2, "count is total log length")
    assert_true(second.get("runId") == "run-delta-1", "runId still attached")


def test_coalesce_sends_removed_and_new_delta():
    state_mod, captured = _install_emit_sink()
    state_mod.set_current_run_id(None)
    state_mod._record_action(
        "fill_form_field",
        {"label_text": "姓名", "value": "甲"},
        "ok",
        element={"xpath_smart": "//input[@1]"},
    )
    state_mod._record_action(
        "fill_form_field",
        {"label_text": "姓名", "value": "乙"},
        "ok",
        element={"xpath_smart": "//input[@1]"},
    )
    syncs = [c for c in captured if c.get("event") == "action_log_sync"]
    last = syncs[-1]["data"]
    assert_true(last.get("syncMode") == "delta", "coalesce emit is delta")
    assert_true(len(last.get("removedIds") or []) == 1, "coalesce reports removedIds")
    assert_true(len(last.get("entries") or []) == 1, "coalesce delta has replacement entry")
    assert_true(last.get("count") == 1, "log length after coalesce is 1")


def test_clear_then_emit_is_full_empty():
    state_mod, captured = _install_emit_sink()
    state_mod._record_action("click_button", {"button_text": "X"}, "ok")
    state_mod._ACTION_LOG.clear()
    state_mod._emit_action_log_sync()
    last = [c for c in captured if c.get("event") == "action_log_sync"][-1]["data"]
    assert_true(last.get("syncMode") == "full", "clear forces full snapshot")
    assert_true(last.get("entries") == [], "full empty after clear")
    assert_true(last.get("count") == 0, "count 0 after clear")


def test_source_mentions_synced_ids():
    src = (ROOT / "scripts/state.py").read_text(encoding="utf-8")
    assert_true("_ACTION_LOG_SYNCED_IDS" in src, "tracks synced ids")
    assert_true("syncMode" in src, "emits syncMode")


if __name__ == "__main__":
    test_second_record_is_delta_only_new()
    test_coalesce_sends_removed_and_new_delta()
    test_clear_then_emit_is_full_empty()
    test_source_mentions_synced_ids()
    print("characterize-action-log-sync-delta: OK")
