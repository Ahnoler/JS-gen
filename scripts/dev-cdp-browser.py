#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Launch a headed Chromium with CDP on 9242 for manual navigation + later inspect.

Usage:
  python scripts/dev-cdp-browser.py
  python scripts/dev-cdp-browser.py --port 9242 --url about:blank

Prefers %LOCALAPPDATA%\\ms-playwright when project browser/ is empty.
"""
from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path


def _ensure_browsers_path() -> None:
    """Avoid empty project browser/ shadowing a real Playwright install."""
    cur = os.environ.get('PLAYWRIGHT_BROWSERS_PATH', '').strip()
    if cur:
        chrome = list(Path(cur).glob('chromium-*/chrome-win*/chrome.exe'))
        if chrome:
            return
    local = Path(os.environ.get('LOCALAPPDATA', '')) / 'ms-playwright'
    if list(local.glob('chromium-*/chrome-win*/chrome.exe')):
        os.environ['PLAYWRIGHT_BROWSERS_PATH'] = str(local)


async def main() -> int:
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
