"""
事件分发模块。

本模块处理 CDP / 执行器消息在会话运行器中的分发。
从 scripts/session_runner.py 中提取。

主要功能：
- 处理轨迹保存、重置等管理事件
- 处理 CDP 动作分发
- 处理手动录制的开始/停止
- 处理截图捕获控制
- 处理标签页管理（列表、切换）
- 处理回放动作执行
"""
import sys

from .agent_utils import emit_json
from .trajectory_store import (
    _handle_reset_trajectory,
    _handle_save_business_data,
    _handle_save_trajectory,
)


# 回放动作签名白名单：定义每个动作允许的参数键
# 用于过滤回放时传入的参数，只保留必要的键
_REPLAY_ACTION_SIGNATURES = {
    "fill_form_field": {"label_text", "value"},
    "select_option": {"label_text", "option_text"},
    # text/tag_name 等是回放兜底定位的关键线索：白名单丢掉 text 后，
    # _replay_click_by_index 只能回退 element_json.text（可能过期），导致
    # _JS_CLICK_DURABLE 文本守卫误杀正确的 xpath 命中（2026-09-06 交易56 树节点案例）。
    "click_element_by_index": {"index", "text", "tag_name", "menu_text", "parent_text", "target_kind", "icon_class"},
    "click_menu_item": {"menu_text"},
    "click_table_row_button": {"row_text", "button_text"},
    "click_table_row_radio": {"row_text"},
    "click_adjacent_button": {"label_text"},
    "click_radio": {"label_text", "option_text"},
    "select_tree_option": {"label_text", "option_text"},
    "tree_picker_click": {"label_text", "path_texts", "option_text"},
    "tssc_multi_select": {"label_text", "option_text"},
    "switch_tab": {"tab_name"},
    "close_dialog": set(),
    "go_to_url": {"url"},
    "scan_menu_tree": set(),
    "click_menu_xpath": {"xpath"},
    "read_page_component_code": set(),
    "close_tianyuan_dialog": set(),
    "login": {"username", "password", "captcha", "sms_code"},
}

def _convert_action_params(action_name, params):
    """
    根据动作签名白名单过滤参数。

    对已注册动作，只保留白名单中的参数键；对未注册动作，原样透传。

    参数：
        action_name (str): 动作名称
        params (dict): 原始参数字典

    返回：
        dict: 过滤后的参数字典
    """
    sig = _REPLAY_ACTION_SIGNATURES.get(action_name)
    if sig is None:
        return dict(params) if params else {}
    return {k: v for k, v in (params or {}).items() if k in sig}


async def _dispatch_event(msg, session_state, agent_running_ref=None, cdp_action_queue=None):
    """
    分发接收到的事件消息。

    根据事件类型调用相应的处理函数，支持以下事件：
    - save_trajectory: 保存轨迹
    - get_action_log: 获取动作日志
    - save_business_data: 保存业务数据
    - reset_trajectory: 重置轨迹
    - cdp_action: CDP 动作分发
    - manual_record_start/stop: 手动录制开始/停止
    - capture_screenshots: 截图捕获控制
    - list_tabs: 列出标签页
    - switch_tab: 切换标签页
    - replay_actions: 回放动作
    - intervene: 人工干预（已废弃）
    - step: 步骤执行

    参数：
        msg (dict): 事件消息
        session_state (dict): 会话状态
        agent_running_ref (dict, optional): agent 运行状态引用
        cdp_action_queue (asyncio.Queue, optional): CDP 动作队列

    返回：
        str: 'continue' 表示继续处理下一个事件，'step' 表示执行步骤
    """
    event = msg.get("event")

    if event == "save_trajectory":
        _handle_save_trajectory(session_state.get('cumulative_path'), session_state['session_id'], business_data_store=session_state.get('business_data_store'))
        return 'continue'

    if event == "get_action_log":
        from .state import _ACTION_LOG
        emit_json({
            "event": "get_action_log_result",
            "data": {
                "entries": list(_ACTION_LOG),
                "count": len(_ACTION_LOG),
            },
        })
        return 'continue'

    if event == "save_business_data":
        _handle_save_business_data(session_state['business_data_store'], session_state['session_id'])
        return 'continue'

    if event == "reset_trajectory":
        cum_path = _handle_reset_trajectory(
            session_state['session_id'],
            business_data_store=session_state.get('business_data_store'),
        )
        session_state['cumulative_path'] = cum_path
        session_state['business_data_store'].clear()
        return 'continue'

    if event == "cdp_action":
        action_data = msg.get("data", {})
        if cdp_action_queue is not None:
            await cdp_action_queue.put(action_data)
        return 'continue'

    if event == "manual_record_start":
        recorder = session_state.get('manual_recorder')
        if recorder is None:
            from .manual_recorder import ManualRecorder
            recorder = ManualRecorder(session_state.get('browser_context'))
            session_state['manual_recorder'] = recorder
        try:
            await recorder.start()
        except Exception as e:
            emit_json({"event": "manual_record_status", "data": {"enabled": False, "error": str(e)}})
            sys.stderr.write(f"[manual-recorder] start error: {e}\n")
            sys.stderr.flush()
        return 'continue'

    if event == "manual_record_stop":
        recorder = session_state.get('manual_recorder')
        if recorder:
            try:
                await recorder.stop()
            except Exception as e:
                emit_json({"event": "manual_record_status", "data": {"enabled": False, "error": str(e)}})
        else:
            emit_json({"event": "manual_record_status", "data": {"enabled": False}})
        return 'continue'

    if event == "capture_screenshots":
        from .state import reset_page_level_shots, set_capture_screenshots
        data = msg.get("data") or {}
        enabled = bool(data.get("enabled", True))
        set_capture_screenshots(enabled)
        if enabled:
            reset_page_level_shots()
        emit_json({"event": "capture_screenshots_status", "data": {"enabled": enabled}})
        sys.stderr.write(f"capture_screenshots={enabled}\n")
        sys.stderr.flush()
        return 'continue'

    # BiB canvas / CDP inspect path — same payload shape as page inject
    if event == "manual_dom_event":
        recorder = session_state.get('manual_recorder')
        payload = msg.get("data") or msg.get("payload") or {}
        if not recorder or not getattr(recorder, 'enabled', False):
            return 'continue'
        if isinstance(payload, dict) and payload:
            try:
                recorder.ingest_external(payload)
            except Exception as e:
                sys.stderr.write(f"[manual-recorder] ingest_external error: {e}\n")
                sys.stderr.flush()
        return 'continue'

    if event == "list_tabs":
        browser_context = session_state.get('browser_context')
        if not browser_context:
            emit_json({"event": "tabs_result", "data": {"tabs": [], "activePageId": None, "error": "no browser_context"}})
            return 'continue'
        try:
            tabs_info = await browser_context.get_tabs_info()
            active = None
            try:
                cur = await browser_context.get_current_page()
                for t in tabs_info:
                    if getattr(t, 'url', None) == getattr(cur, 'url', None):
                        active = getattr(t, 'page_id', None)
                        break
            except Exception:
                pass
            emit_json({
                "event": "tabs_result",
                "data": {
                    "tabs": [
                        {
                            "pageId": getattr(t, 'page_id', i),
                            "url": getattr(t, 'url', '') or '',
                            "title": getattr(t, 'title', '') or '',
                        }
                        for i, t in enumerate(tabs_info)
                    ],
                    "activePageId": active,
                },
            })
        except Exception as e:
            emit_json({"event": "tabs_result", "data": {"tabs": [], "activePageId": None, "error": str(e)}})
        return 'continue'

    if event == "switch_tab":
        browser_context = session_state.get('browser_context')
        data = msg.get("data") or {}
        if not browser_context:
            emit_json({"event": "switch_tab_result", "data": {"ok": False, "error": "no browser_context"}})
            return 'continue'
        try:
            page_id = data.get("pageId")
            url = (data.get("url") or "").strip()
            if page_id is not None and str(page_id) != "":
                await browser_context.switch_to_tab(int(page_id))
            elif url:
                tabs_info = await browser_context.get_tabs_info()
                matched = None
                for t in tabs_info:
                    if (getattr(t, 'url', '') or '') == url:
                        matched = getattr(t, 'page_id', None)
                        break
                if matched is None:
                    # 软匹配：相同路径（去掉尾部斜杠和查询参数）
                    for t in tabs_info:
                        tu = (getattr(t, 'url', '') or '').rstrip('/')
                        if tu and tu == url.rstrip('/'):
                            matched = getattr(t, 'page_id', None)
                            break
                if matched is None:
                    raise RuntimeError(f'No Playwright tab matches url={url!r}')
                await browser_context.switch_to_tab(int(matched))
                page_id = matched
            else:
                raise RuntimeError('pageId or url required')
            cur = await browser_context.get_current_page()
            emit_json({
                "event": "switch_tab_result",
                "data": {
                    "ok": True,
                    "pageId": int(page_id) if page_id is not None else None,
                    "url": getattr(cur, 'url', '') or url,
                },
            })
            sys.stderr.write(f"switch_tab -> pageId={page_id} url={getattr(cur, 'url', '')}\n")
            sys.stderr.flush()
        except Exception as e:
            emit_json({"event": "switch_tab_result", "data": {"ok": False, "error": str(e)}})
            sys.stderr.write(f"switch_tab failed: {e}\n")
            sys.stderr.flush()
        return 'continue'

    if event == "replay_plan":
        # 控制面在整批回放开跑前一次性下发完整步骤清单（执行机逐条收
        # replay_actions，无法自行汇总整批），这里原样打印到 stderr，便于
        # 操作人员在回放开始前核对本次要执行的步骤。
        data = msg.get("data", {}) or {}
        steps = data.get("steps") or []
        tid = data.get("trajectoryId", "")
        sys.stderr.write(f"[replay] ===== 即将回放 {len(steps)} 步（轨迹 {tid}）=====\n")
        for line in steps:
            sys.stderr.write(f"[replay]   {line}\n")
        sys.stderr.write("[replay] ===== 开始执行 =====\n")
        sys.stderr.flush()
        return 'continue'

    if event == "replay_actions":
        data = msg.get("data", {}) or {}
        entries = data.get("actions", [])
        seed_action_log = bool(data.get("seed_action_log"))
        stop_on_fail = bool(data.get("stop_on_fail"))
        replay_id = data.get("replayId") or data.get("replay_id")
        browser_context = session_state.get('browser_context')
        business_data_store = session_state.get('business_data_store', {})
        if not browser_context or not entries:
            early = {"count": 0, "error": "no browser_context or empty actions"}
            if replay_id:
                early["replayId"] = replay_id
            emit_json({"event": "replay_done", "data": early})
            return 'continue'

        # 自修复 / 轨迹回放：通过 scripts/controller/actions/_replay.py 执行顺序操作
        #（表单 JS + 持久化点击 + 控制器）—— 非 LLM，非 Playwright assemble_partial。
        from .controller.service import build_controller
        from .controller.actions._replay import replay_action_entries

        controller = build_controller(browser_context, business_data_store=business_data_store)
        registry_actions = controller.registry.registry.actions

        # 签名过滤对已注册动作生效（只保留白名单键，_normalize_params 的别名兜底仅
        # 作用于未注册动作透传的 raw_params）；注册表未知动作原样透传。
        filtered = []
        for entry in entries:
            action_name = entry.get("action", "")
            raw_params = entry.get("params", {}) or {}
            # 优先使用签名过滤（已知动作），否则保留原始参数用于别名规范化
            converted = _convert_action_params(action_name, raw_params)
            merged = converted if converted else dict(raw_params)
            filtered.append({**entry, "action": action_name, "params": merged})

        summary = await replay_action_entries(
            browser_context,
            filtered,
            controller_actions=registry_actions,
            business_data_store=business_data_store,
            emit=emit_json,
            stop_on_fail=stop_on_fail,
        )

        # 修复路径：用原始失败前的条目填充 ACTION_LOG，以便后续 agent 录制
        # 可以保存为完整轨迹（前缀 + 修复）。
        if seed_action_log:
            try:
                from . import state as action_state
                from .state import _SKIP_SCREENSHOT_ACTIONS
                action_state._ACTION_LOG.clear()
                for entry in filtered:
                    action_name = entry.get("action") or ""
                    if action_name in _SKIP_SCREENSHOT_ACTIONS:
                        continue
                    dumped = dict(entry)
                    dumped.setdefault('source', 'replay')
                    action_state._ACTION_LOG.append(dumped)
                    if action_name == 'go_to_url' and (entry.get('params') or {}).get('url'):
                        action_state._TRAJECTORY_URL = entry['params']['url']
                sys.stderr.write(
                    f"[replay] Seeded ACTION_LOG with {len(action_state._ACTION_LOG)} pre-failure entries\n"
                )
                sys.stderr.flush()
            except Exception as e:
                sys.stderr.write(f"[replay] seed_action_log failed: {e}\n")
                sys.stderr.flush()

        done_data = {
            "count": summary.get("count", 0),
            "ok": summary.get("ok", 0),
            "failed": summary.get("failed", 0),
            "error": summary.get("error"),
            "results": summary.get("results") or [],
        }
        if summary.get("stoppedAt") is not None:
            done_data["stoppedAt"] = summary["stoppedAt"]
        if replay_id:
            done_data["replayId"] = replay_id
        emit_json({"event": "replay_done", "data": done_data})
        return 'continue'

    if event == "intervene":
        # 通过 AI session 的人工干预已退役 —— 改用手动录制
        emit_json({
            "event": "error",
            "data": {
                "message": "intervene is gone (410). Use manual recording for human correction.",
                "code": 410,
            },
        })
        sys.stderr.write("intervene rejected (410 Gone — use manual recording)\n")
        sys.stderr.flush()
        return 'continue'

    if event != "step":
        if event:
            sys.stderr.write(f"Unknown event: {event}\n")
            sys.stderr.flush()
        return 'continue'

    return 'step'
