"""OpenAI-compatible LLM proxy — replaces src/routes/llm-proxy.js"""
import json
import secrets
import time

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from config.settings import LLM_BASE_URL, PROJECT_DIR, _env_path

router = APIRouter()


def _get_api_key():
    """Read API key from .env at request time (supports setup page updates)."""
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


@router.get("/v1/models")
async def list_models():
    key = _get_api_key()
    if not LLM_BASE_URL or not key:
        return JSONResponse(
            {"error": {"message": "LLM_BASE_URL and LLM_API_KEY env vars are required", "type": "server_error"}},
            status_code=500,
        )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(f"{LLM_BASE_URL}/models", headers={"Authorization": f"Bearer {key}"})
            return JSONResponse(resp.json(), status_code=resp.status_code)
    except Exception as e:
        return JSONResponse({"error": {"message": str(e)}}, status_code=500)


@router.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    model_id = body.get("model")
    messages = body.get("messages", [])
    temperature = body.get("temperature")
    tools = body.get("tools")
    tool_choice = body.get("tool_choice")
    stream = body.get("stream")

    if not model_id:
        return JSONResponse({"error": {"message": "model is required", "type": "invalid_request_error"}}, status_code=400)
    if not messages:
        return JSONResponse({"error": {"message": "messages is required", "type": "invalid_request_error"}}, status_code=400)

    key = _get_api_key()
    if not LLM_BASE_URL or not key:
        return JSONResponse(
            {"error": {"message": "LLM_BASE_URL and LLM_API_KEY env vars are required", "type": "server_error"}},
            status_code=500,
        )
    if stream:
        return JSONResponse({"error": {"message": "streaming not supported", "type": "invalid_request_error"}}, status_code=400)

    completion_id = "chatcmpl-" + secrets.token_hex(12)
    now = int(time.time())

    try:
        payload = {"model": model_id, "messages": messages}
        if temperature is not None:
            payload["temperature"] = temperature
        if tools:
            payload["tools"] = tools
        if tool_choice:
            payload["tool_choice"] = tool_choice

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{LLM_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=payload,
            )
            data = resp.json()
            data["id"] = completion_id
            data["created"] = now
            return JSONResponse(data, status_code=resp.status_code if resp.is_success else resp.status_code)
    except Exception as e:
        return JSONResponse({"error": {"message": str(e), "type": "server_error"}}, status_code=500)
