"""Process entity — maps to `process` table."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ProcessEntity(BaseModel):
    id: Optional[int] = None
    process_id: str = ""
    system_id: int = 0
    name: str = ""
    description: Optional[str] = None
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
