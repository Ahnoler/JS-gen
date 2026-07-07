"""Case data routes — replaces src/routes/case-data.js"""
import json
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from config.settings import PROJECT_DIR

router = APIRouter()
CASE_DIR = Path(PROJECT_DIR) / "scripts" / "case_data"
INDEX_PATH = CASE_DIR / "index.json"


def _load_index():
    if INDEX_PATH.exists():
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    return []


def _save_index(data):
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@router.get("/api/case-data")
async def list_case_data():
    return _load_index()


@router.get("/api/case-data/{case_id}")
async def get_case_data(case_id: str):
    records = _load_index()
    record = next((r for r in records if r.get("id") == case_id), None)
    if not record:
        return JSONResponse({"error": "Case data not found"}, status_code=404)
    return record


@router.post("/api/case-data")
async def save_case_data(request: Request):
    body = await request.json()
    case_id = body.get("id") or str(int(__import__("time").time() * 1000))
    label = body.get("label", "Untitled")
    records = _load_index()

    existing = next((i for i, r in enumerate(records) if r.get("id") == case_id), None)
    entry = {"id": case_id, "label": label, "data": body.get("data", body)}
    if existing is not None:
        records[existing] = entry
    else:
        records.insert(0, entry)

    _save_index(records)
    return {"ok": True, "id": case_id}


@router.get("/api/case-data/{case_id}/file")
async def get_case_data_file(case_id: str):
    case_file = CASE_DIR / f"{case_id}.json"
    if not case_file.exists():
        return JSONResponse({"error": "File not found"}, status_code=404)
    return {"content": case_file.read_text(encoding="utf-8")}


@router.delete("/api/case-data/{case_id}")
async def delete_case_data(case_id: str):
    records = _load_index()
    records = [r for r in records if r.get("id") != case_id]
    _save_index(records)
    return {"ok": True}
