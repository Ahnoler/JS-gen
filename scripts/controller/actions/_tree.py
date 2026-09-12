"""Tree-check actions: deterministic checkbox-tree selection with verification.

流程选人 / TsscMultiTree-style checkbox trees (show-checkbox el-tree in a
popover). sibling of select_tree_option (single-leaf tree) — this one is for
MULTI-select checkbox trees where the selected list (nextNodeAprvPsnList) is
only written by the real check event (KB-I5 r6c root cause).
"""

import asyncio
import json

from scripts.state import _record_action
from ._helpers import _ok, _as_dict
from ._js_snippets import (JS_TREE_CHECK_CONFIRM, JS_TREE_PICKER_CLICK,
                           JS_TREE_PICKER_SEARCH_FILL,
                           JS_TREE_PICKER_SEARCH_MATCHES,
                           JS_STRIP_STALE_WRAPPERS, JS_REAL_CLICK_ECHO,
                           JS_TREE_POPOVER_OPEN)
from .replay_timing import WAIT_800_MS
from ._workspace import _workspace_result, _real_click_via_cdp


async def _real_click_at(page, x: int, y: int) -> bool:
    """Trusted CDP mouse click at viewport coords (search-flow 查询按钮/叶子节点)."""
    try:
        session = await page.context.new_cdp_session(page)
    except Exception:
        return False
    try:
        await session.send('Input.dispatchMouseEvent', {
            'type': 'mouseMoved', 'x': x, 'y': y, 'button': 'none',
        })
        await session.send('Input.dispatchMouseEvent', {
            'type': 'mousePressed', 'x': x, 'y': y,
            'button': 'left', 'clickCount': 1,
        })
        await asyncio.sleep(0.04)
        await session.send('Input.dispatchMouseEvent', {
            'type': 'mouseReleased', 'x': x, 'y': y,
            'button': 'left', 'clickCount': 1,
        })
        return True
    except Exception:
        return False


async def _tree_picker_search_clear(page, label_text: str) -> None:
    """Best-effort 还原：清空弹层搜索框并重跑查询，避免页面留在过滤态。"""
    try:
        filled = _as_dict(await page.evaluate(JS_TREE_PICKER_SEARCH_FILL, [label_text, '']))
        btn = filled.get('btn') if isinstance(filled, dict) else None
        if isinstance(btn, dict) and btn.get('x') is not None:
            await _real_click_at(page, int(btn['x']), int(btn['y']))
            await page.wait_for_timeout(600)
    except Exception:
        pass


async def _tree_picker_click_leaf_search(page, label_text: str, leaf: str) -> str:
    """叶子名直达流：开弹层 → 搜索框填叶名+真点查询 → 真点唯一可见叶子 → 回显校验。

    活体依据（2026-09-12 产品目录弹层）：树数据全量在客户端（lazy=false），
    查询后仅渲染祖先链+叶子；选中必须真实点击（$emit 注入对本组件族无效）。
    """
    # 弹层已开则不再真点触发器（toggle 会把它关掉）：SEARCH_MATCHES ok 即弹层在开
    probe = _as_dict(await page.evaluate(
        JS_TREE_PICKER_SEARCH_MATCHES, [label_text, leaf]))
    if not (isinstance(probe, dict) and probe.get('ok')):
        rc = await _real_click_via_cdp(page, label_text=label_text)
        if not (rc == 'skipped-open' or rc.startswith('ok-real-click')):
            return 'err-tree-trigger-not-found:' + label_text + ' | ' + rc[:80]
        await page.wait_for_timeout(600)

    filled = _as_dict(await page.evaluate(JS_TREE_PICKER_SEARCH_FILL, [label_text, leaf]))
    if not (isinstance(filled, dict) and filled.get('ok')):
        # popover 可能已被上次交互关掉——真实点击再开一次
        await _real_click_via_cdp(page, label_text=label_text)
        await page.wait_for_timeout(600)
        filled = _as_dict(await page.evaluate(JS_TREE_PICKER_SEARCH_FILL, [label_text, leaf]))
        if not (isinstance(filled, dict) and filled.get('ok')):
            err = str(filled.get('error', 'unknown'))[:80] if isinstance(filled, dict) else 'unknown'
            return 'err-tree-popover-not-open:' + label_text + ':' + err
    btn = filled.get('btn') or {}
    if not await _real_click_at(page, int(btn.get('x', 0)), int(btn.get('y', 0))):
        return 'err-tree-search-click-fail:' + label_text

    matches = None
    for _ in range(8):
        probe = _as_dict(await page.evaluate(JS_TREE_PICKER_SEARCH_MATCHES, [label_text, leaf]))
        if isinstance(probe, dict) and probe.get('ok'):
            matches = probe.get('matches') or []
            if len(matches) == 1:
                break
        await page.wait_for_timeout(500)
    if not matches:
        await _tree_picker_search_clear(page, label_text)
        return 'err-tree-node-not-found:' + label_text + ':' + leaf + ' (搜索后无该叶子)'
    if len(matches) > 1:
        await _tree_picker_search_clear(page, label_text)
        return ('err-tree-ambiguous-leaf:%s:%s:%d — 同名叶子 %d 个，'
                '请改用 path_texts 根→叶路径消歧' % (label_text, leaf, len(matches), len(matches)))

    hit = matches[0]
    if not await _real_click_at(page, int(hit['x']), int(hit['y'])):
        await _tree_picker_search_clear(page, label_text)
        return 'err-real-click-fail:' + label_text + ':' + leaf
    await page.wait_for_timeout(WAIT_800_MS)

    er = await page.evaluate(JS_REAL_CLICK_ECHO, [label_text, leaf])
    eok, epayload = _workspace_result(er)
    if not eok:
        return 'err-tree-no-echo:' + label_text + ':' + leaf + ' | ' + epayload[:80]
    try:
        parsed = json.loads(epayload[3:]) if epayload.startswith('ok:') else {}
    except Exception:
        parsed = {}
    return 'ok:' + json.dumps({
        'ok': True,
        'echo': parsed.get('echo', leaf),
        'clicked': [leaf],
        'via': 'search-real-click',
    }, ensure_ascii=False)


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
        'Pick a leaf in a product/catalog tree for a field identified by '
        'label_text — by REALLY clicking tree nodes (synthetic $emit injection '
        'does not fire the selection on 品种/产品树 pickers like 「维护方案品种明细」 '
        'TsscMultiTree popover). Two modes: (a) path_texts = JSON array string of '
        'node texts root→leaf, e.g. ["贷款","对公","房地产贷款","住房开发贷款"] — '
        'opens the field trigger, clicks each level (waiting for expansion), then '
        'VERIFIES the field input echoes the leaf text; (b) option_text = leaf '
        'name only — opens the trigger, fills the popover built-in search box, '
        'REALLY clicks 查询, then REALLY clicks the single visible leaf (the '
        'filter reveals the ancestor chain + leaf at once); ≥2 same-named leaves '
        '→ err-tree-ambiguous-leaf (give path_texts instead). path_texts wins '
        'when both are given. Returns ok with echo on verified success. Errors: '
        'err-tree-label-not-found / err-tree-trigger-not-found / '
        'err-tree-popover-not-open / err-tree-search-click-fail / '
        'err-tree-ambiguous-leaf / err-tree-node-not-found (a path level or the '
        'searched leaf never rendered) / err-tree-no-echo (leaf clicked but '
        'input not echoed — never blindly retry; re-read state or report). '
        'This action only selects the leaf — click the dialog confirm button '
        '("确认") yourself afterwards.'
    )
    async def tree_picker_click(label_text: str, path_texts: str = "",
                                option_text: str = ""):
        page = await browser_context.get_current_page()
        # Pre-strip stale dialog wrappers (tsscMutilDialog 关闭残留) so real
        # clicks reach the tree popover; idempotent, <10ms.
        try:
            await page.evaluate(JS_STRIP_STALE_WRAPPERS)
        except Exception:
            pass
        leaf = (option_text or '').strip()
        if not (path_texts or '').strip() and not leaf:
            return ('err-tree-args-empty: tree_picker_click 需要 path_texts'
                    '(根→叶 JSON 数组串) 或 option_text(叶子名, 弹层搜索直达)')
        if leaf and not (path_texts or '').strip():
            # 叶子名直达：搜索框筛出祖先链+叶子 → 真点唯一叶子（2026-09-12 活体实证）
            payload = await _tree_picker_click_leaf_search(page, label_text, leaf)
            if payload.startswith('ok:'):
                try:
                    parsed = json.loads(payload[3:])
                except Exception:
                    parsed = {}
                _record_action('tree_picker_click', {
                    'label_text': label_text,
                    'path_texts': path_texts,
                    'option_text': leaf,
                    'echo': parsed.get('echo'),
                }, payload)
                return _ok(payload)
            return payload
        result = await page.evaluate(
            JS_TREE_PICKER_CLICK, [label_text, path_texts])
        # JS side polls each level (≤2s/level) + verifies echo internally; buffer.
        await page.wait_for_timeout(WAIT_800_MS)
        ok, payload = _workspace_result(result)
        if not ok and ('err-tree-node-not-found' in payload
                       or 'err-tree-no-echo' in payload):
            # KB-I5 run7 fallback: the TsscMultiTree popover (品种明细 产品名称)
            # only accepts trusted (real mouse) events — synthetic mousedown
            # chains never open the trigger NOR register node clicks/expansion
            # (probe-verified: real_click(text=节点) expands, synthetic no-op).
            # CDP real-click orchestration, ≤1 pass:
            #   1) real_click the field trigger (opens the popover)
            #   2) real_click each path level by text (expands as it walks)
            #   3) verify fieldItem input echoes the leaf (JS_REAL_CLICK_ECHO)
            rc = 'skipped-open'
            try:
                path_list = [str(s) for s in (
                    json.loads(path_texts) if isinstance(path_texts, str)
                    else path_texts)]
            except Exception:
                path_list = []

            async def _popper_has(text):
                try:
                    op = _as_dict(await page.evaluate(JS_TREE_POPOVER_OPEN, [text]))
                    return isinstance(op, dict) and bool(op.get('open'))
                except Exception:
                    return False

            if path_list and not await _popper_has(path_list[0]):
                # popover closed — open it via trusted click on the trigger
                rc = await _real_click_via_cdp(page, label_text=label_text)
            if path_list and (rc == 'skipped-open' or rc.startswith('ok-real-click')):
                await page.wait_for_timeout(600)
                clicked = []
                for i, level in enumerate(path_list):
                    # wait for the level node to render in the popover
                    found = False
                    for _ in range(4):
                        if await _popper_has(level):
                            found = True
                            break
                        await page.wait_for_timeout(1000)
                    if not found:
                        break
                    nxt = path_list[i + 1] if i + 1 < len(path_list) else ''
                    if nxt and await _popper_has(nxt):
                        # next level already visible (prior expansion) — the
                        # trigger is a toggle: clicking again would collapse
                        clicked.append(level)
                        continue
                    rl = await _real_click_via_cdp(page, text=level)
                    if not rl.startswith('ok-real-click'):
                        break
                    clicked.append(level)
                    await page.wait_for_timeout(800)
                if path_list and len(clicked) == len(path_list):
                    er = await page.evaluate(
                        JS_REAL_CLICK_ECHO, [label_text, path_list[-1]])
                    eok, epayload = _workspace_result(er)
                    if eok:
                        try:
                            parsed = json.loads(epayload[3:])
                        except Exception:
                            parsed = {}
                        payload = 'ok:' + json.dumps({
                            'ok': True, 'echo': parsed.get('echo', ''),
                            'clicked': clicked, 'via': 'cdp-real-click',
                        }, ensure_ascii=False)
                        ok = True
                if not ok:
                    payload = ('fallback=real-click(%d/%d levels, open=%s) | %s'
                               % (len(clicked), len(path_list),
                                  'ok' if rc.startswith('ok-real-click') else rc[:40],
                                  payload))
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
