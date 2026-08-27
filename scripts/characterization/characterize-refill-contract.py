#!/usr/bin/env python3
"""Characterization for the modify-refill tie-breaker contract.

Pins the F1-F4 terminal text from
docs/superpowers/specs/2026-08-27-modify-refill-tiebreaker.md so a future
revert of the "泛指 → all_editable" tie-breaker, or a regression that
reintroduces the self-contradictory "每个可编辑字段" line in the partial-modify
hint, turns the refactoring gate red immediately. Substring / structure
assertions against the live source files — no LLM, no live browser.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

ENC = "utf-8"

PROMPTS_PHASE_REVIEWER = ROOT / "scripts" / "prompts" / "phase-reviewer-prompt.md"
PROMPTS_PY = ROOT / "scripts" / "controller" / "actions" / "phase" / "prompts.py"
AGENT_TOOLS_FORM = ROOT / "scripts" / "prompts" / "agent-tools-form.md"


def _read(path: Path) -> str:
    return path.read_text(encoding=ENC)


def _slice_def(src: str, def_name: str) -> str:
    """Return the source slice of ``def <def_name>`` up to the next top-level ``def ``.

    Splits on a newline immediately followed by ``def `` so the slice ends right
    before the next sibling function definition (matching the
    ``\\ndef `` boundary used by the spec).
    """
    marker = f"def {def_name}"
    start = src.find(marker)
    assert start != -1, f"missing def {def_name}"
    next_def = src.find("\ndef ", start + len(marker))
    assert next_def != -1, f"no closing def after {def_name}"
    return src[start:next_def]


def test_reviewer_prompt_tiebreaker() -> None:
    src = _read(PROMPTS_PHASE_REVIEWER)

    # F2 — new rule 9 exists.
    assert "9. **泛指 vs 点名判定基准**" in src, "rule 9 tie-breaker header missing"

    # F2 — anti-castration phrasing.
    assert "宁可全量覆盖录入" in src, "宁可全量覆盖录入 missing"
    assert "业务数据键数少 ≠ 部分修改" in src, "业务数据键数少 ≠ 部分修改 missing"

    # F1 — rule 4 line replaced: no longer the old unconditional partial-modify
    # phrasing, and now carries 逐个点名.
    assert "**部分修改**（只改个别字段）" not in src, "old rule 4 line still present"
    assert "逐个点名" in src, "逐个点名 missing in rule 4"

    # Rule 2/3 mode mapping still present (create / modify → all_editable).
    assert "`mode=create`，`allow_form_assistant=true`，`refill=all_editable`" in src, (
        "create → all_editable mapping drifted"
    )
    assert "`mode=modify`，`allow_form_assistant=true`，`refill=all_editable`" in src, (
        "modify → all_editable mapping drifted"
    )

    # The "模式判定规则" section must contain exactly 9 numbered top-level list
    # items (rules 1..9). Slice the section by its heading boundaries and count
    # lines matching ^N. ** at column 0.
    section_match = re.search(
        r"(模式判定规则).*?(?=\n## |\Z)", src, flags=re.S
    )
    assert section_match is not None, "模式判定规则 section not found"
    section = section_match.group(0)
    nums = re.findall(r"(?m)^([0-9]+)\. \*\*", section)
    assert nums == [str(i) for i in range(1, 10)], (
        f"expected 9 numbered rules in 模式判定规则, got {nums}"
    )


def test_partial_modify_hint_consistency() -> None:
    src = _read(PROMPTS_PY)

    # F3 — form_modify_partial_hint exists and is rewritten.
    hint = _slice_def(src, "form_modify_partial_hint")
    assert "【任务类型：表单修改 — 部分字段】" in hint, (
        "partial-modify title not updated to — 部分字段"
    )
    assert "对任务点名的可编辑字段必须执行写动作" in hint, (
        "task-named write-action clause missing"
    )
    assert "err-save-validation" in hint, (
        "err-save-validation save-intercept prescription missing"
    )
    # Key negative assertion: the self-contradictory "每个可编辑字段" blanket
    # line must be gone from the partial-modify hint.
    assert "每个可编辑字段" not in hint, (
        "每个可编辑字段 still present in partial-modify hint (contradiction not removed)"
    )

    # Task-level routing: task_mode_hint still routes force_refill_all →
    # force_refill_hint, else form_modify_partial_hint (route must not drift).
    task_hint_src = _slice_def(src, "task_mode_hint")
    assert (
        "force_refill_hint() if force_refill_all else form_modify_partial_hint()"
        in task_hint_src
    ), "task_mode_hint routing drifted"

    # force_refill_hint still carries the all-fields title (symmetric counterpart).
    force_hint = _slice_def(src, "force_refill_hint")
    assert "【任务类型：表单修改 — 全部字段】" in force_hint, (
        "force_refill_hint all-fields title missing"
    )


def test_agent_tools_form_doc_conditional() -> None:
    src = _read(AGENT_TOOLS_FORM)

    # F4 — new conditional description anchored on the contract `refill`.
    assert "写入范围以合约 `refill` 为准" in src, (
        "contract-anchored write-scope clause missing"
    )
    assert "`all_editable`=对每个可编辑字段执行写动作" in src, (
        "all_editable = per-field write clause missing"
    )

    # F4 — old unconditional sentence must no longer be present (count first
    # occurrence; if absent the count is 0).
    old_unconditional = "**表单修改：** 对每个可编辑字段执行写动作（"
    assert src.count(old_unconditional) == 0, (
        "old unconditional 表单修改 sentence still present"
    )

    # Lines 48/59 existing "只改任务点名的字段" clauses are preserved (>= 2).
    named_lines = [ln for ln in src.splitlines() if "只改任务点名的字段" in ln]
    assert len(named_lines) >= 2, (
        f"expected >=2 lines with 只改任务点名的字段, got {len(named_lines)}"
    )


def main() -> None:
    test_reviewer_prompt_tiebreaker()
    test_partial_modify_hint_consistency()
    test_agent_tools_form_doc_conditional()
    print("characterize-refill-contract: OK")


if __name__ == "__main__":
    sys.exit(main())
