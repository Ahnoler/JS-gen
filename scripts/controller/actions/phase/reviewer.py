"""LLM Phase Reviewer — compile execution contract before each AI recording phase."""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any

_VALID_MODES = frozenset({
    'navigate', 'create', 'modify', 'query', 'introduce_pick', 'login', 'other',
})
_VALID_REFILL = frozenset({'none', 'touched', 'all_editable'})

# Modes that must not require form-submit success tokens (done() after login/nav/query).
_NO_SUBMIT_TOKEN_MODES = frozenset({'login', 'navigate', 'query'})

_EFFORT_STEPS = {'short': 5, 'medium': 15, 'long': 30}
_MAX_STEPS_FLOOR = 3
# +2: one for browser-use done-only last step, one for save/final-check action.
_MAX_STEPS_BUFFER = 2
# submit.required phases need room for assistant + empties/retries + click_save + done.
_SUBMIT_STEPS_FLOOR = 8
# Extra headroom when submit.required for empty-act / retry steps before click_save.
_EMPTY_ACT_BUFFER = 3
# create/modify often hit validation → introduce → final save after the estimate.
_CREATE_RECOVERY_BUFFER = 4
_VALID_EFFORT = frozenset(_EFFORT_STEPS)


def resolve_phase_max_steps(ceiling: int, contract: dict | None) -> int:
    """Force-cap agent max_steps from reviewer estimate, never above ceiling.

    Prefer ``estimated_steps + buffer`` when present; else ``effort`` bucket;
    else ceiling. Buffer is 2 so a correct estimate still leaves room for
    click_save/暂存 *and* the browser-use done-only final step.

    When ``submit.required`` is true, also enforce ``_SUBMIT_STEPS_FLOOR`` so
    optimistic estimates (e.g. est=4 → 6) cannot starve click_save, then add
    ``_EMPTY_ACT_BUFFER`` for empty-act retries before submit. create/modify
    get ``_CREATE_RECOVERY_BUFFER`` for validation→introduce→final-save paths.
    """
    try:
        ceil = int(ceiling)
    except (TypeError, ValueError):
        ceil = 40
    if ceil < 1:
        ceil = 40
    if not isinstance(contract, dict):
        return ceil
    raw = None
    est = contract.get('estimated_steps')
    try:
        est_i = int(est)
    except (TypeError, ValueError):
        est_i = 0
    if est_i > 0:
        raw = est_i + _MAX_STEPS_BUFFER
    else:
        effort = str(contract.get('effort') or '').strip().lower()
        if effort in _EFFORT_STEPS:
            raw = _EFFORT_STEPS[effort]
    floor = _MAX_STEPS_FLOOR
    submit = contract.get('submit') or {}
    if coerce_bool(submit.get('required')):
        floor = max(floor, _SUBMIT_STEPS_FLOOR)
    if raw is None:
        return ceil
    chosen = min(ceil, max(floor, int(raw)))
    if coerce_bool(submit.get('required')):
        chosen = min(ceil, chosen + _EMPTY_ACT_BUFFER)
    # create/modify 无条件加恢复预算（validation→introduce→final-save 路径）。
    # 曾被误缩进在 submit.required 分支内：无保存要求的 create 填报阶段
    # （submit.required=False）拿不到 +4，引入子流程没步数可用即被截断
    # （2026-08-21 traj 33 P2：chosen=10，10 步耗尽被迫 done(success=False)）。
    mode = str(contract.get('mode') or '').strip().lower()
    if mode in ('create', 'modify'):
        chosen = min(ceil, chosen + _CREATE_RECOVERY_BUFFER)
    return chosen


def coerce_bool(value: Any) -> bool:
    """Only True / \"true\" / \"1\" / 1 are True; all else (incl. \"false\") → False."""
    if value is True or value == 1:
        return True
    if isinstance(value, str):
        return value.strip().lower() in ('true', '1')
    return False


def sanitize_contract_for_mode(contract: dict[str, Any]) -> dict[str, Any]:
    """Force non-maintain modes to not require submit success tokens.

    LLM reviewers often invent submit.required=true + toast_ok/url_change for
    login/navigate; recorder then rejects every done() (no token is ever recorded).
    """
    c = dict(contract)
    mode = c.get('mode') or 'other'
    if mode not in _NO_SUBMIT_TOKEN_MODES:
        return c
    submit = dict(c.get('submit') or {})
    submit['required'] = False
    if not submit.get('via'):
        submit['via'] = 'any'
    if 'button_text' not in submit:
        submit['button_text'] = ''
    c['submit'] = submit
    success = dict(c.get('success') or {})
    success['kinds'] = []
    success['evidence'] = list(success.get('evidence') or [])[:8]
    c['success'] = success
    c['allow_form_assistant'] = False
    if c.get('refill') not in _VALID_REFILL:
        c['refill'] = 'none'
    elif mode in _NO_SUBMIT_TOKEN_MODES and c.get('refill') == 'all_editable':
        c['refill'] = 'none'
    return c


def contract_debug_line(contract: dict[str, Any] | None) -> str:
    """One-line stderr-friendly contract summary for AI recording debug."""
    if not contract:
        return 'contract=None'
    submit = contract.get('submit') or {}
    success = contract.get('success') or {}
    kinds = success.get('kinds') or []
    goal = str(contract.get('goal') or '').replace('\n', ' ').strip()
    if len(goal) > 60:
        goal = goal[:57] + '...'
    return (
        f"mode={contract.get('mode')} "
        f"allow_assistant={bool(contract.get('allow_form_assistant'))} "
        f"refill={contract.get('refill')} "
        f"submit.required={bool(submit.get('required'))} "
        f"success.kinds={list(kinds)} "
        f"source={contract.get('source')} "
        f"goal={goal!r}"
    )


def _load_prompt() -> str:
    p = Path(__file__).resolve().parents[3] / 'prompts' / 'phase-reviewer-prompt.md'
    return p.read_text(encoding='utf-8')


def normalize_reviewer_payload(raw: str) -> dict[str, Any] | None:
    t = (raw or '').strip()
    if t.startswith('```'):
        t = t.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    try:
        data = json.loads(t)
    except Exception:
        m = re.search(r'\{.*\}', t, re.S)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except Exception:
            return None
    if not isinstance(data, dict):
        return None
    mode = data.get('mode')
    refill = data.get('refill') or 'none'
    if mode not in _VALID_MODES or refill not in _VALID_REFILL:
        return None
    out = {
        'mode': mode,
        'allow_form_assistant': coerce_bool(data.get('allow_form_assistant')),
        'refill': refill,
        'goal': str(data.get('goal') or '')[:300],
        'in_scope': [str(x) for x in (data.get('in_scope') or [])][:12],
        'out_of_scope': [str(x) for x in (data.get('out_of_scope') or [])][:12],
        'done_when': str(data.get('done_when') or '')[:300],
        'submit': data.get('submit') if isinstance(data.get('submit'), dict) else {
            'required': False, 'via': 'any', 'button_text': '',
        },
        'success': data.get('success') if isinstance(data.get('success'), dict) else {
            'kinds': [], 'evidence': [],
        },
        'source': 'llm',
    }
    brief_plan = [
        str(x).strip() for x in (data.get('brief_plan') or [])
        if str(x).strip()
    ][:4]
    if not brief_plan:
        goal = out['goal'].strip()
        brief_plan = [goal] if goal else ['完成本阶段任务']
    out['brief_plan'] = brief_plan
    effort = str(data.get('effort') or '').strip().lower()
    if effort in _VALID_EFFORT:
        out['effort'] = effort
    try:
        est_i = int(data.get('estimated_steps'))
    except (TypeError, ValueError):
        est_i = 0
    if est_i > 0:
        out['estimated_steps'] = est_i
    return sanitize_contract_for_mode(out)


def _build_user_payload(
    *,
    task_text: str,
    all_phases: list,
    current_phase_number: int,
    scenario_summary: str = '',
) -> str:
    blocks: list[str] = []

    summary = (scenario_summary or '').strip()
    if summary:
        blocks.append(f'【业务场景摘要】\n{summary}')

    phase_lines: list[str] = ['【全部阶段】']
    if isinstance(all_phases, list) and all_phases:
        try:
            cur = int(current_phase_number)
        except (TypeError, ValueError):
            cur = 0
        for p in all_phases:
            if not isinstance(p, dict):
                continue
            n = p.get('phaseNumber') if p.get('phaseNumber') is not None else p.get('phase_number')
            desc = (p.get('description') or '').strip()
            title = (p.get('title') or p.get('name') or '').strip()
            if not desc:
                desc = title
            if not desc:
                continue
            mark = ''
            if n is not None:
                try:
                    if int(n) == cur:
                        mark = ' ← 当前阶段'
                except (TypeError, ValueError):
                    pass
                phase_lines.append(f'{n}. {desc}{mark}')
            else:
                phase_lines.append(f'- {desc}{mark}')
    if len(phase_lines) > 1:
        blocks.append('\n'.join(phase_lines))

    blocks.append(f'【当前阶段任务】\n{(task_text or "").strip() or "（无）"}')
    blocks.append('请仅输出符合规范的 JSON 合约对象。')
    return '\n\n'.join(blocks)


async def review_phase_contract(
    *,
    task_text: str,
    all_phases: list,
    current_phase_number: int,
    scenario_summary: str = '',
    llm=None,
) -> dict[str, Any] | None:
    from scripts.feature_flags import phase_reviewer_enabled, phase_reviewer_timeout_s

    if not phase_reviewer_enabled() or llm is None:
        return None
    from langchain_core.messages import HumanMessage, SystemMessage

    timeout = phase_reviewer_timeout_s()
    try:
        coro = llm.ainvoke([
            SystemMessage(content=_load_prompt()),
            HumanMessage(content=_build_user_payload(
                task_text=task_text,
                all_phases=all_phases if isinstance(all_phases, list) else [],
                current_phase_number=current_phase_number,
                scenario_summary=scenario_summary,
            )),
        ])
        response = await asyncio.wait_for(coro, timeout=timeout)
        raw = response.content if hasattr(response, 'content') else str(response)
        if isinstance(raw, list):
            raw = '\n'.join(str(x) for x in raw)
        return normalize_reviewer_payload(str(raw))
    except Exception as e:
        sys.stderr.write(f'[phase_reviewer] failed: {e}\n')
        sys.stderr.flush()
        return None


_BUDGET_EXTEND_MAX_ROUNDS = 2


def compute_budget_extension(pending_state: dict) -> int:
    """Compute extension steps for budget-exhausted continuation.

    Cost model: introduce fields ×4 (点旁钮+弹窗检索+选择+回填验证),
    pending fields ×2 (fill/select 直填), tree-select ×1 (额外检索),
    +2 (verify + done 收尾). Clamped to (ceiling - used_steps).
    Returns <=0 when no budget remains.
    """
    try:
        introduce = int(pending_state.get('introduce_fields', 0))
        pending = int(pending_state.get('pending_fields', 0))
        tree_select = int(pending_state.get('tree_select_fields', 0))
        ceiling = int(pending_state.get('ceiling', 0))
        used = int(pending_state.get('used_steps', 0))
    except (TypeError, ValueError):
        return 0
    raw = introduce * 4 + pending * 2 + tree_select * 1 + 2
    remaining = ceiling - used
    # 无工作量时不续跑（+2 收尾仅在有待完成字段时才加）
    if introduce == 0 and pending == 0 and tree_select == 0:
        return 0
    return max(0, min(raw, remaining))
