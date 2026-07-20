"""System entity — unified hierarchy node in `system` table.

type: 1=系统, 2=模块, 3=功能
parent_id: null for type=1; points to parent system.id otherwise
url: system entry URL (meaningful for type=1 only)
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class SystemEntity(BaseModel):
    id: Optional[int] = None
    system_id: str = ""
    type: int = 1
    parent_id: Optional[int] = None
    name: str = ""
    description: Optional[str] = None
    url: str = ""
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
