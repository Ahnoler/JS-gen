"""
LLM-based form field value generation.

Three-tier priority:
1. User-provided data (from case_data_store → commandValue)
2. form_rules.py generators — match_rule() for input/date fields
3. LLM autonomous decision — for remaining fields

Model configuration (env vars, all optional):
  FORM_LLM_MODEL    — model name (e.g. "gpt-4o-mini", "deepseek-chat")
  FORM_LLM_BASE_URL — API base URL
  FORM_LLM_API_KEY  — API key
If unset, falls back to the agent's LLM (the `llm` parameter).
"""

import json
import os
import re
import time

from langchain_core.messages import SystemMessage, HumanMessage

from .form_rules import match_rule

# ── Load form LLM system prompt from external file ──────────────────────────
_DIRECTIVE_RE = re.compile(r'\{\{([^}]+\.md)\}\}')

def _resolve_directives(text):
    _base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    def _replacer(m):
        fname = m.group(1)
        fpath = os.path.join(_base, fname)
        if os.path.exists(fpath):
            with open(fpath, 'r', encoding='utf-8') as _f:
                return _f.read().strip()
        return m.group(0)
    return _DIRECTIVE_RE.sub(_replacer, text)

def _emit_form_batch_event(event, payload):
    """form_batch_started/done 占位事件（AI_FORM_BATCH_HEARTBEAT，默认开）。

    批量 LLM 生成期间保持事件流活跃，降低 WS 链路空闲被 NAT/LB 回收成半开连接的
    概率（长阶段静默丢事件的源头缓解）。失败静默，不阻塞填表。
    """
    try:
        from ..agent_utils import emit_json
        from ..feature_flags import form_batch_heartbeat_enabled
        if not form_batch_heartbeat_enabled():
            return
        emit_json({"event": event, "data": payload})
    except Exception:
        pass


def _load_fill_form_prompt():
    """Load the form LLM system prompt from prompts/form-prompt.md."""
    _prompt_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _form_path = os.path.join(_prompt_dir, 'prompts', 'form-prompt.md')
    try:
        with open(_form_path, 'r', encoding='utf-8') as _f:
            return _resolve_directives(_f.read()).strip()
    except Exception:
        # Fallback: load rules and build prompt inline
        _rules_path = os.path.join(_prompt_dir, 'prompts', 'agent-field-rules.md')
        try:
            with open(_rules_path, 'r', encoding='utf-8') as _f:
                _rules = _f.read()
        except Exception:
            _rules = ''
        return f'你是一个表单填写助手...\n\n{_rules}'

# ── Cached form-specific LLM instance ──────────────────────────────────────
_FORM_LLM = None
_FORM_LLM_CONFIG = None  # (model, base_url, api_key) to detect config changes


def _get_form_llm(agent_llm=None):
    """Return a dedicated LLM for form filling, or fall back to the agent's LLM.

    Configured via environment variables:
      FORM_LLM_MODEL / FORM_LLM_BASE_URL / FORM_LLM_API_KEY
    The instance is cached so it's created once per process.
    """
    global _FORM_LLM, _FORM_LLM_CONFIG
    model = os.getenv('FORM_LLM_MODEL', '').strip()
    if not model:
        return agent_llm  # No form-specific config → use agent's LLM (may be None)

    base_url = os.getenv('FORM_LLM_BASE_URL', '').strip()
    api_key = os.getenv('FORM_LLM_API_KEY', '').strip() or os.getenv('OPENAI_API_KEY', '').strip() or os.getenv('LLM_API_KEY', '').strip()
    new_config = (model, base_url, api_key)

    if _FORM_LLM is None or _FORM_LLM_CONFIG != new_config:
        from langchain_openai import ChatOpenAI
        _FORM_LLM = ChatOpenAI(model=model, base_url=base_url, api_key=api_key, temperature=0.0)
        _FORM_LLM_CONFIG = new_config

    return _FORM_LLM


def _llm_generate_values(llm, items, case_data_store=None,
                         instruction="生成合理的测试数据"):
    """Generate values for form fields with three-tier priority:
    1. User-provided data (from case_data_store)
    2. form_rules.py generators — match_rule() for input/date fields
    3. LLM autonomous decision — for remaining fields (select picks from options, input generates smart values)
    """
    actions = []
    llm_fields = []

    def _xpath_of(item) -> str:
        if isinstance(item, dict):
            return (item.get('xpath_smart') or '') or ''
        return getattr(item, 'xpath_smart', '') or ''

    def _append_action(payload: dict, item) -> None:
        xp = _xpath_of(item)
        payload = dict(payload)
        payload['xpath_smart'] = xp or ''
        actions.append(payload)

    # —— Cross-field dependency detection: postal code ↔ address ——
    # When both an address field and a postal code field exist in the same batch,
    # skip the P2 postal code rule so both go to the LLM together.  The LLM
    # can then generate a postal code consistent with the address (e.g.
    # "长沙市岳麓区..." → "410001" rather than a random 6-digit number).
    _ADDRESS_KEYWORDS = ('地址', '住所', '经营地址', '注册地址', '联系地址',
                          '通讯地址', '户籍地址', '办公地址', '单位地址')
    _POSTAL_KEYWORDS = ('邮政编码', '邮编')
    _has_address = any(
        any(kw in (item['label'] if isinstance(item, dict) else item)
            for kw in _ADDRESS_KEYWORDS)
        for item in items
    )
    def _is_postal_code(label):
        return any(kw in label for kw in _POSTAL_KEYWORDS)

    for item in items:
        label = item['label'] if isinstance(item, dict) else item
        kind = item.get('kind', 'input') if isinstance(item, dict) else 'input'
        opts = item.get('options', []) if isinstance(item, dict) else []

        # —— Priority 1: User-specified commandValue ——
        cmd_val = item.get('commandValue') if isinstance(item, dict) else None
        if cmd_val and str(cmd_val).strip():
            val = str(cmd_val).strip()
            if kind in ('select', 'radio', 'checkbox'):
                if kind == 'select' and opts and val not in opts:
                    pass  # Fall through if user value isn't in current options
                else:
                    action_name = 'click_radio' if kind == 'radio' else 'select_option'
                    _append_action({'action': action_name, 'label': label, 'option': val}, item)
                    continue
            else:
                _append_action({'action': 'fill_input', 'label': label, 'value': val}, item)
                continue

        # —— Priority 2: form_rules.py generators (input only) ——
        # Skip postal code P2 rule when address is present — defer to LLM
        # so postal code can be derived from the address value.
        if kind == 'input' and not (_has_address and _is_postal_code(label)):
            generated = match_rule(label)
            if generated:
                _append_action({'action': 'fill_input', 'label': label, 'value': generated}, item)
                continue

        # —— Priority 3: Defer to LLM ——
        llm_fields.append(item)

    if not llm_fields:
        return actions

    # Resolve form-specific LLM (env vars or agent's LLM)
    form_llm = _get_form_llm(agent_llm=llm)

    # No LLM available — basic fallback heuristics
    if not form_llm:
        from datetime import date as _date
        _today = _date.today().isoformat()
        # Use page reference date for date fields to respect business constraints
        # (e.g. ID start date must be <= business registration date)
        _ref_date = (case_data_store or {}).get('_ref_date', '') if case_data_store else ''
        _date_val = _ref_date if _ref_date else _today
        for item in llm_fields:
            label = item['label'] if isinstance(item, dict) else item
            kind = item.get('kind', 'input') if isinstance(item, dict) else 'input'
            opts = item.get('options', []) if isinstance(item, dict) else []
            if kind in ('select', 'radio', 'checkbox'):
                picked = ''
                for o in opts:
                    if o and o not in ('请选择', '请输入', '全部', ''):
                        picked = o; break
                if not picked and opts: picked = opts[0]
                action_name = 'click_radio' if kind == 'radio' else 'select_option'
                _append_action({'action': action_name, 'label': label, 'option': picked or '测试'}, item)
            elif kind == 'tree-select':
                # Tree-select needs tree navigation via JS_SELECT_TREE_OPTION.
                _append_action({'action': 'select_tree_option', 'label': label, 'option': 'first'}, item)
            elif kind == 'date':
                _append_action({'action': 'fill_input', 'label': label, 'value': _date_val}, item)
            else:
                _append_action({'action': 'fill_input', 'label': label, 'value': label[:6] + '_TEST'}, item)
        return actions

    # —— Build prompt for LLM ——
    field_lines = []
    for i, item in enumerate(llm_fields):
        label = item['label'] if isinstance(item, dict) else item
        kind = item.get('kind', 'input') if isinstance(item, dict) else 'input'
        line = f'{i+1}. label: "{label}", kind: {kind}'
        if isinstance(item, dict):
            if item.get('commandValue'):
                line += f', commandValue: "{item["commandValue"]}"'
            if item.get('options'):
                target = item['options']
                opts = target if isinstance(target, list) else json.loads(target) if isinstance(target, str) else []
                opts_str = ', '.join('"' + str(o) + '"' for o in opts)
                line += f', options: [{opts_str}]'
            if item.get('placeholder') and item['placeholder'] not in ('请选择', '请输入', ''):
                line += f', placeholder: "{item["placeholder"]}"'
        field_lines.append(line)

    prompt = f'当前表单字段：\n{chr(10).join(field_lines)}\n\n指令：{instruction}'

    # 批量生成开始：占位事件（防空闲，见 _emit_form_batch_event）
    _batch_start = time.time()
    _emit_form_batch_event('form_batch_started', {
        'fields': len(llm_fields),
        'labels': [f.get('label') for f in llm_fields],
        'at': _batch_start,
    })

    def _record_decision(status, output, error=None):
        # P1：LLM 表单值决策留痕（AI_MEMORY_DECISIONS 默认开）——
        # 回答「这个测试值是谁、依据什么生成的」；失败不阻塞填表。
        try:
            from ..memory.writer import emit_memory_event
            from ..feature_flags import memory_decisions_enabled
            if not memory_decisions_enabled():
                return
            model_name = (
                getattr(form_llm, 'model_name', None)
                or getattr(form_llm, 'model', None)
                or os.getenv('FORM_LLM_MODEL', '')
            )
            emit_memory_event(
                'decision',
                {
                    'kind': 'form_value',
                    'fields': [lbl for lbl in [f.get('label') for f in llm_fields]],
                    'status': status,
                },
                decision={
                    'decision_type': 'form_value',
                    'model': str(model_name or ''),
                    'temperature': 0.0,
                    'input_preview': str(prompt)[:500],
                    'output_json': {'actions': output, 'error': error} if error else {'actions': output},
                    'policy_checks': [{'check': 'parse', 'pass': status == 'passed'}],
                    'audit_status': 'passed' if status == 'passed' else 'failed',
                },
            )
        except Exception:
            pass

    try:
        response = form_llm.invoke([
            SystemMessage(content=_load_fill_form_prompt()),
            HumanMessage(content=prompt)
        ])
        text = response.content if hasattr(response, 'content') else str(response)
        # Parse JSON from response
        text = text.strip()
        if text.startswith('```'):
            text = text.split('\n', 1)[1].rsplit('```', 1)[0]
        parsed = json.loads(text)
        if isinstance(parsed, dict) and 'actions' in parsed:
            parsed = parsed['actions']
        llm_result = parsed if isinstance(parsed, list) else []
        # Attach xpath_smart from source fields when LLM omitted it
        by_label = {}
        for item in llm_fields:
            lbl = item['label'] if isinstance(item, dict) else item
            by_label.setdefault(lbl, item)
        enriched = []
        for a in llm_result:
            if not isinstance(a, dict):
                enriched.append(a)
                continue
            a2 = dict(a)
            if not (a2.get('xpath_smart') or '').strip():
                src = by_label.get(a2.get('label', ''))
                if src is not None:
                    a2['xpath_smart'] = _xpath_of(src) or ''
                else:
                    a2['xpath_smart'] = ''
            enriched.append(a2)
        llm_result = enriched
        _record_decision('passed', llm_result)
        _emit_form_batch_event('form_batch_done', {
            'fields': len(llm_fields),
            'status': 'ok',
            'duration_ms': int((time.time() - _batch_start) * 1000),
        })
        return actions + llm_result  # P1+P2 + LLM result
    except Exception as e:
        _record_decision('failed', [], error=str(e)[:300])
        _emit_form_batch_event('form_batch_done', {
            'fields': len(llm_fields),
            'status': 'error',
            'error': str(e)[:200],
            'duration_ms': int((time.time() - _batch_start) * 1000),
        })
        # Fallback — preserve P1+P2 actions, fill remaining with defaults
        for item in llm_fields:
            label = item['label'] if isinstance(item, dict) else item
            kind = item.get('kind', 'input') if isinstance(item, dict) else 'input'
            if kind == 'select':
                opts = item.get('options', []) if isinstance(item, dict) else []
                _append_action(
                    {'action': 'select_option', 'label': label, 'option': opts[0] if opts else '测试'},
                    item,
                )
            else:
                _append_action(
                    {'action': 'fill_input', 'label': label, 'value': label[:6] + '_TEST'},
                    item,
                )
        return actions
