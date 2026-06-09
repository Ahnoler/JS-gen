"""
Recording hooks for browser-use agent: step callbacks, goal dedup detection, cancel signal,
and premature done() prevention.
"""
import sys
import json
from pathlib import Path
from .agent_utils import emit_json


def build_recording_hooks(goal_tracker=None, cancel_flag_path=None):
    """Build hooks with goal dedup detection and cancel signal."""
    if goal_tracker is None:
        goal_tracker = {'goals': [], 'stopped': False}

    async def on_step_start(agent):
        sys.stderr.write(f"[recorder] on_step_start n_steps={agent.state.n_steps}\n"); sys.stderr.flush()

    async def on_step_end(agent):
        _done = agent.state.history.is_done() if agent.state.history else False
        _stopped = agent.state.stopped
        _last_result = agent.state.last_result
        _last_result_str = str(_last_result)[:300] if _last_result else 'None'
        _model_out = agent.state.history.history[-1].model_output if agent.state.history and agent.state.history.history else None
        _next_goal = getattr(getattr(_model_out, 'current_state', None), 'next_goal', '') if _model_out else ''
        _actions = [str(a)[:100] for a in (getattr(_model_out, 'action', []) or [])] if _model_out else []
        sys.stderr.write(f"[recorder] on_step_end n_steps={agent.state.n_steps} is_done={_done} stopped={_stopped}\n")
        sys.stderr.write(f"[recorder]   next_goal={_next_goal[:150]}\n")
        sys.stderr.write(f"[recorder]   actions={_actions}\n")
        sys.stderr.write(f"[recorder]   last_result={_last_result_str}\n")
        sys.stderr.flush()
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
