"""MemoryStore 门面：兼容 case_data_store 读写，并旁路写入外部记忆。"""

from __future__ import annotations

from .writer import emit_memory_event


class MemoryStore:
    """进程内 case_data_store 的薄封装。

    P0：写 = dict + 事件旁路；读 = dict（P1 改为“事实包优先，dict 兜底”）。
    """

    def __init__(self, case_data_store=None):
        self._store = case_data_store if isinstance(case_data_store, dict) else {}

    def save(self, key, value, *, source='agent', phase_number=None, step_number=None):
        self._store[key] = value
        emit_memory_event(
            'case_saved',
            {'key': key, 'value': str(value)[:500]},
            phase_number=phase_number,
            step_number=step_number,
            source=source,
        )
        return value

    def read(self, key, default=None):
        return self._store.get(key, default)

    def get(self, key, default=None):
        return self.read(key, default)

    def to_dict(self):
        return self._store
