"""
Recording hooks for browser-use agent: step callbacks, goal dedup detection, cancel signal,
and premature done() prevention.
"""
import json
import re
import sys
from langchain_core.messages import HumanMessage
from . import controller as ctrl_mod
from .controller.actions._js_snippets import JS_SMART_LOCATOR
from .controller.actions._helpers import _as_dict
from .agent.recorder_emitters import (  # noqa: E402
    _capture_step_url,
    _emit_duplicate_failure_cue,
    _emit_empty_act_cue,
    _emit_navigation_cue,
    _emit_memory_action_event,
    _guard_done_on_step_end,
)


# ========================== Operation Log (plain text, for LLM context) ==========================
# Each line records one agent step: step#, goal, actions, result.
# NOT used for script generation — only for LLM reference.
_ACTION_LOG = []


def _compact_last_result(_last_result, max_chars=120):
    """把 ActionResult（单条或列表）压缩为一行 res=/err= 摘要，避免长 JSON 刷屏。

    完整 tool 结果仍在模型上下文里，日志侧只需关键信号与首段预览。
    """
    results = _last_result if isinstance(_last_result, list) else ([_last_result] if _last_result else [])
    parts = []
    for r in results:
        text = (getattr(r, 'extracted_content', None) or '').strip()
        err = (getattr(r, 'error', None) or '').strip()
        if text:
            parts.append(f'res={text[:max_chars]}')
        if err:
            parts.append(f'err={err[:max_chars]}')
    return ' | '.join(parts) if parts else 'res=None'


def build_recording_hooks(goal_tracker=None, cancel_flag_path=None, business_data_store=None):
    """Build hooks with goal dedup detection and cancel signal."""
    if goal_tracker is None:
        goal_tracker = {'goals': [], 'stopped': False}

    async def on_step_start(agent):
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
            from .controller.actions._scenario_describer import inject_scenario_summary
            await inject_scenario_summary(agent, business_data_store)
        except Exception as e:
            sys.stderr.write(f"[recorder] scenario_describer error: {e}\n")
            sys.stderr.flush()

        if business_data_store is not None:
            # After auto-fill / empty pending: force agent toward 保存 — never on query UI
            if business_data_store.get('_task_mode') == 'query' or business_data_store.get('_query_task') or business_data_store.get('_query_ui'):
                business_data_store.pop('_submit_ready', None)
                business_data_store.pop('_query_ready', None)
            elif business_data_store.get('_submit_ready'):
                business_data_store['_submit_ready'] = False
                msg = HumanMessage(content=(
                    '[SYSTEM] Fillable form fields are done (pending≈0).\n'
                    'NEXT_ACTION: Call click_save() NOW (finds 保存/提交 and scrolls into view).\n'
                    'Do NOT only check_field_value — that does not submit.\n'
                    'Do NOT scroll_down / scroll_up hunting for 保存.\n'
                    'Do NOT call select_option / fill_form_field on fields that already have values.\n'
                    'If 联网核查结果 is required and empty, click_adjacent_button(联网核查) first, '
                    'wait_for_loading, then click_save().\n'
                    'click_save() returns ok-save-success (操作成功) OR ok-save-navigation (URL change) '
                    'OR ok-save-no-feedback (clicked, no toast/error — silent save OK) — '
                    'any of these counts as save success; then done(success=true). '
                    'err-save-validation / err-save-notification = NOT success.'
                ))
                agent._message_manager._add_message_with_tokens(msg)
                sys.stderr.write('[recorder] Injected submit-ready cue\n')
                sys.stderr.flush()
            # Break already-matched re-select loops
            streak = int(business_data_store.get('_already_matched_streak', 0) or 0)
            if streak >= 3:
                business_data_store['_already_matched_streak'] = 0
                if (
                    business_data_store.get('_task_mode') == 'query'
                    or business_data_store.get('_query_task')
                    or business_data_store.get('_query_ui')
                ):
                    msg = HumanMessage(content=(
                        f'[SYSTEM] You received already-matched {streak}+ times in a row. '
                        f'Task mode=query — NOT form fill. '
                        f'STOP re-selecting filters. Click the 查询 button now. '
                        f'Do NOT call click_save() / scan_form_fields / get_pending_tasks.'
                    ))
                elif business_data_store.get('_task_mode') == 'form_modify' and not business_data_store.get('_force_refill_all'):
                    msg = HumanMessage(content=(
                        f'[SYSTEM] You received already-matched {streak}+ times in a row. '
                        f'Task mode=form_modify — record write actions on editable fields. '
                        f'STOP re-selecting. Call click_save() if fields are written.'
                    ))
                else:
                    try:
                        from scripts.controller.actions.section_scope import (
                            preferred_submit_cue,
                            resolve_phase_section,
                        )
                        sec = resolve_phase_section(business_data_store)
                        cue = preferred_submit_cue(business_data_store, section=sec)
                    except Exception:
                        cue = 'Call click_save() immediately.'
                    msg = HumanMessage(content=(
                        f'[SYSTEM] You received already-matched {streak}+ times in a row. '
                        f'STOP re-selecting fields. {cue} '
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
        # 每步一行紧凑格式：步骤号 + done/stopped 状态 + goal + 动作 + 结果摘要
        # （goal/actions/res 均截断防刷屏；完整 tool 结果在模型上下文内）
        sys.stderr.write(
            f"[step {agent.state.n_steps}] "
            f"done={'yes' if _done else 'no'} stopped={'yes' if _stopped else 'no'} | "
            f"goal={(_next_goal or '-')[:100]} | "
            f"act={(', '.join(_actions))[:200] if _actions else '-'} | "
            f"{_compact_last_result(_last_result)}\n"
        )
        sys.stderr.flush()
        # Empty-act cue is internal steering only — never abort on_step_end / agent.run
        try:
            _emit_empty_act_cue(business_data_store, agent, _actions_raw, _next_goal)
        except Exception as e:
            sys.stderr.write(f'[recorder] empty-act cue error: {e}\n')
            sys.stderr.flush()

        # Duplicate-failure cue is internal steering only — never abort on_step_end / agent.run
        try:
            _emit_duplicate_failure_cue(business_data_store, agent, _actions, _last_result)
        except Exception as e:
            sys.stderr.write(f'[recorder] duplicate-failure cue error: {e}\n')
            sys.stderr.flush()

        # Navigation cue is internal steering only — never abort on_step_end / agent.run
        try:
            _emit_navigation_cue(business_data_store, agent)
        except Exception as e:
            sys.stderr.write(f'[recorder] navigation cue error: {e}\n')
            sys.stderr.flush()

        # P1：动作事件打点（fill_before_save 建模用）——异步旁路，失败不阻塞
        _emit_memory_action_event(agent, _actions, _last_result_str)

        # ===== Capture page URL from agent state =====
        _capture_step_url(agent)
        # ===== End URL capture =====

        # Check cancel signal before any processing
        if cancel_flag_path is not None and cancel_flag_path.exists():
            sys.stderr.write("[recorder] Cancel signal received, stopping agent\n")
            sys.stderr.flush()
            agent.state.stopped = True
            try:
                cancel_flag_path.unlink(missing_ok=True)
            except OSError:
                pass
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
            if await _guard_done_on_step_end(agent, _last_result, business_data_store):
                return

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
                        try:
                            from .controller.actions.click_navigation_cue import goal_loop_nav_hint_message
                            from scripts.feature_flags import click_nav_cue_enabled
                            if click_nav_cue_enabled():
                                agent._message_manager._add_message_with_tokens(
                                    HumanMessage(content=goal_loop_nav_hint_message())
                                )
                                sys.stderr.write('[recorder] Injected goal-loop navigation hint\n')
                                sys.stderr.flush()
                        except Exception:
                            pass
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
                from .state import _CURRENT_PHASE
                from .controller.actions._phase_intent import (
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
                    if a in ('fill_form_field', 'select_option', 'click_radio'):
                        lab = (p.get('label_text') or '').strip()
                        return f'{a}:{lab}' if lab else None
                    # Read-only no-progress actions: repeated identical calls
                    # (e.g. get_page_state xN with no write in between) are a
                    # spin — count them so cycle detect / heal can stop it.
                    if a in ('get_page_state', 'scan_form_fields', 'get_pending_tasks'):
                        return a
                    if a == 'check_field_value':
                        lab = (p.get('label_text') or '').strip()
                        return f'check_field_value:{lab}' if lab else 'check_field_value'
                    return None

                slice_entries = list(_ctrl_log[baseline:]) if baseline <= len(_ctrl_log) else list(_ctrl_log)
                fps = [x for x in (_fp(e) for e in slice_entries) if x]

                def _is_substantive(fp: str) -> bool:
                    return fp.startswith(('radio:', 'save:', 'fill_', 'select_', 'click_radio:'))

                # Too early in the phase — avoid false stop on open/expand clicks
                if business_data_store and business_data_store.get('_heal_mode'):
                    # heal: no contract cycle prescription, but stop on a
                    # no-progress spin — repeated identical read-only actions
                    # (get_page_state / check_field_value) with no write between.
                    # Previously the agent spun until max_steps, then required
                    # manual intervention.
                    recent = fps[-4:]
                    if len(recent) >= 3 and len(set(recent)) == 1:
                        sys.stderr.write(
                            f"[recorder] heal no-progress spin x{len(recent)}: {recent[0]} — stopping\n"
                        )
                        sys.stderr.flush()
                        goal_tracker['stopped'] = True
                        agent.state.stopped = True
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
                        contract = get_phase_intent(business_data_store) if business_data_store else None
                        prescribed = bool(business_data_store and business_data_store.get('_cycle_prescribed'))
                        if prescribed and business_data_store:
                            recent = fps[-cycle_len:] if fps else []
                            if any(is_cycle_deviate_fingerprint(x) for x in recent):
                                mark_quality_failed(business_data_store, f'cycle_deviate:{recent}')
                                goal_tracker['stopped'] = True
                                sys.stderr.write(
                                    f"[recorder] Cycle deviate after prescription: {recent}\n"
                                )
                                sys.stderr.flush()
                                agent.state.stopped = True
                                return
                            break
                        if business_data_store is not None:
                            business_data_store['_cycle_prescribed'] = True
                            business_data_store['_recovery_active'] = True
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
            #（如 click_adjacent_button 等），导致 cssSelector 为空。
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
                        info = _as_dict(raw)
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
