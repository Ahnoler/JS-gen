"""BusinessData entity — maps to `business_data` / `business_data_entry` tables."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class BusinessDataEntity(BaseModel):
    id: Optional[int] = None
    record_id: str = ""
    session_id: str = ""
    model: str = ""
    description: str = ""
    key_count: int = 0
    raw_json: Optional[dict] = None
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True


class BusinessDataEntryEntity(BaseModel):
    id: Optional[int] = None
    business_data_id: Optional[int] = None
    trajectory_id: Optional[int] = None
    field_key: str = ""
    field_value: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True
