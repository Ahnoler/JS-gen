"""FunctionDef entity — maps to `function_def` table."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class FunctionDefEntity(BaseModel):
    id: Optional[int] = None
    function_id: str = ""
    process_id: int = 0
    name: str = ""
    description: Optional[str] = None
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
