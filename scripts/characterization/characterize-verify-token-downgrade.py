#!/usr/bin/env python3
"""Characterize: persisted 合约纯核验型文本降级（verify-phase-token 主收口，设计稿 §6）。

方案 D 刀 2 后合约主路径=持久化快照：分析 LLM 直产 ``{v,mode,refill,
submitRequired,successWhen}`` 落库，录制侧 ``apply_persisted_phase_contract``
直接写 intent+boundary，跳过 compile/review 全链。#973 型纯核验阶段（重搜确认
已删对象不存在）被分析侧误标 ``submitRequired=true``（mode 亦可能误标
create/modify——持久化 mode 是被怀疑对象，不能作条件④侧证）后：收尾门误杀
（第一步门侧豁免的 mode 否决恰拦此形态）+ recovery 强推 click_save + 四族
消费方误发。修法 = persisted 消费点纯文本三条件降级：

- 纯函数 ``phase_contract_snapshot.downgrade_contract_for_verification``：
  三条件（①无保存线索 ②核验词根与宾语词 ±16 字符共现 ③写动词黑名单零命中
  宾语掩蔽）全中才降级；词表从冻结源 ``verification_gate`` 经共享 helper
  ``_text_conditions_pass`` import 复用（禁止复制副本）；降级动作 =
  ``submit.required=False`` + ``success.kinds=[]`` + ``boundary.success_when=[]``
  （boundary role 不动——role 降级牵动 section scope 面，且 success_when 清空后
  role 已无 token 语义），``source`` 打 'persisted_verify_downgraded' 标；
- 校准对（冻结判据，不是反推词表的素材）：
  阳性 #973「重搜确认三个已删除节点已不存在，无数据返回」+ create/modify
  假阳性合约 → 降级发生；
  对照 #924「重搜确认已删除节点不存在，然后删除新残留节点」→ 含写动词「删除」
  不降级（核验+写混合形态必须保留真实终态证据要求）；
  含保存线索 / 根与宾语相距 >16 字符 / 空/None task_text → 不降级；
  contract=None / boundary=None / 缺键 → 原样返回 False 不抛错；
- service.py 接线：persisted 分支有降级调用 + 'phase_contract=verify_downgraded'
  留痕；fallback 两路径（review / rules）无该调用（区段切片断言，零改动）；
- ``normalize_phase_contract`` 纯校验语义不受影响（与 Cursor pin 同语义）。

设计稿：docs/superpowers/specs/2026-09-21-verify-phase-token-caliber-design.md §6。
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


_T973 = "重搜确认三个已删除节点已不存在，无数据返回"
_T924 = "重搜确认已删除节点不存在，然后删除新残留节点"
# 「验证」与「已删除」间隔 17 字（>16 字符窗口）→ 条件②不成立 → 不降级（FN 可容忍）。
_T_FAR = "验证" + "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳甲" + "已删除记录"


def _snapshot_src() -> str:
    return (
        ROOT / "scripts/controller/actions/phase/phase_contract_snapshot.py"
    ).read_text(encoding="utf-8")


def _downgrade():
    try:
        from scripts.controller.actions.phase.phase_contract_snapshot import (
            downgrade_contract_for_verification,
        )
        return downgrade_contract_for_verification
    except Exception as exc:  # noqa: BLE001 - pin must not crash on missing module
        check(False,
              f"phase_contract_snapshot.downgrade_contract_for_verification importable ({exc})")
        return None


# ============================== 源码 needle 断言 ==============================


def test_source_needles_snapshot_module() -> None:
    src = _snapshot_src()
    check("def downgrade_contract_for_verification(" in src,
          "phase_contract_snapshot defines downgrade_contract_for_verification")
    check("from .verification_gate import _text_conditions_pass" in src,
          "snapshot module imports the shared text-triple from verification_gate "
          "(frozen wordlist single source)")
    check('("保存", "提交"' not in src,
          "no frozen wordlist value copy in phase_contract_snapshot.py")
    check("'persisted_verify_downgraded'" in src,
          "downgrade tags contract source 'persisted_verify_downgraded'")


def test_source_needles_service_wiring() -> None:
    src = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    check("downgrade_contract_for_verification(" in src,
          "service.py calls downgrade_contract_for_verification")
    check("phase_contract=verify_downgraded" in src,
          "service.py logs phase_contract=verify_downgraded")
    # 区段切片：persisted 分支含调用与留痕；review / rules 两 fallback 分支无该调用。
    persisted_idx = src.find("persisted = apply_persisted_phase_contract(")
    reviewed_idx = src.find("reviewed = await review_phase_contract(")
    rules_idx = src.find("mode = apply_task_mode(business_data_ref, phase_core)")
    end_idx = src.find("want_biz = (not heal_mode)", rules_idx)
    check(-1 < persisted_idx < reviewed_idx < rules_idx < end_idx,
          "branch anchors in order: persisted < review < rules < want_biz")
    if -1 < persisted_idx < reviewed_idx:
        persisted_slice = src[persisted_idx:reviewed_idx]
        check("downgrade_contract_for_verification(" in persisted_slice
              and "phase_contract=verify_downgraded" in persisted_slice,
              "persisted branch contains the downgrade call and verify_downgraded trace")
    if -1 < reviewed_idx < rules_idx:
        review_slice = src[reviewed_idx:rules_idx]
        check("downgrade_contract_for_verification" not in review_slice
              and "verify_downgraded" not in review_slice,
              "review fallback branch has no downgrade call (zero change)")
    if -1 < rules_idx < end_idx:
        rules_slice = src[rules_idx:end_idx]
        check("downgrade_contract_for_verification" not in rules_slice
              and "verify_downgraded" not in rules_slice,
              "rules fallback branch has no downgrade call (zero change)")


def test_source_needles_verifyall_registration() -> None:
    sh = (ROOT / "scripts/refactor/verify-all.sh").read_text(encoding="utf-8")
    check("characterize-verify-token-downgrade" in sh,
          "verify-all.sh registers characterize-verify-token-downgrade")


# ============================== 行为断言（校准对） ==============================


def _make_false_positive():
    """#973 型假阳性：分析侧把纯核验阶段误标 modify + submitRequired=true。

    经 ``apply_persisted_phase_contract`` 走真实路径产出 intent+boundary。
    """
    from scripts.controller.actions.phase.phase_contract_snapshot import (
        apply_persisted_phase_contract,
    )
    doc = {
        'v': 1, 'mode': 'modify', 'refill': 'none', 'submitRequired': True,
        'successWhen': ['toast_ok'], 'source': 'analyze',
    }
    store = {}
    contract = apply_persisted_phase_contract(store, doc)
    return contract, store['_phase_boundary']


def test_1_calibration_973_positive() -> None:
    """#973 阳性 + create/modify 假阳性合约 → 降级发生（弃条件④：mode 不作侧证）。"""
    fn = _downgrade()
    if fn is None:
        return
    contract, boundary = _make_false_positive()
    c2, b2, downgraded = fn(contract, boundary, _T973)
    check(downgraded is True, "#973 positive (false-positive modify contract) is downgraded")
    check(c2 is contract and b2 is boundary, "downgrade mutates in place and returns same objects")
    check(contract['submit']['required'] is False, "submit.required downgraded to False")
    check(contract['success']['kinds'] == [], "success.kinds cleared")
    check(boundary['success_when'] == [], "boundary.success_when cleared")
    check(boundary['role'] == 'maintain', "boundary role untouched (maintain kept)")
    check(contract['source'] == 'persisted_verify_downgraded',
          "source tagged persisted_verify_downgraded")


def test_2_calibration_924_control() -> None:
    """#924 对照：核验+写混合（含「删除」写动词）必须不降级。"""
    fn = _downgrade()
    if fn is None:
        return
    contract, boundary = _make_false_positive()
    c2, b2, downgraded = fn(contract, boundary, _T924)
    check(downgraded is False, "#924 control (verify + delete mixed) is not downgraded")
    check(c2 is contract and b2 is boundary, "no-downgrade returns the original objects as-is")
    check(contract['submit']['required'] is True, "#924: submit.required stays True")
    check(contract['success']['kinds'] == ['toast_ok'], "#924: success.kinds unchanged")
    check(boundary['success_when'] == ['toast_ok'], "#924: boundary.success_when unchanged")
    check(contract['source'] == 'persisted', "#924: source stays persisted")


def test_3_save_cue_and_window() -> None:
    """条件①/②边界：保存线索命中、根与宾语相距 >16 字符、根无宾语 → 不降级。"""
    fn = _downgrade()
    if fn is None:
        return
    contract, boundary = _make_false_positive()
    _c, _b, d = fn(contract, boundary, "确认已删除节点不存在，然后保存")
    check(d is False, "save cue 保存 present -> not downgraded")
    contract, boundary = _make_false_positive()
    _c, _b, d = fn(contract, boundary, _T_FAR)
    check(d is False, "root and object farther than 16 chars -> not downgraded (FN tolerable)")
    contract, boundary = _make_false_positive()
    _c, _b, d = fn(contract, boundary, "检查是否存在")
    check(d is False, "verify root without object word -> not downgraded")


def test_4_defensive_inputs() -> None:
    """防御性形态：空/None task_text、contract/boundary 为 None 或缺键 → 原样 False 不抛。"""
    fn = _downgrade()
    if fn is None:
        return
    contract, boundary = _make_false_positive()
    _c, _b, d = fn(contract, boundary, "")
    check(d is False, "empty task_text -> not downgraded (no exception)")
    _c, _b, d = fn(contract, boundary, None)
    check(d is False, "None task_text -> not downgraded (no exception)")
    r = fn(None, boundary, _T973)
    check(r == (None, boundary, False), "contract=None returned as-is with False (no exception)")
    r = fn(contract, None, _T973)
    check(r == (contract, None, False), "boundary=None returned as-is with False (no exception)")
    r = fn({}, {'success_when': []}, _T973)
    check(r[2] is False, "contract missing submit/success keys -> not downgraded (no exception)")


def test_5_normalize_untouched() -> None:
    """normalize_phase_contract 纯校验语义不受影响（与 Cursor pin 同语义）。"""
    from scripts.controller.actions.phase.phase_contract_snapshot import (
        normalize_phase_contract,
    )
    nav = {
        'v': 1, 'mode': 'navigate', 'refill': 'none', 'submitRequired': False,
        'successWhen': ['url_change', 'page_opened'], 'source': 'analyze',
    }
    check(normalize_phase_contract(nav)['mode'] == 'navigate',
          "normalize_phase_contract: valid doc still accepted")
    check(normalize_phase_contract({**nav, 'mode': 'verify'}) is None,
          "normalize_phase_contract: mode=verify still rejected (pure validation intact)")
    check(normalize_phase_contract({**nav, 'source': 'persisted_verify_downgraded'}) is None,
          "normalize_phase_contract: source must stay 'analyze' (downgrade tag is runtime-only)")


def main() -> int:
    test_source_needles_snapshot_module()
    test_source_needles_service_wiring()
    test_source_needles_verifyall_registration()
    test_1_calibration_973_positive()
    test_2_calibration_924_control()
    test_3_save_cue_and_window()
    test_4_defensive_inputs()
    test_5_normalize_untouched()
    if _FAILURES:
        print(
            f"characterize-verify-token-downgrade: FAIL "
            f"({len(_FAILURES)}/{_CHECKS} checks failed)"
        )
        return 1
    print(f"characterize-verify-token-downgrade: OK {_CHECKS} passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
