"""Characterization: 字段 label 解析同族规范（归一化 + 精确优先），2026-09-16。

Born from a defect class that hit production three times: a form field is located
by matching its ``.el-form-item__label`` text with ``includes()`` and taking the
FIRST DOM hit, so a sibling whose label merely CONTAINS the target steals the
field —

    找「要素名称」命中「组件要素名称」
    找「国民经济部门」命中「国民经济部门类别」
    找「实际控制人客户编号」命中「实际控制人配偶客户编号」

Required-field asterisks compound it: Element UI renders a required field's label
as ``*要素名称``, so raw equality ``label === '要素名称'`` never fires and the
code silently falls through to the ``includes()`` branch.

House rule (reference implementation: ``select_trigger._tryItems``; frozen by
``cold/characterize-prefix-label-select.py`` and
``cold/characterize-prefix-label-xpath.py``):

    normalize → exact match wins immediately → first includes() fallback

Single source: ``js_snippets/base.py`` ``JS_FIELD_LABEL_NORM`` +
``JS_FIELD_ITEM_CANDIDATES``. This file pins (a) the shared resolvers' structure,
(b) that every consumer actually interpolates them, (c) that the old
first-includes-hit literals are gone, and (d) live behaviour on a real browser.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"),
)

JS = ROOT / "scripts/controller/actions/js_snippets"
BASE = (JS / "base.py").read_text(encoding="utf-8")
SELECT_TREE = (JS / "select_tree.py").read_text(encoding="utf-8")
FILL_CORE = (JS / "fill_core.py").read_text(encoding="utf-8")
SCAN_FORM = (JS / "scan_form.py").read_text(encoding="utf-8")
SELECT_DISPATCH = (ROOT / "scripts/controller/actions/select_dispatch.py").read_text(encoding="utf-8")
FILL_ENGINE = (ROOT / "scripts/controller/actions/fill_engine.py").read_text(encoding="utf-8")
MISC = (JS / "misc.py").read_text(encoding="utf-8")

failures: list[str] = []


def need(src: str, needle: str, where: str) -> None:
    if needle not in src:
        failures.append(f"MISSING {where} :: {needle!r}")


def ban(src: str, needle: str, where: str) -> None:
    if needle in src:
        failures.append(f"FORBIDDEN {where} :: {needle!r} (旧式首中即返的包含匹配)")


# ── 单一来源：归一化 + 候选排序 ─────────────────────────────────────────────
# 必填 * / 尾部冒号必须先剥掉，否则精确匹配永远不触发
need(BASE, ".replace(/^[*\\\\s]+/, '')", "JS_FIELD_LABEL_NORM 剥首必填 *")
need(BASE, "JS_FIELD_LABEL_NORM = '''(s) =>", "JS_FIELD_LABEL_NORM 定义")
need(BASE, "JS_FIELD_ITEM_CANDIDATES = '''(root, label, allowReverse) => {", "候选解析器定义")
need(BASE, "if (!want) return [];", "空 label 早返回")
need(BASE, "if (lab === want) exact.push(item);", "精确命中桶")
need(BASE, "else if (lab.includes(want)) fwd.push(item);", "包含命中桶")
need(BASE, "else if (allowReverse && want.includes(lab)) rev.push(item);", "反向包含桶（opt-in）")
need(BASE, "return exact.concat(fwd, rev);", "候选按 精确→包含→反向 排序返回")

# ── 各消费方必须真的走共享解析器 ─────────────────────────────────────────────
need(BASE, "const candidatesOf = ''' + JS_FIELD_ITEM_CANDIDATES + ''';", "base 自身接线")
need(BASE, "for (const item of candidatesOf(container, label)) {", "JS_LOCATOR 精确优先并用候选序")
need(BASE, "candidatesOf(container, label, true)", "JS_SMART_LOCATOR 精确优先 + 反向兜底")
ban(BASE, "if (t !== label && !t.includes(label)) continue;", "JS_LOCATOR 旧式包含匹配")

need(SELECT_TREE, "const candidatesOf = ''' + JS_FIELD_ITEM_CANDIDATES + ''';", "select_tree 接线")
need(SELECT_TREE, "const findItem = (root) => candidatesOf(root, label)[0] || null;", "JS_CLICK_RADIO 精确优先")
need(SELECT_TREE, "fieldItem = candidatesOf(container, label)[0] || null;", "JS_SELECT_TREE_OPTION 主容器")
need(SELECT_TREE, "fieldItem = candidatesOf(dlg, label)[0] || null;", "JS_SELECT_TREE_OPTION 弹窗兜底")
ban(SELECT_TREE, "if (l === label || l.includes(label)) { fieldItem = item; break; }", "select_tree 旧式内联匹配")
ban(SELECT_TREE, "if (lbl.includes(label)) return item;", "JS_CLICK_RADIO 旧式包含匹配")

need(FILL_CORE, "JS_FIELD_LABEL_NORM, JS_FIELD_ITEM_CANDIDATES", "fill_core 接线")
need(FILL_CORE, "const normLab = ''' + JS_FIELD_LABEL_NORM + ''';", "fill 归一化定义")
need(FILL_CORE, "if (normLab(lbl) !== wantN) continue;", "Pass 1 归一化精确匹配")
need(FILL_CORE, "if (labN === wantN) continue;", "Pass 2 仍跳过精确（不重试已试项）")
need(FILL_CORE, "if (!labN.includes(wantN)) continue;", "Pass 2 归一化包含匹配")
need(FILL_CORE, "for (const item of candidatesOf(document, label)) {", "JS_CLEAR_FIELD_VALUE 精确优先")

need(SCAN_FORM, "JS_FIELD_LABEL_NORM", "scan_form 接线")
need(SCAN_FORM, "const wantN = normLab(label);", "scan 归一化定义")
need(SCAN_FORM, "if (exact) { if (labN !== wantN) continue; }", "scan pass1 归一化精确匹配")
ban(SCAN_FORM, "if (exact) { if (lbl !== label) continue; }", "scan 旧式裸等值")

need(SELECT_DISPATCH, "from .js_snippets.base import JS_FIELD_ITEM_CANDIDATES", "select_dispatch 接线")
need(SELECT_DISPATCH, "const item = candidatesOf(root, want)[0];", "tssc 判定按精确优先解析字段")
ban(SELECT_DISPATCH, "if (l === want || l.includes(want)) {", "tssc 判定旧式首中即返（假阴性）")

need(MISC, "from .base import JS_FIELD_ITEM_CANDIDATES", "misc 接线")
need(MISC, "for (const item of candidatesOf(container, lbl)) {", "验证按钮按精确优先解析字段")
ban(MISC, "if (!t.includes(lbl)) continue;", "JS_CLICK_VERIFY_BUTTON 旧式包含匹配")

need(FILL_ENGINE, "from .js_snippets.base import JS_FIELD_ITEM_CANDIDATES", "fill_engine 接线")
need(FILL_ENGINE, "const fi = candidatesOf(document, label)[0] || null;", "kind probe 精确优先")
ban(FILL_ENGINE, "if (t && (t === want || t.includes(want))) { fi = it; break; }", "kind probe 旧式首中即返")
if FILL_ENGINE.count("candidatesOf(document, label)[0] || null") != 2:
    failures.append("fill_engine: 两处 kind probe 都应接线（录制 + 回放）")

# 未参与本轮的按文案匹配路径必须保持原样（选项/按钮/菜单/单元格不是字段定位）
need((JS.parent / "replay_js.py").read_text(encoding="utf-8"),
     "return t === want || t.includes(want);", "菜单项文案匹配保持原样（非同族）")


# ── 活页面行为：精确优先 vs 前缀兄弟 ────────────────────────────────────────
FIXTURE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>field label resolution</title>
<style>
  .el-form-item { display:flex; gap:8px; margin:8px 0; }
  .el-form-item__label { width:200px; }
</style></head><body>
<div class="el-form-item" id="fi-decoy">
  <label class="el-form-item__label">组件要素名称</label>
  <input id="in-decoy" class="el-input__inner" /></div>
<div class="el-form-item" id="fi-radio">
  <label class="el-form-item__label">*要素名称</label>
  <div class="el-radio-group">
    <label class="el-radio" id="radio-jia"><input type="radio" name="r1" /><span>甲</span></label>
    <label class="el-radio" id="radio-yi"><input type="radio" name="r1" /><span>乙</span></label>
  </div></div>
<div class="el-form-item" id="fi-rev">
  <label class="el-form-item__label">客户名称</label>
  <input id="in-rev" class="el-input__inner" /></div>
<div class="el-form-item" id="fi-verify-decoy">
  <label class="el-form-item__label">纳税人识别号（备）</label>
  <button id="btn-decoy">验证</button></div>
<div class="el-form-item" id="fi-verify">
  <label class="el-form-item__label">纳税人识别号</label>
  <button id="btn-exact">验证</button></div>
</body></html>
"""


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


async def _run_live() -> None:
    from playwright.async_api import async_playwright

    from scripts.controller.actions.js_snippets.base import (
        JS_FIELD_ITEM_CANDIDATES,
        JS_LOCATOR,
        JS_SMART_LOCATOR,
    )
    from scripts.controller.actions.js_snippets.select_tree import JS_CLICK_RADIO
    from scripts.controller.actions.js_snippets.misc import JS_CLICK_VERIFY_BUTTON

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(FIXTURE)

        # 1. 候选排序：精确（含 * 归一化）必须排在更靠前的包含命中之前
        order = await page.evaluate(
            "([js, label]) => eval(js)(document, label, true)"
            ".map(e => e.id)", [JS_FIELD_ITEM_CANDIDATES, "要素名称"],
        )
        check(order == ["fi-radio", "fi-decoy"],
              f"候选序应为 精确→包含, got {order}")

        # 2. 录制定位链：需求字段「要素名称」必须落在 *要素名称，而非前缀兄弟
        for name, js, args in (("JS_LOCATOR", JS_LOCATOR, "要素名称"),
                              ("JS_SMART_LOCATOR", JS_SMART_LOCATOR, ["要素名称"])):
            import json
            loc = json.loads(await page.evaluate(js, args))
            owner = await page.evaluate(
                "(xp) => { const n = document.evaluate(xp, document, null, 9, null)"
                ".singleNodeValue; if (!n) return null;"
                " const inp = n.querySelector ? (n.querySelector('input') || n) : n;"
                " return (inp.closest('.el-form-item') || {}).id || null; }",
                loc["xpath"])
            check(owner == "fi-radio", f"{name} 落在 {owner!r}, want 'fi-radio'")

        # 3. 反向包含仅在 opt-in 时兜底（查询比字段名长）
        check(await page.evaluate(JS_LOCATOR, "客户名称（全称）") == "",
              "JS_LOCATOR 不应走反向包含")
        loc_rev = json.loads(await page.evaluate(JS_SMART_LOCATOR, ["客户名称（全称）"]))
        owner_rev = await page.evaluate(
            "(xp) => { const n = document.evaluate(xp, document, null, 9, null)"
            ".singleNodeValue; if (!n) return null;"
            " const inp = n.querySelector ? (n.querySelector('input') || n) : n;"
            " return (inp.closest('.el-form-item') || {}).id || null; }",
            loc_rev["xpath"])
        check(owner_rev == "fi-rev", f"反向兜底丢失: {owner_rev!r}")

        # 4. radio：点「甲」必须点在 *要素名称 那组，而不是前缀兄弟（那组没有 radio）
        await page.evaluate(
            "() => { window.__hit = null;"
            " document.addEventListener('click', (e) => {"
            "   const fi = e.target.closest && e.target.closest('.el-form-item');"
            "   if (fi) window.__hit = fi.id; }, true); }")
        r = await page.evaluate(JS_CLICK_RADIO, ["要素名称", "甲"])
        check(r == "ok", f"JS_CLICK_RADIO got {r!r}")
        hit = await page.evaluate("() => window.__hit")
        check(hit == "fi-radio", f"radio 点到了 {hit!r}, want 'fi-radio'")
        checked = await page.evaluate(
            "() => document.querySelector('#radio-jia input').checked")
        check(checked is True, "「甲」未被选中")

        # 5. 验证按钮：精确字段的验证按钮先被点，前缀兄弟的不能抢
        await page.evaluate("() => { window.__hit = null; }")
        v = await page.evaluate(JS_CLICK_VERIFY_BUTTON, ["纳税人识别号"])
        check(v == "ok-verify-clicked", f"JS_CLICK_VERIFY_BUTTON got {v!r}")
        v_hit = await page.evaluate("() => window.__hit")
        check(v_hit == "fi-verify", f"验证按钮点到 {v_hit!r}, want 'fi-verify'")

        await browser.close()


def test_source_pins() -> None:
    pass  # 上面已完成，失败汇总在 failures


def test_live_exact_first() -> None:
    asyncio.run(_run_live())


def main() -> int:
    for f in failures:
        print(f)
    if failures:
        return 1
    test_source_pins()
    test_live_exact_first()
    print("characterize-field-label-resolution: OK "
          "(normalize + exact-first + includes fallback, live-verified)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
