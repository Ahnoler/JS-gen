"""
Entity models — anemic Pydantic models that directly map to MySQL tables.

These are used for DAO-layer data transfer, NOT for runtime business logic.
Runtime logic uses the models in `scripts/models/` (ActionEntry, FormSnapshot, etc.).

Each entity class name matches the table (singular, PascalCase):
    SystemEntity       → system (type 1/2/3 统一层级)
    ProcessEntity      → deprecated (已并入 system type=2)
    FunctionDefEntity  → deprecated (已并入 system type=3)
    SystemAccountEntity → system_account
    TrajectoryEntity   → trajectory
    TrajectoryStepEntity   → trajectory_step
    TrajectoryPhaseEntity  → trajectory_phase
    CaseDataEntity     → case_data
    CaseDataEntryEntity    → case_data_entry
    FormSnapshotEntity     → form_snapshot
    SnapshotFieldEntity    → snapshot_field
    ScreenshotEntity   → screenshot
    RemoteSessionEntity → remote_session
    ApiOverrideEntity  → api_override
"""

from .system_entity import SystemEntity
from .system_account_entity import SystemAccountEntity
from .process_entity import ProcessEntity
from .function_def_entity import FunctionDefEntity
from .trajectory_entity import TrajectoryEntity
from .trajectory_step_entity import TrajectoryStepEntity, StepSource
from .trajectory_phase_entity import TrajectoryPhaseEntity
from .case_data_entity import CaseDataEntity, CaseDataEntryEntity
from .form_snapshot_entity import FormSnapshotEntity, SnapshotFieldEntity
from .screenshot_entity import ScreenshotEntity
from .remote_session_entity import RemoteSessionEntity, RemoteSessionStatus, RemoteSessionIsolation
from .api_override_entity import ApiOverrideEntity, ApiOverrideMatchType, ApiOverrideScope

__all__ = [
    "SystemEntity",
    "SystemAccountEntity",
    "ProcessEntity",
    "FunctionDefEntity",
    "TrajectoryEntity",
    "TrajectoryStepEntity",
    "StepSource",
    "TrajectoryPhaseEntity",
    "CaseDataEntity",
    "CaseDataEntryEntity",
    "FormSnapshotEntity",
    "SnapshotFieldEntity",
    "ScreenshotEntity",
    "RemoteSessionEntity",
    "RemoteSessionStatus",
    "RemoteSessionIsolation",
    "ApiOverrideEntity",
    "ApiOverrideMatchType",
    "ApiOverrideScope",
]
