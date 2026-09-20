#!/usr/bin/env python3
"""Characterization: click completion evidence symmetry (S4 + S5, 2026-09-18).

Pins two symmetric gaps in G3 click-completion evidence (query_clicked /
nav_next_clicked):

- S4 ``boundary_gates._NEXT_BTN_RE`` must accept 「上一步/返回上一步」 —
  wizard back-step phases sign the ``nav_next_clicked`` contract
  (compile_boundary success_when), so a successful prev-step click must
  produce the token; otherwise the done gate can never be satisfied
  (soft infinite loop).
- S5 ``ClickEngine.click_button`` success path must call
  ``maybe_record_click_completion_evidence`` — the only wired path was
  ``click_element_by_index``, so a click_button-driven 「查询」 left query
  phases permanently short of the done token.

Three groups:
  a) source shape (read_text): ``_NEXT_BTN_RE`` contains 上一步;
     ``click_button`` method body calls ``maybe_record_click_completion_evidence``
  b) behavior: ``maybe_record_click_completion_evidence(btn_label='上一步'/
     '返回上一步')`` records nav_next_clicked; wizard-back task compiles to
     navigate role with nav_next_clicked in success_when (contract side);
     live ClickEngine.click_button('查询') on a real headless Chromium page
     records query_clicked (pattern reused from characterize-g3-done-gate-live)
  c) counter-examples: 「取消」「关闭」 record neither query_clicked nor
     nav_next_clicked (unit + live click_button('取消'))
"""
from __future__ import annotations

import asyncio
import contextlib
import io
import os
import sys
from pathlib import Path

# Windows consoles / verify-all redirects default to GBK; the ✓/✗/— output would
# raise UnicodeEncodeError and turn this gate red for the wrong reason. Force
# UTF-8 with replacement (no logic change).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("AI_PHASE_BOUNDARY", "1")
os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"),
)

from scripts.controller.actions._phase_boundary import (  # noqa: E402
    apply_phase_boundary,
    compile_boundary,
    maybe_record_click_completion_evidence,
    observed_kinds,
    phase_done_ok,
)
from scripts.controller.actions.click_action_engine import ClickEngine  # noqa: E402

QUERY_TASK = "查询客户信息。预期结果：列表出现该客户。"
WIZARD_PREV_TASK = "点击上一步，返回向导上一页。预期结果：返回向导上一页。"

FIXTURE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>query page</title></head><body>
<div class="el-form-item">
  <label class="el-form-item__label">客户名称</label>
  <input class="el-input__inner" id="kw" />
</div>
<button type="button" class="el-button" id="btn-query">查询</button>
<button type="button" class="el-button" id="btn-cancel">取消</button>
<table><tbody><tr class="el-table__row"><td>客户A</td></tr></tbody></table>
</body></html>"""

results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"  {'✓' if ok else '✗'} {name}" + (f" — {detail}" if detail else ""))


def _method_src(text: str, header: str) -> str:
    """Extract a method source segment: header line → next same-indent def."""
    start = text.find(header)
    if start < 0:
        return ""
    candidates = [
        x for x in (
            text.find("\n    async def ", start + len(header)),
            text.find("\n    def ", start + len(header)),
        )
        if x > 0
    ]
    end = min(candidates) if candidates else len(text)
    return text[start:end]


class _BrowserContext:
    def __init__(self, page) -> None:
        self._page = page

    async def get_current_page(self):
        return self._page


def _shape_pins() -> None:
    gates = (ROOT / "scripts/controller/actions/phase/boundary_gates.py").read_text(
        encoding="utf-8"
    )
    next_line = next(
        (ln for ln in gates.splitlines() if ln.startswith("_NEXT_BTN_RE = ")), ""
    )
    record(
        "S4: _NEXT_BTN_RE 认「上一步」",
        "上一步" in next_line,
        next_line or "(line missing)",
    )

    engine = (
        ROOT / "scripts/controller/actions/click_action_engine.py"
    ).read_text(encoding="utf-8")
    click_button_src = _method_src(engine, "async def click_button(")
    record(
        "S5: click_button 函数体内调用 maybe_record_click_completion_evidence",
        "maybe_record_click_completion_evidence" in click_button_src,
        f"body_len={len(click_button_src)}",
    )
    # The call must sit on the success path: inside the `_is_ok_result`
    # branch of click_button, not in any error branch of the same method.
    after_ok = (
        click_button_src.split("if _is_ok_result(result):", 1)[1]
        if "if _is_ok_result(result):" in click_button_src
        else ""
    )
    record(
        "S5: 取证调用位于 click_button 成功收口点（_is_ok_result 分支之后）",
        bool(after_ok) and "maybe_record_click_completion_evidence" in after_ok,
        "",
    )


def _contract_and_record_pins() -> None:
    # Contract side (already signed by compile_boundary — pin keeps it true):
    # a wizard back-step task compiles to navigate + nav_next_clicked contract.
    b_prev = compile_boundary(WIZARD_PREV_TASK)
    record(
        "S4 合同侧: 上一步任务编译为 navigate + nav_next_clicked",
        b_prev.get("role") == "navigate"
        and "nav_next_clicked" in (b_prev.get("success_when") or []),
        f"role={b_prev.get('role')} success_when={b_prev.get('success_when')}",
    )

    # Evidence side: clicking 上一步 / 返回上一步 must earn the token.
    store_prev: dict = {}
    apply_phase_boundary(store_prev, WIZARD_PREV_TASK)
    kinds_prev = maybe_record_click_completion_evidence(
        store_prev, btn_label="上一步"
    )
    record(
        "S4: 点击「上一步」产出 nav_next_clicked",
        "nav_next_clicked" in kinds_prev,
        f"kinds={kinds_prev} observed={sorted(observed_kinds(store_prev))}",
    )
    ok_prev, miss_prev = phase_done_ok(store_prev)
    record(
        "S4: 上一步证据满足向导回退 done 门禁",
        ok_prev is True,
        f"missing={miss_prev}",
    )

    store_prev2: dict = {}
    apply_phase_boundary(store_prev2, WIZARD_PREV_TASK)
    kinds_prev2 = maybe_record_click_completion_evidence(
        store_prev2, btn_label="返回上一步"
    )
    record(
        "S4: 点击「返回上一步」产出 nav_next_clicked",
        "nav_next_clicked" in kinds_prev2,
        f"kinds={kinds_prev2}",
    )

    # Counter-examples (unit level): non nav/query labels record nothing.
    store_c1: dict = {}
    apply_phase_boundary(store_c1, QUERY_TASK)
    kinds_c1 = maybe_record_click_completion_evidence(store_c1, btn_label="取消")
    store_c2: dict = {}
    apply_phase_boundary(store_c2, WIZARD_PREV_TASK)
    kinds_c2 = maybe_record_click_completion_evidence(store_c2, btn_label="关闭")
    record(
        "反例: 「取消」「关闭」不产出 query_clicked/nav_next_clicked",
        kinds_c1 == [] and kinds_c2 == [],
        f"取消→{kinds_c1} 关闭→{kinds_c2}",
    )


async def _live_pins() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(FIXTURE)

        # Live click_button('查询') on a query-boundary store → query_clicked.
        store_q: dict = {}
        apply_phase_boundary(store_q, QUERY_TASK)
        engine_q = ClickEngine(_BrowserContext(page), store_q)
        buf_q = io.StringIO()
        with contextlib.redirect_stderr(buf_q):
            res_q = await engine_q.click_button("查询")
        ok_res = isinstance(res_q, object) and str(
            getattr(res_q, "extracted_content", res_q)
        ).startswith("ok")
        record(
            "S5 活体: click_button(查询) 点击成功",
            bool(ok_res),
            f"result={str(getattr(res_q, 'extracted_content', res_q))[:60]}",
        )
        record(
            "S5 活体: click_button(查询) 写入 query_clicked 证据",
            "query_clicked" in observed_kinds(store_q),
            f"observed={sorted(observed_kinds(store_q))}",
        )

        # Live counter-example: click_button(取消) must record no tokens.
        store_c: dict = {}
        apply_phase_boundary(store_c, QUERY_TASK)
        engine_c = ClickEngine(_BrowserContext(page), store_c)
        buf_c = io.StringIO()
        with contextlib.redirect_stderr(buf_c):
            res_c = await engine_c.click_button("取消")
        ok_c = str(getattr(res_c, "extracted_content", res_c)).startswith("ok")
        kinds_c = observed_kinds(store_c)
        record(
            "反例 活体: click_button(取消) 成功但不产出 query_clicked/nav_next_clicked",
            ok_c and not (kinds_c & {"query_clicked", "nav_next_clicked"}),
            f"ok={ok_c} observed={sorted(kinds_c)}",
        )

        await browser.close()


async def _run() -> None:
    _shape_pins()
    _contract_and_record_pins()
    await _live_pins()


def main() -> int:
    asyncio.run(_run())
    bad = [r for r in results if not r[1]]
    if bad:
        print(f"characterize-click-evidence-symmetry: FAILED ({len(bad)}/{len(results)})")
        return 1
    print(f"characterize-click-evidence-symmetry: OK ({len(results)} checks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
