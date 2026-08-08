"""Recording emission helpers (extracted verbatim from scripts/recorder.py).

Module-level functions called by recorder.build_recording_hooks' on_step_end;
all state is passed as parameters. Lazy imports of actions._phase_* / memory /
feature_flags / controller are preserved at function level (depth-adjusted for
the scripts.agent package location).
"""
import json
import re
import sys


def _emit_empty_act_cue(case_data_store, agent, _actions_raw, _next_goal):
        from ..actions._section_scope import (
            is_empty_effective_actions,
            empty_act_prescription_message,
        )
        if case_data_store is not None and is_empty_effective_actions(
            _actions_raw, next_goal=_next_goal or ''
        ):
            streak = int(case_data_store.get('_empty_act_streak') or 0) + 1
            case_data_store['_empty_act_streak'] = streak
            # Design §3.3: final browser-use iteration is done-only (DoneAgentOutput).
            max_s = int((case_data_store or {}).get('_phase_max_steps') or 0)
            n = int(getattr(agent.state, 'n_steps', 0) or 0)
            last_step = bool(max_s and n >= max_s)
            flag = getattr(agent.state, 'is_last_step', None)
            if callable(flag):
                try:
                    last_step = bool(flag()) or last_step
                except Exception:
                    pass
            elif isinstance(flag, bool):
                last_step = flag or last_step
            save_ok = bool(case_data_store.get('_last_save_ok'))
            msg = HumanMessage(content=empty_act_prescription_message(
                case_data_store, last_step=last_step, save_ok=save_ok,
            ))
            agent._message_manager._add_message_with_tokens(msg)
            sys.stderr.write(
                f'[recorder] Injected empty-act cue (streak={streak} '
                f'last_step={last_step} save_ok={save_ok})\n'
            )
            sys.stderr.flush()
        elif case_data_store is not None:
            case_data_store['_empty_act_streak'] = 0



def _emit_memory_action_event(agent, _actions, _last_result_str):
        # P1：动作事件打点（fill_before_save 建模用）——异步旁路，失败不阻塞
        try:
            from ..actions._state import _CURRENT_PHASE
            from scripts.memory.writer import emit_memory_event
            action_payload = []
            fill_labels = []
            for a in _actions:
                try:
                    parsed = json.loads(a)
                except Exception:
                    parsed = {}
                if not isinstance(parsed, dict):
                    parsed = {}
                name = str(parsed.get('action') or '')
                if name in ('fill_form_field', 'select_option', 'click_radio',
                            'fill_date_field', 'select_tree_option', 'fill_input'):
                    lab = str(parsed.get('label') or parsed.get('label_text') or '').strip()
                    if lab:
                        fill_labels.append(lab)
                action_payload.append(parsed)
            emit_memory_event(
                'action',
                {'actions': action_payload, 'result': _last_result_str[:200]},
                phase_number=_CURRENT_PHASE or None,
                step_number=agent.state.n_steps,
                facts=[
                    {
                        'entity': lab,
                        'attribute': 'filled',
                        'value': '1',
                        'factType': 'page_state',
                        'source': 'observer',
                        'stance': 'neutral',
                    }
                    for lab in dict.fromkeys(fill_labels)
                ],
            )
        except Exception:
            pass



def _capture_step_url(agent):
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



async def _guard_done_on_step_end(agent, _last_result, case_data_store) -> bool:
            try:
                from ..actions._phase_intent import (
                    check_pending_write_gate,
                    get_phase_intent,
                    has_contract_success,
                    is_introduce_phase,
                    mark_quality_failed,
                    overlay_blocks_done,
                    recovery_prescription_message,
                )
                from ..actions._phase_context import is_heal_mode
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
                            from ..actions import _state as action_state
                            from ..actions._phase_context import record_phase_outcome
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
                        from ..actions._section_scope import resolve_phase_section

                        _sec = resolve_phase_section(case_data_store)
                        ok_pending, pending_labels = check_pending_write_gate(
                            case_data_store, section=_sec
                        )
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
                                            f'{pending_labels[:8]}'
                                            + (f' in section={_sec!r}' if _sec else '')
                                            + '. Write each editable field then click_save(button_text="保存"'
                                            + (f', section={_sec!r}' if _sec else '')
                                            + ').'
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
                            missing_hint = ''
                            try:
                                from scripts.actions._phase_boundary import (
                                    get_phase_boundary,
                                    observed_kinds,
                                    phase_done_ok,
                                )
                                ok_b, missing = phase_done_ok(case_data_store)
                                b = get_phase_boundary(case_data_store) or {}
                                missing_hint = (
                                    f" success_when={list(b.get('success_when') or [])}"
                                    f" observed={sorted(observed_kinds(case_data_store))}"
                                    f" missing={missing} ok={ok_b}"
                                )
                            except Exception:
                                missing_hint = ''
                            submit = (contract or {}).get('submit') or {}
                            recovery = recovery_prescription_message(
                                contract,
                                reason='Premature done() rejected: missing success token.',
                            )
                            sys.stderr.write(
                                f"[recorder] ⚠ Premature done() — no success token at step "
                                f"{agent.state.n_steps} mode={(contract or {}).get('mode')} "
                                f"submit.required={bool(submit.get('required'))}"
                                f"{missing_hint}\n"
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
                        if overlay_blocks_done(contract):
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
                        from ..actions._phase_reviewer import coerce_bool
                        submit = (contract or {}).get('submit') or {}
                        kinds = ((contract or {}).get('success') or {}).get('kinds') or []
                        sys.stderr.write(
                            f"[recorder] overlay present ({open_overlay}) but contract allows done "
                            f"(submit.required={coerce_bool(submit.get('required'))}, kinds={list(kinds)}) "
                            f"at step {agent.state.n_steps}\n"
                        )
                        sys.stderr.flush()

                    if (error_notifs or form_errors) and not navigated_ok and not save_ok and not introduce_ok:
                        if overlay_blocks_done(contract):
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
                        from ..actions._phase_reviewer import coerce_bool
                        submit = (contract or {}).get('submit') or {}
                        kinds = ((contract or {}).get('success') or {}).get('kinds') or []
                        sys.stderr.write(
                            f"[recorder] visible errors present (notifs={error_notifs[:2]} "
                            f"formErrors={form_errors[:3]}) but contract allows done "
                            f"(submit.required={coerce_bool(submit.get('required'))}, kinds={list(kinds)}) "
                            f"at step {agent.state.n_steps}\n"
                        )
                        sys.stderr.flush()

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
                            from ..actions import _state as action_state
                            from ..actions._phase_context import record_phase_outcome
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
                            # P0：阶段结果写入外部记忆（append-only，失败不阻塞）
                            try:
                                from scripts.memory.writer import emit_memory_event
                                emit_memory_event(
                                    'phase_done',
                                    {'success': bool(done_success), 'text': str(done_text or '')[:400]},
                                    phase_number=action_state._CURRENT_PHASE,
                                    # P1：outcome 事实（fill_before_save 建模的锚点）
                                    facts=[{
                                        'entity': f'phase_{action_state._CURRENT_PHASE}',
                                        'attribute': 'outcome',
                                        'value': 'success' if done_success else 'failed',
                                        'factType': 'outcome',
                                        'source': 'observer',
                                        'stance': 'authoritative',
                                    }],
                                )
                            except Exception as _me:
                                sys.stderr.write(f"[recorder] memory phase_done emit failed: {_me}")
                                sys.stderr.flush()
                        except Exception as e:
                            sys.stderr.write(f"[recorder] phase outcome save failed: {e}\n")
                            sys.stderr.flush()
            except Exception as e:
                sys.stderr.write(f"[recorder] done-check error: {e}\n")
                sys.stderr.flush()
            return False
