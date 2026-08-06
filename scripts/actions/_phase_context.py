"""Cross-phase business-scenario preamble for AI long-term context.

Feature flags: see ``scripts.feature_flags`` (re-exported here for callers).

Task modes:
  - login       — sign-in only; use login(); no form-fill cues
  - query       — filter/search; AI sets conditions; NO auto-fill; click 查询
  - form_fill   — new/entry form (explicit 新增/录入…); implicit auto-fill; click_save
  - form_modify — edit existing; all-fields OR partial per task text; click_save
  - other       — navigate / delete / misc; no form-fill auto-fill or form-type hint

``form_fill`` is NOT the default — only when entry keywords match. Login must not
be classified as form_fill (that caused agents to hunt for business forms).
"""

from __future__ import annotations

import re
from typing import Any, Literal

from scripts.feature_flags import (  # noqa: F401 — re-export
    memory_whitelist_enabled,
    phase_preamble_enabled,
)


_OUTCOME_TEXT_MAX = 400
_PRIOR_DESC_MAX = 200
_PREAMBLE_TOTAL_MAX = 1200

TaskMode = Literal['login', 'query', 'form_fill', 'form_modify', 'other']

# Task text that requires overwriting every editable field (modify-dialog refill).
_FORCE_REFILL_RE = re.compile(
    r'修改表单中所有字段|修改所有字段|改所有字段|全部字段.*修改|修改.*全部字段'
)

# Query/filter-only phases — no 保存/提交; agent must click 查询, not click_save.
_QUERY_TASK_RE = re.compile(r'查询|搜索|查找')
_QUERY_EXCLUDE_RE = re.compile(
    r'新增|创建|编辑|修改|保存|提交|删除|录入|校验|导入'
)
# Wizard / multi-step pages often say「客户名称搜索为…，点击下一步」— that is NOT
# list-filter query (must not force「点查询 → done」).
_WIZARD_NAV_RE = re.compile(r'下一步|上一步|进入下一步|点击下一步')
# Open-page / navigate phases:「点击评级申请。预期结果：打开评级申请相关页面」—
# done once the target page/dialog appears; do NOT continue the flow inside it.
_OPEN_PAGE_EXPECT_RE = re.compile(
    r'预期结果[:：]?[^。；\n]{0,12}(?:打开|进入|抵达|到达)[^。；\n]{0,20}(?:页面|界面|弹窗|对话框)'
)
# Save-to-open phases (点击保存。预期结果：保存成功并进入列表页) keep prompt rule 3
# (click_save → ok-save-navigation → done) — NOT open-page navigation.
_OPEN_PAGE_EXCLUDE_RE = re.compile(r'保存|提交')

# Suffixes appended for AI fill context — must NOT affect task-mode / boundary classify.
_BUSINESS_DATA_MARK_RE = re.compile(
    r'\n*【(?:业务数据|业务场景案例数据|预设案例数据)[^\n]*】[\s\S]*$',
)

# Form modify (edit existing values) — distinct from blank form_fill.
_MODIFY_TASK_RE = re.compile(r'修改|编辑|更新|变更|改填|维护')

# Explicit new/entry form fill — required for form_fill (not a catch-all default).
_FILL_TASK_RE = re.compile(r'新增|创建|录入|填写|新建|添加|校验|开立')

# Pure login phase (navigate to login / enter credentials).
_LOGIN_TASK_RE = re.compile(r'登录|登入|/login|#/login', re.IGNORECASE)
_LOGIN_EXCLUDE_RE = re.compile(
    r'新增|创建|录入|填写|修改|编辑|查询|搜索|删除|保存|提交|校验'
)


def force_refill_all_required(task_text: str) -> bool:
    """True when the phase task requires overwriting all editable form fields."""
    return bool(_FORCE_REFILL_RE.search(task_text or ''))


def strip_business_data_block(task_text: str) -> str:
    """Remove trailing 【业务数据】/ legacy case-data blocks from phase text.

    Those blocks are fill *values*, not phase goals. Keeping them in classify
    text caused navigate phases to become form_fill (boilerplate contains「填写」)
    or introduce (key data contains「引入」).
    """
    t = str(task_text or '')
    t = _BUSINESS_DATA_MARK_RE.sub('', t)
    return t.strip()


def classification_task_text(task_text: str) -> str:
    """Phase text used for task_mode / boundary / intent — no business-data suffix."""
    return strip_business_data_block(task_text)


def needs_business_data_context(
    task_text: str,
    case_data_store: dict | None = None,
) -> bool:
    """Whether to show 【业务数据】to the model for this phase.

    Only fill / modify / introduce (incl. introduce-then-save). Not login,
    pure open-page navigate, or list query.
    """
    t = classification_task_text(task_text)
    if not t:
        return False
    if case_data_store:
        contract = case_data_store.get('_phase_intent') or {}
        mode = contract.get('mode')
        if mode in ('navigate', 'login', 'query'):
            return False
        if mode in ('create', 'modify', 'introduce_pick'):
            return True
        boundary = case_data_store.get('_phase_boundary') or {}
        if boundary.get('role') == 'navigate':
            return False
        if boundary.get('role') in ('maintain', 'introduce'):
            return True
    mode = classify_task_mode(t)
    if mode in ('form_fill', 'form_modify'):
        return True
    if case_data_store:
        boundary = case_data_store.get('_phase_boundary') or {}
        if boundary.get('role') == 'introduce' or boundary.get('requires_introduce_then_save'):
            return True
        contract = case_data_store.get('_phase_intent') or {}
        if contract.get('mode') == 'introduce_pick':
            return True
    if mode in ('login', 'query'):
        return False
    # Pure open-page / menu navigate — no value hints
    if mode == 'other' and is_open_page_task(t):
        return False
    # Introduce-only goals often classify as other
    if re.search(r'引入|选人|客户选择|选择客户|选择.*客户', t):
        return True
    return False


def is_wizard_nav_task(task_text: str) -> bool:
    """True when the phase advances a wizard (下一步/上一步), not list query."""
    return bool(_WIZARD_NAV_RE.search(classification_task_text(task_text)))


def is_open_page_task(task_text: str) -> bool:
    """True when the expected result is just opening/entering a page or dialog.

    e.g.「选中客户名称…，点击评级申请。预期结果：打开评级申请相关页面。」— the phase
    ends when the target page/dialog shows; the agent must not run the flow inside.
    Save-to-open texts (…点击保存。预期结果：…进入列表页面) are excluded — they keep
    the click_save → ok-save-navigation → done rule.
    """
    t = classification_task_text(task_text)
    if _OPEN_PAGE_EXCLUDE_RE.search(t):
        return False
    return bool(_OPEN_PAGE_EXPECT_RE.search(t))


def is_query_task(task_text: str) -> bool:
    """True when the phase is a search/filter task (no form-save semantics).

    Matches「查询产品信息」etc. Excludes mixed CRUD tasks that also mention 查询
    (e.g. 查询后新增 / 修改并保存) — those still use form-save when a dialog opens.
    Also excludes wizard copy like「客户名称搜索为…，点击下一步」(set field + next).
    Main-page query toolbars are additionally detected via DOM (有查询无保存).
    """
    t = classification_task_text(task_text)
    if not _QUERY_TASK_RE.search(t):
        return False
    if _QUERY_EXCLUDE_RE.search(t):
        return False
    if is_wizard_nav_task(t):
        return False
    return True


def is_login_task(task_text: str) -> bool:
    """True when the phase is only sign-in (not login-then-fill in one blob)."""
    t = classification_task_text(task_text)
    if not t or not _LOGIN_TASK_RE.search(t):
        return False
    if _LOGIN_EXCLUDE_RE.search(t):
        return False
    return True


def is_modify_task(task_text: str) -> bool:
    """True when the phase is editing an existing form (not blank entry, not query)."""
    t = classification_task_text(task_text)
    if not t or is_query_task(t) or is_login_task(t):
        return False
    if force_refill_all_required(t):
        return True
    return bool(_MODIFY_TASK_RE.search(t))


def is_fill_task(task_text: str) -> bool:
    """True when the phase is explicit new/entry form filling."""
    t = classification_task_text(task_text)
    if not t or is_query_task(t) or is_login_task(t) or is_modify_task(t):
        return False
    return bool(_FILL_TASK_RE.search(t))


def classify_task_mode(task_text: str) -> TaskMode:
    """Classify phase intent. ``form_fill`` only when entry keywords match — never default.

    Classification ignores trailing 【业务数据】blocks (value hints, not goals).
    """
    t = classification_task_text(task_text)
    if is_login_task(t):
        return 'login'
    if is_query_task(t):
        return 'query'
    if is_open_page_task(t):
        return 'other'
    if is_modify_task(t):
        return 'form_modify'
    if is_fill_task(t):
        return 'form_fill'
    return 'other'


def apply_task_mode(case_data_store: dict | None, task_text: str) -> TaskMode:
    """Write ``_task_mode`` / compat flags into case_data_store. Returns mode."""
    mode = classify_task_mode(task_text)
    if case_data_store is None:
        return mode
    case_data_store['_task_mode'] = mode
    case_data_store['_query_task'] = mode == 'query'
    # Legacy default; PhaseIntentContract may override via apply_phase_intent().
    case_data_store['_force_refill_all'] = (
        mode == 'form_fill'
        or (mode == 'form_modify' and force_refill_all_required(task_text))
    )
    case_data_store.pop('_query_ui', None)
    case_data_store.pop('_query_ready', None)
    case_data_store.pop('_submit_ready', None)
    if mode in ('query', 'login', 'other'):
        case_data_store.pop('task_list', None)
        case_data_store.pop('_scan_fields', None)
        case_data_store.pop('_autofill_summary', None)
    return mode


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
    """Phase preamble: blank/new form entry — use auto-fill."""
    return (
        '\n\n【任务类型：表单填写】\n'
        '本阶段是新增/录入类填写。\n'
        '1. 对每个可编辑字段须执行写动作（可同值重填），以录制可操作元素；不要仅 check_field_value 跳过。\n'
        '2. 第一次 fill_form_field / select_option 会触发自动填写助手覆盖其余待办。\n'
        '3. pending≈0 后立刻 click_save()，不要重选已填字段。\n'
        '4. click_save 成功 = 操作成功提示 或 保存后页面跳转。\n'
        '5. 若保存后跳转到同阶段的详情/大表（仍有大量待填字段），继续填写后再保存；'
        '不要把「向导中段跳转」当成阶段结束去 done。\n'
    )


def form_modify_partial_hint() -> str:
    """Phase preamble: edit — recording still touches all editable fields when contract says so."""
    return (
        '\n\n【任务类型：表单修改】\n'
        '本阶段是修改已有表单，不是查询。\n'
        '1. 录制须对每个可编辑字段执行写动作（可同值重填），以采集可操作元素。\n'
        '2. 禁止仅 check_field_value / 核对回显就点确认。\n'
        '3. 改完后 click_save(button_text="确认"或"保存")；成功 = 操作成功 或 页面跳转。\n'
    )


def force_refill_hint() -> str:
    return (
        '\n\n【任务类型：表单修改 — 全部字段】\n'
        '本阶段要求覆盖表单中所有可编辑字段（含编号类主键，可同值重填）。\n'
        '1. 禁止只 check_field_value / 核对回显就点确认。\n'
        '2. 对每个可编辑字段必须执行覆盖写入：input→fill_form_field，'
        'select→select_option，radio→click_radio（可用 match_form_rule / 案例数据生成新值）。\n'
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
    """Return 'step' | 'form_structure' | None for heal agent runs."""
    if isinstance(instruction, dict):
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


def apply_heal_mode(case_data_store: dict | None, heal_mode: str | None) -> str | None:
    """Set/clear ``_heal_mode``. Heal never carries a phase-intent contract.

    Recording phases compile ``_phase_intent``; heal clears it and must not
    re-apply create/modify submit or recovery→click_save rules.
    """
    if case_data_store is None:
        return heal_mode
    if heal_mode:
        case_data_store['_heal_mode'] = heal_mode
        try:
            from ._phase_intent import clear_phase_intent
            clear_phase_intent(case_data_store)
        except Exception:
            case_data_store.pop('_phase_intent', None)
        case_data_store['_force_refill_all'] = False
        case_data_store.pop('_submit_ready', None)
        case_data_store.pop('_success_tokens', None)
    else:
        case_data_store.pop('_heal_mode', None)
    return heal_mode


def is_heal_mode(case_data_store: dict | None) -> bool:
    return bool(case_data_store and case_data_store.get('_heal_mode'))


def truncate_text(text: str, max_len: int) -> str:
    t = (text or '').strip()
    if max_len <= 0 or len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + '…'


def record_phase_outcome(case_data_store: dict | None, phase_number: int, *, success: bool, text: str) -> None:
    """Persist done() outcome for later preamble (overwrites on phase retry)."""
    if case_data_store is None:
        return
    try:
        phase = int(phase_number)
    except (TypeError, ValueError):
        return
    store = case_data_store.setdefault('_phase_outcomes', {})
    store[phase] = {
        'success': bool(success),
        'text': truncate_text(text or '', _OUTCOME_TEXT_MAX),
    }


def clear_phase_outcomes(case_data_store: dict | None) -> None:
    if case_data_store is not None:
        case_data_store.pop('_phase_outcomes', None)


def _outcome_for(case_data_store: dict | None, phase_number: int) -> dict | None:
    if not case_data_store:
        return None
    store = case_data_store.get('_phase_outcomes') or {}
    hit = store.get(phase_number)
    if hit is None:
        # JSON keys may be strings after round-trip
        hit = store.get(str(phase_number))
    return hit if isinstance(hit, dict) else None


def _build_prior_entries(
    *,
    current_phase: int,
    prior_phases: list | None,
    case_data_store: dict | None,
) -> list[dict[str, Any]]:
    """Build up to 2 prior phase entries (exclude current phase)."""
    entries: list[dict[str, Any]] = []

    if isinstance(prior_phases, list) and prior_phases:
        for item in prior_phases:
            if not isinstance(item, dict):
                continue
            try:
                pn = int(item.get('phaseNumber', item.get('phase_number')))
            except (TypeError, ValueError):
                continue
            if pn == current_phase:
                continue
            desc = (item.get('description') or '').strip()
            outcome = _outcome_for(case_data_store, pn)
            entries.append({
                'phaseNumber': pn,
                'description': desc,
                'outcome': outcome,
            })
            if len(entries) >= 2:
                break
        return entries

    # Fallback: process-local outcomes only (phase_number - 1 / - 2)
    for pn in (current_phase - 1, current_phase - 2):
        if pn < 1 or pn == current_phase:
            continue
        outcome = _outcome_for(case_data_store, pn)
        if outcome is None:
            continue
        entries.append({
            'phaseNumber': pn,
            'description': '',
            'outcome': outcome,
        })
        if len(entries) >= 2:
            break
    # Keep chronological order (older first)
    entries.sort(key=lambda e: e['phaseNumber'])
    return entries[-2:]


def format_phase_preamble(
    *,
    current_phase: int,
    current_task: str,
    prior_phases: list | None,
    case_data_store: dict | None,
) -> str:
    """Return 【业务场景】+【当前任务】 block, or just current task if no priors / disabled.

    Does NOT append case-data hint — caller still uses format_case_data_hint.
    """
    task = (current_task or '').strip()
    if not phase_preamble_enabled():
        return task

    try:
        cur = int(current_phase)
    except (TypeError, ValueError):
        cur = 0

    priors = _build_prior_entries(
        current_phase=cur,
        prior_phases=prior_phases,
        case_data_store=case_data_store,
    )
    if not priors:
        return task

    lines = ['【业务场景】', '（此前阶段）']
    had_failure = False
    for e in priors:
        pn = e['phaseNumber']
        desc = truncate_text(e.get('description') or '', _PRIOR_DESC_MAX)
        if desc:
            lines.append(f'- 阶段{pn}：{desc}')
        else:
            lines.append(f'- 阶段{pn}：')
        outcome = e.get('outcome')
        if outcome:
            ok = bool(outcome.get('success'))
            label = '成功' if ok else '失败'
            otext = truncate_text(str(outcome.get('text') or ''), _OUTCOME_TEXT_MAX)
            if otext:
                lines.append(f'  结果：{label} — {otext}')
            else:
                lines.append(f'  结果：{label}')
            if not ok:
                had_failure = True
        else:
            lines.append('  结果：见页面当前状态')

    if had_failure:
        lines.append('（勿重复上阶段已尝试且失败的做法）')

    scenario = '\n'.join(lines)
    if len(scenario) > _PREAMBLE_TOTAL_MAX and len(priors) >= 2:
        # Prefer keeping the most recent prior (last entry); rebuild once without recursion risk
        last = priors[-1]
        slim = [
            '【业务场景】',
            '（此前阶段）',
        ]
        pn = last['phaseNumber']
        desc = truncate_text(last.get('description') or '', _PRIOR_DESC_MAX)
        slim.append(f'- 阶段{pn}：{desc}' if desc else f'- 阶段{pn}：')
        outcome = last.get('outcome')
        if outcome:
            ok = bool(outcome.get('success'))
            label = '成功' if ok else '失败'
            otext = truncate_text(str(outcome.get('text') or ''), _OUTCOME_TEXT_MAX)
            slim.append(f'  结果：{label} — {otext}' if otext else f'  结果：{label}')
            if not ok:
                slim.append('（勿重复上阶段已尝试且失败的做法）')
        else:
            slim.append('  结果：见页面当前状态')
        scenario = truncate_text('\n'.join(slim), _PREAMBLE_TOTAL_MAX)
    elif len(scenario) > _PREAMBLE_TOTAL_MAX:
        scenario = truncate_text(scenario, _PREAMBLE_TOTAL_MAX)

    current_block = f'【当前任务 — 阶段{cur}】\n{task}' if cur else f'【当前任务】\n{task}'
    return f'{scenario}\n\n{current_block}'
