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
