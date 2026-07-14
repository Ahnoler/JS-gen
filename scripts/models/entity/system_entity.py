"""System entity — maps to `system` table."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class SystemEntity(BaseModel):
    id: Optional[int] = None
    system_id: str = ""
    name: str = ""
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
