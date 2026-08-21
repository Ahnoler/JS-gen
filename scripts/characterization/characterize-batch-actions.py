#!/usr/bin/env python3
"""Characterize batch actions budget (resolve_max_actions_per_step + wiring)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.agent_utils import resolve_max_actions_per_step  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_explicit_value_wins() -> None:
    # Node 显式传值（config MAX_ACTIONS_PER_STEP 透传）→ 用之，source=config
    assert_true(
        resolve_max_actions_per_step(4, 'create') == (4, 'config'),
        "explicit 4 wins over create=5",
    )
    assert_true(
        resolve_max_actions_per_step(7, 'navigate') == (7, 'config'),
        "explicit 7 wins over navigate=3",
    )
    assert_true(
        resolve_max_actions_per_step('3', 'create') == (3, 'config'),
        "numeric string accepted",
    )


def test_falsy_falls_back_to_mode_mapping() -> None:
    # 0/空/None → 不覆盖，走模式映射，source=mode
    assert_true(
        resolve_max_actions_per_step(0, 'create') == (5, 'mode'),
        "0 → create mode default 5",
    )
    assert_true(
        resolve_max_actions_per_step('', 'navigate') == (3, 'mode'),
        "'' → navigate mode default 3",
    )
    assert_true(
        resolve_max_actions_per_step(None, 'create') == (5, 'mode'),
        "None → create mode default 5",
    )


def test_mode_mapping() -> None:
    cases = {
        'create': 5,
        'modify': 5,
        'introduce_pick': 5,
        'navigate': 3,
        'query': 3,
        'login': 3,
    }
    for mode, expected in cases.items():
        assert_true(
            resolve_max_actions_per_step(None, mode) == (expected, 'mode'),
            f"{mode} → {expected}",
        )


def test_other_and_none_mode_default() -> None:
    for mode in ('verify', 'heal', 'other', None):
        assert_true(
            resolve_max_actions_per_step(None, mode) == (3, 'default'),
            f"{mode!r} → default 3",
        )


def test_clamp_bounds() -> None:
    assert_true(
        resolve_max_actions_per_step(100, 'create') == (10, 'config'),
        "clamp upper bound 10",
    )
    assert_true(
        resolve_max_actions_per_step(-5, 'create') == (1, 'config'),
        "clamp lower bound 1",
    )
    assert_true(
        resolve_max_actions_per_step(1, 'create') == (1, 'config'),
        "1 stays 1",
    )
    assert_true(
        resolve_max_actions_per_step(10, 'create') == (10, 'config'),
        "10 stays 10",
    )


def test_service_wiring() -> None:
    src = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    assert_true(
        "raw_max_actions_per_step = (" in src
        and "instruction.get('max_actions_per_step')" in src,
        "service.py reads instruction max_actions_per_step",
    )
    assert_true(
        "max_actions_per_step=max_actions_per_step," in src,
        "Agent constructed with max_actions_per_step",
    )
    assert_true(
        "[batch] max_actions_per_step=" in src and "source={max_actions_source}" in src,
        "stderr [batch] observability line",
    )
    assert_true(
        'phase_payload["maxActionsPerStep"] = max_actions_per_step' in src,
        "phase_end payload carries maxActionsPerStep",
    )


def test_node_stepdata_passthrough() -> None:
    src = (
        ROOT / "src/services/trajectory/trajectory-recording-runner.js"
    ).read_text(encoding="utf-8")
    assert_true(
        "max_actions_per_step: MAX_ACTIONS_PER_STEP || undefined" in src,
        "stepData passes MAX_ACTIONS_PER_STEP (empty → undefined)",
    )
    assert_true(
        "import { AI_MEMORY_FACT_PACK, MAX_ACTIONS_PER_STEP, PHASE_MAX_STEPS }" in src,
        "MAX_ACTIONS_PER_STEP imported from #config",
    )


def main() -> int:
    test_explicit_value_wins()
    test_falsy_falls_back_to_mode_mapping()
    test_mode_mapping()
    test_other_and_none_mode_default()
    test_clamp_bounds()
    test_service_wiring()
    test_node_stepdata_passthrough()
    print("ok: characterization batch-actions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
