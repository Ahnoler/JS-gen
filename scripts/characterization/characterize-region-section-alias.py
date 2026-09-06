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

from scripts.controller.actions.section_scope import (  # noqa: E402
    pending_by_region,
    pending_by_section,
    requires_region_declaration,
    requires_section_declaration,
    resolve_scope,
)
from scripts.controller.actions.form_scan_utils import (  # noqa: E402
    _project_summary_buttons,
    _project_summary_field,
)
from scripts.models.task import TaskItem, TaskList  # noqa: E402


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

    field = _project_summary_field(
        {
            "label": "理由说明",
            "kind": "input",
            "xpath_smart": "//x",
            "region_label": "系统评级结论",
            "section_title": "旧标题",
        }
    )
    assert_true(field.get("region_label") == "系统评级结论", f"field region_label: {field}")
    assert_true(field.get("section") == "系统评级结论", "legacy section dual-write")

    buttons = _project_summary_buttons(
        [
            {
                "label": "保存",
                "xpath_smart": "//b",
                "region_label": "系统评级结论",
            }
        ]
    )
    assert_true(buttons and buttons[0]["region_label"] == "系统评级结论", f"btn: {buttons}")

    tl = TaskList(
        pending=[
            TaskItem(label="借款企业", kind="radio", section_title="征信信息", section_id="征信信息"),
            TaskItem(label="理由说明", kind="input", section_title="系统评级结论", section_id="系统评级结论"),
        ]
    )
    assert_true(pending_by_region(tl) == pending_by_section(tl), "region alias matches section map")
    assert_true(requires_region_declaration(tl), "multi-region requires declaration")
    assert_true(
        requires_section_declaration(tl) is True,
        "legacy requires_section_declaration alias",
    )

    form = (
        (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_save.py").read_text(encoding="utf-8")
        + (ROOT / "scripts/controller/actions/form_scan_actions.py").read_text(encoding="utf-8")
    )
    assert_true("pending_by_region" in form, "get_pending dual-writes pending_by_region")
    assert_true("err-region-required" in form, "err-region-required primary")
    assert_true("auto region=" in form, "auto region log")

    print("characterize-region-section-alias: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
