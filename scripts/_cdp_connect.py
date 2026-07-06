"""Connect to the project's Python agent browser via CDP.

Usage:
  python scripts/_cdp_connect.py          # auto-find browser port, report state
  python scripts/_cdp_connect.py --scan   # full scan_form_fields + pending report
  python scripts/_cdp_connect.py --monitor # live page snapshot

How it works:
  1. Find the Python process running session_runner.py
  2. Find its Chrome child process (Playwright's Chromium for Testing)
  3. Extract --remote-debugging-port from Chrome's command line
  4. Connect via Playwright CDP
"""

import subprocess, re, asyncio, json, sys, io, os
from playwright.async_api import async_playwright

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def find_cdp_port():
    """Find CDP port of the Chrome launched by Python session_runner.

    Returns (port, pid) or raises RuntimeError.
    """
    cmd = [
        'powershell.exe', '-Command',
        "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'python.exe' } | "
        "Select-Object ProcessId, CommandLine | Format-List"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    python_pids = []
    for match in re.finditer(r'ProcessId\s*:\s*(\d+)', result.stdout):
        pid = int(match.group(1))
        python_pids.append(pid)

    if not python_pids:
        raise RuntimeError('No Python process found')

    # Find Chrome child processes of each Python process
    for ppid in python_pids:
        cmd2 = [
            'powershell.exe', '-Command',
            f'Get-WmiObject Win32_Process | Where-Object {{ $_.ParentProcessId -eq {ppid} -and $_.Name -eq "node.exe" }} | '
            'Select-Object ProcessId | Format-List'
        ]
        result2 = subprocess.run(cmd2, capture_output=True, text=True, timeout=10)
        node_pids = [int(m.group(1)) for m in re.finditer(r'ProcessId\s*:\s*(\d+)', result2.stdout)]
        if not node_pids:
            continue  # Not the right Python process

        # Find Chrome launched by this node (Playwright driver)
        for npid in node_pids:
            cmd3 = [
                'powershell.exe', '-Command',
                f"Get-WmiObject Win32_Process | Where-Object {{ $_.ParentProcessId -eq {npid} -and $_.Name -eq 'chrome.exe' }} | "
                'Select-Object ProcessId, CommandLine | Format-List'
            ]
            result3 = subprocess.run(cmd3, capture_output=True, text=True, timeout=10)
            match = re.search(r'--remote-debugging-port=(\d+)', result3.stdout)
            if match:
                port = int(match.group(1))
                chrome_pid_match = re.search(r'ProcessId\s*:\s*(\d+)', result3.stdout)
                chrome_pid = int(chrome_pid_match.group(1)) if chrome_pid_match else None
                return port, chrome_pid

    raise RuntimeError('Could not find CDP port. Is the Python agent running?')


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
    from scripts.form_rules import load_rules
    from scripts.actions._builder import build_controller

    rules = load_rules()
    ctx = browser.contexts[0]

    async def get_page():
        for pg in ctx.pages:
            u = pg.url
            if u.startswith('http') and 'devtools' not in u:
                return pg
        return ctx.pages[-1] if ctx.pages else None
    ctx.get_current_page = get_page

    case_data = {}
    ctrl = build_controller(ctx, rules, case_data_store=case_data)
    actions = ctrl.registry.registry.actions

    sf = actions.get('scan_form_fields')
    gpt = actions.get('get_pending_tasks')
    if not sf or not gpt:
        print('ERROR: actions not found')
        return

    print('=== scan_form_fields (auto-fill + LLM) ===')
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
    from .form_rules import get_has_button_keywords
    import json as _json
    has_btn_kw_json = _json.dumps(get_has_button_keywords(), ensure_ascii=False)

    for pg in browser.contexts[0].pages:
        url = pg.url
        if 'devtools' in url or not url.startswith('http'):
            continue
        r = await pg.evaluate('''() => {
            // Unified readValue — same logic as JS_READ_CURRENT_VALUE in _js_snippets.py
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
                // Same filter as TaskItem.from_scanned:
                // 1. has value → filled
                if (val) { result.filled++; continue; }
                // 2. disabled without button → truly unfillable → filter
                if (isDisabled && !hasBtn) { result.filtered++; continue; }
                // 3. disabled + not required → optional read-only → filter
                if (isDisabled && !isRequired) { result.filtered++; continue; }
                // 4. disabled + hasBtn + required → needs intervention
                if (isDisabled && hasBtn) { result.needsIntervention++; result.interventionList.push(label); continue; }
                // 5. empty + enabled → pending (need filling)
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
    args = parser.parse_args()

    print('Finding CDP port...')
    port, chrome_pid = find_cdp_port()
    print(f'Found: port={port}, Chrome PID={chrome_pid}')

    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
        print(f'Connected: {browser.version}')
        print()
        await report_page_state(browser)
        print()

        if args.scan:
            # Set LLM env vars for auto-fill
            os.environ.setdefault('OPENAI_API_KEY', os.environ.get('FORM_LLM_API_KEY', ''))
            os.environ.setdefault('FORM_LLM_MODEL', 'deepseek-v4-flash')
            os.environ.setdefault('FORM_LLM_BASE_URL', 'https://api.deepseek.com')
            await scan_pending(browser)
        elif args.monitor:
            await quick_snapshot(browser)
        else:
            # Default: quick snapshot
            await quick_snapshot(browser)


if __name__ == '__main__':
    asyncio.run(main())
