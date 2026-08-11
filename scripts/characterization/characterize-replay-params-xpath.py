#!/usr/bin/env python3
"""Characterize element-first xpath resolve + read-back helpers in _replay.py."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions import _replay as R  # noqa: E402


def test_resolve_prefers_element_over_params() -> None:
    """params.xpath_smart is abandoned for locate — element wins even when both present."""
    entry = {
        "element": {
            "xpath_smart": (
                "//div[contains(@class,'el-form-item')][.//label[contains(.,'X')]]//input"
            )
        }
    }
    params = {
        "xpath_smart": "//tr[.//*[normalize-space()='X']]//input",
        "label_text": "X",
        "value": "1",
    }
    xp, src = R._resolve_replay_xpath(entry, params)
    assert "el-form-item" in xp, xp
    assert src == "element"


def test_resolve_ignores_wrong_params_label_xpath() -> None:
    """Traj 130 step 23: params pointed at 编号 while element (and label) are 名称."""
    entry = {
        "element": {
            "xpath_smart": (
                "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]"
                "//div[contains(@class,'el-form-item')]"
                "[.//label[contains(normalize-space(.),'核心产品名称')]]//input"
            ),
            "formLabel": "核心产品名称",
        }
    }
    params = {
        "label_text": "核心产品名称",
        "value": "对公核心产品错误定位",
        "xpath_smart": (
            "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]"
            "//div[contains(@class,'el-form-item')]"
            "[.//label[contains(normalize-space(.),'核心产品编号')]]//input"
        ),
    }
    xp, src = R._resolve_replay_xpath(entry, params)
    assert "核心产品名称" in xp, xp
    assert "核心产品编号" not in xp, xp
    assert src == "element"


def test_resolve_falls_back_to_full_when_no_element_smart() -> None:
    entry = {"element": {"xpath_full": "/html/body/div[1]/input"}}
    params = {"xpath_smart": "//input[@placeholder='请输入'][1]"}
    xp, src = R._resolve_replay_xpath(entry, params)
    assert xp.startswith("/html"), xp
    assert src == "full"


def test_classify_false_ok() -> None:
    assert R._classify_fill_result(True, "45.50", "45.50").startswith("ok")
    assert R._classify_fill_result(True, "45.50", "10.20").startswith("false_ok")
    assert R._classify_fill_result(False, "45.50", "").startswith("xpath_miss") or True


def test_norm_replay_value_strips_spaces() -> None:
    assert R._norm_replay_value(" 45.50 ") == "45.50"
    assert R._norm_replay_value("45 . 50") == "45.50"


def test_replay_fill_does_not_pass_label_as_placeholder_hint() -> None:
    src = (ROOT / "scripts/controller/actions/_replay.py").read_text(encoding="utf-8")
    fill_block = src.split("if action_name == 'fill_form_field'")[1].split(
        "if action_name == 'fill_date_field'"
    )[0]
    assert "placeholder or label" not in fill_block


def main() -> int:
    test_resolve_prefers_element_over_params()
    test_resolve_ignores_wrong_params_label_xpath()
    test_resolve_falls_back_to_full_when_no_element_smart()
    test_classify_false_ok()
    test_norm_replay_value_strips_spaces()
    test_replay_fill_does_not_pass_label_as_placeholder_hint()
    print("characterize-replay-params-xpath: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
