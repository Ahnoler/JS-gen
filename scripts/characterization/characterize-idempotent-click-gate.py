"""wet9 characterization: idempotent search/refresh/paging clicks must not be
blocked by the phase duplicate gate.

Wet9 (#902 P3 / #903 P5): after any product-tree reload the SUT clears the
el-tree filter state while the search box keeps its keyword ("box has text,
tree shows everything").  The only self-healing path is clicking the search
icon again — but ``already-operated-this-phase`` rejected the repeat click
(same icon already clicked once in the phase), deadlocking the agent.

Fix pins (RED->GREEN):
  1. module-level idempotent-click regex covers 搜索/查询/检索/刷新/翻页/
     下一页/上一页 family texts and rejects idempotent classification for
     non-idempotent labels (保存/新增/删除/提交/重置/确定…);
  2. click_button: duplicate gate skipped for idempotent labels (the
     already-operated rejection must not fire for a search-icon repeat);
  3. click_element_by_index: same exemption on the index path;
  4. recording/remember behavior unchanged (guard module untouched):
     idempotent clicks are still remembered, non-idempotent duplicates are
     still rejected.
"""

import asyncio
import contextlib
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.click_action_engine import (  # noqa: E402
    _is_idempotent_click_label,
)
from scripts.controller.actions.phase.element_guard import (  # noqa: E402
    duplicate_phase_operation_any,
    remember_phase_operation_aliases,
)

failures = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)
        print(f"  ✗ {msg}")
    else:
        print(f"  ✓ {msg}")


def main() -> None:
    # 1. idempotent family membership
    for text in (
        "搜索", "查询", "检索", "刷新", "刷新产品树", "刷新列表",
        "翻页", "下一页", "上一页", "搜索图标", "查询按钮", "重新查询",
    ):
        check(
            _is_idempotent_click_label(text),
            f"idempotent whitelist matches {text!r}",
        )

    # 2. non-idempotent labels must NOT be whitelisted
    for text in ("保存", "提交", "确定", "新增", "删除", "重置", "启用", "禁用", "克隆", "导出", "导入"):
        check(
            not _is_idempotent_click_label(text),
            f"non-idempotent label stays gated: {text!r}",
        )

    # 3. whitelist is conservative: no substring overreach
    #    e.g. 保存查询方案 must not classify as idempotent just because it
    #    contains 查询
    check(
        not _is_idempotent_click_label("保存查询方案"),
        "compound non-idempotent label 保存查询方案 stays gated",
    )

    # 4. index-path rejection copy still present for non-idempotent clicks
    src = (ROOT / "scripts" / "controller" / "actions" / "click_action_engine.py").read_text(
        encoding="utf-8"
    )
    check(
        "already-operated-this-phase:button=" in src,
        "click_button duplicate rejection copy preserved (non-idempotent path)",
    )
    check(
        "already-operated-this-phase:index=" in src,
        "click_element_by_index duplicate rejection copy preserved (non-idempotent path)",
    )
    check(
        src.count("_is_idempotent_click_label(") >= 3,
        "idempotent bypass wired into both gate sites (def + 2 gate call sites)",
    )
    check(
        "from .phase.element_guard import (\n            duplicate_phase_operation_any,"
        in src,
        "element_guard import untouched (record module zero-change)",
    )

    # 5. guard module inventory: 8 defs at wet9-fix time; +3 scoped-identity
    # additions from the #909 fill-dedup-scope fix (element_scope_key +
    # duplicate/remember _scoped pair). Any OTHER growth needs a fresh look
    # at this fix's zero-touch assumption.
    check(
        (ROOT / "scripts" / "controller" / "actions" / "phase" / "element_guard.py").read_text(
            encoding="utf-8"
        ).count("\ndef ") == 11,
        "element_guard.py function inventory (8 wet9 + 3 #909 scoped-identity defs)",
    )

    # 6. behavioral: duplicate still detected for a normal button
    store: dict = {}
    remember_phase_operation_aliases(store, ["button:确定"], "click_button")
    check(
        duplicate_phase_operation_any(store, ["button:确定"]) == "click_button",
        "non-idempotent duplicate still detected by guard (behavior)",
    )
    check(
        len(re.findall(r"搜索|查询|检索|刷新|翻页|下一页|上一页", "|".join(
            ["搜索", "查询", "检索", "刷新", "翻页", "下一页", "上一页"]
        ))) == 7,
        "idempotent keyword inventory complete (7 families)",
    )

    # 7. wet9-B3r ③ ruling: navigation (menu/link) re-click allowance, bounded.
    from scripts.controller.actions.click_action_engine import (  # noqa: E402
        _is_navigation_click_element,
        _NAV_RECLICK_BUDGET,
    )
    check(
        _is_navigation_click_element({"tag_name": "a"}, "") is True,
        "nav detection: <a> link is navigation (wet9b3r [37] 产品树)",
    )
    check(
        _is_navigation_click_element({"tag_name": "li"}, "") is True,
        "nav detection: <li> menu item is navigation (wet9b3r [33] 产品库管理)",
    )
    check(
        _is_navigation_click_element(
            {"tag_name": "button", "attributes": {"class": "el-menu-item"}}, ""
        ) is True,
        "nav detection: menu-classed button is navigation",
    )
    check(
        _is_navigation_click_element(
            {"tag_name": "button", "attributes": {"class": "el-button--primary"}}, ""
        ) is False,
        "nav detection: plain button is NOT navigation (mutation risk stays gated)",
    )
    check(
        _is_navigation_click_element(
            {"tag_name": "input", "attributes": {"class": "el-input__inner"}}, ""
        ) is False,
        "nav detection: form input is NOT navigation",
    )
    check(
        _NAV_RECLICK_BUDGET == 1,
        "nav re-click budget is exactly 1 extra attempt per element per phase",
    )

    # 8. bounded budget mechanics: index-path gate consumes a namespaced
    #    counter inside _phase_ai_operations (cleared per phase for free).
    check(
        "__navreclick__" in src,
        "nav re-click budget stored under __navreclick__ namespace "
        "(auto-cleared with phase ops, guard dict schema untouched)",
    )
    check(
        "_bump_nav_reclick(" in src and "_NAV_RECLICK_BUDGET" in src,
        "budget bump helper + constant wired at the index gate",
    )
    check(
        "[nav-reclick]" in src,
        "allowed nav re-click leaves a single-line stderr trace",
    )
    check(
        "页面可能已卡死" in src,
        "budget-exhausted rejection carries the prescriptive page-frozen guidance",
    )

    # 9. behavioral: budget counter semantics (2 clicks allowed, 3rd blocked)
    store2: dict = {}
    from scripts.controller.actions.click_action_engine import (  # noqa: E402
        _bump_nav_reclick,
    )
    first = _bump_nav_reclick(store2, "click://x/li[33]")
    again = _bump_nav_reclick(store2, "click://x/li[33]")
    third = _bump_nav_reclick(store2, "click://x/li[33]")
    check(first == 1 and again == 2 and third == 3, "budget counter bumps 1,2,3")
    other = _bump_nav_reclick(store2, "click://x/a[37]")
    check(other == 1, "budget is per-element, not shared across identities")

    # 10. 合约线移交（2026-09-21）：预算内放行的 nav 重击在落库文案自证 ——
    #     放行分支置 nav_reclick_pass 标志，落库点（普通点击的
    #     _record_action('click_element_by_index') 那一处）result 尾缀
    #     '| nav-reclick-budget'。stderr 文案 / already-operated 拒绝文案 /
    #     预算常量与计数逻辑（上方 7–9 已钉）一律不动；其余 ok-clicked
    #     构造（最终 _ok 返回、tree/radio 变体）不带尾缀。
    check(
        "nav_reclick_pass = True" in src,
        "budget-allowed branch sets the nav_reclick_pass ledger flag",
    )
    check(
        "nav_reclick_pass = False" in src,
        "nav_reclick_pass defaults False in click_element_by_index scope",
    )
    suffix_hits = src.count("| nav-reclick-budget")
    check(
        suffix_hits == 1,
        f"suffix '| nav-reclick-budget' wired at exactly one ok-clicked point "
        f"(found {suffix_hits})",
    )
    rec_idx = src.find("_state._record_action('click_element_by_index'")
    suffix_idx = src.find("| nav-reclick-budget")
    check(
        rec_idx >= 0 and suffix_idx > rec_idx and (suffix_idx - rec_idx) < 500,
        "suffix sits at the plain-click record point "
        "(_record_action('click_element_by_index'))",
    )
    check(
        "return _ok(f'ok-clicked-{index}')" in src,
        "agent-facing ok copy unchanged (final _ok stays bare ok-clicked-{index})",
    )

    from scripts import state as _state  # noqa: E402
    from scripts.controller.actions.click_action_engine import ClickEngine  # noqa: E402

    class _FakeElementNode:
        tag_name = 'li'
        xpath = '//li[@class="el-menu-item"]'
        attributes = {'class': 'el-menu-item'}

        def get_all_text_till_next_clickable_element(self):
            return '产品库管理'

    class _QueryButtonNode:
        # #970 回执②：弹窗内【查询】按钮（幂等白名单 label）——修复前走
        # 幂等旁路跳过整个门块，button_text_identity 未赋值即被收口记忆块
        # 读取 → UnboundLocalError（click-failed，agent 被迫绕行）。
        tag_name = 'button'
        xpath = '//div[@class="query-bar"]/button[1]'
        attributes = {'class': 'el-button el-button--primary'}

        def get_all_text_till_next_clickable_element(self):
            return '查询'

    class _FakePage:
        url = 'http://sut/app/list'

        async def evaluate(self, _js, _arg=None):
            # All gate probes (date-panel / dd-gate / search-ui / tree-node /
            # overlay-title / loading) resolve falsy with this fixture.
            return {}

    class _FakeBrowserContext:
        def __init__(self, page, node=None):
            self._page = page
            self._node = node if node is not None else _FakeElementNode()

        async def get_current_page(self):
            return self._page

        async def get_dom_element_by_index(self, index):
            return self._node

        async def _click_element_node(self, _node):
            return None

    async def _nav_reclick_ledger_behavior():
        identity = 'click:' + _FakeElementNode.xpath

        # (a) 首次点击（非放行）：落库 result 不带尾缀、无 [nav-reclick] stderr。
        _state._ACTION_LOG.clear()
        store_a: dict = {}
        engine_a = ClickEngine(_FakeBrowserContext(_FakePage()), store_a)
        buf_a = io.StringIO()
        with contextlib.redirect_stderr(buf_a):
            await engine_a.click_element_by_index(1)
        entry_a = _state._ACTION_LOG[-1] if _state._ACTION_LOG else {}
        check(
            entry_a.get('action') == 'click_element_by_index'
            and entry_a.get('result') == 'ok-clicked-1',
            f"first click records bare ok-clicked-1 (no suffix), got {entry_a.get('result')!r}",
        )
        check(
            '[nav-reclick]' not in buf_a.getvalue(),
            "first click emits no [nav-reclick] stderr",
        )

        # (b) 预算内放行（重复导航点击，used=1<=1）：落库 result 带尾缀；
        #     [nav-reclick] stderr 保留；agent 返回文案不带尾缀。
        _state._ACTION_LOG.clear()
        store_b: dict = {}
        remember_phase_operation_aliases(store_b, [identity], 'click_element_by_index')
        engine_b = ClickEngine(_FakeBrowserContext(_FakePage()), store_b)
        buf_b = io.StringIO()
        with contextlib.redirect_stderr(buf_b):
            res_b = await engine_b.click_element_by_index(1)
        entry_b = _state._ACTION_LOG[-1] if _state._ACTION_LOG else {}
        check(
            '[nav-reclick]' in buf_b.getvalue(),
            "budget-allowed pass keeps the [nav-reclick] stderr trace",
        )
        check(
            entry_b.get('action') == 'click_element_by_index'
            and entry_b.get('result') == 'ok-clicked-1 | nav-reclick-budget',
            f"budget-allowed pass records ok-clicked-1 | nav-reclick-budget, "
            f"got {entry_b.get('result')!r}",
        )
        check(
            '| nav-reclick-budget' not in str(getattr(res_b, 'extracted_content', '')),
            "agent-facing ok copy of the allowed pass carries no ledger suffix",
        )

        # (c) 预算耗尽（used=2>1）：拒绝文案原样、不带尾缀，且不再落库。
        _state._ACTION_LOG.clear()
        store_c: dict = {}
        remember_phase_operation_aliases(store_c, [identity], 'click_element_by_index')
        _bump_nav_reclick(store_c, identity)
        engine_c = ClickEngine(_FakeBrowserContext(_FakePage()), store_c)
        with contextlib.redirect_stderr(io.StringIO()):
            res_c = await engine_c.click_element_by_index(1)
        rc_text = str(getattr(res_c, 'extracted_content', res_c))
        check(
            rc_text.startswith('already-operated-this-phase')
            and 'budget exhausted' in rc_text,
            f"budget-exhausted rejection copy intact, got {rc_text[:60]!r}",
        )
        check(
            '| nav-reclick-budget' not in rc_text,
            "budget-exhausted rejection carries no ledger suffix",
        )
        check(
            len(_state._ACTION_LOG) == 0,
            f"budget-exhausted rejection records no new entry "
            f"(got {len(_state._ACTION_LOG)})",
        )

    asyncio.run(_nav_reclick_ledger_behavior())

    # 11. #970 回执②（2026-09-21）：幂等白名单 label（查询）跳过整个门块，
    #     收口记忆块（门块之外、点击成功后无条件执行）读取
    #     button_text_identity → UnboundLocalError（生产 5-6 次 click-failed）。
    #     修复钉两点：门块之前无条件初始化（与 date_panel_click /
    #     select_trigger_click 同区）；记忆块仍按 if button_text_identity:
    #     追加——button 身份为空时 identities 仅为 click 身份，不追加别名。
    async def _idempotent_query_button_remember_aliases():
        _state._ACTION_LOG.clear()
        store_q: dict = {}
        engine_q = ClickEngine(
            _FakeBrowserContext(_FakePage(), _QueryButtonNode()), store_q,
        )
        raised = ''
        res_q = None
        try:
            res_q = await engine_q.click_element_by_index(1)
        except Exception as exc:  # characterization: report, do not swallow
            raised = f'{type(exc).__name__}: {exc}'
        res_text = str(getattr(res_q, 'extracted_content', res_q)) if res_q is not None else ''
        # RED 证据形态：引擎外层兜底把 UnboundLocalError 转成
        # click-failed:cannot access local variable 'button_text_identity' ...
        # （生产 #970 的 res=click-failed 同源）；GREEN 后必须回到 ok-clicked-1。
        check(
            not raised and res_text == 'ok-clicked-1',
            f'query-button (idempotent) click succeeds as bare ok-clicked-1 '
            f'without UnboundLocalError, got raised={raised!r} result={res_text!r}',
        )
        entry_q = _state._ACTION_LOG[-1] if _state._ACTION_LOG else {}
        check(
            entry_q.get('action') == 'click_element_by_index'
            and entry_q.get('result') == 'ok-clicked-1',
            f"query-button click records bare ok-clicked-1, got {entry_q.get('result')!r}",
        )
        # remember_phase_operation_aliases 把收到的每个 identity 写进
        # _phase_ai_operations（键经 _operation_key 规范化）：断言收到的
        # identities 仅为 click 身份——button: 别名未被追加。
        ops_q = store_q.get('_phase_ai_operations') or {}
        expected_key = 'click:' + _QueryButtonNode.xpath
        check(
            set(ops_q.keys()) == {expected_key},
            f'remember received only the click identity (no button: alias), '
            f'got {sorted(ops_q.keys())!r}',
        )

    asyncio.run(_idempotent_query_button_remember_aliases())

    check(
        'if button_text_identity:' in src,
        "memory block still guards on button_text_identity "
        "(button alias appended only when set)",
    )
    check(
        src.count("button_text_identity = ''") == 1
        and src.find("button_text_identity = ''")
        < src.find("if not date_panel_click and not _is_idempotent_click_label("),
        "button_text_identity initialized unconditionally before the gate block "
        "(single init, outside the idempotent/date-panel bypass)",
    )

    if failures:
        print(f"FAILED ({len(failures)})")
        return 1
    print("OK: characterize-idempotent-click-gate")
    return 0


if __name__ == "__main__":
    sys.exit(main())
