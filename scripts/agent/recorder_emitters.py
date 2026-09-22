"""Recording emission helpers (extracted verbatim from scripts/recorder.py).

Module-level functions called by recorder.build_recording_hooks' on_step_end;
all state is passed as parameters. Lazy imports of actions._phase_* / memory /
feature_flags / controller are preserved at function level (depth-adjusted for
the scripts.agent package location).
"""
import json
import re
import sys

from langchain_core.messages import HumanMessage


def _emit_empty_act_cue(business_data_store, agent, _actions_raw, _next_goal):
        """Inject internal empty-act steering cue. Failures must never abort the phase."""
        try:
            from ..controller.actions.section_scope import (
                is_empty_effective_actions,
                empty_act_prescription_message,
                final_save_urgency_message,
            )

            max_s = int((business_data_store or {}).get('_phase_max_steps') or 0)
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

            # Penultimate urgency: tools still available; last step is done-only.
            near_last = bool(max_s and n >= (max_s - 1) and not last_step)
            if business_data_store is not None and near_last:
                urg = final_save_urgency_message(business_data_store)
                if urg:
                    agent._message_manager._add_message_with_tokens(HumanMessage(content=urg))
                    sys.stderr.write(
                        f'[recorder] Injected final-save urgency (n={n} max={max_s})\n'
                    )
                    sys.stderr.flush()

            if business_data_store is not None and is_empty_effective_actions(
                _actions_raw, next_goal=_next_goal or ''
            ):
                streak = int(business_data_store.get('_empty_act_streak') or 0) + 1
                business_data_store['_empty_act_streak'] = streak
                # Design §3.3: final browser-use iteration is done-only (DoneAgentOutput).
                save_ok = bool(business_data_store.get('_last_save_ok'))
                msg = HumanMessage(content=empty_act_prescription_message(
                    business_data_store, last_step=last_step, save_ok=save_ok,
                ))
                agent._message_manager._add_message_with_tokens(msg)
                sys.stderr.write(
                    f'[recorder] Injected empty-act cue (streak={streak} '
                    f'last_step={last_step} save_ok={save_ok})\n'
                )
                sys.stderr.flush()
            elif business_data_store is not None:
                business_data_store['_empty_act_streak'] = 0
        except Exception as e:
            # Empty-act is internal steering only — never surface to FE / abort agent.run.
            sys.stderr.write(f'[recorder] empty-act cue skipped: {e}\n')
            sys.stderr.flush()


_OBSERVE_PAGE_JS = (
    "() => JSON.stringify({hash:(location.hash||'').slice(0,80), "
    "loading:!!document.querySelector('.el-loading-mask'), "
    "overlay:(()=>{const d=[...document.querySelectorAll('.el-drawer,.el-dialog')]"
    ".find(x=>x.getClientRects().length>0); "
    "return d?(d.getAttribute('aria-label')||"
    "(d.querySelector('.el-drawer__title,.el-dialog__header')||{}).textContent||'')"
    ".trim().slice(0,30):''})()})"
)


async def _fresh_page_observation(agent):
    """Observe the current page (hash / loading mask / visible overlay).

    Best-effort: any failure is silently skipped so the observation never
    blocks or aborts the steering cue (steering-only contract).
    """
    ctx = None
    for attr in ('browser_context', 'browser_session', 'browser', 'context'):
        candidate = getattr(agent, attr, None)
        if candidate is not None:
            ctx = candidate
            break
    if ctx is None:
        return
    page = None
    get_page = getattr(ctx, 'get_current_page', None)
    if get_page is not None:
        page = await get_page()
    if page is None:
        pages = getattr(ctx, 'pages', None) or []
        page = pages[-1] if pages else None
    if page is None:
        return
    raw = await page.evaluate(_OBSERVE_PAGE_JS)
    try:
        info = json.loads(raw) if isinstance(raw, str) else dict(raw or {})
    except Exception:
        return
    line = (
        '【当前页面】hash=' + str(info.get('hash') or '')
        + ' loading=' + ('yes' if info.get('loading') else 'no')
        + ' overlay=' + str(info.get('overlay') or '')
    )
    agent._message_manager._add_message_with_tokens(HumanMessage(content=line))
    sys.stderr.write(f'[recorder] Injected fresh page observation: {line[:120]}\n')
    sys.stderr.flush()


def _schedule_fresh_page_observation(agent):
    """Schedule the fresh-page observation right after the sync cue injection.

    _emit_duplicate_failure_cue is called synchronously from the async
    on_step_end hook (recorder.py must not change), so the observation runs as
    a task on the running loop immediately after the hook returns — the line
    lands right after the cue in the message history. Failures are silent.
    """
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        task = loop.create_task(_fresh_page_observation(agent))

        def _swallow(t):
            if not t.cancelled():
                t.exception()

        task.add_done_callback(_swallow)
    except Exception:
        pass


def _emit_duplicate_failure_cue(business_data_store, agent, _actions, _last_result):
    """Inject [纠偏] cue when the same action+params failed twice in a row.

    Steering-only: failures must never abort the phase (same contract as
    _emit_empty_act_cue). Z3 escalation: the 2nd consecutive failure appends
    the retry-discipline rule; the 3rd+ consecutive failure injects the hard
    refusal prescription (cue-once-per-signature stays intact for level 2).
    """
    try:
        from scripts.feature_flags import duplicate_failure_cue_enabled
        if not duplicate_failure_cue_enabled():
            return
        if business_data_store is None:
            return
        from ..controller.actions.duplicate_failure_cue import (
            duplicate_failure_prescription,
            is_duplicate_failure,
            result_error_text,
            step_failed,
        )
        failed = step_failed(_last_result)
        should_cue, sig, fail_count = is_duplicate_failure(
            business_data_store, _actions, failed=failed
        )
        escalate = failed and fail_count >= 3
        if should_cue or escalate:
            err_text = result_error_text(_last_result)
            msg = HumanMessage(content=duplicate_failure_prescription(
                err_text, fail_count=fail_count,
            ))
            agent._message_manager._add_message_with_tokens(msg)
            sys.stderr.write(
                f'[recorder] Injected duplicate-failure cue sig={sig[:100]!r} '
                f'err={err_text[:100]!r} count={fail_count}\n'
            )
            sys.stderr.flush()
            _schedule_fresh_page_observation(agent)
    except Exception as e:
        sys.stderr.write(f'[recorder] duplicate-failure cue skipped: {e}\n')
        sys.stderr.flush()



def _emit_memory_action_event(agent, _actions, _last_result_str):
        # P1：动作事件打点（fill_before_save 建模用）——异步旁路，失败不阻塞
        try:
            from ..state import _CURRENT_PHASE
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
                            'select_tree_option', 'tssc_multi_select', 'fill_input'):
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
            from .. import controller as ctrl_mod
            _last_state = agent.state.history.history[-1].state if agent.state.history and agent.state.history.history else None
            if _last_state:
                _url = getattr(_last_state, 'url', '') or (_last_state.get('url') if isinstance(_last_state, dict) else '')
                if _url and _url != 'about:blank' and not _url.startswith('devtools://'):
                    ctrl_mod._TRAJECTORY_URL = _url
        except Exception:
            pass
        # ===== End URL capture =====



def _boundary_requires_evidence(business_data_store) -> bool:
    """True when phase boundary is active and success_when is non-empty (G3)."""
    try:
        from scripts.controller.actions._phase_boundary import (
            get_phase_boundary,
            phase_boundary_active,
        )
        if not phase_boundary_active(business_data_store):
            return False
        b = get_phase_boundary(business_data_store) or {}
        return bool(b.get('success_when'))
    except Exception:
        return False


def _guard_done_record_open_page_evidence(business_data_store, open_overlay) -> None:
    """Stamp ``page_opened`` for an open-page navigate phase.

    Two evidence sources, in order:

    1. A visible overlay at done() time. The click-time capture
       (click_action_engine) measures the overlay title immediately after the
       click; a drawer/dialog that renders asynchronously (or has no readable
       title) is missed there, so the G3 token gate would reject every ``done()``.
    2. The phase's own entry click. Some wizards open *inside the page* (inline
       steps, no new URL, no `.el-dialog`/`.el-drawer`), so no overlay/url
       evidence is ever observable — the gate would be unsatisfiable and the
       recording aborts (sid 591434fa phase 1: 评级申请 → inline 向导页,
       ``observed=[]`` on every step). A recorded business click this phase is
       the available open-page signal; the zero-business-action guard still
       rejects a no-click fake done.

    Always logs the check inputs so a deployment that did not load this guard is
    visible in the log (`open-page evidence check: ...`).
    """
    try:
        from scripts.controller.actions._phase_boundary import (
            get_phase_boundary,
            observed_kinds,
            phase_boundary_active,
            record_evidence,
        )
        if not phase_boundary_active(business_data_store):
            return
        b = get_phase_boundary(business_data_store) or {}
        if b.get('role') != 'navigate' or 'open_page' not in (b.get('goals') or []):
            return
        needed = set(b.get('success_when') or [])
        if not (needed & {'page_opened', 'url_change', 'dialog_confirmed'}):
            return
        have = observed_kinds(business_data_store)
        if have & needed:
            return
        n_actions = _count_phase_business_actions(business_data_store)
        sys.stderr.write(
            f'[recorder] open-page evidence check: overlay={str(open_overlay)[:60]!r} '
            f'actions={n_actions} observed={sorted(have)} needed={sorted(needed)}\n'
        )
        sys.stderr.flush()
        if open_overlay:
            record_evidence(business_data_store, 'page_opened', str(open_overlay)[:80])
            sys.stderr.write(
                f'[recorder] open-page evidence recorded from visible overlay '
                f'{str(open_overlay)[:60]!r}\n'
            )
            sys.stderr.flush()
            return
        if n_actions > 0:
            record_evidence(business_data_store, 'page_opened', 'open-page entry click')
            sys.stderr.write(
                '[recorder] open-page evidence recorded from the phase entry click '
                '(no overlay/url detected; inline wizard)\n'
            )
            sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f'[recorder] open-page evidence record skipped: {e}\n')
        sys.stderr.flush()


def _guard_done_nav_evidence_ok(business_data_store) -> bool:
    """True when a navigate-phase boundary's success_when evidence is satisfied.

    For navigate (open-page / wizard 下一步) a visible overlay is the target page
    or the next step, not unfinished work — the overlay gate must not reject
    ``done()`` once the phase's own evidence is present.
    """
    try:
        from scripts.controller.actions._phase_boundary import (
            get_phase_boundary,
            phase_boundary_active,
            phase_done_ok,
        )
        if not phase_boundary_active(business_data_store):
            return False
        b = get_phase_boundary(business_data_store) or {}
        if b.get('role') != 'navigate':
            return False
        ok, _ = phase_done_ok(business_data_store)
        return bool(ok)
    except Exception:
        return False


# Align with product META_STEP_ACTIONS / skip-screenshot observation ops.
_ZERO_STEP_META_ACTIONS = frozenset({
    'save_form_snapshot', 'scan_form_fields', 'scan_visible_fields',
    'get_page_state', 'get_pending_tasks', 'init_task_list',
    'sync_tasks_from_errors', 'task_done', 'task_retry', 'mark_field_done',
    'rebuild_task_list', 'match_form_rule', 'check_field_value',
    'verify_field_value', 'wait_for_loading', 'expand_all_el_tree',
    'take_screenshot', 'save_trajectory', 'save_business_data',
    'read_business_data', 'close_notification', 'done', 'wait',
    'scroll_down', 'scroll_up',
})


def _count_phase_business_actions(business_data_store=None) -> int:
    """Count non-meta recorded actions for the current phase (engine 0-step floor)."""
    try:
        from scripts import state as _state
        phase = int(getattr(_state, '_CURRENT_PHASE', 0) or 0)
        n = 0
        for entry in list(getattr(_state, '_ACTION_LOG', None) or []):
            if not isinstance(entry, dict):
                continue
            meta = entry.get('meta') if isinstance(entry.get('meta'), dict) else {}
            pn = meta.get('phaseNumber')
            if phase and pn is not None and int(pn) != phase:
                continue
            action = str(entry.get('action') or entry.get('action_type') or '').strip()
            if not action or action in _ZERO_STEP_META_ACTIONS:
                continue
            n += 1
        return n
    except Exception:
        return 0


def _guard_done_reject_zero_business_actions(agent, business_data_store, done_success) -> bool:
    """Reject done(success=true) when this phase has zero non-meta recorded actions."""
    if not done_success:
        return False
    if not _boundary_requires_evidence(business_data_store):
        return False
    if _count_phase_business_actions(business_data_store) > 0:
        return False
    try:
        from ..controller.actions._phase_intent import recovery_prescription_message
        from ..controller.actions._phase_intent import get_phase_intent
        contract = get_phase_intent(business_data_store)
        recovery = recovery_prescription_message(
            contract,
            reason='Premature done() rejected: zero business actions this phase (zero_step_fake_success).',
        )
    except Exception:
        recovery = (
            'Premature done() rejected: zero business actions this phase. '
            'Perform the required click/fill first, then done(success=true).'
        )
    sys.stderr.write(
        f'[recorder] ⚠ Premature done() — zero business actions at step '
        f'{getattr(getattr(agent, "state", None), "n_steps", "?")}\n'
    )
    sys.stderr.flush()
    try:
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
    except Exception:
        pass
    return True


def _guard_done_extract_success(_last_result) -> bool:
    """done 拦截-成功标志提取（原 _guard_done_on_step_end 顶段 176-188 段）。

    从 done() 结果列表检出显式 success 标志（ActionResult.success 或内嵌
    ``success": true`` / ``success=true`` 文本），heal / 录制两分支共用。
    """
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
    return done_success

def _guard_done_accept_heal(agent, _last_result, business_data_store, heal_mode, done_success):
    """done 拦截-heal 接受路径（原 194-220 段逐字搬移）。

    heal 模式无相位契约/overlay/保存门禁：记录结果 + phase outcome 后放行；
    子步骤失败只记日志不阻断。
    """
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
    if business_data_store is not None:
        try:
            from .. import state as action_state
            from ..controller.actions._phase_context import record_phase_outcome
            record_phase_outcome(
                business_data_store,
                action_state._CURRENT_PHASE,
                success=done_success,
                text=done_text or '',
            )
        except Exception as e:
            sys.stderr.write(f"[recorder] heal phase outcome save failed: {e}\n")
            sys.stderr.flush()
        business_data_store.pop('_heal_mode', None)

async def _guard_done_settle_loading(page):
    """done 拦截-加载掩码静置（原 224-238 段逐字搬移）。

    保存后导航常见 loading mask 短暂残留：最多等 5 秒（25×200ms）让页面稳定；
    评估失败静默，不影响门禁判定。
    """
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

async def _guard_done_capture_page_block(page):
    """done 拦截-页面可视块快照（原 240-297 段逐字搬移）。

    采集可见 dialog/drawer、错误通知、表单校验错误与当前 URL；
    返回 (open_overlay, error_notifs, form_errors, cur_url) 供后续门禁判定。
    """
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
    return open_overlay, error_notifs, form_errors, cur_url

def _guard_done_derive_flags(business_data_store, done_success, cur_url):
    """done 拦截-门禁派生态（原 299-316 段逐字搬移）。

    save/introduce/url 变更标志 + 相位契约 + navigated_ok（introduce 相位只认
    confirm token，强制 navigated_ok=False）。
    """
    from ..controller.actions._phase_intent import get_phase_intent, is_introduce_phase
    save_ok = bool(business_data_store and business_data_store.get('_last_save_ok'))
    introduce_ok = bool(business_data_store and business_data_store.get('_last_introduce_ok'))
    url_before_save = (business_data_store or {}).get('_url_before_save') or ''
    url_changed = bool(url_before_save and cur_url and url_before_save != cur_url)

    contract = get_phase_intent(business_data_store) if business_data_store else None

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
    return save_ok, introduce_ok, navigated_ok, contract

def _guard_done_reject_zero_actions(agent, business_data_store) -> bool:
    """done 拦截-零动作门禁（P6-0 假成功防线，session_runner 记基线、此处比对）。

    本阶段尚无任何已记录动作时拒绝 done()：防「进页即秒 done」假成功（T4 全波复现
    的 record/start 0 步 recorded 模式的引擎侧闸门）。首次拒绝注入提示让 agent 继续
    执行；二次 0 动作 done 放行（阶段可能确无动作，防 max_steps 死循环）。
    返回 True 表示已拒绝，调用方应中止后续门禁。
    """
    try:
        store = business_data_store if isinstance(business_data_store, dict) else {}
        baseline = store.get('_phase_start_action_len')
        if baseline is None:
            return False
        from ..state import _ACTION_LOG
        if len(_ACTION_LOG) > baseline:
            return False
        if store.get('_zero_action_rejects', 0) >= 1:
            return False
        store['_zero_action_rejects'] = store.get('_zero_action_rejects', 0) + 1
        try:
            msg = HumanMessage(content=(
                '【done 拒绝：本阶段 0 动作】尚未执行任何页面操作。请按阶段任务执行'
                '（导航/查询/点击/填表等），完成后再 done()。若该阶段确实无需任何动作，'
                '再次 done() 即可通过。'
            ))
            agent._message_manager._add_message_with_tokens(msg)
        except Exception:
            pass
        sys.stderr.write('[recorder] done rejected: zero actions in phase\n')
        sys.stderr.flush()
        return True
    except Exception as e:
        sys.stderr.write(f"[recorder] zero-action gate error: {e}\n")
        sys.stderr.flush()
        return False


def _guard_done_reject_pending_write(agent, business_data_store, contract) -> bool:
    """done 拦截-空写门禁（原 318-353 段逐字搬移）。

    all_editable 契约下仍有未写字段时拒绝 done()：标质量失败并改写历史结果
    （is_done=False + 恢复文案）。返回 True 表示已拒绝，调用方应中止后续门禁。
    """
    from ..controller.actions._phase_intent import check_pending_write_gate, mark_quality_failed
    # Write gate on done for all_editable
    if business_data_store and contract and contract.get('refill') == 'all_editable':
        from ..controller.actions.section_scope import resolve_phase_section

        _sec = resolve_phase_section(business_data_store)
        ok_pending, pending_labels = check_pending_write_gate(
            business_data_store, section=_sec
        )
        if not ok_pending:
            mark_quality_failed(
                business_data_store,
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
            return True
    return False

def _guard_done_claims(_last_result, done_success) -> tuple[str, bool]:
    """done 拦截-done 文本与「声称保存成功」检测（原 355-368 段逐字搬移）。

    返回 (done_text, claims_save_ok)：后者 = done 声称成功且文本含保存成功关键词。
    """
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
    return done_text, claims_save_ok

_PROBE_CLOSEOUT_SUFFIX = "（agent 步数耗尽，probe 收口）"

_PROBE_BUTTONS_MAX = 8


def _probe_overlay_button_texts() -> list[str]:
    """从最近一次 semantic_snapshot 结果取 overlay 按钮权威清单（收口附加用）。

    数据来源设计：agent 局部变量不出 _run_agent_step，semantic 结果随
    extracted_content 落 agent.state.history（service._last_agent 全局可达），
    故此函数自行回读最近一次 semantic_snapshot 的 ``ok:{...json}``，从
    context.overlay.buttons 取 text（空则兜底 ariaLabel）。列表可空——
    无 agent / 无 semantic 结果 / JSON 坏值 / overlay 为 null 一律返回 []。
    """
    texts: list[str] = []
    try:
        from . import service as _agent_service
        agent = getattr(_agent_service, '_last_agent', None)
        if agent is None:
            return texts
        done_text = ''
        for h in reversed(agent.state.history.history):
            if not getattr(h, 'result', None):
                continue
            for r in reversed(h.result):
                done_text = str(getattr(r, 'extracted_content', None) or '')
                if done_text.startswith('ok:') and '"overlay"' in done_text:
                    break
            if done_text.startswith('ok:') and '"overlay"' in done_text:
                break
        if not done_text.startswith('ok:'):
            return texts
        payload = json.loads(done_text[3:])
        overlay = ((payload or {}).get('context') or {}).get('overlay') or {}
        for b in (overlay.get('buttons') or []):
            if not isinstance(b, dict):
                continue
            label = str(b.get('text') or b.get('ariaLabel') or '').strip()[:20]
            if label:
                texts.append(label)
    except Exception:
        return []
    return texts


def probe_force_close_context(business_data_store, agent=None):
    """probe 收口语境：返回 (reason, last_done_text)。

    reason 优先级：_quality_failed_reasons（done 门禁拒绝原因登记，逗号 join）
    → agent history 最后一次 done 拒绝文案（剥 'Premature done()' 前缀）
    → 'zero actions in phase'。last_done_text = history 最后一段非空
    extracted_content（agent 最后一次 done 声明/摘要）。只读，不写 store。
    """
    reason = ''
    last_done_text = ''
    try:
        reasons = list((business_data_store or {}).get('_quality_failed_reasons') or [])
    except Exception:
        reasons = []
    if reasons:
        reason = ', '.join(str(r) for r in reasons)
    if agent is not None:
        try:
            for h in reversed(agent.state.history.history):
                if not getattr(h, 'result', None):
                    continue
                for r in reversed(h.result):
                    if not last_done_text and getattr(r, 'extracted_content', None):
                        last_done_text = str(r.extracted_content).strip()
                    if not reason:
                        _err = str(getattr(r, 'error', None) or '')
                        if 'Premature done()' in _err:
                            reason = re.sub(
                                r'^.*?Premature done\(\)\s*(rejected:\s*)?', '', _err
                            ).strip().rstrip('.')
                if reason and last_done_text:
                    break
        except Exception:
            pass
    if not reason:
        reason = 'zero actions in phase'
    return reason, last_done_text


def record_probe_done_log(business_data_store, phase_number, *, reason, last_done_text=''):
    """probe 收口合成 outcome（与正常 done 同通路：_phase_outcomes）。

    已有 accepted outcome 时不覆盖（返回 None）；success=None 维持 unknown
    语义（控制面不伪造成败）；text 封顶 400（同 record_phase_outcome 口径）。
    text 在固定后缀之前附加 overlay 按钮权威清单（来自最近一次
    semantic_snapshot，最多 8 个、单个标签截 20 字防文本爆炸——#910④
    「弹窗无 footer 提交按钮」认知缺口治理：收口时把弹窗里实际存在的按钮
    留给 agent/回放侧）。
    返回写入的条目 dict（与 store 内为同一对象），None store / 非法相位 / 不
    覆盖时返回 None。控制面 recordPhaseResult 经 phase_done.text →
    appendPhaseDoneLog(source='agent') 落 doneLogs——probe 合成条目随事件落库。
    """
    if business_data_store is None:
        return None
    try:
        from ..controller.actions.phase.outcomes import truncate_text
        phase = int(phase_number)
    except (TypeError, ValueError):
        return None
    except Exception:
        return None
    store = business_data_store.setdefault('_phase_outcomes', {})
    existing = store.get(phase)
    if isinstance(existing, dict):
        return None
    text = f"probe force-close: {reason}"
    _btns = _probe_overlay_button_texts()[:_PROBE_BUTTONS_MAX]
    if _btns:
        text += f" | overlay buttons: {''.join(f'[{b}]' for b in _btns)}"
    text += _PROBE_CLOSEOUT_SUFFIX
    if last_done_text:
        text += f" — {str(last_done_text).strip()[-120:]}"
    entry = {'success': None, 'text': truncate_text(text, 400), 'source': 'probe'}
    store[phase] = entry
    return entry


def _guard_done_reject_missing_token(agent, business_data_store, contract, done_success, introduce_ok, needs_token) -> bool:
    """done 拦截-缺失成功令牌门禁（原 375-416 段逐字搬移）。

    契约要求 submit 且 done 声称成功但无 success token → 拒绝并给出恢复指引
    （introduce 相位例外）。返回 True 表示已拒绝。
    """
    from ..controller.actions._phase_intent import has_contract_success, is_introduce_phase, recovery_prescription_message
    if needs_token and done_success and not has_contract_success(business_data_store):
        if not (introduce_ok and contract and is_introduce_phase(contract)):
            missing_hint = ''
            missing: list[str] = []
            try:
                from scripts.controller.actions._phase_boundary import (
                    get_phase_boundary,
                    observed_kinds,
                    phase_done_ok,
                )
                ok_b, missing = phase_done_ok(business_data_store)
                b = get_phase_boundary(business_data_store) or {}
                missing_hint = (
                    f" success_when={list(b.get('success_when') or [])}"
                    f" observed={sorted(observed_kinds(business_data_store))}"
                    f" missing={missing} ok={ok_b}"
                )
            except Exception:
                missing_hint = ''
            # done 熔断（2026-09-18 冲突普查）：同一 missing 集连续拒绝达 3 次 →
            # 判定合同可能不可满足，熔断放行本次 done——宁 bounded 放松不 unbounded
            # 死锁。事故背景：2026-09-17 评级重置阶段 LLM 判对 mode=other 但规则
            # 误判 query 合同，门禁听规则 → done 死循环 6 次 + 预算 +42。放行只
            # 跳过本守卫，门禁链后续守卫（zero-business-actions/overlay/errors/
            # legacy_claim）照常执行；熔断时不再改写 history（跳过下方循环）。
            if missing and business_data_store is not None:
                _key = tuple(sorted(missing))
                _streak = business_data_store.get('_done_token_reject_streak')
                if not (isinstance(_streak, dict) and _streak.get('key') == _key):
                    _streak = {'key': _key, 'count': 0}
                _first_reject = int(_streak.get('count') or 0) == 0
                if int(_streak.get('count') or 0) >= 3:
                    business_data_store['_phase_contract_suspect'] = True
                    # A4 降噪：✂ 行只在转移点（首次放行）打一次，之后放行静默
                    # （#867 P5 连续同文行）；suspect 照常置位、history 照常不改写。
                    if not business_data_store.get('_phase_suspect_logged'):
                        business_data_store['_phase_suspect_logged'] = True
                        sys.stderr.write(
                            f"[recorder] ✂ contract suspect — missing-token gate bypassed "
                            f"after {_streak.get('count')} identical rejections "
                            f"(missing={list(_key)}) — possible unsatisfiable contract\n"
                        )
                        sys.stderr.flush()
                    return False
                _streak['count'] = int(_streak.get('count') or 0) + 1
                business_data_store['_done_token_reject_streak'] = _streak
            else:
                # 无 missing / 无 boundary 时熔断不参与，拒绝行保持逐次全量
                _first_reject = True
            submit = (contract or {}).get('submit') or {}
            recovery = recovery_prescription_message(
                contract,
                reason='Premature done() rejected: missing success token.',
            )
            # A4 降噪（2026-09-18 wet5 traj #866-868）：同一 missing 集的重复拒绝
            # 此前每次都打全量 stderr 行（#867 P5 连续 9 次 = 9 行近重复）。全量
            # 细节（mode/submit/missing_hint）仅首次打印，重复拒只打短行留存在感；
            # 换 missing 集（streak key 变化）视为新序列，重新给全量行。
            if _first_reject:
                sys.stderr.write(
                    f"[recorder] ⚠ Premature done() — no success token at step "
                    f"{agent.state.n_steps} mode={(contract or {}).get('mode')} "
                    f"submit.required={bool(submit.get('required'))}"
                    f"{missing_hint}\n"
                )
            else:
                sys.stderr.write(
                    f"[recorder] ⚠ Premature done() — no success token (repeat "
                    f"x{_streak['count'] if isinstance(_streak, dict) else '?'}"
                    f" same missing) at step {agent.state.n_steps}\n"
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
            return True
    return False

def _guard_done_reject_legacy_claim(agent, business_data_store, save_ok, navigated_ok, introduce_ok, needs_token, claims_save_ok) -> bool:
    """done 拦截-旧路径声称保存成功门禁（原 418-443 段逐字搬移）。

    无契约（或契约不要求 submit）时 done 声称成功但无 ok-save-success /
    URL 变化 → 拒绝。返回 True 表示已拒绝。
    """
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
        return True
    return False

def _guard_done_reject_overlay(agent, business_data_store, contract, open_overlay, navigated_ok, save_ok, introduce_ok, nav_evidence_ok: bool = False) -> bool:
    """done 拦截-可见 overlay 门禁（原 445-475 段逐字搬移）。

    契约不允许 overlay 时拒绝（改写历史结果）；契约允许时仅记录放行日志。
    ``nav_evidence_ok``（navigate 阶段 success_when 已满足）时，可见 overlay 就是
    目标页面/下一步本身，放行不拒（sid 3718d161 阶段1：打开抽屉式向导）。
    返回 True 表示已拒绝。
    """
    from ..controller.actions._phase_intent import overlay_blocks_done
    if open_overlay and not navigated_ok and not save_ok and not introduce_ok and nav_evidence_ok:
        sys.stderr.write(
            f"[recorder] overlay {open_overlay} present but navigate evidence satisfied "
            f"at step {agent.state.n_steps} — allow done (target page/next step)\n"
        )
        sys.stderr.flush()
        return False
    # A picker-confirm phase may intentionally leave its parent wizard/drawer
    # open for the next phase.  `_last_introduce_ok` is the scoped evidence that
    # the child picker was closed; do not mistake the parent overlay for an
    # unfinished phase and inject close_dialog().
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
            return True
        from ..controller.actions.phase.reviewer import coerce_bool
        submit = (contract or {}).get('submit') or {}
        kinds = ((contract or {}).get('success') or {}).get('kinds') or []
        sys.stderr.write(
            f"[recorder] overlay present ({open_overlay}) but contract allows done "
            f"(submit.required={coerce_bool(submit.get('required'))}, kinds={list(kinds)}) "
            f"at step {agent.state.n_steps}\n"
        )
        sys.stderr.flush()
    return False

def _guard_done_reject_errors(agent, business_data_store, contract, error_notifs, form_errors, navigated_ok, save_ok, introduce_ok) -> bool:
    """done 拦截-可见错误门禁（原 477-509 段逐字搬移）。

    可见错误通知/表单校验错误且契约不允许时拒绝（改写历史结果）；
    契约允许时仅记录放行日志。返回 True 表示已拒绝。

    P6-0 v2（#612/#614 移交）：表单校验红字（.el-form-item__error）在页面上
    可见且未发生跳转时，保存必然未成功——``save_ok``（含 form_save 静默保存
    分支）/``introduce_ok`` 不再豁免 form_errors（error_notifs 维持原语义，
    契约宽松时可放行）。
    """
    from ..controller.actions._phase_intent import overlay_blocks_done
    form_err_hit = bool(form_errors) and not navigated_ok
    notif_hit = bool(error_notifs) and not navigated_ok and not save_ok and not introduce_ok
    if form_err_hit or notif_hit:
        if form_err_hit or overlay_blocks_done(contract):
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
            return True
        from ..controller.actions.phase.reviewer import coerce_bool
        submit = (contract or {}).get('submit') or {}
        kinds = ((contract or {}).get('success') or {}).get('kinds') or []
        sys.stderr.write(
            f"[recorder] visible errors present (notifs={error_notifs[:2]} "
            f"formErrors={form_errors[:3]}) but contract allows done "
            f"(submit.required={coerce_bool(submit.get('required'))}, kinds={list(kinds)}) "
            f"at step {agent.state.n_steps}\n"
        )
        sys.stderr.flush()
    return False

def _guard_done_accept_success(agent, business_data_store, contract, done_success, save_ok, introduce_ok, navigated_ok):
    """done 拦截-接受路径（原 511-538 段逐字搬移）：记录接受原因并清理相位残留键。"""
    if navigated_ok or save_ok or introduce_ok:
        try:
            from ..controller.actions.phase.intent_gates import done_accept_reason
            reason = done_accept_reason(
                contract,
                save_ok=bool(save_ok),
                introduce_ok=bool(introduce_ok),
                navigated_ok=bool(navigated_ok),
            )
        except Exception:
            reason = 'introduce' if introduce_ok else ('save-ok' if save_ok else 'navigation')
        sys.stderr.write(
            f"[recorder] ✓ done() accepted after {reason} "
            f"(success={done_success}) at step {agent.state.n_steps}\n"
        )
        sys.stderr.flush()
        # Clear stale task_list so the next phase starts clean
        if business_data_store is not None:
            business_data_store.pop('task_list', None)
            business_data_store.pop('_scan_fields', None)
            business_data_store.pop('_submit_ready', None)
            business_data_store.pop('_query_ready', None)
            business_data_store.pop('_query_ui', None)
            business_data_store.pop('_autofill_summary', None)
            business_data_store.pop('_last_save_ok', None)
            business_data_store.pop('_last_introduce_ok', None)
            business_data_store.pop('_url_before_save', None)
            business_data_store.pop('_success_tokens', None)

def _append_kb_staging(business_data_store, done_text, staging_path=None):
    """done 接受后把已注入 KB 流程知识的使用情况追加到 staging JSONL。

    仅当 business_data_store 带 _kb_flow_name 时写（T-A 注入的标记）；
    任何异常静默（回流不阻塞主链路）。返回写入的条目 dict 或 None。
    """
    try:
        import os
        import time as _time

        from scripts.kb import store as _kb_store

        flow = (business_data_store or {}).get('_kb_flow_name')
        if not flow:
            return None
        if staging_path is None:
            staging_path = _kb_store.STAGING_FILE
        entry = {
            "ts": _time.strftime("%Y-%m-%dT%H:%M:%S"),
            "flow": flow,
            "done_text": str(done_text or "")[:200],
            "summary": str((business_data_store or {}).get('_kb_flow_summary') or "")[:300],
        }
        os.makedirs(os.path.dirname(staging_path), exist_ok=True)
        with open(staging_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry
    except Exception:
        return None


def _guard_done_persist_outcome(business_data_store, done_success, done_text):
    """done 拦截-结果落账（原 541-579 段逐字搬移）。

    phase outcome 写入 business_data_store + 外部记忆 append-only 事件；
    两段自带异常分类，失败不阻断回放主链。
    """
    # Persist done() outcome for next-phase business-scenario preamble
    if business_data_store is not None:
        try:
            from .. import state as action_state
            from ..controller.actions._phase_context import record_phase_outcome
            record_phase_outcome(
                business_data_store,
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
    if done_success:
        try:
            _append_kb_staging(business_data_store, done_text)
        except Exception:
            pass

async def _guard_done_on_step_end(agent, _last_result, business_data_store) -> bool:
    """done() 拦截总闸（原 420 行单函数拆分后的编排层，门禁逻辑见各 _guard_* 子函数）。

    拆分保持对外行为不变：heal 直通；录制路径按 零动作门禁 → 空写门禁 → 成功令牌门禁 →
    旧路径声称 → overlay 门禁 → 错误门禁 逐个拦截，任一拒绝即提前返回（调用方
    recorder.on_step_end 停止后续步骤处理）。异常统一走外层分类：记
    ``[recorder] done-check error`` 后放行（返回 False）。
    """
    try:
        from ..controller.actions._phase_context import is_heal_mode
        page = await agent.browser_context.get_current_page()
        # Prefer explicit success from the done() action
        done_success = _guard_done_extract_success(_last_result)

        # ===== Heal done vs recording done (separate rules) =====
        # Heal: no phase-intent contract; accept after redo intent.
        # Recording: overlay / save / contract token gates in the else branch.
        heal_mode = (business_data_store or {}).get('_heal_mode') if business_data_store else None
        if heal_mode and is_heal_mode(business_data_store):
            _guard_done_accept_heal(agent, _last_result, business_data_store, heal_mode, done_success)
        else:
            # Recording done gates only
            heal_mode = None
            await _guard_done_settle_loading(page)
            open_overlay, error_notifs, form_errors, cur_url = await _guard_done_capture_page_block(page)
            save_ok, introduce_ok, navigated_ok, contract = _guard_done_derive_flags(
                business_data_store, done_success, cur_url,
            )
            # Open-page navigate: a visible target overlay at done() time is the
            # page_opened evidence when the click-time capture missed an async
            # drawer/dialog render (sid 3718d161 phase 1).
            _guard_done_record_open_page_evidence(business_data_store, open_overlay)
            if _guard_done_reject_zero_actions(agent, business_data_store):
                return True
            if _guard_done_reject_pending_write(agent, business_data_store, contract):
                return True
            done_text, claims_save_ok = _guard_done_claims(_last_result, done_success)
            # G3: need evidence token when submit.required OR boundary success_when non-empty
            needs_token = bool(contract) and (
                bool((contract.get('submit') or {}).get('required'))
                or _boundary_requires_evidence(business_data_store)
            )
            # 拒绝分支必须 `return True`：返回值由 recorder.py 按 truthy 判定
            # （`if await _guard_done_on_step_end(...): return`），裸 return 会返回
            # None → 被当成"未拒绝"而放行 done，零业务步守卫形同虚设。
            if _guard_done_reject_zero_business_actions(
                agent, business_data_store, done_success,
            ):
                return True
            if _guard_done_reject_missing_token(
                agent, business_data_store, contract, done_success, introduce_ok, needs_token,
            ):
                return True
            if _guard_done_reject_legacy_claim(
                agent, business_data_store, save_ok, navigated_ok, introduce_ok,
                needs_token, claims_save_ok,
            ):
                return True
            nav_evidence_ok = _guard_done_nav_evidence_ok(business_data_store)
            if _guard_done_reject_overlay(
                agent, business_data_store, contract, open_overlay,
                navigated_ok, save_ok, introduce_ok,
                nav_evidence_ok=nav_evidence_ok,
            ):
                return True
            if _guard_done_reject_errors(
                agent, business_data_store, contract, error_notifs, form_errors,
                navigated_ok, save_ok, introduce_ok,
            ):
                return True
            _guard_done_accept_success(
                agent, business_data_store, contract, done_success,
                save_ok, introduce_ok, navigated_ok,
            )
            # else: no visible blockers — allow done() (including success=false reports)
            _guard_done_persist_outcome(business_data_store, done_success, done_text)
    except Exception as e:
        sys.stderr.write(f"[recorder] done-check error: {e}\n")
        sys.stderr.flush()
    return False


def _emit_navigation_cue(business_data_store, agent):
    """Inject a [导航] HumanMessage when an index click navigated to a new page (E5).

    Steering-only: never abort the phase. Recorded step stays ok-clicked-N.
    """
    try:
        from scripts.feature_flags import click_nav_cue_enabled
        if not click_nav_cue_enabled():
            return
        nav = (business_data_store or {}).get('_last_click_navigated')
        if not isinstance(nav, dict) or not nav.get('to'):
            return
        if business_data_store is not None:
            business_data_store.pop('_last_click_navigated', None)
        from ..controller.actions.click_navigation_cue import navigation_cue_message
        msg = HumanMessage(content=navigation_cue_message(nav.get('from') or '', nav.get('to') or ''))
        agent._message_manager._add_message_with_tokens(msg)
        sys.stderr.write(f"[recorder] Injected navigation cue to={nav.get('to', '')[:80]!r}\n")
        sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f'[recorder] navigation cue skipped: {e}\n')
        sys.stderr.flush()


async def _emit_step_notice_scan(agent, business_data_store, step: int = 0, raw_actions=None) -> None:
    """Per-step page feedback → [step-feedback] (steering-only, session memory)."""
    try:
        from scripts.agent.step_notice import scan_and_emit_step_notices
        await scan_and_emit_step_notices(
            agent, business_data_store, step=step, raw_actions=raw_actions,
        )
    except Exception as e:
        sys.stderr.write(f'[recorder] step-notice skipped: {e}\n')
        sys.stderr.flush()


_SUT_SPIN_GUARD_PROBE_JS = """
() => {
  const collapse = (s) => (s || '').replace(/\\s+/g, ' ').toLowerCase();
  return {
    title: collapse(document.title).slice(0, 300),
    text: collapse(document.body ? document.body.innerText : '').slice(0, 4000),
    url: location.href,
    keyDom: !!document.querySelector('.el-form, .el-table, .el-tree, .el-dialog, .el-drawer, .el-container'),
  };
}
"""


async def _guard_spin_on_step_end(agent, business_data_store, goal_tracker, current_actions):
    """D2 SUT 503 阶段空转守卫（#925）：A(SUT 不可达)+B(无进展) 双条件止损。

    每步 on_step_end 调用。默认 off 零 I/O；stall 窗口满后才做一次页面探测；
    soft/hard 触发=直发 phase_error(reason=sut_unavailable_spin_guard)+停 agent。
    幂等按 phase+runId 作用域：同 run 同相位不重复发；换 run 重录（重录路径同
    runtime 换 runId 再录、同 store 重入同相位号）或阶段推进自动重新武装。
    返回 True 表示已触发止损（调用方应 return）；任何异常吞掉返 False。
    """
    try:
        import os
        mode = str(os.environ.get('SUT_SPIN_GUARD_MODE') or 'off').strip().lower()
        if mode not in ('observation', 'soft', 'hard'):
            return False          # off 或未知值：立即返回，此前不得访问 store/页面

        def _win(name, default):
            try:
                return max(1, int(os.environ.get(name) or default))
            except (TypeError, ValueError):
                return default

        progress_window = _win('SUT_SPIN_GUARD_PROGRESS_WINDOW', 6)
        text_window = _win('SUT_SPIN_GUARD_503_TEXT_WINDOW', 1)
        dom_window = _win('SUT_SPIN_GUARD_DOM_MISSING_WINDOW', 3)

        store = business_data_store
        # ===== 排除项（计数与触发都不做，直接 return False）=====
        if store is None:
            return False
        if store.get('_heal_mode'):
            return False
        if store.get('_task_mode') == 'query' or store.get('_query_task') or store.get('_query_ui'):
            return False
        if any('"wait_for_loading"' in str(a) for a in (current_actions or [])):
            return False

        from ..state import get_current_phase, get_current_run_id   # lazy，触发分支里再 import emit_json
        phase = int(get_current_phase() or 0)
        run_id = get_current_run_id()

        # ===== 进展信号（全部内存读取，零页面 I/O）=====
        raw = store.get('task_list')
        try:
            from ..models.task import TaskList
            count = len(TaskList.from_store(raw).done)
        except Exception:
            count = 0
        _last_state = agent.state.history.history[-1].state if agent.state.history and agent.state.history.history else None
        url = getattr(_last_state, 'url', '') or (_last_state.get('url') if isinstance(_last_state, dict) else '')
        path = url.split('#')[0].split('?')[0] if url else ''
        container = str(store.get('_active_container') or '')

        # ===== 阶段/run 自动重置（基线初始化为当前值）=====
        # run 维度（F1 终审阻断修复）：重录路径同 runtime 换 runId 再录、失败收尾
        # 不关 session → 同 Python 进程同 business_data_store 重入同相位号。换 run
        # 必须重置计数并 pop 触发戳重新武装，否则重录相位被旧戳 neuter——每步
        # on_step_end 被过早 return，done 门禁/循环检测/CSS 补抓整段失效，
        # #925 空转问题在重录中复活。
        if store.get('_spin_guard_phase') != phase or store.get('_spin_guard_run_id') != run_id:
            store['_spin_guard_phase'] = phase
            store['_spin_guard_run_id'] = run_id
            store['_spin_guard_stall_steps'] = 0
            store['_spin_guard_a1_hits'] = 0
            store['_spin_guard_a3_steps'] = 0
            store['_spin_guard_a4_steps'] = 0
            store['_spin_guard_seen_containers'] = []
            store['_spin_guard_last_done_count'] = count
            store['_spin_guard_last_path'] = path
            store.pop('_spin_guard_triggered', None)   # 重新武装

        # ===== 触发幂等：同 phase+同 run 已触发过不再重复发 phase_error =====
        # （换 run 重录或阶段推进由上方重置块 pop 戳重新武装后可再次触发）
        _prev_triggered = store.get('_spin_guard_triggered')
        if (
            isinstance(_prev_triggered, dict)
            and _prev_triggered.get('phase') == phase
            and _prev_triggered.get('runId') == run_id
        ):
            return True

        # ===== 进展判定（任一成立即进展）=====
        last_done = int(store.get('_spin_guard_last_done_count') or 0)
        last_path = str(store.get('_spin_guard_last_path') or '')
        seen = list(store.get('_spin_guard_seen_containers') or [])
        progressed = (
            count > last_done
            or bool(path and path != last_path)
            or bool(container and container not in seen)
        )
        if progressed:
            store['_spin_guard_last_done_count'] = count
            store['_spin_guard_last_path'] = path
            if container and container not in seen:
                seen.append(container)
                store['_spin_guard_seen_containers'] = seen
            store['_spin_guard_stall_steps'] = 0
            store['_spin_guard_a1_hits'] = 0
            store['_spin_guard_a3_steps'] = 0
            store['_spin_guard_a4_steps'] = 0
            return False
        # 无进展：stall 累加，基线始终刷新
        stall = int(store.get('_spin_guard_stall_steps') or 0) + 1
        store['_spin_guard_stall_steps'] = stall
        store['_spin_guard_last_done_count'] = count
        store['_spin_guard_last_path'] = path

        # ===== 窗口未满：零页面 I/O =====
        if stall < progress_window:
            return False

        # ===== 页面探测（stall 满窗后，一次 evaluate）=====
        page = await agent.browser_context.get_current_page()
        info = await page.evaluate(_SUT_SPIN_GUARD_PROBE_JS) or {}

        # A 判定（本步），优先级 A1 > A3 > A4
        hay = str(info.get('title') or '') + ' ' + str(info.get('text') or '')
        if any(m in hay for m in (
                'service unavailable', '服务不可用', 'bad gateway',
                'gateway timeout', 'gateway time-out')):
            a1_hits = int(store.get('_spin_guard_a1_hits') or 0) + 1
        else:
            a1_hits = 0
        store['_spin_guard_a1_hits'] = a1_hits

        u = str(info.get('url') or '').lower()
        if any(m in u for m in (
                '/error', '/503', '/502', '/504',
                'service-unavailable', 'service_unavailable')):
            a3_steps = int(store.get('_spin_guard_a3_steps') or 0) + 1
        else:
            a3_steps = 0
        store['_spin_guard_a3_steps'] = a3_steps

        if not info.get('keyDom'):
            a4_steps = int(store.get('_spin_guard_a4_steps') or 0) + 1
        else:
            a4_steps = 0
        store['_spin_guard_a4_steps'] = a4_steps

        if a1_hits >= text_window:
            signal = 'page_text_503'
        elif a3_steps >= 2:
            signal = 'url_error_page'
        elif a4_steps >= dom_window:
            signal = 'dom_missing'
        else:
            return False

        # ===== 触发 =====
        n = int(getattr(agent.state, 'n_steps', 0) or 0)
        if mode == 'observation':
            sys.stderr.write(
                f'[spin-guard] observed phase={phase} step={n} '
                f'reason=sut_unavailable_spin_guard sut={signal} '
                f'progress_window={stall}/{progress_window}\n'
            )
            sys.stderr.flush()
            store['_spin_guard_observed_last'] = {
                'mode': 'observation',
                'sutSignal': signal,
                'phase': phase,
                'step': n,
                'stepsSinceProgress': stall,
                'progressWindow': progress_window,
            }
            return False

        from ..agent_utils import emit_json   # lazy，勿在模块顶部 import
        payload = {
            'phase': phase,
            'name': f'phase {phase}',
            'message': '阶段在 SUT 不可达且无实质进展时停止（sut_unavailable_spin_guard）',
            'reason': 'sut_unavailable_spin_guard',
            'spinGuard': {
                'mode': mode,
                'sutSignal': signal,
                'progressWindow': progress_window,
                'stepsSinceProgress': stall,
            },
        }
        run_id = get_current_run_id()
        if run_id:
            payload['runId'] = run_id
        emit_json({'event': 'phase_error', 'data': payload})
        store['_spin_guard_triggered'] = {
            'mode': mode,
            'sutSignal': signal,
            'phase': phase,
            'runId': run_id,
            'step': n,
            'stepsSinceProgress': stall,
            'progressWindow': progress_window,
        }
        if mode == 'soft':
            # 预留台账标志，当前无消费方（设计稿 §10 dashboard 候选）
            store['_spin_guard_soft_triggered'] = True
        sys.stderr.write(
            f'[spin-guard] {mode} triggered phase={phase} step={n} '
            f'reason=sut_unavailable_spin_guard sut={signal} '
            f'progress_window={stall}/{progress_window}\n'
        )
        sys.stderr.flush()
        agent.state.stopped = True
        if goal_tracker is not None:
            goal_tracker['stopped'] = True
        return True
    except Exception as e:
        sys.stderr.write(f'[spin-guard] error: {e}\n')
        sys.stderr.flush()
        return False
