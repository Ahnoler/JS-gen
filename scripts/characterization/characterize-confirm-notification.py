#!/usr/bin/env python3
"""Characterization: picker-confirm el-notification capture (E6).

el-notification is position:fixed; get_page_state's old offsetParent filter
always dropped it. Confirm clicks now arm a notification watcher and surface
err-notification:... to the model.
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


def main() -> int:
    misc = (ROOT / 'scripts/controller/actions/_misc.py').read_text(encoding='utf-8')

    # A: notifications visibility must be rect-based, not offsetParent-based
    idx = misc.find("notifications: [...document.querySelectorAll('.el-notification')]")
    assert_true(idx >= 0, 'notifications collector present')
    seg = misc[idx:idx + 420]
    assert_true('getBoundingClientRect' in seg, 'notifications use rect visibility')
    assert_true('offsetParent' not in seg, 'notifications no longer offsetParent-filtered')

    # B: watcher armed before error surfacing before success token
    watcher_pos = misc.find('JS_WATCH_SAVE_NOTIFICATIONS')
    err_pos = misc.find('err-notification:')
    toast_pos = misc.find("record_success_token(business_data_store, 'toast_ok'")
    success_pos = misc.find("record_success_token(business_data_store, 'confirm_click'")
    assert_true(
        watcher_pos >= 0 and err_pos >= 0 and toast_pos >= 0 and success_pos >= 0,
        'all markers present',
    )
    assert_true(
        watcher_pos < err_pos < toast_pos < success_pos,
        'arm watcher → check error → toast_ok → confirm_click',
    )

    # C: success notifications (状态更新成功) must classify to toast_ok, not err
    assert_true('状态更新成功' in misc, 'enable/status-update success text recognized')
    assert_true("return { errors, successes }" in misc, 'confirm note returns errors+successes')
    assert_true('confirm success notification → toast_ok' in misc, 'success path logs toast_ok')

    # Regression: the pre-click watcher arming must NOT reference `compact`
    # outside the _is_form_submit_label guard (it is only assigned there).
    assert_true(
        misc.count("if compact.startswith(('确认', '确定')):") == 1,
        'bare compact confirm check may only appear once (inside label guard)',
    )
    assert_true(
        "if btn_label and re.sub(r'\\s+', '', btn_label).startswith(('确认', '确定')):" in misc,
        'watcher arming derives confirm flag from btn_label, not bare compact',
    )

    print('characterize-confirm-notification: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
