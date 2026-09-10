#!/usr/bin/env python3
"""Characterization pins: KB-I5 S1 engine-gap fixes (G1 + G3 + G5).

read_text source-substring pins (same style as characterize-icon-buttons.py):

- G1 click_button container-scope-first: click_action_engine.py must contain
  live container-scope wiring (G1 comment, _JS_CLICK_BUTTON_IN_CONTAINER
  evaluate, ok-container fallback to JS_CLICK_ICON_BUTTON). The JS constant
  may still be defined in _misc.py.
- G3 picker refill verification: JS_PICKER_DIALOG_SELECT must carry the
  refill_verified / refill-not-observed markers, and _workspace.py the
  explicit err-refill-not-verified gate with the one SELECT re-run.
- G5 login orphan-chrome reuse: LoginEngine.login must contain the
  already-logged-in reuse probe (ok-login reuse / localStorage.clear+reload).
- icons.py module/constant names unchanged (no renamed JS constants).
"""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, ROOT)

MISC = os.path.join(ROOT, "scripts", "controller", "actions", "_misc.py")
CLICK_ENGINE = os.path.join(ROOT, "scripts", "controller", "actions", "click_action_engine.py")
# Ordered concat read of the (split) form action engines — see
# docs/superpowers/specs/2026-09-10-form-action-engines-split-design.md §3.
ENGINES = ""
for _fname in (
    "form_engine_base.py", "login_engine.py", "fill_engine.py",
    "select_engine.py", "radio_engine.py", "tree_engine.py",
    "form_action_engines.py",
):
    _fpath = os.path.join(ROOT, "scripts", "controller", "actions", _fname)
    if os.path.exists(_fpath):
        with open(_fpath, "r", encoding="utf-8") as f:
            ENGINES += f.read()
WORKSPACE = os.path.join(ROOT, "scripts", "controller", "actions", "_workspace.py")
PICKER = os.path.join(ROOT, "scripts", "controller", "actions", "js_snippets", "picker_confirm.py")
ICONS = os.path.join(ROOT, "scripts", "controller", "actions", "js_snippets", "icons.py")

FAILURES = []


def _pin(label, path, needles):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    for needle in needles:
        if needle not in text:
            FAILURES.append(f"{label}: {os.path.basename(path)} missing {needle!r}")


def main():
    # G1: live ClickEngine click_button container-scope-first wiring.
    _pin("G1", CLICK_ENGINE, [
        "G1 container-scope-first",
        "_JS_CLICK_BUTTON_IN_CONTAINER",
        "ok-container:",
        "JS_CLICK_ICON_BUTTON",
    ])
    with open(MISC, "r", encoding="utf-8") as f:
        misc_text = f.read()
    with open(CLICK_ENGINE, "r", encoding="utf-8") as f:
        engine_text = f.read()
    if "_JS_CLICK_BUTTON_IN_CONTAINER" not in misc_text and (
        "_JS_CLICK_BUTTON_IN_CONTAINER" not in engine_text
    ):
        FAILURES.append(
            "G1: _JS_CLICK_BUTTON_IN_CONTAINER missing from _misc.py and click_action_engine.py"
        )
    # G3: picker select refill verification (JS + action layer).
    _pin("G3", PICKER, [
        "refill_verified",
        "refill-not-observed",
        "setTimeout(resolve, 1500)",
    ])
    _pin("G3", WORKSPACE, [
        "refill_verified",
        "err-refill-not-verified",
        "JS_PICKER_DIALOG_SELECT, [dialog_name, row_text]",
    ])
    # G5: login orphan-chrome reuse probe (ENGINES is the ordered concat text).
    for needle in [
        "ok-login reuse",
        "already-logged-in",
        "_usertoken",
        "localStorage.clear()",
        "_wait_for_login_form(page)",
    ]:
        if needle not in ENGINES:
            FAILURES.append(f"G5: form_action_engines.py missing {needle!r}")
    # icons.py: constants must keep their original names.
    _pin("icons", ICONS, [
        "JS_STAMP_ICON_ARIA_LABELS",
        "JS_COLLECT_ICON_BUTTONS",
        "JS_CLICK_ICON_BUTTON",
    ])

    if FAILURES:
        for line in FAILURES:
            print("FAIL:", line)
        return 1
    print("ok: characterize-click-scope-picker-login (G1+G3+G5 pins, icons.py unchanged)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
