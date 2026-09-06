"""Click navigation cue (E5) — pure helpers.

`click_element_by_index` can navigate (e.g. 客户转正 → new form page) but returns
only `ok-clicked-N` with no navigation signal. recorder_emitters injects a
`[导航]` HumanMessage cue when the URL changed, so the agent treats the page
transition as "entered target page" instead of hunting the same button.
"""

from __future__ import annotations


def navigation_changed(url_before: str, url_after: str) -> bool:
    b = (url_before or '').strip()
    a = (url_after or '').strip()
    return bool(b and a and b != a)


def navigation_cue_message(from_url: str, to_url: str) -> str:
    return (
        '[导航] 点击后页面已跳转（URL 变化）→ ' + (to_url or '') + '。'
        '若这就是任务目标页（如转正表单），请立即停止寻找/重复点击同一按钮，'
        '直接在该页执行后续动作（fill_form_field / select_option / '
        'run_form_assistant / click_save 等），并按阶段合约处理 done。'
    )


def goal_loop_nav_hint_message() -> str:
    return (
        '[导航] 你已在同一目标上循环多次。请先核实是否已发生页面跳转（URL 是否变化）：'
        '若已进入任务目标页，应立即停止寻找/点击同一按钮，直接执行该页的填写/保存动作；'
        '若确实未进目标页，再改用定位/滚动等新策略，禁止原样重复。'
    )
