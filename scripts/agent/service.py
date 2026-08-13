"""Per-phase agent execution (extracted from scripts/session_runner.py).

Lazy/function-level imports of actions._phase_* / memory / feature_flags /
controller are preserved verbatim (only import depth adjusted for the
scripts.agent package location).
"""
import asyncio
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from browser_use import Agent

from ..controller.actions._phase_intent import get_phase_intent
from ..agent_utils import (
    PLANNER_SYSTEM_PROMPT,
    build_agent_system_message,
    do_navigate,
    emit_json,
    extract_first_url,
    make_done_callback,
    make_step_callback,
)

_last_agent = None


def _close_agent():
    global _last_agent
    if _last_agent is not None:
        try:
            for t in getattr(_last_agent, '_tasks', []):
                t.cancel()
        except Exception:
            pass
        _last_agent = None


def _request_agent_stop(cancel_flag_path=None, goal_tracker=None, reason='cancel_step'):
    """Stop the in-flight browser-use Agent ASAP (no further steps).

    Cooperative: browser-use honors agent.state.stopped at the next step boundary.
    Also writes cancel_flag_path so on_step_start/end hooks reinforce the stop.
    """
    global _last_agent
    try:
        if cancel_flag_path is not None:
            Path(cancel_flag_path).write_text('cancel', encoding='utf-8')
    except Exception as e:
        sys.stderr.write(f"cancel flag write failed: {e}\n")
        sys.stderr.flush()

    if isinstance(goal_tracker, dict):
        goal_tracker['stopped'] = True

    agent = _last_agent
    if agent is not None:
        try:
            if getattr(agent, 'state', None) is not None:
                agent.state.stopped = True
        except Exception:
            pass
        try:
            for t in getattr(agent, '_tasks', []) or []:
                try:
                    t.cancel()
                except Exception:
                    pass
        except Exception:
            pass

    sys.stderr.write(f"Stop requested ({reason}) — agent will not take further steps\n")
    sys.stderr.flush()
    emit_json({"event": "agent_stopped", "data": {"reason": reason}})

async def _run_agent_step(instruction, step_index, session_id, args, llm, browser_context,
                          controller, goal_tracker, cancel_flag_path,
                          on_step_start_hook, on_step_end_hook, case_data_ref, cumulative_path,
                          special_element_candidates_store=None):
    global _last_agent
    max_steps = instruction.get("max_steps", 40)
    task_text = instruction.get("instruction", "")
    if not task_text:
        emit_json({"event": "error", "data": {"message": "instruction is required"}})
        return None, None

    # Close previous agent before creating new one
    _close_agent()

    if cancel_flag_path.exists():
        try:
            cancel_flag_path.unlink(missing_ok=True)
        except Exception:
            pass

    # Replace per-phase special-element candidates (do not accumulate across phases)
    try:
        from ..controller.actions._special_element import replace_special_element_candidates
        raw_cands = (
            instruction.get('special_element_candidates')
            or instruction.get('specialElementCandidates')
            or []
        )
        if special_element_candidates_store is not None:
            replace_special_element_candidates(special_element_candidates_store, raw_cands)
            sys.stderr.write(
                f"special_element_candidates loaded: {len(special_element_candidates_store)}\n"
            )
            sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"special_element_candidates skipped: {e}\n")
        sys.stderr.flush()

    # P1：记忆事件携带 trajectory_id（Node step 指令透传；writer 自 P0 支持）
    try:
        from ..memory.writer import configure as configure_memory_writer
        tid = instruction.get('trajectory_id') or instruction.get('trajectoryId')
        if tid:
            configure_memory_writer(trajectory_id=int(tid))
    except Exception as e:
        sys.stderr.write(f"memory trajectory_id skipped: {e}\n")
        sys.stderr.flush()

    contract = None
    sys.stderr.write(f"Phase {step_index}: {task_text[:80]} (max_steps={max_steps})\n")
    sys.stderr.flush()

    nav_url = extract_first_url(task_text)
    if nav_url:
        try:
            page = await browser_context.get_current_page()
            sys.stderr.write(f"Navigating to {nav_url}\n");
            sys.stderr.flush()
            await do_navigate(page, nav_url)
            sys.stderr.write(f"Navigation done\n");
            sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"navigate: Error: {e}\n");
            sys.stderr.flush()

    agent_task = re.sub(r'^【目标URL】\s*\n\s*https?://[^\s\n]+[\s\n]*', '', task_text, count=1).strip() or task_text
    phase_task_text = agent_task
    want_biz = False
    heal_mode = False
    max_steps_resolved = False
    try:
        from ..controller.actions._phase_context import (
            apply_heal_mode,
            apply_task_mode,
            classification_task_text,
            detect_heal_mode,
            format_phase_preamble,
            needs_business_data_context,
            recording_refill_hint,
        )
        from ..controller.actions._phase_intent import (
            apply_phase_contract,
            apply_phase_intent,
            contract_summary_hint,
        )
        from ..controller.actions.phase.reviewer import review_phase_contract
        from ..state import _CURRENT_PHASE
        heal_mode = detect_heal_mode(instruction, agent_task)
        # Classify / boundary on goal text only — strip 【业务数据】value blocks first.
        phase_core = classification_task_text(agent_task)
        phase_for_preamble = instruction.get('phase_number')
        if phase_for_preamble is None:
            phase_for_preamble = instruction.get('phaseNumber')
        if phase_for_preamble is None:
            phase_for_preamble = _CURRENT_PHASE
        if case_data_ref is not None:
            apply_heal_mode(case_data_ref, heal_mode)
            if heal_mode:
                mode = 'other'
                contract = None
                sys.stderr.write(
                    f"task_mode=other force_refill_all=False "
                    f"heal_mode={heal_mode} phase_intent=False\n"
                )
                sys.stderr.flush()
            else:
                all_phases = instruction.get('all_phases') or instruction.get('allPhases') or []
                prior_outcome = instruction.get('prior_outcome') or instruction.get('priorOutcome')
                scenario_summary = ''
                if isinstance(prior_outcome, dict):
                    scenario_summary = str(prior_outcome.get('text') or '').strip()
                try:
                    cur_phase = int(phase_for_preamble) if phase_for_preamble is not None else 0
                except (TypeError, ValueError):
                    cur_phase = 0
                reviewed = await review_phase_contract(
                    task_text=phase_core,
                    all_phases=all_phases if isinstance(all_phases, list) else [],
                    current_phase_number=cur_phase,
                    scenario_summary=scenario_summary,
                    llm=llm,
                )
                if reviewed:
                    contract = apply_phase_contract(case_data_ref, reviewed)
                    mode = case_data_ref.get('_task_mode') or 'other'
                    from ..controller.actions.phase.reviewer import contract_debug_line
                    sys.stderr.write(
                        f"phase_reviewer ok task_mode={mode} "
                        f"force_refill_all={bool(case_data_ref.get('_force_refill_all'))} "
                        f"phase_intent=True {contract_debug_line(contract)}\n"
                    )
                    sys.stderr.flush()
                else:
                    mode = apply_task_mode(case_data_ref, phase_core)
                    contract = apply_phase_intent(case_data_ref, phase_core)
                    mode = case_data_ref.get('_task_mode') or mode
                    from ..controller.actions.phase.reviewer import contract_debug_line
                    sys.stderr.write(
                        f"phase_reviewer fallback task_mode={mode} "
                        f"force_refill_all={bool(case_data_ref.get('_force_refill_all'))} "
                        f"phase_intent={bool(contract)} {contract_debug_line(contract)}\n"
                    )
                    sys.stderr.flush()
        else:
            mode = 'other'
            contract = None
        # Only fill / introduce phases keep 业务数据 in the model-visible task.
        want_biz = (not heal_mode) and needs_business_data_context(phase_core, case_data_ref)
        if not want_biz:
            agent_task = phase_core
            if case_data_ref is not None:
                case_data_ref.pop('_case_scenario_text', None)
        else:
            sys.stderr.write("business-data context enabled for this phase\n")
            sys.stderr.flush()
        phase_task_text = phase_core
        prior_phases = instruction.get('prior_phases') or instruction.get('priorPhases')
        all_phases_for_preamble = instruction.get('all_phases') or instruction.get('allPhases')
        prior_outcome_for_preamble = instruction.get('prior_outcome') or instruction.get('priorOutcome')
        if not heal_mode:
            agent_task = format_phase_preamble(
                current_phase=int(phase_for_preamble) if phase_for_preamble is not None else 0,
                current_task=agent_task,
                prior_phases=prior_phases if isinstance(prior_phases, list) else None,
                prior_outcome=prior_outcome_for_preamble if isinstance(prior_outcome_for_preamble, dict) else None,
                all_phases=all_phases_for_preamble if isinstance(all_phases_for_preamble, list) else None,
                case_data_store=case_data_ref,
            )
        # P1：记忆事实包注入（AI_MEMORY_FACT_PACK 默认关）——权威值/已保存值
        # 作为事实依据，替代「靠 MAX_RECENT 截断记忆猜」；失败不阻塞主链路。
        try:
            from ..memory.fact_pack import parse_fact_pack, format_fact_pack
            from ..feature_flags import memory_fact_pack_enabled
            raw_pack = instruction.get('fact_pack')
            if not heal_mode and memory_fact_pack_enabled() and raw_pack:
                parsed = parse_fact_pack(raw_pack)
                fp_text = format_fact_pack((parsed or {}).get('facts') or [])
                if fp_text:
                    agent_task = agent_task + '\n\n' + fp_text
                    sys.stderr.write(
                        f"fact pack injected: {len((parsed or {}).get('facts') or [])} facts\n"
                    )
                    sys.stderr.flush()
        except Exception as e:
            sys.stderr.write(f"fact pack skipped: {e}\n")
            sys.stderr.flush()
        from ..controller.actions.phase.reviewer import (
            _EMPTY_ACT_BUFFER,
            coerce_bool,
            resolve_phase_max_steps,
        )
        ceiling = max_steps
        try:
            ceiling = int(max_steps)
        except (TypeError, ValueError):
            ceiling = 40
        # Reviewer effort/estimated_steps force-cap below ceiling (buffer=2
        # covers done-only last step + save/final-check).
        max_steps = resolve_phase_max_steps(ceiling, contract if not heal_mode else None)
        submit_req = (contract or {}).get('submit') or {}
        empty_buffer = _EMPTY_ACT_BUFFER if coerce_bool(submit_req.get('required')) else 0
        sys.stderr.write(
            f"max_steps ceiling={ceiling} chosen={max_steps} "
            f"empty_buffer={empty_buffer} "
            f"effort={(contract or {}).get('effort')} "
            f"estimated_steps={(contract or {}).get('estimated_steps')} "
            f"plan_n={len((contract or {}).get('brief_plan') or [])}\n"
        )
        sys.stderr.flush()
        max_steps_resolved = True
        if case_data_ref is not None and not heal_mode:
            agent_task = agent_task + recording_refill_hint(
                mode,
                force_refill_all=bool(case_data_ref.get('_force_refill_all')),
                task_text=phase_task_text,
            )
            if contract:
                agent_task = agent_task + contract_summary_hint(contract)
            boundary = (case_data_ref or {}).get('_phase_boundary') if case_data_ref else None
            emit_json({
                "event": "phase_intent_obs",
                "data": {
                    "phase": step_index,
                    "phase_intent": contract,
                    "phase_boundary": boundary,
                    "recovery": (contract or {}).get('recovery') if contract else None,
                    "source": (contract or {}).get('source'),
                    "allow_form_assistant": (contract or {}).get('allow_form_assistant'),
                    "brief_plan": (contract or {}).get("brief_plan"),
                    "effort": (contract or {}).get("effort"),
                    "estimated_steps": (contract or {}).get("estimated_steps"),
                    "max_steps_ceiling": ceiling,
                    "max_steps_chosen": max_steps,
                },
            })
            if boundary:
                emit_json({
                    "event": "phase_boundary_obs",
                    "data": {
                        "phase": step_index,
                        "phase_boundary": boundary,
                        "evidence_observed": list((case_data_ref or {}).get('_evidence_observed') or []),
                        "recovery": (contract or {}).get('recovery') if contract else None,
                    },
                })
        elif heal_mode:
            emit_json({
                "event": "phase_intent_obs",
                "data": {
                    "phase": step_index,
                    "heal_mode": heal_mode,
                    "phase_intent": None,
                },
            })
        phase_start_payload = {"phase": step_index, "total": -1, "name": task_text[:60]}
        if contract:
            phase_start_payload["phase_intent"] = contract
        if case_data_ref and case_data_ref.get('_phase_boundary'):
            phase_start_payload["phase_boundary"] = case_data_ref['_phase_boundary']
        if heal_mode:
            phase_start_payload["heal_mode"] = heal_mode
        emit_json({"event": "phase_start", "data": phase_start_payload})
        if agent_task.startswith(('【阶段目录】', '【上一阶段结果】', '【当前任务')):
            sys.stderr.write(f"agent_task preview: {agent_task[:400]}\n")
            sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"phase preamble skipped: {e}\n")
        sys.stderr.flush()
        emit_json({"event": "phase_start", "data": {"phase": step_index, "total": -1, "name": task_text[:60]}})
    if not max_steps_resolved:
        from ..controller.actions.phase.reviewer import (
            _EMPTY_ACT_BUFFER,
            coerce_bool,
            resolve_phase_max_steps,
        )
        ceiling = max_steps
        try:
            ceiling = int(max_steps)
        except (TypeError, ValueError):
            ceiling = 40
        max_steps = resolve_phase_max_steps(
            ceiling, contract if (contract and not heal_mode) else None
        )
        submit_req = (contract or {}).get('submit') or {}
        empty_buffer = _EMPTY_ACT_BUFFER if coerce_bool(submit_req.get('required')) else 0
        sys.stderr.write(
            f"max_steps ceiling={ceiling} chosen={max_steps} "
            f"empty_buffer={empty_buffer} "
            f"effort={(contract or {}).get('effort')} "
            f"estimated_steps={(contract or {}).get('estimated_steps')} "
            f"plan_n={len((contract or {}).get('brief_plan') or [])}\n"
        )
        sys.stderr.flush()
    try:
        from ..controller.actions._case_data import format_case_data_hint, iter_user_case_entries
        if want_biz:
            entries = iter_user_case_entries(case_data_ref)
            hint = format_case_data_hint(case_data_ref)
            if hint:
                agent_task = agent_task + hint
                sys.stderr.write(f"Appended case data hint ({len(entries)} keys)\n")
                sys.stderr.flush()
        else:
            sys.stderr.write("Skip business-data hint (phase is not fill/introduce)\n")
            sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"case data hint skipped: {e}\n")
        sys.stderr.flush()

    try:
        from ..controller.actions._special_element import format_special_element_hint
        se_hint = format_special_element_hint(special_element_candidates_store)
        if se_hint:
            agent_task = agent_task + se_hint
            sys.stderr.write(
                f"Appended special-element hint "
                f"({len(special_element_candidates_store or {})} candidates)\n"
            )
            sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f"special-element hint skipped: {e}\n")
        sys.stderr.flush()

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_step{step_index}_{ts}.json"
    goal_tracker['goals'] = []
    goal_tracker['stopped'] = False
    goal_tracker.pop('cycle_baseline', None)
    # Snapshot ACTION_LOG length so cycle detect ignores prior phases / phase retries
    try:
        from ..controller import _ACTION_LOG as _ctrl_log
        goal_tracker['cycle_baseline'] = len(_ctrl_log)
    except Exception:
        goal_tracker['cycle_baseline'] = 0

    sys.stderr.write(f"Creating Agent...\n");
    sys.stderr.flush()
    contract = get_phase_intent(case_data_ref) if case_data_ref else None
    system_msg = build_agent_system_message(contract)
    agent = Agent(
        task=agent_task, llm=llm, controller=controller, browser_context=browser_context,
        override_system_message=system_msg,
        use_vision=False, enable_memory=False,
        max_failures=5, retry_delay=10,
        planner_llm=llm, planner_interval=3,
        extend_planner_system_message=PLANNER_SYSTEM_PROMPT,
        register_new_step_callback=make_step_callback(step_index * 100),
        register_done_callback=make_done_callback(output_path),
    )
    _last_agent = agent
    sys.stderr.write(f"Agent created, starting run...\n");
    sys.stderr.flush()

    try:
        sys.stderr.write(f"Calling agent.run() with max_steps={max_steps}\n");
        sys.stderr.flush()
        if case_data_ref is not None:
            case_data_ref['_phase_max_steps'] = int(max_steps)
        await agent.run(max_steps=max_steps, on_step_start=on_step_start_hook, on_step_end=on_step_end_hook)
        sys.stderr.write(f"Agent run completed\n");
        sys.stderr.flush()
        if not hasattr(agent, '_done_fired') and hasattr(agent, 'history'):
            output_path.parent.mkdir(parents=True, exist_ok=True)
            agent.history.save_to_file(str(output_path))
    except asyncio.CancelledError:
        sys.stderr.write("Agent run cancelled\n");
        sys.stderr.flush()
        emit_json({"event": "phase_error",
                   "data": {"phase": step_index, "name": task_text[:60], "message": "Agent run cancelled"}})
    except Exception as e:
        emit_json({"event": "phase_error", "data": {"phase": step_index, "name": task_text[:60], "message": str(e)}})

    # Phase-end observability + soft quality gate
    try:
        if case_data_ref is not None:
            from ..controller.actions._phase_intent import (
                check_pending_write_gate,
                emit_phase_observability,
                has_contract_success,
                mark_quality_failed,
            )
            from ..controller.actions.section_scope import resolve_phase_section

            _sec = resolve_phase_section(case_data_ref)
            ok_pending, labels = check_pending_write_gate(case_data_ref, section=_sec)
            contract = get_phase_intent(case_data_ref)
            if contract and contract.get('refill') == 'all_editable' and not ok_pending:
                mark_quality_failed(case_data_ref, f'pending_fields:{",".join(labels[:8])}')
            submit = (contract or {}).get('submit') or {}
            if submit.get('required') and not has_contract_success(case_data_ref):
                # has_contract_success already respects success.kinds — do not waive
                # missing toast_ok just because an introduce picker confirmed.
                if contract and contract.get('mode') not in ('introduce_pick',):
                    mark_quality_failed(case_data_ref, 'missing_success_token')
            emit_phase_observability(case_data_ref, emit_json)
            phase_payload = {"phase": step_index, "name": task_text[:60]}
            c = get_phase_intent(case_data_ref)
            if c:
                phase_payload["phase_intent"] = c
            if case_data_ref.get('_quality_failed'):
                reasons = list(case_data_ref.get('_quality_failed_reasons') or [])
                sys.stderr.write(
                    f"QUALITY FAIL phase={step_index} reasons={reasons}\n"
                )
                sys.stderr.flush()
                phase_payload["quality_failed"] = True
                phase_payload["quality_failed_reasons"] = reasons
            emit_json({"event": "phase_end", "data": phase_payload})
    except Exception as e:
        sys.stderr.write(f"phase_end observability skipped: {e}\n")
        sys.stderr.flush()

    return output_path, task_text
