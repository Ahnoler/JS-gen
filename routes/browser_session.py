"""
Browser session management — replaces src/routes/browser-session.js
"""
import asyncio
import json
import os
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from config.settings import PYTHON_EXE, PROJECT_DIR, PORT, _env_path

router = APIRouter()

# ── Global browser (shared across sessions, like state.globalBrowser) ──
_global_browser = {
    "process": None,
    "stdin": None,
    "ready": False,
    "busy": False,
    "step_index": 0,
}


def _get_api_key():
    try:
        if _env_path.exists():
            for line in _env_path.read_text(encoding='utf-8').split('\n'):
                if line.startswith('LLM_API_KEY='):
                    val = line.partition('=')[2].strip().strip('"').strip("'")
                    if val:
                        return val
    except Exception:
        pass
    return ''


async def _spawn_agent(model_id: str) -> subprocess.Popen:
    """Spawn Python agent subprocess (like spawnAgent in explore-utils.js)."""
    api_key = _get_api_key()
    base_url = f"http://localhost:{PORT}/v1"

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONPATH"] = str(PROJECT_DIR)
    env["OPENAI_API_KEY"] = api_key

    proc = subprocess.Popen(
        [PYTHON_EXE, "-m", "scripts.main", "--session", "--session-id", "global",
         "--model", model_id, "--base-url", base_url, "--api-key", api_key],
        cwd=str(PROJECT_DIR),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    # Read stderr in background
    async def _read_stderr():
        loop = asyncio.get_event_loop()
        while proc.poll() is None:
            try:
                line = await loop.run_in_executor(None, proc.stderr.readline)
                if line:
                    print(line.rstrip())
            except Exception:
                break

    asyncio.create_task(_read_stderr())

    return proc


async def _wait_for_ready(proc: subprocess.Popen, timeout: float = 15.0) -> bool:
    """Wait for 'ready' event from agent stdout."""
    loop = asyncio.get_event_loop()
    deadline = time.time() + timeout

    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            line = await loop.run_in_executor(None, proc.stdout.readline)
            if not line:
                await asyncio.sleep(0.1)
                continue
            msg = json.loads(line.strip())
            if msg.get("event") == "ready":
                return True
        except (json.JSONDecodeError, Exception):
            continue

    return False


@router.get("/api/browser/session/status")
async def session_status():
    return {
        "ready": _global_browser["ready"],
        "busy": _global_browser["busy"],
        "alive": _global_browser["process"] is not None and _global_browser["process"].poll() is None,
    }


@router.get("/api/browser/sessions")
async def list_sessions():
    return {"sessions": [], "ready": _global_browser["ready"]}


@router.get("/api/browser/watcher/status")
async def watcher_status():
    return {"connected": False}


@router.post("/api/browser/session/start")
async def session_start(request: Request):
    body = await request.json()
    model_id = body.get("model", "deepseek-v4-flash")

    if _global_browser["process"] is None or _global_browser["process"].poll() is not None:
        _global_browser["process"] = await _spawn_agent(model_id)
        ready = await _wait_for_ready(_global_browser["process"])
        if not ready:
            return JSONResponse({"error": "Python agent failed to start"}, status_code=500)
        _global_browser["ready"] = True
        _global_browser["stdin"] = _global_browser["process"].stdin

    return {"ok": True, "ready": _global_browser["ready"]}


@router.post("/api/browser/session/step")
async def session_step(request: Request):
    """Send a step instruction to the agent and get the response."""
    body = await request.json()
    instruction = body.get("instruction", "")
    max_steps = body.get("maxSteps", 30)

    if not _global_browser["ready"] or _global_browser["process"] is None:
        return JSONResponse({"error": "Session not ready"}, status_code=400)

    if _global_browser["busy"]:
        return JSONResponse({"error": "Session busy"}, status_code=400)

    _global_browser["busy"] = True
    _global_browser["step_index"] += 1

    proc = _global_browser["process"]
    step_msg = {"event": "step", "data": {"instruction": instruction, "max_steps": max_steps}}

    try:
        loop = asyncio.get_event_loop()
        proc.stdin.write(json.dumps(step_msg) + "\n")
        proc.stdin.flush()

        # Collect agent response lines
        results = []
        while True:
            line = await loop.run_in_executor(None, proc.stdout.readline)
            if not line:
                break
            try:
                msg = json.loads(line.strip())
                results.append(msg)
                if msg.get("event") in ("step_done", "done", "error"):
                    break
            except json.JSONDecodeError:
                continue
    except Exception as e:
        results.append({"event": "error", "data": {"error": str(e)}})
    finally:
        _global_browser["busy"] = False

    return {"ok": True, "results": results}


@router.post("/api/browser/session/close")
async def session_close():
    """Close the browser session."""
    proc = _global_browser["process"]
    if proc:
        try:
            proc.stdin.write(json.dumps({"event": "close"}) + "\n")
            proc.stdin.flush()
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
    _global_browser["process"] = None
    _global_browser["ready"] = False
    _global_browser["busy"] = False
    return {"ok": True}
