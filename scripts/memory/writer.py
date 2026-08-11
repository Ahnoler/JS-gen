"""外部记忆事件写入器（P0：异步批量上报，失败不阻塞 Agent）。

设计：
- 线程 + queue 实现，同步/异步上下文均可调用（emit 只是入队）。
- 攒满 MEMORY_BATCH_SIZE（默认 20）或 MEMORY_FLUSH_INTERVAL_MS（默认 500ms）
  由后台线程 POST 到控制面 /api/v2/memory/events。
- 上报失败写入 tmp/memory_pending/*.jsonl，下次进程运行可重放（P1 实现重放）。
- 由 AI_MEMORY_EVENTS 开关控制（默认开，只写不读）。
"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from scripts.feature_flags import memory_events_enabled

_CONTROL_URL = os.getenv('MEMORY_CONTROL_URL', 'http://127.0.0.1:4097').rstrip('/')
_BATCH_SIZE = max(1, int(os.getenv('MEMORY_BATCH_SIZE', '20')))
_FLUSH_INTERVAL_S = max(0.05, float(os.getenv('MEMORY_FLUSH_INTERVAL_MS', '500')) / 1000.0)
_HTTP_TIMEOUT_S = max(0.2, float(os.getenv('MEMORY_HTTP_TIMEOUT_MS', '1500')) / 1000.0)
_PENDING_DIR = Path(__file__).resolve().parents[2] / 'tmp' / 'memory_pending'

_state = {
    'enabled': True,
    'session_id': None,
    'trajectory_id': None,
    'model': None,
    'source': 'agent',
}
_queue: queue.Queue = queue.Queue(maxsize=2000)
_thread: threading.Thread | None = None
_stop = threading.Event()


def _enabled() -> bool:
    try:
        return bool(_state['enabled']) and memory_events_enabled()
    except Exception:
        return False


def configure(
    session_id=None,
    trajectory_id=None,
    model=None,
    source='agent',
    enabled=None,
    control_url=None,
):
    """配置 writer（通常在 session_runner.run_session 启动时调用）。"""
    global _CONTROL_URL
    if control_url:
        _CONTROL_URL = str(control_url).rstrip('/')
    if session_id is not None:
        _state['session_id'] = str(session_id)
    if trajectory_id is not None:
        _state['trajectory_id'] = trajectory_id
    if model is not None:
        _state['model'] = str(model)
    if source is not None:
        _state['source'] = str(source)
    if enabled is not None:
        _state['enabled'] = bool(enabled)


def start():
    """启动后台批量上报线程（幂等）。"""
    global _thread
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_run_loop, name='memory-writer', daemon=True)
    _thread.start()


def emit_memory_event(
    event_type,
    payload=None,
    *,
    phase_number=None,
    step_number=None,
    source=None,
    model=None,
    decision=None,
    facts=None,
):
    """入队一条记忆事件（非阻塞；开关关闭时直接返回 False）。

    decision 为可选 dict —— 作为 decision_record 落库（P1：LLM 决策留痕）。
    facts 为可选 list[dict] —— 随事件落 memory_fact（P1：action 打点等）。
    """
    if not _enabled():
        return False
    event = {
        'event_type': str(event_type),
        'payload': payload if isinstance(payload, dict) else {},
        'session_id': _state['session_id'],
        'trajectory_id': _state['trajectory_id'],
        'phase_number': phase_number,
        'step_number': step_number,
        'source': source or _state['source'],
        'model': model or _state['model'],
        'occurred_at': datetime.now().isoformat(timespec='milliseconds'),
    }
    if decision is not None:
        event['decision'] = decision
    if isinstance(facts, list) and facts:
        event['facts'] = facts
    try:
        _queue.put_nowait(event)
        return True
    except queue.Full:
        return False


# 线程实现，同步/异步上下文均可直接调用
emit = emit_memory_event
emit_sync = emit_memory_event


def flush(timeout=5.0):
    """等待队列清空（尽力而为）。返回剩余条数。"""
    deadline = time.monotonic() + max(0.1, float(timeout))
    while not _queue.empty() and time.monotonic() < deadline:
        time.sleep(0.05)
    return _queue.qsize()


def shutdown(timeout=5.0):
    """停止后台线程并清空队列（进程退出前调用）。"""
    global _thread
    _stop.set()
    if _thread is not None:
        _thread.join(timeout=max(0.1, float(timeout)))
    _thread = None
    try:
        while not _queue.empty():
            _queue.get_nowait()
    except queue.Empty:
        pass


def _run_loop():
    batch = []
    last_flush = time.monotonic()
    while not _stop.is_set() or not _queue.empty():
        try:
            item = _queue.get(timeout=0.2)
            batch.append(item)
        except queue.Empty:
            pass
        if len(batch) >= _BATCH_SIZE or (
            batch and time.monotonic() - last_flush >= _FLUSH_INTERVAL_S
        ):
            _post_batch(batch)
            batch = []
            last_flush = time.monotonic()
    if batch:
        _post_batch(batch)


def _post_batch(batch):
    if not batch:
        return
    try:
        body = json.dumps({'events': batch}, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request(
            f'{_CONTROL_URL}/api/v2/memory/events',
            data=body,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as resp:
            if resp.status >= 300:
                raise RuntimeError(f'HTTP {resp.status}')
        return
    except Exception as e:
        _write_pending(batch, e)


def _write_pending(batch, err):
    """上报失败 → 本地 JSONL 待重放（P1 实现重放；P0 至少不静默丢）。"""
    try:
        _PENDING_DIR.mkdir(parents=True, exist_ok=True)
        name = f"memory_pending_{_state['session_id'] or 'unknown'}_{int(time.time() * 1000)}.jsonl"
        with open(_PENDING_DIR / name, 'a', encoding='utf-8') as f:
            for ev in batch:
                f.write(json.dumps(ev, ensure_ascii=False) + '\n')
    except Exception:
        pass
    sys.stderr.write(f'[memory_writer] flush failed ({len(batch)} events): {err}\n')
    sys.stderr.flush()
