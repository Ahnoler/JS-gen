"""ClickEngine: click_element_by_index / click_button record+replay (Phase B)."""

import re
import sys

from scripts import state as _state
from ._helpers import (
    _ok, _err, _enrich_click_element, _is_ok_result, _wait_if_loading,
    _strip_volatile_tree_text,
)
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

_FIRST_LEAF_TREE_LOCAL = (
    "div[contains(@class,'el-tree')]"
    "//div[contains(@class,'el-tree-node')]"
    "[.//span[contains(@class,'el-tree-node__expand-icon')"
    " and contains(@class,'is-leaf')]][1]"
    "/div[contains(@class,'el-tree-node__content')]"
)

_FIRST_ROW_RADIO_LOCAL = (
    "div[contains(@class,'el-table__body-wrapper')]"
    "//tr[contains(@class,'el-table__row')][1]"
    "//*[contains(@class,'el-radio') or contains(@class,'el-radio-button') "
    "or contains(@class,'el-checkbox')]"
)

# Reset/clear button labels — dangerous in query phases because they wipe
# conditions the agent just filled.  Only allowed when the phase description
# explicitly asks for a reset action.
_RESET_BTN_RE = re.compile(
    r'^(重置|清空|清除|恢复默认|全部清空|清空条件|清空筛选|清除条件|清除筛选)$'
)
_RESET_PHASE_RE = re.compile(r'重置|清空|清除|恢复默认')

# wet9 (#902/#903): SUT 树重载会清掉 el-tree 过滤但保留搜索框关键字，自愈须
# 再点一次搜索图标——幂等动作（搜索/查询/检索/刷新/翻页）天然需要同元素多次
# 触发，already-operated-this-phase 拒绝会堵死该自愈路径（错位态锁死）。
# 全锚定匹配：复合词（如「保存查询方案」含查询）不放行。
_IDEMPOTENT_BTN_RE = re.compile(
    r'^(搜索|查询|检索|刷新|重新加载|加载|翻页|下一页|上一页|末页|首页|'
    r'(?:重新)?(?:搜索|查询|检索|刷新)(?:图标|按钮|产品树|列表|树|数据|页面|条件|结果)*|'
    r'刷新[列表树数据页面]*|搜索图标|查询图标|刷新图标)$'
)


def _is_idempotent_click_label(text: str) -> bool:
    t = re.sub(r'\s+', '', (text or '').strip())
    return bool(t and _IDEMPOTENT_BTN_RE.match(t))


# wet9-B3r (#904 P6) ③裁决：页面卡死时 agent 重击左侧菜单/树链接复位被
# already-operated-this-phase 拒——「卡死复位」自愈路径仍被堵。纳入导航类
# 元素（菜单/链接）的重击放行，但**限流**：每元素每阶段 1 次额外重击预算，
# 预算耗尽即拒绝并给处方——既恢复自愈，又封「全量放开菜单重点击」的循环
# 风险（合约线 wet9b3r 回执警示）。
_NAV_RECLICK_BUDGET = 1


def _is_navigation_click_element(element_info: dict, tag_name: str = '') -> bool:
    """True when the click target is navigation-shaped (menu item / link)."""
    tag = str((element_info or {}).get('tag_name') or tag_name or '').strip().lower()
    attrs = (element_info or {}).get('attributes') or {}
    raw_class = str(attrs.get('class') or '').lower()
    if tag in ('a', 'li'):
        return True
    return any(k in raw_class for k in ('menu', 'nav', 'breadcrumb'))


def _bump_nav_reclick(business_data_store: dict | None, identity: str) -> int:
    """Consume one unit of the per-identity nav re-click budget; return the
    1-based attempt number. Stored inside _phase_ai_operations under a
    __navreclick__ namespace so phase cleanup clears it for free and the
    guard dict schema stays untouched."""
    if business_data_store is None:
        return 0
    touched = business_data_store.setdefault('_phase_ai_operations', {})
    if not isinstance(touched, dict):
        return 0
    key = '__navreclick__' + str(identity or '').strip().lower()
    try:
        value = int(touched.get(key) or 0) + 1
    except (TypeError, ValueError):
        value = 1
    touched[key] = value
    return value


def _is_reset_button_label(text: str) -> bool:
    t = re.sub(r'\s+', '', (text or '').strip())
    return bool(t and _RESET_BTN_RE.match(t))


def _phase_text_excerpt(store: dict | None) -> str:
    if not store:
        return ''
    for key in ('_phase_intent', '_phase_boundary'):
        blob = store.get(key)
        if isinstance(blob, dict):
            excerpt = blob.get('task_text_excerpt') or ''
            if excerpt:
                return str(excerpt)
    return ''


def _reset_click_allowed(store: dict | None, button_text: str = '') -> bool:
    """True only when the current phase description explicitly requests reset/clear."""
    excerpt = _phase_text_excerpt(store)
    if not excerpt:
        # No phase contract -> conservative: still allow if button text itself
        # signals reset and we cannot know intent.  In practice phase contract
        # is always present during AI recording; default-deny here prevents
        # accidental clears in the rare no-contract path.
        return False
    return bool(_RESET_PHASE_RE.search(excerpt))


_JS_STC_OVERLAY_SCOPE = '''() => {
    const overlays = [...document.querySelectorAll('.el-drawer, .el-dialog, .el-message-box')]
        .filter((d) => {
            if (d.offsetParent !== null) return true;
            const st = getComputedStyle(d);
            if (st.display === 'none' || st.visibility === 'hidden') return false;
            const r = d.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
    let scope = null;
    let bestZ = -1;
    for (const o of overlays) {
        const z = parseInt(getComputedStyle(o).zIndex || '0', 10) || 0;
        if (z >= bestZ) { bestZ = z; scope = o; }
    }
    if (!scope) return '';
    return scope.classList.contains('el-drawer') ? 'drawer' : 'dialog';
}'''


def _structural_first_leaf_tree_xpath(scope_kind: str) -> str:
    """Structural first-leaf tree xpath (mirrors buildTreeFirstLeafXPathSmart)."""
    if scope_kind == 'drawer':
        return "//div[contains(@class,'el-drawer')]//" + _FIRST_LEAF_TREE_LOCAL
    if scope_kind == 'dialog':
        return (
            "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]"
            "//" + _FIRST_LEAF_TREE_LOCAL
        )
    return "//" + _FIRST_LEAF_TREE_LOCAL


def _structural_first_row_radio_xpath(scope_kind: str) -> str:
    """Structural first-row radio xpath (mirrors _table._structural_first_row_radio_xpath)."""
    if scope_kind == 'drawer':
        return "//div[contains(@class,'el-drawer')]//" + _FIRST_ROW_RADIO_LOCAL
    if scope_kind == 'dialog':
        return (
            "//div[contains(@class,'el-dialog') or contains(@class,'el-message-box')]"
            "//" + _FIRST_ROW_RADIO_LOCAL
        )
    return "//" + _FIRST_ROW_RADIO_LOCAL


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
        if _is_reset_button_label(bt) and not _reset_click_allowed(
            self.business_data_store, bt
        ):
            excerpt = _phase_text_excerpt(self.business_data_store)
            return err_with(
                "reset-not-allowed",
                f"当前阶段未要求重置/清空，禁止点击「{bt}」按钮",
                observed=f"阶段描述：{excerpt or '无'}",
                next_action="按阶段要求继续点击「查询/搜索」或直接 done；"
                "如确需重置，请在阶段描述中明确包含「重置/清空/恢复默认」",
                include_in_memory=True,
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
        from .phase.element_guard import (
            duplicate_phase_operation_any,
            remember_phase_operation_aliases,
        )
        button_xpath = str(
            (element or {}).get('xpath')
            or (element or {}).get('xpath_smart')
            or (element or {}).get('bu_xpath')
            or ''
        ).strip()
        button_identities = [f'button:{button_text.strip()}']
        if button_xpath:
            button_identities = [f'click:{button_xpath}']
        # 幂等动作（搜索/查询/刷新/翻页）放行同元素重复点击：SUT 树/列表
        # 重载后过滤失效须重触发（wet9 #902/#903）；记录仍照常写入。
        if not _is_idempotent_click_label(button_text):
            duplicate = duplicate_phase_operation_any(
                self.business_data_store, button_identities,
            )
            if duplicate:
                return _ok(
                    f'already-operated-this-phase:button={button_text} via {duplicate}; '
                    'do not click the same button again; verify state and continue the phase'
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
            remember_phase_operation_aliases(
                self.business_data_store, button_identities, 'click_button',
            )
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
                    # TODO(stc-query-anchor): anchor 查询 button container on success — §7.1
                    from scripts.controller.actions.search_then_click_guard import mark_query_clicked
                    mark_query_clicked(self.business_data_store)
            # G3: record query/nav completion evidence (query_clicked /
            # nav_next_clicked) when phase boundary is active — symmetry with
            # the click_element_by_index success path (S5, 2026-09-18).
            if self.business_data_store is not None:
                try:
                    from scripts.controller.actions._phase_boundary import (
                        maybe_record_click_completion_evidence,
                    )
                    kinds = maybe_record_click_completion_evidence(
                        self.business_data_store,
                        btn_label=bt,
                    )
                    if kinds:
                        sys.stderr.write(f'[click-button] G3 evidence recorded: {kinds}\n')
                        sys.stderr.flush()
                except Exception:
                    sys.stderr.write("[click-button] G3 completion evidence recording failed" + '\n')
                    sys.stderr.flush()
                    pass
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
        if str(result).startswith('err-more-toggle-ambiguous:'):
            # 「更多/展开」icon-only 兜底发现多个候选，不盲点——交给 agent 判定。
            return err_with(
                "more-toggle-ambiguous",
                "搜索区内发现多个「更多/展开」类图标按钮，无法唯一选择",
                observed=result.split(':', 1)[1],
                next_action="按索引点击目标区域的「更多/展开」图标按钮（click_element_by_index），或先收窄到正确的搜索区",
            )
        if str(result).startswith('err-more-toggle-already-expanded'):
            # 「更多」开关已是展开态 → 再点会收起并隐藏字段，因此不点，提示换策略。
            return err_with(
                "more-toggle-already-expanded",
                "搜索区的「更多/展开」已是展开态（图标向上），再点会收起",
                next_action="不要再点该开关；重新扫描当前可见筛选字段（可用 scan_visible_fields），必要时滚动页面查找目标字段",
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

            # Reset-button guard for index clicks: stop agents from wiping query
            # filters via an indexed reset/clear button unless the phase asks for it.
            idx_label = ((element_info or {}).get('text') or elem_text or '').strip()
            if idx_label and _is_reset_button_label(idx_label):
                is_btn = False
                if element_info:
                    e_tag = str(element_info.get('tag_name') or tag_name or '').lower()
                    e_cls = str(
                        (element_info.get('attributes') or {}).get('class') or ''
                    ).lower()
                    e_kind = str(element_info.get('target_kind') or '').lower()
                    is_btn = (
                        e_tag in ('button', 'a')
                        or 'button' in e_kind
                        or 'el-button' in e_cls
                    )
                if is_btn and not _reset_click_allowed(
                    self.business_data_store, idx_label
                ):
                    excerpt = _phase_text_excerpt(self.business_data_store)
                    return err_with(
                        "reset-not-allowed",
                        f"当前阶段未要求重置/清空，禁止通过索引点击「{idx_label}」按钮",
                        observed=f"阶段描述：{excerpt or '无'}",
                        next_action="按阶段要求继续点击「查询/搜索」或直接 done；"
                        "如确需重置，请在阶段描述中明确包含「重置/清空/恢复默认」",
                        include_in_memory=True,
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
            click_identity = 'click:' + (gate_xp or f'{tag_name}:{elem_text}')
            date_panel_click = False
            # el-select 触发框（下拉未展开）的点击只是开框瞬态动作：业务步是随后的
            # select_option。它的 text 会被隐藏下拉的全部选项文案污染（见下方
            # dd_gate），录制下来就是「点击元素 - 待发起审批中已撤销退回通过投决」
            # 这类垃圾步。点击照做，但不录制、不记忆、不当弹窗触发按钮。
            select_trigger_click = False
            # nav-reclick 预算内放行的「台账级」标记：放行分支置 True，落库时
            # 给 recorded result 加 nav-reclick-budget 尾缀自证（stderr 痕迹
            # 不落库，回放侧只读不解析该文案）。
            nav_reclick_pass = False
            if gate_xp:
                try:
                    date_panel_click = bool(await page.evaluate('''(xpath) => {
                        try {
                            const node = document.evaluate(
                                xpath, document, null,
                                XPathResult.FIRST_ORDERED_NODE_TYPE, null
                            ).singleNodeValue;
                            return !!(node && node.closest && node.closest(
                                '.el-date-table, .el-month-table, .el-year-table, .el-time-panel'
                            ));
                        } catch (e) { return false; }
                    }''', gate_xp))
                except Exception:
                    date_panel_click = False
            if not date_panel_click and not _is_idempotent_click_label(
                str((element_info or {}).get('text') or elem_text or '')
            ):
                # 幂等动作（搜索/查询/刷新/翻页）同元素重复点击放行
                # （wet9 #902/#903：树重载后过滤失效须再点搜索图标）；非幂等
                # 维持 already-operated-this-phase 拒绝。
                from .phase.element_guard import duplicate_phase_operation
                duplicate = duplicate_phase_operation(self.business_data_store, click_identity)
                button_text_identity = ''
                if element_info:
                    candidate_text = str(
                        element_info.get('text') or elem_text or ''
                    ).strip()
                    target_kind = str(element_info.get('target_kind') or '').lower()
                    raw_tag = str(element_info.get('tag_name') or tag_name).lower()
                    raw_class = str(
                        (element_info.get('attributes') or {}).get('class') or ''
                    ).lower()
                    if candidate_text and not gate_xp and (
                        raw_tag in ('button', 'a')
                        or 'button' in target_kind
                        or 'el-button' in raw_class
                    ):
                        button_text_identity = f'button:{candidate_text}'
                        if not duplicate:
                            from .phase.element_guard import duplicate_phase_operation
                            duplicate = duplicate_phase_operation(
                                self.business_data_store, button_text_identity,
                            )
                if duplicate:
                    # wet9-B3r ③：导航类元素（菜单/链接）的重复点击是「页面
                    # 卡死复位」自愈路径——限流放行：每元素每阶段 1 次额外重击
                    # 预算，预算内放行并留痕；耗尽即拒并给处方（封循环风险）。
                    if _is_navigation_click_element(element_info, tag_name):
                        used = _bump_nav_reclick(self.business_data_store, click_identity)
                        if used <= _NAV_RECLICK_BUDGET:
                            nav_reclick_pass = True
                            sys.stderr.write(
                                f'[nav-reclick] budget used {used}/{_NAV_RECLICK_BUDGET} '
                                f'index={index} identity={click_identity}\n'
                            )
                            sys.stderr.flush()
                        else:
                            return _ok(
                                f'already-operated-this-phase:index={index} via {duplicate}; '
                                f'nav re-click budget exhausted ({_NAV_RECLICK_BUDGET} extra allowed) — '
                                '页面可能已卡死：勿再重试本导航元素，改用 report 上报或结束会话重开'
                            )
                    else:
                        return _ok(
                            f'already-operated-this-phase:index={index} via {duplicate}; '
                            'do not click the same element again; verify state and call done when complete'
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
                        if (dd) {
                            const inItem = !!(node.closest('.el-select-dropdown__item'));
                            const inRow = !!(node.closest('tr.el-table__row, .el-table__row'));
                            return {
                                hit: true,
                                kind: inRow ? 'table-row' : (inItem ? 'option' : 'dropdown'),
                            };
                        }
                        const sel = node.closest && node.closest('.el-select');
                        // Exclude popper contents (tree-select / cascader / popover
                        // dropdowns nested inside .el-select) — only the closed
                        // trigger itself is the transient open-click surface.
                        if (sel && !node.closest(
                            '.el-select-dropdown, .el-tree, .el-tree-node, .tree-popover, '
                            + '.el-tree-select__popper, .el-cascader__dropdown, .el-popover'
                        )) {
                            return { hit: true, kind: 'trigger' };
                        }
                        return { hit: false };
                    }''',
                    gate_xp,
                )
                if isinstance(dd_gate, dict) and dd_gate.get('hit'):
                    kind = str(dd_gate.get('kind') or 'dropdown')
                    if kind == 'trigger':
                        select_trigger_click = True
                    else:
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
            # Fallback signal: locator enrichment already classifies any node whose
            # canonical host is `.el-select` (normalizeHost) as form_select. Use it
            # when the xpath gate above could not run (empty/failed gate_xp).
            if str((element_info or {}).get('target_kind') or '').lower() == 'form_select':
                select_trigger_click = True

            stc_force_first = False
            stc_scope_kind = ''
            if gate_xp:
                try:
                    from .search_then_click_guard import (
                        guard_locate_or_err,
                        xpath_is_tree_node,
                        detect_search_ui,
                        stc_satisfied,
                    )
                    is_tree_for_stc = await xpath_is_tree_node(page, gate_xp)
                    # Tree nodes are blocked here. Table radios are blocked after
                    # table_radio_info is known, still before the DOM click.
                    if is_tree_for_stc:
                        stc_err = await guard_locate_or_err(page, self.business_data_store)
                        if stc_err:
                            return _err(stc_err, include_in_memory=True)
                    snap = await detect_search_ui(page)
                    stc_force_first = stc_satisfied(self.business_data_store, snap)
                    if stc_force_first:
                        stc_scope_kind = str(
                            await page.evaluate(_JS_STC_OVERLAY_SCOPE) or ''
                        )
                except Exception:
                    sys.stderr.write("[click] search-then-click tree gate failed index={index!r}" + '\n')
                    sys.stderr.flush()

            # Preserve table-row selection semantics before the click mutates the
            # Element UI radio model. Generic DOM clicks otherwise lose the
            # durable row identity and are recorded as click_element_by_index.
            table_radio_info = {}
            if gate_xp:
                try:
                    table_radio_info = await page.evaluate('''(xpath) => {
                        let node = null;
                        try {
                            node = document.evaluate(
                                xpath, document, null,
                                XPathResult.FIRST_ORDERED_NODE_TYPE, null
                            ).singleNodeValue;
                        } catch (e) {}
                        if (!node || !node.closest) return {};
                        const row = node.closest('tr.el-table__row, .el-table__row, tr');
                        if (!row || !row.closest('.el-table')) return {};
                        const radio = row.querySelector(
                            '.el-radio, .el-radio-button, .el-checkbox, input[type="radio"], input[type="checkbox"]'
                        );
                        if (!radio) return {};
                        const cells = [...row.querySelectorAll('td, .el-table__cell')]
                            .map((cell) => (cell.innerText || cell.textContent || '')
                                .replace(/\\s+/g, ' ').trim())
                            .filter((text) => text && text !== 'radio' && text !== 'checkbox');
                        return {
                            isRadio: !!node.closest(
                                '.el-radio, .el-radio-button, .el-checkbox, input[type="radio"], input[type="checkbox"]'
                            ),
                            rowText: cells.find((text) => text.length >= 2) ||
                                (row.innerText || row.textContent || '').replace(/\\s+/g, ' ').trim(),
                        };
                    }''', gate_xp) or {}
                except Exception:
                    table_radio_info = {}

            # Table-radio index clicks share the dedicated action's STC hard guard.
            # Without this, click_element_by_index records a business-key row before 查询.
            if (
                table_radio_info.get('isRadio')
                or str((element_info or {}).get('target_kind') or '') == 'table_row_radio'
            ):
                from .search_then_click_guard import guard_locate_or_err
                stc_err = await guard_locate_or_err(page, self.business_data_store)
                if stc_err:
                    return _err(stc_err, include_in_memory=True)

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
                    from scripts.controller.actions._phase_intent import (
                        get_phase_intent,
                        should_block_index_submit,
                    )
                    contract = get_phase_intent(self.business_data_store)
                except Exception:
                    sys.stderr.write("[click] get_phase_intent failed (submit-block fallback)" + '\n')
                    sys.stderr.flush()
                    contract = None
                    should_block_index_submit = None  # type: ignore

                block = False
                if should_block_index_submit is not None:
                    block = should_block_index_submit(
                        contract,
                        btn_label,
                        in_form_overlay=in_form_overlay,
                        dialog_title=dialog_title,
                        is_picker_ui=is_picker_ui,
                        container_id='',
                        query_ui=is_picker_ui or bool((self.business_data_store or {}).get('_query_ui')),
                        business_data_store=self.business_data_store,
                    )
                elif compact.startswith(('保存', '提交')) or (in_form_overlay and not is_picker_ui):
                    block = True

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
            overlay_title_before = ''
            try:
                overlay_title_before = str(await page.evaluate('''() => {
                    const pick = (d, sel) => {
                        const wrap = d.closest('.el-dialog__wrapper, .el-drawer__wrapper') || d;
                        const st = getComputedStyle(wrap);
                        if (st.display === 'none' || st.visibility === 'hidden') return '';
                        const r = wrap.getBoundingClientRect();
                        if (r.width <= 0 || r.height <= 0) return '';
                        return ((d.querySelector(sel) || {}).textContent || '').trim();
                    };
                    for (const d of document.querySelectorAll('.el-dialog')) {
                        const t = pick(d, '.el-dialog__title');
                        if (t) return t.slice(0, 80);
                    }
                    for (const d of document.querySelectorAll('.el-drawer')) {
                        const t = pick(d, '.el-drawer__title, .el-drawer__header')
                            || (d.getAttribute('aria-label') || '').trim();
                        if (t) return t.slice(0, 80);
                    }
                    return '';
                }''') or '')
            except Exception:
                overlay_title_before = ''
            download_path = await self.browser_context._click_element_node(element_node)
            if download_path:
                return _ok(f'downloaded:{download_path}')
            if not date_panel_click and not select_trigger_click:
                from .phase.element_guard import remember_phase_operation_aliases
                identities = [click_identity]
                if button_text_identity:
                    identities.append(button_text_identity)
                remember_phase_operation_aliases(
                    self.business_data_store, identities, 'click_element_by_index',
                )
            # Navigation detection for page-transitioning clicks (e.g. 客户转正 → new page).
            # If URL changed after the click, record a flag that recorder_emitters turns
            # into a [导航] HumanMessage cue — recorded step stays ok-clicked-N.
            url_changed = False
            try:
                await _wait_if_loading(page)
                url_after = getattr(page, 'url', '') or ''
                if url_before and url_after and url_before != url_after:
                    url_changed = True
                    if self.business_data_store is not None:
                        self.business_data_store['_last_click_navigated'] = {
                            'from': url_before,
                            'to': url_after,
                        }
            except Exception:
                sys.stderr.write("[click] post-click navigation detection failed" + '\n')
                sys.stderr.flush()
                pass
            # G3: record query/nav completion evidence (query_clicked / url_change /
            # page_opened / nav_next_clicked) when phase boundary is active.
            try:
                overlay_title_after = ''
                try:
                    overlay_title_after = str(await page.evaluate('''() => {
                        const pick = (d, sel) => {
                            const wrap = d.closest('.el-dialog__wrapper, .el-drawer__wrapper') || d;
                            const st = getComputedStyle(wrap);
                            if (st.display === 'none' || st.visibility === 'hidden') return '';
                            const r = wrap.getBoundingClientRect();
                            if (r.width <= 0 || r.height <= 0) return '';
                            return ((d.querySelector(sel) || {}).textContent || '').trim();
                        };
                        for (const d of document.querySelectorAll('.el-dialog')) {
                            const t = pick(d, '.el-dialog__title');
                            if (t) return t.slice(0, 80);
                        }
                        for (const d of document.querySelectorAll('.el-drawer')) {
                            const t = pick(d, '.el-drawer__title, .el-drawer__header')
                                || (d.getAttribute('aria-label') || '').trim();
                            if (t) return t.slice(0, 80);
                        }
                        return '';
                    }''') or '')
                except Exception:
                    overlay_title_after = ''
                from scripts.controller.actions._phase_boundary import (
                    maybe_record_click_completion_evidence,
                )
                kinds = maybe_record_click_completion_evidence(
                    self.business_data_store,
                    btn_label=btn_label or '',
                    url_changed=url_changed,
                    overlay_title_before=overlay_title_before,
                    overlay_title_after=overlay_title_after,
                )
                if kinds:
                    sys.stderr.write(f'[click] G3 evidence recorded: {kinds}\n')
                    sys.stderr.flush()
            except Exception:
                sys.stderr.write("[click] G3 completion evidence recording failed" + '\n')
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
                tree_opt = _strip_volatile_tree_text((elem_text or '').strip())
                table_row_text = str(
                    (element_info or {}).get('row_text')
                    or (element_info or {}).get('rowText')
                    or elem_text
                    or ''
                ).strip()
                is_table_row_radio = (
                    (element_info or {}).get('target_kind') == 'table_row_radio'
                    or bool(table_radio_info.get('isRadio'))
                    or 'table_row_radio' in raw_xp
                    or 'el-radio' in raw_cls
                    or 'el-checkbox' in raw_cls
                ) and bool(table_row_text)
                if isinstance(table_radio_info, dict) and table_radio_info.get('rowText'):
                    table_row_text = str(table_radio_info['rowText']).strip()[:160]
                    is_table_row_radio = bool(table_radio_info.get('isRadio'))
                if (
                    is_tree_node_click
                    and (element_info or {}).get('target_kind') == 'form_tree_select'
                    and form_label
                    and (tree_opt or stc_force_first)
                ):
                    record_opt = 'first' if stc_force_first else tree_opt
                    element_info = dict(element_info or {})
                    element_info['text'] = record_opt[:80]
                    element_info['target_kind'] = 'form_tree_select'
                    element_info['formLabel'] = form_label
                    if stc_force_first:
                        element_info['xpath_smart'] = _structural_first_leaf_tree_xpath(
                            stc_scope_kind,
                        )
                    _state._record_action(
                        'select_tree_option',
                        {'label_text': form_label, 'option_text': record_opt},
                        f'ok-clicked-{index}',
                        element=element_info,
                    )
                elif is_table_row_radio:
                    record_row = table_row_text[:160]
                    if stc_force_first:
                        record_row = 'first'
                    if element_info is not None:
                        element_info = dict(element_info)
                        element_info['row_text'] = record_row
                        element_info['target_kind'] = 'table_row_radio'
                        if stc_force_first:
                            element_info['xpath_smart'] = _structural_first_row_radio_xpath(
                                stc_scope_kind,
                            )
                    else:
                        element_info = {
                            'row_text': record_row,
                            'target_kind': 'table_row_radio',
                        }
                        if stc_force_first:
                            element_info['xpath_smart'] = _structural_first_row_radio_xpath(
                                stc_scope_kind,
                            )
                    _state._record_action(
                        'click_table_row_radio',
                        {'row_text': record_row},
                        f'ok-clicked-{index}',
                        element=element_info,
                    )
                elif not select_trigger_click:
                    record_text = (element_info or {}).get('text') or elem_text or ''
                    if is_tree_node_click:
                        if stc_force_first:
                            record_text = 'first'
                            element_info = dict(element_info or {})
                            element_info['text'] = 'first'
                            element_info['xpath_smart'] = _structural_first_leaf_tree_xpath(
                                stc_scope_kind,
                            )
                            element_info['target_kind'] = 'tree_node'
                        else:
                            record_text = _strip_volatile_tree_text(record_text)
                            if element_info is not None:
                                element_info = dict(element_info)
                                element_info['text'] = record_text[:80]
                    _state._record_action('click_element_by_index', {
                        'index': index,
                        'tag_name': element_info.get('tag_name') if element_info else tag_name,
                        'text': record_text,
                    }, f'ok-clicked-{index}' + (
                        ' | nav-reclick-budget' if nav_reclick_pass else ''
                    ), element=element_info)
                if self.business_data_store is not None:
                    from scripts.controller.actions.container_naming import remember_trigger_button
                    if not select_trigger_click:
                        remember_trigger_button(
                            self.business_data_store,
                            (element_info or {}).get('text') or (
                                _strip_volatile_tree_text(elem_text) if is_tree_node_click else elem_text
                            ) or '',
                        )
                    # 索引点击「查询」必须像 click_button 一样标记 STC query_clicked，
                    # 否则守卫整阶段拦 row/tree 定位（录放不对称，回放侧
                    # mark_stc_flags_on_replay_ok 早已对 index 点击标记）→ 阶段失败 →
                    # 前阶段动作被下一阶段补做并记到下一阶段。
                    if re.sub(r'\s+', '', btn_label) == '查询':
                        # TODO(stc-query-anchor): anchor 查询 button container on success — §7.1
                        from scripts.controller.actions.search_then_click_guard import mark_query_clicked
                        mark_query_clicked(self.business_data_store)
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
            if select_trigger_click:
                return _ok(
                    f'ok-clicked-{index} | transient-select-open — the dropdown-open click '
                    f'is NOT recorded; call select_option(label_text=..., option_text=...) '
                    f'to record the business step'
                )
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
