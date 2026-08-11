"""
Sequential action replay — mirrors auto-fill orchestration in `_form.py`.

Key lessons from `_auto_fill_pending` / `_execute_round`:
  1. Execute one recorded action at a time (no scan/auto-fill side effects).
  2. Form ops use the same JS snippets as auto-fill (fill / select / date / tree / radio).
  3. Between steps: `_wait_if_loading` + short timeout (300ms input / 500ms select),
     never Playwright `networkidle` as the sole gate (SPA keep-alives hang forever).
  4. After 保存/提交: wait for **page idle** (loading masks / button spinners / in-flight
     xhr|fetch quiet) — not tree-specific. SPA often clears panels while APIs reload.
  5. After el-tree node click: wait until the right-side edit form input is visible
     before the next fill step.

For click_element_by_index: highlight `index` is ephemeral — relocate by
xpath_smart / drawer-dialog text / xpath (same idea as script_assembler).
"""

from __future__ import annotations

import asyncio
import inspect
import json
import re
import sys
import time

from ._helpers import (
    _wait_if_loading,
    _is_ok_result,
    reset_select_ui,
)
from ._js_snippets import (
    JS_CHECK_LOADING,
    JS_FILL_FORM_FIELD,
    JS_FILL_BY_XPATH,
    JS_FILL_DATE_FIELD,
    JS_FIND_LABELED_SELECT,
    JS_SELECT_OPTION,
    JS_SELECT_TRIGGER_BY_XPATH,
    JS_SELECT_VALUE_BY_XPATH,
    JS_SELECT_TREE_OPTION,
    JS_CLICK_RADIO,
    JS_VERIFY_FORM_STRUCTURE,
)
from scripts.feature_flags import relative_xpath_primary_enabled

from .replay_js import (  # noqa: F401  (re-exported for compat)
    _JS_CLICK_DURABLE,
    _JS_EDIT_FORM_INPUT_VISIBLE,
    _JS_LOCATE_BY_XPATH,
    _JS_PAGE_BUSY,
    _JS_READ_VALUE_BY_XPATH,
)
from .replay_names import (  # noqa: F401  (re-exported for compat)
    _ACTION_NAME_ALIASES,
    _FORM_ACTIONS,
    normalize_action_name,
)
from .replay_wait import (  # noqa: F401  (re-exported for compat)
    _SAVE_BUTTON_TEXTS,
    _is_save_click_text,
    _is_trackable_request,
    _is_tree_node_entry,
    _wait_after_save_page_idle,
    _wait_after_tree_node_for_form,
)
_CLICK_BY_INDEX = 'click_element_by_index'



def _normalize_params(action_name: str, params: dict | None) -> dict:
    """Accept recorded aliases (value/option/label) into controller param names."""
    p = dict(params or {})
    label = p.get('label_text') or p.get('label') or ''
    if label and 'label_text' not in p:
        p['label_text'] = label

    if action_name in ('fill_form_field', 'fill_date_field'):
        if not p.get('value'):
            p['value'] = p.get('option_text') or p.get('option') or p.get('text') or ''
    elif action_name in ('select_option', 'select_tree_option', 'click_radio'):
        if not p.get('option_text'):
            p['option_text'] = p.get('value') or p.get('option') or p.get('text') or ''
    return p


def _filter_callable_kwargs(fn, params: dict) -> dict:
    """Keep only kwargs accepted by the action function signature."""
    try:
        sig = inspect.signature(fn)
        names = {
            name
            for name, p in sig.parameters.items()
            if name != 'self' and p.kind in (
                inspect.Parameter.POSITIONAL_OR_KEYWORD,
                inspect.Parameter.KEYWORD_ONLY,
            )
        }
        if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
            return dict(params)
        return {k: v for k, v in params.items() if k in names}
    except (TypeError, ValueError):
        return dict(params)


def _result_ok(action_name: str, result: str) -> bool:
    """Unified success check: recordable/successful CTRL results use ``ok`` prefix.

    ``already-filled`` (skip) intentionally does NOT start with ``ok``.
    Checkpoint verify (`save_form_snapshot`) returns JSON; transport always ok when
    evaluate succeeded (prefix `form-structure:`).
    """
    if not isinstance(result, str) or not result:
        return False
    if action_name == 'save_form_snapshot' and result.startswith('form-structure:'):
        return True
    if result.startswith('error:') or result.startswith('unknown-') or result.startswith('err'):
        return False
    if result.startswith('click-failed') or result == 'not-found':
        return False
    if _is_ok_result(result):
        return True
    # Compound messages from ActionResult wrappers: "ok-login | …"
    if ' | ' in result and not result.lower().startswith('fail'):
        head = result.split(' | ', 1)[0].strip()
        if _is_ok_result(head):
            return True
    return False


async def _replay_verify_form_structure(page, params: dict) -> str:
    """Run verifyFormStructure; always return form-structure:<json> on success.

    Passes recorded ``container`` (main / drawer:… / dialog:…) so scan does not
    prefer an unrelated visible overlay via getContainer().
    """
    await _wait_if_loading(page)
    fields = params.get('fields') if isinstance(params, dict) else None
    if not isinstance(fields, list):
        fields = []
    container = 'main'
    if isinstance(params, dict) and params.get('container') not in (None, ''):
        container = str(params.get('container')).strip() or 'main'
    # Single Playwright arg: { fields, container } — do NOT wrap fields as [fields].
    raw = await page.evaluate(
        JS_VERIFY_FORM_STRUCTURE,
        {'fields': fields, 'container': container},
    )
    if isinstance(raw, dict):
        return 'form-structure:' + json.dumps(raw, ensure_ascii=False)
    if isinstance(raw, str) and raw.startswith('{'):
        return 'form-structure:' + raw
    return 'form-structure:' + str(raw or '{}')


async def _replay_click_by_index(page, entry: dict, params: dict) -> str:
    """
    Replay click_element_by_index without relying on ephemeral highlight index.

    Prefer xpath_smart / drawer-scoped text (same idea as script_assembler).
    """
    await _wait_if_loading(page)
    el = entry.get('element') if isinstance(entry.get('element'), dict) else {}
    text = str(
        params.get('text')
        or params.get('menu_text')
        or el.get('text')
        or ''
    ).strip()
    cands = el.get('candidates') if isinstance(el.get('candidates'), list) else []

    def _cand(ctype: str) -> str:
        for c in cands:
            if isinstance(c, dict) and c.get('type') == ctype and c.get('value'):
                return str(c['value'])
        return ''

    xpath_smart = str(
        el.get('xpath_smart')
        or _cand('xpath_smart')
        or ''
    ).strip()
    # If primary target is already a smart-style xpath, treat it as smart
    target = str(entry.get('target') or el.get('xpath') or '').strip()
    if not xpath_smart and target.startswith('//'):
        xpath_smart = target
    xpath_full = str(
        el.get('xpath_full')
        or el.get('xpath_abs')
        or _cand('xpath_full')
        or params.get('xpath')
        or (entry.get('attributes') or {}).get('xpath')
        or ''
    ).strip()
    # Absolute xpath only as fallback (avoid using smart twice)
    xpath = xpath_full
    if not xpath and target and not target.startswith('//'):
        xpath = target
    tag_hint = str(params.get('tag_name') or entry.get('tagName') or el.get('tag') or '').strip()
    parent_text = str(
        params.get('parent_text')
        or el.get('parent_text')
        or ''
    ).strip()
    icon_class = str(
        params.get('icon_class')
        or el.get('icon_class')
        or el.get('className')
        or el.get('class')
        or ''
    ).strip()
    target_kind = str(
        params.get('target_kind')
        or el.get('target_kind')
        or el.get('kind')
        or ''
    ).strip()
    if not target_kind:
        blob = (xpath_smart + ' ' + icon_class).lower()
        action_name = str(entry.get('action') or '').lower()
        if 'el-tree-node' in blob:
            target_kind = 'tree_node'
        elif 'el-icon-' in blob or 'click_icon' in action_name:
            target_kind = 'icon'
    opts = {
        'parentText': parent_text,
        'iconClass': icon_class,
        'targetKind': target_kind,
    }
    result = await page.evaluate(_JS_CLICK_DURABLE, [text, xpath, tag_hint, xpath_smart, opts])
    if isinstance(result, str) and result.startswith('ok'):
        await _post_click_settle(page, entry, text, xpath_smart, xpath, result)
        return result

    # Playwright text click — prefer last visible button (overlay remounts)
    if text:
        try:
            loc = page.get_by_role('button', name=text, exact=True).last
            await loc.click(timeout=3000)
            await _post_click_settle(page, entry, text, xpath_smart, xpath, 'ok-playwright-role-last')
            return 'ok-playwright-role-last'
        except Exception:
            pass
        try:
            await page.get_by_text(text, exact=True).last.click(timeout=3000)
            await _post_click_settle(page, entry, text, xpath_smart, xpath, 'ok-playwright-text-last')
            return 'ok-playwright-text-last'
        except Exception:
            try:
                await page.locator(f'text={text}').last.click(timeout=3000)
                await _post_click_settle(page, entry, text, xpath_smart, xpath, 'ok-playwright-text-loose')
                return 'ok-playwright-text-loose'
            except Exception:
                pass

    index = params.get('index')
    return (
        f'click-failed:index={index} (ephemeral; text/xpath not found: {text!r})'
        if index is not None
        else f'click-failed:not-found text={text!r} xpath={xpath_smart or xpath!r}'
    )


async def _post_click_settle(
    page,
    entry: dict | None,
    text: str,
    xpath_smart: str,
    xpath: str,
    click_result: str,
) -> None:
    """Post-click waits: save→tree reload settle; tree node→edit form visible; else short pause."""
    if _is_save_click_text(text):
        await _wait_after_save_page_idle(page)
        return
    if _is_tree_node_entry(entry, xpath_smart, xpath):
        await page.wait_for_timeout(300)
        await _wait_if_loading(page)
        appeared = await _wait_after_tree_node_for_form(page)
        if not appeared:
            sys.stderr.write('[replay] tree-node click: edit form input not visible within timeout\n')
            sys.stderr.flush()
        return
    wait_ms = 600 if ('expand' in click_result or 'submenu' in click_result) else 400
    await page.wait_for_timeout(wait_ms)
    await _wait_if_loading(page)


async def _replay_goto(page, params: dict) -> str:
    """Navigate via Playwright — same role as assemble_script page.goto header."""
    url = str(params.get('url') or '').strip()
    if not url:
        return 'error:missing-url'
    await _wait_if_loading(page)
    try:
        await page.goto(url, wait_until='networkidle', timeout=60000)
    except Exception:
        try:
            await page.goto(url, wait_until='load', timeout=30000)
        except Exception as e:
            return f'error:goto:{e}'
    await page.wait_for_timeout(400)
    await _wait_if_loading(page)
    return 'ok'


def _element_xpath_smart(entry: dict | None) -> str:
    """Prefer relative xpath_smart from recorded element / candidates / target."""
    el = entry.get('element') if isinstance(entry, dict) and isinstance(entry.get('element'), dict) else {}
    cands = el.get('candidates') if isinstance(el.get('candidates'), list) else []

    def _cand(ctype: str) -> str:
        for c in cands:
            if isinstance(c, dict) and c.get('type') == ctype and c.get('value'):
                return str(c['value']).strip()
        return ''

    smart = str(el.get('xpath_smart') or _cand('xpath_smart') or '').strip()
    if smart.startswith('//') or smart.startswith('('):
        return smart
    target = str((entry or {}).get('target') or el.get('xpath') or '').strip()
    if target.startswith('//') or target.startswith('('):
        return target
    return ''


def _annotate_label_result(result: str) -> str:
    """Make label-based success self-describing in replay logs."""
    if not isinstance(result, str) or not result:
        return result
    if result == 'ok':
        return 'ok-label'
    if result.startswith('ok-') and 'label' not in result and 'xpath' not in result:
        # ok-date / ok-placeholder / ok-already:… → keep suffix, mark label path
        return f'ok-label:{result[3:]}' if result.startswith('ok-') else result
    return result


def _element_xpath_full(entry: dict | None) -> str:
    """Absolute xpath fallback from recorded element / candidates."""
    el = entry.get('element') if isinstance(entry, dict) and isinstance(entry.get('element'), dict) else {}
    cands = el.get('candidates') if isinstance(el.get('candidates'), list) else []

    def _cand(ctype: str) -> str:
        for c in cands:
            if isinstance(c, dict) and c.get('type') == ctype and c.get('value'):
                return str(c['value']).strip()
        return ''

    full = str(el.get('xpath_full') or el.get('xpath_abs') or _cand('xpath_full') or '').strip()
    if full.startswith('/') or full.startswith('('):
        return full
    return ''


def _resolve_replay_xpath(entry, params) -> tuple[str, str]:
    """Pick replay xpath: element.xpath_smart → xpath_full.

    ``params.xpath_smart`` is intentionally ignored (abandoned for locate).
    Dirty/wrong params historically beat correct ``element_json`` under
    params-first (traj 130 step 23: label 名称, params pointed at 编号).
    """
    if not relative_xpath_primary_enabled():
        full = _element_xpath_full(entry)
        return (full, 'full') if full else ('', '')
    ex = _element_xpath_smart(entry)
    if ex:
        return ex, 'element'
    full = _element_xpath_full(entry)
    if full:
        return full, 'full'
    return '', ''


def _norm_replay_value(s) -> str:
    """Strip all whitespace for read-back compare."""
    return re.sub(r'\s+', '', str(s or '').strip())


def _classify_fill_result(action_ok: bool, expected: str, actual: str) -> str:
    if not action_ok:
        return 'xpath_miss:action-failed'
    exp = _norm_replay_value(expected)
    act = _norm_replay_value(actual)
    if exp == act:
        return 'ok'
    return f'false_ok:expected={exp},actual={act}'



async def _read_value_by_xpath(page, xpath: str) -> str:
    if not xpath:
        return ''
    result = await page.evaluate(_JS_READ_VALUE_BY_XPATH, [xpath])
    return str(result or '').strip()


# Click / focus a control resolved by xpath (returns ok-xpath-smart when found).
_JS_LOCATE_BY_XPATH = r'''([xpath]) => {
  if (!xpath) return 'xpath-empty';
  const isVis = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.offsetParent === null && !el.closest('.el-table__fixed')) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };
  const wrapVisible = (d) => {
    if (!d) return false;
    const wrap = d.closest && d.closest('.el-dialog__wrapper, .el-message-box__wrapper, .el-drawer__wrapper');
    if (wrap && getComputedStyle(wrap).display === 'none') return false;
    return isVis(d) || (wrap && isVis(wrap));
  };
  const lastVisibleHost = (drawer) => {
    const sel = drawer ? '.el-drawer' : '.el-dialog, .el-message-box';
    const all = [...document.querySelectorAll(sel)];
    for (let i = all.length - 1; i >= 0; i--) {
      if (wrapVisible(all[i])) return all[i];
    }
    return null;
  };
  const tryXp = (xp, root) => {
    let s = String(xp || '');
    if (!s) return false;
    try {
      const ctx = root || document;
      if (root && s.startsWith('//')) s = '.' + s;
      const snap = document.evaluate(s, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = snap.snapshotLength - 1; i >= 0; i--) {
        const n = snap.snapshotItem(i);
        if (n && isVis(n)) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  };
  if (tryXp(xpath, null)) return 'ok-xpath-smart';
  if (/el-dialog|el-message-box|el-drawer/.test(xpath) && /\[last\(\)\]/.test(xpath)) {
    const m = String(xpath).match(/\[last\(\)\](?:\/\/(.+))?$/);
    const local = m && m[1] ? m[1] : '';
    const dlg = /el-drawer/.test(xpath) ? lastVisibleHost(true) : lastVisibleHost(false);
    if (dlg && local && tryXp('.//' + local, dlg)) return 'ok-xpath-smart-vis-dlg';
  }
  return 'xpath-not-found';
}'''


async def _try_xpath_locate(page, xpath: str) -> bool:
    if not xpath:
        return False
    result = await page.evaluate(_JS_LOCATE_BY_XPATH, [xpath])
    return isinstance(result, str) and result.startswith('ok')



async def _replay_form_action(page, action_name: str, params: dict, entry: dict | None = None) -> str:
    """One form field op using the same JS path as `_execute_round`.

    Locator order when RELATIVE_XPATH_PRIMARY:
      1) element.xpath_smart (params.xpath_smart ignored for locate)
      2) label/semantic
      3) xpath_full
      (+ placeholder when no form-item label)
    """
    label = str(params.get('label_text') or '')
    value = str(params.get('value') or params.get('option_text') or '')
    el = entry.get('element') if isinstance(entry, dict) and isinstance(entry.get('element'), dict) else {}
    placeholder = str(
        params.get('placeholder')
        or el.get('placeholder')
        or (el.get('attributes') or {}).get('placeholder')
        or ''
    ).strip()
    # Search boxes often have only placeholder (e.g. 搜索关键字) and no el-form-item label
    if not placeholder and label and ('搜索' in label or '关键字' in label or '请输入' in label):
        placeholder = label
    use_relative = relative_xpath_primary_enabled()
    xpath_smart = _element_xpath_smart(entry) if use_relative else ''
    xpath_full = _element_xpath_full(entry) if use_relative else ''

    await _wait_if_loading(page)

    if action_name == 'fill_form_field':
        ph = placeholder
        element_xp = _element_xpath_smart(entry) if use_relative else ''

        async def _try_xpath_fill(xpath: str, locate_src: str) -> str | None:
            # Prefer label_text so shared placeholder xpaths disambiguate form-items
            # (traj 130: //input[@placeholder='请输入'][1] + last-visible → 名称).
            hint = label or ph
            result = await page.evaluate(JS_FILL_BY_XPATH, [xpath, value, hint])
            action_ok = isinstance(result, str) and result.startswith('ok')
            actual = await _read_value_by_xpath(page, xpath) if xpath else ''
            classified = _classify_fill_result(action_ok, value, actual)
            if classified == 'ok':
                await page.wait_for_timeout(300)
                return f'ok:locate={locate_src}'
            if classified.startswith('false_ok'):
                await page.wait_for_timeout(300)
                return classified
            return None

        xp, src = _resolve_replay_xpath(entry, params)
        if xp:
            xpath_result = await _try_xpath_fill(xp, src)
            if xpath_result:
                return xpath_result

        result = await page.evaluate(JS_FILL_FORM_FIELD, [label, value])
        if isinstance(result, str) and result.startswith('ok'):
            await page.wait_for_timeout(300)
            if element_xp:
                actual = await _read_value_by_xpath(page, element_xp)
                classified = _classify_fill_result(True, value, actual)
                if classified.startswith('false_ok'):
                    return classified
                if classified == 'ok':
                    return 'ok:locate=label'
            return _annotate_label_result(str(result))
        if placeholder and placeholder != label:
            result = await page.evaluate(JS_FILL_FORM_FIELD, [placeholder, value])
            if isinstance(result, str) and result.startswith('ok'):
                await page.wait_for_timeout(300)
                if element_xp:
                    actual = await _read_value_by_xpath(page, element_xp)
                    classified = _classify_fill_result(True, value, actual)
                    if classified.startswith('false_ok'):
                        return classified
                    if classified == 'ok':
                        return 'ok:locate=label'
                return _annotate_label_result(str(result))
        if not label and placeholder:
            result = await page.evaluate(JS_FILL_BY_XPATH, ['', value, placeholder])
            if isinstance(result, str) and result.startswith('ok'):
                await page.wait_for_timeout(300)
                return str(result)
        xpath_full = _element_xpath_full(entry) if use_relative else ''
        if xpath_full and xpath_full != xp:
            xpath_result = await _try_xpath_fill(xpath_full, 'full')
            if xpath_result:
                return xpath_result
        return _annotate_label_result(str(result))

    # Widget ops: prefer confirming xpath_smart host, then label JS, then xpath_full confirm.
    async def _with_xpath_first(label_js_coro):
        located_smart = await _try_xpath_locate(page, xpath_smart) if xpath_smart else False
        result = await label_js_coro()
        if isinstance(result, str) and result.startswith('ok'):
            if located_smart:
                # Prefer truthful xpath_smart when the stored locator still resolves
                return 'ok-xpath-smart' if result == 'ok' else f'ok-xpath-smart:{result[3:]}'
            return _annotate_label_result(str(result))
        if xpath_full and await _try_xpath_locate(page, xpath_full):
            result2 = await label_js_coro()
            if isinstance(result2, str) and result2.startswith('ok'):
                return 'ok-xpath-full' if result2 == 'ok' else f'ok-xpath-full:{result2[3:]}'
        return _annotate_label_result(str(result))

    if action_name == 'fill_date_field':
        async def _date():
            r = await page.evaluate(JS_FILL_DATE_FIELD, [label, value])
            await page.wait_for_timeout(300)
            return r
        return await _with_xpath_first(_date)

    if action_name == 'select_tree_option':
        async def _tree():
            r = await page.evaluate(JS_SELECT_TREE_OPTION, [label, value])
            await page.wait_for_timeout(500)
            return r
        return await _with_xpath_first(_tree)

    if action_name == 'click_radio':
        async def _radio():
            r = await page.evaluate(JS_CLICK_RADIO, [label, value])
            await page.wait_for_timeout(300)
            return r
        return await _with_xpath_first(_radio)

    if action_name == 'select_option':
        # Recorded selection is authoritative — replay MUST pick the same option_text.
        # params.options / element.options are inventory for export & downstream products
        # (reference only; never used to substitute a different value).
        element_xp = _element_xpath_smart(entry) if use_relative else ''
        pick = str(value or '').strip()

        async def _replay_select_final_failure(result_text: str) -> str:
            diag = await reset_select_ui(page)
            sys.stderr.write(
                f'[replay-select] final failure label={label!r} option={pick!r} '
                f'result={result_text!r} reset={diag}\n'
            )
            sys.stderr.flush()
            return str(result_text)

        branch_reset_diag = await reset_select_ui(page)
        if not branch_reset_diag.get('closed', False):
            sys.stderr.write(
                f'[replay-select] branch preflight reset incomplete label={label!r} reset={branch_reset_diag}\n'
            )
            sys.stderr.flush()
            return await _replay_select_final_failure('no-items')

        if not pick:
            return 'error:missing-option_text'
        # Legacy dirty steps may still store option_text=first (recording used to skip
        # stamping). "first" meant "any existing value is fine" — if the control already
        # has a value, accept ok-already. Never invent options[0]. Empty → still fail.
        _SENT = frozenset({'first', 'any', 'random', '1st', '第一个', '第一项'})
        if pick.lower() in _SENT or pick in _SENT:
            xp_s, src_s = _resolve_replay_xpath(entry, params)
            if xp_s:
                already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xp_s])
                if isinstance(already, str) and already.startswith('ok-already:'):
                    cur = already.split(':', 1)[1].strip()
                    if cur:
                        await page.wait_for_timeout(200)
                        return f'ok-already:{cur}|locate={src_s}|legacy-sentinel:{pick}'
            if label:
                already = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'check'])
                if isinstance(already, str) and already.startswith('ok-already:'):
                    cur = already.split(':', 1)[1].strip()
                    if cur:
                        await page.wait_for_timeout(200)
                        return f'ok-already:{cur}|locate=label|legacy-sentinel:{pick}'
            return f'bad_option_text:{pick}'

        async def _select_by_xpath(xpath: str, locate_src: str) -> str | None:
            reset_diag = await reset_select_ui(page)
            if not reset_diag.get('closed', False):
                sys.stderr.write(
                    f'[replay-select] xpath preflight reset incomplete xpath={xpath!r} reset={reset_diag}\n'
                )
                sys.stderr.flush()
                return await _replay_select_final_failure('no-items')

            already = await page.evaluate(JS_SELECT_VALUE_BY_XPATH, [xpath])
            if isinstance(already, str) and already.startswith('ok-already:'):
                cur_val = already.split(':', 1)[1].strip()
                if cur_val == pick:
                    await page.wait_for_timeout(200)
                    return f'ok-already:{pick}|locate={locate_src}'

            trig = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xpath])
            if not _is_ok_result(str(trig)):
                return None

            result = 'no-items'
            for attempt in range(3):
                await page.wait_for_timeout(500 if attempt == 0 else 400)
                result = await page.evaluate(JS_SELECT_OPTION, [pick, True])
                if isinstance(result, str) and result.startswith('ok'):
                    break
                if isinstance(result, str) and result.startswith('option-not-found:'):
                    break
                if result != 'no-items':
                    break
                if result == 'no-items' and attempt < 2:
                    reset_diag = await reset_select_ui(page)
                    if not reset_diag.get('closed', False):
                        sys.stderr.write(
                            f'[replay-select] retrigger reset incomplete xpath={xpath!r} reset={reset_diag}\n'
                        )
                        sys.stderr.flush()
                        result = 'no-items'
                        break
                    retrigger = await page.evaluate(JS_SELECT_TRIGGER_BY_XPATH, [xpath])
                    if not _is_ok_result(str(retrigger)):
                        result = str(retrigger)
                        break

            if isinstance(result, str) and result.startswith('ok'):
                got = result.split(':', 1)[1].strip() if ':' in result else ''
                if got and got != pick:
                    return await _replay_select_final_failure(f'option-mismatch:want={pick}|got={got}')
                actual = await _read_value_by_xpath(page, xpath)
                classified = _classify_fill_result(True, pick, actual)
                await page.wait_for_timeout(500)
                if classified.startswith('false_ok'):
                    return await _replay_select_final_failure(classified)
                return f'ok:locate={locate_src}'

            return await _replay_select_final_failure(str(result))

        async def _select_by_label() -> str:
            reset_diag = await reset_select_ui(page)
            if not reset_diag.get('closed', False):
                sys.stderr.write(
                    f'[replay-select] label preflight reset incomplete label={label!r} reset={reset_diag}\n'
                )
                sys.stderr.flush()
                return await _replay_select_final_failure('no-items')

            already = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'check'])
            if isinstance(already, str) and already.startswith('ok-already:'):
                cur_val = already.split(':', 1)[1].strip()
                if cur_val == pick:
                    await page.wait_for_timeout(200)
                    return already

            trigger_result = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
            if trigger_result in ('label-not-found', 'no-select-found', 'select-disabled'):
                return await _replay_select_final_failure(str(trigger_result))

            result = 'no-items'
            for attempt in range(3):
                await page.wait_for_timeout(500 if attempt == 0 else 400)
                result = await page.evaluate(JS_SELECT_OPTION, [pick, True])
                if isinstance(result, str) and result.startswith('ok'):
                    break
                if isinstance(result, str) and result.startswith('option-not-found:'):
                    break
                if result != 'no-items':
                    break
                if result == 'no-items' and attempt < 2:
                    reset_diag = await reset_select_ui(page)
                    if not reset_diag.get('closed', False):
                        sys.stderr.write(
                            f'[replay-select] retrigger reset incomplete label={label!r} reset={reset_diag}\n'
                        )
                        sys.stderr.flush()
                        result = 'no-items'
                        break
                    retrigger = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'trigger'])
                    if not _is_ok_result(str(retrigger)):
                        result = str(retrigger)
                        break

            if isinstance(result, str) and result.startswith('ok'):
                got = result.split(':', 1)[1].strip() if ':' in result else ''
                if got and got != pick:
                    return await _replay_select_final_failure(f'option-mismatch:want={pick}|got={got}')
                confirmed = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                if isinstance(confirmed, str) and confirmed.startswith('ok-confirmed:'):
                    cur = confirmed.split(':', 1)[1].strip()
                    if cur and cur != pick:
                        return await _replay_select_final_failure(f'option-mismatch:want={pick}|got={cur}')
                elif not (isinstance(confirmed, str) and confirmed.startswith('ok-confirmed:')):
                    await page.evaluate(JS_FILL_FORM_FIELD, [label, pick])
                    await page.wait_for_timeout(200)
                    confirmed2 = await page.evaluate(JS_FIND_LABELED_SELECT, [label, 'confirm'])
                    if isinstance(confirmed2, str) and confirmed2.startswith('ok-confirmed:'):
                        cur = confirmed2.split(':', 1)[1].strip()
                        if cur != pick:
                            return await _replay_select_final_failure(f'option-mismatch:want={pick}|got={cur}')
                        result = confirmed2
                    else:
                        return await _replay_select_final_failure(
                            f'option-not-synced:want={pick}|confirm={confirmed2}'
                        )
            await page.wait_for_timeout(500)
            if isinstance(result, str) and result.startswith('ok'):
                return str(result)
            return await _replay_select_final_failure(str(result))

        xp, src = _resolve_replay_xpath(entry, params)
        if xp:
            xpath_result = await _select_by_xpath(xp, src)
            if xpath_result is not None:
                return xpath_result

        label_result = await _select_by_label()
        if isinstance(label_result, str) and label_result.startswith('ok'):
            if element_xp:
                actual = await _read_value_by_xpath(page, element_xp)
                classified = _classify_fill_result(True, pick, actual)
                if classified.startswith('false_ok'):
                    return await _replay_select_final_failure(classified)
                if classified == 'ok':
                    return 'ok:locate=label'
            return _annotate_label_result(label_result)

        xpath_full = _element_xpath_full(entry) if use_relative else ''
        if xpath_full and xpath_full != xp:
            xpath_result = await _select_by_xpath(xpath_full, 'full')
            if xpath_result is not None:
                return xpath_result

        return _annotate_label_result(label_result)

    return f'unknown-form-action:{action_name}'



def _locate_hint(result: str) -> str:
    """Human-readable locate strategy for replay stderr logs."""
    r = str(result or '')
    if 'xpath-smart' in r or r.startswith('ok-xpath-smart'):
        return 'xpath_smart'
    if 'xpath-full' in r or r.startswith('ok-xpath-full'):
        return 'xpath_full'
    if r.startswith('ok-playwright'):
        return 'playwright'
    if r.startswith('ok-label') or r.startswith('ok-already') or r.startswith('ok-confirmed'):
        return 'label'
    if r.startswith('ok-menu') or r.startswith('ok-submenu') or 'menu' in r:
        return 'semantic'
    if r.startswith('ok-aria') or r.startswith('ok-tree') or r.startswith('ok-tooltip'):
        return 'semantic'
    if r.startswith('ok-text') or 'text' in r:
        return 'semantic'
    if r.startswith('ok'):
        return 'ok'
    return 'n/a'

async def _replay_controller_action(act, params: dict) -> str:
    """Non-form actions via controller registry (menu/table/dialog/login/…)."""
    kwargs = _filter_callable_kwargs(act.function, params)
    result = await act.function(**kwargs)
    extracted = getattr(result, 'extracted_content', None)
    return str(extracted if extracted is not None else result)


async def _replay_table_row_radio(
    page,
    entry: dict,
    params: dict,
    *,
    controller_actions: dict | None = None,
) -> str:
    """Replay row radio: semantic first (fixed columns), then durable xpath."""
    row_text = (
        params.get('row_text')
        or params.get('text')
        or params.get('row_match')
        or ''
    )
    row_text = str(row_text).strip()

    semantic = ''
    act = (controller_actions or {}).get('click_table_row_radio')
    if act and row_text:
        semantic = await _replay_controller_action(act, {'row_text': row_text})
        await page.wait_for_timeout(400)
        await _wait_if_loading(page)
        if _result_ok('click_table_row_radio', semantic):
            return f'{semantic} | locate=semantic-row'

    # Fallback: recorded xpath_smart / text durable click
    click_params = {**params, 'text': row_text or params.get('text') or ''}
    if _element_xpath_smart(entry) or click_params.get('text'):
        durable = await _replay_click_by_index(page, entry, click_params)
        if _result_ok('click_table_row_radio', durable):
            prefix = f'{semantic} | ' if semantic else ''
            return f'{prefix}{durable} | locate=durable-fallback'
        if semantic:
            return f'{semantic} | durable:{durable}'
        return durable

    if semantic:
        return semantic
    if act and not row_text:
        return 'row-text-empty'
    return 'unknown-action:click_table_row_radio'



async def replay_action_entries(
    browser_context,
    entries: list[dict],
    *,
    controller_actions: dict | None = None,
    case_data_store: dict | None = None,
    emit=None,
    stop_on_fail: bool = False,
) -> dict:
    """
    Replay recorded steps sequentially (auto-fill style orchestration).

    When stop_on_fail=True, break after the first failed step (still emit replay_step).

    Returns {count, ok, failed, results, stoppedAt?}.
    """
    store = case_data_store if case_data_store is not None else {}
    prev_watcher = store.get('_watcher_mode')
    store['_watcher_mode'] = True

    results = []
    ok_count = 0
    fail_count = 0
    total = len(entries)
    stopped_at = None

    try:
        page = await browser_context.get_current_page()
        await _wait_if_loading(page)

        for i, entry in enumerate(entries):
            action_name = normalize_action_name(entry.get('action') or '')
            params = _normalize_params(action_name, entry.get('params'))
            step_num = i + 1
            sys.stderr.write(f'[replay] [{step_num}/{total}] {action_name} {params}\n')
            sys.stderr.flush()

            try:
                if action_name == 'go_to_url':
                    result = await _replay_goto(page, params)
                elif action_name == 'save_form_snapshot':
                    result = await _replay_verify_form_structure(page, params)
                elif action_name == _CLICK_BY_INDEX:
                    result = await _replay_click_by_index(page, entry, params)
                elif action_name in (
                    'click_menu_item',
                    'click_icon_button',
                    'click_adjacent_button',
                    'click_table_row_button',
                    'switch_tab',
                    'close_dialog',
                ):
                    # Idempotent close: if no visible dialog/drawer/message-box
                    # remains, the overlay is already gone (a preceding
                    # 确定/下一步 may have navigated or closed it). Treat as
                    # success instead of failing the replay and forcing a heal
                    # step every time the recorded close lands after the dialog
                    # was already dismissed.
                    result = None
                    if action_name == 'close_dialog':
                        overlay_count = await page.evaluate('''() => {
                            const isVis = (el) => {
                                if (el.offsetParent !== null) return true;
                                const st = getComputedStyle(el);
                                if (st.display === 'none' || st.visibility === 'hidden') return false;
                                const r = el.getBoundingClientRect();
                                return r.width > 0 && r.height > 0;
                            };
                            const d = [...document.querySelectorAll('.el-dialog')].filter(isVis).length;
                            const w = [...document.querySelectorAll('.el-drawer')].filter(isVis).length;
                            const m = [...document.querySelectorAll('.el-message-box')].filter(isVis).length;
                            return d + w + m;
                        }''')
                        if overlay_count == 0:
                            result = 'ok (no visible dialog/drawer — already closed)'
                            sys.stderr.write('[replay] close_dialog idempotent ok (no visible overlay)\n')
                            sys.stderr.flush()
                    if result is None:
                        # Prefer recorded xpath_smart via durable click path; fall back to controller.
                        click_params = {**params}
                        if action_name == 'click_menu_item':
                            click_params['text'] = params.get('menu_text') or params.get('text') or ''
                        elif action_name == 'click_icon_button':
                            click_params['text'] = params.get('button_text') or params.get('text') or ''
                        elif action_name == 'switch_tab':
                            click_params['text'] = params.get('tab_name') or params.get('text') or ''
                        elif action_name == 'click_table_row_button':
                            click_params['text'] = params.get('button_text') or params.get('text') or ''
                        elif action_name == 'click_adjacent_button':
                            click_params['text'] = params.get('text') or params.get('label_text') or ''
                        if _element_xpath_smart(entry) or click_params.get('text'):
                            result = await _replay_click_by_index(page, entry, click_params)
                            # close_dialog: dialog-scoped xpath often misses drawers
                            # (Element UI reuses i.el-dialog__close inside drawer).
                            # Fall back to CTRL/controller close which handles drawer.
                            if (
                                action_name == 'close_dialog'
                                and not _result_ok(action_name, result)
                            ):
                                act = (controller_actions or {}).get(action_name)
                                if act:
                                    fb = await _replay_controller_action(act, params)
                                    await page.wait_for_timeout(400)
                                    await _wait_if_loading(page)
                                    if _result_ok(action_name, fb):
                                        sys.stderr.write(
                                            f'[replay] close_dialog ctrl-fallback ok '
                                            f'(xpath failed: {result})\n'
                                        )
                                        sys.stderr.flush()
                                        result = fb
                        else:
                            act = (controller_actions or {}).get(action_name)
                            if not act:
                                result = f'unknown-action:{action_name}'
                            else:
                                result = await _replay_controller_action(act, params)
                                await page.wait_for_timeout(400)
                                await _wait_if_loading(page)
                elif action_name == 'click_table_row_radio':
                    # Prefer semantic row match (handles Element UI fixed-column radios).
                    # Durable xpath often requires name+radio in the same <tr> and fails.
                    result = await _replay_table_row_radio(
                        page, entry, params, controller_actions=controller_actions,
                    )
                elif action_name in _FORM_ACTIONS:
                    result = await _replay_form_action(page, action_name, params, entry)
                else:
                    act = (controller_actions or {}).get(action_name)
                    if not act:
                        result = f'unknown-action:{action_name}'
                    else:
                        result = await _replay_controller_action(act, params)
                        await page.wait_for_timeout(400)
                        await _wait_if_loading(page)
                        if action_name == 'click_save' and _result_ok(action_name, result):
                            await _wait_after_save_page_idle(page)
            except Exception as e:
                result = f'error:{e}'

            ok = _result_ok(action_name, result)
            if ok:
                ok_count += 1
            else:
                fail_count += 1

            locate = _locate_hint(result)
            row = {
                'index': step_num,
                'action': action_name,
                'params': params,
                'result': result,
                'ok': ok,
                'locate': locate,
            }
            if entry.get('id') is not None:
                row['id'] = entry.get('id')
            results.append(row)
            sys.stderr.write(
                f'[replay] [{step_num}/{total}] {"OK" if ok else "FAIL"} → {result} | locate={locate}\n'
            )
            sys.stderr.flush()

            if emit:
                try:
                    emit({
                        'event': 'replay_step',
                        'data': {
                            'index': step_num,
                            'total': total,
                            'action': action_name,
                            'params': params,
                            'result': result,
                            'ok': ok,
                            'locate': locate,
                            'id': entry.get('id'),
                        },
                    })
                except Exception:
                    pass

            if not ok and stop_on_fail:
                stopped_at = step_num
                sys.stderr.write(
                    f'[replay] stop_on_fail: halted at step {step_num}/{total}\n'
                )
                sys.stderr.flush()
                break

            try:
                page = await browser_context.get_current_page()
            except Exception:
                pass

            await asyncio.sleep(0)

        ran = len(results)
        sys.stderr.write(
            f'[replay] Done: {ran}/{total} actions | ok:{ok_count} failed:{fail_count}'
            + (f' stoppedAt:{stopped_at}' if stopped_at else '')
            + '\n'
        )
        sys.stderr.flush()
        error = None
        if fail_count > 0:
            failed_rows = [r for r in results if not r.get('ok')]
            first = failed_rows[0] if failed_rows else {}
            error = (
                f"{fail_count}/{ran} steps failed"
                + (f"; first: {first.get('action')} → {first.get('result')}" if first else '')
            )
        out = {
            'count': ran,
            'ok': ok_count,
            'failed': fail_count,
            'error': error,
            'results': results,
        }
        if stopped_at is not None:
            out['stoppedAt'] = stopped_at
        return out
    finally:
        if prev_watcher is None:
            store.pop('_watcher_mode', None)
        else:
            store['_watcher_mode'] = prev_watcher
