#!/usr/bin/env python3
"""Characterize: manual dialog fills get overlay scope on element.xpath_smart; params omit xpath."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.manual_recorder.mapper import (  # noqa: E402
    _map_dom_event_to_action,
    _offline_xpath_smart_fallback,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_offline_form_uses_dialog_scope_from_abs_class() -> None:
    xp = _offline_xpath_smart_fallback(
        "input",
        "",
        xpath_abs="/html/body/div[3]/div[contains(@class,'el-dialog')]/div/input",
        class_name="el-input__inner",
        form_label="核心产品编号",
        target_kind="form_input",
    )
    assert_true("el-dialog" in xp or "el-message-box" in xp, f"dialog scoped: {xp}")
    assert_true("[last()]" not in xp, f"no [last()] (align auto-capture): {xp}")
    assert_true("核心产品编号" in xp or "el-form-item" in xp, f"label form-item: {xp}")


def test_offline_form_uses_locator_scope_when_abs_has_no_class() -> None:
    """Absolute xpath is usually positional — must honor locator_scope=dialog."""
    xp = _offline_xpath_smart_fallback(
        "input",
        "",
        xpath_abs="/html/body/div[5]/div[2]/div[1]/input",
        class_name="el-input__inner",
        form_label="核心产品编号",
        target_kind="form_input",
        locator_scope="dialog",
    )
    assert_true("el-dialog" in xp or "el-message-box" in xp, f"scope from locator_scope: {xp}")
    assert_true("[last()]" not in xp, f"no [last()]: {xp}")


def test_offline_drawer_scope() -> None:
    xp = _offline_xpath_smart_fallback(
        "input",
        "",
        xpath_abs="/html/body/div[1]/div",
        class_name="el-input__inner",
        form_label="证件类型",
        target_kind="form_input",
        locator_scope="drawer",
    )
    assert_true("el-drawer" in xp, f"drawer scoped: {xp}")
    assert_true("[last()]" not in xp, f"no [last()]: {xp}")


def test_map_fill_stamps_params_xpath_smart() -> None:
    smart = (
        "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]"
        "//div[contains(@class,'el-form-item')]"
        "[.//label[contains(normalize-space(.),'核心产品编号')]]//input"
    )
    mapped = _map_dom_event_to_action(
        {
            "kind": "fill",
            "label_text": "核心产品编号",
            "value": "CP001",
            "tag": "input",
            "xpath_smart": smart,
            "xpath_abs": "/html/body/div[9]/div[1]/input",
            "locator_scope": "dialog",
            "target_kind": "form_input",
            "attributes": {"class": "el-input__inner"},
        }
    )
    assert_true(mapped is not None, "mapped fill")
    action, params, element = mapped
    assert_true(action == "fill_form_field", action)
    assert_true("xpath_smart" not in params, f"params must omit xpath_smart: {params}")
    assert_true(
        (element or {}).get("xpath_smart") == smart
        or smart in str((element or {}).get("xpath_smart") or ""),
        "element keeps durable/scoped xpath",
    )


def test_map_fill_wraps_unscoped_smart_when_locator_scope_dialog() -> None:
    """Align manual with auto-capture: unscoped label xpath + dialog scope → wrap."""
    bare = (
        "//div[contains(@class,'el-form-item')]"
        "[.//label[contains(normalize-space(.),'核心产品编号')]]//input"
    )
    mapped = _map_dom_event_to_action(
        {
            "kind": "fill",
            "label_text": "核心产品编号",
            "value": "x",
            "tag": "input",
            "xpath_smart": bare,
            "locator_scope": "dialog",
            "target_kind": "form_input",
            "attributes": {"class": "el-input__inner"},
        }
    )
    assert_true(mapped is not None, "mapped")
    _, params, element = mapped
    assert_true("xpath_smart" not in params, f"params must omit xpath_smart: {params}")
    xp = (element or {}).get("xpath_smart") or ""
    assert_true("el-dialog" in xp or "el-message-box" in xp, f"wrapped: {xp}")


def test_map_select_stamps_params_xpath() -> None:
    smart = (
        "//div[contains(@class,'el-drawer')]"
        "//div[contains(@class,'el-form-item')]"
        "[.//label[contains(.,'状态')]]//div[contains(@class,'el-select')]"
    )
    mapped = _map_dom_event_to_action(
        {
            "kind": "select_option",
            "label_text": "状态",
            "option_text": "启用",
            "xpath_smart": smart,
            "locator_scope": "drawer",
            "target_kind": "form_select",
            "tag": "div",
            "attributes": {"class": "el-select"},
        }
    )
    assert_true(mapped is not None, "mapped select")
    _, params, element = mapped
    assert_true("xpath_smart" not in params, f"params must omit xpath_smart: {params}")
    assert_true(
        (element or {}).get("xpath_smart") == smart
        or smart in str((element or {}).get("xpath_smart") or ""),
        "element keeps durable/scoped xpath",
    )


def main() -> int:
    test_offline_form_uses_dialog_scope_from_abs_class()
    test_offline_form_uses_locator_scope_when_abs_has_no_class()
    test_offline_drawer_scope()
    test_map_fill_stamps_params_xpath_smart()
    test_map_fill_wraps_unscoped_smart_when_locator_scope_dialog()
    test_map_select_stamps_params_xpath()
    print("characterize-manual-dialog-scope: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
