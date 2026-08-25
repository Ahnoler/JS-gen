"""click_save engine (extracted from _form.py — Slice 2 of form-actions-split).

行为零 diff 搬迁：闸门、region/section 解析、歧义、toast/导航/静默判定、
picker confirm 分支均保持原实现；闭包捕获改为构造注入。
"""

import json
import re
import sys

from scripts.state import _record_action
from ._helpers import (
    _ok, _err, _as_dict,
    _wait_if_loading, _enrich_click_element,
)
from ._js_snippets import (
    JS_IDENTIFY_CONTAINER, JS_IS_QUERY_TOOLBAR,
    JS_CHECK_SINGLE_FIELD, JS_SCAN_FORM_FIELDS,
    JS_SCROLL_TO_FIRST_ERROR,
    JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME, JS_WATCH_SAVE_NOTIFICATIONS,
)
from ...models import TaskList
from .form_scan_utils import refresh_scan_buttons, _mark_query_ui_if_needed
from .form_action_engines import _FormActionEngineBase


class SaveEngine(_FormActionEngineBase):
    async def click_save(self, button_text: str = '保存', section: str = '', region: str = ''):
        from ._phase_intent import check_pending_write_gate, contract_force_refill, record_success_token
        from .section_scope import (
            clear_phase_section,
            remember_phase_section,
            resolve_scope,
            save_retry_scope,
        )

        page = await self.browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        compact_btn = re.sub(r'\s+', '', (button_text or '保存').strip()) or '保存'
        # LEGACY_SECTION_RETIRE: region= preferred; section= kept for compat.
        sec = resolve_scope(region, section)
        explicit_sec = bool(sec)
        # Resolve: explicit → multi-save gate → sticky memory → unique → ""
        if not sec and not explicit_sec:
            try:
                await refresh_scan_buttons(page, self.business_data_store)
            except Exception:
                pass
            try:
                from .section_scope import same_label_section_keys, norm_sec
                keys = same_label_section_keys(
                    self.business_data_store.get("_scan_buttons"), compact_btn
                )
                if len(keys) >= 2:
                    sys.stderr.write(
                        f'[click_save] skip sticky; multi-section {compact_btn!r} keys={keys!r}\n'
                    )
                    sys.stderr.flush()
                    # leave sec empty → JS_CLICK_SAVE_BUTTON returns ambiguous
                else:
                    mem = norm_sec(str(self.business_data_store.get("_phase_section") or ""))
                    if mem:
                        sec = mem
                        sys.stderr.write(f'[click_save] phase section={sec!r} from memory\n')
                        sys.stderr.flush()
                    if not sec:
                        from .section_scope import unique_button_section
                        auto_sec = unique_button_section(
                            self.business_data_store.get("_scan_buttons"), compact_btn
                        )
                        if auto_sec:
                            sec = auto_sec
                            sys.stderr.write(
                                f'[click_save] auto region={auto_sec!r} from unique button\n'
                            )
                            sys.stderr.flush()
            except Exception:
                pass
        if sec:
            from .section_scope import remember_phase_section
            remember_phase_section(self.business_data_store, sec)
        # 确认/确定 = dialog/picker confirm (never treat as form-save blocked by query toolbar)
        is_picker_confirm = bool(
            compact_btn.startswith(('确认', '确定'))
            or ('确认' in compact_btn)
            or ('确定' in compact_btn)
        )
        query_ui = await _mark_query_ui_if_needed(page, self.business_data_store, container_id)
        sys.stderr.write(
            f'[click_save] enter button={button_text!r} section={sec!r} compact={compact_btn!r} '
            f'query_ui={query_ui} picker_confirm={is_picker_confirm}\n'
        )
        sys.stderr.flush()
        if query_ui and not is_picker_confirm:
            return _err(
                'not-form-save | query/filter UI — NOT a form-fill submit. '
                'Click 查询 via click_element_by_index; '
                'for picker 确认 use click_element_by_index or click_save(button_text="确认").',
                include_in_memory=True,
            )
        if is_picker_confirm and query_ui:
            # Magnifier/picker: 确认 is introduce confirm, not maintain click_save.
            sys.stderr.write(
                f'[click_save] picker confirm via click_save({button_text!r}) on query UI\n'
            )
            sys.stderr.flush()
            gate_ok, pending_labels = True, []
        else:
            if not is_picker_confirm:
                from ._phase_boundary import phase_boundary_active, get_phase_boundary
                from .section_scope import pending_by_region, requires_region_declaration

                needs_gate = False
                if phase_boundary_active(self.business_data_store):
                    b = get_phase_boundary(self.business_data_store) or {}
                    needs_gate = bool(b.get("requires_write_all_editable"))
                else:
                    needs_gate = contract_force_refill(self.business_data_store)
                if needs_gate and not sec:
                    tl0 = TaskList.from_store((self.business_data_store or {}).get("task_list"))
                    by = pending_by_region(tl0)
                    if requires_region_declaration(tl0):
                        return _err(
                            "err-region-required | pending_by_region="
                            + json.dumps(by, ensure_ascii=False)
                            + " | Pass region= for the phase block "
                            "(judge from 阶段任务 / 阶段目录 / region_label).",
                            include_in_memory=True,
                        )

            gate_ok, pending_labels = check_pending_write_gate(self.business_data_store, section=sec)
        if not gate_ok:
            # Live-prune: fields wrongly left in pending because scan missed Vue disabled
            btn_kw = self._button_keywords()
            tl = TaskList.from_store((self.business_data_store or {}).get('task_list'))
            kept = []
            pruned = []
            for item in list(tl.pending):
                if item.needs_intervention:
                    kept.append(item)
                    continue
                try:
                    raw = await page.evaluate(JS_CHECK_SINGLE_FIELD, [item.label, btn_kw])
                    info = json.loads(raw) if isinstance(raw, str) and raw.startswith('{') else {}
                except Exception:
                    info = {}
                if info.get('disabled') and not info.get('hasButton'):
                    item.disabled = True
                    tl.done.append(item)
                    pruned.append(item.label)
                    continue
                kept.append(item)
            if pruned:
                tl.pending = kept
                if self.business_data_store is not None:
                    self.business_data_store['task_list'] = tl.to_store()
                sys.stderr.write(f'[click_save] pruned disabled pending: {pruned}\n')
                sys.stderr.flush()
                gate_ok, pending_labels = check_pending_write_gate(self.business_data_store, section=sec)
        if not gate_ok:
            return _err(
                f'err-pending-fields:{json.dumps(pending_labels[:12], ensure_ascii=False)} | '
                f'All editable fields must be written before submit (recording contract). '
                f'Fill remaining fields then click_save() again.',
                include_in_memory=True,
            )
        url_before = page.url
        if self.business_data_store is not None:
            self.business_data_store['_url_before_save'] = url_before
            self.business_data_store['_last_save_ok'] = False

        # Capture short-lived success toasts that may vanish between polls
        await page.evaluate(JS_WATCH_SAVE_NOTIFICATIONS)

        raw = await page.evaluate(JS_CLICK_SAVE_BUTTON, [button_text or '保存', sec])
        try:
            info = json.loads(raw) if isinstance(raw, str) else (raw or {})
        except Exception:
            info = {}
        retry_scope = ''
        if not info.get('ok'):
            retry_scope = save_retry_scope(
                str(info.get('reason') or ''),
                info.get('candidates') or [],
                explicit_scope=explicit_sec,
            )
            if retry_scope:
                clear_phase_section(self.business_data_store)
                sys.stderr.write(
                    f'[click_save] stale scope {sec!r} (not-found) → retry region={retry_scope!r}\n'
                )
                sys.stderr.flush()
                raw = await page.evaluate(JS_CLICK_SAVE_BUTTON, [button_text or '保存', retry_scope])
                try:
                    info = json.loads(raw) if isinstance(raw, str) else (raw or {})
                except Exception:
                    info = {}
                if info.get('ok'):
                    sec = retry_scope
                    remember_phase_section(self.business_data_store, retry_scope)
        if not info.get('ok'):
            try:
                await page.evaluate('() => { try { window.__saveWatchObs?.disconnect(); } catch(e) {} }')
            except Exception:
                pass
            reason = info.get('reason') or 'button-not-found'
            needle = info.get('needle') or (button_text or '保存')
            candidates = info.get('candidates') or []
            cand_json = json.dumps(candidates[:12], ensure_ascii=False)
            sys.stderr.write(
                f'[click_save] NOT CLICKED: "{needle}" reason={reason} section={sec!r} '
                f'candidates={cand_json[:200]}\n'
            )
            sys.stderr.flush()
            if reason == 'ambiguous':
                return _err(
                    f'err-save-ambiguous:{needle} | candidates={cand_json} | '
                    f'Multiple visible "{needle}" buttons — pass region= (or section=) to click_save '
                    f'(region_label / collapse/tab/card title from scan).',
                    include_in_memory=True,
                )
            sec_hint = f' region={sec!r}' if sec else ''
            stale_hint = (
                f' | stale scope memory retried region={retry_scope!r} and still missed'
                if retry_scope else ''
            )
            return _err(
                f'err-save-button-not-found:{needle}{sec_hint}. '
                f'candidates={cand_json}. '
                f'Close interfering dialogs (查询/返回) with close_dialog, '
                f'or pass region= for scoped save.{stale_hint}',
                include_in_memory=True,
            )

        btn_text = info.get('text') or (button_text or '保存')
        xpath = info.get('xpath') or ''
        tag_name = info.get('tag') or 'button'
        element_info = await _enrich_click_element(
            page, xpath=xpath, text=btn_text, tag_name=tag_name, attributes={},
        )
        _record_action(
            'click_element_by_index',
            {
                'index': -1,
                'tag_name': (element_info or {}).get('tag_name') or tag_name,
                'text': btn_text,
                'section': sec or info.get('section') or '',
            },
            f'ok-clicked-save:{btn_text}',
            element=element_info,
        )
        sys.stderr.write(f'[click_save] clicked "{btn_text}" xpath={xpath[:80]}\n')
        sys.stderr.flush()

        await page.wait_for_timeout(150)
        await _wait_if_loading(page)

        # Poll briefly — success toasts auto-dismiss in ~2–3s
        outcome = {'formErrors': [], 'successNotifs': [], 'errorNotifs': [], 'url': page.url}
        for _ in range(20):  # ~3s at 150ms
            scanned = await page.evaluate(JS_SCAN_SAVE_OUTCOME)
            if isinstance(scanned, str):
                try:
                    scanned = json.loads(scanned)
                except Exception:
                    scanned = {}
            watched = await page.evaluate('() => window.__saveWatch || {successNotifs:[], errorNotifs:[]}')
            outcome = scanned or outcome
            # Merge watcher captures (may include dismissed toasts)
            for t in (watched or {}).get('successNotifs') or []:
                if t not in (outcome.get('successNotifs') or []):
                    outcome.setdefault('successNotifs', []).append(t)
            for t in (watched or {}).get('errorNotifs') or []:
                if t not in (outcome.get('errorNotifs') or []):
                    outcome.setdefault('errorNotifs', []).append(t)
            if outcome.get('formErrors'):
                break
            if outcome.get('successNotifs'):
                break
            if outcome.get('errorNotifs'):
                break
            await page.wait_for_timeout(150)
            await _wait_if_loading(page)

        try:
            await page.evaluate('() => { try { window.__saveWatchObs?.disconnect(); } catch(e) {} }')
        except Exception:
            pass

        form_errors = outcome.get('formErrors') or []
        success_notifs = outcome.get('successNotifs') or []
        error_notifs = outcome.get('errorNotifs') or []

        if form_errors:
            labels = [e.get('label') or e.get('error') for e in form_errors[:8]]
            # Re-queue validation errors into task list when possible
            try:
                error_labels = await page.evaluate(
                    '''() => {
                      const out = [];
                      for (const el of document.querySelectorAll('.el-form-item__error')) {
                        const r = el.getBoundingClientRect();
                        if (r.width <= 0 || r.height <= 0) continue;
                        const t = (el.textContent || '').trim();
                        if (!t) continue;
                        const item = el.closest('.el-form-item');
                        const label = (item && item.querySelector('.el-form-item__label')
                          ? item.querySelector('.el-form-item__label').textContent : '').trim();
                        if (label) out.push(label);
                      }
                      return out;
                    }'''
                )
                if error_labels:
                    tl = TaskList.from_store(self.business_data_store.get('task_list'))
                    tl.sync_from_errors(error_labels)
                    self.business_data_store['task_list'] = tl.to_store()
            except Exception:
                pass
            try:
                await page.evaluate(JS_SCROLL_TO_FIRST_ERROR)
            except Exception:
                pass
            msg = (
                f'err-save-validation:{json.dumps(form_errors[:8], ensure_ascii=False)} | '
                f'Fix fields {labels} then call click_save() again. '
                f'Do NOT call done(success=true).'
            )
            sys.stderr.write(f'[click_save] validation errors: {labels}\n')
            sys.stderr.flush()
            return _err(msg, include_in_memory=True)

        if success_notifs:
            if self.business_data_store is not None:
                self.business_data_store['_last_save_ok'] = True
                self.business_data_store.pop('_submit_ready', None)
            record_success_token(self.business_data_store, 'toast_ok', success_notifs[0])
            toast = success_notifs[0]
            sys.stderr.write(f'[click_save] SUCCESS: {toast[:80]}\n')
            sys.stderr.flush()
            return _ok(
                f'ok-save-success:{toast} | '
                f'Save confirmed (操作成功). Call done(success=true) if phase goal is save.',
                include_in_memory=True,
            )

        if error_notifs:
            toast = error_notifs[0]
            sys.stderr.write(f'[click_save] error notification: {toast[:80]}\n')
            sys.stderr.flush()
            return _err(
                f'err-save-notification:{toast} | '
                f'Fix the reported issue then click_save() again. Do NOT treat as success.',
                include_in_memory=True,
            )

        url_after = outcome.get('url') or page.url
        url_changed = bool(url_before and url_after and url_before != url_after)
        if url_changed:
            if self.business_data_store is not None:
                self.business_data_store['_last_save_ok'] = True
                self.business_data_store.pop('_submit_ready', None)
            record_success_token(self.business_data_store, 'url_change', url_after)
            sys.stderr.write(
                f'[click_save] SUCCESS via navigation {url_before[:60]} -> {url_after[:60]}\n'
            )
            sys.stderr.flush()
            return _ok(
                f'ok-save-navigation:{url_after[:120]} | '
                f'Save confirmed (post-save navigation). Call done(success=true) if phase goal is save.',
                include_in_memory=True,
            )

        # Picker confirm: no toast expected — dialog close counts as success
        if is_picker_confirm and query_ui:
            still_query = False
            try:
                still_query = bool(await page.evaluate(JS_IS_QUERY_TOOLBAR))
            except Exception:
                still_query = False
            if not still_query:
                record_success_token(self.business_data_store, 'confirm_click', button_text or '确认')
                try:
                    from ._phase_boundary import maybe_record_picker_closed, record_evidence
                    parent = (self.business_data_store or {}).get('_parent_container_before_picker') or 'main'
                    maybe_record_picker_closed(
                        self.business_data_store,
                        still_query_ui=False,
                        parent_container=parent,
                    )
                    # Best-effort backfill check on parent form disabled fields
                    btn_kw = self._button_keywords()
                    backfilled = []
                    try:
                        raw = await page.evaluate(JS_SCAN_FORM_FIELDS, [False, btn_kw])
                        result = _as_dict(raw)
                        fields = result.get('fields') if isinstance(result, dict) else result
                        for f in fields or []:
                            if not isinstance(f, dict):
                                continue
                            if f.get('disabled') and (f.get('currentValue') or '').strip():
                                backfilled.append(f.get('label') or '')
                    except Exception:
                        pass
                    if backfilled:
                        record_evidence(
                            self.business_data_store,
                            'introduced_backfilled',
                            ','.join(backfilled[:6]),
                        )
                except Exception as e:
                    sys.stderr.write(f'[click_save] picker_closed helper: {e}\n')
                    sys.stderr.flush()
                    if self.business_data_store is not None:
                        self.business_data_store.pop('_query_ui', None)
                sys.stderr.write('[click_save] SUCCESS picker confirm (dialog closed)\n')
                sys.stderr.flush()
                if self.business_data_store is not None:
                    # Parent form still needs final 保存 after introduce (toast_ok).
                    self.business_data_store['_submit_ready'] = True
                    self.business_data_store.pop('_query_ui', None)
                return _ok(
                    'ok-introduce-confirm | Picker confirmed; introduce fields should be backfilled. '
                    'Call click_save(button_text="保存") NOW on the parent form. '
                    'Do NOT only check_field_value.',
                    include_in_memory=True,
                )

        # Silent save: button clicked, no validation errors, no error toast, no URL
        # change — some SUTs (e.g. section 保存) persist without 操作成功 toast.
        if self.business_data_store is not None:
            self.business_data_store['_last_save_ok'] = True
            self.business_data_store.pop('_submit_ready', None)
        record_success_token(self.business_data_store, 'toast_ok', 'ok-save-no-feedback')
        sys.stderr.write('[click_save] SUCCESS via no-feedback (silent save)\n')
        sys.stderr.flush()
        return _ok(
            'ok-save-no-feedback: save click completed with no toast, form error, or navigation. '
            'Treated as save success (silent persist). Call done(success=true) if phase goal is save. '
            'Do NOT retry click_save() on this result.',
            include_in_memory=True,
        )
