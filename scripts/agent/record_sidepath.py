"""Recording side path: a gate sentence, a done-time look, and a click veto.

None of these write a trajectory step. Vision failure means the main path
continues. A veto returns text to the model and does not execute the click.
"""
from __future__ import annotations

import base64
import json
import sys

_GATE_PREFIX = '[门禁] '
_VISION_PREFIX = '[识图] '
_VETO_MAX = 2
_DONE_VISION_MAX = 2
_CLICK_ACTIONS = frozenset({
    'click_element_by_index',
    'click_element',
    'click_button',
})


def format_gate_line(store: dict | None) -> str:
    """One sentence of the current phase gate. Empty when there is nothing to say."""
    if not isinstance(store, dict) or store.get('_heal_mode'):
        return ''
    try:
        from scripts.controller.actions.phase.intent_gates import (
            check_pending_write_gate,
            get_phase_intent,
            has_contract_success,
        )
        from scripts.controller.actions.section_scope import resolve_phase_section

        contract = get_phase_intent(store) or {}
        if not contract:
            return ''
        blockers: list[str] = []
        section = resolve_phase_section(store)
        ok_pending, labels = check_pending_write_gate(store, section=section)
        if not ok_pending and labels:
            blockers.append('未填：' + '、'.join(str(x) for x in labels[:4]))
        submit_required = bool((contract.get('submit') or {}).get('required'))
        boundary_on = False
        try:
            from scripts.controller.actions._phase_boundary import phase_boundary_active
            from scripts.controller.actions.phase.boundary_gates import phase_done_ok

            if phase_boundary_active(store):
                boundary_on = True
                ok_boundary, missing = phase_done_ok(store)
                if not ok_boundary:
                    shown = '、'.join(str(x) for x in (missing or [])[:4]) or '完成证据'
                    blockers.append('缺证据：' + shown)
        except Exception:
            boundary_on = False
        if submit_required and not boundary_on and not has_contract_success(store):
            blockers.append('未见保存或确认成功')
        if blockers:
            body = '还不能结束。' + '；'.join(blockers) + '。画面看起来完成也不能提前 done()。'
        elif submit_required or boundary_on:
            body = '门禁已满足，可以 done(success=true)。不要再点下一阶段的按钮。'
        else:
            body = '当前没有未填字段，也没有缺的成功令牌。是否结束以阶段任务为准。'
        scope = contract.get('out_of_scope') or ''
        if isinstance(scope, (list, tuple)):
            scope = '、'.join(str(x) for x in list(scope)[:3])
        scope = str(scope).strip()
        if scope:
            body += '不要做：' + scope[:40] + '。'
        return _GATE_PREFIX + body
    except Exception as exc:
        sys.stderr.write(f"[record-sidepath] gate line skipped: {exc}\n")
        sys.stderr.flush()
        return ''


def emit_gate_cue(agent, store: dict | None) -> None:
    """Inject [门禁] before the model picks an action. Failures stay on the side path."""
    try:
        from scripts.feature_flags import record_gate_cue_enabled

        if not record_gate_cue_enabled() or not isinstance(store, dict):
            return
        line = format_gate_line(store)
        if not line:
            return
        from langchain_core.messages import HumanMessage

        agent._message_manager._add_message_with_tokens(HumanMessage(content=line))
        sys.stderr.write(f"[record-sidepath] {line}\n")
        sys.stderr.flush()
    except Exception as exc:
        sys.stderr.write(f"[record-sidepath] gate cue skipped: {exc}\n")
        sys.stderr.flush()


def click_needs_vision(action_name: str, label: str, elements: list[dict], dialog_title: str) -> str:
    """Why this proposed click should be looked at, or '' when it can run as-is."""
    if action_name not in _CLICK_ACTIONS:
        return ''
    if str(dialog_title or '').strip():
        return 'dialog'
    text = str(label or '').strip()
    if not text:
        return 'icon'
    same = [
        item for item in elements or []
        if str(item.get('text') or '').strip() == text
    ]
    if len(same) >= 2:
        return 'ambiguous'
    visible = [str(item.get('text') or '') for item in elements or []]
    if visible and not any(text == item or text in item for item in visible):
        return 'missing'
    return ''


def fresh_dialog_title(store: dict | None) -> str:
    """Title of a dialog opened on the latest feedback row, once."""
    if not isinstance(store, dict):
        return ''
    rows = store.get('_step_feedback') or []
    if not rows or not isinstance(rows[-1], dict):
        return ''
    last = rows[-1]
    step = last.get('step')
    if store.get('_vision_dialog_step') == step:
        return ''
    for item in last.get('items') or []:
        if isinstance(item, dict) and item.get('kind') == 'dialog' and item.get('text'):
            return str(item.get('text'))
    return ''


def _phase_bucket(store: dict, phase: int) -> None:
    if store.get('_vision_veto_phase') != phase:
        store['_vision_veto_phase'] = phase
        store['_vision_vetoes'] = 0
        store['_vision_click_keys'] = []
        store['_vision_done_rejects'] = 0


def click_already_judged(store: dict, phase: int, key: str) -> bool:
    _phase_bucket(store, phase)
    return key in (store.get('_vision_click_keys') or [])


def click_veto_open(store: dict, phase: int) -> bool:
    _phase_bucket(store, phase)
    return int(store.get('_vision_vetoes') or 0) < _VETO_MAX


def remember_click_judgement(store: dict, key: str) -> None:
    keys = store.setdefault('_vision_click_keys', [])
    if key not in keys:
        keys.append(key)


def note_click_veto(store: dict) -> None:
    store['_vision_vetoes'] = int(store.get('_vision_vetoes') or 0) + 1


def parse_done_vision(text: str) -> str:
    """Error sentence when the picture shows one, else ''."""
    data = _json_object(text)
    if data.get('error_visible') is not True:
        return ''
    what = str(data.get('what') or '').strip()
    return what[:80]


def parse_click_vision(text: str) -> str:
    """Visible label to click instead, else '' (uncertain answers do not veto)."""
    data = _json_object(text)
    if data.get('allow') is not False:
        return ''
    instead = str(data.get('instead') or '').strip()
    return instead[:40]


def _json_object(text: str) -> dict:
    raw = str(text or '')
    start = raw.find('{')
    end = raw.rfind('}')
    if start < 0 or end <= start:
        return {}
    try:
        data = json.loads(raw[start:end + 1])
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _first_click(actions) -> tuple[str, str, object]:
    if not actions:
        return '', '', None
    action = actions[0]
    data = {}
    if hasattr(action, 'model_dump'):
        try:
            data = action.model_dump(exclude_unset=True)
        except TypeError:
            data = action.model_dump()
    elif isinstance(action, dict):
        data = action
    if not isinstance(data, dict):
        return '', '', None
    for name, params in data.items():
        if not params:
            continue
        if not isinstance(params, dict):
            params = {}
        label = str(
            params.get('text')
            or params.get('button_text')
            or params.get('label')
            or ''
        ).strip()
        return str(name), label, params.get('index')
    return '', '', None


def _element_text(node) -> str:
    reader = getattr(node, 'get_all_text_till_next_clickable_element', None)
    if callable(reader):
        try:
            text = reader()
            if text:
                return str(text).strip()[:80]
        except Exception:
            pass
    attrs = getattr(node, 'attributes', None) or {}
    if isinstance(attrs, dict):
        for key in ('aria-label', 'placeholder', 'title'):
            if attrs.get(key):
                return str(attrs[key]).strip()[:80]
    return ''


def _elements_from_agent(agent) -> list[dict]:
    try:
        state = getattr(agent.browser_context, 'current_state', None)
        selector_map = getattr(state, 'selector_map', None) or {}
    except Exception:
        return []
    items = []
    try:
        pairs = selector_map.items()
    except Exception:
        return []
    for index, node in pairs:
        items.append({'index': index, 'text': _element_text(node)})
    return items


def _label_for_index(elements: list[dict], index) -> str:
    for item in elements:
        if item.get('index') == index and item.get('text'):
            return str(item['text'])
    return ''


async def _viewport_b64(agent, *, clear_highlights: bool) -> str:
    try:
        context = agent.browser_context
        if clear_highlights and hasattr(context, 'remove_highlights'):
            await context.remove_highlights()
        page = await context.get_current_page()
        target = getattr(page, 'page', page)
        png = await target.screenshot(full_page=False, type='png', animations='disabled')
        if not png:
            return ''
        return base64.b64encode(png).decode('ascii')
    except Exception as exc:
        sys.stderr.write(f"[record-sidepath] screenshot skipped: {exc}\n")
        sys.stderr.flush()
        return ''


def _rewrite_done_rejected(agent, reason: str) -> None:
    from langchain_core.messages import HumanMessage

    for item in agent.state.history.history:
        if not item.result:
            continue
        for result in item.result:
            result.is_done = False
            result.error = reason
            try:
                from scripts.feature_flags import memory_whitelist_enabled
                if memory_whitelist_enabled():
                    result.include_in_memory = True
            except Exception:
                pass
    try:
        agent._message_manager._add_message_with_tokens(HumanMessage(
            content=_VISION_PREFIX + reason,
        ))
    except Exception:
        pass


async def reject_done_if_viewport_error(agent, store: dict | None) -> bool:
    """Reject a gate-passing done() when the viewport shows an error sentence.

    Returns True when the done was rejected. Two rejects in one phase then
    the gate decision stands. Any failure returns False.
    """
    try:
        from scripts.feature_flags import record_vision_enabled
        from scripts.state import get_current_phase

        if not record_vision_enabled() or not isinstance(store, dict) or store.get('_heal_mode'):
            return False
        phase = int(get_current_phase() or 0)
        _phase_bucket(store, phase)
        if int(store.get('_vision_done_rejects') or 0) >= _DONE_VISION_MAX:
            return False
        from .record_vision import ask_vision

        png = await _viewport_b64(agent, clear_highlights=True)
        if not png:
            return False
        gate = format_gate_line(store) or '门禁已通过。'
        answer = await ask_vision(
            getattr(agent, 'llm', None),
            png,
            '只判断画面上是否有校验错误文案或错误提示气泡。必填星号不算。'
            '不要判断阶段是否完成。'
            f'当前门禁结论：{gate} '
            '只回答 JSON：{"error_visible": false, "what": ""} '
            '或 {"error_visible": true, "what": "不超过40字的错误原文"}',
        )
        what = parse_done_vision(answer)
        if not what:
            sys.stderr.write('[record-sidepath] done vision: no error\n')
            sys.stderr.flush()
            return False
        store['_vision_done_rejects'] = int(store.get('_vision_done_rejects') or 0) + 1
        reason = (
            'Premature done() rejected: viewport shows an error the gate missed '
            f'({what}). Fix it, then done() again.'
        )
        _rewrite_done_rejected(agent, reason)
        sys.stderr.write(f"[record-sidepath] done vision rejected: {what}\n")
        sys.stderr.flush()
        return True
    except Exception as exc:
        sys.stderr.write(f"[record-sidepath] done vision skipped: {exc}\n")
        sys.stderr.flush()
        return False


async def consider_click_veto(agent, store: dict | None, actions) -> str:
    """Return a [识图] sentence when the proposed click must not run, else ''."""
    try:
        from scripts.feature_flags import record_vision_enabled
        from scripts.state import get_current_phase

        if not record_vision_enabled() or not isinstance(store, dict) or store.get('_heal_mode'):
            return ''
        name, label, index = _first_click(actions)
        elements = _elements_from_agent(agent)
        if not label and index is not None:
            label = _label_for_index(elements, index)
        dialog = fresh_dialog_title(store)
        reason = click_needs_vision(name, label, elements, dialog)
        if not reason:
            return ''
        if dialog:
            rows = store.get('_step_feedback') or []
            if rows and isinstance(rows[-1], dict):
                store['_vision_dialog_step'] = rows[-1].get('step')
        phase = int(get_current_phase() or 0)
        key = f"{reason}|{name}|{index}|{label}"
        if click_already_judged(store, phase, key) or not click_veto_open(store, phase):
            return ''
        from .record_vision import ask_vision

        png = await _viewport_b64(agent, clear_highlights=False)
        remember_click_judgement(store, key)
        if not png:
            return ''
        answer = await ask_vision(
            getattr(agent, 'llm', None),
            png,
            '模型准备点击控件「' + (label or '无文字') + '」。'
            '编号框如果还在，对应当前元素索引。'
            '只有当你明确看到不该点这个控件、而应点另一个带文字的控件时，才拒绝。'
            '不确定就允许。不要发明坐标。'
            '只回答 JSON：{"allow": true} 或 {"allow": false, "instead": "应点的可见文字"}',
        )
        instead = parse_click_vision(answer)
        if not instead:
            sys.stderr.write(f"[record-sidepath] click vision allow reason={reason}\n")
            sys.stderr.flush()
            return ''
        note_click_veto(store)
        message = (
            f"{_VISION_PREFIX}这次点击未执行。画面上应点「{instead}」。"
            '请改用元素索引重选，不要输出坐标。'
        )
        sys.stderr.write(f"[record-sidepath] click veto reason={reason} instead={instead}\n")
        sys.stderr.flush()
        return message
    except Exception as exc:
        sys.stderr.write(f"[record-sidepath] click vision skipped: {exc}\n")
        sys.stderr.flush()
        return ''


def install_click_vision_veto(agent, store: dict | None) -> None:
    """Wrap multi_act so a veto never reaches the controller or the trajectory."""
    if getattr(agent, '_click_vision_installed', False):
        return
    original = agent.multi_act

    async def _wrapped(actions, *args, **kwargs):
        message = await consider_click_veto(agent, store, actions)
        if message:
            from browser_use.agent.views import ActionResult
            return [ActionResult(extracted_content=message, include_in_memory=True)]
        return await original(actions, *args, **kwargs)

    agent.multi_act = _wrapped
    agent._click_vision_installed = True
