#!/usr/bin/env python3
"""Characterize close_dialog replay: durable xpath fail → controller fallback."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
replay = (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    # close_dialog block must fall back to controller when durable click fails
    assert_true("close_dialog" in replay, "replay mentions close_dialog")
    assert_true(
        "close_dialog ctrl-fallback" in replay,
        "close_dialog logs ctrl-fallback on xpath failure",
    )
    assert_true(
        "_replay_controller_action" in replay
        and "action_name == 'close_dialog'" in replay
        and "not _result_ok(action_name, result)" in replay,
        "close_dialog checks durable result then calls controller",
    )
    print("characterize-close-dialog-replay: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
