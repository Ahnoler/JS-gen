#!/usr/bin/env python3
"""Characterize: already-matched select_option must not append cross-phase duplicates.

D1 (#925): when an agent revisits a field whose value is already set, the
``ok-already`` branches used to record another ``select_option`` step even
though nothing changed on the page. The first already-matched selection still
records (replay keeps the step); later same-field/same-value revisits are
deduped via ``state.has_recorded_field_action``.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_has_recorded_field_action() -> None:
    from scripts import state as st

    original = list(st._ACTION_LOG)
    try:
        st._ACTION_LOG.clear()
        assert_true(
            st.has_recorded_field_action('select_option', 'customer', 'credit') is False,
            "empty log is not already recorded",
        )
        st._ACTION_LOG.append({
            'action': 'select_option',
            'params': {'label_text': 'customer', 'option_text': 'credit'},
        })
        assert_true(
            st.has_recorded_field_action('select_option', 'customer', 'credit') is True,
            "same field + same value detected",
        )
        assert_true(
            st.has_recorded_field_action('select_option', 'customer', 'other') is False,
            "same field + different value not deduped",
        )
        assert_true(
            st.has_recorded_field_action('select_option', 'other', 'credit') is False,
            "different field not deduped",
        )
        assert_true(
            st.has_recorded_field_action('fill_form_field', 'customer', 'credit') is False,
            "different action not deduped",
        )
        st._ACTION_LOG.append({
            'action': 'fill_form_field',
            'params': {'label_text': 'customer', 'value': 'credit'},
        })
        assert_true(
            st.has_recorded_field_action('fill_form_field', 'customer', 'credit') is True,
            "value-key fallback (fill_form_field) detected",
        )
        assert_true(
            st.has_recorded_field_action('select_option', '', 'credit') is False,
            "blank label never dedupes",
        )
        assert_true(
            st.has_recorded_field_action('select_option', 'customer', '') is False,
            "blank value never dedupes",
        )
    finally:
        st._ACTION_LOG[:] = original


def test_select_engine_already_matched_guarded() -> None:
    src = (ROOT / "scripts/controller/actions/select_engine.py").read_text(encoding="utf-8")
    assert_true(
        "from scripts.state import _record_action, has_recorded_field_action" in src,
        "select_engine imports has_recorded_field_action",
    )
    body = src.split("class SelectEngine", 1)[1].split("class RadioEngine", 1)[0]
    guarded = "if not has_recorded_field_action('select_option', label_text, stamped):"
    assert_true(
        body.count(guarded) == 2,
        "both already-matched branches guard _record_action with the dedup helper",
    )
    assert_true(
        body.count("_record_action('select_option'") >= 2,
        "already-matched branches still record select_option (first occurrence)",
    )
    assert_true(
        "resolve_recorded_option_text" in body,
        "already-matched branches still stamp concrete option_text (replay contract)",
    )
    assert_true(
        "already-matched | no-items-skip" in body,
        "no-items-skip already-matched path kept",
    )


def main() -> int:
    test_has_recorded_field_action()
    test_select_engine_already_matched_guarded()
    print("characterize-select-already-matched-dedup: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
