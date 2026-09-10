"""Engine classes for login/fill/select/radio/tree form actions (extracted from _form.py)."""

import asyncio
import json
import re
import sys
import time
from dataclasses import dataclass

from ...agent_utils import emit_json
from scripts.state import _record_action
from ._helpers import (
    _as_dict, _ok, _err, _is_ok_result,
    is_absent_field_result, absent_field_skip_result, should_record_result,
    _wait_if_loading, _capture_element, _merge_ax_text,
    _enrich_click_element,
    attach_select_options, options_from_scan_store, read_select_options,
    reset_select_ui,
    stamp_recorded_xpath_smart,
)
from ._js_snippets import (
    JS_GET_CONTAINER, JS_IDENTIFY_CONTAINER, JS_IS_QUERY_TOOLBAR,
    JS_CHECK_SINGLE_FIELD, JS_SCAN_FORM_FIELDS,
    JS_FILL_FORM_FIELD, JS_FILL_BY_XPATH,
    JS_CLEAR_FIELD_VALUE,
    JS_SELECT_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH, JS_SELECT_VALUE_BY_XPATH, JS_LOCATOR,
    JS_CLICK_RADIO, JS_CLICK_RADIO_BY_XPATH,
    JS_SELECT_TREE_OPTION, JS_TSSC_MULTI_SELECT, JS_EXPAND_ALL_EL_TREE,
    JS_SCROLL_TO_FIRST_ERROR,
    JS_CLICK_SAVE_BUTTON, JS_SCAN_SAVE_OUTCOME, JS_WATCH_SAVE_NOTIFICATIONS,
    JS_CLICK_LOGIN_BUTTON,
)
from ...models import (
    ScannedField, FormScanResult, Notification,
    FormSnapshot, FormSnapshotCollection,
    TaskItem, TaskList,
)
from ...models.field import ScannedButton
from .js_snippets.container import JS_VISIBLE_OVERLAY_OF
from .js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS
from .form_rules import (
    match_rule, match_cert_number, get_has_button_keywords,
    normalize_lat_lng_value,
)

from .form_scan_utils import (
    _SEARCH_DIALOG_HINTS, _QUERY_NEXT_HINT, _is_search_dialog, _force_refill_flag,
    _scan_buttons_from_result, refresh_scan_buttons, _section_group_key, _dedupe_needs_agent,
    _build_section_summary, build_editable_summary, _is_query_mode, _skip_auto_fill,
    _mark_query_ui_if_needed,
    filter_fillable_scan_fields, prepare_scan_fields_for_tasklist, tasklist_scan_mode,
    field_values_equivalent, enrich_field_value_check,
    _pack_select_record, resolve_recorded_option_text, select_option_already_matched,
    match_select_option_candidate,
    _JS_READ_CERT_TYPE, _JS_EXTRACT_ERROR_LABELS, _save_form_snapshot,
    ResolvedControl, _resolve_control, lookup_field_kind, resolve_select_fallback, _task_xpath_smart, _task_done_impl,
    _submit_ready_hint, _switch_task_list_container, _with_submit_cue, _query_not_form_payload,
)

from .form_engine_base import (
    _FormActionEngineBase,
    _ReplayAutofillStub,
    _ReplayPageAdapter,
    _replay_engine_store,
)
from .login_engine import LoginEngine
from .fill_engine import FillEngine
from .form_autofill import FormAutofillEngine
from .result_protocol import err_with, ok_marked, affordances
from .select_dispatch import resolve_select_dispatch
from .select_match import suggest_field_for_value
from .replay_timing import WAIT_300_MS, WAIT_500_MS, WAIT_3000_MS, budget_for

# SB：fill_form_field 确定性守卫总开关（Z2 严格解析闸 + Z4 弹层作用域闸）。


def _select_failure_next_action(label_text: str, option_text: str, business_data_store) -> str:
    """确定性「建议字段」提示（C2）：值↔选项错配时的下一步指引。

    候选来自 business_data_store 的 task_list（TaskList.from_store 后取
    pending+done 全部项：每项 {label, options}；options 兼容 JSON 字符串）。
    无候选/首项哨兵时返回既有默认文案（逐字不变）。
    """
    default_action = (
        'select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)'
    )
    ot = (option_text or '').strip()
    if not ot or ot.lower() in ('first', '1st') or ot in ('第一个', '第一项'):
        return default_action

    def _coerce_opts(raw):
        if isinstance(raw, str):
            try:
                return json.loads(raw)
            except Exception:
                return []
        return raw

    task_fields: list[dict] = []
    raw_tl = (business_data_store or {}).get('task_list')
    try:
        tl = TaskList.from_store(raw_tl)
        for t in list(tl.pending) + list(tl.done):
            task_fields.append({
                'label': getattr(t, 'label', '') or '',
                'options': _coerce_opts(getattr(t, 'options', None)),
            })
    except Exception:
        task_fields = []
    if not task_fields and isinstance(raw_tl, dict):
        for bucket in ('pending', 'done'):
            for p in raw_tl.get(bucket) or []:
                if isinstance(p, dict):
                    task_fields.append({
                        'label': p.get('label', '') or '',
                        'options': _coerce_opts(p.get('options')),
                    })

    cands = suggest_field_for_value(ot, task_fields, exclude_label=label_text)
    if not cands:
        return default_action
    parts = []
    for c in cands[:2]:
        parts.append(
            '建议字段「' + c['label'] + '」（快照选项含：' + c['option'] + '）：'
            'select_option(label_text="' + c['label'] + '", option_text="' + c['option'] + '")'
        )
    return '；'.join(parts)







JS_SELECT_FILTERABLE_TYPED = r'''async (optionText) => {
    const want = String(optionText == null ? '' : optionText).trim();
    if (!want) return 'filterable-empty-option';
    const setNativeValue = (input, value) => {
        const proto = input instanceof HTMLTextAreaElement
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const visibleDropdown = () => [...document.querySelectorAll('.el-select-dropdown')]
        .find((dd) => {
            if (dd.classList.contains('is-hidden')) return false;
            const st = getComputedStyle(dd);
            if (st.display === 'none' || st.visibility === 'hidden') return false;
            return dd.offsetParent !== null || dd.getBoundingClientRect().width > 0;
        });
    const trigger = window.__last_select_trigger || null;
    if (!trigger || !document.contains(trigger)) return 'filterable-no-trigger';
    // Re-open the dropdown if a prior reset closed it. Element UI binds the
    // toggle on the .el-select WRAPPER (@click.stop="toggleMenu"), not the
    // inner input — dispatching only on the input used to fail to open the
    // dropdown (frz round-3: poll saw 0 items, remote search never fired
    // because handleQueryChange runs with visible=false). Try wrapper first,
    // then the input.
    const openDropdown = () => {
        const wrap = trigger.closest('.el-select') || trigger;
        wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        trigger.click();
    };
    if (!visibleDropdown()) openDropdown();
    // Clear before typing (每次键入前清空), then inject the keyword via the
    // native setter so Vue's filterable/remote filter actually fires.
    setNativeValue(trigger, '');
    await new Promise((resolve) => setTimeout(resolve, 150));
    setNativeValue(trigger, want);
    // Filterable/remote filtering is async (remote search round-trip) — poll the
    // visible dropdown items every 300ms up to 5s; first item containing the
    // keyword is clicked. A single 600ms read used to race the remote fetch and
    // return an empty list (frz round-2 N1 failure). 1.8s cap: the watcher
    // action budget for select_option is 5s (replay_timing
    // DEFAULT_ACTION_BUDGET_S) and pre-fallback work (reset/scan/plain pick)
    // already consumes ~3s — success returns as soon as the item appears;
    // only the no-match path consumes the full window.
    const readVisibleItems = () => {
        const dd = visibleDropdown();
        const items = dd
            ? [...dd.querySelectorAll('.el-select-dropdown__item')]
            : [...document.querySelectorAll('.el-select-dropdown__item')];
        return items.filter(
            (it) => it.offsetParent !== null || it.getBoundingClientRect().width > 0
        );
    };
    const deadline = Date.now() + 1800;
    let seen = 0;
    let reopened = 0;
    // Diagnostic (frz round-3): record whether the remote search actually
    // fires — capture fetch/XHR URLs issued during the poll window.
    if (!window.__filterable_net) {
        window.__filterable_net = [];
        const oOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u) {
            try { window.__filterable_net.push(String(u).slice(0, 120)); } catch (e) {}
            return oOpen.apply(this, arguments);
        };
        const oFetch = window.fetch;
        if (oFetch) {
            window.fetch = function (input) {
                try { window.__filterable_net.push(String(input && input.url || input).slice(0, 120)); } catch (e) {}
                return oFetch.apply(this, arguments);
            };
        }
    }
    const t0 = Date.now();
    window.__filterable_net.length = 0;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Keep the dropdown open — a re-render/reset during the remote round
        // trip may close it; remote filtering only applies while visible.
        if (!visibleDropdown() && reopened < 2) { openDropdown(); reopened += 1; }
        const visibleItems = readVisibleItems();
        seen = Math.max(seen, visibleItems.length);
        const hit = visibleItems.find(
            (it) => ((it.textContent || '').trim()).indexOf(want) !== -1
        );
        if (hit) {
            hit.scrollIntoView?.({ block: 'center', behavior: 'instant' });
            hit.click();
            return 'ok-filterable-typed:' + (hit.textContent || '').trim();
        }
    }
    const texts = readVisibleItems().slice(0, 8)
        .map((it) => (it.textContent || '').trim()).filter(Boolean);
    const ddAll = document.querySelectorAll('.el-select-dropdown').length;
    const net = (window.__filterable_net || []).slice(0, 3).join(' ; ');
    return 'filterable-typed-no-match:' + texts.join(',')
        + '|seen:' + seen + '|reopened:' + reopened
        + '|dd:' + ddAll + '|net:' + net + '|ms:' + (Date.now() - t0);
}'''


# N4 paged-traverse fallback: paginated el-select (信贷系统「选择冻结额度」抽屉的
# 客户号) loads only the first page (pageNum=1, pageSize=5) into the dropdown —
# typing filters those 5 items only (frz round-4: zero network on input), the
# target lives on page 24/29. Real interaction = open the dropdown, click the
# pagination「下一页」control page by page and scan the rendered items until the
# target appears. Runs ONLY after the filterable-typed fallback already failed
# — never on the success path. No pagination control in the dropdown → not
# applicable ('select-paged-no-pagination'; caller keeps the original error).
# Budget: the watcher action budget for select_option is 5s and the plain/fuzzy/
# filterable chain already consumed most of it — Python passes the remaining
# budget (ms); exceeding it returns select-paged-no-match with the page count.
JS_SELECT_PAGED_TRAVERSE = r'''async ([optionText, budgetMs]) => {
    const want = String(optionText == null ? '' : optionText).trim();
    if (!want) return 'select-paged-empty-option';
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = Date.now() + Math.max(500, Number(budgetMs) || 3000);
    const visibleDropdown = () => [...document.querySelectorAll('.el-select-dropdown')]
        .find((dd) => {
            if (dd.classList.contains('is-hidden')) return false;
            const st = getComputedStyle(dd);
            if (st.display === 'none' || st.visibility === 'hidden') return false;
            return dd.offsetParent !== null || dd.getBoundingClientRect().width > 0;
        });
    const trigger = window.__last_select_trigger || null;
    if (!trigger || !document.contains(trigger)) return 'select-paged-no-trigger';
    // Same open gesture as JS_SELECT_FILTERABLE_TYPED: the toggle lives on the
    // .el-select WRAPPER, not the inner input.
    const openDropdown = () => {
        const wrap = trigger.closest('.el-select') || trigger;
        wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        wrap.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        trigger.click();
    };
    const fire = (el, type) => el.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, view: window })
    );
    // Real-mouse-event chain (frz round-4 convention): mousedown → mouseup → click.
    const clickChain = (el) => { fire(el, 'mousedown'); fire(el, 'mouseup'); el.click(); };
    if (!visibleDropdown()) { openDropdown(); await sleep(200); }
    if (!visibleDropdown()) { openDropdown(); await sleep(300); }
    const dd = visibleDropdown();
    if (!dd) return 'select-paged-no-dropdown';
    //「下一页」control: .el-pagination .btn-next, or a visible control whose
    // text is exactly 下一页 / › / » inside the dropdown.
    const findNext = (root) => {
        const btn = root.querySelector('.el-pagination .btn-next');
        if (btn && btn.offsetParent !== null) return btn;
        const cands = [...root.querySelectorAll(
            'button, .el-pagination span, .el-pagination li, .el-pager li, a, span, i'
        )].filter((el) => el.offsetParent !== null);
        return cands.find((el) => {
            const t = (el.textContent || '').trim();
            return t === '下一页' || t === '›' || t === '»';
        }) || null;
    };
    if (!findNext(dd)) return 'select-paged-no-pagination';
    const nextDisabled = (next) => next.disabled
        || next.classList.contains('disabled') || next.classList.contains('is-disabled')
        || (next.parentElement && (next.parentElement.classList.contains('disabled')
            || next.parentElement.classList.contains('is-disabled')));
    // Count findCoreInfGroup responses so each page's data is rendered before
    // scanning — clicking「下一页」fires a server fetch; scanning stale items
    // wastes a page tick. (Patched once, after the first next-click setup.)
    // Additionally rewrite the page fetch's pageSize 5→200: the frz round-5
    // wet test proved the server honors a larger pageSize, so the next fetch
    // loads all 144 candidates at once and the scan hits without traversing
    // 29 pages (impossible inside the 5s action budget). If the server ignores
    // the rewrite, traversal continues page by page as before.
    if (!window.__paged_resp_count) {
        window.__paged_resp_count = 0;
        const PAGED_URL = 'findCoreInfGroup';
        const enlarge = (body) => {
            try {
                if (body && typeof body === 'string') {
                    body = body.replace(/"pageSize":\s*\d+/, '"pageSize":200')
                        .replace(/pageSize=\d+/, 'pageSize=200');
                }
            } catch (e) {}
            return body;
        };
        const oOpen = XMLHttpRequest.prototype.open;
        const oSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) {
            this.__paged_url = String(u || '');
            return oOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
            const xhr = this;
            if ((xhr.__paged_url || '').indexOf(PAGED_URL) !== -1) {
                body = enlarge(body);
                xhr.addEventListener('load', function () { window.__paged_resp_count += 1; });
                xhr.addEventListener('error', function () { window.__paged_resp_count += 1; });
            }
            return oSend.apply(this, arguments);
        };
        const oFetch = window.fetch;
        if (oFetch) {
            window.fetch = function (input, init) {
                const u = String((input && input.url) || input || '');
                if (u.indexOf(PAGED_URL) !== -1 && init && typeof init.body === 'string') {
                    init = { ...init, body: enlarge(init.body) };
                }
                const p = oFetch.apply(this, [input, init]);
                if (u.indexOf(PAGED_URL) !== -1) {
                    p.then(() => { window.__paged_resp_count += 1; },
                           () => { window.__paged_resp_count += 1; });
                }
                return p;
            };
        }
    }
    const readItems = (root) => [...root.querySelectorAll('.el-select-dropdown__item')]
        .filter((it) => it.offsetParent !== null || it.getBoundingClientRect().width > 0);
    const MAX_PAGES = 30;
    let pages = 0;
    let reopens = 0;
    for (let p = 0; p < MAX_PAGES; p++) {
        if (Date.now() > deadline) {
            return 'select-paged-no-match:pages=' + pages + '|reason:budget';
        }
        const cur = visibleDropdown();
        if (!cur) {
            if (reopens >= 2) return 'select-paged-no-match:pages=' + pages + '|reason:dropdown-closed';
            reopens += 1;
            openDropdown();
            await sleep(300);
            continue;
        }
        // 每页扫描前把下拉滚到顶，防粘底（frz round-4 教训）。刚重开时列表可能
        // 仍在加载——等首屏 items 出现（最多 600ms）再判空。
        const wrap = cur.querySelector('.el-scrollbar__wrap') || cur;
        wrap.scrollTop = 0;
        if (readItems(cur).length === 0) {
            const tWait = Date.now();
            while (Date.now() - tWait < 600 && Date.now() <= deadline) {
                await sleep(60);
                const curW = visibleDropdown();
                if (curW && readItems(curW).length > 0) break;
            }
        }
        const curScan = visibleDropdown();
        if (!curScan) continue;
        const hit = readItems(curScan).find(
            (it) => ((it.textContent || '').trim()).indexOf(want) !== -1
        );
        if (hit) {
            hit.scrollIntoView?.({ block: 'center', behavior: 'instant' });
            clickChain(hit);
            return 'ok-select-paged:' + (hit.textContent || '').trim();
        }
        const next = findNext(curScan);
        if (!next) {
            return 'select-paged-no-match:pages=' + pages + '|reason:no-next';
        }
        if (nextDisabled(next)) {
            // 翻页请求在途时「下一页」可能短暂禁用——重查最多 3 次再判末页，
            // 防止把加载态误判为 last-page（五轮实测 11 页假 last-page）。
            let stillDisabled = true;
            for (let r = 0; r < 3 && Date.now() <= deadline; r++) {
                await sleep(250);
                const curR = visibleDropdown();
                if (!curR) break;
                const nextR = findNext(curR);
                if (nextR && !nextDisabled(nextR)) { stillDisabled = false; break; }
                if (!nextR) { stillDisabled = true; break; }
            }
            if (stillDisabled) {
                return 'select-paged-no-match:pages=' + pages + '|reason:last-page';
            }
        }
        pages += 1;
        const firstBefore = (readItems(visibleDropdown() || curScan)[0] || {}).textContent || '';
        const prevResps = window.__paged_resp_count;
        clickChain(next);
        // 等待本页数据就绪：findCoreInfGroup 响应到达或首项文本变化，最长
        // 250ms（5s 动作预算内要遍历 20+ 页，不能固定长等；ready 即提前走）。
        const t0 = Date.now();
        while (Date.now() - t0 < 250 && Date.now() <= deadline) {
            await sleep(20);
            const cur2 = visibleDropdown();
            if (!cur2) break;
            const its = readItems(cur2);
            const firstNow = (its[0] || {}).textContent || '';
            if (window.__paged_resp_count > prevResps
                || (its.length && firstNow !== firstBefore)) break;
        }
    }
    return 'select-paged-no-match:pages=' + pages + '|reason:max-pages';
}'''


# N5 main-area labeled select trigger fallback: on the two-step wizard / signing
# pages (frz round-5: 冻结类型/冻结原因/流程操作) JS_SELECT_TRIGGER_BY_XPATH
# returns xpath-not-found even with the scan's xpath_smart, while
# fill_form_field resolves the same fields fine. Last-resort: find the LAST
# visible .el-form-item whose label matches exactly and click its el-select.
JS_SELECT_TRIGGER_MAIN_AREA = r'''([labelText]) => {
    const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
        .replace(/[：:*\s]+$/g, '').replace(/^[*\s]+/, '');
    const isVis = (el) => {
        if (!el || el.nodeType !== 1) return false;
        if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden';
    };
    const want = norm(labelText);
    if (!want) return 'main-empty-label';
    let target = null;
    const tryItem = (it) => {
        if (!it || !isVis(it) || !it.querySelector('.el-select')) return false;
        const lbl = it.querySelector('.el-form-item__label, label');
        if (norm((lbl && lbl.textContent) || '') === want) { target = it; return true; }
        return false;
    };
    for (const it of document.querySelectorAll('.el-form-item')) {
        if (tryItem(it)) break;
    }
    // KB-I5 run5: 弹窗感知兜底（与 select_tree.py 弹窗补丁同型）——利率测算/
    // 流程选人等可见 .el-dialog/.el-drawer 内的 form-item 单独补扫。
    if (!target) {
        for (const dlg of document.querySelectorAll('.el-dialog, .el-drawer')) {
            if (dlg.offsetParent === null && dlg.getClientRects().length === 0) continue;
            for (const it of dlg.querySelectorAll('.el-form-item')) {
                if (tryItem(it)) break;
            }
            if (target) break;
        }
    }
    if (!target) return 'main-select-not-found';
    const trig = target.querySelector('.el-select .el-input__inner');
    if (!trig || !isVis(trig)) return 'no-select-found';
    if (trig.disabled) return 'field-disabled';
    target.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    trig.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trig.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    trig.click();
    window.__last_select_trigger = trig;
    return 'ok-triggered';
}'''


def _select_replay_uses_exact(exact_option: bool | None, mode: str) -> bool:
    if exact_option is not None:
        return bool(exact_option)
    return mode == "replay"


def _select_js_option_arg(option_text: str, use_exact: bool):
    return [option_text, True] if use_exact else option_text


def _unwrap_action_result(result) -> str:
    if hasattr(result, "extracted_content"):
        return str(result.extracted_content)
    return str(result)


class SelectEngine(_FormActionEngineBase):
    @classmethod
    async def select_option_for_replay(
        cls,
        page,
        label_text: str,
        option_text: str,
        *,
        xpath_smart: str = "",
        element: dict | None = None,
        exact_option: bool | None = True,
        business_data_store: dict | None = None,
    ):
        """Replay entry: construct engine with page adapter and run mode=replay."""
        store = _replay_engine_store(business_data_store)
        bc = _ReplayPageAdapter(page)
        autofill = _ReplayAutofillStub()
        engine = cls(bc, store, autofill)
        return await engine.select_option(
            label_text,
            option_text,
            xpath_smart,
            mode="replay",
            exact_option=exact_option,
            element=element,
        )

    async def select_option(
        self,
        label_text: str,
        option_text: str,
        xpath_smart: str = "",
        *,
        mode: str = "record",
        exact_option: bool | None = None,
        element: dict | None = None,
    ):
        try:
            return await self._select_option_impl(
                label_text,
                option_text,
                xpath_smart,
                mode=mode,
                exact_option=exact_option,
                element=element,
            )
        except Exception as exc:
            import traceback as _tb
            sys.stderr.write(
                f'[select] select_option label={label_text!r} option={option_text!r} '
                f'xpath_smart={xpath_smart!r} exception: {exc}\n{_tb.format_exc()}\n'
            )
            sys.stderr.flush()
            raise

    async def _select_option_impl(
        self,
        label_text: str,
        option_text: str,
        xpath_smart: str = "",
        *,
        mode: str = "record",
        exact_option: bool | None = None,
        element: dict | None = None,
    ):
        # N4 paged fallback budgets itself against the select_option action
        # budget measured from here (session_runner enforces the same budget
        # via asyncio.wait_for — overrun = budget-timeout).
        is_replay = mode == "replay"
        use_exact = _select_replay_uses_exact(exact_option, mode)
        replay_element = element if isinstance(element, dict) else None
        impl_started = time.monotonic()
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._maybe_ensure_scanned(label_text, mode)
        field_kind = lookup_field_kind(self.business_data_store, label_text)
        dispatch = await resolve_select_dispatch(
            label=label_text,
            element=replay_element,
            field_kind=field_kind,
            page=page,
        )
        sys.stderr.write(
            f"[select] dispatch path={dispatch.path} reason={dispatch.reason} label={label_text!r}\n"
        )
        sys.stderr.flush()
        if dispatch.path == "tssc":
            return await self.tssc_multi_select(
                label_text,
                option_text,
                xpath_smart,
                mode=mode,
                element=replay_element,
            )
        # tree path: select_option does not handle tree today — fall through to el-select.

        async def _final_select_failure(result_text: str, xpath_for_log: str = '') -> str:
            diag = await reset_select_ui(page)
            sys.stderr.write(
                f'[select] final failure label={label_text!r} option={option_text!r} '
                f'xpath={xpath_for_log!r} result={result_text!r} reset={diag}\n'
            )
            sys.stderr.flush()
            return result_text

        reset_diag = await reset_select_ui(page)
        if not reset_diag.get('closed', False):
            sys.stderr.write(f'[select] preflight reset incomplete: {reset_diag}\n')
            sys.stderr.flush()
            failed = await _final_select_failure('no-items')
            if is_replay:
                return failed
            return err_with(
                "err-select-option-unresolved",
                "下拉无可见选项",
                observed=f"label={label_text} last={failed}"[:160],
                next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
            )

        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
        xp = '' if resolved.error else (resolved.xpath_smart or '').strip()
        trigger_pretriggered = False
        if resolved.error:
            # N5 resolver-level fallback: on wizard/signing pages the control is
            # absent from the inventory, so _resolve_control returns an error
            # BEFORE any trigger JS runs (frz round-5, 流程操作). Try the
            # main-area exact-label trigger; if it opens the dropdown, continue
            # with an empty xpath (the value/trigger evaluates below degrade to
            # harmless 'xpath-empty' and the pick runs on the open dropdown).
            main_trig = str(await page.evaluate(JS_SELECT_TRIGGER_MAIN_AREA, [label_text]))
            if main_trig == 'ok-triggered':
                label_text = resolved.label or label_text
                trigger_pretriggered = True
                sys.stderr.write(
                    f'[select] main-area trigger fallback (resolver-level) success label={label_text!r}\n'
                )
                sys.stderr.flush()
            else:
                return resolved.error
        else:
            label_text = resolved.label or label_text

        element = await _capture_element(
            page, label_text, target_kind='form_select', xpath_smart=xp,
        )

        if not trigger_pretriggered:
            # Xpath-only already-matched (no JS_FIND_LABELED_SELECT).
            already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp, label_text])
            if str(already).startswith('ok-already:'):
                cur_val = already.split(':', 1)[1]
                # "first" means "any existing value is fine" — do NOT re-open the
                # dropdown (re-selecting first can cascade-reset dependent fields).
                # Exact match only — substring (非金融 ⊂ 其他非金融) must re-select.
                if select_option_already_matched(option_text, cur_val):
                    if is_replay:
                        return already
                    stamped = resolve_recorded_option_text(option_text, cur_val)
                    params, element = await _pack_select_record(
                        page, self.business_data_store, label_text, stamped, element,
                    )
                    xp_inv = stamp_recorded_xpath_smart(element, xp)
                    params['option_text'] = stamped
                    _record_action('select_option', params, already, element=element)
                    _task_done_impl(
                        label_text, self.business_data_store, value=cur_val or stamped, xpath_smart=xp_inv,
                    )
                    streak = int(self.business_data_store.get('_already_matched_streak', 0) or 0) + 1
                    self.business_data_store['_already_matched_streak'] = streak
                    return _ok(_with_submit_cue(
                        already + ' | already-matched | SKIP — field already set; do not re-select',
                        self.business_data_store,
                    ))
            if not is_replay:
                self.business_data_store['_already_matched_streak'] = 0

            trigger_result = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text])
        else:
            trigger_result = 'ok-triggered'
        if trigger_result == 'xpath-not-found':
            fallback = resolve_select_fallback(self.business_data_store, label_text, xp)
            if fallback is not None:
                reset_diag = await reset_select_ui(page)
                if not reset_diag.get('closed', False):
                    sys.stderr.write(
                        f'[select] fallback preflight reset incomplete: {reset_diag}\n'
                    )
                    sys.stderr.flush()
                    failed = await _final_select_failure('no-items', xp)
                    if is_replay:
                        return failed
                    return err_with(
                        "err-select-option-unresolved",
                        "下拉无可见选项",
                        observed=f"label={label_text} last={failed}"[:160],
                        next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
                    )
                xp = fallback.xpath_smart
                label_text = fallback.label or label_text
                trigger_result = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text])
                if _is_ok_result(str(trigger_result)):
                    element = await _capture_element(
                        page,
                        label_text,
                        target_kind='form_select',
                        xpath_smart=xp,
                    )
                    sys.stderr.write(
                        f'[select] xpath fallback success label={label_text!r} xpath={xp!r}\n'
                    )
                    sys.stderr.flush()
        # N5 main-area trigger fallback — last resort after the xpath trigger
        # (and any stored fallback) failed: exact-label visible el-form-item
        # hunt on main (wizard/signing pages, frz round-5).
        if str(trigger_result) in ('xpath-not-found', 'no-select-found', 'label-not-found'):
            main_trig = str(await page.evaluate(JS_SELECT_TRIGGER_MAIN_AREA, [label_text]))
            if main_trig == 'ok-triggered':
                trigger_result = main_trig
                element = await _capture_element(
                    page, label_text, target_kind='form_select', xpath_smart=xp,
                )
                sys.stderr.write(
                    f'[select] main-area trigger fallback success label={label_text!r}\n'
                )
                sys.stderr.flush()
        if trigger_result in (
            'label-not-found',
            'no-select-found',
            'select-disabled',
            'xpath-not-found',
            'xpath-empty',
            'field-disabled',
        ):
            if is_absent_field_result(trigger_result):
                if not is_replay and not _is_query_mode(self.business_data_store):
                    _task_done_impl(label_text, self.business_data_store)
                sys.stderr.write(f'[select] skip absent label={label_text!r}\n')
                if is_replay:
                    return absent_field_skip_result()
                return _ok(_with_submit_cue(absent_field_skip_result(), self.business_data_store))
            failed = await _final_select_failure(str(trigger_result), xp)
            if is_replay:
                return failed
            if trigger_result == 'no-select-found':
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action='click_radio(label_text="' + label_text + '", option_text=<选项原文>)',
                )
            return err_with(
                "err-select-option-unresolved",
                f"无法稳定选中「{option_text}」",
                observed=f"label={label_text} last={failed}"[:160],
                next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
            )

        await page.wait_for_timeout(WAIT_500_MS)

        # Capture full option list while dropdown is open (before pick)
        params: dict = {}
        xp_inv = stamp_recorded_xpath_smart(element, xp)
        if not is_replay:
            params, element = await _pack_select_record(
                page, self.business_data_store, label_text, option_text, element,
            )
            xp_inv = stamp_recorded_xpath_smart(element, xp)

        select_result = await page.evaluate(
            JS_SELECT_OPTION, _select_js_option_arg(option_text, use_exact),
        )
        if _is_ok_result(select_result):
            # Reject any JS result that silently picked the first item when the
            # wanted option was absent (pseudo-success) — never record / task_done.
            # JS-side root fix removes the fallback-first branch; this guard is
            # defense-in-depth against a regression from any other click path.
            if 'fallback-first' in str(select_result):
                failed = await _final_select_failure(str(select_result), xp)
                if is_replay:
                    return failed
                return err_with(
                    'err-select-option-unresolved',
                    '引擎拒绝首项兜底伪成功结果（wanted 不在下拉项中）',
                    observed=f'label={label_text} last={failed}'[:160],
                    next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
                )
            matched_text = select_result.split(':', 1)[1] if ':' in select_result else select_result
            if is_replay:
                return str(select_result)
            self.business_data_store.pop(f'_sel_retry_{label_text}', None)
            stamped = resolve_recorded_option_text(option_text, matched_text)
            params['option_text'] = stamped
            params, element = attach_select_options(params, element, params.get('options'))
            _record_action('select_option', params, matched_text, element=element)
            _task_done_impl(
                label_text, self.business_data_store, value=stamped or option_text, xpath_smart=xp_inv,
            )
            return _ok(_with_submit_cue(f'ok | {matched_text}', self.business_data_store))
        elif select_result == 'no-items':
            # Xpath recheck — treat already-set field as success (no labeled JS).
            recheck = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp, label_text])
            if str(recheck).startswith('ok-already:'):
                if is_replay:
                    return recheck
                cur = recheck.split(':', 1)[1]
                stamped = resolve_recorded_option_text(option_text, cur)
                params['option_text'] = stamped
                _task_done_impl(label_text, self.business_data_store, value=cur or stamped, xpath_smart=xp_inv)
                _record_action('select_option', params, recheck, element=element)
                return _ok(_with_submit_cue(recheck + ' | already-matched | no-items-skip', self.business_data_store))
            failed = await _final_select_failure('no-items', xp)
            if is_replay:
                return failed
            return err_with(
                "err-select-option-unresolved",
                "下拉无可见选项",
                observed=f"label={label_text} last={failed}"[:160],
                next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
            )
        elif str(select_result).startswith('value-mismatch'):
            if is_replay:
                failed = await _final_select_failure(str(select_result), xp)
                return failed
            # SELECT_VERIFY_READBACK — JS_SELECT_OPTION clicked an option but the
            # trigger input read back a different value (same-prefix field wrote
            # the wrong select, e.g. 国民经济部门 option into 国民经济部门类别).
            # The JS substring fallback (lab.includes(option)) can also click a
            # wrong option when the desired label is an alias: e.g. want="中国"
            # has no exact option, so the fallback clicks "中国香港特别行政区"
            # (shortest label containing "中国"), which the readback verifier
            # rejects. In that case retrying the same alias loops forever.
            # Fix: on the first mismatch, resolve known aliases against the live
            # dropdown option list (params['options'] captured by
            # _pack_select_record) and retry with the resolved canonical label —
            # same pattern as the not-found branch below.
            mismatch_retry_key = f'_sel_mismatch_retry_{label_text}'
            mismatch_retries = self.business_data_store.get(mismatch_retry_key, 0) + 1
            self.business_data_store[mismatch_retry_key] = mismatch_retries
            if mismatch_retries > 1:
                self.business_data_store.pop(mismatch_retry_key, None)
                failed = await _final_select_failure(str(select_result), xp)
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
                )
            # Alias resolution: map known short aliases to the canonical option
            # label present in the dropdown (e.g. 中国 → 中华人民共和国).
            # The generic match_select_option_candidate uses substring containment
            # which wrongly picks "台湾(中国的省)" for want="中国" (it contains
            # "中国" inside a parenthetical, but is not the country China).
            # For country aliases, match by prefix and exclude SAR/Taiwan variants.
            # Note: params['options'] may only contain the currently-visible
            # dropdown items (~21 of 250 for large country lists), so when the
            # canonical label is not in the stored list we fall back to the known
            # canonical name directly — JS_SELECT_OPTION will scroll to find it
            # (SELECT_LAZY_LOAD_ON_MISS block).
            resolved_option = option_text
            want = (option_text or '').strip()
            stored_opts = list(params.get('options') or [])
            if want in ('中国', '中国大陆'):
                # Prefer exact "中华人民共和国" in the stored list; otherwise a
                # label that starts with "中国" excluding SAR/Taiwan variants.
                fuzzy = next(
                    (o for o in stored_opts
                     if o.startswith('中国')
                     and '香港' not in o and '澳门' not in o and '台湾' not in o),
                    None,
                )
                if not fuzzy:
                    fuzzy = next(
                        (o for o in stored_opts if o == '中华人民共和国'), None,
                    )
                # If the canonical name isn't in the visible options at all, use
                # it directly — the dropdown scrolls to find it at retry time.
                if not fuzzy:
                    fuzzy = '中华人民共和国'
            else:
                fuzzy = match_select_option_candidate(want, stored_opts)
            if fuzzy and fuzzy != want:
                resolved_option = fuzzy
            reset_diag = await reset_select_ui(page)
            if not reset_diag.get('closed', False):
                sys.stderr.write(
                    f'[select] value-mismatch reset incomplete: {reset_diag}\n'
                )
                sys.stderr.flush()
                failed = await _final_select_failure(str(select_result), xp)
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
                )
            retrigger = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text])
            if _is_ok_result(str(retrigger)):
                await page.wait_for_timeout(WAIT_500_MS)
                retry_result = await page.evaluate(JS_SELECT_OPTION, resolved_option)
                if _is_ok_result(retry_result):
                    self.business_data_store.pop(mismatch_retry_key, None)
                    matched_text = retry_result.split(':', 1)[1] if ':' in retry_result else retry_result
                    stamped = resolve_recorded_option_text(option_text, matched_text)
                    params['option_text'] = stamped
                    params, element = attach_select_options(params, element, params.get('options'))
                    _record_action('select_option', params, matched_text, element=element)
                    _task_done_impl(
                        label_text, self.business_data_store, value=stamped or option_text, xpath_smart=xp_inv,
                    )
                    return _ok(_with_submit_cue(f'ok | {matched_text} | mismatch-retry', self.business_data_store))
                # Alias retry still mismatch (rare race: lazy chunk lag made even
                # the canonical-label hunt settle on the wrong prefix item) →
                # one FINAL strict attempt with exactOnly: no fuzzy fallback at
                # all, readback must equal the resolved label verbatim.
                if resolved_option != option_text:
                    await reset_select_ui(page)
                    retrigger2 = await page.evaluate(
                        JS_SELECT_TRIGGER_BY_XPATH, [xp, label_text]
                    )
                    if _is_ok_result(str(retrigger2)):
                        await page.wait_for_timeout(WAIT_500_MS)
                        strict_result = await page.evaluate(
                            JS_SELECT_OPTION, [resolved_option, True]
                        )
                        if _is_ok_result(strict_result):
                            self.business_data_store.pop(mismatch_retry_key, None)
                            matched_text = strict_result.split(':', 1)[1] if ':' in strict_result else strict_result
                            stamped = resolve_recorded_option_text(option_text, matched_text)
                            params['option_text'] = stamped
                            params, element = attach_select_options(params, element, params.get('options'))
                            _record_action('select_option', params, matched_text, element=element)
                            _task_done_impl(
                                label_text, self.business_data_store, value=stamped or option_text, xpath_smart=xp_inv,
                            )
                            return ok_marked(
                                self.business_data_store, label=label_text, got=matched_text,
                                fallback="mismatch-retry-exact",
                                wanted=(option_text if matched_text != option_text else ""),
                            )
                        failed = await _final_select_failure(str(strict_result), xp)
                        return err_with(
                            "err-select-option-unresolved",
                            f"别名解析至「{resolved_option}」仍回读不一致",
                            observed=f"label={label_text} last={failed}"[:160],
                            next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
                        )
                # Retry still mismatch / other failure → heal.
                self.business_data_store.pop(mismatch_retry_key, None)
                failed = await _final_select_failure(str(retry_result), xp)
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action='select_option(label_text="' + label_text + '", option_text=<从 现场/scan options 取原文>)',
                )
            failed = await _final_select_failure(str(select_result), xp)
            return err_with(
                "err-select-option-unresolved",
                f"无法稳定选中「{option_text}」",
                observed=f"label={label_text} last={failed}"[:160],
                next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
            )
        elif select_result.startswith('option-not-found:'):
            if is_replay and use_exact:
                failed = await _final_select_failure(str(select_result), xp)
                return failed
            # Fuzzy: pick listed option that contains / is contained by option_text
            listed = [x.strip() for x in select_result.split(':', 1)[1].split(',') if x.strip()]
            # Prefer union of live dropdown preview + stored options
            stored = list(params.get('options') or [])
            for x in listed:
                if x not in stored:
                    stored.append(x)
            params, element = attach_select_options(params, element, stored)
            want = (option_text or '').strip()
            fuzzy = match_select_option_candidate(want, stored)
            # Common alias: 中国 → 中华人民共和国
            if not fuzzy and want in ('中国', '中国大陆'):
                fuzzy = next((o for o in stored if '中国' in o), None)
            if fuzzy:
                fuzzy_result = await page.evaluate(
                    JS_SELECT_OPTION, _select_js_option_arg(fuzzy, use_exact),
                )
                if _is_ok_result(fuzzy_result):
                    matched_text = fuzzy_result.split(':', 1)[1] if ':' in fuzzy_result else fuzzy_result
                    if is_replay:
                        return str(fuzzy_result)
                    self.business_data_store.pop(f'_sel_retry_{label_text}', None)
                    params['option_text'] = matched_text
                    _record_action('select_option', params, matched_text, element=element)
                    _task_done_impl(label_text, self.business_data_store, value=matched_text, xpath_smart=xp_inv)
                    return _ok(_with_submit_cue(f'ok | {matched_text} | fuzzy-matched-from:{want}', self.business_data_store))
            # N4 paged-traverse fallback — runs BEFORE the filterable-typed
            # attempt, with filterable-typed demoted to its sub-strategy: a
            # paginated el-select renders only the first page and typing cannot
            # reach later pages (frz round-4/5: zero network on input, target on
            # page 24/29), so burning the 1.8s typed window first starves the
            # page-by-page traversal inside the 5s action budget. Not
            # applicable (no pagination control) → fall through to the
            # filterable-typed block below unchanged. Budget-aware: pass the
            # remaining select_option budget (minus a 300ms margin) into the JS.
            elapsed_ms = (time.monotonic() - impl_started) * 1000
            paged_budget_ms = max(800, int(budget_for('select_option') * 1000 - elapsed_ms - 300))
            paged_result = str(await page.evaluate(
                JS_SELECT_PAGED_TRAVERSE, [want, paged_budget_ms],
            ))
            if str(paged_result).startswith('ok-select-paged'):
                matched_text = paged_result.split(':', 1)[1] if ':' in paged_result else want
                if is_replay:
                    return str(paged_result)
                self.business_data_store.pop(f'_sel_retry_{label_text}', None)
                stamped = resolve_recorded_option_text(option_text, matched_text)
                params['option_text'] = stamped
                params, element = attach_select_options(params, element, params.get('options'))
                _record_action('select_option', params, matched_text + ' | select-paged', element=element)
                _task_done_impl(
                    label_text, self.business_data_store, value=stamped or matched_text, xpath_smart=xp_inv,
                )
                return _ok(_with_submit_cue(f'ok | {matched_text} | select-paged', self.business_data_store))
            paged_applicable = str(paged_result).startswith('select-paged-no-match')
            sys.stderr.write(
                f'[select] paged-traverse attempt label={label_text!r} '
                f'option={option_text!r} result={paged_result!r}\n'
            )
            sys.stderr.flush()
            self.business_data_store['_last_select_paged'] = {
                'label': label_text, 'option': option_text, 'result': paged_result,
            }
            if paged_applicable:
                # Pagination existed but the target was not reached within the
                # remaining budget — typed filtering cannot help paginated
                # dropdowns, fail with the paged diagnostic.
                failed = await _final_select_failure(
                    str(select_result) + ' | select-paged:' + paged_result, xp,
                )
                if is_replay:
                    return failed
                return err_with(
                    "err-select-option-unresolved",
                    f"无法稳定选中「{option_text}」",
                    observed=f"label={label_text} last={failed}"[:160],
                    next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
                )
            # N1 filterable-typed fallback — sub-strategy of the paged fallback,
            # only reached when the dropdown has NO pagination control (plain
            # remote/filterable select). Original chain otherwise unchanged.
            filterable_result = str(await page.evaluate(JS_SELECT_FILTERABLE_TYPED, want))
            if _is_ok_result(filterable_result):
                matched_text = filterable_result.split(':', 1)[1] if ':' in filterable_result else want
                if is_replay:
                    return str(filterable_result)
                self.business_data_store.pop(f'_sel_retry_{label_text}', None)
                stamped = resolve_recorded_option_text(option_text, matched_text)
                params['option_text'] = stamped
                params, element = attach_select_options(params, element, params.get('options'))
                _record_action('select_option', params, matched_text + ' | filterable-typed', element=element)
                _task_done_impl(
                    label_text, self.business_data_store, value=stamped or matched_text, xpath_smart=xp_inv,
                )
                return _ok(_with_submit_cue(f'ok | {matched_text} | filterable-typed', self.business_data_store))
            sys.stderr.write(
                f'[select] filterable-typed attempt failed label={label_text!r} '
                f'option={option_text!r} result={filterable_result!r}\n'
            )
            sys.stderr.flush()
            self.business_data_store['_last_select_filterable_typed'] = {
                'label': label_text, 'option': option_text, 'result': filterable_result,
            }
            failed = await _final_select_failure(
                str(select_result) + ' | filterable-typed:' + filterable_result
                + ' | select-paged:' + paged_result, xp,
            )
            if is_replay:
                return failed
            return err_with(
                "err-select-option-unresolved",
                f"无法稳定选中「{option_text}」",
                observed=f"label={label_text} last={failed}"[:160],
                next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
            )
        else:
            failed = await _final_select_failure(str(select_result), xp)
            if is_replay:
                return failed
            return err_with(
                "err-select-option-unresolved",
                f"无法稳定选中「{option_text}」",
                observed=f"label={label_text} last={failed}"[:160],
                next_action=_select_failure_next_action(label_text, option_text, self.business_data_store),
            )

    async def tssc_multi_select(
        self,
        label_text: str,
        option_text: str,
        xpath_smart: str = "",
        *,
        mode: str = "record",
        element: dict | None = None,
    ):
        is_replay = mode == "replay"
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._maybe_ensure_scanned(label_text, mode)
        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
        label_text = (resolved.label or label_text or '').strip() or label_text
        xp = '' if resolved.error else (resolved.xpath_smart or '').strip()
        captured = element if isinstance(element, dict) else None
        if captured is None:
            captured = await _capture_element(
                page, label_text, target_kind='form_tssc_multi_select', xpath_smart=xp,
            )
        result = await page.evaluate(JS_TSSC_MULTI_SELECT, [label_text, option_text])
        if _is_ok_result(result):
            if is_replay:
                return str(result)
            # ok-first:部署方式 / ok:… / ok-echo:… / ok-already:… → stamp concrete
            # option_text (never persist sentinel "first" for replay/partner push).
            res_s = str(result or '')
            echo = res_s.split(':', 1)[1].strip() if ':' in res_s else ''
            stamped = resolve_recorded_option_text(option_text, echo)
            element = captured
            if element is None and xp:
                element = await _capture_element(
                    page, label_text, target_kind='form_tssc_multi_select', xpath_smart=xp,
                )
            if element is None:
                element = {
                    'tag_name': 'div',
                    'xpath': xp or '',
                    'xpath_smart': xp or '',
                    'formLabel': label_text,
                    'target_kind': 'form_tssc_multi_select',
                    'text': (stamped or option_text or '')[:80],
                    'attributes': {},
                    'candidates': (
                        [{'type': 'xpath_smart', 'value': xp}] if xp else []
                    ),
                }
            elif isinstance(element, dict) and stamped:
                element = dict(element)
                element['text'] = (stamped or '')[:80]
            xp_inv = stamp_recorded_xpath_smart(element, xp)
            _record_action(
                'select_option',
                {'label_text': label_text, 'option_text': stamped},
                result,
                element=element,
            )
            _task_done_impl(
                label_text, self.business_data_store,
                value=stamped or option_text, xpath_smart=xp_inv,
            )
            return _ok(result)
        res_s = str(result or '')
        if res_s == 'disabled' or res_s.startswith('disabled'):
            return (
                f'disabled | Field "{label_text}" is read-only (TsscMultiSelect). '
                f'Do NOT retry select_option — skip this field.'
            )
        if res_s.startswith('no-tssc-multi-select'):
            return (
                res_s + ' Field is not TsscMultiSelect. '
                'Use select_option for plain el-select, or report.'
            )
        if res_s.startswith('err-no-echo'):
            return (
                res_s + ' Do NOT blindly retry. check_field_value or report.'
            )
        if res_s.startswith('option-not-found') or res_s.startswith('no-items'):
            return (
                res_s
                + ' | Do NOT fill_form_field / real_click「精确查询」.'
                + ' 任务写「任一/任意」或 stamp/组件名不是数据项时用'
                + f' select_option(label_text="{label_text}", option_text="first")；'
                + ' 否则 option_text 必须是弹层表格「中文名」列原文。'
            )
        return res_s

    # ── Adjacent button / radio (moved from misc for logical grouping) ──




class RadioEngine(_FormActionEngineBase):
    @classmethod
    async def click_radio_for_replay(
        cls,
        page,
        label_text: str,
        option_text: str,
        *,
        xpath_smart: str = "",
        business_data_store: dict | None = None,
    ):
        """Replay entry: construct engine with page adapter and run mode=replay."""
        store = _replay_engine_store(business_data_store)
        bc = _ReplayPageAdapter(page)
        autofill = _ReplayAutofillStub()
        engine = cls(bc, store, autofill)
        return await engine.click_radio(
            label_text,
            option_text,
            xpath_smart,
            mode="replay",
        )

    async def click_radio(
        self,
        label_text: str,
        option_text: str,
        xpath_smart: str = "",
        *,
        mode: str = "record",
    ):
        is_replay = mode == "replay"
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._maybe_ensure_scanned(label_text, mode)
        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
        if resolved.error:
            err = resolved.error
            if is_replay:
                return _unwrap_action_result(err) if not isinstance(err, str) else str(err)
            return err
        label_resolved = resolved.label
        xp = (resolved.xpath_smart or "").strip()
        element = await _capture_element(
            page, label_resolved, target_kind='form_radio', xpath_smart=xp,
        )

        if xp:
            result = await page.evaluate(JS_CLICK_RADIO_BY_XPATH, [xp, option_text])
            if is_absent_field_result(result) or _is_ok_result(result):
                pass
            else:
                result = await page.evaluate(JS_CLICK_RADIO, [label_resolved, option_text])
        else:
            result = await page.evaluate(JS_CLICK_RADIO, [label_resolved, option_text])

        if is_absent_field_result(result):
            if is_replay:
                sys.stderr.write(f'[form] skip absent radio label={label_resolved!r}\n')
                sys.stderr.flush()
                return absent_field_skip_result()
            if not _is_query_mode(self.business_data_store):
                _task_done_impl(label_resolved, self.business_data_store)
            sys.stderr.write(f'[form] skip absent radio label={label_resolved!r}\n')
            sys.stderr.flush()
            return _ok(_with_submit_cue(absent_field_skip_result(), self.business_data_store))

        if _is_ok_result(result):
            if is_replay:
                return str(result)
            xp_inv = stamp_recorded_xpath_smart(element, xp)
            _record_action(
                'click_radio',
                {
                    'label_text': label_resolved,
                    'option_text': option_text,
                },
                result,
                element=element,
            )
            _task_done_impl(
                label_resolved, self.business_data_store, value=option_text, xpath_smart=xp_inv,
            )
            return _ok(result)
        if is_replay:
            return str(result)
        return result




class TreeEngine(_FormActionEngineBase):
    @classmethod
    async def select_tree_option_for_replay(
        cls,
        page,
        label_text: str,
        option_text: str,
        *,
        xpath_smart: str = "",
        business_data_store: dict | None = None,
    ):
        """Replay entry: construct engine with page adapter and run mode=replay."""
        store = _replay_engine_store(business_data_store)
        bc = _ReplayPageAdapter(page)
        autofill = _ReplayAutofillStub()
        engine = cls(bc, store, autofill)
        return await engine.select_tree_option(
            label_text,
            option_text,
            xpath_smart,
            mode="replay",
        )

    async def expand_all_el_tree(self):
        page = await self.browser_context.get_current_page()
        total = 0
        for _ in range(10):
            clicked = await page.evaluate(JS_EXPAND_ALL_EL_TREE)
            if clicked == -1:
                return _err('no-el-tree-found')
            if clicked == 0:
                break
            total += clicked
            await page.wait_for_timeout(WAIT_500_MS)
        return _ok(f'ok-expanded-{total}-nodes')


    async def select_tree_option(
        self,
        label_text: str,
        option_text: str,
        xpath_smart: str = "",
        *,
        mode: str = "record",
    ):
        is_replay = mode == "replay"
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)
        await self._maybe_ensure_scanned(label_text, mode)
        resolved = _resolve_control(self.business_data_store, label_text, xpath_smart)
        # Soft resolve: tree-select can still run via label JS when scan miss;
        # capture uses resolved xpath when present so steps stamp form_tree_select.
        label_text = (resolved.label or label_text or '').strip() or label_text
        xp = '' if resolved.error else (resolved.xpath_smart or '').strip()
        element = await _capture_element(
            page, label_text, target_kind='form_tree_select', xpath_smart=xp,
        )
        result = await page.evaluate(JS_SELECT_TREE_OPTION, [label_text, option_text])
        # P0/P1/P2 success codes all use ok prefix → recordable via _is_ok_result
        if _is_ok_result(result):
            if is_replay:
                return str(result)
            if element is None and xp:
                element = await _capture_element(
                    page, label_text, target_kind='form_tree_select', xpath_smart=xp,
                )
            if element is None:
                # Last resort: stamp label-only meta so persist has form_tree_select
                element = {
                    'tag_name': 'div',
                    'xpath': xp or '',
                    'xpath_smart': xp or '',
                    'formLabel': label_text,
                    'target_kind': 'form_tree_select',
                    'text': (option_text or '')[:80],
                    'attributes': {},
                    'candidates': (
                        [{'type': 'xpath_smart', 'value': xp}] if xp else []
                    ),
                }
            xp_inv = stamp_recorded_xpath_smart(element, xp)
            _record_action(
                'select_tree_option',
                {'label_text': label_text, 'option_text': option_text},
                result,
                element=element,
            )
            _task_done_impl(label_text, self.business_data_store, value=option_text, xpath_smart=xp_inv)
            return _ok(result)
        res_s = str(result or '')
        if res_s == 'disabled' or res_s.startswith('disabled'):
            return (
                f'disabled | Field "{label_text}" is read-only '
                f'(TsscMultiTree/component disabled; e.g. 分类目录 prefilled from sidebar). '
                f'Do NOT retry select_tree_option or fill_form_field — skip this field.'
            )
        # Misclassified / non-Tssc field: concrete values often work via native fill
        if res_s.startswith('no-tree-component'):
            fill_val = (option_text or '').strip()
            if fill_val and fill_val.lower() != 'first':
                resolved_fill = _resolve_control(self.business_data_store, label_text, '')
                fill_xpath = '' if resolved_fill.error else resolved_fill.xpath_smart
                if fill_xpath:
                    fill_el = await _capture_element(
                        page, label_text, target_kind='form_input', xpath_smart=fill_xpath,
                    )
                    fill_result = await page.evaluate(
                        JS_FILL_BY_XPATH, [fill_xpath, fill_val, label_text],
                    )
                    xp_inv = stamp_recorded_xpath_smart(fill_el, fill_xpath)
                    record_params = {
                        'label_text': label_text,
                        'value': fill_val,
                    }
                else:
                    fill_el = None
                    fill_result = await page.evaluate(JS_FILL_FORM_FIELD, [label_text, fill_val])
                    record_params = {'label_text': label_text, 'value': fill_val}
                if _is_ok_result(fill_result):
                    if is_replay:
                        return str(fill_result)
                    _record_action(
                        'fill_form_field',
                        record_params,
                        fill_result,
                        element=fill_el,
                    )
                    _task_done_impl(
                        label_text, self.business_data_store, value=fill_val,
                        xpath_smart=xp_inv if fill_xpath else '',
                    )
                    return _ok(
                        f'ok-fill-fallback:{fill_val} | was no-tree-component; '
                        f'recorded as fill_form_field (do not retry select_tree_option)'
                    )
                return (
                    f'{res_s} | fill_form_field also failed ({fill_result}). '
                    f'Do NOT retry select_tree_option on this field.'
                )
            return (
                f'{res_s} | option_text="first" cannot fill. '
                f'Do NOT retry select_tree_option. '
                f'Call fill_form_field("{label_text}", concreteValue) '
                f'or select_option if the field is an el-select.'
            )
        return result

