"""
Unified data models for the browser automation service.

All data structures that flow through the controller → assembler pipeline
are defined here with Pydantic v2 for strong typing, validation, and IDE support.

Usage:
    from scripts.models import (
        # Form scanning
        ScannedField, FormScanResult, Notification, FieldKind,

        # Form snapshots (replay validation)
        FormSnapshot, SnapshotField, FormSnapshotCollection,

        # Task list
        TaskItem, TaskList,

        # Action recording
        ActionEntry, ActionFile, ElementInfo, ActionType,
        ACTION_TO_COMMAND,

        # Step recording (aligned with trajectory_step table)
        StepEntry,

        # Entity / storage models (aligned with MySQL tables)
        SystemEntity, ProcessEntity, FunctionDefEntity,
        TrajectoryEntity, TrajectoryStepEntity, TrajectoryPhaseEntity,
        CaseDataEntity, CaseDataEntryEntity,
        FormSnapshotEntity, SnapshotFieldEntity,
        ScreenshotEntity,
        RemoteSessionEntity,
        ApiOverrideEntity,
    )
"""

from .field import (
    ContainerKind,
    FieldKind,
    FormScanResult,
    Notification,
    ScannedField,
)

from .form_snapshot import (
    FormSnapshot,
    FormSnapshotCollection,
    SnapshotField,
)

from .task import (
    TaskItem,
    TaskList,
)

from .action import (
    ACTION_TO_COMMAND,
    ActionEntry,
    ActionFile,
    ActionType,
    CommandType,
    ElementInfo,
    LocatorCandidate,
    LocatorCandidateType,
    SkippedActionType,
)

from .step_entry import StepEntry

from .entity import (
    CaseDataEntity,
    CaseDataEntryEntity,
    FormSnapshotEntity,
    FunctionDefEntity,
    ProcessEntity,
    ScreenshotEntity,
    SnapshotFieldEntity,
    SystemEntity,
    TrajectoryEntity,
    TrajectoryPhaseEntity,
    TrajectoryStepEntity,
    RemoteSessionEntity,
    ApiOverrideEntity,
)

__all__ = [
    # field
    "ContainerKind",
    "FieldKind",
    "FormScanResult",
    "Notification",
    "ScannedField",
    # form_snapshot
    "FormSnapshot",
    "FormSnapshotCollection",
    "SnapshotField",
    # task
    "TaskItem",
    "TaskList",
    # action
    "ACTION_TO_COMMAND",
    "ActionEntry",
    "ActionFile",
    "ActionType",
    "CommandType",
    "ElementInfo",
    "LocatorCandidate",
    "LocatorCandidateType",
    "SkippedActionType",
    # step_entry
    "StepEntry",
    # entity
    "CaseDataEntity",
    "CaseDataEntryEntity",
    "FormSnapshotEntity",
    "FunctionDefEntity",
    "ProcessEntity",
    "ScreenshotEntity",
    "SnapshotFieldEntity",
    "SystemEntity",
    "TrajectoryEntity",
    "TrajectoryPhaseEntity",
    "TrajectoryStepEntity",
    "RemoteSessionEntity",
    "ApiOverrideEntity",
]
