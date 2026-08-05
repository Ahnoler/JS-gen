"""AI 记忆系统 Python 客户端（P0：事件旁路摄取 + MemoryStore 门面 + Fact Pack 解析）。"""

from .writer import (
    configure,
    start,
    flush,
    shutdown,
    emit_memory_event,
)
from .store import MemoryStore

__all__ = [
    'configure',
    'start',
    'flush',
    'shutdown',
    'emit_memory_event',
    'MemoryStore',
]
