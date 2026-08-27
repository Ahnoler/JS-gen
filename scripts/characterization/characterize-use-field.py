#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Characterize: use 推荐字段全链 + 处方覆盖 + 阶段末疑点并入.
Run: ./python/python.exe scripts/characterization/characterize-use-field.py
"""
from __future__ import annotations
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)

def test_use_pipeline():
    fld = (ROOT / "scripts/models/field.py").read_text(encoding="utf-8")
    tsk = (ROOT / "scripts/models/task.py").read_text(encoding="utf-8")
    scan = (ROOT / "scripts/controller/actions/form_scan_actions.py").read_text(encoding="utf-8")
    llm = (ROOT / "scripts/controller/actions/_llm_values.py").read_text(encoding="utf-8")
    rules = (ROOT / "scripts/prompts/agent-field-rules.md").read_text(encoding="utf-8")
    assert_true('use: str = Field(' in fld, "ScannedField.use")
    assert_true("recommend_action_for_kind" in scan, "computed at write site")
    assert_true('field.get("use"' in tsk or 'field.get(\'use\'' in tsk, "from_scanned passthrough")
    assert_true("use:" in llm, "llm line carries use")
    assert_true("use=" in rules, "prompt rule added")

def test_prescriptions():
    dfu = (ROOT / "scripts/controller/actions/duplicate_failure_cue.py").read_text(encoding="utf-8")
    from scripts.controller.actions.duplicate_failure_cue import duplicate_failure_prescription as rx
    for code in ("select-option-unresolved", "field-disabled", "button-not-found-in-row",
                 "table-row-not-found", "icon-label-miss", "icon-label-ambiguous"):
        assert_true(f"'err-{code}'" in dfu, f"prescription table entry err-{code}")
        assert_true(rx(f"err-{code} | anything").startswith("[纠偏]"), f"lookup hits {code}")

def test_service_doubt_gate():
    svc = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    assert_true("_semantic_doubts" in svc and "semantic_doubt_fields" in svc, "wiring present")

def main() -> int:
    test_use_pipeline()
    test_prescriptions()
    test_service_doubt_gate()
    print("characterize-use-field: OK")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
