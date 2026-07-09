"""
Recording hooks for browser-use agent: step callbacks, goal dedup detection, cancel signal,
premature done() prevention, and human intervention injection.
"""
import json
import sys
from langchain_core.messages import HumanMessage
from . import controller as ctrl_mod


# ========================== Operation Log (plain text, for LLM context) ==========================
# Each line records one agent step: step#, goal, actions, result.
# NOT used for script generation — only for LLM reference.
_ACTION_LOG = []


def build_recording_hooks(goal_tracker=None, cancel_flag_path=None, intervention_queue=None, case_data_store=None):
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

        # Check for self-requested intervention from form auto-fill or sync_tasks_from_errors
        if case_data_store is not None:
            intervention_queue_list = case_data_store.pop('_intervention_queue', None)
            if intervention_queue_list is not None and len(intervention_queue_list) > 0:
                labels = [r.get('label', '') for r in intervention_queue_list]
                has_buttons = [r.get('hasButton', '') for r in intervention_queue_list]
                reasons = [r.get('reason', '') for r in intervention_queue_list]

                # Build a single merged message with all intervention fields
                field_list = '\n'.join(
                    f'  {i+1}. "{labels[i]}" — button: "{has_buttons[i]}"'
                    for i in range(len(labels))
                )
                msg_text = (
                    f'[HUMAN INTERVENTION - FIELD(S) NEED SPECIAL WORKFLOW]\n'
                    f'The following {len(labels)} field(s) are disabled but have adjacent action buttons:\n'
                    f'{field_list}\n\n'
                    f'ACTIONS:\n'
                    f'1. Skip these fields for now — do NOT try fill_form_field on them (will return field-disabled).\n'
                    f'2. Continue filling other fillable fields and complete everything else.\n'
                    f'3. When all other fields are done, call done() and report: '
                    f'"Fields {labels} require a special fill workflow. '
                    f'Please design the workflow so I can complete them."\n'
                    f'4. Wait for the user to provide the workflow design before attempting these fields.\n'
                    f'5. After the user provides the workflow, follow the user\'s instructions to fill each field.'
                )
                msg = HumanMessage(content=msg_text)
                agent._message_manager._add_message_with_tokens(msg)
                sys.stderr.write(f'[recorder] Injected self-requested intervention for: {labels}\n')
                sys.stderr.flush()

    async def on_step_end(agent):
        _done = agent.state.history.is_done() if agent.state.history else False
        _stopped = agent.state.stopped
        _last_result = agent.state.last_result
        _last_result_str = str(_last_result) if _last_result else 'None'
        _model_out = agent.state.history.history[-1].model_output if agent.state.history and agent.state.history.history else None
        _next_goal = getattr(getattr(_model_out, 'current_state', None), 'next_goal', '') if _model_out else ''
        _actions_raw = (getattr(_model_out, 'action', []) or []) if _model_out else []
        _actions = []
        for a in _actions_raw:
            try:
                d = a.model_dump() if hasattr(a, 'model_dump') else (a.dict() if hasattr(a, 'dict') else vars(a))
                active = {k: v for k, v in d.items() if v is not None}
                _actions.append(json.dumps(active, ensure_ascii=False, default=str))
            except Exception:
                _actions.append(str(a))
        sys.stderr.write(f"[on_step_end]\t n_steps={agent.state.n_steps} is_done={_done} stopped={_stopped}\n")
        sys.stderr.write(f"[next_goal]\t {_next_goal}\n")
        if _actions:
            sys.stderr.write(f"[actions]\t {', '.join(_actions)}\n")
        else:
            sys.stderr.write(f"[actions]\t []\n")
        sys.stderr.write(f"[last_result]\t {_last_result_str}\n")
        sys.stderr.flush()

        # ===== Capture page URL from agent state =====
        try:
            _last_state = agent.state.history.history[-1].state if agent.state.history and agent.state.history.history else None
            if _last_state:
                _url = getattr(_last_state, 'url', '') or (_last_state.get('url') if isinstance(_last_state, dict) else '')
                if _url and _url != 'about:blank' and not _url.startswith('devtools://'):
                    ctrl_mod._TRAJECTORY_URL = _url
        except Exception:
            pass
        # ===== End URL capture =====

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

            # Write operation log line (plain text, for LLM context)
            try:
                log_line = (
                    f"[{step_num}] "
                    f"goal: {_next_goal[:80] if _next_goal else '-'} | "
                    f"actions: {'; '.join(_actions) if _actions else '-'} | "
                    f"result: {_last_result_str[:120]}"
                )
                _ACTION_LOG.append(log_line)
            except Exception:
                pass

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
