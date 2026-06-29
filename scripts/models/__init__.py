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
    SkippedActionType,
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
    "SkippedActionType",
]
