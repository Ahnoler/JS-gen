"""FormSnapshot entity — maps to `form_snapshot` and `snapshot_field` tables."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class FormSnapshotEntity(BaseModel):
    id: Optional[int] = None
    container: str = ""
    field_count: int = 0
    required_count: int = 0
    optional_count: int = 0
    action_index: int = 0
    case_data_id: Optional[int] = None
    trajectory_id: Optional[int] = None
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True


class SnapshotFieldEntity(BaseModel):
    id: Optional[int] = None
    form_snapshot_id: int = 0
    label: str = ""
    is_required: bool = False
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True
