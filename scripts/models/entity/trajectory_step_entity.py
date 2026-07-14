"""TrajectoryStep entity — maps to `trajectory_step` table."""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

StepSource = Literal['agent', 'manual', 'cdp']


class TrajectoryStepEntity(BaseModel):
    id: Optional[int] = None
    trajectory_id: int = 0
    step_number: int = 0
    phase_number: int = 0
    action_index: int = 0
    action_type: str = ""
    description: str = ""
    params_json: Optional[dict] = None
    element_json: Optional[dict] = None
    success: Optional[bool] = None
    error: Optional[str] = None
    extracted_content: str = ""
    trajectory_phase_id: Optional[int] = None
    source: StepSource = 'agent'
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True
