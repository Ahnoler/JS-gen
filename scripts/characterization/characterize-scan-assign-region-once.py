#!/usr/bin/env python3
"""Characterize: JS_SCAN_FORM_FIELDS must not redeclare PAGE_LOCATOR_HELPERS assignRegion."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_scan_form_fields_single_assign_region_decl() -> None:
    from scripts.controller.actions.js_snippets.scan_form import JS_SCAN_FORM_FIELDS

    decls = re.findall(
        r"(?:function|const)\s+(regionLabelOf|assignRegion)\b",
        JS_SCAN_FORM_FIELDS,
    )
    assert_true(
        decls.count("regionLabelOf") == 1,
        f"regionLabelOf declared once in JS_SCAN_FORM_FIELDS, got {decls.count('regionLabelOf')}: {decls}",
    )
    assert_true(
        decls.count("assignRegion") == 1,
        f"assignRegion declared once in JS_SCAN_FORM_FIELDS, got {decls.count('assignRegion')}: {decls}",
    )
    assert_true("SHARED_ASSIGN_REGION" in JS_SCAN_FORM_FIELDS, "helpers marker present")
    assert_true("regionLabelOf(" in JS_SCAN_FORM_FIELDS, "scan still calls regionLabelOf")


def test_click_save_no_redeclare_helpers() -> None:
    from scripts.controller.actions.js_snippets.save import JS_CLICK_SAVE_BUTTON

    decls = re.findall(r"(?:function|const)\s+(isVisible|absXPath)\b", JS_CLICK_SAVE_BUTTON)
    assert_true(
        decls.count("isVisible") == 1,
        f"isVisible declared once in JS_CLICK_SAVE_BUTTON, got {decls.count('isVisible')}: {decls}",
    )
    assert_true(
        decls.count("absXPath") == 1,
        f"absXPath declared once in JS_CLICK_SAVE_BUTTON, got {decls.count('absXPath')}: {decls}",
    )
    assert_true("function isVisible" in JS_CLICK_SAVE_BUTTON, "helpers isVisible present")
    assert_true("if (!isVisible(el)) continue" in JS_CLICK_SAVE_BUTTON, "click_save still filters visible")
    assert_true("xpath: absXPath(bestEl)" in JS_CLICK_SAVE_BUTTON, "click_save still records xpath")


def test_xpath_smart_fill_only_flag() -> None:
    import os
    from scripts import feature_flags as ff

    prev = os.environ.pop("XPATH_SMART_FILL_ONLY", None)
    try:
        assert_true(ff.xpath_smart_fill_only_enabled() is False, "default off (label fallback for testers)")
        os.environ["XPATH_SMART_FILL_ONLY"] = "true"
        assert_true(ff.xpath_smart_fill_only_enabled() is True, "true enables strict xpath fill")
        os.environ["XPATH_SMART_FILL_ONLY"] = "0"
        assert_true(ff.xpath_smart_fill_only_enabled() is False, "0 disables")
    finally:
        if prev is None:
            os.environ.pop("XPATH_SMART_FILL_ONLY", None)
        else:
            os.environ["XPATH_SMART_FILL_ONLY"] = prev

    form_src = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
    assert_true(
        "xpath_smart_fill_only_enabled" in form_src,
        "fill_form_field gates on xpath_smart_fill_only_enabled",
    )


def main() -> int:
    try:
        test_scan_form_fields_single_assign_region_decl()
        test_click_save_no_redeclare_helpers()
        test_xpath_smart_fill_only_flag()
    except Exception as exc:
        print(f"characterize-scan-assign-region-once: FAIL {exc}")
        return 1
    print("characterize-scan-assign-region-once: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
