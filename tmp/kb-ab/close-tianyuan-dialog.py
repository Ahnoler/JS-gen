"""
KB A/B line: environment prep — close the leftover '天元相关配置' global dialog
on the live SUT Chrome (CDP 19242) before record/start.

Why: page-bind's read_page_component_code exited empty-config on this page and
its synthetic footer click (closeTianyuanDialogs) did not dismiss the dialog;
the recording agent then pauses per global-dialog guard (zero actions ->
missing_success_token -> traj failed, see traj 723 A-arm R02 pilot).

Precedent: JS_FIND_MENU_DISMISS_POINT (80df9d5) proved synthetic el.click()
cannot dismiss certain SUT surfaces; a REAL mousedown is required. This script
does exactly one guarded interaction: locate the 天元 dialog, real-mousedown its
footer primary button, verify closure. Read-only otherwise. Applies equally to
both A/B arms (no bias; task/description text untouched).
"""
import asyncio
import json
import sys

from playwright.async_api import async_playwright

CDP = "http://127.0.0.1:19242"
# slot-specific CDP ports (9242+slotIndex family, seen live: 19242/19246...).
# The runner may not know which slot a trajectory got, so probe a range.
CDP_CANDIDATES = [f"http://127.0.0.1:{p}" for p in (19242, 19243, 19244, 19245, 19246, 19247, 19248, 19249, 19250)]

JS_STATE = """() => {
    const out = { dialogs: [], any: false };
    for (const d of document.querySelectorAll('.el-dialog')) {
        const wrap = d.closest('.el-dialog__wrapper') || d.parentElement;
        const title = (d.querySelector('.el-dialog__title') || {}).textContent || '';
        const cs = getComputedStyle(d);
        const wcs = wrap ? getComputedStyle(wrap) : cs;
        const visible = cs.display !== 'none' && cs.visibility !== 'hidden'
            && wcs.display !== 'none' && wcs.visibility !== 'hidden';
        if (title.indexOf('天元') !== -1) {
            out.tianyuan = { title: title.trim(), visible, text: (d.textContent || '').slice(0, 120) };
        }
        if (visible) out.any = true;
        out.dialogs.push({ title: title.trim(), visible });
    }
    return out;
}"""

JS_CLICK_OK = """() => {
    for (const d of document.querySelectorAll('.el-dialog')) {
        const title = (d.querySelector('.el-dialog__title') || {}).textContent || '';
        if (title.indexOf('天元相关配置') === -1) continue;
        const wrap = d.closest('.el-dialog__wrapper') || d.parentElement;
        const cs = getComputedStyle(d);
        const wcs = wrap ? getComputedStyle(wrap) : cs;
        if (cs.display === 'none' || wcs.display === 'none') continue;
        const btn = d.querySelector('.el-dialog__footer button') || d.querySelector('button');
        if (!btn) return 'no-button';
        const r = btn.getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (btn.textContent || '').trim() });
    }
    return 'no-dialog';
}"""


async def close_on(cdp_url):
    """Probe one CDP endpoint; close the tianyuan dialog if visible. Returns (status, detail)."""
    async with async_playwright() as p:
        try:
            browser = await p.chromium.connect_over_cdp(cdp_url, timeout=5000)
        except Exception as e:
            return "unreachable", str(e)[:80]
        try:
            pages = [pg for ctx in browser.contexts for pg in ctx.pages]
            pick = None
            for pg in pages:
                if pg.url and not pg.url.startswith(("about:", "devtools:", "chrome://")):
                    pick = pg
                    break
            if pick is None:
                return "no-page", [pg.url for pg in pages]
            st = await pick.evaluate(JS_STATE)
            ty = st.get("tianyuan")
            if not ty or not ty.get("visible"):
                return "none-needed", {"url": pick.url[:100], "any": st.get("any")}
            clicked = await pick.evaluate(JS_CLICK_OK)
            if clicked in ("no-button", "no-dialog"):
                return "error", clicked
            pt = json.loads(clicked)
            await pick.mouse.move(pt["x"], pt["y"])
            await pick.mouse.down()
            await pick.mouse.up()
            await asyncio.sleep(1.5)
            st2 = await pick.evaluate(JS_STATE)
            ty2 = st2.get("tianyuan")
            closed = not ty2 or not ty2.get("visible")
            return ("closed" if closed else "still-open"), {"url": pick.url[:100], "clicked": pt}
        finally:
            try:
                await browser.close()
            except Exception:
                pass


async def main():
    results = []
    any_closed = False
    any_open_fail = False
    for url in CDP_CANDIDATES:
        status, detail = await close_on(url)
        if status == "unreachable":
            continue
        results.append({"cdp": url, "status": status, "detail": detail})
        print(f"[{url}] {status}: {json.dumps(detail, ensure_ascii=False)[:160]}")
        if status in ("closed", "none-needed"):
            any_closed = True
        elif status in ("still-open", "error", "no-page"):
            any_open_fail = True
    if not results:
        print(json.dumps({"ok": False, "error": "no CDP endpoint reachable", "tried": CDP_CANDIDATES}))
        return 5
    print(json.dumps({"ok": any_closed and not any_open_fail, "results": results}, ensure_ascii=False))
    return 0 if (any_closed and not any_open_fail) else 4


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
