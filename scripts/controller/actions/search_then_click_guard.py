from __future__ import annotations
from dataclasses import dataclass
import re

STC_SEARCH_FILLED = "_stc_search_filled"
STC_QUERY_CLICKED = "_stc_query_clicked"
_SEARCH_LABEL_RE = re.compile(r"关键字|过滤|搜索")

@dataclass(frozen=True)
class SearchUiSnapshot:
    has_search_input: bool
    has_query_button: bool

def is_search_field_label(label: str) -> bool:
    return bool(_SEARCH_LABEL_RE.search(label or ""))

def build_err_search_first(why: str) -> str:
    return (
        f"err-search-first:{why} | "
        "先填写搜索关键字（有「查询」按钮则再点查询），然后再点击树节点或选中列表行；"
        "禁止盲点。"
    )

def should_block_locate(
    *,
    snapshot: SearchUiSnapshot,
    search_filled: bool,
    query_clicked: bool,
) -> tuple[bool, str]:
    if not snapshot.has_search_input and not snapshot.has_query_button:
        return False, ""
    if snapshot.has_query_button:
        if query_clicked:
            return False, ""
        # Spec A: button present → must click 查询 (fill alone insufficient)
        if not search_filled:
            return True, "need-fill-and-query"
        return True, "need-query-click"
    if search_filled:
        return False, ""
    return True, "need-fill-search"

def mark_search_filled(store: dict | None) -> None:
    if store is not None:
        store[STC_SEARCH_FILLED] = True

def mark_query_clicked(store: dict | None) -> None:
    if store is not None:
        store[STC_QUERY_CLICKED] = True

def clear_stc_flags(store: dict | None) -> None:
    if not store:
        return
    store.pop(STC_SEARCH_FILLED, None)
    store.pop(STC_QUERY_CLICKED, None)
