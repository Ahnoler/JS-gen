"""Browser launch factory for the session runner (reliable CDP endpoint).

Extracted verbatim from scripts/session_runner.py.
"""
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

from browser_use import Browser

from ..cdp_ports import _pick_free_cdp_port


async def _resolve_chromium_executable() -> str | None:
    """Playwright-bundled Chromium path (used with browser_binary_path for reliable CDP)."""
    try:
        from playwright.async_api import async_playwright
        pw = await async_playwright().start()
        try:
            exe = pw.chromium.executable_path
            return str(exe) if exe else None
        finally:
            await pw.stop()
    except Exception as e:
        sys.stderr.write(f'[session] WARN: cannot resolve Playwright Chromium: {e}\n')
        sys.stderr.flush()
        return None


def _chrome_headless_enabled() -> bool:
    """CHROME_HEADLESS=1|true|yes|on — no OS window; BiB uses CDP screencast only."""
    raw = (os.environ.get('CHROME_HEADLESS') or '').strip().lower()
    return raw in ('1', 'true', 'yes', 'on')


def _chrome_automation_args() -> list[str]:
    """Flags that suppress Chrome chrome UI prompts agents cannot click."""
    # NOT incognito — Incognito enables stricter HTTPS-First by default.
    headless = _chrome_headless_enabled()
    args = [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-extensions',
        '--disable-component-update',
        '--disable-background-networking',
        '--disable-client-side-phishing-detection',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-infobars',
        '--hide-crash-restore-bubble',
        '--disable-session-crashed-bubble',
        '--password-store=basic',
        '--use-mock-keychain',
        '--metrics-recording-only',
        '--no-service-autorun',
        # Match BiB default viewport (1600×900); do not start maximized.
        '--window-size=1600,900',
        '--window-position=0,0',
        # Cert / mixed content
        '--ignore-certificate-errors',
        '--ignore-certificate-errors-spki-list',
        '--ignore-ssl-errors',
        '--allow-insecure-localhost',
        '--allow-running-insecure-content',
        # Plain HTTP sites (e.g. http://test.creditv5p2…) hit HTTPS-First interstitial:
        # 「此网站不支持安全连接」→「继续访问网站」. Disable the feature family entirely.
        (
            '--disable-features='
            'TranslateUI,ChromeWhatsNewUI,PrivacySandboxSettings4,'
            'HttpsUpgrades,'
            'HttpsFirstModeV2,'
            'HttpsFirstModeV2ForTypicallySecureUsers,'
            'HttpsFirstModeV2ForEngagedSites,'
            'HttpsFirstBalancedMode,'
            'HttpsFirstBalancedModeAutoEnable,'
            'HttpsFirstModeIncognito,'
            'HttpsFirstDialogUi,'
            'BlockInsecurePrivateNetworkRequests'
        ),
    ]
    if headless:
        # New headless: full compositor + screencast; avoids minimize/occlusion throttling.
        args.append('--headless=new')
    # Linux root (typical cloud executor): Chrome exits immediately without these.
    if sys.platform != 'win32' and hasattr(os, 'geteuid') and os.geteuid() == 0:
        args.extend(['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'])
    return args


def _seed_chrome_profile(profile_dir: Path) -> None:
    """Clean exit + explicitly disable HTTPS-First / Always Use Secure Connections prefs."""
    try:
        default_dir = profile_dir / 'Default'
        default_dir.mkdir(parents=True, exist_ok=True)
        prefs_path = default_dir / 'Preferences'
        prefs = {}
        if prefs_path.exists():
            try:
                prefs = json.loads(prefs_path.read_text(encoding='utf-8'))
            except Exception:
                prefs = {}
        profile = prefs.setdefault('profile', {})
        profile['exit_type'] = 'Normal'
        profile['exited_cleanly'] = True

        # Chromium pref names (chrome/common/pref_names.h) — flat booleans, not nested.
        # Setting these BEFORE first launch prevents auto-enable heuristics on fresh profiles.
        prefs['https_only_mode_enabled'] = False
        prefs['https_first_balanced_mode_enabled'] = False
        prefs['https_first_mode_incognito_enabled'] = False
        prefs['https_only_mode_auto_enabled'] = False
        prefs.setdefault('ssl', {})['rev_checking'] = {'enabled': False}

        prefs_path.write_text(json.dumps(prefs), encoding='utf-8')

        local_state_path = profile_dir / 'Local State'
        local_state = {}
        if local_state_path.exists():
            try:
                local_state = json.loads(local_state_path.read_text(encoding='utf-8'))
            except Exception:
                local_state = {}
        local_state.setdefault('profile', {})['exited_cleanly'] = True
        local_state_path.write_text(json.dumps(local_state), encoding='utf-8')
    except Exception as e:
        sys.stderr.write(f'[session] WARN: seed chrome profile failed: {e}\n')
        sys.stderr.flush()


async def _ignore_certificate_errors(browser_context) -> None:
    """CDP-level cert bypass (covers pages opened after launch)."""
    try:
        page = await browser_context.get_current_page()
        session = await browser_context.get_session()
        cdp = await session.context.new_cdp_session(page)
        try:
            await cdp.send('Security.enable')
            await cdp.send('Security.setIgnoreCertificateErrors', {'ignore': True})
            sys.stderr.write('[session] CDP Security.setIgnoreCertificateErrors=true\n')
            sys.stderr.flush()
        finally:
            await cdp.detach()
    except Exception as e:
        sys.stderr.write(f'[session] WARN: ignore certificate errors failed: {e}\n')
        sys.stderr.flush()


async def _bypass_ssl_interstitial_if_any(browser_context) -> None:
    """Click 「继续访问网站」 on HTTPS-First / SSL interstitial if present."""
    try:
        from ..controller.actions._helpers import dismiss_https_first_interstitial
        page = await browser_context.get_current_page()
        result = await dismiss_https_first_interstitial(page)
        if result and result != 'none':
            sys.stderr.write(f'[session] HTTPS-First interstitial bypass: {result} url={page.url}\n')
            sys.stderr.flush()
    except Exception as e:
        sys.stderr.write(f'[session] WARN: SSL interstitial bypass failed: {e}\n')
        sys.stderr.flush()


def _session_window_size() -> tuple[int, int]:
    """OS window size aligned with BiB default viewport (not full screen)."""
    return 1600, 900


async def _fit_browser_window(browser_context, width: int = 1600, height: int = 900) -> None:
    """
    Keep a normal (non-maximized) window at the BiB viewport size.
    browser_use _resize_window may change bounds; re-assert after init.
    """
    try:
        page = await browser_context.get_current_page()
        session = await browser_context.get_session()
        cdp = await session.context.new_cdp_session(page)
        try:
            win = await cdp.send('Browser.getWindowForTarget')
            window_id = win.get('windowId')
            if window_id is None:
                return
            # Chrome UI chrome ≈ +16 / +88 vs content viewport
            await cdp.send(
                'Browser.setWindowBounds',
                {
                    'windowId': window_id,
                    'bounds': {
                        'width': int(width) + 16,
                        'height': int(height) + 88,
                        'windowState': 'normal',
                    },
                },
            )
            sys.stderr.write(f'[session] Browser window fitted {width}x{height} (normal)\n')
            sys.stderr.flush()
        finally:
            await cdp.detach()
    except Exception as e:
        sys.stderr.write(f'[session] WARN: fit window failed: {e}\n')
        sys.stderr.flush()


async def _dismiss_native_js_dialogs(browser_context) -> None:
    """Auto-accept in-page alert/confirm/prompt — agents struggle with modal JS dialogs."""
    try:
        page = await browser_context.get_current_page()

        async def _on_dialog(dialog):
            try:
                sys.stderr.write(f'[session] Auto-accept JS dialog: {dialog.type} {dialog.message[:80]!r}\n')
                sys.stderr.flush()
                await dialog.accept()
            except Exception:
                pass

        page.on('dialog', lambda d: asyncio.create_task(_on_dialog(d)))
    except Exception as e:
        sys.stderr.write(f'[session] WARN: dialog handler setup failed: {e}\n')
        sys.stderr.flush()


async def _build_browser(cdp_url=None, cdp_port=None, session_id='unknown'):
    """
    Launch browser with a *reliable* CDP HTTP endpoint for BiB.

    browser_use's builtin Playwright launch path silently strips
    --remote-debugging-port when the port appears busy. The user-provided
    binary path launches Chrome itself and waits for /json/version — that
    is what we need for BibBridge.
    """
    from browser_use.browser.browser import BrowserConfig

    if cdp_url:
        sys.stderr.write(f"[session] Connecting to existing browser via CDP: {cdp_url}\n")
        sys.stderr.flush()
        return Browser(config=BrowserConfig(cdp_url=cdp_url)), None, True

    preferred = int(cdp_port) if cdp_port else 9242
    port = _pick_free_cdp_port(preferred)
    if port != preferred:
        sys.stderr.write(f"[session] CDP port {preferred} busy — using free port {port}\n")
        sys.stderr.flush()

    exe = await _resolve_chromium_executable()
    profile_dir = Path(tempfile.gettempdir()) / 'jsgen-chrome-profiles' / str(session_id)
    profile_dir.mkdir(parents=True, exist_ok=True)
    _seed_chrome_profile(profile_dir)

    headless = _chrome_headless_enabled()
    extra_args = [
        f'--user-data-dir={profile_dir.resolve()}',
        *_chrome_automation_args(),
    ]

    if exe:
        sys.stderr.write(
            f"[session] Launching Chromium via browser_binary_path for CDP "
            f"port={port} exe={exe} headless={headless}\n"
        )
        sys.stderr.flush()
        browser = Browser(config=BrowserConfig(
            browser_binary_path=exe,
            chrome_remote_debugging_port=port,
            headless=headless,
            disable_security=True,  # ignore cert / CORS blockers for internal systems
            extra_browser_args=extra_args,
        ))
        return browser, port, None  # cdp_ready unknown until after new_context

    # Fallback: builtin launch (may drop CDP port — BiB may be unavailable)
    sys.stderr.write(
        f"[session] WARN: no Chromium exe — fallback builtin launch "
        f"port={port} headless={headless}\n"
    )
    sys.stderr.flush()
    browser = Browser(config=BrowserConfig(
        chrome_remote_debugging_port=port,
        headless=headless,
        disable_security=True,
        extra_browser_args=extra_args,
    ))
    return browser, port, None
