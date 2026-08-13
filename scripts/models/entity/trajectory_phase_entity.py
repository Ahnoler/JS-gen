"""TrajectoryPhase entity — maps to `trajectory_phase` table."""
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field


class TrajectoryPhaseEntity(BaseModel):
    id: Optional[int] = None
    phase_id: str = ""
    trajectory_id: int = 0
    phase_number: int = 0
    description: str = ""
    status: str = "completed"  # running | completed | failed
    created_at: datetime = Field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    done_logs: Optional[Any] = None

    class Config:
        from_attributes = True
