"""Cold pin (traj #864 fill side): fill tssc live-recheck three-state downgrade.

Companion to the select-side fix (216b2688, characterize-tssc-route-conflict):
fill_engine.py's kind gate was only-promote — with a store snapshot
kind=tssc-multi-select it never even ran the live probe and hard-rejected
fill_form_field, so fill and select_option bounced
err-use-tssc-multi-select <-> no-tssc-multi-select (7 steps, no convergence).

Contract:
1. Structured three-state live probe, record + replay gate blocks
   byte-identical: 'tssc-multi-select' | 'tree-select' | 'plain' |
   'unresolved' | 'ambiguous'. The old merged ``''`` return (unresolved /
   ambiguous / plain collapsed) must be gone.
2. Downgrade: store kind == 'tssc-multi-select' AND live == 'plain'
   (deterministic denial: probe resolved exactly one field item with no
   tssc/tree descendant) -> clear kind, one stderr line
   '[fill][tssc-route-conflict] store kind=... live=plain label=...', proceed.
3. Hard rejects stay: live hit tssc/tree promotes and rejects
   (err-use-tssc-multi-select / err-use-select-tree-option — traj #696
   blind-typing guard); live 'unresolved'/'ambiguous' keeps the store-kind
   rejection (select-side fall-through already guarantees no fill<->select
   loop).
4. Behavior smoke (replay mode, _FakePage like characterize-tssc-route-conflict):
   plain -> no err + marker logged; live tssc / unresolved / ambiguous ->
   rejected as before; store-unknown + live tssc -> promote-reject intact.
"""
import asyncio
import io
import sys
from contextlib import redirect_stderr
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FILL = ROOT / "scripts/controller/actions/fill_engine.py"

GATE_START = "kind = lookup_field_kind(self.business_data_store, label_text)"
GATE_END = "if kind == 'tssc-multi-select':"

FAILURES: list[str] = []


def fail(msg: str) -> None:
    FAILURES.append(msg)
    print(f"FAIL: {msg}")


def check_needles() -> None:
    """Source needles: three-state probe + downgrade branch in BOTH segments."""
    src = FILL.read_text(encoding="utf-8")
    exact_counts = {
        "[fill][tssc-route-conflict]": 2,
        "store_kind = kind": 2,
        "if store_kind not in ('tssc-multi-select', 'tree-select'):": 2,
        "elif store_kind == 'tssc-multi-select' and live == 'plain':": 2,
        "live = 'unresolved'": 2,
        "return 'plain';": 2,
        "return 'unresolved';": 2,
        "return 'ambiguous';": 2,
        "if live in ('tssc-multi-select', 'tree-select'):": 2,
        # 共享 pick 接线必须仍是两段各一处（模块级常量提取会破坏
        # characterize-field-label-resolution 的 count==2 pin，禁止）。
        "const pick = ''' + JS_FIELD_ITEM_PICK + ''';": 2,
    }
    for needle, want in exact_counts.items():
        got = src.count(needle)
        if got != want:
            fail(f"needle {needle!r} count {got} != {want}")
    # 硬拒护栏（traj #696）必须仍在两段存活。
    for needle in ("err-use-tssc-multi-select", "err-use-select-tree-option"):
        if src.count(needle) < 2:
            fail(f"hard-reject needle {needle!r} must survive in both segments")
    # 旧合并态（未解析/歧义/plain 合并返回 ''）必须消失。
    merged = "if (!field || field.ambiguous || !field.item) return '';"
    if merged in src:
        fail("old merged-empty probe return still present; three-state split missing")
    # 旧「store kind 已是 tssc 就不探测」的门必须移除（否则降级永不生效）。
    old_gate = "if kind not in ('tssc-multi-select', 'tree-select'):"
    if old_gate in src:
        fail("old skip-gate 'if kind not in (...)' still present; live probe must run for store-kind tssc")


def check_gate_blocks_identical() -> None:
    """Record + replay gate blocks (probe + downgrade) must be byte-identical."""
    src = FILL.read_text(encoding="utf-8")
    blocks = []
    i = src.find(GATE_START)
    while i != -1:
        j = src.index(GATE_END, i)
        blocks.append(src[i:j])
        i = src.find(GATE_START, i + 1)
    if len(blocks) != 2:
        fail(f"expected exactly 2 kind-gate blocks, got {len(blocks)}")
        return
    if blocks[0] != blocks[1]:
        fail("record/replay kind-gate blocks diverged; edit both sides in lockstep")


class _FakePage:
    """Stub page: dispatch by unique source tokens of the evaluated JS."""

    def __init__(self, live: str):
        self._live = live

    async def evaluate(self, script, *args):
        s = str(script)
        if 'el-loading-mask' in s:
            return False  # JS_CHECK_LOADING
        if '此网站不支持安全连接' in s:
            return 'none'  # https-first interstitial probe
        if "'unresolved'" in s and "return 'plain';" in s:
            return self._live  # shared three-state live field-kind probe
        if 'err-date-range-value-required' in s:
            return 'ok'  # JS_FILL_FORM_FIELD label attempt
        raise RuntimeError('unexpected script in fill-tssc-downgrade smoke stub')

    async def wait_for_timeout(self, ms):
        return None


def _run_smoke(store: dict, live: str) -> tuple[str, str]:
    from scripts.controller.actions.form_engine_base import (
        _ReplayAutofillStub,
        _ReplayPageAdapter,
    )
    from scripts.controller.actions.fill_engine import FillEngine

    engine = FillEngine(
        _ReplayPageAdapter(_FakePage(live)), store, _ReplayAutofillStub(),
    )
    err = io.StringIO()
    with redirect_stderr(err):
        result = asyncio.run(engine.fill_form_field(
            '客户名称', '客户A', mode='replay',
        ))
    text = result if isinstance(result, str) else str(result)
    return text, err.getvalue()


_TSSC_STORE = {
    '_scan_fields': [
        {
            'label': '客户名称',
            'kind': 'tssc-multi-select',
            'xpath_smart': '',
        }
    ],
}


def check_behavior_downgrade() -> None:
    """store kind=tssc + live plain -> proceed + [fill][tssc-route-conflict]."""
    text, stderr = _run_smoke(_TSSC_STORE, 'plain')
    if text.startswith('err-use-tssc-multi-select'):
        fail(f"behavior: live plain must downgrade, got {text[:120]!r}")
    if not text.startswith('ok'):
        fail(f"behavior: live plain must proceed to the fill path, got {text[:120]!r}")
    if '[fill][tssc-route-conflict]' not in stderr:
        fail("behavior: missing '[fill][tssc-route-conflict]' stderr marker on downgrade")
    if 'live=plain' not in stderr:
        fail("behavior: downgrade marker must carry 'live=plain'")


def check_behavior_hard_rejects() -> None:
    """store kind=tssc + live tssc/unresolved/ambiguous -> still rejected."""
    for live in ('tssc-multi-select', 'unresolved', 'ambiguous'):
        text, stderr = _run_smoke(_TSSC_STORE, live)
        if text != 'err-use-tssc-multi-select':
            fail(
                f"behavior(live={live}): store-kind tssc must stay rejected, "
                f"got {text[:120]!r}"
            )
        if '[fill][tssc-route-conflict]' in stderr:
            fail(f"behavior(live={live}): no downgrade marker allowed")


def check_behavior_promote_guard() -> None:
    """store unknown + live tssc -> promote and reject (traj #696 guard intact)."""
    text, _ = _run_smoke({}, 'tssc-multi-select')
    if text != 'err-use-tssc-multi-select':
        fail(f"behavior: store-unknown + live tssc must promote-reject, got {text[:120]!r}")
    text, _ = _run_smoke({}, 'plain')
    if not text.startswith('ok'):
        fail(f"behavior: store-unknown + live plain must proceed, got {text[:120]!r}")


def main() -> int:
    check_needles()
    check_gate_blocks_identical()
    check_behavior_downgrade()
    check_behavior_hard_rejects()
    check_behavior_promote_guard()
    if FAILURES:
        print(f"FAILED: characterize-fill-tssc-live-downgrade ({len(FAILURES)} failure(s))")
        return 1
    print("ok: characterize-fill-tssc-live-downgrade")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
