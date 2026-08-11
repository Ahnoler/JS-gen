"""ApiOverride entity — maps to `api_override` table (Node-managed)."""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

ApiOverrideMatchType = Literal['exact', 'prefix', 'regex']
ApiOverrideScope = Literal['global', 'system', 'process', 'function']


class ApiOverrideEntity(BaseModel):
    id: Optional[int] = None
    name: str = ""
    url_pattern: str = ""
    match_type: ApiOverrideMatchType = 'prefix'
    http_method: str = ""
    enabled: bool = True
    resp_status: int = 200
    resp_headers_json: Optional[dict] = None
    resp_body: Optional[str] = None
    scope: ApiOverrideScope = 'global'
    scope_ref_id: Optional[int] = None
    sort_order: int = 0
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
