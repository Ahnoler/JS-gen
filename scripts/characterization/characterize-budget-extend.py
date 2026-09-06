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


# ── Task 8: 进度感知缓冲部署（total_fields/done_fields）──────────────────

# a) 无新键 → legacy 行为字节级保持：2*4+3*2+1+2 = 17
check('无新键 legacy==17', compute_budget_extension({
    'introduce_fields': 2, 'pending_fields': 3, 'tree_select_fields': 1,
    'ceiling': 100, 'used_steps': 10,
}) == 17)

# b) 无新键 empty → 0
check('无新键 empty==0', compute_budget_extension({
    'introduce_fields': 0, 'pending_fields': 0, 'tree_select_fields': 0,
    'ceiling': 100, 'used_steps': 10,
}) == 0)

# c) done==0 回退旧式：1*4+2*2+0+2 = 10
check('done==0 回退旧式==10', compute_budget_extension({
    'introduce_fields': 1, 'pending_fields': 2, 'tree_select_fields': 0,
    'ceiling': 100, 'used_steps': 10,
    'total_fields': 5, 'done_fields': 0,
}) == 10)

# d) 进度加 headroom：avg=12/3=4, remaining=max(5-3,0+2+0)=2, est=ceil(4*2)+2=10, legacy=0*4+2*2+0+2=6 → 10
check('进度加 headroom==10', compute_budget_extension({
    'introduce_fields': 0, 'pending_fields': 2, 'tree_select_fields': 0,
    'ceiling': 100, 'used_steps': 12,
    'total_fields': 5, 'done_fields': 3,
}) == 10)

# e) clamp：raw=1*4+2*2+1+2=11, 进度 avg=15/2=7.5, rem=max(5-2,1+2+1)=4, est=ceil(7.5*4)+2=32 → max(11,32)=32, clamp 20-15=5
check('进度 clamp==5', compute_budget_extension({
    'introduce_fields': 1, 'pending_fields': 2, 'tree_select_fields': 1,
    'ceiling': 20, 'used_steps': 15,
    'total_fields': 5, 'done_fields': 2,
}) == 5)

# f) 不低于 legacy：avg=10/9≈1.11, rem=max(10-9,2+3+1)=1, est=ceil(1.11*1)+2=3, legacy=2*4+3*2+1+2=17 → max(17,3)=17
check('不低于 legacy==17', compute_budget_extension({
    'introduce_fields': 2, 'pending_fields': 3, 'tree_select_fields': 1,
    'ceiling': 100, 'used_steps': 10,
    'total_fields': 10, 'done_fields': 9,
}) == 17)

# g) 空工作短路：introduce=pending=tree=0 → 0（即使有 total/done）
check('空工作短路==0', compute_budget_extension({
    'introduce_fields': 0, 'pending_fields': 0, 'tree_select_fields': 0,
    'ceiling': 100, 'used_steps': 5,
    'total_fields': 5, 'done_fields': 5,
}) == 0)

if failures:
    print('FAIL:', failures); sys.exit(1)
print('OK: 进度感知缓冲部署 (total_fields/done_fields)')
