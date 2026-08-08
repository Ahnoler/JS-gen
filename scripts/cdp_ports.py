"""CDP port probing utilities for the interactive session runner.

Extracted verbatim from scripts/session_runner.py.
"""
import asyncio
import json
import sys


def _port_is_connectable(host: str, port: int) -> bool:
    """Same check browser_use uses before dropping --remote-debugging-port."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex((host, int(port))) == 0


def _pick_free_cdp_port(preferred: int, span: int = 40) -> int:
    """
    Pick a port that is NOT connectable (browser_use will strip
    --remote-debugging-port if localhost:port accepts connections).
    Also try binding so we do not race with another binder.
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
            # Released — double-check nothing answered while we held it
            if _port_is_connectable('127.0.0.1', port) or _port_is_connectable('localhost', port):
                continue
            return port
        except OSError:
            continue
    return start


async def _wait_cdp_http(port: int, timeout_s: float = 20.0) -> bool:
    """Poll Chrome /json/version until CDP HTTP is reachable."""
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
    sys.stderr.write(f'[session] WARN: CDP HTTP not ready on port {port} after {timeout_s}s\n')
    sys.stderr.flush()
    return False


async def _probe_cdp_ws_url(port: int) -> str | None:
    """Return webSocketDebuggerUrl from /json/version if available."""
    import urllib.request
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{int(port)}/json/version', timeout=2) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
            data = json.loads(raw)
            ws = data.get('webSocketDebuggerUrl')
            return str(ws) if ws else None
    except Exception:
        return None


# Keep old name for any external imports
async def wait_cdp_http(port: int, timeout_s: float = 20.0) -> bool:
    return await _wait_cdp_http(port, timeout_s)
