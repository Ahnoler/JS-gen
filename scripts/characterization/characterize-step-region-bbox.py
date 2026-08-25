#!/usr/bin/env python3
"""Characterize step region/bbox persistence (recording-side region + coords)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_helpers_have_scroll_root_and_bbox() -> None:
    from scripts.controller.actions.js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS

    assert_true("function pickScrollRoot" in PAGE_LOCATOR_HELPERS, "helpers embed pickScrollRoot")
    assert_true("scrollHeight > best.scrollHeight" in PAGE_LOCATOR_HELPERS, "generic tallest-container scan")
    assert_true("function stepBBoxOf" in PAGE_LOCATOR_HELPERS, "helpers embed stepBBoxOf")
    assert_true("root.scrollTop" in PAGE_LOCATOR_HELPERS, "bbox uses content coords (scrollTop offset)")


def test_phase_screenshot_collect_uses_helpers_root() -> None:
    # collect 表达式不得再内联 pickScrollRoot（与 helpers 重复定义会语法冲突）
    src = (ROOT / "src/cdp/phase-screenshot-page.js").read_text(encoding="utf-8")
    assert_true("PICK_SCROLL_ROOT_FN" in src, "scroll expression keeps its own root fn")
    collect = src.split("buildPhaseScreenshotCollectExpression", 1)[1]
    assert_true("PICK_SCROLL_ROOT_FN" not in collect, "collect must not inline PICK_SCROLL_ROOT_FN (helpers provide it)")


def test_capture_has_region_bbox() -> None:
    from scripts.controller.actions import _js_snippets as sn

    js = sn.JS_CAPTURE_FROM_XPATH
    assert_true("assignRegion(host)" in js, "capture computes region via assignRegion")
    assert_true("stepBBoxOf(host)" in js, "capture computes bbox")
    assert_true("region_id: reg.region_id" in js, "capture returns region_id")
    assert_true("layers: Array.isArray(reg.layers)" in js, "capture returns layers")
    assert_true("bbox: stepBBoxOf(host)" in js, "capture returns bbox")


def test_enrich_has_region_bbox() -> None:
    from scripts.controller.actions import _js_snippets as sn

    js = sn.JS_ENRICH_CLICK_LOCATOR
    assert_true("assignRegion(el)" in js, "enrich computes region via assignRegion")
    assert_true("stepBBoxOf(el)" in js, "enrich computes bbox")
    assert_true("region_id: reg.region_id" in js, "enrich returns region_id")
    assert_true("bbox: stepBBoxOf(el)" in js, "enrich returns bbox")


def test_helpers_passthrough_region_bbox() -> None:
    src = (ROOT / "scripts/controller/actions/_helpers.py").read_text(encoding="utf-8")
    # 注意：_helpers.py 现有 dict 用双引号风格
    assert_true('"region_id": info.get("region_id")' in src, "_capture_element passes region_id")
    assert_true('"bbox": info.get("bbox")' in src, "_capture_element passes bbox")
    assert_true('"layers": info.get("layers")' in src, "_capture_element passes layers")
    assert_true('"region_label": info.get("region_label")' in src, "_capture_element passes region_label")


def test_helpers_passthrough_page_bbox_and_attr() -> None:
    """V3 rect_norm + attr 透传：_capture_element / _enrich_click_element 必须透传 page_bbox 和 attr。

    rect_norm 归一化依赖 page_bbox（document 坐标）；attr（disabled/required/readonly）为 V3
    控件条目新增布尔字段，需在采集点透传到 element_json。此前 _helpers.py 丢弃 page_bbox。
    """
    src = (ROOT / "scripts/controller/actions/_helpers.py").read_text(encoding="utf-8")
    assert_true('"page_bbox":' in src, "_capture_element / _enrich pass page_bbox (rect_norm input)")
    assert_true('"attr":' in src, "_capture_element / _enrich pass attr (disabled/required/readonly)")


def test_model_persists_attr_field() -> None:
    """ElementInfo 新增 attr 字段：声明 + to_element_json 输出 + from_record 白名单搬运。

    rect_norm 不经过模型（stamp 点直接写 dict），故此处只 pin attr；rect_norm 由
    characterize-page-level-python.py 的 state.py 子串断言覆盖。
    """
    src = (ROOT / "scripts/models/action.py").read_text(encoding="utf-8")
    assert_true("attr:" in src, "ElementInfo declares attr")
    assert_true("data['attr']" in src, "to_element_json emits attr")
    assert_true("'attr'" in src, "from_record passes attr via whitelist")

    from scripts.models.action import ActionEntry, ElementInfo

    elem_dict = {
        'tag': 'input', 'xpath_smart': '//input[@x]', 'xpath': '//input[@x]',
        'target_kind': 'form_input', 'formLabel': '客户号',
        'attr': {'disabled': False, 'required': True, 'readonly': False},
    }
    entry = ActionEntry.from_record('fill_form_field', {'label_text': '客户号', 'value': '1'}, 'ok', elem_dict)
    assert_true(entry.element.get('attr') == {'disabled': False, 'required': True, 'readonly': False},
                "from_record keeps attr")
    info = ElementInfo(**elem_dict)
    j = info.to_element_json()
    assert_true(j.get('attr') == {'disabled': False, 'required': True, 'readonly': False},
                "to_element_json keeps attr")


def test_model_persists_region_bbox() -> None:
    """落库模型必须保留 region/bbox：ElementInfo 字段 + to_element_json + from_record 穿透。
    （根因修复：models/action.py 白名单序列化曾丢弃 _capture_element 的 region/layers/bbox。）"""
    src = (ROOT / "scripts/models/action.py").read_text(encoding="utf-8")
    for name in ('region_id', 'region_label', 'layers', 'bbox'):
        assert_true(f"{name}:" in src, f"ElementInfo declares {name}")
        assert_true(f"data['{name}']" in src, f"to_element_json emits {name}")
    assert_true("'region_id', 'region_label'" in src, "from_record passes region keys")
    assert_true("entry.element['layers']" in src, "from_record passes layers")
    assert_true("entry.element['bbox']" in src, "from_record passes bbox")

    # 运行时验证：from_record 穿透 + to_element_json 输出
    from scripts.models.action import ActionEntry, ElementInfo

    elem_dict = {
        'tag': 'input', 'xpath_smart': '//input[@x]', 'xpath': '//input[@x]',
        'target_kind': 'form_input', 'formLabel': '客户号',
        'region_id': 'tab:A|section:B|titlebox:C',
        'region_label': 'A / B / C',
        'layers': ['tab:A', 'section:B', 'titlebox:C'],
        'bbox': {'x1': 1108, 'y1': 5184, 'x2': 1443, 'y2': 5216},
    }
    entry = ActionEntry.from_record('fill_form_field', {'label_text': '客户号', 'value': '1'}, 'ok', elem_dict)
    el = entry.element
    assert_true(el.get('region_id') == 'tab:A|section:B|titlebox:C', "from_record keeps region_id")
    assert_true(el.get('region_label') == 'A / B / C', "from_record keeps region_label")
    assert_true(el.get('layers') == ['tab:A', 'section:B', 'titlebox:C'], "from_record keeps layers")
    assert_true(el.get('bbox') == {'x1': 1108, 'y1': 5184, 'x2': 1443, 'y2': 5216}, "from_record keeps bbox")

    info = ElementInfo(**elem_dict)
    j = info.to_element_json()
    assert_true(j.get('region_id') == 'tab:A|section:B|titlebox:C', "to_element_json keeps region_id")
    assert_true(j.get('bbox') == {'x1': 1108, 'y1': 5184, 'x2': 1443, 'y2': 5216}, "to_element_json keeps bbox")
    assert_true(j.get('layers') == ['tab:A', 'section:B', 'titlebox:C'], "to_element_json keeps layers")


def test_node_copy_locator_meta_persists_bbox() -> None:
    """Node 侧 copyLocatorMeta 落库必须保留 bbox（直播录制持久化）。
    （根因修复：src/models/element.js 的 copyLocatorMeta 曾漏 bbox 复制，
    action_log_sync 带来的 bbox 在 prepareElementJson 归一化时被丢弃。）"""
    import subprocess

    src = (ROOT / "src/models/element.js").read_text(encoding="utf-8")
    assert_true("target.bbox" in src, "copyLocatorMeta copies bbox to normalized element")

    code = (
        "import {toElementJson} from './src/models/element.js';"
        "const j = toElementJson({tag:'input', text:'x', bbox:{x1:1,y1:2,x2:3,y2:4}, region_id:'r'});"
        "console.log(JSON.stringify(j.bbox), JSON.stringify(j.region_id));"
    )
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert_true(proc.returncode == 0, f"node -e toElementJson failed: {proc.stderr}")
    out = proc.stdout.strip()
    assert_true('"x1":1' in out and '"y2":4' in out, f"toElementJson output keeps bbox coords: {out}")
    assert_true('"r"' in out, f"toElementJson output keeps region_id: {out}")


def main() -> int:
    test_helpers_have_scroll_root_and_bbox()
    test_phase_screenshot_collect_uses_helpers_root()
    test_capture_has_region_bbox()
    test_enrich_has_region_bbox()
    test_helpers_passthrough_region_bbox()
    test_helpers_passthrough_page_bbox_and_attr()
    test_model_persists_region_bbox()
    test_model_persists_attr_field()
    test_node_copy_locator_meta_persists_bbox()
    print("characterize-step-region-bbox: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
