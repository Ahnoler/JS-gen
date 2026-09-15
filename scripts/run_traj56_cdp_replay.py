#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
轨迹 56 CDP 回放脚本。

本脚本在本地 CDP（端口 9242）上回放轨迹 56，使用固定的 _replay 持久化点击。

用法（从仓库根目录）：
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

# 从 config/.env 轻量加载数据库凭证
def _load_env():
    """
    从 config/.env 文件加载环境变量。

    读取配置文件中的键值对，使用 setdefault 设置环境变量，
    避免覆盖已存在的环境变量。
    """
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
    """
    页面上下文封装类。

    封装 Playwright 页面对象，提供 get_current_page() 方法
    以兼容 controller 的接口要求。
    """
    def __init__(self, page):
        """
        初始化页面上下文。

        参数：
            page: Playwright 页面对象
        """
        self._page = page

    async def get_current_page(self):
        """
        获取当前页面。

        返回：
            页面对象
        """
        return self._page


async def _pre_nav(page, click_js: str) -> None:
    """
    冷启动导航：首页 → 产品管理 → 产品阶段管理。

    执行步骤 1-14（假设已在阶段页面）。

    参数：
        page: Playwright 页面对象
        click_js (str): 点击操作的 JavaScript 代码
    """
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
    """
    主函数：从数据库加载轨迹 56 并在 CDP 浏览器上回放。

    连接 MySQL 数据库获取轨迹步骤，然后通过 CDP 连接 Playwright
    浏览器执行回放，最后将结果保存到 JSON 文件。

    返回：
        int: 退出码，回放成功返回 0，有失败返回 1
    """
    import pymysql
    from playwright.async_api import async_playwright
    from scripts.controller.actions._replay import _JS_CLICK_DURABLE, replay_action_entries

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
                WHERE trajectory_id=%s
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
            """回放事件回调函数，输出每步回放结果。"""
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
            business_data_store={},
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
