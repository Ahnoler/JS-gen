"""Pin the recording side path: gate sentence, vision parse, click veto budget."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def main() -> int:
    from scripts.agent.record_sidepath import (
        click_already_judged,
        click_needs_vision,
        click_veto_open,
        format_gate_line,
        fresh_dialog_title,
        note_click_veto,
        parse_click_vision,
        parse_done_vision,
        remember_click_judgement,
    )
    from scripts.agent.record_vision import model_blocks_vision, _get_vision_llm
    from scripts.feature_flags import (
        dotenv_value,
        record_gate_cue_enabled,
        record_vision_enabled,
        record_vision_llm_config,
    )

    assert_true(format_gate_line(None) == '', 'no store')
    assert_true(format_gate_line({'_heal_mode': True, '_phase_intent': {'mode': 'create'}}) == '', 'heal silent')
    assert_true(format_gate_line({}) == '', 'no contract')

    pending = {
        '_phase_intent': {
            'mode': 'create',
            'refill': 'all_editable',
            'submit': {'required': True},
            'success': {'kinds': ['toast_ok']},
            'out_of_scope': '审批',
        },
        'task_list': {
            'pending': [{'label': '利率'}],
            'done': [{'label': '期限'}],
        },
    }
    line = format_gate_line(pending)
    assert_true(line.startswith('[门禁] 还不能结束。'), line)
    assert_true('利率' in line, line)
    assert_true('不要做：审批' in line, line)
    assert_true('可以 done' not in line, line)

    ready = {
        '_phase_intent': {
            'mode': 'create',
            'submit': {'required': True},
            'success': {'kinds': ['toast_ok']},
        },
        '_last_save_ok': True,
    }
    ready_line = format_gate_line(ready)
    assert_true('门禁已满足，可以 done(success=true)' in ready_line, ready_line)

    open_phase = {'_phase_intent': {'mode': 'navigate', 'submit': {'required': False}}}
    open_line = format_gate_line(open_phase)
    assert_true('是否结束以阶段任务为准' in open_line, open_line)
    assert_true('可以 done' not in open_line, open_line)

    elements = [{'index': 1, 'text': '保存'}, {'index': 2, 'text': '保存'}, {'index': 3, 'text': ''}]
    assert_true(click_needs_vision('fill_form_field', '保存', elements, '') == '', 'fill is not a click')
    assert_true(click_needs_vision('click_button', '保存', elements, '') == 'ambiguous', 'two 保存')
    assert_true(click_needs_vision('click_element_by_index', '', elements, '') == 'icon', 'no text')
    assert_true(
        click_needs_vision('click_button', '查询', [{'index': 1, 'text': '查询'}], '') == '',
        'unique label runs',
    )
    assert_true(
        click_needs_vision('click_button', '不存在', [{'index': 1, 'text': '查询'}], '') == 'missing',
        'label absent',
    )
    assert_true(
        click_needs_vision('click_button', '查询', elements, '选择客户') == 'dialog',
        'new dialog',
    )

    store = {'_step_feedback': [{'step': 4, 'items': [{'kind': 'dialog', 'text': '选择客户'}]}]}
    assert_true(fresh_dialog_title(store) == '选择客户', 'dialog once')
    store['_vision_dialog_step'] = 4
    assert_true(fresh_dialog_title(store) == '', 'dialog consumed')

    budget = {}
    assert_true(click_veto_open(budget, 1), 'budget starts open')
    note_click_veto(budget)
    note_click_veto(budget)
    assert_true(not click_veto_open(budget, 1), 'two vetoes close the phase')
    assert_true(click_veto_open(budget, 2), 'next phase reopens')
    remember_click_judgement(budget, 'k')
    assert_true(click_already_judged(budget, 2, 'k'), 'same picture is not asked twice')

    assert_true(parse_done_vision('{"error_visible": true, "what": "利率不能为空"}') == '利率不能为空', 'done error')
    assert_true(parse_done_vision('{"error_visible": false, "what": "利率不能为空"}') == '', 'done clean')
    assert_true(parse_done_vision('{"error_visible": true, "what": ""}') == '', 'done needs a sentence')
    assert_true(parse_done_vision('not json') == '', 'done garbage')
    assert_true(parse_click_vision('{"allow": false, "instead": "查询"}') == '查询', 'veto names text')
    assert_true(parse_click_vision('{"allow": false, "instead": ""}') == '', 'veto needs text')
    assert_true(parse_click_vision('{"allow": true}') == '', 'allow')
    assert_true(parse_click_vision('不确定') == '', 'uncertain does not veto')

    assert_true(model_blocks_vision('deepseek-chat'), 'deepseek')
    assert_true(model_blocks_vision('grok-2'), 'grok')
    assert_true(not model_blocks_vision('GLM-5'), 'other models can be probed')

    saved_gate = os.environ.get('AI_RECORD_GATE_CUE')
    saved_vision = os.environ.get('AI_RECORD_VISION')
    try:
        os.environ.pop('AI_RECORD_GATE_CUE', None)
        os.environ.pop('AI_RECORD_VISION', None)
        assert_true(record_gate_cue_enabled(), 'gate default on')
        assert_true(record_vision_enabled(), 'vision default on')
        os.environ['AI_RECORD_VISION'] = '0'
        assert_true(not record_vision_enabled(), 'vision off')
        os.environ['AI_RECORD_VISION'] = 'false'
        assert_true(not record_vision_enabled(), 'vision false')
        os.environ.pop('AI_RECORD_VISION', None)
        sample = (ROOT / 'config' / '.env.example').read_text(encoding='utf-8')
        active = [
            line.strip() for line in sample.splitlines()
            if line.strip().startswith('AI_RECORD_VISION=')
        ]
        assert_true(active == ['AI_RECORD_VISION=true'], f'config switch {active}')
        sample_text = "# AI_RECORD_VISION=true\nAI_RECORD_VISION=false\n"
        assert_true(dotenv_value(sample_text, 'AI_RECORD_VISION') == 'false', 'file wins over comment')
        assert_true(dotenv_value('AI_RECORD_VISION=0\n', 'AI_RECORD_VISION') == '0', 'zero is a value')
        assert_true(dotenv_value('', 'AI_RECORD_VISION') is None, 'missing key')
    finally:
        if saved_gate is None:
            os.environ.pop('AI_RECORD_GATE_CUE', None)
        else:
            os.environ['AI_RECORD_GATE_CUE'] = saved_gate
        if saved_vision is None:
            os.environ.pop('AI_RECORD_VISION', None)
        else:
            os.environ['AI_RECORD_VISION'] = saved_vision

    service = (ROOT / 'scripts/agent/service.py').read_text(encoding='utf-8')
    agent_block = service.split('agent = Agent(', 1)[1][:700]
    assert_true('use_vision=False' in agent_block, 'main agent stays text-only')
    assert_true('install_click_vision_veto(agent, business_data_ref)' in service, 'veto wraps multi_act')
    recorder = (ROOT / 'scripts/recorder.py').read_text(encoding='utf-8')
    assert_true('emit_gate_cue(agent, business_data_store)' in recorder, 'gate cue at step start')
    emitters = (ROOT / 'scripts/agent/recorder_emitters.py').read_text(encoding='utf-8')
    assert_true('reject_done_if_viewport_error' in emitters, 'done vision after gates')
    prompt = (ROOT / 'scripts/prompts/agent-core.md').read_text(encoding='utf-8')
    assert_true('[门禁]' in prompt and '[识图]' in prompt, 'prompt names both cues')
    side = (ROOT / 'scripts/agent/record_sidepath.py').read_text(encoding='utf-8')
    assert_true('ActionResult(extracted_content=message, include_in_memory=True)' in side, 'veto does not call the controller')

    saved_vlm = {k: os.environ.get(k) for k in (
        'AI_RECORD_VISION_LLM_MODEL', 'AI_RECORD_VISION_LLM_BASE_URL',
        'AI_RECORD_VISION_LLM_API_KEY', 'AI_RECORD_VISION_LLM_TIMEOUT_MS')}
    try:
        for k in saved_vlm:
            os.environ.pop(k, None)
        assert_true(record_vision_llm_config() == {}, 'vision llm config unset')
        sentinel = object()
        got, ask_t = _get_vision_llm(sentinel)
        assert_true(got is sentinel, 'vision falls back to agent llm')
        assert_true(abs(ask_t - 20.0) < 1e-9, 'vision ask timeout default 20s')
        os.environ['AI_RECORD_VISION_LLM_MODEL'] = 'vision-x'
        os.environ['AI_RECORD_VISION_LLM_TIMEOUT_MS'] = '8000'
        cfg = record_vision_llm_config()
        assert_true(cfg['model'] == 'vision-x' and cfg['timeout_ms'] == 8000.0, 'vision llm dedicated config')
        got2, ask_t2 = _get_vision_llm(sentinel)
        assert_true(got2 is not sentinel and getattr(got2, 'model_name', '') == 'vision-x', 'dedicated instance')
        assert_true(abs(ask_t2 - 8.0) < 1e-9, 'dedicated ask timeout follows key')
    finally:
        for k, v in saved_vlm.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        import scripts.agent.record_vision as _rv
        _rv.reset_vision_probe_for_tests()

    print('characterize-record-sidepath: OK')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
