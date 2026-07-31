"""
Recording hooks for browser-use agent: step callbacks, goal dedup detection, cancel signal,
premature done() prevention, and human intervention injection.
"""
import json
import re
import sys
from langchain_core.messages import HumanMessage
from . import controller as ctrl_mod
from .actions._js_snippets import JS_SMART_LOCATOR


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
        # Honor cancel before starting another LLM/action cycle
        if cancel_flag_path is not None and cancel_flag_path.exists():
            sys.stderr.write("[recorder] Cancel signal on step start — stopping agent\n")
            sys.stderr.flush()
            agent.state.stopped = True
            if goal_tracker is not None:
                goal_tracker['stopped'] = True
            try:
                cancel_flag_path.unlink(missing_ok=True)
            except Exception:
                pass
            return
        if goal_tracker is not None and goal_tracker.get('stopped'):
            agent.state.stopped = True
            return
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
                    f'ACTIONS (in order):\n'
                    f'1. Do NOT re-select or re-fill already-completed fields.\n'
                    f'2. FIRST call click_save(). If ok-save-success (操作成功), call done(success=true).\n'
                    f'3. If err-save-validation on these fields: use click_adjacent_button '
                    f'(e.g. 引入/联网核查) for each, wait_for_loading, then click_save() again.\n'
                    f'4. Only if still blocked after trying adjacent buttons, call done() and report: '
                    f'"Fields {labels} require a special fill workflow."\n'
                    f'5. After the user provides a workflow, follow it, then task_done + click_save().'
                )
                msg = HumanMessage(content=msg_text)
                agent._message_manager._add_message_with_tokens(msg)
                sys.stderr.write(f'[recorder] Injected self-requested intervention for: {labels}\n')
                sys.stderr.flush()

            # After auto-fill / empty pending: force agent toward 保存 instead of re-filling
            if case_data_store.get('_submit_ready'):
                case_data_store['_submit_ready'] = False
                msg = HumanMessage(content=(
                    '[SYSTEM] Fillable form fields are done (pending≈0).\n'
                    'NEXT_ACTION: Call click_save() NOW (finds 保存/提交 and scrolls into view).\n'
                    'Do NOT scroll_down / scroll_up hunting for 保存.\n'
                    'Do NOT call select_option / fill_form_field on fields that already have values.\n'
                    'If 联网核查结果 is required and empty, click_adjacent_button(联网核查) first, '
                    'wait_for_loading, then click_save().\n'
                    'click_save() returns ok-save-success only when 操作成功 toast appears — '
                    'then done(success=true). err-save-validation / err-save-no-feedback = NOT success.'
                ))
                agent._message_manager._add_message_with_tokens(msg)
                sys.stderr.write('[recorder] Injected submit-ready cue\n')
                sys.stderr.flush()
            # Break already-matched re-select loops
            streak = int(case_data_store.get('_already_matched_streak', 0) or 0)
            if streak >= 3:
                case_data_store['_already_matched_streak'] = 0
                msg = HumanMessage(content=(
                    f'[SYSTEM] You received already-matched {streak}+ times in a row. '
                    f'STOP re-selecting fields. Call click_save() immediately. '
                    f'Only fix fields that sync_tasks_from_errors / formErrors / err-save-validation report.'
                ))
                agent._message_manager._add_message_with_tokens(msg)
                sys.stderr.write(f'[recorder] Injected already-matched loop break (streak={streak})\n')
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
        # Only block done() when something VISIBLE still blocks the phase goal
        # (open dialog/drawer, visible validation errors, or error notifications).
        # Do NOT count hidden DOM leftovers — Element UI keeps .el-form-item__error
        # / .el-notification nodes in the tree after navigation, which previously
        # caused false "pending errors" and forced the agent to keep filling the
        # NEXT page after a successful create→navigate.
        if _done:
            try:
                page = await agent.browser_context.get_current_page()
                # Prefer explicit success from the done() action
                done_success = False
                try:
                    for r in (_last_result or []):
                        if getattr(r, 'success', None) is True:
                            done_success = True
                            break
                        text = (getattr(r, 'extracted_content', None) or '') + (getattr(r, 'error', None) or '')
                        if 'success": true' in text.lower() or 'success=true' in text.lower():
                            done_success = True
                            break
                except Exception:
                    pass

                # Give brief settle time if loading mask is up (post-save navigation)
                try:
                    await page.evaluate('''() => new Promise(resolve => {
                        let n = 0;
                        const tick = () => {
                            const mask = document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)');
                            const visible = mask && mask.offsetParent !== null;
                            if (!visible || n > 25) return resolve();
                            n += 1;
                            setTimeout(tick, 200);
                        };
                        tick();
                    })''')
                except Exception:
                    pass

                block = await page.evaluate('''() => {
                    const isVisible = (el) => {
                        if (!el) return false;
                        const style = getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
                            return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    };
                    // Visible dialog / drawer (not just offsetParent — fixed wrappers)
                    let openOverlay = null;
                    for (const d of document.querySelectorAll('.el-dialog')) {
                        const wrap = d.closest('.el-dialog__wrapper') || d;
                        if (isVisible(wrap) && isVisible(d)) {
                            const title = (d.querySelector('.el-dialog__title')?.textContent || '').trim();
                            openOverlay = 'dialog:' + (title || 'unnamed');
                            break;
                        }
                    }
                    if (!openOverlay) {
                        for (const d of document.querySelectorAll('.el-drawer')) {
                            const wrap = d.closest('.el-drawer__wrapper') || d;
                            if (isVisible(wrap) && isVisible(d)) {
                                const label = d.getAttribute('aria-label') || 'unnamed';
                                openOverlay = 'drawer:' + label;
                                break;
                            }
                        }
                    }
                    // Visible ERROR notifications only (ignore 成功/完成 success toasts)
                    const errorNotifs = [];
                    for (const el of document.querySelectorAll('.el-notification')) {
                        if (!isVisible(el)) continue;
                        const t = (el.textContent || '').replace(/\\s+/g, ' ').trim();
                        if (!t) continue;
                        if (/成功|完成|已保存|提交成功/.test(t) && !/失败|错误|不成功/.test(t))
                            continue;
                        errorNotifs.push(t.slice(0, 120));
                    }
                    // Visible form validation errors with non-empty text
                    const formErrors = [];
                    for (const el of document.querySelectorAll('.el-form-item__error')) {
                        if (!isVisible(el)) continue;
                        const t = (el.textContent || '').trim();
                        if (t) formErrors.push(t.slice(0, 80));
                    }
                    return {
                        openOverlay,
                        errorNotifs,
                        formErrors,
                        url: location.href,
                    };
                }''')

                open_overlay = (block or {}).get('openOverlay')
                error_notifs = (block or {}).get('errorNotifs') or []
                form_errors = (block or {}).get('formErrors') or []
                cur_url = (block or {}).get('url') or ''

                save_ok = bool(case_data_store and case_data_store.get('_last_save_ok'))
                url_before_save = (case_data_store or {}).get('_url_before_save') or ''
                url_changed = bool(url_before_save and cur_url and url_before_save != cur_url)

                # Navigation success only if URL actually changed after save (not already-on-detail)
                navigated_ok = bool(
                    done_success
                    and url_changed
                    and (
                        'cstNo=' in cur_url
                        or 'viewType=add' in cur_url
                        or 'mdfIdcstInf' in cur_url
                        or 'HostCstmgrMdf' in cur_url
                    )
                )

                # Extract done() text for claim checks
                done_text = ''
                try:
                    for r in (_last_result or []):
                        done_text += (getattr(r, 'extracted_content', None) or '') + ' '
                except Exception:
                    pass
                claims_save_ok = bool(
                    done_success
                    and re.search(
                        r'操作成功|保存成功|提交成功|已成功保存|成功填写并保存|无错误通知',
                        done_text or '',
                    )
                )

                # Claiming save success without ok-save-success / real post-save navigation
                if claims_save_ok and not save_ok and not navigated_ok:
                    sys.stderr.write(
                        f"[recorder] ⚠ Premature done() — claimed save success without "
                        f"ok-save-success / URL change at step {agent.state.n_steps}, forcing continue\n"
                    )
                    sys.stderr.flush()
                    for h in agent.state.history.history:
                        if h.result:
                            for r in h.result:
                                r.is_done = False
                                r.error = (
                                    'Premature done() rejected: no 操作成功 observed. '
                                    'Call click_save(); only done(success=true) after ok-save-success. '
                                    'no-notification / no error toast is NOT success.'
                                )
                                try:
                                    from scripts.feature_flags import memory_whitelist_enabled
                                    if memory_whitelist_enabled():
                                        r.include_in_memory = True
                                except Exception:
                                    pass
                    return

                if open_overlay and not navigated_ok and not save_ok:
                    sys.stderr.write(
                        f"[recorder] ⚠ Premature done() — visible overlay {open_overlay} "
                        f"at step {agent.state.n_steps}, forcing continue\n"
                    )
                    sys.stderr.flush()
                    for h in agent.state.history.history:
                        if h.result:
                            for r in h.result:
                                r.is_done = False
                                r.error = (
                                    f'Premature done() rejected: {open_overlay} still open. '
                                    f'Finish or close it, then click submit / call done() again.'
                                )
                                try:
                                    from scripts.feature_flags import memory_whitelist_enabled
                                    if memory_whitelist_enabled():
                                        r.include_in_memory = True
                                except Exception:
                                    pass
                    return

                if (error_notifs or form_errors) and not navigated_ok and not save_ok:
                    sys.stderr.write(
                        f"[recorder] ⚠ Premature done() — visible errors at step {agent.state.n_steps}: "
                        f"notifs={error_notifs[:2]} formErrors={form_errors[:3]}, forcing continue\n"
                    )
                    sys.stderr.flush()
                    for h in agent.state.history.history:
                        if h.result:
                            for r in h.result:
                                r.is_done = False
                                r.error = (
                                    'Premature done() rejected: visible validation errors remain. '
                                    f'Errors={form_errors[:3] or error_notifs[:2]}. '
                                    f'Fix fields then call click_save() again.'
                                )
                                try:
                                    from scripts.feature_flags import memory_whitelist_enabled
                                    if memory_whitelist_enabled():
                                        r.include_in_memory = True
                                except Exception:
                                    pass
                    return

                if navigated_ok or save_ok:
                    reason = 'save-ok' if save_ok else 'navigation'
                    sys.stderr.write(
                        f"[recorder] ✓ done() accepted after {reason} "
                        f"(success={done_success}) at step {agent.state.n_steps}\n"
                    )
                    sys.stderr.flush()
                    # Clear stale task_list so the next phase starts clean
                    if case_data_store is not None:
                        case_data_store.pop('task_list', None)
                        case_data_store.pop('_scan_fields', None)
                        case_data_store.pop('_submit_ready', None)
                        case_data_store.pop('_autofill_summary', None)
                        case_data_store.pop('_last_save_ok', None)
                        case_data_store.pop('_url_before_save', None)
                # else: no visible blockers — allow done() (including success=false reports)

                # Persist done() outcome for next-phase business-scenario preamble
                if case_data_store is not None:
                    try:
                        from .actions import _state as action_state
                        from .actions._phase_context import record_phase_outcome
                        record_phase_outcome(
                            case_data_store,
                            action_state._CURRENT_PHASE,
                            success=done_success,
                            text=done_text or '',
                        )
                        sys.stderr.write(
                            f"[recorder] phase outcome saved "
                            f"phase={action_state._CURRENT_PHASE} success={done_success}\n"
                        )
                        sys.stderr.flush()
                    except Exception as e:
                        sys.stderr.write(f"[recorder] phase outcome save failed: {e}\n")
                        sys.stderr.flush()
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

            # ── Capture CSS selectors for action entries missing them ──
            # 在 on_step_end 时，有些 controller action 可能没有传入 element
            #（如 fill_date_field、click_adjacent_button 等），导致 cssSelector 为空。
            # 这里用 JS_SMART_LOCATOR 在页面上按 label_text 实时抓取，补填缺失的 cssSelector。
            try:
                page = await agent.browser_context.get_current_page()
                for entry in ctrl_mod._ACTION_LOG:
                    if not isinstance(entry, dict):
                        continue
                    if entry.get('cssSelector'):
                        continue  # 已经有 cssSelector，跳过
                    params = entry.get('params', {}) or {}
                    label_text = params.get('label_text', '') or ''
                    if not label_text:
                        continue
                    raw = await page.evaluate(JS_SMART_LOCATOR, [label_text])
                    if raw:
                        info = json.loads(raw) if isinstance(raw, str) else raw
                        css = info.get('css_sel', '')
                        if css:
                            entry['cssSelector'] = css
                            if not entry.get('tagName'):
                                entry['tagName'] = info.get('tag', '')
                            if not entry.get('attributes'):
                                entry['attributes'] = info.get('attrs', {})
            except Exception:
                pass

        except Exception as e:
            sys.stderr.write(f"[recorder] on_step_end error: {e}\n")
            sys.stderr.flush()

    return on_step_start, on_step_end
