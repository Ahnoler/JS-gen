"""Characterization: phase 去重 identity 的容器作用域（#909 定谳缺陷的 RED→GREEN pin）。

缺陷史（#903/#904/#909 三连）：fill/select 等 phase 去重 gate 的 identity 纯按
label 归一化（去空白+小写），无容器作用域——同阶段先在分类弹窗 fill(序号) 成功，
再开产品弹窗 fill(序号) 被 already-operated-this-phase 短路（且返回 ok 文案），
agent 误以为已填，退而 real_click 三连。#909 定谳：引擎缺陷，修复=identity 加
`@<container>` 作用域（_active_container 现成载体，缺省 main 与旧数据兼容）。

本 pin 双层：
1. 行为断言（修前 RED/修后 GREEN）：跨容器同 label 必须不互相短路；
   同容器同 label 仍拦截（原防御不回退）；无容器上下文（旧数据）行为不变。
2. needle 断言：六个 gate 点（fill_form_field/select_option/click_adjacent_button/
   click_radio/select_tree_option/set_vue_model）必须走 scoped identity，
   `_form.py` 不得残留纯 label 版 gate。
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.element_guard import (  # noqa: E402
    duplicate_element_action,
    duplicate_element_action_scoped,
    element_scope_key,
    remember_successful_element_action,
    remember_successful_element_action_scoped,
)

class Result:
    def __init__(self, content: str, success=None):
        self.extracted_content = content
        self.success = success


def main() -> None:
    src_guard = (ROOT / 'scripts/controller/actions/phase/element_guard.py').read_text(encoding='utf-8')
    src_form = (ROOT / 'scripts/controller/actions/_form.py').read_text(encoding='utf-8')

    # ── 1. 行为断言：scoped identity 语义 ────────────────────────────────────
    # 1a 作用域键：label 归一化 + @container（缺省 main）
    assert element_scope_key(' 序 号 ', None) == '序号@main', element_scope_key(' 序 号 ', None)
    assert element_scope_key('序号', {'_active_container': 'dialog:新增产品|产品'}) == '序号@dialog:新增产品|产品'
    assert element_scope_key('序号', {'_active_container': ''}) == '序号@main'
    assert element_scope_key('', {'_active_container': 'dialog:x'}) == '@dialog:x'
    print('PASS 1a element_scope_key: 归一化 label + @container（缺省 main）')

    # 1b 跨容器同 label 不互相短路（#909 根因场景）
    store = {}
    remember_successful_element_action_scoped(
        store, '序号', 'fill_form_field', Result('ok:changed'),
        container='dialog:新增一级分类|产品',
    )
    dup = duplicate_element_action_scoped(store, '序号', container='dialog:新增产品|产品')
    assert dup == '', f'跨容器同 label 被误短路: {dup!r}'
    print('PASS 1b 跨容器（分类弹窗→产品弹窗）同 label「序号」不互相短路')

    # 1c 同容器同 label 仍拦截（原防御保持）
    dup_same = duplicate_element_action_scoped(store, ' 序 号 ', container='dialog:新增一级分类|产品')
    assert dup_same == 'fill_form_field', dup_same
    print('PASS 1c 同容器同 label（含空白差异）仍拦截')

    # 1d 无容器实参 → 缺省 main，与旧纯 label 行为一致（向后兼容）
    store2 = {}
    remember_successful_element_action_scoped(store2, '序号', 'fill_form_field', Result('ok:changed'))
    assert duplicate_element_action_scoped(store2, '序号') == 'fill_form_field'
    # 旧 remember（无容器）写入的键在 scoped 读（缺省 main）下可见
    store3 = {}
    remember_successful_element_action(store3, '审批状态', 'select_option', Result('ok:通过'))
    assert duplicate_element_action_scoped(store3, '审批状态') == 'select_option'
    print('PASS 1d 无容器上下文=main 作用域，旧数据/旧调用兼容')

    # 1e 失败/非 ok 结果不登记（remember 语义保持）
    store4 = {}
    remember_successful_element_action_scoped(
        store4, '序号', 'fill_form_field', Result('err-pending-fields', False),
        container='dialog:新增产品|产品',
    )
    assert duplicate_element_action_scoped(store4, '序号', container='dialog:新增产品|产品') == ''
    ok_skip = remember_successful_element_action_scoped(
        store4, '序号', 'fill_form_field', Result('ok-skip:already-filled'),
        container='dialog:新增产品|产品',
    )
    assert ok_skip is None and duplicate_element_action_scoped(store4, '序号', container='dialog:新增产品|产品') == ''
    print('PASS 1e 失败与 ok-skip 不登记（remember 语义保持）')

    # 1f 容器缺省进 store 形态：container=None 时读 _active_container
    store5 = {'_active_container': 'dialog:新增产品|产品'}
    remember_successful_element_action_scoped(
        store5, '序号', 'fill_form_field', Result('ok:changed'),
    )
    assert duplicate_element_action_scoped(store5, '序号', container='dialog:新增产品|产品') == 'fill_form_field'
    assert duplicate_element_action_scoped(store5, '序号', container='dialog:新增一级分类|产品') == ''
    print('PASS 1f store._active_container 缺省生效，跨容器仍隔离')

    # ── 2. 旧实现（纯 label）必须仍暴露且语义未动（兼容/回归保护） ────────────
    store6 = {}
    remember_successful_element_action(store6, '序号', 'fill_form_field', Result('ok:changed'))
    assert duplicate_element_action(store6, '序号') == 'fill_form_field'
    assert 'def _element_key(label_text: str) -> str:' in src_guard, '旧 _element_key 签名被改'
    print('PASS 2 旧纯 label 接口保持原语义（不回退删除）')

    # ── 3. needle：_form.py 六 gate 点走 scoped ─────────────────────────────
    src_form = (ROOT / 'scripts/controller/actions/_form.py').read_text(encoding='utf-8')
    n_scoped = src_form.count('duplicate_element_action_scoped(')
    n_remember_scoped = src_form.count('remember_successful_element_action_scoped(')
    # 5 个动作有 gate+remember（fill_form_field/select_option/click_radio/
    # select_tree_option/set_vue_model）；click_adjacent_button 无 phase gate
    # （fill_engine 内部 already-filled 语义自管，不在 _form.py）。
    assert n_scoped == 5, f'_form.py scoped gate 数={n_scoped}，应为 5'
    assert n_remember_scoped == 5, f'_form.py scoped remember 数={n_remember_scoped}，应为 5'
    # 旧纯 label 版在 _form.py 不再出现（防回退杂交）
    assert 'duplicate_element_action(business_data_store, label_text)' not in src_form, \
        '_form.py 残留纯 label 版 gate（杂交回退）'
    assert 'remember_successful_element_action(business_data_store, label_text,' not in src_form, \
        '_form.py 残留纯 label 版 remember（杂交回退）'
    print('PASS 3 _form.py 六 gate 点全部 scoped（无杂交回退）')

    # ── 4. gate 拒绝文案保持（agent 依赖文案语义） ───────────────────────────
    assert 'already-operated-this-phase:{label_text} via {duplicate}' in src_form
    print('PASS 4 already-operated-this-phase 拒绝文案保持')

    print('characterize-element-dedup-scope: OK')


if __name__ == '__main__':
    main()
