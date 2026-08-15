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


async def _auto_fill_pending_impl(self):
    from .section_scope import section_matches

    self.case_data_store['_assistant_needs_agent'] = []
    page = await self.browser_context.get_current_page()
    await _wait_if_loading(page)
    tl = TaskList.from_store(self.case_data_store.get('task_list'))
    autofilled = set(self.case_data_store.get('_autofilled_labels') or [])
    filt = (self.case_data_store.get('_assistant_section_filter') or '').strip()
    pending = [
        item for item in tl.pending
        if not item.needs_intervention
        and not (item.label in autofilled and (item.currentValue or '').strip())
        and section_matches(filt, item.section_id, item.section_title, getattr(item, 'region_label', '') or '')
    ]

    if not pending:
        return _ok('nothing-pending')

    # 构建待填字段列表（不再用案例 KV 硬匹配灌 commandValue；场景原文由 preamble 提示）
    pending_dicts: list[dict] = []
    for item in pending:
        d = item.model_dump()
        pending_dicts.append(d)

    label_kind: dict[str, str] = {item.label: item.kind for item in pending}

    # Extract reference date from page
    try:
        ref_date = await page.evaluate(JS_READ_REFERENCE_DATE)
        if ref_date:
            self.case_data_store['_ref_date'] = ref_date
            await page.evaluate('s => console.log("[AI填表] 参考日期: " + s)', ref_date)
    except Exception:
        pass

    # 打印待填写统计
    kind_counts: dict[str, int] = {}
    for item in pending:
        k = item.kind
        kind_counts[k] = kind_counts.get(k, 0) + 1
    summary_parts = ' '.join(f'{k}:{v}' for k, v in sorted(kind_counts.items()))
    await page.evaluate(
        's => console.log("[AI填表] 预计填写: " + s)',
        f'{len(pending)}个字段 | {summary_parts}',
    )

    all_results = []
    await self._execute_round(page, pending_dicts, label_kind, all_results, '')

    async def _cascade_round(round_tag: str, console_label: str) -> None:
        """Wait → fullpage scan → new∪still-empty worklist → execute (may be empty)."""
        from .cascade_fill import (
            filled_ok_keys_from_results,
            merge_cascade_worklist,
            still_empty_pending_dicts,
        )

        try:
            await page.wait_for_timeout(700)
            await _wait_if_loading(page)
        except Exception:
            pass
        try:
            raw = await page.evaluate(
                JS_SCAN_FORM_FIELDS,
                [False, self.button_keywords(), {'mode': 'fullpage'}],
            )
            result = _as_dict(raw)
            raw_fields = result.get('fields') if isinstance(result, dict) else result
        except Exception:
            raw_fields = []
        fillable = prepare_scan_fields_for_tasklist(raw_fields)
        dom_fields = [ScannedField(**f) if isinstance(f, dict) else f for f in fillable]
        tl_c = TaskList.from_store(self.case_data_store.get('task_list'))
        new_pending = self._scan_new_fields(dom_fields, tl_c)
        # Refresh tl after _scan_new_fields may have mutated store
        tl_c = TaskList.from_store(self.case_data_store.get('task_list'))
        ok_keys = filled_ok_keys_from_results(all_results)
        still = still_empty_pending_dicts(
            tl_c.pending,
            section_filter=filt,
            filled_ok_keys=ok_keys,
        )
        work = merge_cascade_worklist(new_pending, still)
        sys.stderr.write(
            f'[auto-fill] {round_tag}cascade: new={len(new_pending)} '
            f'still_empty={len(still)} work={len(work)}\n'
        )
        sys.stderr.flush()
        if not work:
            await page.evaluate(
                's => console.log("[AI填表] " + s)',
                f'{console_label}: 0个字段（无新字段/无剩余空项）',
            )
            return
        await page.evaluate(
            's => console.log("[AI填表] " + s)',
            f'{console_label}: {len(work)}个字段 (new={len(new_pending)} retry={len(still)})',
        )
        lk = {d['label']: d.get('kind', 'input') for d in work}
        await self._execute_round(page, work, lk, all_results, round_tag)

    # Round 2 / 3: cascade — new DOM fields ∪ still-empty pending
    await _cascade_round('round2 ', '第二轮(联动)')
    await _cascade_round('round3 ', '第三轮(深层联动)')

    # ═══════════════════════════════════════════════════════════════════
    # Step 4-6: 完成、同步（introduce disabled+button 不再入 pending / 不滚动干预）
    # ═══════════════════════════════════════════════════════════════════
    ok_count = sum(1 for r in all_results if _is_ok_result(r['result']))
    failed_count = len(all_results) - ok_count
    await page.evaluate(
        'd => console.log("[AI填表] 执行完成 ======\\n" + JSON.stringify(d))',
        all_results,
    )

    # Step 6: full scan sync — 移除不在 DOM 的 pending 字段
    try:
        raw_sync = await page.evaluate(
            JS_SCAN_FORM_FIELDS,
            [False, self.button_keywords(), {'mode': 'fullpage'}],
        )
        sync_result = _as_dict(raw_sync)
        sync_fields = sync_result.get('fields') if isinstance(sync_result, dict) else sync_result
        sync_fields = prepare_scan_fields_for_tasklist(sync_fields)
        dom_labels = {f.get('label', '') for f in sync_fields}
    except Exception:
        dom_labels = set()

    if dom_labels:
        tl_sync = TaskList.from_store(self.case_data_store.get('task_list'))
        stale = [item for item in tl_sync.pending
                 if item.label not in dom_labels and not item.needs_intervention]
        for item in stale:
            tl_sync.pending.remove(item)
            sys.stderr.write(f'[auto-fill] Removed stale pending: "{item.label}" (not in DOM)\n')
        if stale:
            self.case_data_store['task_list'] = tl_sync.to_store()
            sys.stderr.flush()

    tl_debug = TaskList.from_store(self.case_data_store.get('task_list'))
    sys.stderr.write(f'[auto-fill] DEBUG done={len(tl_debug.done)} pending={len(tl_debug.pending)}\n')
    sys.stderr.flush()
    return _ok(f'auto-fill-done | ok:{ok_count} failed:{failed_count} | ' + json.dumps(all_results, ensure_ascii=False))

