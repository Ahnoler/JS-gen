"""
Helper functions used by controller action implementations.

Includes browser interaction utilities (_wait_if_loading, _capture_element),
ARIA snapshot merging (_merge_ax_text), and ActionResult wrappers (_ok, _err).
"""

import json
import re

from browser_use.agent.views import ActionResult

from ._js_snippets import (
    JS_CHECK_LOADING, JS_WAIT_LOADING,
    JS_SMART_LOCATOR,
)
from ..models import ScannedField


def _ok(msg):
    """Wrap a success string in ActionResult with is_done=False."""
    return ActionResult(extracted_content=str(msg), is_done=False)


def _err(msg):
    """Wrap an error string in ActionResult."""
    return ActionResult(extracted_content=str(msg), is_done=False, success=False)


async def dismiss_https_first_interstitial(page) -> str:
    """
    Dismiss Chromium HTTPS-First / 'Always use secure connections' interstitial.

    UI copy (zh): 「此网站不支持安全连接」 + button 「继续访问网站」.
    Also handles classic SSL interstitial proceed links.
    Returns: 'none' | 'proceeded' | 'proceeded-advanced' | error string.
    """
    try:
        result = await page.evaluate('''() => {
          const bodyText = (document.body && document.body.innerText) || '';
          const isHttpsFirst =
            bodyText.includes('此网站不支持安全连接')
            || bodyText.includes('does not support a secure connection')
            || bodyText.includes('Your connection is not private')
            || bodyText.includes('您的连接不是私密连接');
          const url = location.href || '';
          const isChromeError =
            url.includes('chrome-error')
            || url.includes('chromewebdata')
            || url.startsWith('chrome://');

          if (!isHttpsFirst && !isChromeError) {
            // Still try exact proceed button if present (some builds keep http URL)
            const exact = [...document.querySelectorAll('button, a')].find(el => {
              const t = (el.textContent || '').trim();
              return t === '继续访问网站' || t === 'Continue to site' || t === 'Proceed to site';
            });
            if (!exact) return 'none';
          }

          const clickIf = (el) => { if (el) { el.click(); return true; } return false; };

          // Prefer the explicit proceed CTA
          const proceed =
            [...document.querySelectorAll('button, a')].find(el => {
              const t = (el.textContent || '').trim();
              return t === '继续访问网站'
                || t === 'Continue to site'
                || t === 'Proceed to site'
                || /^继续访问/.test(t)
                || /Continue to .+ site/i.test(t);
            })
            || document.getElementById('proceed-button')
            || document.getElementById('proceed-link');

          if (clickIf(proceed)) return 'proceeded';

          // Classic cert interstitial: Advanced → Proceed
          const adv = document.getElementById('details-button')
            || [...document.querySelectorAll('button, a')].find(el =>
                /高级|详情|Advanced|Details/i.test((el.textContent || '').trim()));
          if (adv) adv.click();
          const go = document.getElementById('proceed-link')
            || document.getElementById('proceed-button')
            || [...document.querySelectorAll('a, button')].find(el =>
                /继续前往|继续|Proceed|unsafe/i.test(el.textContent || '')
                || (el.href || '').includes('proceed'));
          if (clickIf(go)) return 'proceeded-advanced';
          return isHttpsFirst || isChromeError ? 'no-proceed' : 'none';
        }''')
        if result and str(result).startswith('proceeded'):
            await page.wait_for_timeout(800)
        return str(result or 'none')
    except Exception as e:
        return f'error:{e}'


async def _wait_if_loading(page):
    # HTTP sites may show HTTPS-First interstitial mid-navigation — clear before waiting.
    await dismiss_https_first_interstitial(page)
    loading = await page.evaluate(JS_CHECK_LOADING)
    if loading:
        await page.evaluate(JS_WAIT_LOADING)
    await dismiss_https_first_interstitial(page)


async def _capture_element(page, label_text):
    """Capture element info for a labeled form field."""
    result = {}
    try:
        raw = await page.evaluate(JS_SMART_LOCATOR, [label_text])
        if raw:
            info = json.loads(raw) if isinstance(raw, str) else raw
            if info.get('xpath'):
                result['xpath'] = info['xpath']
                result['css_selector'] = info.get('css_sel', '')
                result['tag_name'] = info.get('tag', 'input')
                result['attributes'] = info.get('attrs', {})
    except Exception:
        pass
    return result if result else None


def _merge_ax_text(dom_fields: list[ScannedField], snapshot_text: str) -> None:
    """Parse aria_snapshot(mode='ai') text and merge AX values into DOM fields.

    Handles both textbox (with value) and combobox (with selected option).
    Mutates the ScannedField objects in-place.
    """
    if not snapshot_text:
        return
    # Collect AX entries: label → {value, disabled}
    ax_map: dict[str, dict] = {}
    _AX_LINE_RE = re.compile(
        r'(textbox|combobox|spinbutton|searchbox)\s+"([^"]+)"\s*'
        r'(?P<attrs>\[(?!ref=)[^\]]*\])*\s*\[ref=[^\]]+\]'
        r'(?::\s*["\']?(?P<value>[^\n]*?)(?:"\']?)?)?'
        r'$'
    )
    for line in snapshot_text.splitlines():
        m = _AX_LINE_RE.search(line)
        if not m:
            continue
        role = m.group(1)
        name = m.group(2).strip()
        attrs = m.group('attrs') or ''
        value = (m.group('value') or '').strip().strip('"').strip("'")
        disabled = '[disabled]' in attrs

        ax_map[name] = {'value': value, 'disabled': disabled, 'role': role}

    # Also capture option "[selected]" lines (format: option "{name}" [selected])
    _OPTION_RE = re.compile(r'option\s+"([^"]+)"\s*\[selected\]')
    # Attach selected options to their combobox parents by scanning previous lines
    prev_combobox: str | None = None
    for line in snapshot_text.splitlines():
        cm = _AX_LINE_RE.search(line)
        if cm and cm.group(1) in ('combobox', 'listbox'):
            prev_combobox = cm.group(2).strip()
        om = _OPTION_RE.search(line)
        if om and prev_combobox:
            selected = om.group(1).strip()
            if prev_combobox in ax_map:
                ax_map[prev_combobox]['value'] = selected
                ax_map[prev_combobox]['selected_text'] = selected

    # Merge AX data into ScannedField objects
    for f in dom_fields:
        label = (f.label or '').strip()
        if not label:
            continue
        ax = ax_map.get(label)
        if not ax:
            # Partial match: find AX entry whose name contains or is contained by field label
            for ax_name, ax_data in ax_map.items():
                if ax_name in label or label in ax_name:
                    ax = ax_data
                    break
        if not ax:
            continue
        # Update currentValue from AX if DOM value was empty
        if not (f.currentValue or '').strip() and ax['value']:
            f.currentValue = ax['value']
        # AX disabled flag
        if ax.get('disabled') and not f.disabled:
            f.disabled = True
        # AX role → kind mapping (only override if kind is unknown)
        if f.kind in ('unknown',):
            if ax['role'] in ('combobox', 'listbox'):
                f.kind = 'select'
            elif ax['role'] in ('textbox', 'spinbutton', 'searchbox'):
                f.kind = 'input'
