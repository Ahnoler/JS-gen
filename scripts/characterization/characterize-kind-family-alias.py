#!/usr/bin/env python3
"""Characterize: kind 别名同族互认（A/B 移交 ①，744 门伪）。

A/B 实验 744：任务全程成功，但 reviewer LLM 写的 ``success.kinds=
['url_change','toast_ok']`` 与录制端实际产的 ``saved_navigation`` 同义不同名，
legacy 收尾门 ``has_contract_success`` 逐字精确匹配失败 → 伪 failed。boundary
路径早有归一先例（``boundary_gates.record_evidence`` 的族镜像 + ``observed_kinds``
展开）；本 pin 钉住 legacy 路径对齐同一证据等价类——**校验时同族互认（按证据
等价类判，不按名判）**：

- 模块级冻结等价类（只归组既有 kind，不新增 kind 值，成员与
  ``boundary_gates.py`` 镜像清单一致）：
  保存族 ``('toast_ok','url_change','saved_navigation')``、
  引入族 ``('picker_closed','dialog_confirmed','introduced_backfilled')``；
  其余 kind（query_clicked / page_opened / nav_next_clicked 等）各自单元素族。
- ``has_contract_success`` 三处消费点同族互认（函数签名与既有优先级不变）：
  744 形态（kinds url_change+toast_ok、token saved_navigation）→ True；
  反向（kinds saved_navigation、token url_change）→ True；
  ``_last_save_ok`` 对 kinds saved_navigation → True；
  ``_last_introduce_ok`` 对 kinds introduced_backfilled → True；
  token picker_closed 对 kinds dialog_confirmed → True；
- 假成功防线不松（负例）：query 族 token 不满足保存族要求；零证据不满足；
  跨族不互认（要求 confirm_click、只有 toast_ok）；
- 未知 kind 精确匹配不变（kinds toast_ok + token toast_ok → True）。

RED 纪律：实现前本 pin 的 5 个互认断言必红（744 形态=历史失败证据）。
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_CHECKS = 0
_FAILURES: list[str] = []


def check(cond, msg):
    """Counting assertion: record failure, keep running, return cond."""
    global _CHECKS
    _CHECKS += 1
    if cond:
        return True
    _FAILURES.append(msg)
    print(f"FAIL: {msg}")
    return False


SAVE_FAMILY = ('toast_ok', 'url_change', 'saved_navigation')
INTRODUCE_FAMILY = ('picker_closed', 'dialog_confirmed', 'introduced_backfilled')


def _gate_src() -> str:
    return (ROOT / "scripts/controller/actions/phase/intent_gates.py").read_text(encoding="utf-8")


def _boundary_src() -> str:
    return (ROOT / "scripts/controller/actions/phase/boundary_gates.py").read_text(encoding="utf-8")


def _store(kinds: list[str], tokens: list[dict] | None = None,
           last_save_ok: bool = False, last_introduce_ok: bool = False) -> dict:
    """构造 legacy 路径 business_data_store（无 _phase_boundary → 不走 boundary 分支）。"""
    store: dict = {
        '_phase_intent': {
            'mode': 'create',
            'refill': 'all_editable',
            'success': {'kinds': list(kinds)},
        },
        '_success_tokens': list(tokens or []),
    }
    if last_save_ok:
        store['_last_save_ok'] = True
    if last_introduce_ok:
        store['_last_introduce_ok'] = True
    return store


def test_source_needles() -> None:
    gate = _gate_src()
    boundary = _boundary_src()
    save_tuple = repr(SAVE_FAMILY)
    intro_tuple = repr(INTRODUCE_FAMILY)
    check(save_tuple in gate, f"intent_gates.py defines save-family tuple {save_tuple}")
    check(intro_tuple in gate, f"intent_gates.py define introduce-family tuple {intro_tuple}")
    # 成员一致性：族清单必须与 boundary_gates.py 既有镜像逐字相同（归一先例对齐）。
    check(save_tuple in boundary, f"boundary_gates.py mirror keeps save-family {save_tuple}")
    check(intro_tuple in boundary, f"boundary_gates.py mirror keeps introduce-family {intro_tuple}")
    check(
        "tok.get('kind') in kinds" not in gate,
        "no bare exact-match 'tok.get(kind) in kinds' residue in intent_gates.py",
    )


def _success():
    try:
        from scripts.controller.actions.phase.intent_gates import has_contract_success
        return has_contract_success
    except Exception as exc:  # noqa: BLE001 - pin must not crash on import failure
        check(False, f"intent_gates.has_contract_success importable ({exc})")
        return None


def test_alias_positive() -> None:
    fn = _success()
    if fn is None:
        return
    # 744 形态：reviewer kinds 与录制 token 同族不同名（修复前 False=RED 证据）。
    check(
        fn(_store(['url_change', 'toast_ok'],
                  tokens=[{'kind': 'saved_navigation', 'evidence': 'save-nav'}])) is True,
        "744 shape: kinds[url_change,toast_ok] + token saved_navigation -> True",
    )
    # 反向：互认必须双向。
    check(
        fn(_store(['saved_navigation'], tokens=[{'kind': 'url_change', 'evidence': 'x'}])) is True,
        "bidirectional: kinds[saved_navigation] + token url_change -> True",
    )
    # _last_save_ok 分支对保存族任一 kind 成立。
    check(
        fn(_store(['saved_navigation'], last_save_ok=True)) is True,
        "_last_save_ok=True + kinds[saved_navigation] -> True",
    )
    # 引入族：_last_introduce_ok 分支。
    check(
        fn(_store(['introduced_backfilled'], last_introduce_ok=True)) is True,
        "_last_introduce_ok=True + kinds[introduced_backfilled] -> True",
    )
    # 引入族：token 循环互认。
    check(
        fn(_store(['dialog_confirmed'], tokens=[{'kind': 'picker_closed', 'evidence': 'x'}])) is True,
        "token picker_closed + kinds[dialog_confirmed] -> True",
    )


def test_defense_not_loosened() -> None:
    fn = _success()
    if fn is None:
        return
    # query 族 token 不得满足保存族要求（单元素族不互认）。
    check(
        fn(_store(['toast_ok'], tokens=[{'kind': 'query_clicked', 'evidence': 'x'}])) is False,
        "kinds[toast_ok] + only query_clicked token -> False",
    )
    # 零证据不满足。
    check(
        fn(_store(['saved_navigation'])) is False,
        "non-empty kinds + zero evidence -> False",
    )
    # 跨族不互认：要求引入族、只有保存族 token。
    check(
        fn(_store(['confirm_click'], tokens=[{'kind': 'toast_ok', 'evidence': 'x'}])) is False,
        "cross-family: kinds[confirm_click] + only toast_ok token -> False",
    )
    # 跨族：_last_introduce_ok 不得满足保存族 kinds。
    check(
        fn(_store(['toast_ok'], last_introduce_ok=True)) is False,
        "_last_introduce_ok=True does not satisfy save-family kinds",
    )
    # 未知 kind 精确匹配不变。
    check(
        fn(_store(['toast_ok'], tokens=[{'kind': 'toast_ok', 'evidence': 'x'}])) is True,
        "exact same-kind match still True (unknown kinds exact-match unchanged)",
    )


def main() -> int:
    test_source_needles()
    test_alias_positive()
    test_defense_not_loosened()
    if _FAILURES:
        print(
            f"characterize-kind-family-alias: FAIL "
            f"({len(_FAILURES)}/{_CHECKS} checks failed)"
        )
        return 1
    print(f"characterize-kind-family-alias: OK {_CHECKS} passed")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
