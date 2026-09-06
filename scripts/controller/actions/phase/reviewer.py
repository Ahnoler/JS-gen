"""LLM Phase Reviewer — compile execution contract before each AI recording phase."""
from __future__ import annotations

import asyncio
import json
import os
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

# 文本含保存/提交 cue 的误分类升级护栏（D1）：
# LLM 评审器把「新增…点击保存」误判为 navigate 时，promote_contract_for_save_cues
# 依据确定性 classify_task_mode + 本 cue 将合约升级为 create/modify（2026-08-27 d3943e89）。
_SAVE_CUE_RE = re.compile(r'点击\s*保存|保存\s*成功|点击\s*提交|提交\s*成功|保存并提交|提交并保存|保存后')

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


def promote_contract_for_save_cues(
    contract: dict[str, Any] | None, task_text: str
) -> dict[str, Any] | None:
    """Promote LLM contracts degraded to navigate/query when text has save cues.

    Regression guard (2026-08-27 session d3943e89): LLM phase reviewer judged
    「新增…，点击保存。预期结果：页面跳转至…或提示保存成功。」 as mode=navigate,
    clearing submit.required / success.kinds; the agent then called done() with
    the create drawer half-filled (对公客户类型/证件类型/证件号码为空). When the
    deterministic classifier says form_fill/form_modify AND the task text carries
    a save/submit cue, the contract is re-promoted to create/modify with submit
    tokens — the LLM misclassification cannot silently win over the signal.

    E extension (2026-08-27): the narrative fields (goal / done_when / in_scope /
    out_of_scope / brief_plan / source) are also re-derived from the deterministic
    template so leftover LLM navigation wording (只打开页面 / 不办理…) cannot
    contradict the promoted create/modify contract inside agent prompts.
    """
    if not isinstance(contract, dict):
        return contract
    from .classify import classification_task_text, classify_task_mode

    mode = contract.get('mode') or 'other'
    if mode not in ('navigate', 'login', 'query', 'other'):
        return contract
    t = classification_task_text(task_text)
    if not t:
        return contract
    det = classify_task_mode(t)
    if det not in ('form_fill', 'form_modify'):
        return contract
    if not _SAVE_CUE_RE.search(t):
        return contract
    c = dict(contract)
    old_mode = mode
    c['mode'] = 'create' if det == 'form_fill' else 'modify'
    submit = dict(c.get('submit') or {})
    submit['required'] = True
    submit['via'] = 'any'
    submit['button_text'] = ''
    c['submit'] = submit
    success = dict(c.get('success') or {})
    success['kinds'] = ['toast_ok', 'url_change', 'saved_navigation']
    success['evidence'] = list(success.get('evidence') or [])[:8]
    c['success'] = success
    c['allow_form_assistant'] = True
    c['refill'] = 'all_editable'
    # 叙事字段派生（E）：LLM 遗留的导航式叙事与升级后的 create/modify 硬语义矛盾
    # （如 out_of_scope「只打开页面/不办理页面内业务流程」在 intent_gates.py:47-73
    # 逐行注入摘要，agent 可能被明确告知不要填表/过早 done）。goal 直接用阶段全文
    # （与【当前任务】一致）；in_scope/out_of_scope/done_when/brief_plan 按确定性
    # 模板重写；source 标记为 llm+guard 以与纯 LLM 合约区分。
    c['goal'] = str(task_text or '').strip()[:300]
    if c['mode'] == 'create':
        c['done_when'] = (
            '完成新增表单/抽屉的必填字段填写并通过校验（err-save-validation 为空），'
            '点击保存后出现保存成功提示（ok-save-success/操作成功）或页面跳转至后续页面；'
            '随后终检并 done。'
        )
        c['in_scope'] = [
            '填写/修订当前表单必填及任务点名字段（值必须落在对应字段选项内）',
            '处理表单校验错误（err-save-validation 列出的字段）',
            '点击保存/提交并确认保存成功（提示或跳转）',
            '终检后调用 done() 结束本阶段',
        ]
        c['brief_plan'] = [
            '进入/打开新增表单或抽屉',
            '填写必填字段（先对照快照 options）',
            '处理校验错误并点击保存',
            '确认保存成功后 done',
        ]
    else:
        c['done_when'] = (
            '完成修改表单的必填/点名字段修改并通过校验（err-save-validation 为空），'
            '点击保存/确认后出现保存成功提示（ok-save-success/操作成功）或页面跳转；'
            '随后终检并 done。'
        )
        c['in_scope'] = [
            '修改当前表单必填及任务点名/业务数据点名字段（值必须落在对应字段选项内）',
            '处理表单校验错误（err-save-validation 列出的字段）',
            '点击保存/提交并确认保存成功（提示或跳转）',
            '终检后调用 done() 结束本阶段',
        ]
        c['brief_plan'] = [
            '打开/定位修改表单',
            '修改必填/点名字段（先对照快照 options）',
            '点击保存/确认并等待成功',
            '终检后 done',
        ]
    c['out_of_scope'] = [
        '后续阶段的任务（见【阶段目录】后续阶段）',
        '放弃保存/取消关闭当前表单',
    ]
    c['source'] = 'llm+guard'
    sys.stderr.write(
        f'[phase_reviewer] promote {old_mode}→{c["mode"]} '
        f'(save-cue in text; deterministic={det}) narrative=derived\n'
    )
    sys.stderr.flush()
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


def _get_reviewer_llm(agent_llm=None):
    """Dedicated REVIEWER_LLM_* if configured; else fall back to agent LLM.

    Reads REVIEWER_LLM_MODEL / BASE_URL / API_KEY. When MODEL is empty,
    returns agent_llm unchanged (may be None). Otherwise creates a dedicated
    ChatOpenAI.

    Timeout chain (first non-empty / >0 wins, converted to seconds):
      1. REVIEWER_LLM_TIMEOUT_MS (explicit ms, >0)
      2. AI_PHASE_REVIEWER_TIMEOUT_S × 1000 (via feature_flags.phase_reviewer_timeout_s();
         default 20s)
      3. LLM_TIMEOUT_MS (fallback ms)

    两层超时关系：本 timeout 是 LLM 实例级（create_llm timeout=，单次 ainvoke 软上限）；
    外层 review_phase_contract 的 asyncio.wait_for(..., timeout=phase_reviewer_timeout_s())
    是评审硬上限（含 LLM 调用 + 解析 + 重试总耗时）。当未显式设置 REVIEWER_LLM_TIMEOUT_MS
    时，两者取同一基准（AI_PHASE_REVIEWER_TIMEOUT_S），避免实例级超时 > 外层硬上限导致
    asyncio.wait_for 先行截断而 LLM 软超时形同虚设。<=0 → 不传 timeout（用 create_llm 默认）。
    """
    model = os.getenv('REVIEWER_LLM_MODEL', '').strip()
    base_url = os.getenv('REVIEWER_LLM_BASE_URL', '').strip()
    api_key = (
        os.getenv('REVIEWER_LLM_API_KEY', '').strip()
        or os.getenv('OPENAI_API_KEY', '').strip()
        or os.getenv('LLM_API_KEY', '').strip()
    )
    if not model:
        return agent_llm
    from scripts.agent_utils import create_llm
    from scripts.feature_flags import phase_reviewer_timeout_s

    timeout_ms = 0
    raw = os.getenv('REVIEWER_LLM_TIMEOUT_MS', '').strip()
    if raw:
        try:
            timeout_ms = float(raw)
        except (TypeError, ValueError):
            timeout_ms = 0
    if timeout_ms <= 0:
        # 跟随评审外层硬上限 AI_PHASE_REVIEWER_TIMEOUT_S（默认 20s）
        timeout_ms = phase_reviewer_timeout_s() * 1000
    if timeout_ms <= 0:
        raw_llm = os.getenv('LLM_TIMEOUT_MS', '').strip()
        if raw_llm:
            try:
                timeout_ms = float(raw_llm)
            except (TypeError, ValueError):
                timeout_ms = 0
    timeout_sec = timeout_ms / 1000.0 if timeout_ms > 0 else None
    return create_llm(model, base_url, api_key=api_key, timeout=timeout_sec)


async def review_phase_contract(
    *,
    task_text: str,
    all_phases: list,
    current_phase_number: int,
    scenario_summary: str = '',
    llm=None,
) -> dict[str, Any] | None:
    from scripts.feature_flags import phase_reviewer_enabled, phase_reviewer_timeout_s

    if not phase_reviewer_enabled():
        return None
    # When no explicit llm is passed, try to build a dedicated reviewer LLM
    # from REVIEWER_LLM_* env. Falls back to agent LLM (may still be None).
    if llm is None:
        llm = _get_reviewer_llm(llm)
    if llm is None:
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
        return promote_contract_for_save_cues(normalize_reviewer_payload(str(raw)), task_text)
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

    进度感知缓冲部署（可选）: 当传入 total_fields>0 且 done_fields>0
    时，按「字段总数 + 已完成字段数」结合已用步数估算剩余步数，并取
    max(legacy_raw, estimated) 以保证永不低于旧成本模型（仅加 headroom）。
    缺失/非法新键时完全回退到旧式计算（字节级保持）。
    """
    try:
        introduce = int(pending_state.get('introduce_fields', 0))
        pending = int(pending_state.get('pending_fields', 0))
        tree_select = int(pending_state.get('tree_select_fields', 0))
        ceiling = int(pending_state.get('ceiling', 0))
        used = int(pending_state.get('used_steps', 0))
    except (TypeError, ValueError):
        return 0
    legacy_raw = introduce * 4 + pending * 2 + tree_select * 1 + 2
    remaining = ceiling - used
    # 无工作量时不续跑（+2 收尾仅在有待完成字段时才加）
    if introduce == 0 and pending == 0 and tree_select == 0:
        return 0
    # 进度感知缓冲部署：字段总数 + 已完成字段数 → 估算剩余步数
    raw = legacy_raw
    try:
        total_fields = int(pending_state.get('total_fields', 0))
        done_fields = int(pending_state.get('done_fields', 0))
    except (TypeError, ValueError):
        total_fields = 0
        done_fields = 0
    if total_fields > 0 and done_fields > 0:
        import math
        avg = used / done_fields
        est_remaining = max(total_fields - done_fields, introduce + pending + tree_select)
        estimated = math.ceil(avg * est_remaining) + 2
        raw = max(legacy_raw, estimated)
    return max(0, min(raw, remaining))
