"""
Script execution route — replaces src/routes/test-run.js
Executes assembled Playwright scripts via node run.cjs
"""
import asyncio
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from config.settings import PROJECT_DIR, SKILL_DIR, PYTHON_EXE

router = APIRouter()


async def _stream_script(script: str, file_name: str):
    """SSE stream for script execution."""
    script_path = Path(tempfile.gettempdir()) / file_name.replace("\\", "_").replace("/", "_")
    if not script_path.suffix:
        script_path = script_path.with_suffix(".js")
    script_path.write_text(script, encoding="utf-8")

    run_js = Path(SKILL_DIR) / "run.cjs"
    if not run_js.exists():
        yield f"event: log\ndata: {json.dumps({'type': 'error', 'message': f'run.cjs not found at {run_js}'})}\n\n"
        yield f"event: result\ndata: {json.dumps({'success': False, 'error': 'run.cjs not found'})}\n\n"
        yield f"event: done\ndata: {json.dumps({})}\n\n"
        return

    node_exe = str(PROJECT_DIR / "nodejs" / "node.exe")
    if not os.path.exists(node_exe):
        node_exe = "node"

    env = os.environ.copy()
    env["PLAYWRIGHT_SKIP_EXISTING"] = "1"

    yield f"event: log\ndata: {json.dumps({'type': 'info', 'message': f'Script saved: {script_path}'})}\n\n"
    yield f"event: log\ndata: {json.dumps({'type': 'step', 'message': f'Executing: {node_exe} run.cjs {script_path}'})}\n\n"
    yield f"event: status\ndata: {json.dumps({'phase': 'running', 'label': 'Executing Playwright script...'})}\n\n"

    try:
        proc = await asyncio.create_subprocess_exec(
            node_exe, str(run_js), str(script_path),
            cwd=SKILL_DIR,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        async for line in proc.stdout:
            text = line.decode("utf-8", errors="replace").rstrip()
            if text:
                yield f"event: log\ndata: {json.dumps({'type': 'output', 'message': text})}\n\n"

        await proc.wait()
        success = proc.returncode == 0

        yield f"event: result\ndata: {json.dumps({'success': success, 'exitCode': proc.returncode})}\n\n"

    except Exception as e:
        yield f"event: result\ndata: {json.dumps({'success': False, 'error': str(e)})}\n\n"
    finally:
        yield f"event: done\ndata: {json.dumps({})}\n\n"
        try:
            script_path.unlink(missing_ok=True)
        except Exception:
            pass


@router.post("/api/test/run")
async def run_script(request: Request):
    body = await request.json()
    script = body.get("script", "")
    if not script:
        return {"error": "script is required"}

    file_name = body.get("fileName", f"playwright-test-{int(time.time() * 1000)}.js")
    return StreamingResponse(
        _stream_script(script, file_name),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/api/test/run-sync")
async def run_script_sync(request: Request):
    body = await request.json()
    script = body.get("script", "")
    if not script:
        return {"error": "script is required"}

    file_name = body.get("fileName", f"playwright-{int(time.time() * 1000)}.js")
    script_path = Path(tempfile.gettempdir()) / file_name.replace("\\", "_").replace("/", "_")
    if not script_path.suffix:
        script_path = script_path.with_suffix(".js")
    script_path.write_text(script, encoding="utf-8")

    run_js = Path(SKILL_DIR) / "run.cjs"
    node_exe = str(PROJECT_DIR / "nodejs" / "node.exe")
    if not os.path.exists(node_exe):
        node_exe = "node"

    try:
        result = subprocess.run(
            [node_exe, str(run_js), str(script_path)],
            cwd=SKILL_DIR,
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, "PLAYWRIGHT_SKIP_EXISTING": "1"},
        )
        return {
            "success": result.returncode == 0,
            "output": result.stdout[-5000:] if len(result.stdout) > 5000 else result.stdout,
            "exitCode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Script timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        try:
            script_path.unlink(missing_ok=True)
        except Exception:
            pass
