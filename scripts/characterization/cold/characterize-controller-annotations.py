#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Registered @controller.action first-param annotations must be real classes.

browser_use execute_action does issubclass(annotation, BaseModel).
PEP 563 (`from __future__ import annotations`) leaves `str` as the string
'str' → TypeError: issubclass() arg 1 must be a class.

Run:
  python scripts/characterization/characterize-controller-annotations.py
"""
import inspect
import os
import sys

from pydantic import BaseModel

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from scripts.controller.service import build_controller  # noqa: E402


def main() -> None:
    ctrl = build_controller(None)
    bad: list[str] = []
    for name, action in ctrl.registry.registry.actions.items():
        params = list(inspect.signature(action.function).parameters.values())
        if not params:
            continue
        ann = params[0].annotation
        try:
            issubclass(ann, BaseModel)
        except TypeError:
            bad.append(f"{name}: {ann!r}")
    if bad:
        raise AssertionError(
            "browser_use issubclass-unsafe first-param annotations: " + "; ".join(bad)
        )
    print("characterize-controller-annotations: OK")


if __name__ == "__main__":
    main()
