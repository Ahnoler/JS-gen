"""
Recording hooks for browser-use agent: step callbacks, goal dedup detection, cancel signal,
premature done() prevention, and human intervention injection.
"""
import sys
import json
import uuid
import re
import time
from pathlib import Path
from langchain_core.messages import HumanMessage
from .agent_utils import emit_json


# ========================== ATP Trajectory Recording ==========================
# Records ALL agent actions (including internal/exploratory ones) in atp-record format.
# The raw trajectory preserves every step so an LLM can later deduplicate and build a clean script.

_ATP_TRAJECTORY = []


def _parse_action_to_entry(action_str, result_str, url):
    """Parse a single action string into an atp-record trajectory entry.
    
    Action string examples:
        fill_form_field={'label_text': 'xxx', 'value': 'xxx'}  → command: input
        click_element_by_index={'index': 113}                   → command: click
        select_option={'label_text': 'xxx', 'option_text': 'xxx'} → command: select
        scroll_down={'amount': 300}                             → command: scroll
        scroll_up={'amount': 300}                               → command: scroll
        done={'text': '...', 'success': True}                   → command: done
        wait={'timeout': 3000}                                  → command: wait
        search_google=None                                       → command: search
        go_to_url={'url': '...'}                                 → command: navigate
        go_back=None                                              → command: go_back
        get_page_state=None                                      → command: diagnose
        scan_form_fields=None                                    → command: diagnose
        save_case_data={'key': 'x', 'value': 'y'}                → command: save_data
        read_case_data={'key': 'x'}                               → command: read_data
    """
    entry = {
        'id': str(uuid.uuid4()),
        'command': 'unknown',
        'target': action_str[:200],
        'targetType': 'action',
        'tagName': '',
        'propertiesName': '',
        'attributes': {},
        'timestamp': int(time.time() * 1000),
        'type': 'AGENT_ACTION',
        'value': result_str[:300] if result_str else '',
    }
    
    if not action_str:
        return entry
    
    # Extract action name and params from string like "action_name={'key': 'val'}"
    m = re.match(r'(\w+)(?:=|$)', action_str)
    action_name = m.group(1) if m else ''
    entry['tagName'] = action_name
    
    # Map action name to command
    name_to_cmd = {
        'fill_form_field': 'input',
        'fill_date_field': 'input',
        'input_text': 'input',
        'select_option': 'select',
        'select_dropdown_option': 'select',
        'click_element_by_index': 'click',
        'click_element': 'click',
        'click_menu_item': 'click',
        'click_table_row_action': 'click',
        'click_adjacent_button': 'click',
        'click_radio': 'click',
        'go_to_url': 'navigate',
        'go_back': 'go_back',
        'scroll_down': 'scroll',
        'scroll_up': 'scroll',
        'wait_for_loading': 'wait',
        'wait': 'wait',
        'done': 'done',
        'search_google': 'search',
        'get_page_state': 'diagnose',
        'scan_form_fields': 'diagnose',
        'scan_visible_fields': 'diagnose',
        'check_field_value': 'diagnose',
        'verify_field_value': 'diagnose',
        'save_case_data': 'save_data',
        'read_case_data': 'read_data',
        'expand_all_el_tree': 'expand',
        'close_notification': 'close',
        'close_dialog': 'close',
        'switch_tab': 'tab',
        'take_screenshot': 'screenshot',
        'task_done': 'task',
        'task_retry': 'task',
        'get_pending_tasks': 'diagnose',
        'sync_tasks_from_errors': 'diagnose',
        'init_task_list': 'diagnose',
        'fill_form_fields_batch': 'batch',
        'fill_pending_batch': 'batch',
        'match_form_rule': 'generate',
    }
    entry['command'] = name_to_cmd.get(action_name, action_name)
    
    # For fill/select actions, extract label and value as propertiesName
    if action_name in ('fill_form_field', 'fill_date_field', 'fill'):
        params_match = re.search(r"'label_text':\s*'([^']*)'", action_str)
        if params_match:
            entry['propertiesName'] = params_match.group(1)
        val_match = re.search(r"'value':\s*'([^']*)'", action_str)
        if val_match:
            entry['value'] = val_match.group(1)[:300]
    elif action_name == 'select_option':
        params_match = re.search(r"'label_text':\s*'([^']*)'", action_str)
        if params_match:
            entry['propertiesName'] = params_match.group(1)
        opt_match = re.search(r"'option_text':\s*'([^']*)'", action_str)
        if opt_match:
            entry['value'] = opt_match.group(1)[:300]
    elif action_name in ('click_menu_item', 'click_adjacent_button'):
        m2 = re.search(r"'([^']*)'", action_str)
        if m2:
            entry['propertiesName'] = m2.group(1)[:100]
    elif action_name == 'click_table_row_action':
        m2 = re.search(r"'([^']*)'.*'([^']*)'", action_str)
        if m2:
            entry['propertiesName'] = (m2.group(1) + ' → ' + m2.group(2))[:100]
    elif action_name == 'go_to_url':
        m2 = re.search(r"'url':\s*'([^']*)'", action_str)
        if m2:
            entry['value'] = m2.group(1)[:300]
    elif action_name == 'click_element_by_index':
        idx_match = re.search(r"'index':\s*(\d+)", action_str)
        if idx_match:
            entry['propertiesName'] = 'index:' + idx_match.group(1)
    
    # Extract URL from result if available
    if url:
        entry['target'] = url[:500]
    
    return entry


def build_recording_hooks(goal_tracker=None, cancel_flag_path=None, intervention_queue=None):
    """Build hooks with goal dedup detection, cancel signal, and intervention support."""
    if goal_tracker is None:
        goal_tracker = {'goals': [], 'stopped': False}

    async def on_step_start(agent):
        sys.stderr.write(f"[on_step_start]\t n_steps={agent.state.n_steps}\n"); sys.stderr.flush()
        # Check for human intervention before proceeding
        if intervention_queue is not None:
            try:
                while not intervention_queue.empty():
                    instruction = intervention_queue.get_nowait()
                    msg = HumanMessage(content=f'[HUMAN INTERVENTION] {instruction}\n\nPause your current plan and follow this new instruction first. After completing it, resume the original task.')
                    agent._message_manager._add_message_with_tokens(msg)
                    sys.stderr.write(f"[recorder] Injected human intervention: {instruction[:100]}\n")
                    sys.stderr.flush()
            except Exception as e:
                sys.stderr.write(f"[recorder] Intervention error: {e}\n")
                sys.stderr.flush()

    async def on_step_end(agent):
        _done = agent.state.history.is_done() if agent.state.history else False
        _stopped = agent.state.stopped
        _last_result = agent.state.last_result
        _last_result_str = str(_last_result)[:300] if _last_result else 'None'
        _model_out = agent.state.history.history[-1].model_output if agent.state.history and agent.state.history.history else None
        _next_goal = getattr(getattr(_model_out, 'current_state', None), 'next_goal', '') if _model_out else ''
        _actions = [str(a)[:100] for a in (getattr(_model_out, 'action', []) or [])] if _model_out else []
        sys.stderr.write(f"[on_step_end]\t n_steps={agent.state.n_steps} is_done={_done} stopped={_stopped}\n")
        sys.stderr.write(f"[next_goal]\t {_next_goal[:150]}\n")
        sys.stderr.write(f"[actions]\t {_actions}\n")
        sys.stderr.write(f"[last_result]\t {_last_result_str}\n")
        sys.stderr.flush()

        # ===== Record ALL actions to atp-format trajectory =====
        try:
            url = ''
            try:
                s = agent.state.history.history[-1].state if agent.state.history and agent.state.history.history else None
                if s:
                    url = getattr(s, 'url', '') or (s.get('url') if isinstance(s, dict) else '')
            except:
                pass
            for act_str in _actions:
                entry = _parse_action_to_entry(act_str, _last_result_str, url)
                _ATP_TRAJECTORY.append(entry)
        except Exception as _ae:
            sys.stderr.write(f"[recorder] Trajectory record error: {_ae}\n")
            sys.stderr.flush()
        # ===== End trajectory recording =====

        # Check cancel signal before any processing
        if cancel_flag_path is not None and cancel_flag_path.exists():
            sys.stderr.write("[recorder] Cancel signal received, stopping agent\n")
            sys.stderr.flush()
            agent.state.stopped = True
            try: cancel_flag_path.unlink(missing_ok=True)
            except: pass
            return

        if goal_tracker['stopped']:
            return

        # ===== Prevent premature done() =====
        # If the agent calls done() while a dialog/drawer is still open,
        # clear the is_done flag so the agent continues working.
        if _done:
            try:
                page = await agent.browser_context.get_current_page()
                has_open_dialog = await page.evaluate('''() => {
                    const dialogs = document.querySelectorAll('.el-dialog');
                    const drawers = document.querySelectorAll('.el-drawer');
                    return [...dialogs, ...drawers].some(d => d.offsetParent !== null);
                }''')
                if has_open_dialog:
                    sys.stderr.write(f"[recorder] ⚠ Premature done() detected — dialog still open at step {agent.state.n_steps}, forcing continue\n")
                    sys.stderr.flush()
                    # Clear is_done and inject error to force continuation
                    for h in agent.state.history.history:
                        if h.result:
                            for r in h.result:
                                r.is_done = False
                                r.error = 'Premature done() rejected: dialog still open. Continue filling form and click submit.'
                    return
                # Also check if page has visible notifications or form errors
                has_pending = await page.evaluate('''() => {
                    const notifs = document.querySelectorAll('.el-notification');
                    const errors = document.querySelectorAll('.el-form-item__error');
                    return (notifs.length > 0 || errors.length > 0) ? 'pending' : 'none';
                }''')
                if has_pending == 'pending' or _next_goal in ('', 'Task is done - call done()'):
                    sys.stderr.write(f"[recorder] ⚠ Premature done() detected — pending errors/notifications at step {agent.state.n_steps}, forcing continue\n")
                    sys.stderr.flush()
                    for h in agent.state.history.history:
                        if h.result:
                            for r in h.result:
                                r.is_done = False
                                r.error = 'Premature done() rejected: validation errors remain. Fix fields and click submit.'
                    return
            except Exception as e:
                sys.stderr.write(f"[recorder] done-check error: {e}\n")
                sys.stderr.flush()

        try:
            step_num = agent.state.n_steps
            if step_num % 5 == 0:
                sys.stderr.write(f"[recorder] step {step_num} done\n")
                sys.stderr.flush()

            # Goal dedup detection
            try:
                history = agent.state.history.history
                if len(history) >= 2:
                    last = history[-1]
                    prev = history[-2]
                    last_goal = (getattr(getattr(last.model_output, 'current_state', None), 'next_goal', '') or '')
                    prev_goal = (getattr(getattr(prev.model_output, 'current_state', None), 'next_goal', '') or '')
                    if last_goal and last_goal == prev_goal:
                        goal_tracker['goals'].append(last_goal)
                    else:
                        goal_tracker['goals'] = []
                    if len(goal_tracker['goals']) >= 3:
                        goal_tracker['stopped'] = True
                        sys.stderr.write(f"[recorder] Repeated goal detected ({len(goal_tracker['goals'])}x): {last_goal[:80]}...\n")
                        sys.stderr.write(f"[recorder] Stopping agent at step {step_num}\n")
                        sys.stderr.flush()
                        agent.state.stopped = True
                        return
            except Exception:
                pass

        except Exception as e:
            sys.stderr.write(f"[recorder] on_step_end error: {e}\n")
            sys.stderr.flush()

    return on_step_start, on_step_end
