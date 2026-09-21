#!/usr/bin/env python3
"""Live component check: D2 SUT 503 spin guard against a REAL browser DOM.

On-demand check (NOT registered in verify-all: needs bundled chromium).
Run: ./python/python.exe scripts/characterization/characterize-sut-spin-guard-live.py

Why this exists: the offline pin (`characterize-sut-spin-guard.py`) drives the
guard with a _FakePage returning canned dicts, so `_SUT_SPIN_GUARD_PROBE_JS`
itself is never executed and the real `page.evaluate` plumbing is never
exercised -- a probe-JS typo would be swallowed by the guard's try/except and
the guard would silently never fire. This check closes that gap: it runs the
real probe JS (and the full guard) against a real chromium page shaped like
the #925 evidence (app shell alive + "Service Unavailable" notification).

Evidence use: D2 A/C legs (real 503 SUT window) remain the end-to-end gate;
this is the component-level half (probe JS + evaluate plumbing + marker match
+ emit/stop path) that does not depend on SUT availability.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

_CHECKS = {'n': 0, 'fail': 0}


def check(cond: bool, msg: str) -> None:
    """Count and assert one check (prints FAIL line on violation, then aborts)."""
    _CHECKS['n'] += 1
    if not cond:
        _CHECKS['fail'] += 1
        print(f'FAIL: {msg}')
        raise AssertionError(msg)


# ---- #925-shaped DOM fixtures (Element UI app shell + SUT error notification) ----
PAGE_503_SHAPE = """
<html><head><title>业务系统</title></head><body>
  <div class="el-container">
    <div class="el-aside">menu</div>
    <div class="el-main">
      <div class="el-form"><div class="el-form-item">客户名称</div></div>
      <div class="el-notification">
        <p class="el-notification__title">异常信息</p>
        <p class="el-notification__content">Service Unavailable</p>
      </div>
    </div>
  </div>
</body></html>
"""

PAGE_HEALTHY = """
<html><head><title>业务系统</title></head><body>
  <div class="el-container">
    <div class="el-form"><div class="el-form-item">客户名称</div></div>
    <div class="el-table"><table><tr><td>row</td></tr></table></div>
  </div>
</body></html>
"""

PAGE_BARE_503 = """
<html><head><title>503 Service Unavailable</title></head><body>
  <h1>503 Service Unavailable</h1><p>no application server</p>
</body></html>
"""


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
    def __init__(self, n, urls, browser_context=None):
        self.state = _FState(n, urls)
        self.browser_context = browser_context


class _RealPageContext:
    """browser_context wrapper exposing a real playwright page."""

    def __init__(self, page):
        self._page = page

    async def get_current_page(self):
        return self._page


class _Env:
    """Context manager for SUT_SPIN_GUARD_* env vars (restores on exit)."""

    KEYS = (
        'SUT_SPIN_GUARD_MODE', 'SUT_SPIN_GUARD_PROGRESS_WINDOW',
        'SUT_SPIN_GUARD_503_TEXT_WINDOW', 'SUT_SPIN_GUARD_DOM_MISSING_WINDOW',
    )

    def __init__(self, **kw):
        self.kw = kw
        self.saved = {}

    def __enter__(self):
        for k in self.KEYS:
            self.saved[k] = os.environ.get(k)
            os.environ.pop(k, None)
        for k, v in self.kw.items():
            os.environ[k] = str(v)
        return self

    def __exit__(self, *exc):
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _patch_state(phase=3, run_id='run-live-1'):
    import scripts.state as st
    st.get_current_phase = lambda: phase
    st.get_current_run_id = lambda: run_id


def _patch_emit():
    import scripts.agent_utils as au
    emitted = []
    au.emit_json = lambda d: emitted.append(d)
    return emitted


async def step_guard(page, store, agent, actions=None, phase=3, run_id='run-live-1'):
    """One guard call with real page + patched state/emit; returns (ret, emitted-list)."""
    from scripts.agent.recorder_emitters import _guard_spin_on_step_end
    _patch_state(phase=phase, run_id=run_id)
    emitted = _patch_emit()
    ret = await _guard_spin_on_step_end(agent, store, {}, actions or [])
    return ret, emitted


async def run(page):
    from scripts.agent.recorder_emitters import _SUT_SPIN_GUARD_PROBE_JS

    # ---- Case 1: real probe JS against the #925-shaped DOM ----
    await page.set_content(PAGE_503_SHAPE)
    info = await page.evaluate(_SUT_SPIN_GUARD_PROBE_JS)
    check(isinstance(info, dict), 'probe JS returns a dict (real evaluate plumbing)')
    check(set(info.keys()) == {'title', 'text', 'url', 'keyDom'},
          f'probe returns exactly the 4 contract keys (got {sorted(info.keys())})')
    check(info['keyDom'] is True, 'app-shell DOM detected (keyDom True on el-container page)')
    hay = str(info['title']) + ' ' + str(info['text'])
    check('service unavailable' in hay,
          'real innerText carries the 503 marker after collapse/lowercase')
    check('\n' not in str(info['text']), 'whitespace collapsed in text (no raw newlines)')

    # ---- Case 2: healthy page -> no markers, shell present ----
    await page.set_content(PAGE_HEALTHY)
    healthy = await page.evaluate(_SUT_SPIN_GUARD_PROBE_JS)
    hay_h = str(healthy['title']) + ' ' + str(healthy['text'])
    check(not any(m in hay_h for m in ('service unavailable', '服务不可用')),
          'healthy page carries no A1 marker')
    check(healthy['keyDom'] is True, 'healthy page keyDom True')

    # ---- Case 3: observation mode, real page, stall fills window -> observe only ----
    await page.set_content(PAGE_503_SHAPE)
    url = 'http://sut/app/list'
    store, agent = {}, _FAgent(10, [url], _RealPageContext(page))
    with _Env(SUT_SPIN_GUARD_MODE='observation', SUT_SPIN_GUARD_PROGRESS_WINDOW=2):
        ret1, em1 = await step_guard(page, store, agent)      # stall=1, zero I/O
        check(ret1 is False and 'phase' not in str(store.get('_spin_guard_phase', '')),
              'observation step1: no trigger, phase initialized')
        ret2, em2 = await step_guard(page, store, agent)      # stall=2 -> probe -> observed
        check(ret2 is False and em2 == [], 'observation: no phase_error emitted')
        check(agent.state.stopped is False, 'observation: agent NOT stopped')
        obs = store.get('_spin_guard_observed_last')
        check(isinstance(obs, dict) and obs.get('sutSignal') == 'page_text_503',
              f'observation: real-DOM 503 text hit (got {obs})')

    # ---- Case 4: soft mode, real page -> phase_error + stop ----
    store2, agent2 = {}, _FAgent(10, [url], _RealPageContext(page))
    with _Env(SUT_SPIN_GUARD_MODE='soft', SUT_SPIN_GUARD_PROGRESS_WINDOW=2):
        await step_guard(page, store2, agent2)
        ret, em = await step_guard(page, store2, agent2)
        check(ret is True, 'soft: guard reports triggered (caller returns)')
        check(len(em) == 1 and em[0]['event'] == 'phase_error',
              f'soft: exactly one phase_error via real emit path (got {len(em)})')
        data = em[0]['data'] if em else {}
        check(data.get('reason') == 'sut_unavailable_spin_guard', 'soft: reason field')
        check(data.get('runId') == 'run-live-1', 'soft: runId attached')
        check(data.get('spinGuard', {}).get('sutSignal') == 'page_text_503',
              'soft: spinGuard.sutSignal from real DOM')
        check(agent2.state.stopped is True, 'soft: agent stopped')

    # ---- Case 5: bare 503 page (no Element DOM) -> A4 dom_missing ----
    await page.set_content(PAGE_BARE_503)
    # navigate to a blank-origin doc so the URL carries no error marker (A3 must not fire)
    store3, agent3 = {}, _FAgent(10, [url], _RealPageContext(page))
    with _Env(SUT_SPIN_GUARD_MODE='soft', SUT_SPIN_GUARD_PROGRESS_WINDOW=1,
              SUT_SPIN_GUARD_503_TEXT_WINDOW=99, SUT_SPIN_GUARD_DOM_MISSING_WINDOW=1):
        ret, em = await step_guard(page, store3, agent3)
        check(ret is True, 'A4: bare 503 page triggers with dom window 1')
        check(store3.get('_spin_guard_triggered', {}).get('sutSignal') == 'dom_missing',
              f"A4: signal is dom_missing (got {store3.get('_spin_guard_triggered', {}).get('sutSignal')})")

    # ---- Case 6: healthy page, window filled -> never triggers (real page) ----
    await page.set_content(PAGE_HEALTHY)
    store4, agent4 = {}, _FAgent(10, [url], _RealPageContext(page))
    with _Env(SUT_SPIN_GUARD_MODE='hard', SUT_SPIN_GUARD_PROGRESS_WINDOW=1,
              SUT_SPIN_GUARD_503_TEXT_WINDOW=1, SUT_SPIN_GUARD_DOM_MISSING_WINDOW=99):
        for _ in range(3):
            ret, em = await step_guard(page, store4, agent4)
            check(ret is False and em == [] and agent4.state.stopped is False,
                  'healthy real page: no trigger across 3 stalled steps')
            agent4.state.n_steps += 1

    # ---- Case 7: query-mode exclusion still holds with real page ----
    store5, agent5 = {'_task_mode': 'query'}, _FAgent(10, [url], _RealPageContext(page))
    with _Env(SUT_SPIN_GUARD_MODE='hard', SUT_SPIN_GUARD_PROGRESS_WINDOW=1):
        ret, em = await step_guard(page, store5, agent5)
        check(ret is False and em == [], 'query mode excluded even with real 503 page')


def main() -> None:
    from playwright.async_api import async_playwright

    async def _main():
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            try:
                await run(page)
            finally:
                await browser.close()

    asyncio.run(_main())
    print(f'characterize-sut-spin-guard-live: OK {_CHECKS["n"]} passed '
          f'(real chromium + real probe JS)')


if __name__ == '__main__':
    main()
