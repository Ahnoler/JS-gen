"""ClickEngine: click_element_by_index / click_button record+replay (Phase B)."""

import re
import sys

from scripts import state as _state
from ._helpers import _ok, _err, _enrich_click_element, _is_ok_result, _wait_if_loading
from .result_protocol import err_with
from ._js_snippets import (
    JS_CLICK_ICON_BUTTON,
    JS_STAMP_ICON_ARIA_LABELS,
    JS_STRIP_STALE_WRAPPERS,
)
from .js_snippets._locator_helpers_js import PAGE_LOCATOR_HELPERS
from .replay_timing import WAIT_400_MS, WAIT_450_MS
from .replay_click import _replay_click_by_index
from ._misc import (
    _is_form_submit_label,
    _JS_CLICK_BUTTON_IN_CONTAINER,
    _JS_VISIBLE_FORM_OVERLAY,
)


class ClickEngine:
    def __init__(self, browser_context, business_data_store=None):
        self.browser_context = browser_context
        self.business_data_store = business_data_store

    async def click_button(self, button_text: str, *, mode: str = "record"):
        if mode == "replay":
            raise ValueError("use click_button_for_replay(page, entry, params)")
        bt = str(button_text or '').strip()
        if _is_form_submit_label(bt):
            # 统一保存入口：保存/提交类一律走 click_save（outcome 校验 + 可导出落库）
            return (
                f'err-use-click-save:{bt} | '
                f'"保存/提交/确认"类按钮请改用 click_save(button_text="{bt}")；'
                f'分区保存用 click_save(button_text="{bt}", region="<分区标题>")'
            )
        page = await self.browser_context.get_current_page()
        # Pre-strip stale dialog wrappers (tsscMutilDialog 关闭残留) so real
        # clicks reach the target; idempotent, <10ms.
        try:
            await page.evaluate(JS_STRIP_STALE_WRAPPERS)
        except Exception:
            pass
        try:
            await page.evaluate(JS_STAMP_ICON_ARIA_LABELS)
        except Exception:
            sys.stderr.write("[click-button] JS_STAMP_ICON_ARIA_LABELS failed button={button_text!r}" + '\n')
            sys.stderr.flush()
            pass
        element = await _enrich_click_element(
            page, text=button_text, target_kind='icon',
        )
        # G1 container-scope-first: if a visible drawer/dialog is open and a
        # matching button exists inside it, click the in-overlay one; only fall
        # back to the page-level JS_CLICK_ICON_BUTTON on miss (original
        # page-level behavior fully unchanged when no container matches).
        container_result = ''
        try:
            container_result = await page.evaluate(
                _JS_CLICK_BUTTON_IN_CONTAINER, [button_text]
            )
        except Exception as _container_exc:
            sys.stderr.write(
                "[click-button] container-scope probe failed: " + repr(_container_exc) + '\n'
            )
            sys.stderr.flush()
            container_result = ''
        if isinstance(container_result, str) and (
            container_result.startswith('ok-container:')
            or container_result.startswith('ok-click:')
        ):
            result = container_result
        else:
            result = await page.evaluate(JS_CLICK_ICON_BUTTON, button_text)
        await page.wait_for_timeout(WAIT_400_MS)
        if _is_ok_result(result):
            _state._record_action(
                'click_button',
                {'button_text': button_text},
                result,
                element=element,
            )
            if self.business_data_store is not None:
                from scripts.controller.actions.container_naming import remember_trigger_button
                remember_trigger_button(self.business_data_store, button_text)
                if re.sub(r'\s+', '', bt) == '查询':
                    from scripts.controller.actions.search_then_click_guard import mark_query_clicked
                    mark_query_clicked(self.business_data_store)
            return _ok(result)
        if str(result).startswith('err-icon-label-ambiguous:'):
            # Generalized fallback found same-label buttons but could not pick
            # one safely (ambiguous) — hand the candidates to the agent.
            return err_with(
                "icon-label-ambiguous",
                "同名或相近文字按钮有多个，无法唯一选择",
                observed=result.split(':', 1)[1],
                next_action="从 现场/textButtons 取完整按钮文字后用 click_element_by_index，或提供更精确 button_text 重试本动作",
            )
        if str(result).startswith('err-icon-label-miss'):
            return err_with(
                "icon-label-miss",
                f"页面未找到标签含「{button_text}」的图标宿主或文字按钮",
                next_action='核对 get_page_state().iconButtons 清单；确认目标可见；行内目标请用 click_table_row_button',
            )
        return result

    async def click_element_by_index(self, index: int, *, mode: str = "record"):
        """Replacement for default click_element_by_index."""
        if mode == "replay":
            raise ValueError("use click_element_by_index_for_replay(...)")
        page = await self.browser_context.get_current_page()
        try:
            element_node = await self.browser_context.get_dom_element_by_index(index)
            # Capture stable locators BEFORE click (drawer/dialog may unmount after).
            element_info = None
            elem_text = ''
            tag_name = ''
            if element_node:
                try:
                    elem_text = element_node.get_all_text_till_next_clickable_element() or ''
                    elem_text = elem_text.strip()[:80]
                except Exception:
                    sys.stderr.write("[click] capture element text failed index={index!r}" + '\n')
                    sys.stderr.flush()
                    elem_text = ''
                tag_name = element_node.tag_name or ''
                element_info = await _enrich_click_element(
                    page,
                    xpath=element_node.xpath or '',
                    text=elem_text,
                    tag_name=tag_name,
                    attributes=element_node.attributes or {},
                )

            # Forbid index-click on el-select dropdown surfaces (option li / table-in-select
            # rows / dropdown body). Agents otherwise record 点击元素 with concatenated
            # company names (对公评级申请「客户名称」TsscMultiSelect) then still call
            # select_option — duplicate junk step. Same rule as prompt EL-SELECT §2–3.
            gate_xp = str(
                (element_info or {}).get('xpath')
                or getattr(element_node, 'xpath', None)
                or ''
            )
            try:
                dd_gate = await page.evaluate(
                    '''(xpath) => {
                        let node = null;
                        if (xpath) {
                            try {
                                node = document.evaluate(
                                    xpath, document, null,
                                    XPathResult.FIRST_ORDERED_NODE_TYPE, null
                                ).singleNodeValue;
                            } catch (e) {}
                        }
                        if (!node || node.nodeType !== 1) return { hit: false };
                        const dd = node.closest && node.closest('.el-select-dropdown');
                        if (!dd) return { hit: false };
                        const inItem = !!(node.closest('.el-select-dropdown__item'));
                        const inRow = !!(node.closest('tr.el-table__row, .el-table__row'));
                        return {
                            hit: true,
                            kind: inRow ? 'table-row' : (inItem ? 'option' : 'dropdown'),
                        };
                    }''',
                    gate_xp,
                )
                if isinstance(dd_gate, dict) and dd_gate.get('hit'):
                    kind = str(dd_gate.get('kind') or 'dropdown')
                    return _err(
                        f'use-select-option | Index click on el-select dropdown ({kind}) '
                        f'is forbidden — do not record 点击元素. '
                        f'Call select_option(label_text=..., option_text=...) only '
                        f'(table-in-select / 客户名称 remote rows included).',
                        include_in_memory=True,
                    )
            except Exception:
                sys.stderr.write("[click] el-select dropdown gate check failed index={index!r}" + '\n')
                sys.stderr.flush()
                pass

            if gate_xp:
                try:
                    from .search_then_click_guard import guard_locate_or_err, xpath_is_tree_node
                    if await xpath_is_tree_node(page, gate_xp):
                        stc_err = await guard_locate_or_err(page, self.business_data_store)
                        if stc_err:
                            return _err(stc_err, include_in_memory=True)
                except Exception:
                    sys.stderr.write("[click] search-then-click tree gate failed index={index!r}" + '\n')
                    sys.stderr.flush()

            # Forbid index-click on form-dialog 确认/保存 — forces click_save and stops
            # select→修改→确认 loops after premature done() rejection.
            # Exception: customer-magnifier / query-toolbar pickers — allow 确认.
            btn_label = ((element_info or {}).get('text') or elem_text or '').strip()
            if _is_form_submit_label(btn_label):
                compact = re.sub(r'\s+', '', btn_label)
                in_form_overlay = False
                dialog_title = ''
                is_picker_ui = False
                try:
                    overlay_info = await page.evaluate('''() => {
''' + PAGE_LOCATOR_HELPERS + '''
                        // Prefer topmost visible dialog by z-index
                        let best = null;
                        let bestZ = -1;
                        const consider = (d, titleSel) => {
                            const wrap = d.closest('.el-dialog__wrapper, .el-drawer__wrapper') || d;
                            if (!isVisible(wrap) || !isVisible(d)) return;
                            const z = parseInt(getComputedStyle(wrap).zIndex || '0', 10) || 0;
                            if (z < bestZ) return;
                            const title = titleSel(d);
                            const hasForm = !!d.querySelector('.el-form');
                            const btns = d.querySelectorAll('button, .el-button');
                            let hasQuery = false, hasSave = false, hasConfirm = false;
                            for (const b of btns) {
                                if (b.offsetParent === null && b.getClientRects().length === 0) continue;
                                const t = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
                                if (/^(查询|搜索|查找)$/.test(t)) hasQuery = true;
                                if (/^(保存|提交)$/.test(t)) hasSave = true;
                                if (/^(确认|确定)$/.test(t)) hasConfirm = true;
                            }
                            bestZ = z;
                            best = { inForm: hasForm, title, hasQuery, hasSave, hasConfirm };
                        };
                        for (const d of document.querySelectorAll('.el-dialog')) {
                            consider(d, (el) => (el.querySelector('.el-dialog__title')?.textContent || '').trim());
                        }
                        for (const d of document.querySelectorAll('.el-drawer')) {
                            consider(d, (el) => (el.getAttribute('aria-label') || '').trim());
                        }
                        return best || { inForm: false, title: '', hasQuery: false, hasSave: false, hasConfirm: false };
                    }''')
                    if isinstance(overlay_info, dict):
                        in_form_overlay = bool(overlay_info.get('inForm'))
                        dialog_title = str(overlay_info.get('title') or '')
                        is_picker_ui = bool(
                            overlay_info.get('hasQuery') and not overlay_info.get('hasSave')
                        )
                except Exception:
                    sys.stderr.write("[click] overlay scan failed (fallback _JS_VISIBLE_FORM_OVERLAY)" + '\n')
                    sys.stderr.flush()
                    in_form_overlay = bool(await page.evaluate(_JS_VISIBLE_FORM_OVERLAY))

                # Authoritative: page-level query toolbar / sticky flag (overlay scan can miss)
                if compact.startswith(('确认', '确定')):
                    try:
                        from ._js_snippets import JS_IS_QUERY_TOOLBAR
                        if (self.business_data_store or {}).get('_query_ui') or await page.evaluate(JS_IS_QUERY_TOOLBAR):
                            is_picker_ui = True
                    except Exception:
                        sys.stderr.write("[click] JS_IS_QUERY_TOOLBAR picker-ui check failed" + '\n')
                        sys.stderr.flush()
                        if (self.business_data_store or {}).get('_query_ui'):
                            is_picker_ui = True

                try:
                    from scripts.controller.actions._phase_intent import is_action_in_scope
                    allowed, _reject = is_action_in_scope(
                        self.business_data_store,
                        'click_element_by_index',
                        {
                            'btn_label': btn_label,
                            'in_form_overlay': in_form_overlay,
                            'dialog_title': dialog_title,
                            'is_picker_ui': is_picker_ui,
                            'container_id': '',
                            'query_ui': is_picker_ui or bool(
                                (self.business_data_store or {}).get('_query_ui')
                            ),
                        },
                    )
                    block = not allowed
                except Exception:
                    sys.stderr.write("[click] is_action_in_scope failed (submit-block fallback)" + '\n')
                    sys.stderr.flush()
                    block = compact.startswith(('保存', '提交')) or (
                        in_form_overlay and not is_picker_ui
                    )

                # Hard allow: never trap picker confirm in use-click-save ↔ not-form-save loop
                if block and compact.startswith(('确认', '确定')) and is_picker_ui:
                    block = False
                    sys.stderr.write(
                        f'[click] allow index confirm on picker UI title={dialog_title!r}\n'
                    )
                    sys.stderr.flush()

                # Hard block: query/picker UI never index-click 保存/提交
                if compact.startswith(('保存', '提交')) and is_picker_ui:
                    block = True

                if block:
                    if compact.startswith(('保存', '提交')) and is_picker_ui:
                        return _err(
                            f'not-form-save | Index click on "{btn_label}" forbidden on query/picker UI. '
                            f'Use 查询 / 确认 instead of 保存/提交.',
                            include_in_memory=True,
                        )
                    if compact.startswith('确认'):
                        needle = '确认'
                    elif compact.startswith('确定'):
                        needle = '确定'
                    elif compact.startswith('提交'):
                        needle = '提交'
                    else:
                        needle = '保存'
                    return _err(
                        f'use-click-save | Index click on "{btn_label}" is forbidden for form submit. '
                        f'Call click_save(button_text="{needle}") NOW. '
                        f'Do NOT re-select the table row or re-click 修改 — if the dialog is open, '
                        f'only click_save. Success = 操作成功 toast OR post-save navigation.',
                        include_in_memory=True,
                    )

            if btn_label and re.sub(r'\s+', '', btn_label).startswith(('确认', '确定')):
                try:
                    from ._js_snippets import JS_WATCH_SAVE_NOTIFICATIONS
                    await page.evaluate(JS_WATCH_SAVE_NOTIFICATIONS)
                except Exception:
                    sys.stderr.write("[click] JS_WATCH_SAVE_NOTIFICATIONS failed" + '\n')
                    sys.stderr.flush()
                    pass
            url_before = getattr(page, 'url', '') or ''
            download_path = await self.browser_context._click_element_node(element_node)
            if download_path:
                return _ok(f'downloaded:{download_path}')
            # Navigation detection for page-transitioning clicks (e.g. 客户转正 → new page).
            # If URL changed after the click, record a flag that recorder_emitters turns
            # into a [导航] HumanMessage cue — recorded step stays ok-clicked-N.
            try:
                await _wait_if_loading(page)
                url_after = getattr(page, 'url', '') or ''
                if url_before and url_after and url_before != url_after:
                    if self.business_data_store is not None:
                        self.business_data_store['_last_click_navigated'] = {
                            'from': url_before,
                            'to': url_after,
                        }
            except Exception:
                sys.stderr.write("[click] post-click navigation detection failed" + '\n')
                sys.stderr.flush()
                pass
            if element_node:
                raw_xp = str(getattr(element_node, 'xpath', None) or '')
                raw_cls = str((element_node.attributes or {}).get('class')
                              or (element_node.attributes or {}).get('className')
                              or '')
                is_tree_node_click = (
                    'el-tree-node' in raw_xp
                    or 'el-tree-node__content' in raw_cls
                    or 'el-tree-node__label' in raw_cls
                )
                form_label = str((element_info or {}).get('formLabel') or '').strip()
                tree_opt = (elem_text or '').strip()
                if (
                    is_tree_node_click
                    and (element_info or {}).get('target_kind') == 'form_tree_select'
                    and form_label
                    and tree_opt
                ):
                    if element_info is not None:
                        element_info = dict(element_info)
                        element_info['text'] = tree_opt[:80]
                        element_info['target_kind'] = 'form_tree_select'
                        element_info['formLabel'] = form_label
                    _state._record_action(
                        'select_tree_option',
                        {'label_text': form_label, 'option_text': tree_opt},
                        f'ok-clicked-{index}',
                        element=element_info,
                    )
                else:
                    _state._record_action('click_element_by_index', {
                        'index': index,
                        'tag_name': element_info.get('tag_name') if element_info else tag_name,
                        'text': (element_info or {}).get('text') or elem_text or '',
                    }, f'ok-clicked-{index}', element=element_info)
                if self.business_data_store is not None:
                    from scripts.controller.actions.container_naming import remember_trigger_button
                    remember_trigger_button(
                        self.business_data_store,
                        (element_info or {}).get('text') or elem_text or '',
                    )
                try:
                    from scripts.controller.actions._phase_intent import record_success_token
                    from scripts.controller.actions._phase_boundary import maybe_record_picker_closed
                    compact2 = re.sub(r'\s+', '', btn_label)
                    if compact2.startswith(('确认', '确定')):
                        await page.wait_for_timeout(WAIT_450_MS)
                        # Classify notifications: success texts (状态更新成功 etc.) → toast_ok;
                        # real errors → err-notification. Never treat success as failure.
                        note = await page.evaluate(
                            r'''() => {
                                const w = window.__saveWatch || { errorNotifs: [], successNotifs: [] };
                                const failRe = /失败|错误|异常|不能|不允许|已存在|重复|校验|必填|不通过/;
                                const successRe = /操作成功|保存成功|提交成功|新建成功|修改成功|删除成功|状态更新成功|更新成功|启用成功|禁用成功|克隆成功/;
                                const errors = [];
                                const successes = [];
                                const seen = new Set();
                                const take = (raw, hint) => {
                                    const s = String(raw || '').replace(/\s+/g, ' ').trim();
                                    if (!s || seen.has(s)) return;
                                    seen.add(s);
                                    if (hint === 'error' || failRe.test(s)) errors.push(s.slice(0, 160));
                                    else if (hint === 'success' || successRe.test(s)) successes.push(s.slice(0, 160));
                                };
                                for (const t of (w.errorNotifs || [])) take(t, 'error');
                                for (const t of (w.successNotifs || [])) take(t, 'success');
                                for (const el of document.querySelectorAll('.el-notification')) {
                                    const r = el.getBoundingClientRect();
                                    if (r.width <= 0 || r.height <= 0) continue;
                                    const cls = String(el.className || '');
                                    const text = (el.textContent || '').trim();
                                    if (/el-notification--error/.test(cls)) take(text, 'error');
                                    else take(text, 'live');
                                }
                                return { errors, successes };
                            }'''
                        )
                        errors = (note or {}).get('errors') if isinstance(note, dict) else None
                        successes = (note or {}).get('successes') if isinstance(note, dict) else None
                        if isinstance(errors, list) and errors:
                            err_text = str(errors[0])[:200]
                            sys.stderr.write(f'[click] confirm error notification: {err_text}\n')
                            sys.stderr.flush()
                            return _err(
                                f'err-notification:{err_text} | 系统报错，本次确认未成功。'
                                '先按报错修正选择（如更换或清除已选人）再继续，'
                                '禁止原样重复点击确认。',
                                include_in_memory=True,
                            )
                        if isinstance(successes, list) and successes:
                            ok_text = str(successes[0])[:200]
                            record_success_token(self.business_data_store, 'toast_ok', ok_text)
                            sys.stderr.write(
                                f'[click] confirm success notification → toast_ok: {ok_text[:80]}\n'
                            )
                            sys.stderr.flush()
                        record_success_token(self.business_data_store, 'confirm_click', btn_label)
                        await page.wait_for_timeout(WAIT_400_MS)
                        still = False
                        try:
                            from ._js_snippets import JS_IS_QUERY_TOOLBAR
                            still = bool(await page.evaluate(JS_IS_QUERY_TOOLBAR))
                        except Exception:
                            sys.stderr.write("[click] confirm JS_IS_QUERY_TOOLBAR recheck failed" + '\n')
                            sys.stderr.flush()
                            still = False
                        parent = (self.business_data_store or {}).get('_parent_container_before_picker') or 'main'
                        maybe_record_picker_closed(
                            self.business_data_store, still_query_ui=still, parent_container=parent,
                        )
                        if not still:
                            # Parent maintain form still needs toast_ok via click_save.
                            self.business_data_store['_submit_ready'] = True
                            self.business_data_store.pop('_query_ui', None)
                            sys.stderr.write(
                                '[click] picker confirm closed → submit-ready for parent save\n'
                            )
                            sys.stderr.flush()
                except Exception:
                    sys.stderr.write("[click] picker confirm record/close helper failed" + '\n')
                    sys.stderr.flush()
                    pass
            return _ok(f'ok-clicked-{index}')
        except Exception as e:
            import traceback as _tb
            sys.stderr.write(f'[click] click_element_by_index index={index} exception: {e}\n{_tb.format_exc()}\n')
            sys.stderr.flush()
            return _err(f'click-failed:{e}')

    @classmethod
    async def click_element_by_index_for_replay(
        cls,
        page,
        entry: dict,
        params: dict,
    ) -> str:
        """Replay durable click; ignores ephemeral highlight index."""
        return await _replay_click_by_index(page, entry or {}, params or {})

    @classmethod
    async def click_button_for_replay(
        cls,
        page,
        entry: dict,
        params: dict,
    ) -> str:
        """Replay click_button via same durable path (params already text-mapped)."""
        return await _replay_click_by_index(page, entry or {}, params or {})
