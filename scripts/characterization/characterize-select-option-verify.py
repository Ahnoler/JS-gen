#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Characterization: select_option write-verify (value-mismatch) + snapshot options.

Pins three coupled fixes for the same-prefix select bug (国民经济部门 vs
国民经济部门类别 — AI used the 部门 option 非金融企业部门 to fill the 部门类别
field whose options are 公司/非公司企业/其他非金融企业部门, triggering a heal loop):

1. JS_SELECT_OPTION (select_option.py) must read back the trigger input value
   after clicking and return 'value-mismatch | expected:<opt> | current:<rb>'
   when the readback differs from the expected option — not just 'ok:<label>'.
2. form_action_engines.py select_option must branch on 'value-mismatch', reset
   the select UI, re-trigger, and retry once; still mismatch → _err (heal).
3. form_scan_utils.py _save_form_snapshot checkpoint params must attach
   'options' to select-class fields that have a non-empty option list.

Run:
  python scripts/characterization/characterize-select-option-verify.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


# ── 1. JS_SELECT_OPTION readback verification ───────────────────────────────

SELECT_OPTION_PY = (
    ROOT / "scripts" / "controller" / "actions" / "js_snippets" / "select_option.py"
)


def test_js_select_option_has_readback_verify() -> None:
    js = SELECT_OPTION_PY.read_text(encoding="utf-8")
    # The verify function must exist and compare readback against expected.
    assert_true("verifyAfterClick" in js, "verifyAfterClick helper present")
    assert_true("readbackSelectedText" in js, "readbackSelectedText helper present")
    assert_true(
        "value-mismatch" in js,
        "value-mismatch return string present in JS_SELECT_OPTION",
    )
    # tryClick must be async and delegate to verifyAfterClick.
    assert_true(
        "const tryClick = async (item) =>" in js,
        "tryClick is async",
    )
    assert_true(
        "return await verifyAfterClick(t)" in js,
        "tryClick delegates to verifyAfterClick",
    )
    # The matching functions must be async (awaits tryClick).
    # matchInPool was split into exactMatchInPool + fuzzyMatchInPool for the
    # scroll-to-find-exact optimization (exact match at every scroll step,
    # fuzzy only after all scrolling exhausted).
    assert_true(
        "const exactMatchInPool = async (pickPool) =>" in js,
        "exactMatchInPool is async",
    )
    assert_true(
        "const fuzzyMatchInPool = async (pickPool) =>" in js,
        "fuzzyMatchInPool is async",
    )
    # The readback must sleep before reading (let Element UI settle).
    assert_true(
        "await sleep(250)" in js.split("verifyAfterClick")[1].split("tryClick")[0],
        "verifyAfterClick sleeps 250ms before readback",
    )
    # exactOnly path must use strict equality.
    assert_true(
        "if (exactOnly)" in js and "current === option" in js,
        "exactOnly uses strict equality on readback",
    )
    # Non-exactOnly must accept table-select name+digit prefix.
    assert_true(
        "current.startsWith(option)" in js,
        "non-exactOnly accepts table-select name+digit prefix readback",
    )


def test_js_select_option_all_return_points_verified() -> None:
    js = SELECT_OPTION_PY.read_text(encoding="utf-8")
    # Every exactMatchInPool return of tryClick must use await.
    match_start = js.find("const exactMatchInPool = async")
    match_end = js.find("};", match_start)
    match_body = js[match_start:match_end]
    assert_true(
        match_body.count("await tryClick") >= 2,
        "exactMatchInPool awaits tryClick at all return points (first-alias, exact)",
    )
    # fuzzyMatchInPool must await tryClick at its return point.
    fuzzy_start = js.find("const fuzzyMatchInPool = async")
    fuzzy_end = js.find("};", fuzzy_start)
    fuzzy_body = js[fuzzy_start:fuzzy_end]
    assert_true(
        "await tryClick" in fuzzy_body,
        "fuzzyMatchInPool awaits tryClick at return point",
    )
    # All top-level matching function call sites must use await.
    # The scroll loop calls exactMatchInPool at each step; fuzzyMatchInPool
    # is called once after scrolling; the catch block calls exactMatchInPool.
    assert_true(
        js.count("await exactMatchInPool") >= 2,
        "all exactMatchInPool call sites use await (initial + scroll/catch)",
    )
    assert_true(
        js.count("await fuzzyMatchInPool") >= 1,
        "fuzzyMatchInPool call site uses await",
    )


# ── 2. form_action_engines value-mismatch retry branch ──────────────────────

FORM_ENGINE = ROOT / "scripts" / "controller" / "actions" / "form_action_engines.py"


def test_form_engine_value_mismatch_branch() -> None:
    text = FORM_ENGINE.read_text(encoding="utf-8")
    # Locate select_option body.
    class_idx = text.find("class SelectEngine")
    assert_true(class_idx >= 0, "SelectEngine class present")
    fn_idx = text.find("async def select_option(", class_idx)
    assert_true(fn_idx >= 0, "select_option present in SelectEngine")
    end = text.find("class RadioEngine", fn_idx)
    assert_true(end > fn_idx, "RadioEngine boundary present after select_option")
    body = text[fn_idx:end]
    # value-mismatch branch must exist.
    assert_true(
        "value-mismatch" in body,
        "select_option has value-mismatch branch",
    )
    assert_true(
        "startswith('value-mismatch')" in body,
        "select_option checks value-mismatch prefix",
    )
    # The branch must reset select UI before retry.
    assert_true(
        "reset_select_ui" in body.split("value-mismatch")[1].split("option-not-found")[0],
        "value-mismatch branch resets select UI",
    )
    # The branch must re-trigger and retry JS_SELECT_OPTION.
    mm_start = body.find("startswith('value-mismatch')")
    mm_end = body.find("elif select_result.startswith('option-not-found:')")
    assert_true(mm_start >= 0 and mm_end > mm_start, "mismatch branch boundaries found")
    mismatch_section = body[mm_start:mm_end]
    assert_true(
        "JS_SELECT_TRIGGER_BY_XPATH" in mismatch_section,
        "value-mismatch branch re-triggers select",
    )
    assert_true(
        "JS_SELECT_OPTION" in mismatch_section,
        "value-mismatch branch retries JS_SELECT_OPTION",
    )
    # Retry guard must prevent infinite retry.
    assert_true(
        "_sel_mismatch_retry_" in body,
        "value-mismatch retry guard key present",
    )
    assert_true(
        "mismatch_retries > 1" in body,
        "value-mismatch retry guard limits to one retry",
    )
    # Still-mismatch must return protocol envelope (err_with) for heal.
    assert_true(
        "err_with(" in mismatch_section and "err-select-option-unresolved" in mismatch_section,
        "value-mismatch still-mismatch returns err_with protocol envelope for heal",
    )
    # Successful retry must record and return _ok.
    assert_true(
        "mismatch-retry" in body,
        "successful mismatch retry records mismatch-retry cue",
    )
    # 2026-08-27 escalation: when the alias-retry STILL mismatches, one final
    # strict attempt must run with exactOnly ([resolved, True]) — no fuzzy
    # fallback, verbatim readback required.
    assert_true(
        "JS_SELECT_OPTION, [resolved_option, True]" in mismatch_section,
        "value-mismatch branch escalates to exactOnly strict attempt",
    )
    assert_true(
        "mismatch-retry-exact" in mismatch_section,
        "exactOnly success records mismatch-retry-exact cue",
    )
    # The strict attempt resets + re-triggers before firing (dropdown state).
    exact_idx = mismatch_section.find("[resolved_option, True]")
    pre = mismatch_section[max(0, exact_idx - 800):exact_idx]
    assert_true(
        "reset_select_ui" in pre and "JS_SELECT_TRIGGER_BY_XPATH" in pre,
        "strict attempt preceded by reset + re-trigger",
    )


# ── 3. Snapshot options in form_scan_utils ──────────────────────────────────

FORM_SCAN_UTILS = ROOT / "scripts" / "controller" / "actions" / "form_scan_utils.py"
FORM_SNAPSHOT_MODEL = ROOT / "scripts" / "models" / "form_snapshot.py"


def test_snapshot_field_model_has_options() -> None:
    text = FORM_SNAPSHOT_MODEL.read_text(encoding="utf-8")
    assert_true(
        "options: list[str]" in text,
        "SnapshotField model has options field",
    )
    assert_true(
        "default_factory=list" in text.split("options: list[str]")[1].split(")")[0],
        "SnapshotField options has default_factory=list",
    )


def test_from_scan_fields_populates_options() -> None:
    text = FORM_SNAPSHOT_MODEL.read_text(encoding="utf-8")
    assert_true(
        "field_options" in text,
        "from_scan_fields builds field_options",
    )
    # Must filter by kind select/tree-select/tree.
    assert_true(
        ("'select'" in text or 'select' in text) and ("'tree-select'" in text or 'tree-select' in text) and ("'tree'" in text or 'tree' in text),
        "from_scan_fields filters options by select/tree-select/tree kind",
    )
    assert_true(
        "SnapshotField(" in text and "options=field_options" in text,
        "from_scan_fields passes options to SnapshotField",
    )


def test_save_form_snapshot_emits_options() -> None:
    text = FORM_SCAN_UTILS.read_text(encoding="utf-8")
    # The checkpoint params must conditionally attach options.
    assert_true(
        "f.options" in text,
        "_save_form_snapshot reads f.options",
    )
    assert_true(
        "entry['options']" in text,
        "_save_form_snapshot attaches options to field entry",
    )
    # Must only attach when options is non-empty.
    assert_true(
        "if f.options:" in text,
        "_save_form_snapshot attaches options only when non-empty",
    )


def test_snapshot_fingerprint_unaffected_by_options() -> None:
    text = FORM_SNAPSHOT_MODEL.read_text(encoding="utf-8")
    # fields_fingerprint must still use (label, is_required, xpath_smart).
    fp_start = text.find("def fields_fingerprint")
    fp_end = text.find("return tuple(", fp_start)
    fp_body = text[fp_start:fp_end + 220]
    assert_true(
        "f.label" in fp_body and "f.is_required" in fp_body and "f.xpath_smart" in fp_body,
        "fields_fingerprint uses label/is_required/xpath_smart (not options)",
    )
    assert_true(
        "f.options" not in fp_body,
        "fields_fingerprint does not include options (dedup unaffected)",
    )


def test_snapshot_options_round_trip() -> None:
    from scripts.models.form_snapshot import FormSnapshot, SnapshotField

    scan_fields = [
        {"label": "国民经济部门", "kind": "select", "required": True,
         "options": ["非金融企业部门", "金融机构"], "xpath_smart": "//div[1]"},
        {"label": "国民经济部门类别", "kind": "select", "required": True,
         "options": ["公司", "非公司企业", "其他非金融企业部门"], "xpath_smart": "//div[2]"},
        {"label": "企业名称", "kind": "input", "required": True, "xpath_smart": "//input[1]"},
    ]
    snap = FormSnapshot.from_scan_fields("main", scan_fields, 0)
    by_label = {f.label: f for f in snap.fields}
    assert_true(
        by_label["国民经济部门"].options == ["非金融企业部门", "金融机构"],
        "select field options populated",
    )
    assert_true(
        by_label["国民经济部门类别"].options == ["公司", "非公司企业", "其他非金融企业部门"],
        "second select field options populated independently",
    )
    assert_true(
        by_label["企业名称"].options == [],
        "non-select field has empty options",
    )
    # Fingerprint must not differ when only options change.
    fp1 = snap.fields_fingerprint
    scan_fields_no_opts = [
        {"label": "国民经济部门", "kind": "select", "required": True, "xpath_smart": "//div[1]"},
        {"label": "国民经济部门类别", "kind": "select", "required": True, "xpath_smart": "//div[2]"},
        {"label": "企业名称", "kind": "input", "required": True, "xpath_smart": "//input[1]"},
    ]
    snap2 = FormSnapshot.from_scan_fields("main", scan_fields_no_opts, 0)
    assert_true(
        snap2.fields_fingerprint == fp1,
        "fingerprint identical regardless of options (dedup stable)",
    )


# ── 4. Prompt guidance ──────────────────────────────────────────────────────

def test_prompts_have_same_prefix_guidance() -> None:
    form_prompt = (ROOT / "scripts/prompts/form-prompt.md").read_text(encoding="utf-8")
    field_rules = (ROOT / "scripts/prompts/agent-field-rules.md").read_text(encoding="utf-8")
    assert_true(
        "同前缀下拉字段" in form_prompt,
        "form-prompt.md has same-prefix dropdown guidance",
    )
    assert_true(
        "同前缀下拉字段" in field_rules,
        "agent-field-rules.md has same-prefix dropdown guidance",
    )
    assert_true(
        "禁止" in form_prompt and "options" in form_prompt,
        "form-prompt.md forbids cross-field option reuse",
    )


def test_protocol_envelopes_wired():
    src = (ROOT / "scripts/controller/actions/form_action_engines.py").read_text(encoding="utf-8")
    sel = src.split("class SelectEngine", 1)[1].split("class RadioEngine", 1)[0]
    fill = src.split("class FillEngine", 1)[1].split("class SelectEngine", 1)[0]
    assert_true("err-select-option-unresolved" in sel, "select tail envelope")
    assert_true('err-field-disabled' in fill and fill.count("err_with(") >= 2, "fill envelope both exits")
    assert_true("ok_marked(" in sel, "fallback success records semantic doubt")
    assert_true("_field_disabled_hint" not in fill, "legacy hint helper retired")


def main() -> int:
    test_js_select_option_has_readback_verify()
    test_js_select_option_all_return_points_verified()
    test_form_engine_value_mismatch_branch()
    test_snapshot_field_model_has_options()
    test_from_scan_fields_populates_options()
    test_save_form_snapshot_emits_options()
    test_snapshot_fingerprint_unaffected_by_options()
    test_snapshot_options_round_trip()
    test_prompts_have_same_prefix_guidance()
    test_protocol_envelopes_wired()
    print("characterize-select-option-verify: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())