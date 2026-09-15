"""
CDP 端口探测工具模块。

本模块提供 Chrome DevTools Protocol (CDP) 端口相关的工具函数，
用于交互式会话运行器中 CDP 连接的建立和管理。

主要功能：
- 端口可连接性检测
- 空闲 CDP 端口选择
- CDP HTTP 就绪等待
- WebSocket URL 探测
"""
import asyncio
import json
import sys


def _port_is_connectable(host: str, port: int) -> bool:
    """
    检测指定主机和端口是否可连接。

    与 browser_use 在丢弃 --remote-debugging-port 前使用的检测逻辑相同。

    参数：
        host (str): 主机地址
        port (int): 端口号

    返回：
        bool: 如果端口可连接返回 True，否则返回 False
    """
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, int(port))) == 0


def _pick_free_cdp_port(preferred: int, span: int = 40) -> int:
    """
    选择一个空闲的 CDP 端口。

    选择一个不可连接的端口（browser_use 如果 localhost:port 接受连接
    会剥离 --remote-debugging-port）。同时尝试绑定以避免与其他绑定器竞争。

    参数：
        preferred (int): 首选端口号
        span (int): 端口搜索范围，默认为 40

    返回：
        int: 可用的端口号
    """
    import socket
    start = max(1024, int(preferred) or 9242)
    for port in range(start, start + span):
        if _port_is_connectable('127.0.0.1', port) or _port_is_connectable('localhost', port):
            continue
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(('127.0.0.1', port))
            # 释放后再次检查，确保没有其他进程在此期间占用
            if _port_is_connectable('127.0.0.1', port) or _port_is_connectable('localhost', port):
                continue
            return port
        except OSError:
            continue
    return start


async def _wait_cdp_http(port: int, timeout_s: float = 20.0) -> bool:
    """
    轮询 Chrome /json/version 端点，等待 CDP HTTP 就绪。

    参数：
        port (int): CDP 端口号
        timeout_s (float): 超时时间（秒），默认为 20.0

    返回：
        bool: 如果 CDP HTTP 在超时前就绪返回 True，否则返回 False
    """
    import urllib.request

    url = f'http://127.0.0.1:{int(port)}/json/version'
    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.5) as resp:
                if getattr(resp, 'status', 200) == 200:
                    return True
        except Exception:
            pass
        await asyncio.sleep(0.4)
    sys.stderr.write(f'WARN: CDP HTTP not ready on port {port} after {timeout_s}s\n')
    sys.stderr.flush()
    return False


async def _probe_cdp_ws_url(port: int) -> str | None:
    """
    从 /json/version 端点获取 webSocketDebuggerUrl。

    参数：
        port (int): CDP 端口号

    返回：
        str | None: WebSocket URL，如果获取失败返回 None
    """
    import urllib.request
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{int(port)}/json/version', timeout=2) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
            data = json.loads(raw)
            ws = data.get('webSocketDebuggerUrl')
            return str(ws) if ws else None
    except Exception:
        return None


# 保持旧名称以兼容外部导入
async def wait_cdp_http(port: int, timeout_s: float = 20.0) -> bool:
    """
    等待 CDP HTTP 就绪（公共接口）。

    参数：
        port (int): CDP 端口号
        timeout_s (float): 超时时间（秒），默认为 20.0

    返回：
        bool: 如果 CDP HTTP 在超时前就绪返回 True，否则返回 False
    """
    return await _wait_cdp_http(port, timeout_s)
