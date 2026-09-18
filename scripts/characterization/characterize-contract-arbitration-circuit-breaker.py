#!/usr/bin/env python3
"""Characterization: 多阶段录制合约链三修（仲裁盲区 / done 熔断 / 276 兜底收敛）。

2026-09-17 评级重置事故：LLM Phase Reviewer 判对（mode=other, kinds=[]）但规则
编译器误判 query 合同，done 门禁听规则 → done 死循环 6 次 + 预算 +42。
2026-09-18 冲突普查定稿三个结构性修复，本文件先 RED 后 GREEN 逐组钉死：

  A 仲裁盲区补全（intent_contract.apply_phase_contract）：mode='other' 且规则
    boundary 签出 query/navigate 严格合同时，信 LLM 降级为 other/no-token
    （source='llm+arbitrated'）。此前仲裁分支只覆盖 LLM 与规则同为
    navigate/query 家族的不一致，mode='other' 是盲区。
  B 事故端到端：重置阶段文本过 compile_boundary（批A classify 修复后落 other，
    批A前落 query —— 两种规则输入都接受），喂仲裁分支后最终 boundary 必须无令牌；
    并用批A前的规则形状（query + query_clicked）显式钉死仲裁降级本身。
  C done 熔断（recorder_emitters._guard_done_reject_missing_token）：同一
    missing 集连续拒绝 3 次均返回 True，第 4 次熔断放行（返回 False），
    置 _phase_contract_suspect=True，且不再改写 history；中途换 missing 集
    计数重置。—— 宁 bounded 放松不 unbounded 死锁。
  D 276 兜底收敛（boundary_to_legacy_intent）：空 success_when 显式传播为空
    kinds，不再凭空抬升为 ['query_clicked'] / ['url_change','page_opened']
    （空合同默认值职责已由 apply_phase_contract 承担）。

无浏览器、无 LLM：仲裁/编译走纯函数，熔断直调
``_guard_done_reject_missing_token``（该子守卫只读 agent.state 与 store）。
"""
from __future__ import annotations

import contextlib
import io
import os
import sys
from pathlib import Path

# Windows consoles / verify-all redirects default to GBK; the ✓/✗/—/✂ output
# would raise UnicodeEncodeError and turn this gate red for the wrong reason.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("AI_PHASE_BOUNDARY", "1")

from scripts.controller.actions._phase_boundary import (  # noqa: E402
    boundary_to_legacy_intent,
    compile_boundary,
    phase_done_ok,
)
from scripts.controller.actions._phase_intent import apply_phase_contract  # noqa: E402
from scripts.agent.recorder_emitters import _guard_done_reject_missing_token  # noqa: E402

# 2026-09-17 事故阶段文本（评级重置：清空查询条件，无任何查询/保存动作）。
INCIDENT_TEXT = "点击【重置】按钮。预期结果：清空所有查询条件字段并恢复默认状态。"
# LLM 判对结果：mode=other、无成功令牌（事故复盘结论）。
LLM_OTHER_CONTRACT = {"mode": "other", "refill": "none", "source": "llm", "success": {"kinds": []}}
# 批A classify 修复前，规则编译器对该文本的误判形状。
LEGACY_RULES_QUERY = {"role": "query", "success_when": ["query_clicked"], "goals": ["query_filter"]}

results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"  {'✓' if ok else '✗'} {name}" + (f" — {detail}" if detail else ""))


# ── fake agent（仿 characterize-g3-done-gate-live.py，无需浏览器） ──────────

class _ReplayResult:
    """守卫改写的 ActionResult 形状：is_done / error / include_in_memory 可写。"""

    def __init__(self) -> None:
        self.is_done = True
        self.error = None
        self.include_in_memory = False


class _HistoryItem:
    def __init__(self) -> None:
        self.result = [_ReplayResult()]


class _History:
    def __init__(self) -> None:
        self.history = [_HistoryItem()]


class _AgentState:
    def __init__(self) -> None:
        self.n_steps = 5
        self.history = _History()


class _AgentShim:
    """_guard_done_reject_missing_token 只读 agent.state（grep 实证）。"""

    def __init__(self) -> None:
        self.state = _AgentState()


def _query_store() -> tuple[dict, dict]:
    """真 apply_phase_contract 造一个 query 合同 + 带令牌要求的 boundary。"""
    store: dict = {}
    contract = apply_phase_contract(
        store,
        {
            "mode": "query",
            "refill": "none",
            "source": "rules_fallback",
            "submit": {"required": False},
            "success": {"kinds": ["query_clicked"]},
        },
        boundary_override=dict(LEGACY_RULES_QUERY),
    )
    return store, contract


def _call_guard(agent, store, contract):
    buf = contextlib.io.StringIO() if False else io.StringIO()
    with contextlib.redirect_stderr(buf):
        out = _guard_done_reject_missing_token(agent, store, contract, True, False, True)
    return out, buf.getvalue()


# ── A：仲裁盲区补全 ──────────────────────────────────────────────────────────

def test_a_arbitration_downgrade() -> None:
    print("A 仲裁盲区补全：llm=other + rules=query → 降级 other/no-token")
    store_a: dict = {}
    apply_phase_contract(store_a, dict(LLM_OTHER_CONTRACT), boundary_override=dict(LEGACY_RULES_QUERY))
    b = store_a.get("_phase_boundary") or {}
    record("boundary role 降级为 other", b.get("role") == "other", f"role={b.get('role')!r}")
    record("success_when 清空（无令牌）", list(b.get("success_when") or []) == [], f"sw={b.get('success_when')!r}")
    record("goals 清空", list(b.get("goals") or []) == [], f"goals={b.get('goals')!r}")
    record("source 登记为 llm+arbitrated", b.get("source") == "llm+arbitrated", f"source={b.get('source')!r}")

    # mode='other' 且规则 role 本来就是 other → 不动（passthrough，不误登记 arbitrated）
    store_a2: dict = {}
    apply_phase_contract(
        store_a2, dict(LLM_OTHER_CONTRACT),
        boundary_override={"role": "other", "success_when": [], "goals": ["navigate_or_misc"]},
    )
    b2 = store_a2.get("_phase_boundary") or {}
    record("规则本就 other/no-token → 原样保留", b2.get("source") == "llm", f"source={b2.get('source')!r}")


# ── B 事故端到端 ─────────────────────────────────────────────────────────────

def test_b_incident_end_to_end() -> None:
    print("B 事故端到端：重置阶段文本 → 仲裁后 boundary 无令牌")
    rules_b = compile_boundary(INCIDENT_TEXT)
    # 批A classify 修复（c14d1c1f/2c94434b）后落 other；批A前落 query —— 两种都接受，
    # 断言只钉最终形态：喂仲裁分支后 boundary 必须无令牌。
    record(
        "事故文本规则编译形状已登记（两种均可）",
        rules_b.get("role") in ("other", "query", "navigate"),
        f"compile_boundary: role={rules_b.get('role')} sw={rules_b.get('success_when')}",
    )
    store_b: dict = {}
    apply_phase_contract(store_b, dict(LLM_OTHER_CONTRACT), boundary_override=dict(rules_b))
    fb = store_b.get("_phase_boundary") or {}
    record("最终 boundary role=other", fb.get("role") == "other", f"role={fb.get('role')!r}")
    record("最终 boundary 无令牌（done 门禁不再死锁）", list(fb.get("success_when") or []) == [], f"sw={fb.get('success_when')!r}")

    # 批A前的规则形状（query + query_clicked）显式喂仲裁 —— 钉死降级本身，
    # 防未来 classify 变化让上一条断言退化为恒真。
    store_b2: dict = {}
    apply_phase_contract(store_b2, dict(LLM_OTHER_CONTRACT), boundary_override=dict(LEGACY_RULES_QUERY))
    fb2 = store_b2.get("_phase_boundary") or {}
    record(
        "批A前规则形状 → 仲裁降级 other/no-token/llm+arbitrated",
        fb2.get("role") == "other" and list(fb2.get("success_when") or []) == []
        and fb2.get("source") == "llm+arbitrated",
        f"role={fb2.get('role')} sw={fb2.get('success_when')} source={fb2.get('source')}",
    )
    # 事故终态：done 门禁不介入（needs_token 依赖 _boundary_requires_evidence → False）
    ok_b, missing_b = phase_done_ok(store_b2)
    record("仲裁后 phase_done_ok 直接通过", ok_b is True and missing_b == [], f"ok={ok_b} missing={missing_b}")


# ── C done 熔断 ──────────────────────────────────────────────────────────────

def test_c_done_reject_circuit_breaker() -> None:
    print("C done 熔断：同 missing 集连拒 3 次，第 4 次放行且不改写 history")
    store, contract = _query_store()
    agent = _AgentShim()

    # 第 1-3 次：拒绝（返回 True），streak 计数 1→2→3
    counts = []
    for i in (1, 2, 3):
        out, err = _call_guard(agent, store, contract)
        streak = store.get("_done_token_reject_streak") or {}
        counts.append((out, streak.get("count")))
        record(
            f"第 {i} 次同 missing 拒绝",
            out is True and streak.get("count") == i and "_phase_contract_suspect" not in store,
            f"return={out!r} count={streak.get('count')} err={err.strip().splitlines()[-1][:60] if err.strip() else ''}",
        )
    # 拒绝路径改写过 history（is_done=False + recovery error）
    r0 = agent.state.history.history[0].result[0]
    record("拒绝路径已改写 history（is_done=False）", r0.is_done is False, f"is_done={r0.is_done!r}")

    # 第 4 次：count 已 3 → 熔断放行（返回 False），不再改写 history
    r0.error = "SENTINEL-CALL4"
    out4, err4 = _call_guard(agent, store, contract)
    record("第 4 次熔断放行（return False）", out4 is False, f"return={out4!r}")
    record("_phase_contract_suspect 置位", store.get("_phase_contract_suspect") is True)
    record("熔断 stderr 带 bypassed 标记", "bypassed" in err4 and "contract suspect" in err4,
           err4.strip().splitlines()[-1][:80] if err4.strip() else "(无 stderr)")
    record("熔断时不改写 history", r0.error == "SENTINEL-CALL4", f"error={r0.error!r}")
    record("熔断时不写 Premature done 警告", "Premature done" not in err4)

    # 换 missing 集 → 计数重置为 1（新 key），且仍先拒绝
    store2, contract2 = _query_store()
    agent2 = _AgentShim()
    _call_guard(agent2, store2, contract2)
    _call_guard(agent2, store2, contract2)
    streak2 = store2.get("_done_token_reject_streak") or {}
    record("换集前计数为 2", streak2.get("count") == 2, f"count={streak2.get('count')}")
    store2["_phase_boundary"]["success_when"] = ["url_change", "page_opened"]
    out3, _ = _call_guard(agent2, store2, contract2)
    streak2 = store2.get("_done_token_reject_streak") or {}
    record(
        "换 missing 集后计数重置为 1 且仍拒绝",
        out3 is True and streak2.get("count") == 1,
        f"return={out3!r} count={streak2.get('count')} key={streak2.get('key')}",
    )


# ── D：276 兜底收敛 ──────────────────────────────────────────────────────────

def test_d_empty_success_when_passthrough() -> None:
    print("D 276 兜底收敛：空 success_when 不再被抬升为默认令牌")
    c_q = boundary_to_legacy_intent({"role": "query", "success_when": [], "goals": ["query_filter"]})
    record("query 空 kinds==[]（不得抬升 query_clicked）", list((c_q or {}).get("success", {}).get("kinds") or []) == [],
           f"kinds={(c_q or {}).get('success', {}).get('kinds')!r}")
    c_n = boundary_to_legacy_intent({"role": "navigate", "success_when": [], "goals": []})
    record("navigate 空 kinds==[]（不得抬升 url_change/page_opened）",
           list((c_n or {}).get("success", {}).get("kinds") or []) == [],
           f"kinds={(c_n or {}).get('success', {}).get('kinds')!r}")
    # 非空合同原样传播（防过度收敛）
    c_q2 = boundary_to_legacy_intent({"role": "query", "success_when": ["query_clicked"], "goals": ["query_filter"]})
    record("非空 kinds 原样传播", list(c_q2["success"]["kinds"]) == ["query_clicked"],
           f"kinds={c_q2['success']['kinds']!r}")
    # 空 kinds 消费方安全：needs_token 前提（submit.required=False + 无 evidence 要求）→ 门禁不介入
    record("query 空 kinds 合同 submit.required 仍为 False",
           (c_q or {}).get("submit", {}).get("required") is False)
    store_d: dict = {"_phase_boundary": {"role": "query", "success_when": []}, "_phase_boundary_flag_locked": True}
    ok_d, missing_d = phase_done_ok(store_d)
    record("空 success_when → phase_done_ok 通过", ok_d is True and missing_d == [], f"ok={ok_d} missing={missing_d}")


def main() -> int:
    tests = [
        test_a_arbitration_downgrade,
        test_b_incident_end_to_end,
        test_c_done_reject_circuit_breaker,
        test_d_empty_success_when_passthrough,
    ]
    for t in tests:
        try:
            t()
        except AssertionError as exc:
            print(f"FAIL characterize-contract-arbitration-circuit-breaker {t.__name__}: {exc}")
            return 1
        except Exception as exc:  # noqa: BLE001 — pin 需要把任何异常显式呈现为红
            print(f"ERROR characterize-contract-arbitration-circuit-breaker {t.__name__}: {type(exc).__name__}: {exc}")
            return 1
    bad = [r for r in results if not r[1]]
    if bad:
        print(f"characterize-contract-arbitration-circuit-breaker: FAILED ({len(bad)}/{len(results)})")
        return 1
    print(f"characterize-contract-arbitration-circuit-breaker: OK ({len(results)} checks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
