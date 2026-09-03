"""Replay / autofill 等待与点击超时常量。

统一收敛 scripts/controller/actions/* 中散落的 page.wait_for_timeout(...) 与
locator click(timeout=...) 字面量——数值与既有行为完全一致，仅为可维护性
常量命名，任何调用点均不得改其数值语义。
"""

# page.wait_for_timeout(...) 取值（毫秒），来自 actions 目录 52 处调用的 13 种字面量。
WAIT_100_MS = 100
WAIT_120_MS = 120
WAIT_150_MS = 150
WAIT_200_MS = 200
WAIT_300_MS = 300
WAIT_350_MS = 350
WAIT_400_MS = 400
WAIT_450_MS = 450
WAIT_500_MS = 500
WAIT_600_MS = 600
WAIT_700_MS = 700
WAIT_800_MS = 800
WAIT_3000_MS = 3000

# Playwright locator.click(timeout=...) 显式超时（replay_click.py 文本/角色点击）。
CLICK_TIMEOUT_MS = 3000

# ---------------------------------------------------------------------------
# 统一操作预算（borrow-design Z6「预算即信号」）
#
# 单一动作的整体时间预算（单位：秒，int/float）。语义：常规元素操作 3-5s 封顶；
# 导航/提交类白名单放宽；超时语义 = 重观察（先 get_page_state / verify_context
# 再决定换定位或上报），不是继续等待或同参数重试。本表只做声明，消费接线由
# 回放层（_replay.py 等）后续接入；既有 WAIT_* 常量保持原值不变。
# ---------------------------------------------------------------------------

# 默认预算档：常规元素操作（点击、输入、下拉等）5s 封顶。
DEFAULT_ACTION_BUDGET_S = 5

# 白名单放宽档：键为动作名或动作名前缀，值为预算秒数。
ACTION_BUDGET_S = {
    # 导航/页面类
    "go_to_url": 15,
    "click_menu_item": 10,
    "open_tab": 10,
    "switch_tab": 8,
    # 提交/保存类
    "click_save": 15,
    "save_form_snapshot": 10,
    "login": 20,
    "picker_dialog_select": 10,
    "picker_dialog_query": 10,
    # 扫描类（正在接线，先占位）
    "scan_visible_fields": 10,
    "scan_form_fields": 10,
    "semantic_snapshot": 8,
    # KB-I5 run7：tree_picker_click 内嵌 real_click(CDP 真实事件) 回退重试，
    # 两轮 JS 逐级点击 + CDP 通道需放宽；real_click 单发也非毫秒级。
    "tree_picker_click": 20,
    "real_click": 8,
}


def budget_for(action_name):
    """查询单个动作的时间预算（秒）。

    匹配顺序：
    1. 精确匹配 ACTION_BUDGET_S 白名单 → 返回其值；
    2. 前缀匹配白名单键（action_name 以某键开头，最长前缀优先）→ 返回其值；
    3. 均未命中 → 返回 DEFAULT_ACTION_BUDGET_S。

    :param action_name: 动作名（如 ``click_save``、``click_table_row_button``）。
    :returns: 预算秒数（int/float）。
    """
    if action_name in ACTION_BUDGET_S:
        return ACTION_BUDGET_S[action_name]
    best_prefix = None
    for key in ACTION_BUDGET_S:
        if action_name.startswith(key) and (best_prefix is None or len(key) > len(best_prefix)):
            best_prefix = key
    if best_prefix is not None:
        return ACTION_BUDGET_S[best_prefix]
    return DEFAULT_ACTION_BUDGET_S


def budget_overrun_hint(action_name):
    """返回动作超出预算时的一行中文处置提示（超时语义 = 重观察）。

    :param action_name: 动作名。
    :returns: 中文提示串，指引先重观察再决定换定位或上报。
    """
    budget = budget_for(action_name)
    return (
        f"动作 {action_name} 已超预算 {budget}s——按失败处理：先重观察"
        f"（get_page_state / verify_context）再决定换定位或上报，不要继续等待或同参数重试。"
    )
