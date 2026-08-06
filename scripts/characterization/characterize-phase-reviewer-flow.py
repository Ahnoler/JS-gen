#!/usr/bin/env python3
"""Rules path: open-page → contract denies assistant; create → allows."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._phase_intent import (  # noqa: E402
    apply_phase_intent,
    contract_allows_form_assistant,
)


def main() -> int:
    store: dict = {}
    c = apply_phase_intent(store, '进入对公客户管理页面。预期结果：打开对公客户管理列表页面。')
    assert c and c.get('mode') == 'navigate'
    assert store.get('_phase_boundary', {}).get('role') == 'navigate'
    assert contract_allows_form_assistant(store) is False

    store2: dict = {}
    apply_phase_intent(store2, '新增对公客户并保存')
    assert contract_allows_form_assistant(store2) is True or store2.get('_force_refill_all') is True

    print('PASS characterize-phase-reviewer-flow')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
