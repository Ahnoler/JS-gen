"""
Persistent CDP watcher — connects to the Agent's Chrome and executes actions on demand.

Architecture:
  Node.js spawns this process → stdin receives JSON action requests
  → Watcher executes via CDP → stdout returns JSON results

Usage:
  python -m scripts.cdp_watcher          # use default port 9242
  python -m scripts.cdp_watcher 9243     # use custom port
"""
import asyncio, json, sys, io, os, traceback

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

from playwright.async_api import async_playwright


async def _get_page(ctx):
    """Return the first non-devtools HTTP page in the browser context."""
    for pg in ctx.pages:
        u = pg.url
        if u.startswith('http') and 'devtools' not in u:
            return pg
    return ctx.pages[-1] if ctx.pages else None


def _build_ctrl(ctx, case_data_store=None):
    """Build a Controller with all registered custom actions.

    Args:
        ctx: Playwright browser context with get_current_page injected.
        case_data_store: Optional shared dict (in-process watcher passes the Agent's store).
    """
    from scripts.controller.service import build_controller

    store = case_data_store if case_data_store is not None else {}
    ctrl = build_controller(ctx, case_data_store=store)
    return ctrl


def _list_actions(ctrl):
    """Return a summary of available actions for the status endpoint."""
    result = []
    for name, action in ctrl.registry.registry.actions.items():
        params = list(action.param_model.model_fields.keys()) if action.param_model else []
        result.append({'name': name, 'description': action.description[:120], 'params': params})
    result.sort(key=lambda a: a['name'])
    return result


async def main(port=9242):
    cdp_url = f'http://127.0.0.1:{port}'

    async with async_playwright() as pw:
        try:
            browser = await pw.chromium.connect_over_cdp(cdp_url)
        except Exception as e:
            sys.stderr.write(f'[watcher] Failed to connect CDP at {cdp_url}: {e}\n')
            sys.stderr.flush()
            # Let the caller know we failed
            emit_json({'event': 'watcher_error', 'error': str(e)})
            return

        ctx = browser.contexts[0]
        ctx.get_current_page = _get_page

        ctrl = _build_ctrl(ctx)
        actions = ctrl.registry.registry.actions
        available = _list_actions(ctrl)

        page = await _get_page(ctx)
        current_url = page.url if page else 'about:blank'
        emit_json({'event': 'watcher_ready', 'port': port, 'url': current_url, 'actions_count': len(actions)})

        sys.stderr.write(f'[watcher] Ready on port {port}, {len(actions)} actions, page: {current_url}\n')
        sys.stderr.flush()

        # Main loop: read JSON commands from stdin
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                sys.stderr.write(f'[watcher] Invalid JSON: {line[:100]}\n')
                sys.stderr.flush()
                continue

            req_id = msg.get('id', '')
            action_name = msg.get('action', '')
            params = msg.get('params', [])

            if action_name == 'ping':
                emit_json({'id': req_id, 'result': 'pong'})
                continue
            if action_name == 'status':
                page = await _get_page(ctx)
                emit_json({'id': req_id, 'result': {'url': page.url if page else '', 'actions': available}})
                continue

            action = actions.get(action_name)
            if not action:
                emit_json({'id': req_id, 'error': f'Unknown action: {action_name}', 'available_count': len(actions)})
                continue

            try:
                if isinstance(params, list):
                    result = await action.function(*params)
                elif isinstance(params, dict):
                    result = await action.function(**params)
                else:
                    result = await action.function()
                # ActionResult objects are not JSON-serializable, convert to string
                result_str = str(result)
                emit_json({'id': req_id, 'result': result_str})
            except Exception as e:
                emit_json({'id': req_id, 'error': str(e)})
                sys.stderr.write(f'[watcher] Action error: {action_name}({params}) -> {e}\n')
                sys.stderr.flush()

        sys.stderr.write('[watcher] stdin closed, exiting\n')
        sys.stderr.flush()


def emit_json(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False) + '\n')
    sys.stdout.flush()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9242
    asyncio.run(main(port))
