"""
Test history routes — replaces src/routes/test-history.js
"""
import json
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from config.settings import PROJECT_DIR

router = APIRouter()
GENERATED_DIR = Path(PROJECT_DIR) / "scripts" / "generated"


@router.get("/api/test/history")
async def list_history():
    index_path = GENERATED_DIR / "index.json"
    if index_path.exists():
        return json.loads(index_path.read_text(encoding="utf-8"))
    return []


@router.get("/api/test/history/{test_id}")
async def get_history(test_id: str):
    index_path = GENERATED_DIR / "index.json"
    if not index_path.exists():
        return JSONResponse({"error": "Not found"}, status_code=404)

    items = json.loads(index_path.read_text(encoding="utf-8"))
    item = next((i for i in items if i.get("testId") == test_id), None)
    if not item:
        return JSONResponse({"error": "Not found"}, status_code=404)

    # Attempt to load the script file
    file_name = item.get("fileName", "")
    if file_name:
        script_path = GENERATED_DIR / file_name
        if script_path.exists():
            item["script"] = script_path.read_text(encoding="utf-8")

    return item


@router.delete("/api/test/history/{test_id}")
async def delete_history(test_id: str):
    index_path = GENERATED_DIR / "index.json"
    if not index_path.exists():
        return JSONResponse({"error": "Not found"}, status_code=404)

    items = json.loads(index_path.read_text(encoding="utf-8"))
    items = [i for i in items if i.get("testId") != test_id]
    index_path.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")

    return {"ok": True}
