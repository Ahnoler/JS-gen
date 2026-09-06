#!/usr/bin/env python3
"""Characterization pins: KB-I5 S1 engine-gap fixes (G1 + G3 + G5).

read_text source-substring pins (same style as characterize-icon-buttons.py):

- G1 click_button container-scope-first: _misc.py must contain the
  container-scope click probe (overlay-first, page-level fallback) and
  form_action_engines.py must keep its wiring markers.
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

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

MISC = os.path.join(ROOT, "scripts", "controller", "actions", "_misc.py")
ENGINES = os.path.join(ROOT, "scripts", "controller", "actions", "form_action_engines.py")
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
    # G1: click_button resolves the container scope before page-level click.
    _pin("G1", MISC, [
        "_JS_CLICK_BUTTON_IN_CONTAINER",
        "G1 container-scope-first",
        "ok-container:",
        "ok-click:",
        "div.todo-item-action",
        "JS_CLICK_ICON_BUTTON, button_text",
    ])
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
    # G5: login orphan-chrome reuse probe.
    _pin("G5", ENGINES, [
        "ok-login reuse",
        "already-logged-in",
        "_usertoken",
        "localStorage.clear()",
        "_wait_for_login_form(page)",
    ])
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
