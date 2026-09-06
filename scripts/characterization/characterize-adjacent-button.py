#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Characterization: click_adjacent_button multi-item matching + adjacent snapshot
formLabel fix.

Pins two coupled fixes for the same-prefix-label bug (实际控制人客户编号 vs
实际控制人配偶客户编号 — the former has no button, the latter holds 选择):

1. form_action_engines.py click_adjacent_button evaluate JS must collect ALL
   form-items whose label includes the target (exact-match first, then partial),
   continue past button-less items, and only return 'no-adjacent-button-found'
   after every match is exhausted (never short-circuit on the first match).
2. page-locator-helpers.js buildLocatorSnap must, for kind==='adjacent_button',
   derive formLabel from the button's own .el-form-item label (overriding a
   hint that names a button-less sibling). The Python mirror
   (_locator_helpers_js.py) must carry the same block (generated, not hand-edited).

Run:
  python scripts/characterization/characterize-adjacent-button.py
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


# ── 1. click_adjacent_button evaluate JS ─────────────────────────────────────

FORM_ENGINE = ROOT / "scripts" / "controller" / "actions" / "form_action_engines.py"


def test_form_engine_multi_item_matching() -> None:
    text = FORM_ENGINE.read_text(encoding="utf-8")
    # Keyword button list must still be present.
    assert_true("'选择'" in text and "'引入'" in text and "'上传'" in text,
                "keyword button list preserved")
    assert_true("'添加'" in text and "'导入'" in text and "'新增'" in text,
                "keyword button list preserved (add/import/new)")
    # Exact-match collection + ordering (exact first, then partial).
    assert_true("lbl.trim() === label" in text,
                "exact-match flag recorded per item")
    assert_true("exact.concat(partial)" in text,
                "exact-first then partial ordering")
    # Locate the evaluate block and assert post-loop fallback semantics.
    eval_start = text.find("result = await page.evaluate('''([label]) => {")
    assert_true(eval_start > 0, "evaluate block start found")
    eval_end = text.find("}''', [label_text])", eval_start)
    assert_true(eval_end > eval_start, "evaluate block end found")
    block = text[eval_start:eval_end]
    # The no-button fallback must be the post-loop return guarded by
    # matchedAny (set before the loop, consumed only after it), proving the
    # loop does not short-circuit on a button-less item.
    assert_true("matchedAny ? 'no-adjacent-button-found'" in block,
                "post-loop no-button fallback guarded by matchedAny")
    assert_true("'label-not-found'" in block,
                "no-match fallback returns 'label-not-found'")
    # The ordered-items loop must exist and its body must rely on continue /
    # fall-through rather than an early no-adjacent return. Assert the loop is
    # present and that exactly one 'no-adjacent-button-found' occurs in the
    # whole block, located in the post-loop matchedAny return (its index must
    # be after the loop header).
    loop_open = block.find("for (const item of ordered)")
    assert_true(loop_open >= 0, "ordered-items loop found")
    nfa_idx = block.find("'no-adjacent-button-found'")
    assert_true(nfa_idx >= 0, "'no-adjacent-button-found' present in block")
    assert_true(nfa_idx > loop_open,
                "'no-adjacent-button-found' is after the loop (post-loop fallback)")
    assert_true(block.count("'no-adjacent-button-found'") == 1,
                "exactly one 'no-adjacent-button-found' (no in-loop early return)")
    # A continue-style fall-through is implied: the loop body has no return of
    # 'no-adjacent-button-found' (covered by the count check above) and the
    # real button may live in a same-prefix sibling, so the loop must iterate
    # all ordered items. Assert the keyword-driven click path returns ok-clicked.
    assert_true("btn.click(); clicked = true; break" in block,
                "keyword click sets clicked and breaks inner tag loop")
    assert_true("if (clicked) return 'ok-clicked'" in block,
                "keyword click success returns ok-clicked")


def test_form_engine_disabled_no_button_skip() -> None:
    """Disabled field with no adjacent button (hasButton empty) must be a
    non-recordable ok-skip — same structure as already-filled.

    The skip branch must:
    - live AFTER the already-filled branch (so a filled disabled field still
      reports already-filled), and BEFORE the click evaluate (so replay does
      not reach 'no-adjacent-button-found' → fail / trigger heal);
    - check info.get('disabled') and an empty hasButton;
    - return _ok(f'disabled-no-adjacent-button | <label>') (non-ok message,
      same _ok wrapper + non-recordable semantics as already-filled).
    """
    text = FORM_ENGINE.read_text(encoding="utf-8")
    # Marker strings present.
    assert_true("disabled-no-adjacent-button" in text,
                "disabled-no-adjacent-button skip marker present")
    assert_true("info.get('disabled')" in text,
                "disabled check uses info.get('disabled')")
    assert_true("hasButton" in text,
                "hasButton field consulted for skip")
    # The skip return must be structurally identical to already-filled:
    # return _ok(f'disabled-no-adjacent-button | {label_text}')
    assert_true(
        "return _ok(f'disabled-no-adjacent-button | {label_text}')" in text,
        "disabled skip returns _ok with non-ok prefix message (same structure as already-filled)",
    )
    # Ordering: the disabled skip branch must come after the already-filled
    # branch. Locate the already-filled return and the disabled return in the
    # click_adjacent_button body and assert index ordering.
    fn_start = text.find("async def click_adjacent_button")
    assert_true(fn_start > 0, "click_adjacent_button function found")
    # Bound the search to this function body (next top-level class def).
    nl = chr(10)
    after_fn = text.find(nl + "class ", fn_start)
    fn_body = text[fn_start:after_fn] if after_fn > 0 else text[fn_start:]
    already_idx = fn_body.find("'already-filled | ")
    disabled_idx = fn_body.find("disabled-no-adjacent-button")
    assert_true(already_idx > 0, "already-filled marker found in function body")
    assert_true(disabled_idx > 0, "disabled-no-adjacent-button marker found in function body")
    assert_true(disabled_idx > already_idx,
                "disabled skip branch is after the already-filled branch")
    # The disabled check must reference both disabled and hasButton, and the
    # branch must be inside the try block that parses check_info (guard the
    # assertion to the region just after already-filled, before the click eval).
    already_ret = fn_body.find("return _ok(f'already-filled")
    click_eval = fn_body.find("result = await page.evaluate('''([label]) => {", disabled_idx)
    assert_true(already_ret > 0, "already-filled return found")
    assert_true(click_eval > disabled_idx, "click evaluate is after disabled skip")
    region = fn_body[already_ret:click_eval]
    assert_true("info.get('disabled')" in region,
                "disabled check is between already-filled return and click evaluate")
    assert_true("hasButton" in region,
                "hasButton check is between already-filled return and click evaluate")


# ── 2. buildLocatorSnap adjacent_button formLabel override ───────────────────

PAGE_HELPERS = ROOT / "src" / "cdp" / "page-locator-helpers.js"
PY_MIRROR = ROOT / "scripts" / "controller" / "actions" / "js_snippets" / "_locator_helpers_js.py"


def _assert_adjacent_label_override(text: str, src: str) -> None:
    assert_true("kind === 'adjacent_button'" in text,
                f"{src}: adjacent_button kind branch present")
    assert_true("ownItem = host.closest('.el-form-item')" in text,
                f"{src}: host's own form-item located")
    assert_true(
        "ownLbl = ownItem && ownItem.querySelector('.el-form-item__label, label')"
        in text,
        f"{src}: own form-item label queried",
    )
    assert_true("derived = normalizeFormLabel" in text and "ownLbl" in text,
                f"{src}: derived label normalized from own label")
    assert_true("if (derived) formLbl = derived" in text,
                f"{src}: derived label overrides hint formLbl")


def test_page_helpers_adjacent_override() -> None:
    _assert_adjacent_label_override(
        PAGE_HELPERS.read_text(encoding="utf-8"), "page-locator-helpers.js"
    )


def test_py_mirror_adjacent_override() -> None:
    text = PY_MIRROR.read_text(encoding="utf-8")
    assert_true("Auto-generated" in text, "mirror is generated")
    _assert_adjacent_label_override(text, "_locator_helpers_js.py")


def main() -> None:
    test_form_engine_multi_item_matching()
    test_form_engine_disabled_no_button_skip()
    test_page_helpers_adjacent_override()
    test_py_mirror_adjacent_override()
    print("ok: characterize-adjacent-button (engine multi-item + disabled-skip + snapshot formLabel override)")


if __name__ == "__main__":
    main()
