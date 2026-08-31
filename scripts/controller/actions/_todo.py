"""Todo/workflow actions: pending-task card list and wizard approval guard (both read-only)."""

from scripts.state import _record_action
from ._helpers import _ok
from ._js_snippets import JS_LIST_TODO_CARDS, JS_WF_SUBMIT_GUARD
from ._workspace import _workspace_result


def _register_todo_actions(controller, browser_context):
    @controller.action(
        'Read the pending-task cards (todo-item) on the 待办任务 page as structured '
        'entries: title (【流程名】…), bizPk (业务主键), status, and clickable actions '
        '(处理/转交/流程跟踪). The list is a card list, NOT a table — never scan it as '
        'a table. Pick a card by its bizPk, then click its 处理 action to open the '
        'wizard approval page.'
    )
    async def list_todo_cards():
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_LIST_TODO_CARDS)
        await page.wait_for_timeout(300)
        ok, payload = _workspace_result(result)
        if ok:
            _record_action('list_todo_cards', {}, payload)
            return _ok(payload)
        return payload

    @controller.action(
        'Read-only metadata of the workflow wizard 提交流程 step BEFORE any irreversible '
        'action: 流程提交/流程撤销 button state, 流程操作 current value and ALREADY-RENDERED '
        'options (open the dropdown first if you need the full option set — options vary '
        'by approval node role), 意见详情 length, and approval-history row count/last node. '
        'Mandatory before clicking 流程提交 or 流程撤销: declare your intent, call this to '
        'verify, act, then confirm via approval-history rows. Never clicks anything.'
    )
    async def wf_submit_guard():
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_WF_SUBMIT_GUARD)
        await page.wait_for_timeout(300)
        ok, payload = _workspace_result(result)
        if ok:
            _record_action('wf_submit_guard', {}, payload)
            return _ok(payload)
        return payload
