"""Trajectory entity — maps to `trajectory` table."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class TrajectoryEntity(BaseModel):
    id: Optional[int] = None
    trajectory_id: str = ""
    task: str = ""
    model: str = ""
    step_count: int = 0
    action_count: int = 0
    is_done: Optional[bool] = None
    is_successful: Optional[bool] = None
    url: str = ""
    function_id: Optional[int] = None
    remote_session_id: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
