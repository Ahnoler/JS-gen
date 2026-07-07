"""
Smart Fill System — Python FastAPI server.
Replaces server.mjs (Node.js Express).
"""
import sys
from pathlib import Path

# Ensure project root in path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from config.settings import PORT, HOST, DASHBOARD_DIR, PROJECT_DIR, BROWSER_DIR, TMP_DIR
from src.state import state

app = FastAPI(title="Smart Fill System")

# ── Static files ──────────────────────────────────────────────────────
app.mount("/scripts", StaticFiles(directory=str(PROJECT_DIR / "scripts")), name="scripts")

# ── Setup (first-launch config) ───────────────────────────────────────
_current_api_key = None

def _is_configured():
    global _current_api_key
    from config.settings import _env_path, _env
    # Re-read .env each time (supports runtime changes)
    if _env_path.exists():
        try:
            for line in _env_path.read_text(encoding='utf-8').split('\n'):
                line = line.strip()
                if line.startswith('LLM_API_KEY='):
                    val = line.partition('=')[2].strip().strip('"').strip("'")
                    if val:
                        return True
        except Exception:
            pass
    return False


@app.get("/api/setup")
async def setup_page():
    return FileResponse(str(PROJECT_DIR / "config" / "setup.html"))


@app.get("/api/setup/status")
async def setup_status():
    return {"configured": _is_configured()}


@app.post("/api/setup/save")
async def setup_save(request: Request):
    from pathlib import Path as P
    body = await request.json()
    key = (body.get("LLM_API_KEY") or "").strip()
    if not key:
        return JSONResponse({"ok": False, "error": "API Key is required"}, status_code=400)

    url = body.get("LLM_BASE_URL") or "https://api.deepseek.com"
    model = body.get("FORM_LLM_MODEL") or "deepseek-v4-flash"

    env_path = P(PROJECT_DIR) / "config" / ".env"
    lines = [
        "# ---",
        "# Smart Fill System -- Runtime Config",
        "# ---",
        "",
        "PORT=4097",
        "HOST=0.0.0.0",
        "",
        f"LLM_BASE_URL={url}",
        f"LLM_API_KEY={key}",
        "",
        f"FORM_LLM_MODEL={model}",
        f"FORM_LLM_BASE_URL={url}",
        f"FORM_LLM_API_KEY={key}",
        "",
        "# PYTHON_EXE=",
        "# PROJECT_DIR=",
    ]
    try:
        env_path.write_text("\n".join(lines), encoding="utf-8")
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


# ── Dashboard ─────────────────────────────────────────────────────────
@app.get("/api/test")
async def dashboard():
    if not _is_configured():
        return RedirectResponse("/api/setup")
    return FileResponse(str(PROJECT_DIR / "test-dashboard.html"))


@app.get("/")
async def root():
    return RedirectResponse("/api/setup" if not _is_configured() else "/api/test")


@app.get("/api/test/screenshots/{path:path}")
async def screenshots(path: str):
    return FileResponse(str(Path(TMP_DIR) / path))


# ── Route modules ────────────────────────────────────────────────────
from routes.llm_proxy import router as llm_proxy_router
from routes.browser_session import router as browser_session_router
from routes.test_assemble import router as test_assemble_router
from routes.trajectory import router as trajectory_router
from routes.case_data import router as case_data_router
from routes.test_history import router as test_history_router
from routes.test_run import router as test_run_router
app.include_router(llm_proxy_router)
app.include_router(browser_session_router)
app.include_router(test_assemble_router)
app.include_router(trajectory_router)
app.include_router(case_data_router)
app.include_router(test_history_router)
app.include_router(test_run_router)

# ── Health ────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok"}


# ── Start ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"[server] Smart Fill System (Python)")
    if not _is_configured():
        print(f"[server] ⚠  LLM_API_KEY not set — visit http://localhost:{PORT}/api/setup to configure")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
