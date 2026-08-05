"""
Recording hooks for browser-use agent: step callbacks, goal dedup detection, cancel signal,
and premature done() prevention.
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


def build_recording_hooks(goal_tracker=None, cancel_flag_path=None, case_data_store=None):
    """Build hooks with goal dedup detection and cancel signal."""
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

        # Business-scenario summary (non-mandatory background) — before force cues
        try:
            from .actions._scenario_describer import inject_scenario_summary
            await inject_scenario_summary(agent, case_data_store)
        except Exception as e:
            sys.stderr.write(f"[recorder] scenario_describer error: {e}\n")
            sys.stderr.flush()

        if case_data_store is not None:
            # After auto-fill / empty pending: force agent toward 保存 — never on query UI
            if case_data_store.get('_task_mode') == 'query' or case_data_store.get('_query_task') or case_data_store.get('_query_ui'):
                case_data_store.pop('_submit_ready', None)
                case_data_store.pop('_query_ready', None)
            elif case_data_store.get('_submit_ready'):
                case_data_store['_submit_ready'] = False
                msg = HumanMessage(content=(
                    '[SYSTEM] Fillable form fields are done (pending≈0).\n'
                    'NEXT_ACTION: Call click_save() NOW (finds 保存/提交 and scrolls into view).\n'
                    'Do NOT scroll_down / scroll_up hunting for 保存.\n'
                    'Do NOT call select_option / fill_form_field on fields that already have values.\n'
                    'If 联网核查结果 is required and empty, click_adjacent_button(联网核查) first, '
                    'wait_for_loading, then click_save().\n'
                    'click_save() returns ok-save-success (操作成功) OR ok-save-navigation (URL change) — '
                    'either counts as save success; then done(success=true). '
                    'err-save-validation / err-save-no-feedback = NOT success.'
                ))
                agent._message_manager._add_message_with_tokens(msg)
                sys.stderr.write('[recorder] Injected submit-ready cue\n')
                sys.stderr.flush()
            # Break already-matched re-select loops
            streak = int(case_data_store.get('_already_matched_streak', 0) or 0)
            if streak >= 3:
                case_data_store['_already_matched_streak'] = 0
                if (
                    case_data_store.get('_task_mode') == 'query'
                    or case_data_store.get('_query_task')
                    or case_data_store.get('_query_ui')
                ):
                    msg = HumanMessage(content=(
                        f'[SYSTEM] You received already-matched {streak}+ times in a row. '
                        f'Task mode=query — NOT form fill. '
                        f'STOP re-selecting filters. Click the 查询 button now. '
                        f'Do NOT call click_save() / scan_form_fields / get_pending_tasks.'
                    ))
                elif case_data_store.get('_task_mode') == 'form_modify' and not case_data_store.get('_force_refill_all'):
                    msg = HumanMessage(content=(
                        f'[SYSTEM] You received already-matched {streak}+ times in a row. '
                        f'Task mode=form_modify — record write actions on editable fields. '
                        f'STOP re-selecting. Call click_save() if fields are written.'
                    ))
                else:
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
                from .actions._phase_intent import (
                    check_pending_write_gate,
                    get_phase_intent,
                    has_contract_success,
                    is_introduce_phase,
                    mark_quality_failed,
                    recovery_prescription_message,
                )
                from .actions._phase_context import is_heal_mode
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

                # ===== Heal done vs recording done (separate rules) =====
                # Heal: no phase-intent contract; accept after redo intent.
                # Recording: overlay / save / contract token gates in the else branch.
                heal_mode = (case_data_store or {}).get('_heal_mode') if case_data_store else None
                if heal_mode and is_heal_mode(case_data_store):
                    done_text = ''
                    try:
                        for r in (_last_result or []):
                            done_text += (getattr(r, 'extracted_content', None) or '') + ' '
                    except Exception:
                        pass
                    sys.stderr.write(
                        f"[recorder] ✓ heal done() accepted "
                        f"(mode={heal_mode}, success={done_success}) "
                        f"at step {agent.state.n_steps} — no contract / overlay / save gates\n"
                    )
                    sys.stderr.flush()
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
                        except Exception as e:
                            sys.stderr.write(f"[recorder] heal phase outcome save failed: {e}\n")
                            sys.stderr.flush()
                        case_data_store.pop('_heal_mode', None)
                else:
                    # Recording done gates only
                    heal_mode = None
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
                    introduce_ok = bool(case_data_store and case_data_store.get('_last_introduce_ok'))
                    url_before_save = (case_data_store or {}).get('_url_before_save') or ''
                    url_changed = bool(url_before_save and cur_url and url_before_save != cur_url)

                    contract = get_phase_intent(case_data_store) if case_data_store else None

                    # Navigation success: any URL change after save attempt (not only legacy patterns)
                    navigated_ok = bool(
                        save_ok
                        and url_changed
                    ) or bool(
                        done_success
                        and url_changed
                        and save_ok
                    )
                    if contract and is_introduce_phase(contract):
                        navigated_ok = False  # introduce uses confirm token only

                    # Write gate on done for all_editable
                    if case_data_store and contract and contract.get('refill') == 'all_editable':
                        ok_pending, pending_labels = check_pending_write_gate(case_data_store)
                        if not ok_pending:
                            mark_quality_failed(
                                case_data_store,
                                f'pending_fields:{",".join(pending_labels[:6])}',
                            )
                            sys.stderr.write(
                                f"[recorder] ⚠ Premature done() — pending fields {pending_labels[:6]}\n"
                            )
                            sys.stderr.flush()
                            for h in agent.state.history.history:
                                if h.result:
                                    for r in h.result:
                                        r.is_done = False
                                        r.error = (
                                            f'Premature done() rejected: pending fields remain '
                                            f'{pending_labels[:8]}. Write each editable field '
                                            f'(same value OK) then click_save().'
                                        )
                                        try:
                                            from scripts.feature_flags import memory_whitelist_enabled
                                            if memory_whitelist_enabled():
                                                r.include_in_memory = True
                                        except Exception:
                                            pass
                            return

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

                    # Claiming save success without token when contract requires submit
                    needs_token = bool(
                        contract
                        and (contract.get('submit') or {}).get('required')
                    )
                    if needs_token and done_success and not has_contract_success(case_data_store):
                        if not (introduce_ok and contract and is_introduce_phase(contract)):
                            recovery = recovery_prescription_message(
                                contract,
                                reason='Premature done() rejected: missing success token.',
                            )
                            sys.stderr.write(
                                f"[recorder] ⚠ Premature done() — no success token at step {agent.state.n_steps}\n"
                            )
                            sys.stderr.flush()
                            for h in agent.state.history.history:
                                if h.result:
                                    for r in h.result:
                                        r.is_done = False
                                        r.error = recovery
                                        try:
                                            from scripts.feature_flags import memory_whitelist_enabled
                                            if memory_whitelist_enabled():
                                                r.include_in_memory = True
                                        except Exception:
                                            pass
                            return

                    # Legacy path when no contract
                    if not needs_token and claims_save_ok and not save_ok and not navigated_ok and not introduce_ok:
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
                                        'Premature done() rejected: no save success observed '
                                        '(need 操作成功 toast OR post-save navigation). '
                                        'Do NOT re-select the table row and do NOT re-click 修改. '
                                        'If the maintain dialog is still open: call '
                                        'click_save(button_text="确认") NOW. '
                                        'Only done(success=true) after save success.'
                                    )
                                    try:
                                        from scripts.feature_flags import memory_whitelist_enabled
                                        if memory_whitelist_enabled():
                                            r.include_in_memory = True
                                    except Exception:
                                        pass
                        return

                    if open_overlay and not navigated_ok and not save_ok and not introduce_ok:
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

                    if (error_notifs or form_errors) and not navigated_ok and not save_ok and not introduce_ok:
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

                    if navigated_ok or save_ok or introduce_ok:
                        reason = 'introduce' if introduce_ok else ('save-ok' if save_ok else 'navigation')
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
                            case_data_store.pop('_query_ready', None)
                            case_data_store.pop('_query_ui', None)
                            case_data_store.pop('_autofill_summary', None)
                            case_data_store.pop('_last_save_ok', None)
                            case_data_store.pop('_last_introduce_ok', None)
                            case_data_store.pop('_url_before_save', None)
                            case_data_store.pop('_success_tokens', None)
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

            # Repeated recorded-action cycle within THIS agent.run only.
            # Full _ACTION_LOG spans phases / phase retries; using it whole causes false
            # stops like ['click:查询','click:'] when re-running a query phase.
            try:
                from .controller import _ACTION_LOG as _ctrl_log
                from .actions._state import _CURRENT_PHASE
                from .actions._phase_intent import (
                    get_phase_intent,
                    is_cycle_deviate_fingerprint,
                    recovery_prescription_message,
                    mark_quality_failed,
                )

                baseline = int(goal_tracker.get('cycle_baseline') or 0)

                def _fp(entry):
                    if not isinstance(entry, dict):
                        return None
                    # Prefer current phase when tagged; still allow untagged entries in slice
                    try:
                        ep = entry.get('phase')
                        if ep is not None and int(ep) != int(_CURRENT_PHASE) and int(_CURRENT_PHASE) > 0:
                            return None
                    except (TypeError, ValueError):
                        pass
                    a = entry.get('action') or ''
                    p = entry.get('params') or {}
                    if a == 'click_table_row_radio':
                        text = (p.get('row_text') or '').strip()
                        return f'radio:{text}' if text else None
                    if a == 'click_element_by_index':
                        text = (p.get('text') or '').strip()
                        # Empty-label clicks (expand/icon) are too weak for cycle detect
                        if not text:
                            return None
                        return f'click:{text}'
                    if a == 'click_save':
                        return f'save:{(p.get("button_text") or "保存").strip()}'
                    if a in ('fill_form_field', 'fill_date_field', 'select_option', 'click_radio'):
                        lab = (p.get('label_text') or '').strip()
                        return f'{a}:{lab}' if lab else None
                    return None

                slice_entries = list(_ctrl_log[baseline:]) if baseline <= len(_ctrl_log) else list(_ctrl_log)
                fps = [x for x in (_fp(e) for e in slice_entries) if x]

                def _is_substantive(fp: str) -> bool:
                    return fp.startswith(('radio:', 'save:', 'fill_', 'select_', 'click_radio:'))

                # Too early in the phase — avoid false stop on open/expand clicks
                if case_data_store and case_data_store.get('_heal_mode'):
                    pass  # heal: no contract cycle prescription
                elif agent.state.n_steps < 4:
                    pass
                else:
                    # Prefer longer cycles (select→modify→confirm); len=2 only if substantive
                    for cycle_len in (3, 4, 2):
                        if len(fps) < cycle_len * 2:
                            continue
                        a = fps[-cycle_len:]
                        b = fps[-cycle_len * 2:-cycle_len]
                        if not (a and a == b):
                            continue
                        if cycle_len == 2 and not any(_is_substantive(x) for x in a):
                            continue  # pure click:查询 / click:xxx loops are common, not a spin
                        contract = get_phase_intent(case_data_store) if case_data_store else None
                        prescribed = bool(case_data_store and case_data_store.get('_cycle_prescribed'))
                        if prescribed and case_data_store:
                            recent = fps[-cycle_len:] if fps else []
                            if any(is_cycle_deviate_fingerprint(x) for x in recent):
                                mark_quality_failed(case_data_store, f'cycle_deviate:{recent}')
                                goal_tracker['stopped'] = True
                                sys.stderr.write(
                                    f"[recorder] Cycle deviate after prescription: {recent}\n"
                                )
                                sys.stderr.flush()
                                agent.state.stopped = True
                                return
                            break
                        if case_data_store is not None:
                            case_data_store['_cycle_prescribed'] = True
                            case_data_store['_recovery_active'] = True
                        sys.stderr.write(
                            f"[recorder] Repeated action cycle detected ({cycle_len}×2): {a} — prescribing recovery\n"
                        )
                        sys.stderr.flush()
                        try:
                            msg = HumanMessage(content=recovery_prescription_message(
                                contract,
                                reason='Repeated action cycle detected.',
                            ))
                            agent._message_manager._add_message_with_tokens(msg)
                        except Exception:
                            pass
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
