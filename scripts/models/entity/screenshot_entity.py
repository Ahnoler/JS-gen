"""Screenshot entity — maps to `screenshot` table. Image bytes are stored in MinIO or local pending; DB keeps object metadata."""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field


class ScreenshotEntity(BaseModel):
    id: Optional[int] = None
    storage_type: str = Field(default="minio", description="minio|local")
    retry_count: int = Field(default=0, description="本地暂存后的补传重试次数")
    last_retry_at: Optional[datetime] = Field(default=None, description="最后一次补传尝试时间")
    storage_path: Optional[str] = Field(default=None, description="MinIO object key")
    image_url: Optional[str] = Field(default=None, description="MinIO presigned URL or API URL")
    file_size: int = 0
    mime_type: str = "image/png"
    trajectory_id: Optional[int] = None
    trajectory_step_id: Optional[int] = None
    trajectory_phase_id: Optional[int] = None
    level_type: Optional[Literal["page", "popup"]] = None
    level_key: Optional[str] = None
    parent_level_key: Optional[str] = None
    kind: Literal["before", "after", "phase_highlight", "page_level"] = "after"
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True
