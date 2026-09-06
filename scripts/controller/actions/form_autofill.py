"""Auto-fill engine for form assistant (ensure-scanned + batch LLM fill rounds).

Extracted from _form.py to shrink the god module. Behavior-preserving:
``_register_form_actions`` instantiates ``FormAutofillEngine`` and aliases
``_ensure_scanned = engine.ensure_scanned`` so existing action bodies are
unchanged.
"""

import json
import sys

from scripts.state import (
    _ACTION_LOG,
    capture_page_png_b64_from_page,
    record_action_with_screenshots,
)
from ._helpers import (
    _as_dict,
    _ok,
    _is_ok_result,
    is_absent_field_result,
    absent_field_skip_result,
    should_record_result,
    _wait_if_loading,
    _capture_element,
    reset_select_ui,
    stamp_recorded_xpath_smart,
)
from ._js_snippets import (
    JS_GET_CONTAINER,
    JS_IDENTIFY_CONTAINER,
    JS_SCAN_FORM_FIELDS,
    JS_FILL_BY_XPATH,
    JS_FILL_DATE_BY_XPATH,
    JS_FIND_LABELED_SELECT,
    JS_SELECT_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH,
    JS_SELECT_VALUE_BY_XPATH,
    JS_CLICK_RADIO_BY_XPATH,
    JS_SELECT_TREE_OPTION,
    JS_FILL_FORM_FIELD,
    JS_CLICK_VERIFY_BUTTON,
    JS_READ_REFERENCE_DATE,
)
from ._llm_values import _llm_generate_values
from ...models import ScannedField, TaskList, TaskItem
from .form_rules import (
    match_cert_number,
    _gen_name,
    normalize_lat_lng_value,
)
from .form_scan_utils import (
    _is_search_dialog,
    _force_refill_flag,
    _scan_buttons_from_result,
    _skip_auto_fill,
    _mark_query_ui_if_needed,
    prepare_scan_fields_for_tasklist,
    tasklist_scan_mode,
    _pack_select_record,
    resolve_recorded_option_text,
    select_option_already_matched,
    _JS_READ_CERT_TYPE,
    _save_form_snapshot,
    _resolve_control,
    _task_done_impl,
    _switch_task_list_container,
)


from .autofill_pending import _auto_fill_pending_impl
from .autofill_round import _execute_round_impl


class FormAutofillEngine:
    """Bundle the shared state used by the form auto-fill engine.

    The engine owns ensure_scanned (container touch + optional batch scan)
    and the three LLM fill rounds (_execute_round / _scan_new_fields /
    _auto_fill_pending), which the actions and run_form_assistant drive.
    """

    def __init__(self, browser_context, business_data_store, llm, button_keywords):
        self.browser_context = browser_context
        self.business_data_store = business_data_store
        self.llm = llm
        self.button_keywords = button_keywords

    async def ensure_scanned(self, label_text: str, *, allow_autofill: bool = False):
        """Container touch; optional batch scan + auto-fill.

        Single-field actions call with allow_autofill=False (default) — update
        container context / query detection. On first touch of a container
        (no ``_scan_fields`` yet) also scan + save_form_snapshot, without autofill.

        run_form_assistant calls with allow_autofill=True to batch-scan and
        auto-fill when the phase contract allows.

        Auto-fill skipped when:
        - query / search toolbar (有查询无保存)
        - form_modify partial — AI changes only task-named fields
        - _watcher_mode (CDP quick actions)
        """
        # NOTE: watcher (CDP quick action) 不再早退——容器 touch 与依赖它的
        # task_list/`_scan_fields` 只在 ensure_scanned 建立（scan_visible_fields
        # 是只读扫描），早退会造成 store 永不更新、select_option 永远读不到
        # 字段（实证：wm/e2e 双复现 + AFTER-SELECT active 停留旧容器）。
        # autofill 仍由下方 allow_autofill 开关挡住，watcher 调单字段动作
        # 传 allow_autofill=False，行为与直连路径完全一致。
        page = await self.browser_context.get_current_page()
        container_id = await page.evaluate(JS_IDENTIFY_CONTAINER)
        from scripts.controller.actions.container_naming import (
            resolve_display_container,
            clear_trigger_button,
        )
        display_id = resolve_display_container(container_id, self.business_data_store)
        if display_id == 'main' or not str(display_id).startswith(('dialog:', 'drawer:')):
            if (self.business_data_store.get('_active_container') or '').startswith(('dialog:', 'drawer:')):
                clear_trigger_button(self.business_data_store)
        container_id = display_id

        # Remember parent before entering search/picker dialog
        if _is_search_dialog(container_id) or (
            container_id.startswith(('dialog:', 'drawer:'))
            and self.business_data_store.get('_active_container')
            and not str(self.business_data_store.get('_active_container')).startswith(('dialog:', 'drawer:'))
        ):
            if not self.business_data_store.get('_parent_container_before_picker'):
                self.business_data_store['_parent_container_before_picker'] = (
                    self.business_data_store.get('_active_container') or 'main'
                )

        _switch_task_list_container(self.business_data_store, container_id)

        async def _rebuild_task_list_from_dom(*, autofill: bool) -> None:
            # Overlay TaskList uses multi (not fullpage) so list/tree query noise
            # is not mixed into dialog/drawer pending — see tasklist_scan_mode.
            scan_mode = tasklist_scan_mode(container_id)
            raw = await page.evaluate(
                JS_SCAN_FORM_FIELDS,
                [False, self.button_keywords(), {'mode': scan_mode}],
            )
            try:
                result = _as_dict(raw)
                raw_fields = result.get('fields') if isinstance(result, dict) else result
            except Exception:
                return
            fillable = prepare_scan_fields_for_tasklist(raw_fields)
            dom_fields = [ScannedField(**f) if isinstance(f, dict) else f for f in fillable]
            raw_cid = result.get('container', container_id) if isinstance(result, dict) else container_id
            cid = resolve_display_container(raw_cid, self.business_data_store)
            _switch_task_list_container(self.business_data_store, cid)
            _save_form_snapshot(cid, [f.model_dump() for f in dom_fields], self.business_data_store)
            self.business_data_store['_scan_buttons'] = _scan_buttons_from_result(result)
            session_filled = set(self.business_data_store.get('_autofilled_labels') or [])
            tl = TaskList.from_scan(
                [f.model_dump() for f in dom_fields],
                force_refill=_force_refill_flag(self.business_data_store),
                session_filled_labels=session_filled,
            )
            self.business_data_store['task_list'] = tl.to_store()
            self.business_data_store['_scan_fields'] = [f.model_dump() for f in dom_fields]
            by = self.business_data_store.setdefault('_task_lists_by_container', {})
            if isinstance(by, dict):
                by[cid] = {
                    'task_list': self.business_data_store.get('task_list'),
                    '_scan_fields': self.business_data_store.get('_scan_fields'),
                }
            if autofill and tl.pending:
                await self._auto_fill_pending()
                tl_after = TaskList.from_store(self.business_data_store.get('task_list'))
                fillable_left = sum(1 for i in tl_after.pending if not i.needs_intervention)
                self.business_data_store['_autofill_summary'] = (
                    f'auto-fill-complete done={len(tl_after.done)} '
                    f'fillable_pending={fillable_left}'
                )
                if fillable_left == 0:
                    self.business_data_store['_submit_ready'] = True
                if isinstance(by, dict):
                    by[cid] = {
                        'task_list': self.business_data_store.get('task_list'),
                        '_scan_fields': self.business_data_store.get('_scan_fields'),
                    }

        # Force rescan when parent marked stale after picker close
        stale = self.business_data_store.get('_form_stale')
        if stale and stale == container_id:
            self.business_data_store.pop('_form_stale', None)
            sys.stderr.write(f'[form] force rescan stale container={container_id}\n')
            sys.stderr.flush()
            if not allow_autofill:
                await _rebuild_task_list_from_dom(autofill=False)
                return
            self.business_data_store.pop('task_list', None)
            self.business_data_store.pop('_scan_fields', None)

        is_query_ui = await _mark_query_ui_if_needed(page, self.business_data_store, container_id)
        if is_query_ui:
            # Introduce/picker/search still needs _scan_fields so fill_form_field
            # can resolve xpath (traj #38 phase 3: 客户名称 → xpath-not-found
            # when query-toolbar early-return skipped the inventory scan).
            # Never auto-fill query UI — agent chooses which filters to write.
            if not self.business_data_store.get('_scan_fields'):
                sys.stderr.write(
                    f'[form] first-touch query-ui scan container={container_id!r}\n'
                )
                sys.stderr.flush()
                await _rebuild_task_list_from_dom(autofill=False)
            return
        if not allow_autofill:
            # First touch of this container (fresh switch clears _scan_fields;
            # restored containers keep it) — scan + structure checkpoint only.
            if not self.business_data_store.get('_scan_fields'):
                sys.stderr.write(
                    f'[form] first-touch structure scan container={container_id!r}\n'
                )
                sys.stderr.flush()
                await _rebuild_task_list_from_dom(autofill=False)
            return
        if _skip_auto_fill(self.business_data_store):
            # form_modify partial (or query flagged without DOM yet)
            return

        tl = TaskList.from_store(self.business_data_store.get('task_list'))
        if tl.total > 0:
            pending_labels = {d.label for d in tl.pending}
            done_labels = {d.label for d in tl.done}
            if label_text in pending_labels or label_text in done_labels:
                return  # already scanned for this form

        sys.stderr.write(
            f'[form] rescan triggered label_text={label_text!r} container={container_id!r} '
            f'tl.total={tl.total} force_refill={_force_refill_flag(self.business_data_store)}\n'
        )
        sys.stderr.flush()
        await _rebuild_task_list_from_dom(autofill=True)


    async def _execute_round(self, page, items, label_kind, all_results, round_tag):
        """分组 → LLM 规划 → 逐个执行。round_tag: '' | 'round2 ' | 'round3 '"""
        return await _execute_round_impl(self, page, items, label_kind, all_results, round_tag)


    def _scan_new_fields(self, dom_fields, tl):
        """扫描新字段：差值过滤 + TaskItem 创建。返回 new_pending dicts。"""
        from .section_scope import section_matches

        filt = (self.business_data_store.get('_assistant_section_filter') or '').strip()
        known_labels = {d.label for d in tl.pending} | {d.label for d in tl.done}
        new_pending: list[dict] = []
        for f in dom_fields:
            if not f.label or f.label in known_labels or f.currentValue.strip():
                continue
            if filt and not section_matches(filt, f.section_id, f.section_title, getattr(f, 'region_label', '') or ''):
                continue
            if f.disabled:
                # Disabled / introduce (disabled+button) — not assistant pending.
                continue
            new_pending.append(f.model_dump())
        if new_pending:
            new_labels = [d.get('label', '') for d in new_pending]
            for d in new_pending:
                item = TaskItem(**{k: v for k, v in d.items() if k != 'commandValue'})
                item.needs_intervention = False
                tl.pending.append(item)
            self.business_data_store['task_list'] = tl.to_store()
            # Debug: verify store has the items
            verify = TaskList.from_store(self.business_data_store.get('task_list'))
            verify_labels = {i.label for i in verify.pending}
            sys.stderr.write(f'[auto-fill] _scan_new_fields: +{len(new_pending)} new={new_labels}, done={len(tl.done)} pending={len(tl.pending)}\n')
            sys.stderr.write(f'[auto-fill] _scan_new_fields verify: store pending has {len(verify.pending)} items, labels={list(verify_labels)[:3]}...\n')
            sys.stderr.flush()
        return new_pending


    async def _auto_fill_pending(self):
        """Batch auto-fill orchestration (delegated to autofill_pending module)."""
        return await _auto_fill_pending_impl(self)
