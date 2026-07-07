"""Trajectory data routes — replaces src/routes/trajectory.js"""
import json
from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from config.settings import PROJECT_DIR

router = APIRouter()

TRAJ_DIR = Path(PROJECT_DIR) / "scripts" / "trajectories"
INDEX_PATH = TRAJ_DIR / "index.json"


def _load_index():
    if INDEX_PATH.exists():
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    return []


@router.get("/api/trajectory")
async def list_trajectories():
    records = _load_index()
    return [{
        "trajectoryId": r.get("trajectoryId"),
        "task": r.get("task"),
        "model": r.get("model"),
        "stepCount": r.get("stepCount"),
        "actionCount": r.get("actionCount"),
        "isSuccessful": r.get("isSuccessful"),
        "createdAt": r.get("createdAt"),
    } for r in records]


@router.get("/api/trajectory/{trajectory_id}")
async def get_trajectory(trajectory_id: str, full: bool = Query(False)):
    records = _load_index()
    record = next((r for r in records if r.get("trajectoryId") == trajectory_id), None)
    if not record:
        return JSONResponse({"error": "Trajectory not found"}, status_code=404)

    if full:
        traj_file = TRAJ_DIR / f"{trajectory_id}.json"
        if traj_file.exists():
            record = dict(record)
            record["trajectory"] = json.loads(traj_file.read_text(encoding="utf-8"))

    return record


@router.delete("/api/trajectory/{trajectory_id}")
async def delete_trajectory(trajectory_id: str):
    records = _load_index()
    idx = next((i for i, r in enumerate(records) if r.get("trajectoryId") == trajectory_id), None)
    if idx is None:
        return JSONResponse({"error": "Trajectory not found"}, status_code=404)

    del records[idx]
    INDEX_PATH.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")

    traj_file = TRAJ_DIR / f"{trajectory_id}.json"
    if traj_file.exists():
        traj_file.unlink()

    return {"status": "deleted", "trajectoryId": trajectory_id}
