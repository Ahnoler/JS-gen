#!/usr/bin/env python3
"""introduce_pick: LLM success_when=['dialog_close'] must accept toast_ok / picker close.

Wet regression (sid 0975ed13): click_save returned ok-save-success:操作成功 and
observed toast_ok, but Premature done looped because success_when was only
dialog_close and picker_closed was never stamped on the toast early-return path.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ["AI_PHASE_BOUNDARY"] = "1"

from scripts.controller.actions._phase_boundary import (  # noqa: E402
    phase_done_ok,
    record_evidence,
)
from scripts.controller.actions._phase_intent import (  # noqa: E402
    apply_phase_contract,
    has_contract_success,
)
from scripts.controller.actions.phase.reviewer import sanitize_contract_for_mode  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_sanitize_introduce_expands_success_kinds() -> None:
    raw = {
        "mode": "introduce_pick",
        "submit": {"required": True, "via": "dialog_confirm", "button_text": "确定"},
        "success": {"kinds": ["dialog_close"], "evidence": []},
        "refill": "none",
        "allow_form_assistant": False,
        "source": "llm",
    }
    c = sanitize_contract_for_mode(raw)
    kinds = set((c.get("success") or {}).get("kinds") or [])
    assert_true("dialog_close" in kinds, "keeps dialog_close")
    assert_true("toast_ok" in kinds, "adds toast_ok for introduce_pick")
    assert_true(
        "picker_closed" in kinds or "dialog_confirmed" in kinds,
        "adds picker close kinds",
    )
    assert_true(
        (c.get("submit") or {}).get("required") is True,
        "introduce_pick keeps submit.required",
    )


def test_toast_ok_satisfies_llm_dialog_close_contract() -> None:
    store: dict = {}
    contract = {
        "mode": "introduce_pick",
        "submit": {"required": True, "via": "any", "button_text": "确定"},
        "success": {"kinds": ["dialog_close"], "evidence": []},
        "refill": "none",
        "source": "llm",
    }
    apply_phase_contract(store, contract)
    record_evidence(store, "toast_ok", "操作成功")
    ok, missing = phase_done_ok(store)
    assert_true(ok, f"toast_ok must satisfy expanded introduce success_when; missing={missing}")
    assert_true(has_contract_success(store), "has_contract_success after toast_ok")


def test_form_save_toast_path_stamps_picker_closed() -> None:
    """Source pin: success_notifs early return must still record picker close evidence."""
    src = (
        ROOT / "scripts/controller/actions/form_save.py"
    ).read_text(encoding="utf-8")
    # Locate toast success block
    idx = src.find("if success_notifs:")
    assert_true(idx >= 0, "success_notifs branch exists")
    # Until next major branch (error_notifs or url)
    end = src.find("if error_notifs:", idx)
    if end < 0:
        end = src.find("url_changed", idx)
    block = src[idx:end]
    assert_true(
        "maybe_record_picker_closed" in block or "is_picker_confirm" in block,
        "toast success path must consider picker confirm / record picker_closed",
    )
    assert_true(
        "record_success_token" in block and "toast_ok" in block,
        "toast path still records toast_ok",
    )


def main() -> int:
    test_sanitize_introduce_expands_success_kinds()
    test_toast_ok_satisfies_llm_dialog_close_contract()
    test_form_save_toast_path_stamps_picker_closed()
    print("characterize-introduce-dialog-close: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
