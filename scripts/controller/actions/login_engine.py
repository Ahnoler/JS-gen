"""LoginEngine — split from form_action_engines.py (S3)."""

import asyncio
import sys
import time

from scripts.state import _record_action
from ._helpers import _ok, _err, _is_ok_result, _wait_if_loading
from ._js_snippets import JS_CLICK_LOGIN_BUTTON, JS_FILL_FORM_FIELD
from .form_engine_base import _FormActionEngineBase
from .replay_timing import WAIT_3000_MS

async def _wait_for_login_form(page, timeout_s=20):
    """Pre-wait for the login page controls to mount (cold-start SPA fix).

    Polls for a visible username-ish input (`placeholder` containing 用户名/
    用户/账号) every 500ms, up to timeout_s. Returns True as soon as found,
    False on timeout. On False the caller proceeds unchanged — non-login-page
    calls (e.g. already-logged-in sessions) keep their existing behavior
    (label-not-found semantics); this probe only absorbs the cold-start
    mounting window. Never raises for probe failures.
    """
    js = (
        "() => { const u=[...document.querySelectorAll('input')].find("
        "i=>i.offsetParent!==null && ((i.placeholder||'').includes('用户名') "
        "|| (i.placeholder||'').includes('用户') || (i.placeholder||'').includes('账号')));"
        " return !!u; }"
    )
    try:
        deadline = time.monotonic() + float(timeout_s)
        while time.monotonic() < deadline:
            try:
                if await page.evaluate(js):
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.5)
    except Exception:
        return False
    return False


class LoginEngine(_FormActionEngineBase):
    async def login(self, username: str, password: str, captcha: str = '', sms_code: str = ''):
        page = await self.browser_context.get_current_page()
        await _wait_if_loading(page)

        # G5 orphan-Chrome reuse probe (already-logged-in session check). If a
        # _usertoken already exists and the hash shows '/home', the browser was
        # reused from a previous run: a matching user → reuse the session
        # directly (no page-state change); a different/unknown user → clear
        # localStorage and reload to reach a clean login form. Missing token →
        # original flow completely unchanged.
        try:
            _g5_sess = await page.evaluate(
                "() => ({ token: localStorage.getItem('_usertoken') || '',"
                " hash: location.hash || '',"
                " usr: localStorage.getItem('usrNo') || localStorage.getItem('usrno')"
                " || localStorage.getItem('username') || localStorage.getItem('userName')"
                " || localStorage.getItem('account') || '' })"
            )
        except Exception:
            _g5_sess = {}
        if (
            isinstance(_g5_sess, dict)
            and (_g5_sess.get('token') or '').strip()
            and '/home' in str(_g5_sess.get('hash') or '')
        ):
            _g5_user = str(_g5_sess.get('usr') or '').strip()
            if _g5_user and _g5_user == str(username or '').strip():
                return _ok(
                    'ok-login reuse | already-logged-in | user:' + _g5_user
                    + ' | hash:' + str(_g5_sess.get('hash') or ''),
                    include_in_memory=True,
                )
            try:
                await page.evaluate("() => { localStorage.clear(); }")
                await page.reload()
            except Exception:
                pass
            await _wait_for_login_form(page)

        # Cold-start pre-wait: absorb the SPA mounting window on a fresh
        # executor slot. If the login form never appears within the timeout
        # (e.g. non-login page / already-logged-in session), fall through
        # unchanged — original label-not-found semantics fully preserved.
        await _wait_for_login_form(page)

        results = []

        # Fill username (try common labels)
        u_r = await page.evaluate(JS_FILL_FORM_FIELD, ['用户名', username])
        if u_r == 'label-not-found':
            u_r = await page.evaluate(JS_FILL_FORM_FIELD, ['账号', username])
        results.append(f'user:{u_r}')

        # Fill password
        p_r = await page.evaluate(JS_FILL_FORM_FIELD, ['密码', password])
        results.append(f'pass:{p_r}')

        # Optionally fill captcha
        if captcha:
            c_r = await page.evaluate(JS_FILL_FORM_FIELD, ['验证码', captcha])
            if c_r == 'label-not-found':
                c_r = await page.evaluate(JS_FILL_FORM_FIELD, ['图形验证码', captcha])
            results.append(f'captcha:{c_r}')

        # Optionally fill SMS code
        if sms_code:
            s_r = await page.evaluate(JS_FILL_FORM_FIELD, ['短信验证码', sms_code])
            if s_r == 'label-not-found':
                s_r = await page.evaluate(JS_FILL_FORM_FIELD, ['手机验证码', sms_code])
            results.append(f'sms:{s_r}')

        # Click login button
        clicked = await page.evaluate(JS_CLICK_LOGIN_BUTTON)
        results.append(f'btn:{clicked}')

        summary = ' '.join(results)
        if (
            not _is_ok_result(str(u_r))
            or not _is_ok_result(str(p_r))
            or clicked != 'ok'
        ):
            return _err('err-login | ' + summary)

        await page.wait_for_timeout(WAIT_3000_MS)

        # Post-login probe: poll up to 10s (500ms interval) for a login-success
        # signature; re-click login once around the 4s mark to absorb observed
        # first-click nondeterminism. Success = ANY of:
        #   1. legacy credit-system signature: '#/home' hash or _usertoken in
        #      localStorage;
        #   2. any token-like key (token/usertoken/authorization/session…) with
        #      a non-empty value in localStorage or sessionStorage;
        #   3. left the login page: no visible password input AND no visible
        #      login/submit button remain (covers SPAs that land on a hash the
        #      first two checks don't know about).
        _LOGIN_PROBE_JS = """() => {
          if ((location.hash || '').includes('#/home')) return 'home';
          if (!!localStorage.getItem('_usertoken')) return 'token';
          const stores = [localStorage, sessionStorage];
          for (const s of stores) {
            for (let i = 0; i < s.length; i++) {
              const k = (s.key(i) || '').toLowerCase();
              if (/(token|authorization|session|jwt|loginsession)/.test(k) && (s.getItem(s.key(i)) || '').trim()) return 'token';
            }
          }
          const visible = (el) => {
            if (!el) return false;
            const st = getComputedStyle(el);
            return st.display !== 'none' && st.visibility !== 'hidden' && el.offsetParent !== null;
          };
          const pwd = [...document.querySelectorAll('input[type=password]')].some(visible);
          const btn = [...document.querySelectorAll('button, .el-button, input[type=submit], [class*=login]')].find((b) => visible(b) && /登录|登陆|login|sign ?in/i.test((b.textContent || b.value || '')));
          if (!pwd && !btn) return 'left-login';
          return '';
        }"""

        async def _login_probe_sig():
            try:
                return str(await page.evaluate(_LOGIN_PROBE_JS) or '')
            except Exception:
                return ''

        import time as _time
        _probe_start = _time.monotonic()
        _probe_deadline = _probe_start + 10.0
        _reclicked = False
        probe_sig = await _login_probe_sig()
        while not probe_sig and _time.monotonic() < _probe_deadline:
            if not _reclicked and _time.monotonic() - _probe_start >= 4.0:
                try:
                    await page.evaluate(JS_CLICK_LOGIN_BUTTON)
                except Exception:
                    pass
                _reclicked = True
            await page.wait_for_timeout(500)
            probe_sig = await _login_probe_sig()

        if not probe_sig:
            return _err('err-login | probe-timeout | ' + summary)

        _record_action(
            'login',
            {'username': username, 'password': password, 'captcha': captcha, 'sms_code': sms_code},
            'ok-login',
        )
        return _ok('ok-login | ' + summary + ' | probe:' + probe_sig, include_in_memory=True)

