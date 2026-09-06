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
                            'select_tree_option', 'fill_input'):
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

def _guard_done_reject_missing_token(agent, business_data_store, contract, done_success, introduce_ok, needs_token) -> bool:
    """done 拦截-缺失成功令牌门禁（原 375-416 段逐字搬移）。

    契约要求 submit 且 done 声称成功但无 success token → 拒绝并给出恢复指引
    （introduce 相位例外）。返回 True 表示已拒绝。
    """
    from ..controller.actions._phase_intent import has_contract_success, is_introduce_phase, recovery_prescription_message
    if needs_token and done_success and not has_contract_success(business_data_store):
        if not (introduce_ok and contract and is_introduce_phase(contract)):
            missing_hint = ''
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

def _guard_done_reject_overlay(agent, business_data_store, contract, open_overlay, navigated_ok, save_ok, introduce_ok) -> bool:
    """done 拦截-可见 overlay 门禁（原 445-475 段逐字搬移）。

    契约不允许 overlay 时拒绝（改写历史结果）；契约允许时仅记录放行日志。
    返回 True 表示已拒绝。
    """
    from ..controller.actions._phase_intent import overlay_blocks_done
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
    """
    from ..controller.actions._phase_intent import overlay_blocks_done
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

    拆分保持对外行为不变：heal 直通；录制路径按 空写门禁 → 成功令牌门禁 →
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
            if _guard_done_reject_pending_write(agent, business_data_store, contract):
                return
            done_text, claims_save_ok = _guard_done_claims(_last_result, done_success)
            # Claiming save success without token when contract requires submit
            needs_token = bool(
                contract
                and (contract.get('submit') or {}).get('required')
            )
            if _guard_done_reject_missing_token(
                agent, business_data_store, contract, done_success, introduce_ok, needs_token,
            ):
                return
            if _guard_done_reject_legacy_claim(
                agent, business_data_store, save_ok, navigated_ok, introduce_ok,
                needs_token, claims_save_ok,
            ):
                return
            if _guard_done_reject_overlay(
                agent, business_data_store, contract, open_overlay,
                navigated_ok, save_ok, introduce_ok,
            ):
                return
            if _guard_done_reject_errors(
                agent, business_data_store, contract, error_notifs, form_errors,
                navigated_ok, save_ok, introduce_ok,
            ):
                return
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
