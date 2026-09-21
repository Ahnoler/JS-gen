#!/usr/bin/env python3
"""Characterize: D2 SUT 503 阶段空转守卫（#925）— A(SUT 不可达)+B(无进展) 双条件止损。

缺陷 #925：SUT 返回 503「Service Unavailable」错误页时，agent 在错误页上的 DOM
点击仍「成功」落库并持续发 action_log_sync 喂 idle watchdog，同一阶段空转 30min+
直到 max_steps。守卫挂在 recorder.on_step_end（``_guard_spin_on_step_end``）：

- 默认 off（SUT_SPIN_GUARD_MODE 未设）零行为影响、零页面 I/O；
- 条件 B（progress_window 步无实质进展：task_list done 数 / URL pathname /
  新容器首开）满窗后才做一次页面探测；重开已见容器不算进展；
- 条件 A 优先级 A1（页面文本 503）> A3（URL 错误页，连续 2 步）> A4（关键 DOM
  缺失连续 dom_window 步）；
- observation 只观测不打断；soft/hard 触发 = emit phase_error(reason=
  sut_unavailable_spin_guard) + 停 agent，且已触发后不得重复发 phase_error。

源码 needle 断言 pin 住：守卫函数存在、recorder 调用点先于 done 门禁、
service 续跑循环 break、verify-all 注册。
"""
from __future__ import annotations

import asyncio
import os
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


def test_source_needles_recorder_emitters() -> None:
    src = (ROOT / "scripts/agent/recorder_emitters.py").read_text(encoding="utf-8")
    check("async def _guard_spin_on_step_end" in src,
          "recorder_emitters defines async _guard_spin_on_step_end")
    check("SUT_SPIN_GUARD_MODE" in src,
          "recorder_emitters reads SUT_SPIN_GUARD_MODE env")
    check("sut_unavailable_spin_guard" in src,
          "recorder_emitters uses reason sut_unavailable_spin_guard")
    check("_SUT_SPIN_GUARD_PROBE_JS" in src,
          "recorder_emitters defines _SUT_SPIN_GUARD_PROBE_JS probe")


def test_source_needles_recorder_call_order() -> None:
    src = (ROOT / "scripts/recorder.py").read_text(encoding="utf-8")
    check("from .agent.recorder_emitters import" in src,
          "recorder.py imports from .agent.recorder_emitters")
    imp_block = src.split("from .agent.recorder_emitters import", 1)[1].split(")", 1)[0]
    check("_guard_spin_on_step_end" in imp_block,
          "recorder.py imports _guard_spin_on_step_end from recorder_emitters")
    spin_idx = src.find("await _guard_spin_on_step_end")
    done_idx = src.find("await _guard_done_on_step_end")
    check(spin_idx != -1, "recorder.py calls await _guard_spin_on_step_end")
    check(done_idx != -1, "recorder.py calls await _guard_done_on_step_end")
    check(spin_idx != -1 and done_idx != -1 and spin_idx < done_idx,
          "spin guard call site precedes done guard call site in on_step_end")


def test_source_needles_service_and_verifyall() -> None:
    src = (ROOT / "scripts/agent/service.py").read_text(encoding="utf-8")
    check("goal_tracker.get('stopped')" in src,
          "service.py budget-extend loop breaks on goal_tracker.get('stopped')")
    sh = (ROOT / "scripts/refactor/verify-all.sh").read_text(encoding="utf-8")
    check("characterize-sut-spin-guard" in sh,
          "verify-all.sh registers characterize-sut-spin-guard")


# ============================== 行为冒烟基建 ==============================

emitted: list = []


class _FBrowserState:
    def __init__(self, url):
        self.url = url


class _FHistItem:
    def __init__(self, url):
        self.state = _FBrowserState(url)


class _FHistory:
    def __init__(self, urls):
        self.history = [_FHistItem(u) for u in urls]


class _FState:
    def __init__(self, n, urls):
        self.n_steps = n
        self.stopped = False
        self.history = _FHistory(urls)


class _FAgent:
    def __init__(self, n, urls):
        self.state = _FState(n, urls)


class _FPage:
    def __init__(self, info):
        self.info = info
        self.evaluate_calls = 0

    async def evaluate(self, _js):
        self.evaluate_calls += 1
        return self.info


class _FBrowserContext:
    def __init__(self, page):
        self._page = page

    async def get_current_page(self):
        return self._page


class _FBombContext:
    """Zero-I/O bomb: any page access explodes (and is counted)."""

    def __init__(self):
        self.calls = 0

    async def get_current_page(self):
        self.calls += 1
        raise AssertionError("page touched")


_INFO_503 = {
    "title": "",
    "text": "异常信息 service unavailable",
    "url": "http://sut/app",
    "keyDom": True,
}
_INFO_HEALTHY = {
    "title": "业务系统",
    "text": "欢迎使用业务系统，请选择左侧菜单",
    "url": "http://sut/app",
    "keyDom": True,
}

_ENV_KEYS = (
    "SUT_SPIN_GUARD_MODE",
    "SUT_SPIN_GUARD_PROGRESS_WINDOW",
    "SUT_SPIN_GUARD_503_TEXT_WINDOW",
    "SUT_SPIN_GUARD_DOM_MISSING_WINDOW",
)


def _guard_fn():
    import scripts.agent.recorder_emitters as rem
    fn = getattr(rem, "_guard_spin_on_step_end", None)
    if fn is None:
        check(False, "recorder_emitters._guard_spin_on_step_end missing")
        return None
    return fn


def _mk_agent(n, url, page=None):
    agent = _FAgent(n, [url])
    if page is None:
        agent.browser_context = _FBombContext()
    else:
        agent.browser_context = _FBrowserContext(page)
    return agent


def _step(guard, agent, store, goal_tracker, actions=None):
    return asyncio.run(guard(agent, store, goal_tracker, actions))


def _no_spin_keys(store, msg):
    check(not any(str(k).startswith("_spin_guard_") for k in store), msg)


def _patch_modules():
    import scripts.agent_utils as au
    import scripts.state as st
    au.emit_json = lambda d: emitted.append(d)
    st.get_current_run_id = lambda: "run-pin-1"
    st.get_current_phase = lambda: 3


# ============================== 行为用例 ==============================


def test_1_off_zero_io() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    agent = _FAgent(8, ["http://sut/app"])
    agent.browser_context = _FBombContext()
    saved = {k: os.environ.get(k) for k in _ENV_KEYS}
    try:
        for k in _ENV_KEYS:
            os.environ.pop(k, None)  # MODE 未设 → off
        for i in range(1, 9):
            r = _step(g, agent, store, gt, [])
            check(r is False, f"off step{i} returns False")
        check(not any(str(k).startswith("_spin_guard_") for k in store),
              "off mode writes no _spin_guard_ keys")
        check(getattr(agent.browser_context, "calls", 0) == 0,
              "off mode never touches the page")
        check(agent.state.stopped is False, "off mode never stops agent")
        check(len(emitted) == 0, "off mode never emits phase_error")
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _with_env(mode, **wins):
    """Context manager is overkill here; return (set, restore) pair usage via try/finally."""

    saved = {k: os.environ.get(k) for k in _ENV_KEYS}

    def _apply():
        for k in _ENV_KEYS:
            os.environ.pop(k, None)
        if mode is not None:
            os.environ["SUT_SPIN_GUARD_MODE"] = mode
        for k, v in wins.items():
            os.environ["SUT_SPIN_GUARD_" + k] = str(v)

    def _restore():
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    return _apply, _restore


def test_2_observation_only() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    page = _FPage(dict(_INFO_503))
    apply, restore = _with_env("observation", PROGRESS_WINDOW=2)
    apply()
    try:
        a1 = _mk_agent(1, "http://sut/app", page)
        check(_step(g, a1, store, gt, []) is False, "observation step1 returns False")
        check(page.evaluate_calls == 0, "observation step1 (window not full) does zero page I/O")
        a2 = _mk_agent(2, "http://sut/app", page)
        check(_step(g, a2, store, gt, []) is False, "observation step2 returns False")
        check(page.evaluate_calls == 1, "observation step2 probes exactly once")
        check(emitted == [], "observation never emits phase_error")
        check(a2.state.stopped is False, "observation never stops agent")
        obs = store.get("_spin_guard_observed_last") or {}
        check(obs.get("sutSignal") == "page_text_503",
              "observation records sutSignal page_text_503")
        check(obs.get("mode") == "observation", "observation record carries mode")
    finally:
        restore()


def test_3_hard_trigger_and_idempotent() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    page = _FPage(dict(_INFO_503))
    apply, restore = _with_env("hard", PROGRESS_WINDOW=2)
    apply()
    try:
        a1 = _mk_agent(1, "http://sut/app", page)
        check(_step(g, a1, store, gt, []) is False, "hard step1 (stall=1<2) returns False")
        a2 = _mk_agent(2, "http://sut/app", page)
        check(_step(g, a2, store, gt, []) is True, "hard step2 triggers (returns True)")
        check(len(emitted) == 1, "hard trigger emits exactly one event")
        ev = emitted[0] if emitted else {}
        check(ev.get("event") == "phase_error", "emitted event is phase_error")
        data = ev.get("data") or {}
        check(data.get("reason") == "sut_unavailable_spin_guard",
              "payload reason is sut_unavailable_spin_guard")
        check(data.get("runId") == "run-pin-1", "payload carries runId run-pin-1")
        check((data.get("spinGuard") or {}).get("mode") == "hard",
              "spinGuard.mode is hard")
        check(data.get("phase") == 3, "payload phase is 3")
        check("message" in data, "payload carries message")
        check(a2.state.stopped is True, "hard trigger sets agent.state.stopped")
        check(gt.get("stopped") is True, "hard trigger sets goal_tracker stopped")
        check((store.get("_spin_guard_triggered") or {}).get("mode") == "hard",
              "store stamps _spin_guard_triggered mode=hard")
        # 已触发后（store 有 _spin_guard_triggered）不得重复发 phase_error
        a3 = _mk_agent(3, "http://sut/app", page)
        _step(g, a3, store, gt, [])
        check(len(emitted) == 1, "already-triggered guard must not re-emit phase_error")
    finally:
        restore()


def test_4_progress_blocks_trigger() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    page = _FPage(dict(_INFO_HEALTHY))
    apply, restore = _with_env("hard", PROGRESS_WINDOW=2)
    apply()
    try:
        agents = []
        for i, url in enumerate(["http://sut/a", "http://sut/b", "http://sut/b", "http://sut/b"], 1):
            ai = _mk_agent(i, url, page)
            agents.append(ai)
            r = _step(g, ai, store, gt, [])
            check(r is False, f"healthy page + B window step{i} returns False")
        check(emitted == [], "healthy page never emits phase_error")
        check(all(not a.state.stopped for a in agents),
              "healthy page never stops agent (A not met even when B full)")
        check(page.evaluate_calls == 1, "healthy page probed once (at stall==window)")
    finally:
        restore()


def test_4b_progress_postpones_window() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    page = _FPage(dict(_INFO_503))
    apply, restore = _with_env("hard", PROGRESS_WINDOW=2)
    apply()
    try:
        a1 = _mk_agent(1, "http://sut/a", page)
        check(_step(g, a1, store, gt, []) is False, "4b step1 stall=1 returns False")
        a2 = _mk_agent(2, "http://sut/b", page)
        check(_step(g, a2, store, gt, []) is False,
              "4b step2 url change is progress (stall reset) returns False")
        a3 = _mk_agent(3, "http://sut/b", page)
        check(_step(g, a3, store, gt, []) is False, "4b step3 stall=1 returns False")
        a4 = _mk_agent(4, "http://sut/b", page)
        check(_step(g, a4, store, gt, []) is True,
              "4b step4 stall=2 + 503 triggers (progress postpones, not pardons)")
        check(len(emitted) == 1, "4b emits exactly one phase_error")
    finally:
        restore()


def test_5_dom_missing_trigger() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    info = {"title": "", "text": "空白页", "url": "http://sut/app", "keyDom": False}
    page = _FPage(info)
    apply, restore = _with_env("hard", PROGRESS_WINDOW=1, DOM_MISSING_WINDOW=1)
    apply()
    try:
        a1 = _mk_agent(1, "http://sut/app", page)
        check(_step(g, a1, store, gt, []) is True, "A4 first step triggers (window=1)")
        ev = emitted[0] if emitted else {}
        check((ev.get("data") or {}).get("spinGuard", {}).get("sutSignal") == "dom_missing",
              "A4 signal is dom_missing")
    finally:
        restore()


def test_6_container_reopen_not_progress() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    page = _FPage(dict(_INFO_503))
    apply, restore = _with_env("hard", PROGRESS_WINDOW=1)
    apply()
    try:
        store["_active_container"] = "main"
        a1 = _mk_agent(1, "http://sut/app", page)
        check(_step(g, a1, store, gt, []) is False, "container main first open = progress")
        store["_active_container"] = "dlg"
        a2 = _mk_agent(2, "http://sut/app", page)
        check(_step(g, a2, store, gt, []) is False, "container dlg first open = progress")
        store["_active_container"] = "main"
        a3 = _mk_agent(3, "http://sut/app", page)
        check(_step(g, a3, store, gt, []) is True,
              "container main reopen is NOT progress → stall full + 503 triggers")
        check(len(emitted) == 1, "container case emits exactly one phase_error")
    finally:
        restore()


def test_7_wait_for_loading_excluded() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    page = _FPage(dict(_INFO_503))
    apply, restore = _with_env("hard", PROGRESS_WINDOW=1)
    apply()
    try:
        a1 = _mk_agent(1, "http://sut/app", page)
        r = _step(g, a1, store, gt, ['{"wait_for_loading": {}}'])
        check(r is False, "wait_for_loading step returns False (excluded)")
        check(page.evaluate_calls == 0, "wait_for_loading step does zero page I/O")
        a2 = _mk_agent(2, "http://sut/app", page)
        check(_step(g, a2, store, gt, []) is True,
              "next step without wait + 503 page triggers")
        check(len(emitted) == 1, "wait-excluded case emits exactly one phase_error")
    finally:
        restore()


def test_8_query_mode_excluded() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    store["_task_mode"] = "query"
    page = _FPage(dict(_INFO_503))
    apply, restore = _with_env("hard", PROGRESS_WINDOW=1)
    apply()
    try:
        a1 = _mk_agent(1, "http://sut/app", page)
        r = _step(g, a1, store, gt, [])
        check(r is False, "query mode step returns False")
        check(getattr(page, "evaluate_calls", 0) == 0,
              "query mode does zero page I/O")
        _no_spin_keys(store, "query mode writes no _spin_guard_ keys")
        check(emitted == [], "query mode never emits phase_error")
    finally:
        restore()


def test_9_url_error_page_trigger() -> None:
    g = _guard_fn()
    if g is None:
        return
    emitted.clear()
    store, gt = {}, {}
    info = {
        "title": "",
        "text": "普通页面文本",
        "url": "http://sut/error?x=1",
        "keyDom": True,
    }
    page = _FPage(info)
    apply, restore = _with_env("hard", PROGRESS_WINDOW=1)
    apply()
    try:
        a1 = _mk_agent(1, "http://sut/error?x=1", page)
        check(_step(g, a1, store, gt, []) is False,
              "A3 needs 2 consecutive steps: step1 (a3=1) returns False")
        a2 = _mk_agent(2, "http://sut/error?x=1", page)
        check(_step(g, a2, store, gt, []) is True,
              "A3 step2 (a3=2) triggers")
        ev = emitted[0] if emitted else {}
        check((ev.get("data") or {}).get("spinGuard", {}).get("sutSignal") == "url_error_page",
              "A3 signal is url_error_page")
    finally:
        restore()


def main() -> int:
    _patch_modules()
    test_source_needles_recorder_emitters()
    test_source_needles_recorder_call_order()
    test_source_needles_service_and_verifyall()
    test_1_off_zero_io()
    test_2_observation_only()
    test_3_hard_trigger_and_idempotent()
    test_4_progress_blocks_trigger()
    test_4b_progress_postpones_window()
    test_5_dom_missing_trigger()
    test_6_container_reopen_not_progress()
    test_7_wait_for_loading_excluded()
    test_8_query_mode_excluded()
    test_9_url_error_page_trigger()
    if _FAILURES:
        print(
            f"characterize-sut-spin-guard: FAIL "
            f"({len(_FAILURES)}/{_CHECKS} checks failed)"
        )
        return 1
    print(f"characterize-sut-spin-guard: OK {_CHECKS} passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
