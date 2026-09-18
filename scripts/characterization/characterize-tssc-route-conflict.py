"""Pin B-1 (traj #864): tssc route conflict — select side must not bounce
store-kind tssc routes back as ``no-tssc-multi-select`` errors.

Contract (spec 2026-09-18-engine-pipeline-b123-fix-design §一/§1.3):
1. Fall-through: when select_dispatch routed tssc via store-cached kind
   (reason in ('target_kind', 'field_kind')) and the tssc executor denies on
   live re-check (result starts with 'no-tssc-multi-select'), SelectEngine
   must fall through to the existing el-select path instead of returning the
   denial, logging one stderr line prefixed '[tssc-route-conflict]'.
2. Non-fall-through paths (e.g. reason='live') keep the executor return, but
   the appended guidance must be a conflict pointer: kind cache vs live
   mismatch, scan_form_fields to refresh, do NOT fall back to fill_form_field,
   do NOT retry with identical params. The self-loop sentence
   'Use select_option for plain el-select, or report' must not exist in
   select_engine.py (executor js_snippets/tssc_multi_select.py keeps its
   original text untouched).
3. Cold-pin coexistence: ``return await self.tssc_multi_select(`` stays in
   select_engine.py (pinned by cold/characterize-tssc-multi-select.py).
"""
import asyncio
import io
import sys
from contextlib import redirect_stderr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

BANNED_SELF_LOOP = 'Use select_option for plain el-select'

FAILURES: list[str] = []


def fail(msg: str) -> None:
    FAILURES.append(msg)
    print(f"FAIL: {msg}")


def check_tssc_branch_fall_through() -> None:
    """Needles: store-kind route conflict falls through to el-select path."""
    src = (ROOT / "scripts/controller/actions/select_engine.py").read_text(
        encoding="utf-8"
    )
    start = src.index('if dispatch.path == "tssc":')
    end = src.index(
        '# tree path: select_option does not handle tree today', start
    )
    branch = src[start:end]
    for needle in (
        "dispatch.reason in ('target_kind', 'field_kind')",
        "startswith('no-tssc-multi-select')",
        "[tssc-route-conflict]",
        "fall through el-select",
    ):
        if needle not in branch:
            fail(f"tssc dispatch branch missing {needle!r}")
    # Cold-pin coexistence: direct call shape stays somewhere in the file.
    if "return await self.tssc_multi_select(" not in src:
        fail("select_engine.py lost 'return await self.tssc_multi_select(' needle")


def check_conflict_guidance_message() -> None:
    """Needles: no-tssc-multi-select guidance must redirect, not self-loop."""
    src = (ROOT / "scripts/controller/actions/select_engine.py").read_text(
        encoding="utf-8"
    )
    mstart = src.index("if res_s.startswith('no-tssc-multi-select'):")
    mend = src.index("if res_s.startswith('err-no-echo')", mstart)
    msg = src[mstart:mend]
    for needle in (
        "字段种类缓存与现场不一致",
        "scan_form_fields",
        "勿回退 fill_form_field",
        "勿用同参数重试",
    ):
        if needle not in msg:
            fail(f"no-tssc-multi-select guidance missing {needle!r}")
    if "fill_form_field(label_text" in msg or "next_action" in msg:
        fail("no-tssc-multi-select guidance must not steer next_action to fill")
    if BANNED_SELF_LOOP in msg:
        fail("no-tssc-multi-select guidance still contains the self-loop sentence")


def check_self_loop_sentence_scope() -> None:
    """The self-loop sentence is banned in select_engine.py, kept in executor."""
    engine = (ROOT / "scripts/controller/actions/select_engine.py").read_text(
        encoding="utf-8"
    )
    if BANNED_SELF_LOOP in engine:
        fail(
            "select_engine.py must not contain 'Use select_option for plain "
            "el-select' (executor tssc_multi_select.py owns the original text)"
        )
    executor = (
        ROOT / "scripts/controller/actions/js_snippets/tssc_multi_select.py"
    ).read_text(encoding="utf-8")
    if BANNED_SELF_LOOP not in executor:
        fail(
            "js_snippets/tssc_multi_select.py lost its original self-loop "
            "sentence (executor text must stay untouched)"
        )


class _FakePage:
    """Stub page: dispatch by unique source tokens of the evaluated JS."""

    async def evaluate(self, script, *args):
        s = str(script)
        if 'el-loading-mask' in s:
            return False  # JS_CHECK_LOADING
        if '此网站不支持安全连接' in s:
            return 'none'  # https-first interstitial probe
        if 'no-tssc-multi-select' in s:
            # JS_TSSC_MULTI_SELECT live denial. Deliberately WITHOUT the
            # executor's self-loop sentence so any occurrence in the final
            # result is attributable to select_engine.py's appended guidance.
            return 'no-tssc-multi-select | live 复核否认（桩）'
        if 'resolveField' in s:
            return True  # select_dispatch _JS_LIVE_TSSC live probe
        if 'visibleDropdowns' in s:
            return {'before': 0, 'after': 0, 'closed': True}  # JS_RESET_SELECT_UI
        if "return 'xpath-miss'" in s:
            return 'xpath-miss'  # JS_SELECT_VALUE_BY_XPATH
        if "return 'ok-triggered'" in s:
            return 'ok-triggered'  # JS_SELECT_TRIGGER_BY_XPATH
        if 'ddUsable' in s:
            return 'ok:客户A'  # JS_SELECT_OPTION
        raise RuntimeError('unexpected script in tssc-route-conflict smoke stub')

    async def wait_for_timeout(self, ms):
        return None


def _run_smoke(store: dict) -> tuple[str, str]:
    from scripts.controller.actions.form_engine_base import (
        _ReplayAutofillStub,
        _ReplayPageAdapter,
    )
    from scripts.controller.actions.select_engine import SelectEngine

    engine = SelectEngine(_ReplayPageAdapter(_FakePage()), store, _ReplayAutofillStub())
    err = io.StringIO()
    with redirect_stderr(err):
        result = asyncio.run(engine.select_option(
            '客户名称', '客户A', mode='replay',
        ))
    text = result if isinstance(result, str) else str(result)
    return text, err.getvalue()


def check_behavior_fall_through() -> None:
    """Store kind says tssc, executor live denies → el-select path must answer."""
    store = {
        '_scan_fields': [
            {
                'label': '客户名称',
                'kind': 'tssc-multi-select',
                'xpath_smart': '//*[@id="cust-name"]',
            }
        ],
    }
    result, stderr = _run_smoke(store)
    if not result.startswith('ok'):
        fail(
            "behavior: store-kind tssc route denied live must fall through to "
            f"el-select and succeed, got {result[:120]!r}"
        )
    if 'no-tssc-multi-select' in result:
        fail("behavior: no-tssc-multi-select denial leaked to the agent")
    if '[tssc-route-conflict]' not in stderr:
        fail("behavior: missing '[tssc-route-conflict]' stderr marker on fall-through")


def check_behavior_live_reason_keeps_guidance() -> None:
    """reason='live' still returns the executor denial, but with conflict guidance."""
    result, stderr = _run_smoke({})
    for needle in (
        'no-tssc-multi-select',
        '字段种类缓存与现场不一致',
        'scan_form_fields',
        '勿回退 fill_form_field',
        '勿用同参数重试',
    ):
        if needle not in result:
            fail(f"behavior(live reason): result missing {needle!r}, got {result[:120]!r}")
    if BANNED_SELF_LOOP in result:
        fail("behavior(live reason): self-loop sentence still returned to the agent")
    if '[tssc-route-conflict]' in stderr:
        fail("behavior(live reason): must return directly, not fall through")


def main() -> int:
    check_tssc_branch_fall_through()
    check_conflict_guidance_message()
    check_self_loop_sentence_scope()
    check_behavior_fall_through()
    check_behavior_live_reason_keeps_guidance()
    if FAILURES:
        print(f"FAILED: characterize-tssc-route-conflict ({len(FAILURES)} failure(s))")
        return 1
    print("ok: characterize-tssc-route-conflict")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
