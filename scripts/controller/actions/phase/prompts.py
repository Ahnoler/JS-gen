"""Phase hint builders + heal-mode detection (extracted from _phase_context).

Prompt fragments appended to the AI preamble per task mode, and heal-mode
(step / form_structure) set/clear helpers. Lazy-imports _phase_intent only.
"""

from __future__ import annotations

from .classify import (
    TaskMode,
    is_open_page_task,
    is_wizard_nav_task,
)

def query_task_hint() -> str:
    """Phase preamble: query/filter — AI-driven, no auto-fill."""
    return (
        '\n\n【任务类型：查询】\n'
        '本阶段是查询/筛选，不是表单填写、也不是表单修改。\n'
        '1. 禁止自动填写：不要等 auto-fill、不要 scan_form_fields / get_pending_tasks 当进度。\n'
        '2. 由你根据任务描述设置筛选条件（fill_form_field / select_option / select_tree_option）。\n'
        '3. 设完后用 click_element_by_index 点击「查询」（或「搜索」），然后 done(success=true)。\n'
        '4. 本页没有「保存/提交」语义；click_save 不适用。\n'
    )


def wizard_nav_task_hint() -> str:
    """Phase preamble: wizard next/prev — set named fields then 下一步."""
    return (
        '\n\n【任务类型：向导/下一步】\n'
        '本阶段是向导页推进，不是列表查询，也不是表单保存。\n'
        '1. 按任务描述设置条件字段（如「客户名称搜索为…」用 fill_form_field / select_option）。\n'
        '   「客户名称」等远程下拉若弹层内是表格行（TsscMultiSelect），必须用 '
        'select_option(label_text, option_text 或 \"第一个\")，'
        '禁止 click_element_by_index 点下拉行（会假成功且录不到可回放步骤）。\n'
        '2. 设完后用 click_element_by_index 点击「下一步」；不要把点「查询」当成阶段结束'
        '（除非任务明确要求先点查询再点下一步）。\n'
        '3. 若弹出确认/风险提示，点「确定/确认」后继续；进入下一步后 done(success=true)。\n'
        '4. 禁止 click_save(保存/提交)；本页无表单保存语义。\n'
    )


def open_page_task_hint() -> str:
    """Phase preamble: open/navigate to a page — done once the target page shows."""
    return (
        '\n\n【任务类型：打开页面/导航】\n'
        '本阶段只是把目标页面/弹窗打开，不办理页面内的业务流程。\n'
        '1. 按任务描述完成前置点击（菜单 / 选中行 / 点「评级申请」类按钮）。\n'
        '2. 目标页面/弹窗出现后，立刻 done(success=true)。\n'
        '3. 🚨 禁止在新页面/弹窗内继续操作：不要填字段、不要点「下一步/查询/确定/保存」'
        '——那是后续阶段的任务。\n'
        '4. 本阶段无表单保存语义，不需要 click_save。\n'
    )


def login_task_hint() -> str:
    return (
        '\n\n【任务类型：登录】\n'
        '本阶段只做登录，不是表单填写。\n'
        '1. 使用 login(username, password, …) 完成登录（必要时填验证码）。\n'
        '2. 登录成功进入系统后立刻 done(success=true)。\n'
        '3. 不要 get_pending_tasks、不要找业务表单、不要把本阶段当成「新增/录入」。\n'
    )


def form_fill_hint() -> str:
    """Phase preamble: blank/new form entry — use run_form_assistant."""
    return (
        '\n\n【任务类型：表单填写】\n'
        '本阶段是新增/录入类填写。\n'
        '1. 对每个可编辑字段须执行写动作（可同值重填），以录制可操作元素；不要仅 check_field_value 跳过。\n'
        '2. 合约 allow_form_assistant=true 时，先调用 run_form_assistant() 批量填写其余待办；'
        '单字段 fill/select 不会触发助手。\n'
        '3. pending≈0 后立刻 click_save()，不要重选已填字段。\n'
        '4. click_save 成功 = 操作成功提示 或 保存后页面跳转。\n'
        '5. 若保存后跳转到同阶段的详情/大表（仍有大量待填字段），继续填写后再保存；'
        '不要把「向导中段跳转」当成阶段结束去 done。\n'
    )


def form_modify_partial_hint() -> str:
    """Phase preamble: modify named fields only — write task-named editable fields."""
    return (
        '\n\n【任务类型：表单修改 — 部分字段】\n'
        '本阶段只修改任务点名的字段，不是全量录入。\n'
        '1. 对任务点名的可编辑字段必须执行写动作（可同值重填）；未点名字段保留原值。\n'
        '2. 禁止调用 run_form_assistant；禁止盲目重选未点名字段。\n'
        '3. 禁止仅 check_field_value / 核对回显就点确认。\n'
        '4. 改完后 click_save(button_text="确认"或"保存")；成功 = 操作成功 或 页面跳转；'
        '保存被校验拦截时按 err-save-validation 信封处方补齐必填后再存。\n'
    )


def force_refill_hint() -> str:
    return (
        '\n\n【任务类型：表单修改 — 全部字段】\n'
        '本阶段要求覆盖表单中所有可编辑字段（含编号类主键，可同值重填）。\n'
        '1. 禁止只 check_field_value / 核对回显就点确认。\n'
        '1a. 合约 allow_form_assistant=true 时，可先 run_form_assistant() 批量覆盖，'
        '再逐字段写入确保录制完整。\n'
        '2. 对每个可编辑字段必须执行覆盖写入：input→fill_form_field，'
        'select→select_option，radio→click_radio（可用 match_form_rule / 业务数据生成新值）。\n'
        '3. 仅 disabled 且无旁边按钮的只读字段可跳过。\n'
        '4. click_save(button_text="确认"或"保存")；成功 = 操作成功 或 页面跳转。\n'
    )


def task_mode_hint(mode: TaskMode, *, force_refill_all: bool = False) -> str:
    if mode == 'login':
        return login_task_hint()
    if mode == 'query':
        return query_task_hint()
    if mode == 'form_modify':
        return force_refill_hint() if force_refill_all else form_modify_partial_hint()
    if mode == 'form_fill':
        return form_fill_hint()
    return ''  # other — no form-type cue


def recording_refill_hint(
    mode: TaskMode,
    *,
    force_refill_all: bool = False,
    task_text: str = '',
) -> str:
    """Hint when phase intent requires all editable fields recorded."""
    if force_refill_all and mode in ('form_fill', 'form_modify'):
        return force_refill_hint() if mode == 'form_modify' else form_fill_hint()
    if mode == 'other':
        if is_wizard_nav_task(task_text):
            return wizard_nav_task_hint()
        if is_open_page_task(task_text):
            return open_page_task_hint()
    return task_mode_hint(mode, force_refill_all=force_refill_all)


def detect_heal_mode(instruction: dict | None, task_text: str = '') -> str | None:
    """Return 'step' | 'form_structure' | None for heal agent runs.

    Detection priority:
      1. structured ``heal_contract`` (mode=='heal') from Node;
      2. legacy ``heal_type`` / ``healType`` fields;
      3. legacy text keywords (kept as fallback).
    The parsed contract is cached on ``instruction['_parsed_heal_contract']`` so
    the caller can pass it to ``apply_heal_mode`` without parsing twice.
    """
    if isinstance(instruction, dict):
        instruction.pop('_parsed_heal_contract', None)
        contract = instruction.get('heal_contract')
        if isinstance(contract, dict) and contract.get('mode') == 'heal':
            scope = str(contract.get('scope') or '').strip().lower()
            instruction['_parsed_heal_contract'] = contract
            return 'form_structure' if scope == 'form_structure' else 'step'
        raw = instruction.get('heal_type') or instruction.get('healType') or ''
        raw = str(raw).strip().lower()
        if raw in ('step', 'form_structure'):
            return raw
        if raw in ('form-structure', 'structure'):
            return 'form_structure'
    t = task_text or ''
    if '表单结构变化自愈' in t or 'healType=form_structure' in t:
        return 'form_structure'
    if '单步自愈' in t or '步骤回放失败后的单步自愈' in t:
        return 'step'
    return None


def apply_heal_mode(
    business_data_store: dict | None,
    heal_mode: str | None,
    heal_contract: dict | None = None,
) -> str | None:
    """Set/clear ``_heal_mode`` and ``_heal_contract``.

    ``_heal_mode`` keeps its legacy string value for recorder/emitter consumers;
    ``_heal_contract`` is an additive structured field for prompt assembly.
    Heal never carries a phase-intent contract: recording phases compile
    ``_phase_intent``; heal clears it and must not re-apply create/modify submit
    or recovery→click_save rules.
    """
    if business_data_store is None:
        return heal_mode
    if heal_mode:
        business_data_store['_heal_mode'] = heal_mode
        if heal_contract is not None:
            business_data_store['_heal_contract'] = heal_contract
        else:
            business_data_store.pop('_heal_contract', None)
        try:
            from .._phase_intent import clear_phase_intent
            clear_phase_intent(business_data_store)
        except Exception:
            business_data_store.pop('_phase_intent', None)
        business_data_store['_force_refill_all'] = False
        business_data_store.pop('_submit_ready', None)
        business_data_store.pop('_success_tokens', None)
    else:
        business_data_store.pop('_heal_mode', None)
        business_data_store.pop('_heal_contract', None)
    return heal_mode


def is_heal_mode(business_data_store: dict | None) -> bool:
    return bool(business_data_store and business_data_store.get('_heal_mode'))

