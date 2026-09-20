#!/usr/bin/env python3
"""Characterization: probe force-close doneLog 留痕 + ✂ contract suspect 日志降噪。

2026-09-18 真机湿测实证两处合约配套缺口：

  A probe 收口不留痕：阶段内步数耗尽时 probe 强制收口（session_runner emit
    phase_done），没有 accepted done → business_data_store['_phase_outcomes'] 无
    本相位条目 → phase_done 事件无 text → 控制面 appendPhaseDoneLog 落空 →
    trajectory_phase.done_logs=[]，agent 真实页面状态只留在 executor 日志
    （traj #861 P6、#863 P1/P2、#866 P7/P8/P9 全部 doneLogs=0）。修复：probe
    收口点向与正常 done 相同的存储通路（_phase_outcomes，经 _outcome_for 装进
    phase_done.text）补写一条合成条目：text =
    ``probe force-close: <拒绝原因或 zero actions in phase>（agent 步数耗尽，
    probe 收口）``（可附最后一次 done 声明文本尾 120 字）、success=None
    （维持 unknown 语义）、source='probe'。已存在 accepted outcome 时不覆盖。
  B 熔断日志噪声：recorder_emitters._guard_done_reject_missing_token 熔断放行后
    每次后续 done 调用都重复打一行 ``✂ contract suspect``（traj #867 P5 连续
    9 行同文）。修复：该行只在同一 missing 集计数首次达到阈值（=3）后的第一次
    放行（转移点）打一次；之后放行静默。行为不变：照样放行（返回 False）、
    照样置 _phase_contract_suspect、照样不改写 history（与
    characterize-contract-arbitration-circuit-breaker.py 批C 的计数口径兼容：
    连拒 3 次后从第 4 次调用起放行）。

无浏览器、无 LLM：probe 留痕直调 recorder_emitters 新助手，熔断直调
``_guard_done_reject_missing_token``（该子守卫只读 agent.state 与 store）；
session_runner 侧为接线文本 pin（import 链含 browser_use，不做行为驱动）。
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import re
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

from scripts.controller.actions._phase_intent import apply_phase_contract  # noqa: E402
from scripts.agent.recorder_emitters import (  # noqa: E402
    _guard_done_reject_missing_token,
    probe_force_close_context,
    record_probe_done_log,
)

results: list[tuple[str, bool, str]] = []

_PROBE_SUFFIX = "（agent 步数耗尽，probe 收口）"


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"  {'✓' if ok else '✗'} {name}" + (f" — {detail}" if detail else ""))


def _slice(src: str, start: str, end: str) -> str:
    """容错切片：起点未命中返回空串（RED-safe），终点未命中切到文件尾。"""
    i = src.find(start)
    if i < 0:
        return ""
    j = src.find(end, i + len(start))
    return src[i:] if j < 0 else src[i:j]


# ── fake agent（仿 characterize-contract-arbitration-circuit-breaker.py） ────

class _ReplayResult:
    """守卫改写的 ActionResult 形状：is_done / error / extracted_content 可写。"""

    def __init__(self) -> None:
        self.is_done = True
        self.error = None
        self.extracted_content = None
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
    def __init__(self) -> None:
        self.state = _AgentState()


def _query_store() -> tuple[dict, dict]:
    """真 apply_phase_contract 造一个 query 合同 + 带令牌要求的 boundary。

    与 characterize-contract-arbitration-circuit-breaker.py 批C 同一形状：
    phase_done_ok 签出非空 missing，门禁拒绝路径可累计 streak。
    """
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
        boundary_override={"role": "query", "success_when": ["query_clicked"], "goals": ["query_filter"]},
    )
    return store, contract


def _call_guard(agent, store, contract):
    buf = io.StringIO()
    with contextlib.redirect_stderr(buf):
        out = _guard_done_reject_missing_token(agent, store, contract, True, False, True)
    return out, buf.getvalue()


# ── A：probe 收口合成 doneLog ────────────────────────────────────────────────

def test_a_probe_done_log() -> None:
    print("A probe 收口合成 doneLog：写入 _phase_outcomes（与正常 done 同通路）")

    # A1 基本写入：store 载体出现合成条目，source='probe'
    store_a: dict = {}
    entry = record_probe_done_log(store_a, 6, reason="missing query_clicked")
    carrier = (store_a.get("_phase_outcomes") or {}).get(6)
    record("返回写入的条目", isinstance(entry, dict) and carrier is entry,
           f"entry={type(entry).__name__} carrier={'dict' if isinstance(carrier, dict) else type(carrier).__name__}")
    record("条目落位于 _phase_outcomes[phase]", isinstance(carrier, dict), f"carrier={carrier!r}")
    record("source='probe'", (carrier or {}).get("source") == "probe", f"source={(carrier or {}).get('source')!r}")
    record("success=None（维持 unknown 语义，不伪造成败）",
           carrier is not None and "success" in carrier and carrier["success"] is None,
           f"success={(carrier or {}).get('success')!r}")
    text_a = str((carrier or {}).get("text") or "")
    record("text 前缀 'probe force-close: ' + 拒绝原因", text_a.startswith("probe force-close: missing query_clicked"),
           f"text={text_a[:80]!r}")
    record("text 带固定后缀（agent 步数耗尽，probe 收口）", text_a.endswith(_PROBE_SUFFIX), f"text={text_a!r}")

    # A2 附加 agent 最后一次 done 声明文本尾 120 字
    store_b: dict = {}
    long_done = "页面停在评级列表，查询条件已重置" + "x" * 200
    entry_b = record_probe_done_log(store_b, 3, reason="zero actions in phase", last_done_text=long_done)
    text_b = str((entry_b or {}).get("text") or "")
    record("附加 done 声明文本尾 120 字", text_b.endswith(long_done[-120:]) and " — " in text_b,
           f"tail={text_b[-30:]!r} len={len(text_b)}")
    record("文本封顶 400（同 record_phase_outcome 口径）", len(text_b) <= 400, f"len={len(text_b)}")

    # A3 accepted done 已留痕 → 不覆盖
    store_c: dict = {"_phase_outcomes": {2: {"success": True, "text": "agent declared done"}}}
    entry_c = record_probe_done_log(store_c, 2, reason="whatever")
    kept = (store_c.get("_phase_outcomes") or {}).get(2)
    record("已有 accepted outcome 时不覆盖",
           entry_c is None and isinstance(kept, dict)
           and kept.get("text") == "agent declared done" and "source" not in kept,
           f"entry={entry_c!r} kept={kept!r}")

    # A4 None store 容错
    record("None store 返回 None 不抛", record_probe_done_log(None, 1, reason="x") is None)

    # A5 probe_force_close_context：拒绝原因 / zero actions / done 声明文本
    r1, _ = probe_force_close_context({"_quality_failed_reasons": ["missing_success_token", "pending_fields:a", "pending_fields:b"]})
    record("语境：_quality_failed_reasons 优先为拒绝原因", r1 == "missing_success_token, pending_fields:a, pending_fields:b", f"reason={r1!r}")
    r2, ld2 = probe_force_close_context({})
    record("语境：零业务动作 → 'zero actions in phase'", r2 == "zero actions in phase", f"reason={r2!r}")
    record("语境：无 agent → last done 文本为空", ld2 == "", f"last={ld2!r}")
    agent5 = _AgentShim()
    agent5.state.history.history[0].result[0].error = "Premature done() rejected: missing success token."
    agent5.state.history.history[0].result[0].extracted_content = "已点击重置，页面恢复默认"
    r3, ld3 = probe_force_close_context({}, agent=agent5)
    record("语境：history 最后一次 done 拒绝文案（剥前缀）", "missing success token" in r3, f"reason={r3!r}")
    record("语境：history 最后一段 extracted_content 为 done 声明", ld3 == "已点击重置，页面恢复默认", f"last={ld3!r}")

    # A6 session_runner 接线（文本 pin：import 链重，不做行为驱动）
    sr = (ROOT / "scripts" / "session_runner.py").read_text(encoding="utf-8")
    record("session_runner 接线 record_probe_done_log", "record_probe_done_log" in sr)
    record("接线带 outcome is None 门（无 accepted done 才补写）",
           re.search(r"if outcome is None and not step_canceled:", sr) is not None)
    record("接线位于 phase_done emit 之前（text 随事件落库）",
           0 <= sr.find("record_probe_done_log") < sr.find('"event": "phase_done"'),
           f"at={sr.find('record_probe_done_log')}")
    re_svc = (ROOT / "scripts" / "agent" / "recorder_emitters.py").read_text(encoding="utf-8")
    record("recorder_emitters 固定后缀常量在位", _PROBE_SUFFIX in re_svc)


# ── B：✂ contract suspect 日志只在转移点打一次 ───────────────────────────────

def test_b_suspect_log_transition_only() -> None:
    print("B ✂ suspect 日志降噪：6 连调只打 1 行（转移点），行为不变")
    store, contract = _query_store()
    agent = _AgentShim()

    per_call: list[tuple[bool, str]] = []
    for i in range(6):
        out, err = _call_guard(agent, store, contract)
        streak = store.get("_done_token_reject_streak") or {}
        # 计数断言逐调用读（streak 是 store 终态，6 连调后读恒为 3）；
        # per_call 只留存 (return, stderr) 供 ✂ 转移点断言。
        if i < 3:
            record(f"第 {i + 1} 次同 missing 拒绝（计数口径不变）",
                   out is True and streak.get("count") == i + 1,
                   f"return={out!r} count={streak.get('count')}")
        else:
            record(f"第 {i + 1} 次熔断放行（return False）", out is False, f"return={out!r}")
        per_call.append((out, err))

    # ✂ 行恰好在转移点（第 4 次调用 = 首次放行）出现一次，之后静默
    hits = [i + 1 for i, (_out, err) in enumerate(per_call) if "✂ contract suspect" in err]
    record("✂ contract suspect 恰好出现 1 次（转移点）", len(hits) == 1, f"hits={hits}")
    record("转移点在第 4 次调用（3 次拒绝后的首次放行）", hits == [4], f"hits={hits}")

    # 放行行为不变：置 suspect、不改写 history
    record("_phase_contract_suspect 置位", store.get("_phase_contract_suspect") is True)
    r0 = agent.state.history.history[0].result[0]
    r0.error = "SENTINEL-BYPASS"
    _call_guard(agent, store, contract)
    record("后续放行不改写 history", r0.error == "SENTINEL-BYPASS", f"error={r0.error!r}")
    # 放行不再带 Premature done 警告 / 拒绝文案
    _out6, err6 = per_call[5]
    record("静默放行无 Premature done 警告", "Premature done" not in err6)

    # 换 missing 集 → 新 key 重新计数（旧转移标记不串扰），再走 3 拒 + 首次放行 1 行
    store2, contract2 = _query_store()
    agent2 = _AgentShim()
    calls2 = []
    for _ in range(4):
        calls2.append(_call_guard(agent2, store2, contract2))
    record("新 store：前 3 次拒绝", all(out is True for out, _e in calls2[:3]),
           f"returns={[out for out, _e in calls2]}")
    record("新 store 首次放行打 1 行 ✂", sum("✂ contract suspect" in e for _o, e in calls2) == 1
           and "✂ contract suspect" in calls2[3][1])

    # 文本 pin：降噪标记落位（防未来改回每次打）
    src = (ROOT / "scripts" / "agent" / "recorder_emitters.py").read_text(encoding="utf-8")
    seg_start = src.find("def _guard_done_reject_missing_token")
    seg_end = src.find("\ndef ", seg_start + 1)
    seg = src[seg_start:seg_end]
    record("熔断分支带 suspect_logged 转移标记", "suspect_logged" in seg)


# ── C：层3——overlay 按钮权威清单 + probe 收口附加 ──────────────────────────
# 背景：#910④ 生产事故中 agent 报「弹窗无 footer 提交按钮」——实为按钮存在但
# agent 认知链缺失。overlay 摘要此前只有 kind/label（标题），收口 doneLog 不带
# 弹窗按钮。修复形态：semantic_snapshot overlay 增加 buttons 权威清单（容器内
# 全量、不经 LIMITS.buttons 40 截断），record_probe_done_log 收口文本附加清单。

_SEMANTIC_SNAPSHOT = (
    ROOT / "scripts" / "controller" / "actions" / "js_snippets" / "semantic_snapshot.py"
)
_VERIFY_CONTEXT = (
    ROOT / "scripts" / "controller" / "actions" / "js_snippets" / "verify_context.py"
)


def _make_semantic_agent(buttons, *, overlay=True):
    """仿 agent：history 最后一段 result 为 semantic_snapshot 的 ok:{...} 文本。"""
    payload = {
        'ok': True,
        'context': {
            'overlay': (
                {'kind': 'dialog', 'label': '新增', 'buttons': buttons} if overlay else None
            )
        },
        'counts': {'buttons': len(buttons)},
    }
    a = _AgentShim()
    a.state.history.history[0].result[0].extracted_content = (
        'ok:' + json.dumps(payload, ensure_ascii=False)
    )
    return a


def test_c_overlay_buttons_authority() -> None:
    print("C overlay 按钮权威清单：semantic overlay.buttons + verify_context 兼容 + 收口附加")

    snap = _SEMANTIC_SNAPSHOT.read_text(encoding="utf-8")
    vctx = _VERIFY_CONTEXT.read_text(encoding="utf-8")

    # C1 semantic_snapshot：overlay 对象构造携带 buttons 权威清单
    record("semantic overlay 构造含 buttons（drawer）",
           "overlay = { kind: 'drawer', label, buttons: overlayButtons(d) }" in snap)
    record("semantic overlay 构造含 buttons（dialog）",
           "overlay = { kind: 'dialog', label, buttons: overlayButtons(d) }" in snap)

    # C2 枚举限定在 overlay 容器内（querySelectorAll 作用于 container 形参而非 document）
    helper = _slice(snap, "const overlayButtons", "let overlay = null;")
    record("overlayButtons helper 在位", helper != "")
    record("枚举作用于 overlay 容器（container.querySelectorAll('button')）",
           "container.querySelectorAll('button')" in helper)
    record("枚举不走 document 全局按钮枚举（helper 内无 document.querySelectorAll('button')）",
           "document.querySelectorAll('button')" not in helper)

    # C3 权威清单不受 40 截断：helper 路径不经过 LIMITS / truncated
    record("overlay 按钮枚举不经 LIMITS 判断", "LIMITS" not in helper)
    record("overlay 按钮枚举不置 truncated", "truncated" not in helper)

    # C4 权威清单形状 {text, ariaLabel, disabled}（复用主按钮提取风格）
    record("枚举形状含 text/ariaLabel/disabled",
           all(k in helper for k in ("text", "ariaLabel", "disabled")))
    record("docstring 返回形状注明 overlay.buttons", '"overlay":{"kind","label","buttons"' in snap)

    # C5 verify_context：overlay 构造同样带 buttons（形状统一），判定语义不变
    record("verify_context overlay 构造带 buttons（drawer）",
           "overlay = { kind: 'drawer', label: label, buttons: overlayButtons(drawer) }" in vctx)
    record("verify_context overlay 构造带 buttons（dialog）",
           "overlay = { kind: 'dialog', label: label, buttons: overlayButtons(dialog) }" in vctx)
    record("overlay_contains 判定仍只读 label（语义不变）",
           "const actual = overlay ? overlay.label : '';" in vctx)
    vhelper = _slice(vctx, "const overlayButtons", "let overlay = null;")
    record("verify_context 枚举同样限定 overlay 容器内",
           vhelper != "" and "container.querySelectorAll('button')" in vhelper
           and "document.querySelectorAll('button')" not in vhelper)

    # C6 record_probe_done_log 收口文本附加 overlay 按钮清单
    rec_src = (ROOT / "scripts" / "agent" / "recorder_emitters.py").read_text(encoding="utf-8")
    fn = _slice(rec_src, "def record_probe_done_log", "\ndef ")
    record("收口函数引用按钮清单 helper", "_probe_overlay_button_texts" in fn)
    record("收口文本拼 overlay buttons 段", "| overlay buttons: " in fn)
    record("按钮清单拼在固定后缀之前（源码顺序）",
           0 <= fn.find("overlay buttons: ") < fn.find("_PROBE_CLOSEOUT_SUFFIX"),
           f"at={fn.find('overlay buttons: ')} vs {fn.find('_PROBE_CLOSEOUT_SUFFIX')}")
    # C7 行为：semantic 结果含按钮 → 收口文本带 [确 定][取 消]，done 文本仍居尾
    import scripts.agent.service as _agent_service

    def _btn(i: int) -> dict:
        return {'text': f'按钮{i}', 'ariaLabel': '', 'disabled': False}

    _saved_agent = _agent_service._last_agent
    try:
        _agent_service._last_agent = _make_semantic_agent(
            [{'text': '确 定', 'ariaLabel': '', 'disabled': False},
             {'text': '', 'ariaLabel': '取 消', 'disabled': False}])
        store_d: dict = {}
        entry_d = record_probe_done_log(
            store_d, 4, reason='missing query_clicked', last_done_text='已填 3/5 字段')
        text_d = str((entry_d or {}).get('text') or '')
        record("收口文本含 overlay 按钮清单（text 兜底 ariaLabel）",
               " | overlay buttons: [确 定][取 消]" in text_d, f"text={text_d!r}")
        record("按钮清单拼在固定后缀之前",
               0 <= text_d.find("overlay buttons:") < text_d.find(_PROBE_SUFFIX))
        record("done 声明文本仍居结尾（尾缀语义保持）",
               text_d.endswith("已填 3/5 字段") and " — " in text_d)

        # C8 权威清单最多列 8 个（防文本爆炸）
        _agent_service._last_agent = _make_semantic_agent([_btn(i) for i in range(12)])
        store_e: dict = {}
        entry_e = record_probe_done_log(store_e, 5, reason='zero actions in phase')
        text_e = str((entry_e or {}).get('text') or '')
        record("按钮清单最多列 8 个", text_e.count('[') == 8 and text_e.count(']') == 8,
               f"count={text_e.count('[')}")

        # C9 无 agent / overlay 为空 / JSON 坏值 → 不附加、不炸
        _agent_service._last_agent = None
        store_f: dict = {}
        entry_f = record_probe_done_log(store_f, 6, reason='zero actions in phase')
        text_f = str((entry_f or {}).get('text') or '')
        record("无 semantic 结果不附加清单（后缀仍结尾）",
               "overlay buttons" not in text_f and text_f.endswith(_PROBE_SUFFIX))
        _agent_service._last_agent = _make_semantic_agent([], overlay=False)
        store_g: dict = {}
        entry_g = record_probe_done_log(store_g, 7, reason='x')
        record("overlay 为 null 不附加不抛",
               (entry_g or {}).get("text") is not None and "overlay buttons" not in str((entry_g or {}).get("text")))
        a_bad = _AgentShim()
        a_bad.state.history.history[0].result[0].extracted_content = 'ok:{bad json'
        _agent_service._last_agent = a_bad
        store_h: dict = {}
        entry_h = record_probe_done_log(store_h, 7, reason='x')
        record("JSON 坏值不附加不抛",
               (entry_h or {}).get("text") is not None and "overlay buttons" not in (entry_h or {}).get("text", ""))
    finally:
        _agent_service._last_agent = _saved_agent


def main() -> int:
    tests = [
        test_a_probe_done_log,
        test_b_suspect_log_transition_only,
        test_c_overlay_buttons_authority,
    ]
    for t in tests:
        try:
            t()
        except AssertionError as exc:
            print(f"FAIL characterize-probe-donelog-and-suspect-noise {t.__name__}: {exc}")
            return 1
        except Exception as exc:  # noqa: BLE001 — pin 需要把任何异常显式呈现为红
            print(f"ERROR characterize-probe-donelog-and-suspect-noise {t.__name__}: {type(exc).__name__}: {exc}")
            return 1
    bad = [r for r in results if not r[1]]
    if bad:
        print(f"characterize-probe-donelog-and-suspect-noise: FAILED ({len(bad)}/{len(results)})")
        return 1
    print(f"characterize-probe-donelog-and-suspect-noise: OK ({len(results)} checks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
