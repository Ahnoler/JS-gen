"""Click-time locator snapshot tail: parse + apply (shared leaf module).

JS 点击链成功分支在点击当场对被点节点 buildLocatorSnap，以 U+241F 尾段携带
JSON 随 result 返回（首段 ok / ok-text / ok-more-toggle / ok-container /
ok / ok-expanded / ok|scope= 判定不变）。本模块负责在 Python 侧解析该尾段，
并用快照逐键覆盖落库 element 的定位键——点击前 _enrich_click_element 的
文本匹配结果降级为 fallback（快照缺键时保留 enrich 值）。

根因（more-btn 伪造，icons.py 修复复刻）：落库 xpath 来自点击前的 enrich
（includes 文本匹配取最后命中），实际被点节点由 JS 分支决定，两链无一致性
校验——落库 xpath 可指向从未被点击的节点（jsgen-forensic-fake）。

Leaf module: 只准 import stdlib + ._helpers（供 click_action_engine /
_navigation / _misc / _table 等无环复用）。
"""

import json

from ._helpers import _element_info_from_locate

# U+241F（symbol for unit separator）——JS_CLICK_ICON_BUTTON /
# _JS_CLICK_BUTTON_IN_CONTAINER 及同族点击链成功尾段的 locator 快照分隔符。
LOCATOR_TAIL_SEP = '␟'


def click_locator_tail(result: str):
    """Parse the click-time locator snapshot tail from a click result string.

    JS_CLICK_ICON_BUTTON / _JS_CLICK_BUTTON_IN_CONTAINER / switch_tab /
    click_menu_item / close_dialog / click_table_row_button /
    click_table_row_radio 成功分支追加 ``'␟' + JSON.stringify(buildLocatorSnap(...))``
    到 result 尾段；head 段保持与既有 startswith 判定字节兼容。无尾段或尾段
    不是带 xpath 的 locator dict 时返回 None。
    """
    if not isinstance(result, str):
        return None
    if LOCATOR_TAIL_SEP not in result:
        return None
    tail = result.split(LOCATOR_TAIL_SEP, 1)[1]
    try:
        locator = json.loads(tail)
    except (TypeError, ValueError):
        return None
    if not isinstance(locator, dict):
        return None
    if not (locator.get('xpath') or locator.get('xpath_smart')
            or locator.get('xpath_full')):
        return None
    return locator


def split_locator_tail(result: str):
    """Split a click result into ``(head, locator_or_None)``.

    head = 第一个分隔符之前的段落（无尾段时即原串；非 str 输入返回 ''）；
    locator = click_locator_tail 的解析结果（无尾段/解析失败为 None）。
    需要在 head 上继续做既有后缀解析（如 '|scope=' / ' | loc:' 拼接）的
    调用方一律先经此处 strip，避免 JSON 尾段中的 ``|`` 污染后续 split。
    """
    if not isinstance(result, str):
        return '', None
    if LOCATOR_TAIL_SEP not in result:
        return result, None
    head = result.split(LOCATOR_TAIL_SEP, 1)[0]
    return head, click_locator_tail(result)


def apply_click_locator_snapshot(result: str, element: dict | None) -> dict | None:
    """Override the recorded element with the click-time locator snapshot.

    成功结果的 ␟ 尾段是点击当场对被点节点 buildLocatorSnap 的快照；解析成功
    后用 _element_info_from_locate 归一并逐键覆盖 element 的定位键，快照缺键
    时保留 enrich 值（fallback）。无尾段/解析失败 → 返回 None，调用方维持旧行为。
    """
    locator = click_locator_tail(result)
    if locator is None:
        return None
    if not isinstance(element, dict):
        element = {}
    snapped = _element_info_from_locate(locator, target_kind='')
    # icon_class 直连（A 修）：_element_info_from_locate 不映射该键，且
    # more-btn 的信号类在宿主链/子 <i> 上、buildLocatorSnap 的 extractElIconClass
    # 常取不到——快照显式带的 icon_class（icons.py more-toggle 分支注入）直写
    # element，回放侧 replay_click._JS_CLICK_DURABLE 消费 el.icon_class。
    snap_icon = str(locator.get('icon_class') or '').strip()
    # 快照缺键（None/''/{}）逐键回退 enrich 值；定位键有值则覆盖。
    merged = dict(element)
    for key, value in snapped.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        merged[key] = value
    if snap_icon:
        merged['icon_class'] = snap_icon
    # attrs/candidates 等 JS 侧可能为空容器的键：空容器不覆盖 enrich 产物。
    if isinstance(merged.get('attributes'), dict) and not merged.get('attributes') \
            and isinstance(element.get('attributes'), dict) and element.get('attributes'):
        merged['attributes'] = element['attributes']
    if isinstance(merged.get('candidates'), list) and not merged.get('candidates') \
            and isinstance(element.get('candidates'), list) and element.get('candidates'):
        merged['candidates'] = element['candidates']
    if not str(merged.get('text') or '').strip():
        merged['text'] = str(element.get('text') or '')
    return merged
