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


def mark_stc_flags_on_replay_ok(
    action_name: str,
    params: dict,
    entry: dict | None,
    store: dict | None,
) -> None:
    """Replay-side STC marking so the guard hint stays truthful.

    Deterministic replay (`replay_actions`) bypasses the record-mode engines
    (`FillEngine.fill_form_field_for_replay` uses a throwaway store;
    `ClickEngine.click_button_for_replay` has no store), so the STC flags on
    the shared business_data_store were never set. The guard then falsely
    blocked post-query row/tree clicks with err-search-first. Call this after
    a successful replay step to keep the same marking as record mode:

    - fill_form_field hits a search-like label/placeholder → search_filled
    - click_button / click_element_by_index / click_adjacent_button on
      「查询」 → query_clicked
    """
    if store is None or not isinstance(params, dict):
        return
    el = (
        entry.get('element')
        if isinstance(entry, dict) and isinstance(entry.get('element'), dict)
        else {}
    )
    if action_name == 'fill_form_field':
        attrs = el.get('attributes') if isinstance(el, dict) else {}
        attrs = attrs if isinstance(attrs, dict) else {}
        candidates = (
            str(params.get('label_text') or ''),
            str(params.get('placeholder') or ''),
            str(el.get('placeholder') or '') if isinstance(el, dict) else '',
            str(attrs.get('placeholder') or ''),
        )
        for cand in candidates:
            if is_search_field_label(cand):
                mark_search_filled(store)
                return
        return
    if action_name in (
        'click_button',
        'click_element_by_index',
        'click_adjacent_button',
    ):
        text = str(
            params.get('button_text')
            or params.get('text')
            or params.get('label_text')
            or (el.get('text') if isinstance(el, dict) else '')
            or ''
        )
        if re.sub(r'\s+', '', text) == '查询':
            mark_query_clicked(store)

_JS_DETECT_SEARCH_UI = '''() => {
  const inputs = [...document.querySelectorAll('input')].filter(el => {
    if (!el.offsetParent && getComputedStyle(el).visibility === 'hidden') return false;
    const ph = el.placeholder || '';
    const lab = (el.closest('.el-form-item')||{}).querySelector?.('label')?.textContent || '';
    return /关键字|过滤|搜索/.test(ph + lab);
  });
  const btns = [...document.querySelectorAll('button, .el-button, a')].filter(el => {
    const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g,'');
    return t === '查询' && el.offsetParent !== null;
  });
  return { has_search_input: inputs.length > 0, has_query_button: btns.length > 0 };
}'''

_JS_XPATH_IS_TREE_NODE = '''(xpath) => {
  let node = null;
  if (xpath) {
    try {
      node = document.evaluate(
        xpath, document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null
      ).singleNodeValue;
    } catch (e) {}
  }
  if (!node || node.nodeType !== 1) return false;
  return !!(node.closest && node.closest('.el-tree-node'));
}'''

async def detect_search_ui(page) -> SearchUiSnapshot:
    """Snapshot visible search inputs and 查询 buttons on the current page."""
    raw = await page.evaluate(_JS_DETECT_SEARCH_UI)
    if not isinstance(raw, dict):
        return SearchUiSnapshot(has_search_input=False, has_query_button=False)
    return SearchUiSnapshot(
        has_search_input=bool(raw.get('has_search_input')),
        has_query_button=bool(raw.get('has_query_button')),
    )

async def xpath_is_tree_node(page, xpath: str) -> bool:
    """True when xpath resolves to an element inside `.el-tree-node`."""
    if not (xpath or '').strip():
        return False
    return bool(await page.evaluate(_JS_XPATH_IS_TREE_NODE, xpath))

async def guard_locate_or_err(page, store) -> str | None:
    """Return err-search-first message when locate must wait for search/query."""
    snap = await detect_search_ui(page)
    filled = bool((store or {}).get(STC_SEARCH_FILLED))
    clicked = bool((store or {}).get(STC_QUERY_CLICKED))
    block, why = should_block_locate(
        snapshot=snap,
        search_filled=filled,
        query_clicked=clicked,
    )
    if not block:
        return None
    return build_err_search_first(why)
