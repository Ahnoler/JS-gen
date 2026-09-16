#!/usr/bin/env python3
"""Lightweight characterization for picker-close sticky-section cleanup.

Bug (real-run log 2026-09-16, 对公客户转正 phase 5): a stale-scope retry
inside the 引入 picker wrote the picker's transient region
('客户放大镜选择器') into the sticky ``_phase_section`` memory
(form_save.save_retry_scope). When the picker closed,
``maybe_record_picker_closed`` recorded evidence but never cleared that
memory, so the next bare ``click_save()`` resolved its section "from memory"
to the now-vanished popup region and failed with ``err-save-button-not-found``.

Invariant under test: a popup region is by definition gone when the popup
closes — the picker-close lifecycle hook must clear ``_phase_section`` so the
next save re-resolves against the live DOM.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.boundary_gates import (  # noqa: E402
    maybe_record_picker_closed,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    # Polluted memory (popup region remembered during stale-scope retry) must
    # be cleared when the picker closes.
    store = {"_phase_section": "客户放大镜选择器"}
    assert_true(
        maybe_record_picker_closed(store, still_query_ui=False) is True,
        "picker-close must be recorded when query ui is gone",
    )
    assert_true(
        "_phase_section" not in store,
        "picker close must clear sticky _phase_section (popup region is stale)",
    )

    # Popup still open (query ui alive) → no record, memory untouched.
    store_open = {"_phase_section": "客户放大镜选择器"}
    assert_true(
        maybe_record_picker_closed(store_open, still_query_ui=True) is False,
        "still_query_ui=True must not record close",
    )
    assert_true(
        store_open.get("_phase_section") == "客户放大镜选择器",
        "memory must be untouched while the popup is still open",
    )

    # Closing without any remembered section must stay a clean no-op.
    store_plain: dict = {}
    assert_true(
        maybe_record_picker_closed(store_plain, still_query_ui=False) is True,
        "close without memory still records evidence",
    )
    assert_true("_phase_section" not in store_plain, "no memory must be created")

    # Source pin: the clear happens inside the close hook after stale-marking.
    src = (
        ROOT / "scripts" / "controller" / "actions" / "phase" / "boundary_gates.py"
    ).read_text(encoding="utf-8")
    hook = src.split("def maybe_record_picker_closed", 1)[-1].split("\ndef ", 1)[0]
    assert_true(
        "clear_phase_section" in hook,
        "maybe_record_picker_closed body must call clear_phase_section",
    )
    assert_true(
        hook.index("mark_parent_form_stale(") < hook.index("clear_phase_section("),
        "clear must follow the parent-stale marking inside the hook",
    )

    print("characterize-picker-close-clears-section: all passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
