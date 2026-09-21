#!/usr/bin/env python3
"""Characterize: 核验型阶段收尾门豁免（verify-phase-token 第一步门侧兜底，#973）。

纯核验型阶段（重搜确认已删对象不存在——无保存动作、产不出保存令牌）被收尾
质量门误判 missing_success_token → quality_failed（#973 阳性）。本 pin 钉住：

- 判定纯函数 ``scripts/controller/actions/phase/verification_gate.py``
  ``is_verification_phase_task``：四条件（无保存线索 / 核验词根与宾语词 ±16
  字符共现 / 写动词黑名单零命中 / mode+boundary_role 侧证）全满足才 True；
  FP 零容忍、FN 可容忍——拿不准一律 False（维持现行误杀方向）；
- 校准对（冻结判据，不是反推词表的素材）：
  阳性 #973「重搜确认三个已删除节点已不存在，无数据返回」(mode=other) → True；
  对照 #924「重搜确认已删除节点不存在，然后删除新残留节点」→ False（写动词
  「删除」命中——核验+写混合阶段必须保留真实终态证据要求）；
- service.py 收尾门接线：introduce_pick 豁免语义不动，核验型豁免在其分支内
  lazy import，mark_quality_failed 仅在判定为 False 时才调用。

设计稿：docs/superpowers/specs/2026-09-21-verify-phase-token-caliber-design.md §2/§4.3。
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


# ============================== 源码 needle 断言 ==============================

_T973 = "重搜确认三个已删除节点已不存在，无数据返回"
_T924 = "重搜确认已删除节点不存在，然后删除新残留节点"
# 「验证」与「已删除」间隔 17 字（>16 字符窗口）→ 条件②不成立 → False（FN 可容忍）。
_T_FAR = "验证" + "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳甲" + "已删除记录"


def test_source_needles_service_wiring() -> None:
    src = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    check("is_verification_phase_task(task_text, contract)" in src,
          "service.py calls is_verification_phase_task(task_text, contract)")
    check("from ..controller.actions.phase.verification_gate import" in src,
          "service.py lazy-imports verification_gate inside the gate function")
    check("not in ('introduce_pick',)" in src,
          "service.py keeps the introduce_pick exemption check")
    intro_idx = src.find("not in ('introduce_pick',)")
    imp_idx = src.find("from ..controller.actions.phase.verification_gate import")
    call_idx = src.find("is_verification_phase_task(task_text, contract)")
    mark_idx = src.find("mark_quality_failed(business_data_ref, 'missing_success_token')")
    check(intro_idx != -1 and imp_idx != -1 and call_idx != -1 and mark_idx != -1
          and intro_idx < imp_idx < call_idx < mark_idx,
          "wiring order: introduce_pick check < lazy import < predicate call < mark_quality_failed")


def test_source_needles_predicate_module() -> None:
    path = ROOT / "scripts/controller/actions/phase/verification_gate.py"
    check(path.exists(), "verification_gate.py exists")
    if not path.exists():
        return
    src = path.read_text(encoding="utf-8")
    check("def is_verification_phase_task(" in src,
          "verification_gate defines is_verification_phase_task")
    check("from __future__ import annotations" in src,
          "verification_gate uses from __future__ import annotations (intent_gates style)")
    # 纯函数：零 I/O（无文件/网络/子进程访问）。
    for banned in ("open(", "requests", "urllib", "socket", "subprocess"):
        check(banned not in src,
              f"verification_gate.py contains no I/O token: {banned!r}")


def test_source_needles_verifyall_registration() -> None:
    sh = (ROOT / "scripts/refactor/verify-all.sh").read_text(encoding="utf-8")
    check("characterize-verification-phase-gate" in sh,
          "verify-all.sh registers characterize-verification-phase-gate")


# ============================== 行为断言（校准对） ==============================


def _predicate():
    try:
        from scripts.controller.actions.phase.verification_gate import (
            is_verification_phase_task,
        )
        return is_verification_phase_task
    except Exception as exc:  # noqa: BLE001 - pin must not crash on missing module
        check(False, f"verification_gate.is_verification_phase_task importable ({exc})")
        return None


def test_1_calibration_973_positive() -> None:
    """#973 阳性 + mode 侧证变体（条件④：明确 create/modify 才否决）。"""
    fn = _predicate()
    if fn is None:
        return
    check(fn(_T973, {"mode": "other"}) is True, "#973 positive (mode=other) is verification phase")
    check(fn(_T973, {"mode": "query"}) is True, "#973 variant mode=query still True")
    check(fn(_T973, {"mode": "navigate"}) is True, "#973 variant mode=navigate still True")
    check(fn(_T973, {"mode": "create"}) is False, "#973 text but mode=create is vetoed False")
    check(fn(_T973, {"mode": "modify"}) is False, "#973 text but mode=modify is vetoed False")
    check(fn(_T973, {}) is True, "#973 variant mode missing: condition 4 does not veto -> True")
    check(fn(_T973, None) is True, "#973 variant contract=None: condition 4 does not veto -> True")
    check(fn(_T973, {"mode": "login"}) is False, "mode=login is hard-vetoed False (frozen list)")
    check(fn(_T973, {"mode": "introduce_pick"}) is False,
          "mode=introduce_pick is hard-vetoed False (frozen list)")


def test_2_calibration_924_control() -> None:
    """#924 对照：核验+写混合（含「删除」写动词）必须不豁免。"""
    fn = _predicate()
    if fn is None:
        return
    check(fn(_T924, {"mode": "other"}) is False,
          "#924 control (verify + delete mixed) is False")
    check(fn(_T924, {"mode": "query"}) is False,
          "#924 control stays False regardless of mode side-band")


def test_3_true_save_counterexamples() -> None:
    """真保存反例：绝不能被豁免（FP 零容忍）。"""
    fn = _predicate()
    if fn is None:
        return
    check(fn("确认修改后保存", {"mode": "modify"}) is False,
          "confirm-then-save counterexample is False (save cue + modify verb)")
    check(fn("填写表单并验证必填项", {"mode": "other"}) is False,
          "fill-form counterexample is False (write verb 填写)")
    check(fn("检查无数据后点击下一步", {"mode": "query"}) is False,
          "next-step save cue is False even with verify+object co-occurrence")


def test_4_cooccurrence_window() -> None:
    """条件②：核验词根与宾语词须在 ±16 字符窗口内共现。"""
    fn = _predicate()
    if fn is None:
        return
    check(fn("确认已删除节点不存在", {"mode": "other"}) is True,
          "adjacent root+object co-occurrence is True")
    check(fn(_T_FAR, {"mode": "other"}) is False,
          "root and object farther than 16 chars -> False (FN tolerable)")


def test_4b_object_masking_in_blacklist() -> None:
    """条件③：宾语状态词（已删除）不触发写动词黑名单；裸写动词仍命中。"""
    fn = _predicate()
    if fn is None:
        return
    check(fn(_T973, {"mode": "other"}) is True,
          "已删除 (state descriptor) must not trip the write-verb blacklist")
    check(fn("确认已删除节点不存在，然后删除新残留节点", {"mode": "other"}) is False,
          "bare 删除 action verb still trips the blacklist")


def test_5_wordlist_boundaries() -> None:
    """词表边界：空/None/无宾语/boundary_role 硬排除。"""
    fn = _predicate()
    if fn is None:
        return
    check(fn("", {"mode": "other"}) is False, "empty task_text is False")
    check(fn(None, {"mode": "other"}) is False, "None task_text is False")
    check(fn("检查是否存在", {"mode": "other"}) is False,
          "verify root without object word is False")
    check(fn("复核是否生效", {"mode": "other"}) is True,
          "复核 + 是否生效 object co-occurrence is True")
    check(fn(_T973, {"mode": "other"}, "maintain") is False,
          "boundary_role=maintain is hard-excluded False")
    check(fn(_T973, {"mode": "other"}, "introduce") is False,
          "boundary_role=introduce is hard-excluded False")
    check(fn(_T973, {"mode": "other"}, "login") is False,
          "boundary_role=login is hard-excluded False")
    check(fn(_T973, {"mode": "other"}, "query") is True,
          "boundary_role=query does not veto (True with cooperative mode)")
    check(fn(_T973, {"mode": "other"}, None) is True,
          "boundary_role=None does not veto")


def main() -> int:
    test_source_needles_service_wiring()
    test_source_needles_predicate_module()
    test_source_needles_verifyall_registration()
    test_1_calibration_973_positive()
    test_2_calibration_924_control()
    test_3_true_save_counterexamples()
    test_4_cooccurrence_window()
    test_4b_object_masking_in_blacklist()
    test_5_wordlist_boundaries()
    if _FAILURES:
        print(
            f"characterize-verification-phase-gate: FAIL "
            f"({len(_FAILURES)}/{_CHECKS} checks failed)"
        )
        return 1
    print(f"characterize-verification-phase-gate: OK {_CHECKS} passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
