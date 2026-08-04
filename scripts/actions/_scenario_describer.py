"""Business-scenario describer — inject non-mandatory context at agent step start.

Reads prior phase done() outcomes + controller/recorder action logs + a light
page snapshot, asks an LLM for a short Chinese summary, and injects a single
``[业务场景摘要]`` HumanMessage (replacing any previous one). Does not persist.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from scripts.feature_flags import (
    scenario_describer_enabled,
    scenario_describer_interval,
)
from scripts.actions._js_snippets import JS_SCENARIO_PAGE_SNAPSHOT

_SCENARIO_PREFIX = '[业务场景摘要]'
_TASK_MAX = 1200
_ACTION_LOG_MAX_ENTRIES = 12
_ACTION_LOG_TOTAL_MAX = 900
_OUTCOME_TOTAL_MAX = 600
_SUMMARY_MAX = 500
_PREV_SUMMARY_MAX = 400

_SCENARIO_LLM = None
_SCENARIO_LLM_CONFIG = None
_SYSTEM_PROMPT_CACHE: str | None = None


def _load_scenario_prompt() -> str:
    global _SYSTEM_PROMPT_CACHE
    if _SYSTEM_PROMPT_CACHE is not None:
        return _SYSTEM_PROMPT_CACHE
    prompt_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(prompt_dir, 'prompts', 'scenario-describer-prompt.md')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            _SYSTEM_PROMPT_CACHE = f.read().strip()
    except Exception as e:
        sys.stderr.write(f'[scenario_describer] prompt load failed: {e}\n')
        sys.stderr.flush()
        _SYSTEM_PROMPT_CACHE = (
            '你是业务场景描述助手。输出 2–4 句中文业务摘要，禁止操作指令与 DOM 索引。'
        )
    return _SYSTEM_PROMPT_CACHE


def _get_scenario_llm(agent_llm=None):
    """Dedicated SCENARIO_LLM_* if configured; else fall back to agent LLM."""
    global _SCENARIO_LLM, _SCENARIO_LLM_CONFIG
    model = os.getenv('SCENARIO_LLM_MODEL', '').strip()
    if not model:
        return agent_llm

    base_url = os.getenv('SCENARIO_LLM_BASE_URL', '').strip()
    api_key = (
        os.getenv('SCENARIO_LLM_API_KEY', '').strip()
        or os.getenv('OPENAI_API_KEY', '').strip()
        or os.getenv('LLM_API_KEY', '').strip()
    )
    new_config = (model, base_url, api_key)
    if _SCENARIO_LLM is None or _SCENARIO_LLM_CONFIG != new_config:
        from langchain_openai import ChatOpenAI
        _SCENARIO_LLM = ChatOpenAI(
            model=model, base_url=base_url or None, api_key=api_key or None, temperature=0.2,
        )
        _SCENARIO_LLM_CONFIG = new_config
    return _SCENARIO_LLM


def _truncate(text: str, max_len: int) -> str:
    t = (text or '').strip()
    if len(t) <= max_len:
        return t
    return t[: max_len - 1].rstrip() + '…'


def _msg_content_text(message) -> str:
    content = getattr(message, 'content', None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get('type') == 'text':
                parts.append(str(item.get('text') or ''))
            elif isinstance(item, str):
                parts.append(item)
        return '\n'.join(parts)
    return ''


def _collect_done_context(case_data_store: dict | None) -> str:
    """Cross-phase done() outcomes from case_data_store['_phase_outcomes']."""
    if not case_data_store:
        return '（无）'
    store = case_data_store.get('_phase_outcomes') or {}
    if not isinstance(store, dict) or not store:
        return '（无）'

    lines: list[str] = []
    items: list[tuple[int, dict]] = []
    for k, v in store.items():
        if not isinstance(v, dict):
            continue
        try:
            pn = int(k)
        except (TypeError, ValueError):
            continue
        items.append((pn, v))
    items.sort(key=lambda x: x[0])
    for pn, v in items[-4:]:
        ok = bool(v.get('success'))
        label = '成功' if ok else '失败'
        text = _truncate(str(v.get('text') or ''), 200)
        if text:
            lines.append(f'- 阶段{pn}：{label} — {text}')
        else:
            lines.append(f'- 阶段{pn}：{label}')
    if not lines:
        return '（无）'
    return _truncate('\n'.join(lines), _OUTCOME_TOTAL_MAX)


def _format_ctrl_entry(entry: dict) -> str | None:
    if not isinstance(entry, dict):
        return None
    action = entry.get('action') or entry.get('action_type') or ''
    if not action:
        return None
    params = entry.get('params') or {}
    if not isinstance(params, dict):
        params = {}
    bits = [str(action)]
    for key in (
        'label_text', 'option_text', 'value', 'menu_text', 'button_text',
        'row_text', 'tab_name', 'text', 'url',
    ):
        val = params.get(key)
        if val is None or val == '':
            continue
        bits.append(f'{key}={_truncate(str(val), 40)}')
    result = entry.get('result') or entry.get('extracted_content')
    if result:
        bits.append(f'result={_truncate(str(result), 60)}')
    return ' | '.join(bits)


def _collect_action_log_summary() -> str:
    """Prefer controller _ACTION_LOG; fall back / supplement with recorder plain log."""
    lines: list[str] = []
    try:
        from scripts.actions import _state as action_state
        ctrl_log = list(action_state._ACTION_LOG or [])
        for entry in ctrl_log[-_ACTION_LOG_MAX_ENTRIES:]:
            line = _format_ctrl_entry(entry)
            if line:
                lines.append(f'- {line}')
    except Exception as e:
        sys.stderr.write(f'[scenario_describer] ctrl action log read failed: {e}\n')
        sys.stderr.flush()

    if len(lines) < 3:
        try:
            from scripts import recorder as recorder_mod
            rec_log = list(getattr(recorder_mod, '_ACTION_LOG', None) or [])
            for line in rec_log[-_ACTION_LOG_MAX_ENTRIES:]:
                if isinstance(line, str) and line.strip():
                    lines.append(f'- {_truncate(line.strip(), 120)}')
        except Exception as e:
            sys.stderr.write(f'[scenario_describer] recorder log read failed: {e}\n')
            sys.stderr.flush()

    if not lines:
        return '（无）'
    # Keep last N if we overshot from merging
    lines = lines[-_ACTION_LOG_MAX_ENTRIES:]
    return _truncate('\n'.join(lines), _ACTION_LOG_TOTAL_MAX)


async def _collect_page_snapshot(agent) -> dict[str, Any]:
    browser_context = getattr(agent, 'browser_context', None)
    if browser_context is None:
        return {'error': 'no-browser-context'}
    try:
        page = await browser_context.get_current_page()
        raw = await page.evaluate(JS_SCENARIO_PAGE_SNAPSHOT)
        if isinstance(raw, str):
            return json.loads(raw)
        if isinstance(raw, dict):
            return raw
        return {'error': 'bad-snapshot-type'}
    except Exception as e:
        return {'error': str(e)[:120]}


def _collect_task_description(agent) -> str:
    task = getattr(agent, 'task', None) or ''
    if not isinstance(task, str):
        task = str(task)
    return _truncate(task, _TASK_MAX)


def _remove_previous_scenario_messages(agent) -> int:
    """Remove HumanMessages whose content starts with [业务场景摘要]. Returns count removed."""
    mm = getattr(agent, '_message_manager', None)
    if mm is None:
        return 0
    history = getattr(getattr(mm, 'state', None), 'history', None)
    managed_list = getattr(history, 'messages', None) if history is not None else None
    if not managed_list:
        return 0

    removed = 0
    keep = []
    for managed in managed_list:
        msg = getattr(managed, 'message', None)
        text = _msg_content_text(msg).lstrip()
        if text.startswith(_SCENARIO_PREFIX):
            removed += 1
            continue
        keep.append(managed)
    if removed:
        managed_list[:] = keep
    return removed


def _build_user_payload(
    *,
    done_context: str,
    action_log: str,
    page_snapshot: dict,
    task_description: str,
    prev_summary: str,
) -> str:
    snap_text = json.dumps(page_snapshot, ensure_ascii=False)
    if len(snap_text) > 800:
        snap_text = snap_text[:799] + '…'
    prev = _truncate(prev_summary or '', _PREV_SUMMARY_MAX) or '（无）'
    return (
        f'【跨阶段 done 结果】\n{done_context}\n\n'
        f'【本阶段操作日志】\n{action_log}\n\n'
        f'【页面快照】\n{snap_text}\n\n'
        f'【当前任务描述】\n{task_description or "（无）"}\n\n'
        f'【上一条摘要】\n{prev}\n\n'
        f'请输出 2–4 句业务场景摘要正文。'
    )


def _normalize_summary(text: str) -> str:
    t = (text or '').strip()
    if t.startswith('```'):
        t = t.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    return _truncate(t, _SUMMARY_MAX)


async def inject_scenario_summary(agent, case_data_store: dict | None = None) -> None:
    """Generate and inject a single [业务场景摘要] HumanMessage (non-blocking on errors)."""
    if not scenario_describer_enabled():
        return
    try:
        n_steps = int(getattr(getattr(agent, 'state', None), 'n_steps', 0) or 0)
    except (TypeError, ValueError):
        n_steps = 0
    if n_steps <= 0:
        return
    interval = scenario_describer_interval()
    if n_steps % interval != 0:
        return

    try:
        llm = _get_scenario_llm(getattr(agent, 'llm', None))
        if llm is None:
            sys.stderr.write('[scenario_describer] no LLM available — skip\n')
            sys.stderr.flush()
            return

        done_context = _collect_done_context(case_data_store)
        action_log = _collect_action_log_summary()
        page_snapshot = await _collect_page_snapshot(agent)
        task_description = _collect_task_description(agent)
        prev = ''
        if isinstance(case_data_store, dict):
            prev = str(case_data_store.get('_scenario_summary_prev') or '')

        user_payload = _build_user_payload(
            done_context=done_context,
            action_log=action_log,
            page_snapshot=page_snapshot,
            task_description=task_description,
            prev_summary=prev,
        )

        invoke = getattr(llm, 'ainvoke', None)
        if callable(invoke):
            response = await invoke([
                SystemMessage(content=_load_scenario_prompt()),
                HumanMessage(content=user_payload),
            ])
        else:
            response = llm.invoke([
                SystemMessage(content=_load_scenario_prompt()),
                HumanMessage(content=user_payload),
            ])

        raw = response.content if hasattr(response, 'content') else str(response)
        if isinstance(raw, list):
            parts = []
            for item in raw:
                if isinstance(item, dict) and item.get('type') == 'text':
                    parts.append(str(item.get('text') or ''))
                else:
                    parts.append(str(item))
            raw = '\n'.join(parts)
        summary = _normalize_summary(str(raw))
        if not summary:
            return

        removed = _remove_previous_scenario_messages(agent)
        msg = HumanMessage(content=(
            f'{_SCENARIO_PREFIX}\n{summary}\n\n'
            f'（仅供理解当前业务上下文，非强制指令；执行仍以【当前任务】、工具返回、'
            f'以及 [HUMAN INTERVENTION] / [SYSTEM] 强制 cue 为准。）'
        ))
        mm = getattr(agent, '_message_manager', None)
        if mm is None:
            return
        mm._add_message_with_tokens(msg)

        if isinstance(case_data_store, dict):
            case_data_store['_scenario_summary_prev'] = summary

        sys.stderr.write(
            f'[scenario_describer] injected n_steps={n_steps} '
            f'removed_prev={removed} summary={summary[:80]!r}\n'
        )
        sys.stderr.flush()

        try:
            from scripts.agent_utils import emit_json
            emit_json({
                'event': 'scenario_summary',
                'data': {
                    'n_steps': n_steps,
                    'summary': summary[:300],
                },
            })
        except Exception:
            pass
    except Exception as e:
        sys.stderr.write(f'[scenario_describer] failed: {e}\n')
        sys.stderr.flush()
