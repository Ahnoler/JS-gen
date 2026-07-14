"""Screenshot entity — maps to `screenshot` table. image_data as MEDIUMBLOB."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ScreenshotEntity(BaseModel):
    id: Optional[int] = None
    file_name: str = ""
    image_data: bytes = Field(default=b"", description="PNG binary data (MEDIUMBLOB)")
    file_size: int = 0
    mime_type: str = "image/png"
    trajectory_id: Optional[int] = None
    step_index: int = 0
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True
