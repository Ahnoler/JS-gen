#!/usr/bin/env python3
"""Characterization: region= preferred over deprecated section= alias."""

from __future__ import annotations

import io
import sys
from contextlib import redirect_stderr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.controller.actions.section_scope import resolve_scope  # noqa: E402


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    assert_true(
        resolve_scope(region="系统评级结论", section="征信信息", warn=False)
        == "系统评级结论",
        "prefer region when both set",
    )
    assert_true(
        resolve_scope(region="", section="系统评级结论", warn=False)
        == "系统评级结论",
        "section alone still resolves",
    )
    assert_true(
        resolve_scope(region="系统评级结论", section="", warn=False)
        == "系统评级结论",
        "region alone resolves",
    )
    assert_true(
        resolve_scope(region="", section="", warn=False) == "",
        "empty stays empty",
    )
    assert_true(
        resolve_scope(region="  A  ", section="B", warn=False) == "A",
        "norm whitespace on region",
    )

    buf = io.StringIO()
    with redirect_stderr(buf):
        resolve_scope(region="", section="征信信息", warn=True)
    err = buf.getvalue()
    assert_true("[deprecate]" in err and "section=" in err, f"warn section-only: {err!r}")

    buf2 = io.StringIO()
    with redirect_stderr(buf2):
        resolve_scope(region="系统评级结论", section="征信信息", warn=True)
    err2 = buf2.getvalue()
    assert_true(
        "[deprecate]" in err2 and "using region" in err2,
        f"warn conflict: {err2!r}",
    )

    print("characterize-region-section-alias: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
