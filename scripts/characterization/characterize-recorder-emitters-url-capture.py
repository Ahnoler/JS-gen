#!/usr/bin/env python3
"""Characterization: recorder_emitters._capture_step_url lazy ctrl_mod import.

Pins the 2026-09-17 fix: _capture_step_url writes ``ctrl_mod._TRAJECTORY_URL``
but the extracted module (scripts/agent/recorder_emitters.py, from commit
6aeedcb0) never imported ``ctrl_mod`` — the NameError was silently swallowed by
the function's ``except Exception: pass``, disabling per-step trajectory URL
capture entirely. The import must live INSIDE the function body (lazy import
convention, cf. scripts/agent_utils.py:128 ``from . import controller as
ctrl_mod``), depth-adjusted for the scripts.agent package location.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_OK = 0


def assert_true(cond: bool, msg: str) -> None:
    global _OK
    if not cond:
        raise AssertionError(msg)
    _OK += 1


def _fn_src(text: str, header: str) -> str:
    """Extract a function source segment: header line → next top-level def."""
    start = text.find(header)
    if start < 0:
        return ""
    candidates = [
        x for x in (
            text.find("\ndef ", start + len(header)),
            text.find("\nasync def ", start + len(header)),
        )
        if x > 0
    ]
    end = min(candidates) if candidates else len(text)
    return text[start:end]


def test_capture_step_url_has_lazy_ctrl_mod_import() -> None:
    src = (ROOT / "scripts/agent/recorder_emitters.py").read_text(encoding="utf-8")
    seg = _fn_src(src, "def _capture_step_url")
    assert_true(bool(seg), "_capture_step_url present")
    # Lazy import line inside the function body (relative `from ..` or absolute
    # `from scripts` form — both match the repo's lazy-import conventions).
    m = re.search(
        r"from\s+(?:\.{2}|scripts)\s+import\s+controller\s+as\s+ctrl_mod",
        seg,
    )
    assert_true(
        bool(m),
        "_capture_step_url body contains lazy `import controller as ctrl_mod`",
    )
    if m:
        # No ctrl_mod usage may appear before the import line (use-before-import).
        assert_true(
            "ctrl_mod" not in seg[: m.start()],
            "no ctrl_mod usage before the lazy import line",
        )
        # The trajectory URL write stays wired after the import.
        assert_true(
            seg.find("ctrl_mod", m.end()) > m.end(),
            "ctrl_mod used after the lazy import line",
        )
        assert_true(
            "ctrl_mod._TRAJECTORY_URL = _url" in seg,
            "trajectory URL write still wired to ctrl_mod._TRAJECTORY_URL",
        )


def main() -> None:
    tests = [
        test_capture_step_url_has_lazy_ctrl_mod_import,
    ]
    for t in tests:
        try:
            t()
        except AssertionError as exc:
            print(f"FAIL characterize-recorder-emitters-url-capture {t.__name__}: {exc}")
            sys.exit(1)
    print(f"PASS characterize-recorder-emitters-url-capture ({_OK} checks OK)")


if __name__ == "__main__":
    main()
