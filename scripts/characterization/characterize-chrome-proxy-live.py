#!/usr/bin/env python3
"""Characterize (on-demand, real chromium): Chrome --proxy-server -> d2-503-proxy E2E.

Covers the gap the offline pin cannot: does REAL Chrome honor the appended
``--proxy-server`` and route page requests through the proxy?

Key mechanism (learned live 2026-09-21): Chromium implicitly bypasses the
proxy for loopback hosts (``localhost``/``127.0.0.1``) — an e2e against a
localhost origin would take the DIRECT path and false-pass. The production
SUT (`http://test.creditv5p2…`) is non-loopback and unaffected. So this check
uses a FAKE origin hostname (``sut-selfcheck.invalid``): Chrome cannot resolve
it and does not bypass it, the proxy dials it via ``--map`` to a loopback
origin, and every assertion below only passes when Chrome really used the
proxy.

1. flag absent -> factory args carry no --proxy-server; (control skipped for
   the fake host — direct would be DNS failure, which is itself asserted);
2. flag on + proxy disarmed -> page loads via proxy forward (origin body);
3. flag on + proxy armed -> page renders 503 "Service Unavailable" (the #925
   page text the spin guard's A1 signal targets);
4. negative control: proxy dead -> navigation fails ERR_PROXY_CONNECTION_FAILED
   (proves the arg is live, not silently ignored).

Run: ./python/python.exe scripts/characterization/characterize-chrome-proxy-live.py
On-demand only (bundled chromium + free local ports); NOT registered in verify-all.
"""
from __future__ import annotations

import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FAKE_HOST = 'sut-selfcheck.invalid'

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


class _Origin(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'OK-FROM-ORIGIN'
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


def _free_port() -> int:
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main() -> int:
    from playwright.sync_api import sync_playwright

    import scripts.browser.factory as factory

    origin = HTTPServer(('127.0.0.1', 0), _Origin)
    origin_port = origin.server_address[1]
    threading.Thread(target=origin.serve_forever, daemon=True).start()

    proxy_port = _free_port()
    proxy_log = ROOT / 'tmp' / 'd2-accept-sim' / 'e2e-proxy.log'
    mode = ROOT / 'tmp' / 'd2-accept-sim' / 'MODE'
    flag = ROOT / 'tmp' / 'chrome-proxy.flag'
    for p in (mode, flag):
        if p.exists():
            p.unlink()
    if proxy_log.exists():
        proxy_log.unlink()

    proc = subprocess.Popen(
        [sys.executable, str(ROOT / 'tmp/d2-accept-sim/d2-503-proxy.py'),
         '--listen', f'127.0.0.1:{proxy_port}',
         '--host', FAKE_HOST,
         '--arm-file', str(ROOT / 'tmp/d2-accept-sim/ARM'),
         '--mode-file', str(mode),
         '--map', f'{FAKE_HOST}=127.0.0.1',
         '--log', str(proxy_log)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.0)
        with sync_playwright() as pw:
            args = factory._chrome_automation_args()
            check(not any(a.startswith('--proxy-server') for a in args),
                  'precondition: flag absent -> factory args carry no proxy')

            # control: no proxy -> fake host is unresolvable -> DNS error
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page()
            dns_failed = False
            try:
                page.goto(f'http://{FAKE_HOST}:{origin_port}/ping', timeout=10000)
            except Exception:
                dns_failed = True
            check(dns_failed,
                  'control: no proxy -> fake host unreachable (DNS fail, so any '
                  'later success can only come via proxy)')
            browser.close()

            # flag on (proxy disarmed) -> chrome routes via proxy, origin seen
            flag.write_text(f'127.0.0.1:{proxy_port}\n', encoding='utf-8')
            args = factory._chrome_automation_args()
            check(any(a == f'--proxy-server=http://127.0.0.1:{proxy_port}' for a in args),
                  'flag on -> factory args carry --proxy-server')
            browser = pw.chromium.launch(headless=True, args=args)
            page = browser.new_page()
            page.goto(f'http://{FAKE_HOST}:{origin_port}/ping', timeout=15000)
            via_proxy = page.content()
            check('OK-FROM-ORIGIN' in via_proxy,
                  'flag on + proxy disarmed -> page loads via proxy (forwarded)')
            browser.close()

            # arm -> chrome sees 503 page
            arm = ROOT / 'tmp' / 'd2-accept-sim' / 'ARM'
            arm.write_text('on\n', encoding='utf-8')
            browser = pw.chromium.launch(headless=True, args=args)
            page = browser.new_page()
            page.goto(f'http://{FAKE_HOST}:{origin_port}/ping', timeout=15000)
            body = page.content()
            check('Service Unavailable' in body,
                  'flag on + proxy armed -> chrome renders 503 Service Unavailable')
            browser.close()
            arm.unlink()

            # negative control: proxy dead -> navigation must fail (proves routing)
            proc.kill()
            proc.wait()
            time.sleep(0.3)
            browser = pw.chromium.launch(headless=True, args=args)
            page = browser.new_page()
            nav_failed = False
            try:
                page.goto(f'http://{FAKE_HOST}:{origin_port}/ping', timeout=8000)
            except Exception:
                nav_failed = True
            check(nav_failed, 'negative control: proxy dead -> navigation fails (arg is live)')
            browser.close()
    finally:
        if proc.poll() is None:
            proc.kill()
        arm_path = ROOT / 'tmp' / 'd2-accept-sim' / 'ARM'
        for p in (mode, flag, arm_path):
            if p.exists():
                p.unlink()
        origin.shutdown()

    print(f"characterize-chrome-proxy-live: {'OK' if not _FAILURES else 'FAILED'} "
          f"{_CHECKS - len(_FAILURES)}/{_CHECKS} passed")
    return 0 if not _FAILURES else 1


if __name__ == '__main__':
    sys.exit(main())
