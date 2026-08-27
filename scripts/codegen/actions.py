"""Per-action Playwright code generation for the script assembler.

Extracted verbatim from scripts/script_assembler.py — do not edit the
generation logic in two places: scripts.script_assembler re-exports
these names.
"""
import re

from scripts.models import ActionEntry
from scripts.controller.actions.replay_names import normalize_action_name

from .js_escaping import _escape, _escape_js_string, _xpath_literal_py


# Actions that are meta/utility only — not rendered as Playwright steps
_SKIP_ACTIONS = (
    'scroll_down', 'scroll_up', 'get_page_state', 'scan_form_fields', 'scan_visible_fields',
    'check_field_value', 'verify_field_value', 'take_screenshot',
    'save_trajectory', 'save_business_data', 'read_business_data',
    'match_form_rule', 'init_task_list', 'get_pending_tasks', 'sync_tasks_from_errors',
    'expand_all_el_tree', 'task_done', 'task_retry',
    'save_form_snapshot',
)


# ========================== Identity Field Detection ==========================

# Keywords that indicate a field value should be dynamically generated each run
_IDENTITY_KEYWORDS = [
    ('genCreditCode', ['统一社会信用代码', '信用代码', '营业执照', '营业执照号']),
    ('genValidIdCard', ['身份证', '身份证号', '居民身份证']),
    ('genMobile', ['手机号', '电话', '联系方式', '联系电话', '电话号码']),
    ('genEmail', ['邮箱', 'Email', '电子邮箱']),
    ('genBankCard', ['银行卡', '银行卡号', '银行账号']),
    ('genName', ['姓名', '联系人']),
    ('genAmount', ['金额', '价格', '费用', '工资', '收入']),
    ('genAddress', ['地址', '详细地址', '联系地址']),
]

# Labels that should NEVER trigger identity generation (login, system fields)
_IDENTITY_EXCLUDE = ['用户名', '密码', '登录', '验证码', '图形', '短信', '验证', 'captcha']

def _is_identity_field(label, value=None):
    """Check if a label matches identity-type fields that need unique values.

    「证件号码」is ambiguous — prefer recorded value shape when available.
    """
    if not label:
        return None
    t = re.sub(r'\s+', '', label)
    # Exclude login/system fields
    for excl in _IDENTITY_EXCLUDE:
        if excl in t:
            return None
    # Ambiguous cert-number label: infer from recorded value
    if '证件号码' in t or (t.endswith('证件号') and '类型' not in t):
        v = (value or '').strip()
        if re.fullmatch(r'\d{17}[\dXx]', v):
            return 'genValidIdCard'
        if re.fullmatch(r'[0-9A-Z]{18}', v) and re.search(r'[A-Z]', v):
            return 'genCreditCode'
        return 'genValidIdCard'
    for gen_fn, keywords in _IDENTITY_KEYWORDS:
        for kw in keywords:
            if kw in t:
                return gen_fn
    return None


# ========================== Action-to-Code Mapping ==========================

def _escape(s):
    """Escape single quotes for JS strings."""
    return s.replace('\\', '\\\\').replace("'", "\\'") if s else ''


def _escape_js_string(s):
    """Escape a string for use inside a JS template literal or string."""
    if not s:
        return ''
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n')


def _xpath_literal_py(text):
    """Build an XPath string literal for text matching."""
    t = str(text or '')
    if "'" not in t:
        return f"'{t}'"
    if '"' not in t:
        return f'"{t}"'
    parts = t.split("'")
    return 'concat(' + ', "\'", '.join(f"'{p}'" for p in parts) + ')'


def _click_kind(tag, attrs, xp_smart, xp_full, xp_primary):
    """Classify click target: 'button' | 'menu' | 'generic'.

    Button path uses role/text_btn/xpath_smart; menu path must NOT (el-menu-item
    is not a button — those strategies only burn timeouts).
    """
    tag_l = str(tag or '').lower()
    attrs = attrs if isinstance(attrs, dict) else {}
    cls = str(attrs.get('class') or attrs.get('className') or '')
    blob = ' '.join([
        cls,
        str(xp_smart or ''),
        str(xp_full or ''),
        str(xp_primary or ''),
    ]).lower()

    is_button = (
        tag_l == 'button'
        or bool(re.search(r'(?:^|\s)el-button(?:\s|$)', cls))
        or 'button[normalize-space' in str(xp_smart or '').replace(' ', '').lower()
        or str(xp_smart or '').lstrip('(').startswith('//button')
    )
    # <a class="el-button"> still a button-like control
    if tag_l == 'a' and 'el-button' in cls:
        is_button = True

    is_menu = (
        tag_l in ('li',)
        or 'el-menu' in blob
        or 'el-submenu' in blob
        or bool(re.search(r'/nav/', blob))
        or bool(re.search(r'/ul\[\d+\]/li\[\d+\]', blob))
    )

    if is_button and not is_menu:
        return 'button'
    if is_menu and not is_button:
        return 'menu'
    if is_button and is_menu:
        # Conflicting cues — prefer absolute/menu path over button role
        return 'menu' if ('el-menu' in blob or tag_l == 'li') else 'button'
    return 'generic'


FILL_RETRY_ACTIONS = {'fill_form_field'}

def _generate_action_code(entry, step_num, url, is_first_fill=False):
    """Generate Playwright JS code from a recorded action entry.

    Accepts either a dict (legacy) or an ActionEntry model instance.
    """
    # Normalize to dict for backward compat with existing dict-access code
    if isinstance(entry, ActionEntry):
        _e = entry.model_dump()
    elif isinstance(entry, dict):
        _e = entry
    else:
        _e = {}
    action = normalize_action_name(_e.get('action', ''))
    params = _e.get('params', {}) or {}

    def pre():
        return ""  # Playwright built-in auto-wait handles element readiness

    def pre_ready():
        return "    await page.waitForSelector('.el-form-item', { timeout: 10000 }).catch(() => {});"

    lines = [f'    // [{step_num}] {action}']

    def p(k, default=''):
        v = params.get(k, default)
        return str(v) if v else default

    # ---- go_to_url (handled in header) ----
    if action == 'go_to_url':
        return ''

    # ---- login (expand into fill + click) ----
    if action == 'login':
        u, pw = p('username') or '', p('password') or ''
        cp = p('captcha') or ''
        sm = p('sms_code') or ''
        lines.append(f"    console.log('[{step_num}] Login: fill username + password');")
        lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('用户名', v), '{_escape(u)}');")
        lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('密码', v), '{_escape(pw)}');")
        if cp:
            lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('验证码', v), '{_escape(cp)}');")
        if sm:
            lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('短信验证码', v), '{_escape(sm)}');")
        lines.append(f"    await page.evaluate(() => {{")
        lines.append(f"      for (const btn of document.querySelectorAll('button')) {{")
        lines.append(f"        if (['登录','登錄','Login'].includes(btn.textContent.trim().replace(/\\s/g,'')) && btn.offsetParent && !btn.disabled) {{ btn.click(); break; }}")
        lines.append(f"      }}")
        lines.append(f"    }});")
        lines.append(f"    await page.evaluate(() => CTRL.waitForLoading());")
        return '\n'.join(lines)

    # ---- fill_form_field ----
    if action == 'fill_form_field':
        l, v = p('label_text'), p('value')
        id_fn = _is_identity_field(l, v)

        lines.append(f"    console.log('[{step_num}] Fill \"{l}\" → \"{v}\"');")
        lines.append(pre())
        lines.append(pre_ready())

        # Identity field: generate dynamic value
        if id_fn and v:
            lines.append(f"    const _v{step_num} = {id_fn}();")
            lines.append(f"    console.log('[{step_num}]   generated unique value:', _v{step_num});")
            val_expr = f"_v{step_num}"
        else:
            val_expr = f"'{_escape(v)}'"

        # Scope fallbacks to visible dialog/drawer (prevent filling fields behind overlays)
        lines.append(f"    // Scope fallback locators to active dialog/drawer")
        lines.append(f"    const _scope{step_num} = await page.evaluate(() => {{")
        lines.append(f"      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';")
        lines.append(f"      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';")
        lines.append(f"      return '';")
        lines.append(f"    }});")
        lines.append(f"    const _base{step_num} = _scope{step_num} ? page.locator(_scope{step_num}) : page;")

        # Address fields use fillAddressFields
        if '地址' in l or '址' in l or 'address' in l.lower():
            lines.append(f"    const _r{step_num} = await page.evaluate((addr) => CTRL.fillAddressFields(addr), {val_expr});")
            lines.append(f"    if (_r{step_num} === 'no-address-fields') {{")
            lines.append(f"      console.log('[{step_num}] address fill result:', _r{step_num});")
            lines.append(f"      const _a{step_num} = await _base{step_num}.locator('.el-form-item:has-text(\"地址\")').locator('input, textarea').all();")
            lines.append(f"      for (const _el of _a{step_num}) {{ await _el.fill({val_expr}); }}")
            lines.append(f"    }}")
        else:
            # Tier 1: CTRL.fillFormField
            lines.append(f"    let _r{step_num} = await page.evaluate((v) => CTRL.fillFormField('{_escape(l)}', v), {val_expr});")
            lines.append(f"    console.log('[{step_num}]   CTRL:', _r{step_num});")
            # Build structured details for LLM — tracks per-tier results
            lines.append(f"    let _dt{step_num} = 'CTRL: ' + _r{step_num};")

            # Tier 2: Playwright text-based fallback
            lines.append(f"    if (_r{step_num} !== 'ok' && _r{step_num} !== 'ok-date' && _r{step_num} !== 'ok-placeholder' && _r{step_num} !== 'ok-fuzzy') {{")
            lines.append(f"      console.log('[{step_num}]   falling back to Playwright text...');")
            lines.append(f"      try {{")
            lines.append(f"        const _fb{step_num} = _base{step_num}.locator('.el-form-item').filter({{ hasText: '{_escape_js_string(l)}' }}).locator('input:not([type=\"hidden\"]), textarea').first();")
            lines.append(f"        await _fb{step_num}.fill({val_expr}, {{ timeout: 3000 }});")
            lines.append(f"        _r{step_num} = 'ok-playwright';")
            lines.append(f"        console.log('[{step_num}]   Playwright text OK');")
            lines.append(f"      }} catch (_e_fb{step_num}) {{")
            lines.append(f"        console.log('[{step_num}]   Playwright fallback failed:', _e_fb{step_num}.message);")
            lines.append(f"        _dt{step_num} += ' | Playwright hasText: failed';")

            # Record error
            lines.append(f"        _dt{step_num} += ' | label_text may need updating';")
            lines.append(f"        _recordError({step_num}, 'fill_form_field', '{_escape_js_string(l)}', String({val_expr}), 'needs-llm-fix', _dt{step_num});")
            lines.append(f"      }}")
            lines.append(f"    }}")

        # First fill in a new block: retry once
        if is_first_fill:
            lines.append(f'    // Retry "{l}" (first fill in this block may fail on new form)')
            if '地址' in l or '址' in l or 'address' in l.lower():
                lines.append(f"    await page.evaluate((addr) => CTRL.fillAddressFields(addr), {val_expr});")
            else:
                lines.append(f"    await page.evaluate((v) => CTRL.fillFormField('{_escape(l)}', v), {val_expr});")
        return '\n'.join(lines)

    # ---- select_option ----
    if action == 'select_option':
        l, o = p('label_text'), p('option_text') or p('value')
        lines.append(f"    console.log('[{step_num}] Select \"{l}\" = \"{o}\"');")
        lines.append(pre())
        lines.append(pre_ready())

        # Tier 1: CTRL.selectOption
        lines.append(f"    let _rs{step_num} = await page.evaluate(() => CTRL.selectOption('{_escape(l)}', '{_escape(o)}'));")
        lines.append(f"    console.log('[{step_num}]   CTRL:', _rs{step_num});")
        lines.append(f"    let _dts{step_num} = 'CTRL: ' + _rs{step_num};")

        # Scope fallback to active dialog/drawer
        lines.append(f"    const _scope{step_num} = await page.evaluate(() => {{")
        lines.append(f"      for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return '.el-dialog';")
        lines.append(f"      for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return '.el-drawer';")
        lines.append(f"      return '';")
        lines.append(f"    }});")
        lines.append(f"    const _base{step_num} = _scope{step_num} ? page.locator(_scope{step_num}) : page;")

        # Tier 2: Playwright native fallback
        lines.append(f"    if (!_rs{step_num} || !_rs{step_num}.startsWith('ok')) {{")
        lines.append(f"      console.log('[{step_num}]   falling back to Playwright...');")
        lines.append(f"      // Dismiss any stray dropdown before retrying")
        lines.append(f"      await page.keyboard.press('Escape');")
        lines.append(f"      try {{")
        lines.append(f"        await _base{step_num}.locator('.el-form-item').filter({{ hasText: '{_escape_js_string(l)}' }}).locator('.el-select .el-input__inner').first().click({{ timeout: 3000 }});")
        lines.append(f"        await page.evaluate(() => CTRL.waitForLoading());")
        lines.append(f"        const _opt{step_num} = page.locator('.el-select-dropdown__item').filter({{ hasText: '{_escape_js_string(o)}' }}).first();")
        lines.append(f"        await _opt{step_num}.click({{ timeout: 3000 }});")
        lines.append(f"        _rs{step_num} = 'ok-playwright';")
        lines.append(f"        console.log('[{step_num}]   Playwright fallback OK');")
        lines.append(f"      }} catch (_e_s{step_num}) {{")
        lines.append(f"        console.log('[{step_num}]   Playwright fallback failed:', _e_s{step_num}.message);")
        lines.append(f"        _dts{step_num} += ' | Playwright native: failed';")

        # Record error
        lines.append(f"        _dts{step_num} += ' | label_text/option_text may need updating';")
        lines.append(f"        _recordError({step_num}, 'select_option', '{_escape_js_string(l)}', '{_escape_js_string(o)}', 'needs-llm-fix', _dts{step_num});")

        lines.append(f"      }}")   # close Playwright catch

        lines.append(f"    }}")

        lines.append('')
        return '\n'.join(lines)

    # ---- click_menu_item ----
    if action == 'click_menu_item':
        t = p('menu_text')
        lines.append(f"    console.log('[{step_num}] Menu \"{t}\"');")
        lines.append(pre())
        lines.append(pre_ready())
        lines.append(f"    const _rm{step_num} = await page.evaluate(() => CTRL.clickMenuItem('{_escape(t)}'));")
        lines.append(f"    if (_rm{step_num} === 'not-found') _recordError({step_num}, 'click_menu_item', '{_escape_js_string(t)}', '', 'not-found', 'Menu item not visible or not found');")
        lines.append("    await page.evaluate(() => CTRL.waitForLoading());")
        return '\n'.join(lines)

    # ---- click_table_row_button ----
    if action == 'click_table_row_button':
        r, b = p('row_text'), p('button_text')
        lines.append(f"    console.log('[{step_num}] Table button \"{r}\" / \"{b}\"');")
        lines.append(pre())
        lines.append(pre_ready())
        lines.append(f"    const _rt{step_num} = await page.evaluate(() => CTRL.clickTableRowButton('{_escape(r)}', '{_escape(b)}'));")
        lines.append(f"    if (_rt{step_num} !== 'ok' && _rt{step_num} !== 'ok-icon' && _rt{step_num} !== 'ok-fallback') _recordError({step_num}, 'click_table_row_button', '{_escape_js_string(r)}', '{_escape_js_string(b)}', _rt{step_num}, 'Row or button not found');")
        lines.append('')
        return '\n'.join(lines)

    # ---- click_table_row_radio ----
    if action == 'click_table_row_radio':
        r = p('row_text')
        lines.append(f"    console.log('[{step_num}] Table radio \"{r}\"');")
        lines.append(pre())
        lines.append(f"    const _trr{step_num} = await page.evaluate(() => CTRL.clickTableRowRadio('{_escape(r)}'));")
        lines.append(f"    console.log('[{step_num}]   table radio:', _trr{step_num});")
        lines.append(f"    if (_trr{step_num} !== 'ok') _recordError({step_num}, 'click_table_row_radio', '{_escape_js_string(r)}', '', _trr{step_num}, 'Row or radio not found');")
        lines.append('')
        return '\n'.join(lines)

    # ---- click_adjacent_button ----
    if action == 'click_adjacent_button':
        l = p('label_text')
        lines.append(f"    console.log('[{step_num}] Adjacent button \"{l}\"');")
        lines.append(pre())
        lines.append(f"    await page.evaluate(() => CTRL.clickAdjacentButton('{_escape(l)}'));")
        lines.append('')
        return '\n'.join(lines)

    # ---- click_button ----
    if action == 'click_button':
        t = p('button_text')
        lines.append(f"    console.log('[{step_num}] Icon button \"{t}\"');")
        lines.append(pre())
        lines.append(pre_ready())
        lines.append(f"    const _ib{step_num} = await page.evaluate(() => CTRL.clickButton('{_escape(t)}'));")
        lines.append(f"    if (_ib{step_num} === 'not-found' || _ib{step_num} === 'button-text-empty') _recordError({step_num}, 'click_button', '{_escape_js_string(t)}', '', _ib{step_num}, 'Icon button not found by tooltip text');")
        lines.append("    await page.evaluate(() => CTRL.waitForLoading());")
        return '\n'.join(lines)

    # ---- click_radio ----
    if action == 'click_radio':
        l, o = p('label_text'), p('option_text') or p('value')
        lines.append(f"    console.log('[{step_num}] Radio \"{l}\" = \"{o}\"');")
        lines.append(pre())
        lines.append(f"    const _rr{step_num} = await page.evaluate(() => CTRL.clickRadio('{_escape(l)}', '{_escape(o)}'));")
        lines.append(f"    if (_rr{step_num} !== 'ok') _recordError({step_num}, 'click_radio', '{_escape_js_string(l)}', '{_escape_js_string(o)}', _rr{step_num}, '');")
        return '\n'.join(lines)

    # ---- select_tree_option ----
    if action == 'select_tree_option':
        l, o = p('label_text'), p('option_text') or p('value')
        lines.append(f"    console.log('[{step_num}] Tree-select \"{l}\" = \"{o}\"');")
        lines.append(pre())
        lines.append(pre_ready())
        lines.append(f"    const _rt{step_num} = await page.evaluate(() => CTRL.selectTreeOption('{_escape(l)}', '{_escape(o)}'));")
        lines.append(f"    console.log('[{step_num}]   CTRL:', _rt{step_num});")
        lines.append(f"    if (!_rt{step_num} || _rt{step_num} === 'label-not-found' || _rt{step_num} === 'option-not-found' || _rt{step_num} === 'no-tree-component') {{")
        lines.append(f"      _recordError({step_num}, 'select_tree_option', '{_escape_js_string(l)}', '{_escape_js_string(o)}', _rt{step_num}, '');")
        lines.append(f"    }}")
        return '\n'.join(lines)

    # ---- click_element_by_index ----
    if action == 'click_element_by_index':
        idx = p('index')
        # target (ActionEntry) or nested element.xpath (DB → assemble-file)
        _el = _e.get('element') if isinstance(_e.get('element'), dict) else {}
        _cands = _el.get('candidates') if isinstance(_el.get('candidates'), list) else []

        def _cand(typ):
            for c in _cands:
                if isinstance(c, dict) and c.get('type') == typ and c.get('value'):
                    return str(c.get('value'))
            return ''

        xp_smart = _cand('xpath_smart') or str(_el.get('xpath_smart') or '')
        xp_full = _cand('xpath_full') or str(_el.get('xpath_full') or _el.get('xpath_abs') or '')
        xp_primary = (_e.get('target') or _el.get('xpath') or _el.get('target')
                      or _e.get('xpath') or '')
        # Prefer text-anchored smart xpath; keep absolute as last resort
        if xp_smart:
            xp = xp_smart
        elif str(xp_primary).startswith('//'):
            xp = xp_primary
            xp_smart = xp_primary
        else:
            xp = xp_primary
        txt = p('text', '') or (_el.get('text') or '')
        attrs = _e.get('attributes') if isinstance(_e.get('attributes'), dict) else {}
        if not attrs and isinstance(_el.get('attributes'), dict):
            attrs = _el['attributes']
        tag = (
            p('tag_name', '')
            or _el.get('tag')
            or _el.get('tag_name')
            or _e.get('tagName')
            or ''
        )
        kind = _click_kind(tag, attrs, xp_smart, xp_full, xp_primary)

        if not xp and not txt:
            lines.append(f"    console.log('[{step_num}] Click [{idx}] (no XPath)');")
            lines.append(f"    _recordError({step_num}, 'click_element_by_index', '', '', 'needs-llm-fix', 'missing xpath');")
            lines.append(f"    throw new Error('[{step_num}] Click failed: missing XPath and text');")
            return '\n'.join(lines)

        if xp and not str(xp).startswith('/') and not str(xp).startswith('//'):
            xp = '/' + str(xp)
        if xp_full and not str(xp_full).startswith('/') and not str(xp_full).startswith('//'):
            xp_full = '/' + str(xp_full)

        # Menu clicks: prefer absolute xpath over button-only xpath_smart
        if kind == 'menu':
            abs_xp = xp_full or (
                xp_primary if xp_primary and not str(xp_primary).startswith('//') else ''
            )
            if abs_xp:
                if not str(abs_xp).startswith('/') and not str(abs_xp).startswith('('):
                    abs_xp = '/' + str(abs_xp)
                xp = abs_xp
                xp_smart = ''  # do not try //button[...] for menu items

        lines.append(f"    console.log('[{step_num}] Click [{idx}] \"{txt}\" ({kind})');")
        lines.append("    await page.waitForFunction(before => location.href !== before, page.url(), { timeout: 5000 }).catch(() => {});")
        lines.append(pre())
        lines.append(pre_ready())

        # Degradation chain — button vs menu/generic diverge on purpose.
        selectors = []
        if kind == 'button':
            # Button: role / text_btn / xpath_smart BEFORE absolute xpath_full
            if txt:
                selectors.append((
                    'role',
                    f"page.getByRole('button', {{ name: '{_escape(txt)}', exact: true }}).last()",
                ))
                selectors.append((
                    'text_btn',
                    f"page.locator('button.el-button, button').filter({{ hasText: '{_escape(txt)}' }}).last()",
                ))
            if xp_smart or (xp and str(xp).startswith('//')):
                smart_xp = xp_smart or xp
                selectors.append(('xpath_smart', f"page.locator('xpath={_escape(smart_xp)}').last()"))
                if txt and 'el-dialog' in str(smart_xp) and 'el-drawer' not in str(smart_xp):
                    drawer_xp = f"(//div[contains(@class,'el-drawer')])[last()]//button[normalize-space()={_xpath_literal_py(txt)}]"
                    selectors.append(('xpath_drawer', f"page.locator('xpath={_escape(drawer_xp)}').last()"))
                if txt:
                    plain_xp = f"//button[normalize-space()={_xpath_literal_py(txt)}]"
                    if plain_xp != str(smart_xp):
                        selectors.append(('xpath_plain', f"page.locator('xpath={_escape(plain_xp)}').last()"))
            if xp_full and xp_full != xp_smart and xp_full != xp:
                selectors.append(('xpath_full', f"page.locator('xpath={_escape(xp_full)}').first()"))
            elif xp and not str(xp).startswith('//') and xp != xp_smart:
                selectors.append(('xpath_full', f"page.locator('xpath={_escape(xp)}').first()"))
        else:
            # Menu / generic: xpath → :text-is → menu-item text (no button role)
            abs_or_primary = xp_full or xp
            if abs_or_primary:
                selectors.append(('xpath', f"page.locator('xpath={_escape(abs_or_primary)}').first()"))
            if txt:
                selectors.append(('text', f"page.locator(':text-is(\"{_escape(txt)}\")').first()"))
            if kind == 'menu' and txt:
                selectors.append((
                    'menu_item',
                    f"page.locator('.el-menu-item, .el-submenu__title').filter({{ hasText: '{_escape(txt)}' }}).first()",
                ))
            # Generic may still benefit from smart xpath when it is not button-only noise
            if kind == 'generic' and xp_smart and 'button[normalize-space' not in str(xp_smart):
                selectors.append(('xpath_smart', f"page.locator('xpath={_escape(xp_smart)}').last()"))

        js_xp = (xp if kind == 'menu' else (xp_smart or xp or xp_full)) or xp_full or xp
        if js_xp:
            selectors.append(('js', f"JS: document.evaluate('{_escape(js_xp)}', ...)"))
        if txt:
            selectors.append(('fuzzy', f"JS-fuzzy: text='{_escape(txt)}' ({kind})"))

        if not selectors:
            lines.append(f"    _recordError({step_num}, 'click_element_by_index', '{_escape_js_string(txt)}', '', 'needs-llm-fix', 'no xpath/text match');")
            lines.append(f"    throw new Error('[{step_num}] Click failed: no XPath and text \"{_escape(txt)}\" not found');")
            return '\n'.join(lines)

        # Fuzzy candidate set: buttons-only vs menu-aware
        fuzzy_sel = (
            "button, .el-button, a, [role=button]"
            if kind == 'button'
            else "button, a, span, li, label, .el-button, .el-menu-item, .el-submenu__title, [role=menuitem], .el-tabs__item"
        )

        lines.append(f"    let _clicked{step_num} = false;")
        lines.append(f"    let _dt{step_num} = '';")
        for i, (sel_type, sel_expr) in enumerate(selectors):
            if sel_type in ('js', 'fuzzy'):
                if sel_type == 'js':
                    lines.append(f"    if (!_clicked{step_num}) {{")
                    lines.append(f"      try {{")
                    lines.append(f"        const _okJs{step_num} = await page.evaluate((xp) => {{")
                    lines.append(f"          const el = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;")
                    lines.append(f"          if (!el) return false;")
                    if kind == 'button':
                        lines.append(f"          const st = getComputedStyle(el);")
                        lines.append(f"          const box = el.getBoundingClientRect();")
                        lines.append(f"          if (st.display === 'none' || st.visibility === 'hidden' || box.width < 1 || box.height < 1) return false;")
                        lines.append(f"          el.scrollIntoView({{ block: 'center', behavior: 'instant' }});")
                        lines.append(f"          el.click();")
                    else:
                        # Menu: dispatchEvent even if offsetParent quirks
                        lines.append(f"          el.scrollIntoView({{ block: 'center', behavior: 'instant' }});")
                        lines.append(f"          el.dispatchEvent(new MouseEvent('click', {{ bubbles: true, cancelable: true, view: window }}));")
                    lines.append(f"          return true;")
                    lines.append(f"        }}, '{_escape(js_xp)}');")
                    lines.append(f"        if (_okJs{step_num}) {{")
                    lines.append(f"          _clicked{step_num} = true;")
                    lines.append(f"          console.log('[{step_num}]   clicked via JS dispatchEvent');")
                    lines.append(f"        }}")
                    lines.append(f"      }} catch (_e_js{step_num}) {{ _dt{step_num} += ' | JS: failed'; }}")
                    lines.append(f"    }}")
                elif sel_type == 'fuzzy':
                    lines.append(f"    if (!_clicked{step_num}) {{")
                    lines.append(f"      try {{")
                    lines.append(f"        await page.evaluate((text) => {{")
                    lines.append(f"          const want = String(text || '').replace(/\\s+/g, ' ').trim();")
                    lines.append(f"          const candidates = [...document.querySelectorAll('{fuzzy_sel}')].filter(el => {{")
                    lines.append(f"            const st = getComputedStyle(el);")
                    lines.append(f"            const box = el.getBoundingClientRect();")
                    lines.append(f"            return st.display !== 'none' && st.visibility !== 'hidden' && box.width > 0 && box.height > 0;")
                    lines.append(f"          }});")
                    lines.append(f"          const exact = candidates.filter(el => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() === want);")
                    if kind == 'menu':
                        # Prefer el-menu-item / submenu title when multiple exact hits
                        lines.append(f"          const menuExact = exact.filter(el => el.matches && el.matches('.el-menu-item, .el-submenu__title'));")
                        lines.append(f"          const pool = menuExact.length ? menuExact : exact;")
                        lines.append(f"          const el = pool.length ? pool[0] : null;")
                    else:
                        lines.append(f"          const el = exact.length ? exact[exact.length - 1] : null;")
                    lines.append(f"          if (el) {{ el.scrollIntoView({{ block: 'center', behavior: 'instant' }}); el.click(); return 1; }}")
                    lines.append(f"          return 0;")
                    lines.append(f"        }}, '{_escape(txt)}').then(score => {{")
                    lines.append(f"          if (score > 0) {{ _clicked{step_num} = true; console.log('[{step_num}]   clicked via fuzzy exact-visible'); }}")
                    lines.append(f"        }});")
                    lines.append(f"      }} catch (_e_fz{step_num}) {{ _dt{step_num} += ' | fuzzy: failed'; }}")
                    lines.append(f"    }}")
            else:
                lines.append(f"    if (!_clicked{step_num}) {{")
                lines.append(f"      try {{")
                lines.append(f"        await {sel_expr}.click({{ timeout: 3000 }});")
                lines.append(f"        _clicked{step_num} = true;")
                lines.append(f"        console.log('[{step_num}]   clicked via {sel_type}');")
                lines.append(f"      }} catch (_e_{sel_type}{step_num}) {{ console.log('[{step_num}]   {sel_type} failed:', _e_{sel_type}{step_num}.message); _dt{step_num} += ' | {sel_type}: failed'; }}")
                lines.append(f"    }}")

        # If all fail
        lines.append(f"    if (!_clicked{step_num}) {{")
        lines.append(f"      _dt{step_num} += ' → page structure changed — re-locate element';")
        lines.append(f"      _recordError({step_num}, 'click_element_by_index', '{_escape_js_string(txt)}', '{_escape_js_string(xp or xp_full or '')}', 'needs-llm-fix', _dt{step_num});")
        lines.append(f"      throw new Error('[{step_num}] Click failed: target element not found on page. Stopping — subsequent steps depend on this navigation.');")
        lines.append(f"    }}")

        # Post-click smart wait: detect navigation, wait for page to stabilize
        lines.append(f"    // Post-click: check for page navigation")
        lines.append(f"    const _urlBefore{step_num} = page.url();")
        lines.append(f"    await page.evaluate(() => CTRL.waitForLoading());")
        lines.append(f"    let _navigated{step_num} = false;")
        lines.append(f"    try {{")
        lines.append(f"      await page.waitForFunction((before) => location.href !== before, _urlBefore{step_num}, {{ timeout: 3000 }});")
        lines.append(f"      _navigated{step_num} = true;")
        lines.append(f"    }} catch (_e_nav{step_num}) {{ /* no URL change — dialog or in-page action */ }}")
        lines.append(f"    if (_navigated{step_num}) {{")
        lines.append(f"      // Page navigated, wait for full load")
        lines.append(f"      await page.waitForLoadState('networkidle', {{ timeout: 15000 }}).catch(() => {{}});")
        lines.append(f"      await page.waitForSelector('.el-menu, .el-table, .el-form-item, .el-tabs, .el-dialog', {{ timeout: 10000 }}).catch(() => {{}});")
        lines.append(f"    }}")
        return '\n'.join(lines)

    # ---- switch_tab ----
    if action == 'switch_tab':
        n = p('tab_name')
        lines.append(f"    console.log('[{step_num}] Tab \"{n}\"');")
        lines.append(f"    await page.evaluate(() => CTRL.switchTab('{_escape(n)}'));")
        return '\n'.join(lines)

    # ---- close_dialog ----
    if action == 'close_dialog':
        lines.append(f"    console.log('[{step_num}] Close dialog');")
        lines.append('    await page.evaluate(() => CTRL.closeDialog());')
        return '\n'.join(lines)

    # ---- wait_for_loading ----
    if action == 'wait_for_loading':
        lines.append('    await page.evaluate(() => CTRL.waitForLoading());')
        return '\n'.join(lines)

    # ---- skip internal/exploratory actions ----
    if action in _SKIP_ACTIONS:
        return ''


    lines.append(f'    // skipped: {action}')
    return '\n'.join(lines)
