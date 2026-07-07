"""
Browser session management — replaces src/routes/browser-session.js
"""
import asyncio
import json
import os
import subprocess
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from config.settings import PYTHON_EXE, PROJECT_DIR, PORT, _env_path, SCRIPTS_DIR

router = APIRouter()

# Global state
_browser = {"process": None, "stdin": None, "ready": False, "busy": False}
_sessions = {}  # session_id -> {id, trajectoryId, createdAt}
_active_session_id = "global"

# Store trajectory data in memory (like Node.js in-process state)
_trajectories = {}  # trajectoryId -> [actions]
_trajectory_ids = []  # ordered list


def _get_api_key():
    try:
        if _env_path.exists():
            for line in _env_path.read_text(encoding='utf-8').split('\n'):
                if line.startswith('LLM_API_KEY='):
                    return line.partition('=')[2].strip().strip('"').strip("'")
    except Exception:
        pass
    return ''


async def _spawn_browser(model_id: str):
    api_key = _get_api_key()
    base_url = f"http://localhost:{PORT}/v1"
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1",
           "PYTHONPATH": str(PROJECT_DIR), "OPENAI_API_KEY": api_key}

    proc = subprocess.Popen(
        [PYTHON_EXE, "-m", "scripts.main", "--session", "--session-id", "global",
         "--model", model_id, "--base-url", base_url, "--api-key", api_key],
        cwd=str(PROJECT_DIR), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env=env, text=True, encoding="utf-8", errors="replace")

    async def _read_err():
        loop = asyncio.get_event_loop()
        while proc.poll() is None:
            try:
                line = await loop.run_in_executor(None, proc.stderr.readline)
                if line: print(line.rstrip())
            except Exception:
                break
    asyncio.create_task(_read_err())
    return proc


async def _wait_ready(proc, timeout=15):
    loop = asyncio.get_event_loop()
    dl = time.time() + timeout
    while time.time() < dl:
        if proc.poll() is not None: return False
        try:
            line = await loop.run_in_executor(None, proc.stdout.readline)
            if line:
                msg = json.loads(line.strip())
                if msg.get("event") == "ready": return True
        except Exception:
            continue
    return False


def _send_agent(msg: dict):
    p = _browser["process"]
    if p and p.poll() is None:
        p.stdin.write(json.dumps(msg) + "\n")
        p.stdin.flush()


async def _read_agent_until(event_names):
    loop = asyncio.get_event_loop()
    results = []
    while True:
        try:
            line = await loop.run_in_executor(None, _browser["process"].stdout.readline)
            if not line: break
            msg = json.loads(line.strip())
            results.append(msg)
            if msg.get("event") in event_names: break
        except Exception:
            break
    return results


# ── Session CRUD ──────────────────────────────────────────────────────

@router.get("/api/browser/sessions")
async def list_sessions():
    return [{"sessionId": sid, "stepIndex": 0, "busy": _browser["busy"],
             "createdAt": s.get("createdAt", ""), "stepCount": 0}
            for sid, s in _sessions.items()]


@router.get("/api/browser/session/status")
async def session_status():
    return {
        "ready": _browser["ready"],
        "busy": _browser["busy"],
        "alive": _browser["process"] is not None and _browser["process"].poll() is None,
    }


@router.get("/api/browser/watcher/status")
async def watcher_status():
    return {"connected": False}


@router.post("/api/browser/session")
async def create_session(request: Request):
    body = await request.json()
    model_id = body.get("model", "deepseek-v4-flash")

    if _browser["process"] is None or _browser["process"].poll() is not None:
        _browser["process"] = await _spawn_browser(model_id)
        if not await _wait_ready(_browser["process"]):
            return JSONResponse({"error": "Agent failed to start"}, status_code=500)
        _browser["ready"] = True
        _browser["stdin"] = _browser["process"].stdin
        print("[browser-global] Browser ready")

    sid = str(uuid.uuid4())
    _sessions[sid] = {"id": sid, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")}
    global _active_session_id
    _active_session_id = sid
    print(f"[browser-session] Created session {sid}")

    return {"sessionId": sid, "ready": True}


@router.delete("/api/browser/browser")
async def close_browser():
    p = _browser["process"]
    if p:
        try:
            _send_agent({"event": "close"})
            p.terminate()
            p.wait(timeout=10)
        except Exception:
            p.kill()
    _browser.update({"process": None, "stdin": None, "ready": False, "busy": False})
    _sessions.clear()
    return {"ok": True}


# ── Step / Continue ───────────────────────────────────────────────────

@router.post("/api/browser/session/{session_id}/step")
async def session_step(session_id: str, request: Request):
    body = await request.json()
    instruction = body.get("instruction", "")
    max_steps = body.get("maxSteps", 30)
    login_url = body.get("loginUrl", "")
    login_user = body.get("loginUser", "")
    login_pass = body.get("loginPass", "")

    if not _browser["ready"]:
        return JSONResponse({"error": "Session not ready"}, status_code=400)
    if _browser["busy"]:
        return JSONResponse({"error": "Session busy"}, status_code=400)

    _browser["busy"] = True
    msg = {
        "event": "step",
        "data": {
            "instruction": instruction, "max_steps": max_steps,
            "login_url": login_url, "login_user": login_user, "login_pass": login_pass,
        },
    }
    _send_agent(msg)

    try:
        results = await _read_agent_until(("step_done", "done", "phase_done", "error"))
    except Exception as e:
        results = [{"event": "error", "data": {"error": str(e)}}]
    finally:
        _browser["busy"] = False

    return {"ok": True, "results": results}


@router.post("/api/browser/session/{session_id}/continue")
async def session_continue(session_id: str, request: Request):
    body = await request.json()
    _send_agent({"event": "continue", "data": body.get("data", {})})
    return {"ok": True}


@router.post("/api/browser/session/{session_id}/intervene")
async def session_intervene(session_id: str, request: Request):
    body = await request.json()
    _send_agent({"event": "intervene", "data": body})
    return {"ok": True}


@router.post("/api/browser/session/{session_id}/rerun")
async def session_rerun(session_id: str, request: Request):
    body = await request.json()
    _send_agent({"event": "rerun", "data": body.get("data", {})})
    return {"ok": True}


# ── Trajectory ────────────────────────────────────────────────────────

@router.get("/api/browser/session/{session_id}/trajectories")
async def get_trajectories(session_id: str):
    return _trajectory_ids


@router.post("/api/browser/session/{session_id}/trajectory")
async def save_trajectory(session_id: str, request: Request):
    body = await request.json()
    tid = body.get("trajectoryId", str(uuid.uuid4()))
    data = body.get("data", body)
    _trajectories[tid] = data
    if tid not in _trajectory_ids:
        _trajectory_ids.insert(0, tid)
    # Also write to disk
    traj_dir = Path(SCRIPTS_DIR) / "trajectories"
    traj_dir.mkdir(parents=True, exist_ok=True)
    (traj_dir / f"{tid}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    # Update index
    idx_path = traj_dir / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else []
    idx.insert(0, {"trajectoryId": tid, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")})
    idx_path.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    return {"ok": True, "trajectoryId": tid}


@router.post("/api/browser/session/{session_id}/reset-trajectory")
async def reset_trajectory(session_id: str):
    _send_agent({"event": "reset_trajectory"})
    return {"ok": True}


@router.post("/api/browser/session/{session_id}/save-case-data")
async def save_case_data(session_id: str, request: Request):
    body = await request.json()
    case_id = body.get("id", str(uuid.uuid4()))
    case_dir = Path(SCRIPTS_DIR) / "case_data"
    case_dir.mkdir(parents=True, exist_ok=True)
    (case_dir / f"{case_id}.json").write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "id": case_id}


@router.delete("/api/browser/session/{session_id}")
async def delete_session(session_id: str):
    _sessions.pop(session_id, None)
    return {"ok": True}


# ── Watcher ───────────────────────────────────────────────────────────

@router.post("/api/browser/watcher/action")
async def watcher_action(request: Request):
    body = await request.json()
    _send_agent({"event": "quick_action", "data": body})
    return {"ok": True}


# ── Stubs ─────────────────────────────────────────────────────────────

@router.get("/api/models")
async def list_models_stub():
    return []

@router.get("/api/agents")
async def list_agents_stub():
    return []

@router.get("/api/skills")
async def list_skills_stub():
    return []
