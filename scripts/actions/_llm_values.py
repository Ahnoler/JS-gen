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

from langchain_core.messages import SystemMessage, HumanMessage

from ..form_rules import match_rule

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


def _load_fill_form_prompt():
    """Load the canonical form filling rules from agent-field-rules.md."""
    _prompt_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _rules_path = os.path.join(_prompt_dir, 'prompts', 'agent-field-rules.md')
    try:
        with open(_rules_path, 'r', encoding='utf-8') as _f:
            _rules = _f.read()
    except Exception:
        _rules = ''
    return f'''你是一个表单填写助手。根据字段列表，返回 JSON 动作数组。

动作类型：
- fill_input: 填写输入框，参数 {{"action":"fill_input","label":"字段标签","value":"要填的值"}}
- select_option: 选择下拉框，参数 {{"action":"select_option","label":"字段标签","option":"要选的选项"}}

规则：
- commandValue 标记的字段：用户已指定值，直接使用 commandValue 填入
- 无 commandValue 的 input/date 字段：严格按照下方规则文档生成合法值。value 必须是纯数据值（如"测试科技发展有限公司"），禁止包含规则描述、示例标注、括号说明等解释性文字。
- 无 commandValue 的 select/radio/checkbox：从 options 列表中选取最合理的选项。option 必须是 options 中的原文字，禁止修改或添加说明。
- 只返回 JSON 数组，不要解释，不要 markdown 代码块。

{_rules}'''


def _llm_generate_values(llm, items, form_rules=None, case_data_store=None,
                         instruction="生成合理的测试数据"):
    """Generate values for form fields with three-tier priority:
    1. User-provided data (from case_data_store)
    2. form_rules.py generators — match_rule() for input/date fields
    3. LLM autonomous decision — for remaining fields (select picks from options, input generates smart values)
    """
    actions = []
    llm_fields = []

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
                    actions.append({'action': 'select_option', 'label': label, 'option': val})
                    continue
            else:
                actions.append({'action': 'fill_input', 'label': label, 'value': val})
                continue

        # —— Priority 2: form_rules.py generators (input only) ——
        if kind == 'input' and form_rules:
            generated = match_rule(label, form_rules)
            if generated:
                actions.append({'action': 'fill_input', 'label': label, 'value': generated})
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
                actions.append({'action': 'select_option', 'label': label, 'option': picked or '测试'})
            elif kind == 'tree-select':
                # Tree-select needs tree navigation via JS_SELECT_TREE_OPTION.
                # Use 'first' as a reasonable default — the tree handler will
                # pick the first matching/visible node.
                actions.append({'action': 'fill_tree', 'label': label, 'value': 'first'})
            elif kind == 'date':
                actions.append({'action': 'fill_input', 'label': label, 'value': _date_val})
            else:
                actions.append({'action': 'fill_input', 'label': label, 'value': label[:6] + '_TEST'})
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
        return actions + llm_result  # P1+P2 + LLM result
    except Exception:
        # Fallback — preserve P1+P2 actions, fill remaining with defaults
        for item in llm_fields:
            label = item['label'] if isinstance(item, dict) else item
            kind = item.get('kind', 'input') if isinstance(item, dict) else 'input'
            if kind == 'select':
                opts = item.get('options', []) if isinstance(item, dict) else []
                actions.append({'action': 'select_option', 'label': label, 'option': opts[0] if opts else '测试'})
            else:
                actions.append({'action': 'fill_input', 'label': label, 'value': label[:6] + '_TEST'})
        return actions
