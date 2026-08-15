#!/usr/bin/env python3
"""Lightweight characterization for extracted form engine wiring.

Bug: after extracting login/fill/select/radio/tree engines, engine action
bodies still called ``self._ensure_scanned(...)`` / ``self._button_keywords()``
while the shared base only bound the non-underscore names. AI recording then
failed every select_option with
``'SelectEngine' object has no attribute '_ensure_scanned'``
and the agent fell back to click_element_by_index.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.form_action_engines import (  # noqa: E402
    FillEngine,
    RadioEngine,
    SelectEngine,
    TreeEngine,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    class FakeAutofillEngine:
        def ensure_scanned(self, *args, **kwargs) -> None:
            return None

    fake = FakeAutofillEngine()
    button_keywords = lambda: ['保存', '确定']
    ctx = object()
    store: dict = {}

    engines = {
        'FillEngine': FillEngine(ctx, store, fake, button_keywords),
        'SelectEngine': SelectEngine(ctx, store, fake),
        'RadioEngine': RadioEngine(ctx, store, fake),
        'TreeEngine': TreeEngine(ctx, store, fake),
    }

    for name, engine in engines.items():
        assert_true(
            callable(getattr(engine, '_ensure_scanned', None)),
            f'{name} must expose _ensure_scanned bound to autofill ensure_scanned',
        )
        assert_true(
            engine._ensure_scanned is engine.ensure_scanned,
            f'{name} _ensure_scanned must alias ensure_scanned',
        )

    fill = engines['FillEngine']
    assert_true(
        callable(fill._button_keywords) and fill._button_keywords is button_keywords,
        'FillEngine must expose _button_keywords bound to the keywords provider',
    )

    # The actions that used to crash must still be present and callable.
    for engine in engines.values():
        for method in ('select_option', 'fill_form_field', 'click_radio', 'select_tree_option'):
            if hasattr(engine, method):
                assert_true(callable(getattr(engine, method)), f'{method} must be callable')

    print('characterize-form-engine-wiring: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
