"""Tree-check actions: deterministic checkbox-tree selection with verification.

流程选人 / TsscMultiTree-style checkbox trees (show-checkbox el-tree in a
popover). sibling of select_tree_option (single-leaf tree) — this one is for
MULTI-select checkbox trees where the selected list (nextNodeAprvPsnList) is
only written by the real check event (KB-I5 r6c root cause).
"""

import json

from scripts.state import _record_action
from ._helpers import _ok
from ._js_snippets import JS_TREE_CHECK_CONFIRM, JS_TREE_PICKER_CLICK
from .replay_timing import WAIT_800_MS
from ._workspace import _workspace_result


def _register_tree_actions(controller, browser_context):
    @controller.action(
        'Select (check) a node in a checkbox tree such as 流程选人 (next-node '
        'approver tree) or a multi-select catalog tree, for a field identified by '
        'its label_text. One dedicated pass: open the field trigger → find the '
        'node_text → click its checkbox (preset-checked nodes are re-clicked so '
        'they END checked and the real check event fires) → VERIFY the node is '
        'checked and the tree checked-count >= 1. Returns ok on verified success. '
        'Errors: err-tree-label-not-found / err-tree-node-not-found (node text not '
        'rendered) / err-tree-check-unverified (check state not confirmed — never '
        'blindly retry; re-read state first, fall back to click_button or report). '
        'This action only checks the box — click the dialog confirm button '
        '("确 定") yourself afterwards.'
    )
    async def tree_check_confirm(label_text: str, node_text: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate(JS_TREE_CHECK_CONFIRM, [label_text, node_text])
        # JS side polls render + verifies internally (≤ ~4s); settling buffer.
        await page.wait_for_timeout(WAIT_800_MS)
        ok, payload = _workspace_result(result)
        if ok:
            try:
                parsed = json.loads(payload[3:]) if payload.startswith('ok:') else {}
            except Exception:
                parsed = {}
            _record_action('tree_check_confirm', {
                'label_text': label_text,
                'node_text': node_text,
                'checked_count': parsed.get('checked_count'),
            }, payload)
            return _ok(payload)
        return payload

    @controller.action(
        'Pick a leaf in a product/catalog tree by REALLY clicking node texts '
        'level by level (贷款→对公→…→叶子), for a field identified by label_text. '
        'For 品种/产品树 pickers where select_tree_option ($emit three-stage '
        'injection) does not fire the selection — e.g. 「维护方案品种明细」 '
        'TsscMultiTree popover: clicking the leaf text closes the popover and '
        'auto-fills the read-only quota fields. path_texts is a JSON array string '
        'of node texts from root to leaf, e.g. '
        '["贷款","对公","房地产贷款","住房开发贷款"]. Opens the field trigger, '
        'clicks each level (waiting for expansion), then VERIFIES the field input '
        'echoes the leaf text. Returns ok with echo on verified success. Errors: '
        'err-tree-label-not-found / err-tree-trigger-not-found / '
        'err-tree-node-not-found (a path level never rendered) / err-tree-no-echo '
        '(leaf clicked but input not echoed — never blindly retry; re-read state '
        'or report). This action only selects the leaf — click the dialog confirm '
        'button ("确认") yourself afterwards.'
    )
    async def tree_picker_click(label_text: str, path_texts: str):
        page = await browser_context.get_current_page()
        result = await page.evaluate(
            JS_TREE_PICKER_CLICK, [label_text, path_texts])
        # JS side polls each level (≤2s/level) + verifies echo internally; buffer.
        await page.wait_for_timeout(WAIT_800_MS)
        ok, payload = _workspace_result(result)
        if ok:
            try:
                parsed = json.loads(payload[3:]) if payload.startswith('ok:') else {}
            except Exception:
                parsed = {}
            _record_action('tree_picker_click', {
                'label_text': label_text,
                'path_texts': path_texts,
                'echo': parsed.get('echo'),
            }, payload)
            return _ok(payload)
        return payload
