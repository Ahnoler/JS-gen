#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Replay trajectory 56 on local CDP (9242) using fixed _replay durable clicks.

Usage (from repo root):
  set PYTHONPATH=.
  python scripts/run_traj56_cdp_replay.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Load DB creds from config/.env lightly
def _load_env():
    env_path = ROOT / 'config' / '.env'
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        os.environ.setdefault(k.strip(), v.strip())


_load_env()


class _PageCtx:
    def __init__(self, page):
        self._page = page

    async def get_current_page(self):
        return self._page


async def _pre_nav(page, click_js: str) -> None:
    """Cold start: home → 产品管理 → 产品阶段管理 (steps 1–14 assume stage page)."""
    home = 'http://test.creditv5p2.tansun.com.cn/#/home?part=home'
    await page.goto(home, wait_until='domcontentloaded', timeout=60000)
    await page.wait_for_timeout(1200)
    xpath_menu = (
        "//*[self::li or self::a or self::div or self::span]"
        "[@role='menuitem'][normalize-space()='产品管理']"
    )
    r1 = await page.evaluate(click_js, ['产品管理', '', '', xpath_menu])
    print(f'[pre] 产品管理 → {r1}', flush=True)
    await page.wait_for_timeout(700)
    r2 = await page.evaluate(click_js, ['产品阶段管理', '', '', ''])
    print(f'[pre] 产品阶段管理 → {r2}', flush=True)
    await page.wait_for_timeout(1500)
    print(f'[pre] url={page.url}', flush=True)


async def main() -> int:
    import pymysql
    from playwright.async_api import async_playwright
    from scripts.actions._replay import _JS_CLICK_DURABLE, replay_action_entries

    host = os.environ.get('DB_HOST', '127.0.0.1')
    port = int(os.environ.get('DB_PORT', '3306'))
    user = os.environ.get('DB_USER', 'root')
    password = os.environ.get('DB_PASS', '')
    database = os.environ.get('DB_NAME', 'js_gen')

    conn = pymysql.connect(
        host=host, port=port, user=user, password=password,
        database=database, charset='utf8mb4',
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, step_number, action_type, params_json, element_json
                FROM trajectory_step
                WHERE trajectory_id=%s AND (is_replay=0 OR is_replay IS NULL)
                ORDER BY step_number, action_index
                """,
                (56,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    entries = []
    for sid, step_number, action_type, params_json, element_json in rows:
        params = params_json if isinstance(params_json, dict) else json.loads(params_json or '{}')
        element = element_json if isinstance(element_json, dict) else json.loads(element_json or '{}')
        entries.append({
            'id': sid,
            'action': action_type,
            'params': params or {},
            'element': element or {},
            'target': (element or {}).get('xpath_smart') or (element or {}).get('xpath') or '',
        })

    print(f'[replay] loaded {len(entries)} steps for trajectory 56', flush=True)

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://127.0.0.1:9242')
        ctx = browser.contexts[0]
        page = next((pg for pg in ctx.pages if 'tansun' in (pg.url or '')), ctx.pages[0])
        print(f'[replay] start url={page.url}', flush=True)

        await _pre_nav(page, _JS_CLICK_DURABLE)

        def emit(msg):
            ev = msg.get('event')
            data = msg.get('data') or {}
            if ev == 'replay_step':
                flag = 'OK' if data.get('ok') else 'FAIL'
                print(
                    f"  [{data.get('index')}/{data.get('total')}] {flag} "
                    f"{data.get('action')} id={data.get('id')} → {data.get('result')}",
                    flush=True,
                )

        summary = await replay_action_entries(
            _PageCtx(page),
            entries,
            controller_actions=None,
            case_data_store={},
            emit=emit,
            stop_on_fail=False,
        )

        out = {
            'trajectoryId': 56,
            'finalUrl': page.url,
            'summary': {
                'count': summary.get('count'),
                'ok': summary.get('ok'),
                'failed': summary.get('failed'),
                'error': summary.get('error'),
            },
            'results': summary.get('results') or [],
        }
        out_path = ROOT / 'scripts' / '_traj56_replay_result.json'
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
        print(
            f"[replay] done ok={summary.get('ok')} failed={summary.get('failed')} "
            f"url={page.url}",
            flush=True,
        )
        print(f'[replay] wrote {out_path}', flush=True)
        return 0 if not summary.get('failed') else 1


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
