"""Trajectory / case-data persistence for the interactive session runner.

Extracted verbatim from scripts/session_runner.py — writes action_*.json,
log_*.txt, form_*.json, cdata_*.json and emits save_*_result events.
"""
import json
import sys
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

from .agent_utils import emit_json


def _handle_save_trajectory(cumulative_path, session_id, browser_context=None, case_data_store=None):
    """Save action/log/form files for assemble + MySQL persist.

    - action_{ts}.json  — custom action format (for script_assembler.py)
    - log_{ts}.txt      — operation log (for LLM context)
    - form_{ts}.json    — form structure snapshots (optional)

    Native browser-use AgentHistory (scripts/trajectories/{session_id}.json /
    traj_*.json) is no longer saved — product truth is MySQL + action JSON.
    """
    from .controller import _ACTION_LOG, _TRAJECTORY_URL
    from .recorder import _ACTION_LOG as _recorder_log
    from .controller import _ACTION_LOG as _controller_log
    # Try to extract URL from go_to_url action or _TRAJECTORY_URL
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

        # Prepare file paths (write later, after all metadata is ready)
        action_path = action_dir / f"action_{ts}.json" if entries else None
        log_path = log_dir / f"log_{ts}.txt" if rec_log_snapshot else None

        # Native AgentHistory dump disabled — discard temp cumulative so it does not grow.
        if cumulative_path and cumulative_path.exists():
            try:
                cumulative_path.unlink()
            except OSError:
                pass
        sys.stderr.write(f"[save-trajectory] entries={len(entries)}, rec_log_snapshot={len(rec_log_snapshot)} (native AgentHistory skipped)\n")
        sys.stderr.flush()

        # File 4: form_{ts}.json — form structure snapshots (for replay validation)
        form_path = None
        snapshots = None
        if case_data_store:
            from .models import FormSnapshotCollection
            coll = FormSnapshotCollection.from_store(case_data_store)
            snapshots = coll.to_dicts()
        if snapshots:
            forms_dir = scripts_dir / 'forms'
            forms_dir.mkdir(parents=True, exist_ok=True)
            form_path = forms_dir / f"form_{ts}.json"
            with open(form_path, 'w', encoding='utf-8') as f:
                json.dump(snapshots, f, ensure_ascii=False, indent=2)
            sys.stderr.write(f"Form snapshots saved: {form_path}\n")
            sys.stderr.flush()

        # File 1: action_{ts}.json
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

        # File 2: log_{ts}.txt
        if log_path and rec_log_snapshot:
            with open(log_path, 'w', encoding='utf-8') as f:
                f.write(f"URL: {url}\n")
                f.write(f"Total steps: {len(rec_log_snapshot)}\n")
                f.write("=" * 60 + "\n")
                for line in rec_log_snapshot:
                    f.write(line + "\n")

        # Clear all logs so next task starts fresh
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
                # Native AgentHistory path removed; do not fall back to action_file
                # (would wrongly feed trajectory-store / scripts/trajectories).
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


def _handle_save_case_data(case_data_store, session_id):
    try:
        data_dir = Path(__file__).parent / 'case_data'
        data_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        case_data_path = data_dir / f"cdata_{ts}.json"
        import json as _json
        with open(case_data_path, 'w', encoding='utf-8') as f:
            _json.dump(case_data_store, f, ensure_ascii=False, indent=2)
        sys.stderr.write(f"Case data saved on demand: {case_data_path}\n")
        sys.stderr.flush()
        emit_json({
            "event": "save_case_data_result",
            "data": {"success": True, "case_data_file": str(case_data_path), "keys": len(case_data_store)},
        })
    except Exception as e:
        emit_json({"event": "save_case_data_result", "data": {"success": False, "message": str(e)}})


def _handle_reset_trajectory(session_id, case_data_store=None):
    from .controller import _ACTION_LOG
    from .recorder import _ACTION_LOG as _recorder_log
    from .controller.actions._phase_context import clear_phase_outcomes
    from .controller.actions._phase_intent import clear_phase_intent
    _ACTION_LOG.clear()
    _recorder_log.clear()
    clear_phase_outcomes(case_data_store)
    clear_phase_intent(case_data_store)
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
