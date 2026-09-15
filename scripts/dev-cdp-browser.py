#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
开发用 CDP 浏览器启动脚本。

本脚本启动一个带 CDP（Chrome DevTools Protocol）的有头 Chromium 浏览器，
用于手动导航和后续检查。默认在端口 9242 上启动。

用法：
    python scripts/dev-cdp-browser.py
    python scripts/dev-cdp-browser.py --port 9242 --url about:blank

当项目 browser/ 目录为空时，优先使用 %LOCALAPPDATA%\\ms-playwright 中的浏览器。
"""
from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path


def _ensure_browsers_path() -> None:
    """
    确保 Playwright 浏览器路径正确设置。

    避免空的项目 browser/ 目录遮蔽真实的 Playwright 安装。
    如果环境变量 PLAYWRIGHT_BROWSERS_PATH 已设置且包含 Chromium，
    则不做任何操作；否则尝试使用 %LOCALAPPDATA%\\ms-playwright。
    """
    cur = os.environ.get('PLAYWRIGHT_BROWSERS_PATH', '').strip()
    if cur:
        chrome = list(Path(cur).glob('chromium-*/chrome-win*/chrome.exe'))
        if chrome:
            return
    local = Path(os.environ.get('LOCALAPPDATA', '')) / 'ms-playwright'
    if list(local.glob('chromium-*/chrome-win*/chrome.exe')):
        os.environ['PLAYWRIGHT_BROWSERS_PATH'] = str(local)


async def main() -> int:
    """
    主函数：启动带 CDP 的 Chromium 浏览器。

    解析命令行参数，设置浏览器路径，启动 Chromium 浏览器并保持运行
    直到用户中断。浏览器关闭后返回 0。

    返回：
        int: 退出码，正常关闭返回 0
    """
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=9242)
    ap.add_argument('--url', default='about:blank')
    args = ap.parse_args()
    _ensure_browsers_path()

    from playwright.async_api import async_playwright

    print(f'[dev-cdp] launching Chromium CDP http://127.0.0.1:{args.port}', flush=True)
    print(f'[dev-cdp] PLAYWRIGHT_BROWSERS_PATH={os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "")}', flush=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=[
                f'--remote-debugging-port={args.port}',
                '--remote-allow-origins=*',
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
            ],
        )
        context = await browser.new_context(no_viewport=True)
        page = await context.new_page()
        await page.goto(args.url, wait_until='domcontentloaded')
        print('[dev-cdp] ready — navigate freely in the window', flush=True)
        print(f'[dev-cdp] CDP: http://127.0.0.1:{args.port}/json/version', flush=True)
        print('[dev-cdp] tell the agent when to start inspect / xpath work', flush=True)
        try:
            while browser.is_connected():
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            await browser.close()
    print('[dev-cdp] closed', flush=True)
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        raise SystemExit(0)
