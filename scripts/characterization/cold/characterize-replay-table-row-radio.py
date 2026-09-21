"""Pin replay_table._replay_table_row_radio result head: a successful semantic
first-row fallback must not be preceded by a failed xpath attempt.

Regression (traj 969 step 5): the recorded `click_table_row_radio {row_text:'first'}`
structural xpath missed a fixed-column radio, the semantic controller fallback
clicked it (`ok|scope=`), but the returned string was prefixed with the failed
`click-failed:...` xpath result, so `_result_ok()` read FAIL and the step was
reported failed (then needlessly entered single-step heal).
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

FAILURES = []


def check(cond, msg):
    """Record a failure when cond is falsy (prints OK either way)."""
    if cond:
        print(f"  OK   {msg}")
    else:
        print(f"  FAIL {msg}")
        FAILURES.append(msg)


async def _noop(*_args, **_kwargs):
    return None


class _FakePage:
    """Minimal page: replay_table only needs wait_for_timeout (loading wait patched)."""

    async def wait_for_timeout(self, _ms):
        return None


async def _run():
    from scripts.controller.actions import replay_table as rt
    from scripts.controller.actions import _replay as rp

    # Patch the module-level collaborators; keep the real _result_ok / _element_xpath_smart.
    rt._wait_if_loading = _noop
    entry = {'element': {'xpath_smart': "//div[contains(@class,'el-table__body-wrapper')]//tr[1]//*[contains(@class,'el-radio')]"}}
    params = {'row_text': 'first'}
    controller_actions = {'click_table_row_radio': object()}

    # 1) xpath fails, semantic succeeds → overall OK (the regression).
    async def _fail_click(_page, _entry, _params):
        return "click-failed:not-found text='first' xpath=\"//div[...]//tr[1]//*[contains(@class,'el-radio')]\""

    async def _ok_semantic(_act, _params):
        return 'ok|scope= | loc:.el-table__row:has-text("first")'

    rt._replay_click_by_index = _fail_click
    rp._replay_controller_action = _ok_semantic
    out = await rt._replay_table_row_radio(
        _FakePage(), entry, params, controller_actions=controller_actions,
    )
    check(out.startswith('ok'), f"semantic fallback keeps ok head (got {out[:60]!r})")
    check(rp._result_ok('click_table_row_radio', out) is True,
          f"_result_ok accepts semantic fallback (got {out[:60]!r})")
    check('locate=semantic-fallback' in out, 'semantic-fallback locate marker kept')
    check('xpath-first-failed' in out, 'failed xpath kept as trailing diagnostic')

    # 2) xpath succeeds → ok head, locate=xpath-first, no semantic call needed.
    async def _ok_click(_page, _entry, _params):
        return 'ok-xpath-smart'

    async def _should_not_be_called(_act, _params):  # pragma: no cover
        raise AssertionError('semantic must not run when xpath-first succeeds')

    rt._replay_click_by_index = _ok_click
    rp._replay_controller_action = _should_not_be_called
    out2 = await rt._replay_table_row_radio(
        _FakePage(), entry, params, controller_actions=controller_actions,
    )
    check(out2.startswith('ok-xpath-smart'), f"xpath-first success head (got {out2!r})")
    check('locate=xpath-first' in out2, 'locate=xpath-first marker kept')

    # 3) xpath and semantic both fail → failure (no false ok).
    async def _fail_semantic(_act, _params):
        return 'err-no-row-match:first'

    rt._replay_click_by_index = _fail_click
    rp._replay_controller_action = _fail_semantic
    out3 = await rt._replay_table_row_radio(
        _FakePage(), entry, params, controller_actions=controller_actions,
    )
    check(rp._result_ok('click_table_row_radio', out3) is False,
          f"both-fail stays failed (got {out3[:60]!r})")


def main() -> int:
    asyncio.run(_run())
    if FAILURES:
        print(f"\ncharacterize-replay-table-row-radio: FAILED ({len(FAILURES)})")
        return 1
    print("\ncharacterize-replay-table-row-radio: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
