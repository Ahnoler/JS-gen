"""Characterization: G3 done 门闩活体行为（PR #45 合并产物，2026-09-16）。

与既有 pin 的分工：`characterize-recorder-phase-reset` 钉**源码形状**（每个拒绝分支
必须 `return True`），本文件钉**运行期行为**——被合并的
`_guard_done_on_step_end` 本体 + 真 `compile_boundary`/`apply_phase_intent` 产出的
phase boundary + 真 Chromium 页面（页面块快照走真 JS）。

为什么必须有这一支：PR 原版把新增的零业务步拒绝分支写成裸 `return`，调用方
（`recorder.py` `if await _guard_done_on_step_end(...): return`）按 truthy 判定 →
None 被当成"未拒绝"而**静默放行** done。源码 pin 只看形状、PR 自带 pin 只测纯函数，
都抓不到"拒绝没生效"。这里 A2/A3 直接断言返回值 identity 为 True。

Four cases, all deterministic (local fixture, no SUT / no MySQL):
  A 0 业务步（仅 meta 动作）却自报成功 → 拒绝，且返回值必须是 True 而非 None
  B 真实点过「查询」并经 maybe_record_click_completion_evidence 写入证据 → 放行
  C 无 boundary 的普通阶段 → G3 门禁不介入
  D 0 业务步但 done(success=false) 诚实失败 → 放行（不得过度拒绝）
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

from scripts import state as action_state  # noqa: E402
from scripts.agent.recorder_emitters import _guard_done_on_step_end  # noqa: E402
from scripts.controller.actions._phase_boundary import (  # noqa: E402
    maybe_record_click_completion_evidence,
    observed_kinds,
    phase_done_ok,
)
from scripts.controller.actions._phase_intent import apply_phase_intent  # noqa: E402

QUERY_PHASE = "查询客户信息。预期结果：列表出现该客户。"
PHASE = 3

FIXTURE = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>query page</title></head><body>
<div class="el-form-item">
  <label class="el-form-item__label">客户名称</label>
  <input class="el-input__inner" id="kw" />
</div>
<button type="button" class="el-button" id="btn-query">查询</button>
<table><tbody><tr class="el-table__row"><td>客户A</td></tr></tbody></table>
</body></html>"""

results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"  {'✓' if ok else '✗'} {name}" + (f" — {detail}" if detail else ""))


class _MsgMgr:
    def __init__(self) -> None:
        self.messages: list[object] = []

    def _add_message_with_tokens(self, msg: object) -> None:
        self.messages.append(msg)


class _History:
    def __init__(self) -> None:
        self.history: list[object] = []


class _AgentState:
    def __init__(self) -> None:
        self.n_steps = 7
        self.history = _History()


class _BrowserContext:
    def __init__(self, page) -> None:
        self._page = page

    async def get_current_page(self):
        return self._page


class _AgentShim:
    """守卫只读这三处（grep 实证：browser_context / _message_manager / state）。"""

    def __init__(self, page) -> None:
        self.browser_context = _BrowserContext(page)
        self._message_manager = _MsgMgr()
        self.state = _AgentState()


class _DoneResult:
    """done() 的 ActionResult 形状：守卫读 success（显式标志）与 extracted_content。"""

    def __init__(self, content: str, success: bool = True) -> None:
        self.success = success
        self.extracted_content = content
        self.error = None


async def _call_guard(agent, store, *, done_success=True, text="已查询到该客户"):
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        out = await _guard_done_on_step_end(
            agent, [_DoneResult(text, success=done_success)], store,
        )
    return out, buf.getvalue()


def _set_actions(entries: list[dict]) -> None:
    action_state._ACTION_LOG.clear()
    action_state._ACTION_LOG.extend(entries)


async def _run() -> None:
    from playwright.async_api import async_playwright

    action_state._CURRENT_PHASE = PHASE

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(FIXTURE)
        agent = _AgentShim(page)

        # ── A：0 业务步（仅 meta）却自报成功 ────────────────────────────────
        store_a: dict = {}
        apply_phase_intent(store_a, QUERY_PHASE)
        store_a["_phase_start_action_len"] = 0  # 旧零动作门禁放行，隔离出 G3 门禁
        _set_actions([{"action": "get_page_state", "meta": {"phaseNumber": PHASE}}])
        ok_a, missing_a = phase_done_ok(store_a)
        res_a, err_a = await _call_guard(agent, store_a)

        record("G3 门禁确实被触发（证据未观测）",
               ok_a is False and bool(missing_a), f"missing={missing_a}")
        record("0 业务步自报成功 → 守卫拒绝", res_a is True, f"return={res_a!r}")
        record("拒绝值 identity 为 True（裸 return 会是 None 并被静默放行）",
               res_a is True, f"type={type(res_a).__name__}")
        record("拒绝原因是零业务步门禁",
               "zero business actions" in err_a,
               (err_a.strip().splitlines() or ["(无 stderr)"])[-1][:80])

        # ── B：真实「查询」点击证据 → 放行 ──────────────────────────────────
        store_b: dict = {}
        apply_phase_intent(store_b, QUERY_PHASE)
        store_b["_phase_start_action_len"] = 0
        _set_actions([
            {"action": "get_page_state", "meta": {"phaseNumber": PHASE}},
            {"action": "click_element_by_index", "meta": {"phaseNumber": PHASE}},
        ])
        # 真机点「查询」时 click_action_engine 调的就是这个函数
        kinds = maybe_record_click_completion_evidence(store_b, btn_label="查询")
        ok_b, missing_b = phase_done_ok(store_b)
        res_b, _ = await _call_guard(agent, store_b)

        record("点击「查询」写入 query_clicked 证据", "query_clicked" in kinds,
               f"observed={sorted(observed_kinds(store_b))}")
        record("证据齐备 → phase_done_ok", ok_b is True, f"missing={missing_b}")
        record("合法查询阶段不被误拒（放行）", res_b is False, f"return={res_b!r}")

        # ── C：无 boundary 的普通阶段 → G3 不介入 ───────────────────────────
        store_c: dict = {}
        _set_actions([{"action": "get_page_state", "meta": {"phaseNumber": PHASE}}])
        res_c, err_c = await _call_guard(agent, store_c)
        record("无 boundary 时 G3 不介入（仍放行）", res_c is False, f"return={res_c!r}")
        record("且不误报零业务步拒绝", "zero business actions" not in err_c)

        # ── D：0 业务步但诚实失败 → 放行 ────────────────────────────────────
        store_d: dict = {}
        apply_phase_intent(store_d, QUERY_PHASE)
        store_d["_phase_start_action_len"] = 0
        _set_actions([{"action": "get_page_state", "meta": {"phaseNumber": PHASE}}])
        res_d, err_d = await _call_guard(agent, store_d, done_success=False, text="预算耗尽")
        record("0 业务步但 done(success=false) → 放行（不过度拒绝诚实失败）",
               res_d is False, f"return={res_d!r}")
        record("且未误报零业务步拒绝", "zero business actions" not in err_d)

        await browser.close()


def main() -> int:
    asyncio.run(_run())
    bad = [r for r in results if not r[1]]
    if bad:
        print(f"characterize-g3-done-gate-live: FAILED ({len(bad)}/{len(results)})")
        return 1
    print(f"characterize-g3-done-gate-live: OK ({len(results)} checks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
