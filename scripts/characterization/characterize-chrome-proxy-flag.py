#!/usr/bin/env python3
"""Characterize: Chrome 代理启动位 flag 文件门控（D2 A/C 腿加速件）。

背景：D2 A/C 腿（SUT 503 场景）被外部依赖阻塞（SUT 侧不配合制造 503 窗口），
加速路径 = 本地 503 转发代理 + Chrome ``--proxy-server``。实查
``scripts/browser/factory.py::_chrome_automation_args()`` 硬编码无代理位，
本 pin 钉住最小交付：

- ``tmp/chrome-proxy.flag`` 存在才追加 ``--proxy-server=<url>``，默认（文件
  不存在）零行为影响、逐字节等同现状；
- flag 内容：空文件/无 scheme 的 ``host:port`` 归一化/完整 URL 直用/无法解析
  回落默认 ``http://127.0.0.1:8899``；
- **不追加** ``--proxy-bypass-list``：Chrome 对 loopback 有隐式直连规则，CDP/
  执行机/控制面流量必须不走代理（``<-loopback>`` 反向语义是坑，禁止）；
- 每次浏览器启动即时读取 flag（会话级开关，删文件即恢复直连，无需重启）。

源码 needle 断言 pin 住：常量与 helper 存在、verify-all 注册。
"""
from __future__ import annotations

import os
import sys
import tempfile
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


def test_source_needles_factory() -> None:
    src = (ROOT / "scripts/browser/factory.py").read_text(encoding="utf-8")
    check("_CHROME_PROXY_FLAG" in src,
          "factory defines _CHROME_PROXY_FLAG flag path constant")
    check("chrome-proxy.flag" in src,
          "factory flag path is tmp/chrome-proxy.flag")
    check("--proxy-server=" in src,
          "factory appends --proxy-server= arg")
    check("def _chrome_proxy_server" in src,
          "factory defines _chrome_proxy_server reader")
    check("127.0.0.1:8899" in src,
          "factory default proxy is http://127.0.0.1:8899")
    check("--proxy-bypass-list" not in src,
          "factory must NOT add --proxy-bypass-list (implicit loopback bypass stays)")


def test_source_needles_verify_all() -> None:
    src = (ROOT / "scripts/refactor/verify-all.sh").read_text(encoding="utf-8")
    check("characterize-chrome-proxy-flag" in src,
          "verify-all registers characterize-chrome-proxy-flag")


# ============================== 行为冒烟（真 import） ==============================


def _import_factory():
    import scripts.browser.factory as factory
    return factory


def test_flag_absent_zero_impact() -> None:
    factory = _import_factory()
    with tempfile.TemporaryDirectory() as td:
        flag = Path(td) / "chrome-proxy.flag"
        saved = factory._CHROME_PROXY_FLAG
        factory._CHROME_PROXY_FLAG = flag
        try:
            base = factory._chrome_automation_args()
            check(not any(a.startswith("--proxy-server") for a in base),
                  "no flag file -> no --proxy-server arg")
            check(factory._chrome_proxy_server() is None,
                  "_chrome_proxy_server returns None when flag file absent")
            # 开关开启后其余参数不变：仅多一个 proxy 参数
            flag.write_text("http://127.0.0.1:8899\n", encoding="utf-8")
            withproxy = factory._chrome_automation_args()
            check(withproxy[: len(base)] == base,
                  "proxy arg appended after unchanged base args")
            check(withproxy[len(base):] == ["--proxy-server=http://127.0.0.1:8899"],
                  "flag on -> exactly one --proxy-server arg appended")
        finally:
            factory._CHROME_PROXY_FLAG = saved


def test_flag_content_forms() -> None:
    factory = _import_factory()
    cases = [
        # (文件内容, 期望 --proxy-server 值, 用例名)
        ("http://127.0.0.1:8899\n", "http://127.0.0.1:8899", "full url"),
        ("  http://10.0.0.5:3128  \n\n", "http://10.0.0.5:3128", "full url + blank lines/whitespace"),
        ("127.0.0.1:8899\n", "http://127.0.0.1:8899", "host:port normalized"),
        ("\n", "http://127.0.0.1:8899", "empty file -> default"),
        ("   \n\t\n", "http://127.0.0.1:8899", "whitespace-only -> default"),
        ("localhost:8899\n", "http://localhost:8899", "localhost host:port"),
        ("garbage no colon\n", "http://127.0.0.1:8899", "unparseable -> default"),
        ("192.168.1.9:8899\n", "http://192.168.1.9:8899", "lan host:port"),
    ]
    with tempfile.TemporaryDirectory() as td:
        flag = Path(td) / "chrome-proxy.flag"
        saved = factory._CHROME_PROXY_FLAG
        factory._CHROME_PROXY_FLAG = flag
        try:
            for content, expected, name in cases:
                flag.write_text(content, encoding="utf-8")
                got = factory._chrome_proxy_server()
                check(got == expected, f"flag form [{name}]: got {got!r} want {expected!r}")
            # 每次启动即时读取：删文件即恢复直连（不缓存）
            flag.write_text("http://127.0.0.1:8899\n", encoding="utf-8")
            check(factory._chrome_proxy_server() == "http://127.0.0.1:8899",
                  "flag read live (on)")
            flag.unlink()
            check(factory._chrome_proxy_server() is None,
                  "flag removed -> direct again (no caching)")
        finally:
            factory._CHROME_PROXY_FLAG = saved


def test_headless_coexistence() -> None:
    factory = _import_factory()
    with tempfile.TemporaryDirectory() as td:
        flag = Path(td) / "chrome-proxy.flag"
        flag.write_text("http://127.0.0.1:8899\n", encoding="utf-8")
        saved_flag = factory._CHROME_PROXY_FLAG
        saved_headless = os.environ.get("CHROME_HEADLESS")
        factory._CHROME_PROXY_FLAG = flag
        os.environ["CHROME_HEADLESS"] = "1"
        try:
            args = factory._chrome_automation_args()
            check("--proxy-server=http://127.0.0.1:8899" in args,
                  "proxy arg present with headless")
            check("--headless=new" in args, "headless arg still present")
        finally:
            factory._CHROME_PROXY_FLAG = saved_flag
            if saved_headless is None:
                os.environ.pop("CHROME_HEADLESS", None)
            else:
                os.environ["CHROME_HEADLESS"] = saved_headless


def main() -> int:
    test_source_needles_factory()
    test_source_needles_verify_all()
    test_flag_absent_zero_impact()
    test_flag_content_forms()
    test_headless_coexistence()
    print(f"characterize-chrome-proxy-flag: {'OK' if not _FAILURES else 'FAILED'} "
          f"{_CHECKS - len(_FAILURES)}/{_CHECKS} passed")
    return 0 if not _FAILURES else 1


if __name__ == "__main__":
    sys.exit(main())
