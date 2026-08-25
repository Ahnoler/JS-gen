"""
CDP quick diagnostics — connect to the Agent's Chrome and inspect page state.

Usage:
  python -m scripts.cdp.connect           # quick DOM snapshot
  python -m scripts.cdp.connect --scan    # full scan + pending report
  python -m scripts.cdp.connect --monitor # same as default

Port defaults to 9242 (browser_use's default). Override with --port.
"""
import asyncio, json, sys, io, os
from playwright.async_api import async_playwright

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


async def report_page_state(browser):
    """Print a summary of open pages."""
    for i, ctx in enumerate(browser.contexts):
        for j, pg in enumerate(ctx.pages):
            url = pg.url
            if 'devtools' in url:
                continue
            title = await pg.title()
            print(f'  [{i}.{j}] {title[:60]}')
            print(f'        {url[:120]}')


async def scan_pending(browser):
    """Run scan_form_fields + get_pending_tasks on the agent's browser."""
    sys.path.insert(0, '.')
    from scripts.controller.service import build_controller

    ctx = browser.contexts[0]

    async def get_page():
        for pg in ctx.pages:
            u = pg.url
            if u.startswith('http') and 'devtools' not in u:
                return pg
        return ctx.pages[-1] if ctx.pages else None
    ctx.get_current_page = get_page

    business_data = {}
    ctrl = build_controller(ctx, business_data_store=business_data)
    actions = ctrl.registry.registry.actions

    sf = actions.get('scan_form_fields')
    gpt = actions.get('get_pending_tasks')
    if not sf or not gpt:
        print('ERROR: actions not found')
        return

    print('=== scan_form_fields (scan only, no auto-fill) ===')
    result = await sf.function()
    print(str(result)[:500])

    print()
    print('=== get_pending_tasks ===')
    result = await gpt.function()
    data = json.loads(result)
    pending = data.get('pending', [])
    done = data.get('done', [])
    intervene = data.get('NEEDS_INTERVENTION', [])
    print(f'pending: {len(pending)}')
    for item in pending:
        print(f'  "{item["label"]}" kind={item["kind"]}')
    print(f'done: {len(done)}')
    for d in done:
        print(f'  "{d}"')
    if intervene:
        print(f'NEEDS_INTERVENTION: {intervene}')


async def quick_snapshot(browser):
    """Quick DOM scan — count filled/empty/disabled fields."""
    import json as _json
    try:
        from scripts.controller.actions.form_rules import get_has_button_keywords
    except ImportError:
        from scripts.controller.actions.form_rules import get_has_button_keywords
    has_btn_kw_json = _json.dumps(get_has_button_keywords(), ensure_ascii=False)

    for pg in browser.contexts[0].pages:
        url = pg.url
        if 'devtools' in url or not url.startswith('http'):
            continue
        r = await pg.evaluate('''() => {
            const readValue = (inputEl, trigger, item) => {
                let v = inputEl?.value || trigger?.value || "";
                if (!v) {
                    for (const inp of item.querySelectorAll("input:not([type=hidden])")) {
                        if (inp.value && inp.value.trim()) { v = inp.value.trim(); break; }
                    }
                }
                if (!v) {
                    const ta = item.querySelector("textarea");
                    if (ta) v = ta.value || "";
                }
                if (!v && trigger) v = trigger.getAttribute("aria-label") || trigger.getAttribute("title") || "";
                return v;
            };
            const items = document.querySelectorAll(".el-form-item");
            const result = {total:0, filled:0, pending:0, needsIntervention:0, filtered:0,
                            pendingList:[], interventionList:[]};
            for (const item of items) {
                const label = (item.querySelector(".el-form-item__label")?.textContent || "").trim();
                if (!label) continue;
                result.total++;
                const input = item.querySelector("input:not([type=hidden])");
                const textarea = item.querySelector("textarea");
                const trigger = item.querySelector(".el-select .el-input__inner");
                const inputEl = input || textarea;
                const val = readValue(inputEl, trigger, item);
                const isDisabled = !!(inputEl?.disabled || inputEl?.readOnly || item.querySelector(".el-input.is-disabled"));
                const isRequired = !!(item.classList.contains("is-required") || item.querySelector(".is-required") || /\\*/.test(label));
                const hasBtn = (() => {
                    for (const b of item.querySelectorAll("button")) {
                        const t = b.textContent.trim();
                        if (''' + has_btn_kw_json + '''.some(k => t.includes(k))) return t;
                    }
                    return "";
                })();
                if (val) { result.filled++; continue; }
                if (isDisabled && !hasBtn) { result.filtered++; continue; }
                if (isDisabled && !isRequired) { result.filtered++; continue; }
                if (isDisabled && hasBtn) { result.needsIntervention++; result.interventionList.push(label); continue; }
                result.pending++;
                result.pendingList.push(label);
            }
            return JSON.stringify(result);
        }''')
        data = json.loads(r)
        print(f'Total: {data["total"]} | Filled: {data["filled"]} | Pending: {data["pending"]} | NeedsIntervention: {data["needsIntervention"]} | Filtered: {data["filtered"]}')
        if data.get('pendingList'):
            print('Pending:', ', '.join(data['pendingList']))
        if data.get('interventionList'):
            print('NeedsIntervention:', ', '.join(data['interventionList']))
        break


async def main():
    import argparse
    parser = argparse.ArgumentParser(description='CDP connect to Python agent browser')
    parser.add_argument('--scan', action='store_true', help='Run scan_form_fields + get_pending_tasks')
    parser.add_argument('--monitor', action='store_true', help='Quick DOM snapshot')
    parser.add_argument('--port', type=int, default=9242, help='CDP port (default 9242)')
    args = parser.parse_args()

    cdp_url = f'http://127.0.0.1:{args.port}'
    print(f'Connecting to {cdp_url}...')
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.connect_over_cdp(cdp_url)
            print(f'Connected: {browser.version}')
            print()
            await report_page_state(browser)
            print()

            if args.scan:
                os.environ.setdefault('OPENAI_API_KEY', os.environ.get('FORM_LLM_API_KEY', ''))
                os.environ.setdefault('FORM_LLM_MODEL', 'Qwen/Qwen3.5-35B-A3B')
                os.environ.setdefault('FORM_LLM_BASE_URL', 'http://218.77.58.156:3000/v1')
                await scan_pending(browser)
            elif args.monitor:
                await quick_snapshot(browser)
            else:
                await quick_snapshot(browser)
    except Exception as e:
        print(f'Failed to connect: {e}')
        print('Is the Agent running? Try: python -m scripts.cdp.watcher')


if __name__ == '__main__':
    asyncio.run(main())
