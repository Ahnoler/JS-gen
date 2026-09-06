"""SystemAccount entity — maps to `system_account` table (multi-role logins)."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class SystemAccountEntity(BaseModel):
    id: Optional[int] = None
    system_id: int = 0
    name: str = ""
    login_url: str = ""
    account: str = ""
    password: str = ""
    remark: Optional[str] = None
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
