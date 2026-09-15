"""
轨迹 / 案例数据持久化模块。

本模块为交互式会话运行器提供轨迹数据的持久化功能，
从 scripts/session_runner.py 中提取。

主要功能：
- 保存 action_*.json、log_*.txt、form_*.json、cdata_*.json 文件
- 发射 save_*_result 事件
- 管理轨迹累积和重置
"""
import json
import sys
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from .agent_utils import emit_json


def _handle_save_trajectory(cumulative_path, session_id, browser_context=None, business_data_store=None):
    """
    保存轨迹动作/日志/表单文件用于组装和 MySQL 持久化。

    生成以下文件：
    - action_{ts}.json — 自定义动作格式（用于 script_assembler.py）
    - log_{ts}.txt — 操作日志（用于 LLM 上下文）
    - form_{ts}.json — 表单结构快照（可选）

    原生 browser-use AgentHistory（scripts/trajectories/{session_id}.json /
    traj_*.json）不再保存 —— 产品真相是 MySQL + action JSON。

    参数：
        cumulative_path: 累积轨迹文件路径
        session_id (str): 会话 ID
        browser_context: 浏览器上下文（可选）
        business_data_store (dict, optional): 业务数据存储
    """
    from .controller import _ACTION_LOG, _TRAJECTORY_URL
    from .recorder import _ACTION_LOG as _recorder_log
    from .controller import _ACTION_LOG as _controller_log
    # 尝试从 go_to_url 动作或 _TRAJECTORY_URL 提取 URL
    url = _TRAJECTORY_URL or ''
    if not url:
        for entry in (list(_controller_log) if _controller_log else []):
            if entry.get('action') == 'go_to_url':
                url = entry.get('params', {}).get('url', '') or ''
                if url:
                    break
    if not url:
        url = 'http://unknown'

    # ── 快照：立即复制所有可变数据，后续只用副本 ──
    entries = list(_ACTION_LOG) if _ACTION_LOG else []
    rec_log_snapshot = list(_recorder_log) if _recorder_log else []

    if not entries and not rec_log_snapshot:
        emit_json(
            {"event": "save_trajectory_result", "data": {"success": False, "message": "No trajectory data available"}})
        return
    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        scripts_dir = Path(__file__).parent
        action_dir = scripts_dir / 'action'
        log_dir = scripts_dir / 'log'
        action_dir.mkdir(parents=True, exist_ok=True)
        log_dir.mkdir(parents=True, exist_ok=True)
        action_path = None
        log_path = None

        # 准备文件路径（在所有元数据就绪后再写入）
        action_path = action_dir / f"action_{ts}.json" if entries else None
        log_path = log_dir / f"log_{ts}.txt" if rec_log_snapshot else None

        # 原生 AgentHistory 转储已禁用 —— 丢弃临时累积文件以防增长
        if cumulative_path and cumulative_path.exists():
            try:
                cumulative_path.unlink()
            except OSError:
                pass
        sys.stderr.write(f"[save-trajectory] entries={len(entries)}, rec_log_snapshot={len(rec_log_snapshot)} (native AgentHistory skipped)\n")
        sys.stderr.flush()

        # 文件 4: form_{ts}.json — 表单结构快照（用于回放验证）
        form_path = None
        snapshots = None
        if business_data_store:
            from .models import FormSnapshotCollection
            coll = FormSnapshotCollection.from_store(business_data_store)
            snapshots = coll.to_dicts()
        if snapshots:
            forms_dir = scripts_dir / 'forms'
            forms_dir.mkdir(parents=True, exist_ok=True)
            form_path = forms_dir / f"form_{ts}.json"
            with open(form_path, 'w', encoding='utf-8') as f:
                json.dump(snapshots, f, ensure_ascii=False, indent=2)
            sys.stderr.write(f"Form snapshots saved: {form_path}\n")
            sys.stderr.flush()

        # 文件 1: action_{ts}.json
        if action_path and entries:
            action_json = {
                'id': str(uuid.uuid4()),
                'name': 'browser-use-session',
                'url': url,
                'tests': [{
                    'id': str(uuid.uuid4()),
                    'name': 'browser-use-session',
                    'commands': entries,
                }],
            }
            with open(action_path, 'w', encoding='utf-8') as f:
                json.dump(action_json, f, ensure_ascii=False, indent=2)

        # 文件 2: log_{ts}.txt
        if log_path and rec_log_snapshot:
            with open(log_path, 'w', encoding='utf-8') as f:
                f.write(f"URL: {url}\n")
                f.write(f"Total steps: {len(rec_log_snapshot)}\n")
                f.write("=" * 60 + "\n")
                for line in rec_log_snapshot:
                    f.write(line + "\n")

        # 清除所有日志，以便下次任务从头开始
        action_count = len(entries)
        log_count = len(rec_log_snapshot)
        _ACTION_LOG.clear()
        _recorder_log.clear()
        from .state import _emit_action_log_sync
        _emit_action_log_sync()

        emit_json({
            "event": "save_trajectory_result",
            "data": {
                "success": True,
                "action_file": str(action_path) if action_path else None,
                # 原生 AgentHistory 路径已移除；不要回退到 action_file
                #（会错误地馈送到 trajectory-store / scripts/trajectories）。
                "trajectory_file": None,
                "log_file": str(log_path) if log_path else None,
                "form_file": str(form_path) if form_path else None,
                "action_count": action_count,
                "log_count": log_count,
                "native_count": 0,
                "url": url,
            },
        })
        _fcounts = [s.get('count', 0) for s in snapshots] if snapshots else []
        _fstr = ', '.join(str(c) for c in _fcounts) if _fcounts else '0'
        sys.stderr.write(f"Saved: action({action_count}) log({log_count}) form({_fstr})\n")
        sys.stderr.flush()
    except Exception as e:
        emit_json({"event": "save_trajectory_result", "data": {"success": False, "message": str(e)}})
        emit_json({"event": "save_trajectory_result", "data": {"success": False, "message": str(e)}})


def _handle_save_business_data(business_data_store, session_id):
    """
    按需保存业务数据到 JSON 文件。

    参数：
        business_data_store (dict): 业务数据存储
        session_id (str): 会话 ID
    """
    try:
        data_dir = Path(__file__).parent / 'case_data'
        data_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        business_data_path = data_dir / f"cdata_{ts}.json"
        import json as _json
        with open(business_data_path, 'w', encoding='utf-8') as f:
            _json.dump(business_data_store, f, ensure_ascii=False, indent=2)
        sys.stderr.write(f"Business data saved on demand: {business_data_path}\n")
        sys.stderr.flush()
        emit_json({
            "event": "save_business_data_result",
            "data": {"success": True, "business_data_file": str(business_data_path), "keys": len(business_data_store)},
        })
    except Exception as e:
        emit_json({"event": "save_business_data_result", "data": {"success": False, "message": str(e)}})


def _handle_reset_trajectory(session_id, business_data_store=None):
    """
    重置轨迹数据。

    清空动作日志和记录器日志，清除阶段输出和阶段意图，
    并准备新的累积文件路径。

    参数：
        session_id (str): 会话 ID
        business_data_store (dict, optional): 业务数据存储

    返回：
        Path: 新的累积文件路径
    """
    from .controller import _ACTION_LOG
    from .recorder import _ACTION_LOG as _recorder_log
    from .controller.actions._phase_context import clear_phase_outcomes
    from .controller.actions._phase_intent import clear_phase_intent
    _ACTION_LOG.clear()
    _recorder_log.clear()
    clear_phase_outcomes(business_data_store)
    clear_phase_intent(business_data_store)
    from .state import _emit_action_log_sync
    _emit_action_log_sync()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    cumulative_path = Path(tempfile.gettempdir()) / f"browser_use_session_{session_id}_case_{ts}.json"
    sys.stderr.write(f"ATP trajectory reset ({ts})\n")
    sys.stderr.flush()
    emit_json({"event": "reset_trajectory_ready",
               "data": {"session_id": session_id, "format": "atp-record", "cumulative_file": str(cumulative_path)}})
    return cumulative_path


def _accumulate_trajectory(output_path, cumulative_path, phase_number=None):
    """
    累积轨迹步骤到累积文件。

    从输出文件读取步骤历史，可选注入阶段号，
    然后追加到累积文件。

    参数：
        output_path (Path): 输出文件路径
        cumulative_path (Path): 累积文件路径
        phase_number (int, optional): 阶段号，注入到每一步的 state 中
    """
    if not output_path.exists():
        return
    try:
        from .controller import _ACTION_LOG as _action_log
        from .recorder import _ACTION_LOG as _recorder_log
        with open(output_path, 'r', encoding='utf-8') as _f:
            _step = json.load(_f)
        _step_history = _step.get('history', [])
        if not _step_history:
            return
        # ── 注入 phase_number 到每一步的 state 中 ──
        if phase_number is not None:
            for step in _step_history:
                step.setdefault('state', {})['_phase_number'] = phase_number
        if cumulative_path.exists():
            with open(cumulative_path, 'r', encoding='utf-8') as _f:
                _cum = json.load(_f)
        else:
            _cum = {'history': []}
        _cum['history'].extend(_step_history)
        cumulative_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cumulative_path, 'w', encoding='utf-8') as _f:
            json.dump(_cum, _f, ensure_ascii=False, indent=2)
        sys.stderr.write(
            f"Accumulated: step({len(_step_history)}) action({len(_action_log)}) log({len(_recorder_log)}) trajectory({len(_cum['history'])} total)\n")
        sys.stderr.flush()
    except Exception as _e:
        sys.stderr.write(f"Accumulate error: {_e}\n")
        sys.stderr.flush()
