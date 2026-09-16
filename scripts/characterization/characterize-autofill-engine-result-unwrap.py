#!/usr/bin/env python3
"""Lightweight characterization for auto-fill engine-result unwrapping.

Bug (real-run log 2026-09-16, 对公客户转正 phase 5): the auto-fill cascade
routes tssc-multi-select fields through ``SelectEngine.select_option`` whose
success path returns an ``ActionResult`` object (correct contract for direct
agent calls). The cascade stored that object raw in ``all_results``, so
``json.dumps`` in ``autofill_pending`` raised
``Object of type ActionResult is not JSON serializable`` — and because
``_is_ok_result`` only accepts ``str``, the successful field also stayed in
``still_empty`` and the cascade re-selected the same batch forever.

Fix under test: the embedded engine call is wrapped with
``_unwrap_action_result`` at the production site so downstream consumers
(ok counting, cascade key collection, JSON serialization) all see ``str``.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions._helpers import _is_ok_result  # noqa: E402
from scripts.controller.actions.radio_engine import _unwrap_action_result  # noqa: E402

AUTOFILL_ROUND = (
    ROOT / "scripts" / "controller" / "actions" / "autofill_round.py"
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    src = AUTOFILL_ROUND.read_text(encoding="utf-8")

    # Source pins: the embedded engine call must be unwrapped at the site.
    assert_true(
        "from .form_action_engines import SelectEngine, _unwrap_action_result" in src,
        "autofill_round must import _unwrap_action_result alongside SelectEngine",
    )
    assert_true(
        "result = _unwrap_action_result("
        "await select_engine.select_option(label, value, xpath_smart))" in src,
        "embedded select_option result must pass through _unwrap_action_result",
    )
    assert_true(
        "result = await select_engine.select_option(label, value, xpath_smart)"
        not in src,
        "bare embedded select_option call must not come back (regression ban)",
    )

    # Behavior pins: unwrap turns engine ActionResult into ok-prefixed str.
    class FakeResult:
        extracted_content = "ok:tssc-multi-select selected"

    unwrapped = _unwrap_action_result(FakeResult())
    assert_true(isinstance(unwrapped, str), "unwrap must return str for engine results")
    assert_true(_is_ok_result(unwrapped), "unwrapped engine success must count as ok")
    assert_true(
        _unwrap_action_result("no-items") == "no-items",
        "plain str engine failure must pass through unchanged",
    )
    assert_true(not _is_ok_result("no-items"), "failure str stays non-ok")

    print("characterize-autofill-engine-result-unwrap: all passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
