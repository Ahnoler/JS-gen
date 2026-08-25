#!/usr/bin/env python3
"""Characterization: budget-extend continuation (compute_budget_extension, _done_fired, gate).

Pure-function / control-flow characterization for the budget-exhausted continuation
feature. Builds up across Tasks 5-7 of the week sprint.
"""
import sys, os
_SCRIPTS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ROOT = os.path.dirname(_SCRIPTS_DIR)
sys.path.insert(0, _ROOT)
sys.path.insert(0, _SCRIPTS_DIR)
from pathlib import Path
from controller.actions.phase.reviewer import compute_budget_extension

failures = []
def check(label, cond):
    if not cond: failures.append(label)

# 引入 2 + pending 3 + tree 1 → 2*4+3*2+1+2 = 17
check('basic', compute_budget_extension({
    'introduce_fields': 2, 'pending_fields': 3, 'tree_select_fields': 1,
    'ceiling': 100, 'used_steps': 10,
}) == 17)

# clamp 到 ceiling - used
check('clamp', compute_budget_extension({
    'introduce_fields': 10, 'pending_fields': 10, 'tree_select_fields': 5,
    'ceiling': 30, 'used_steps': 25,
}) == 5)  # raw=10*4+10*2+5+2=67, clamp to 30-25=5

# 全空 → ≤0 不续跑（无引入/无 pending/无 tree → 不加 +2 收尾，直接返回 0）
check('empty', compute_budget_extension({
    'introduce_fields': 0, 'pending_fields': 0, 'tree_select_fields': 0,
    'ceiling': 30, 'used_steps': 10,
}) == 0)

# 预算用尽 → ≤0
check('exhausted', compute_budget_extension({
    'introduce_fields': 5, 'pending_fields': 5, 'tree_select_fields': 0,
    'ceiling': 30, 'used_steps': 30,
}) <= 0)

if failures:
    print('FAIL:', failures); sys.exit(1)
print('OK: compute_budget_extension')


# ── Task 6: done callback _done_fired flag ────────────────────────────────
from agent_utils import make_done_callback

# done callback 设置 _done_fired flag
business_data = {}
cb = make_done_callback(Path('/tmp/test_done.json'), business_data)
# 模拟 done 回调（history_list 有 is_done 方法）
class FakeHistory:
    def __init__(self): self.history = []
    def is_done(self): return True
    def is_successful(self): return True
    def final_result(self): return 'ok'
    def errors(self): return []
    def save_to_file(self, p): pass
cb(FakeHistory())
check('done_fired set', business_data.get('_done_fired') == True)

# 未传入 business_data_store 时不报错（向后兼容）
cb2 = make_done_callback(Path('/tmp/test_done2.json'))
cb2(FakeHistory())  # 不应抛异常
check('backward compat no crash', True)

if failures:
    print('FAIL:', failures); sys.exit(1)
print('OK: compute_budget_extension + done_fired flag')


# ── Task 7: 续跑闸门（纯函数层）───────────────────────────────────────────
from controller.actions.phase.reviewer import _BUDGET_EXTEND_MAX_ROUNDS

check('max rounds = 2', _BUDGET_EXTEND_MAX_ROUNDS == 2)

# 续跑闸门：轮次限制
# （纯函数层验证；控制流集成在 phase-runtime characterization 覆盖）
check('rounds limit', _BUDGET_EXTEND_MAX_ROUNDS <= 2)

if failures:
    print('FAIL:', failures); sys.exit(1)
print('OK: compute_budget_extension + done_fired flag + budget gate')
