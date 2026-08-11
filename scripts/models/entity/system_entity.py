"""System entity — unified hierarchy node in `system` table.

type: 0=根, 1=系统, 2=模块, 3=功能
id=0 is the sentinel root (type=0); type=1 systems have parent_id=0
url: system entry URL (meaningful for type=1 only)
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class SystemEntity(BaseModel):
    id: Optional[int] = None
    system_id: str = ""
    type: int = 1
    parent_id: int = 0
    name: str = ""
    description: Optional[str] = None
    url: str = ""
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
