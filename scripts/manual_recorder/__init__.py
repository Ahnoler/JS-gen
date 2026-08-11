"""
Manual (human) DOM recorder — injects a page listener that captures user
interactions and maps them to controller ActionEntry (source=manual).

Flow:
  Dashboard 「开始人工录制」
    → Node POST /manual-record {enabled:true}
    → Python event manual_record_start
    → inject JS + page.on('console')
    → user clicks/fills in Chrome
    → console `__JSGEN_MANUAL__{...}`
    → map to ActionEntry → _ACTION_LOG → emit manual_action_recorded
    → Node appendRecordedStep(source=manual)

TODO (以后做 — 人工 click 的真实 highlight index):
  当前 click_element_by_index 的 params.index 固定为 -1，定位靠点击瞬间 xpath/text。
  原因：click 事件到达 Python 时页面往往已跳转，事后 get_state / selector_map 会偏。

  可行方案（预刷缓存 + mousedown 内存匹配）:
  1. Agent 空闲 / 人工录制开启时，周期性或按需 browser_context.get_state()，
     缓存当次 selector_map（xpath / attrs / text → index）。
  2. 页面侧改用 mousedown capture 上报（早于导航），用 bu_xpath 等与缓存做
     内存匹配得到 index，不再在 Python 侧事后 get_state。
  3. 未命中缓存时仍回退 index=-1 + xpath/text。
"""
from __future__ import annotations

from .js import JS_MANUAL_RECORDER
from .recorder import ManualRecorder, asyncio_create_task
from .mapper import (
    _build_xpath_smart,
    _map_dom_event_to_action,
    _xpath_literal,
)

__all__ = [
    "JS_MANUAL_RECORDER",
    "ManualRecorder",
    "asyncio_create_task",
    "_build_xpath_smart",
    "_map_dom_event_to_action",
    "_xpath_literal",
]
