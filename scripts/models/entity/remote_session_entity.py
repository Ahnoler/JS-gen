"""RemoteSession entity — maps to `remote_session` table (Node-managed)."""
from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional
from pydantic import BaseModel, Field

RemoteSessionStatus = Literal['active', 'closed', 'crashed']
RemoteSessionIsolation = Literal['context', 'target']


class RemoteSessionEntity(BaseModel):
    id: Optional[int] = None
    session_uuid: str = ""
    browser_context_id: str = ""
    target_id: str = ""
    isolation: RemoteSessionIsolation = 'context'
    viewport_w: int = 0
    viewport_h: int = 0
    device_scale_factor: Decimal = Field(default=Decimal('1.00'))
    url: str = ""
    status: RemoteSessionStatus = 'active'
    created_at: datetime = Field(default_factory=datetime.now)
    closed_at: Optional[datetime] = None

    class Config:
        from_attributes = True
