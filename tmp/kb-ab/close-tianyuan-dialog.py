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


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(CDP)
        target = None
        for ctx in browser.contexts:
            for pg in ctx.pages:
                if "cstMgt" in (pg_hash := pg.url) if False else "cstMgt" in pg.url or True:
                    pass
        # pick the page whose URL/hash mentions cstMgt; else first non-blank page
        pages = [pg for ctx in browser.contexts for pg in ctx.pages]
        pick = None
        for pg in pages:
            if "cstMgt" in pg.url:
                pick = pg
                break
        if pick is None:
            for pg in pages:
                if pg.url and not pg.url.startswith("about:"):
                    pick = pg
                    break
        if pick is None:
            print(json.dumps({"ok": False, "error": "no page found", "urls": [pg.url for pg in pages]}))
            return 2
        print("page:", pick.url[:120])

        st = await pick.evaluate(JS_STATE)
        print("before:", json.dumps(st, ensure_ascii=False))
        ty = st.get("tianyuan")
        if not ty or not ty.get("visible"):
            print(json.dumps({"ok": True, "action": "none-needed", "before": st}, ensure_ascii=False))
            return 0

        clicked = await pick.evaluate(JS_CLICK_OK)
        print("click-target:", clicked)
        if clicked in ("no-button", "no-dialog"):
            print(json.dumps({"ok": False, "error": clicked}, ensure_ascii=False))
            return 3
        pt = json.loads(clicked)
        # REAL mousedown sequence at button center (trusted-event path)
        await pick.mouse.move(pt["x"], pt["y"])
        await pick.mouse.down()
        await pick.mouse.up()
        await asyncio.sleep(1.5)

        st2 = await pick.evaluate(JS_STATE)
        print("after:", json.dumps(st2, ensure_ascii=False))
        ty2 = st2.get("tianyuan")
        closed = not ty2 or not ty2.get("visible")
        print(json.dumps({"ok": closed, "clicked": pt, "after": st2}, ensure_ascii=False))
        return 0 if closed else 4


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
