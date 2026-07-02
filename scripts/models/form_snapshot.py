"""
Form snapshot models — used for replay validation in generated Playwright scripts.

A snapshot captures the structure of a form (which fields exist, which are
required) at a specific point in the action sequence. The script assembler
injects `CTRL.verifyFormStructure()` calls that compare the current page
against these snapshots to detect form changes between recording and playback.
"""

from pydantic import BaseModel, Field


# ── Snapshot field (label + required flag) ─────────────────────────────────
class SnapshotField(BaseModel):
    """Minimal per-field metadata for structure comparison.

    Only stores label and required status — enough to detect added/removed
    fields and required/optional status changes without recording all DOM
    details.
    """

    label: str = Field(description="The .el-form-item__label text")
    is_required: bool = Field(
        default=False,
        description="True if the field was marked required at scan time",
    )


# ── Form snapshot entry ────────────────────────────────────────────────────
class FormSnapshot(BaseModel):
    """One form structure snapshot, scoped to a single container.

    Stored in case_data_store['form_snapshots'] (array, deduped by container)
    and case_data_store['form_snapshot'] (latest single entry).

    The action_index ties this snapshot to a position in the _ACTION_LOG so
    the assembler can place verifyFormStructure() at the correct point in the
    generated script.
    """

    container: str = Field(
        default="main",
        description="Container identifier: 'main', 'dialog:<title>', 'drawer:<label>', etc.",
    )
    fields: list[SnapshotField] = Field(
        default_factory=list,
        description="Field metadata (label + is_required) for every field in the container",
    )
    count: int = Field(
        default=0,
        description="Total number of fields in the snapshot",
    )
    required_count: int = Field(
        default=0,
        description="Number of required fields",
    )
    optional_count: int = Field(
        default=0,
        description="Number of optional fields (count - required_count)",
    )
    action_index: int = Field(
        default=0,
        description="Index into _ACTION_LOG at the time this snapshot was taken",
    )

    # ── Factory ──────────────────────────────────────────────────────────

    @classmethod
    def from_scan_fields(
        cls,
        container: str,
        scan_fields: list[dict],
        action_index: int = 0,
    ) -> "FormSnapshot":
        """Build a FormSnapshot from raw scan fields (controller dict format).

        Args:
            container: Container identifier string.
            scan_fields: List of field dicts from scan_form_fields().
            action_index: Current len(_ACTION_LOG) at snapshot time.
        """
        entries: list[SnapshotField] = []
        required_count = 0
        optional_count = 0

        for f in scan_fields:
            label = (f.get("label", "") or "").strip()
            if not label:
                continue
            is_req = f.get("required", False)
            entries.append(SnapshotField(label=label, is_required=is_req))
            if is_req:
                required_count += 1
            else:
                optional_count += 1

        return cls(
            container=container,
            fields=entries,
            count=len(entries),
            required_count=required_count,
            optional_count=optional_count,
            action_index=action_index,
        )


# ── Snapshot collection helpers ────────────────────────────────────────────
class FormSnapshotCollection:
    """Utility for managing the form_snapshots list in case_data_store.

    Provides dedup-by-container logic matching the existing controller pattern.
    Usage:
        coll = FormSnapshotCollection(case_data_store.get('form_snapshots', []))
        coll.upsert(snapshot)
        case_data_store['form_snapshots'] = coll.snapshots
    """

    def __init__(self, snapshots: list[FormSnapshot] | list[dict] | None = None):
        raw = snapshots or []
        self._snapshots: list[FormSnapshot] = [
            FormSnapshot(**s) if isinstance(s, dict) else s for s in raw
        ]

    @classmethod
    def from_store(cls, case_data_store: dict | None) -> "FormSnapshotCollection":
        """Create from case_data_store, with fallback from array to single entry.

        Prefers case_data_store['form_snapshots'] (array), falls back to
        case_data_store['form_snapshot'] (single entry). Returns an empty
        collection if neither exists.
        """
        if not case_data_store:
            return cls()
        raw = case_data_store.get('form_snapshots', [])
        if not raw:
            single = case_data_store.get('form_snapshot')
            if single:
                raw = [single]
        return cls(raw)

    @property
    def snapshots(self) -> list[FormSnapshot]:
        return self._snapshots

    def upsert(self, snapshot: FormSnapshot) -> bool:
        """Add or replace a snapshot by container. Returns True if replaced."""
        for i, s in enumerate(self._snapshots):
            if s.container == snapshot.container:
                self._snapshots[i] = snapshot
                return True
        self._snapshots.append(snapshot)
        return False

    def get(self, container: str) -> FormSnapshot | None:
        """Find a snapshot by container identifier."""
        for s in self._snapshots:
            if s.container == container:
                return s
        return None

    def to_dicts(self) -> list[dict]:
        """Export as list of dicts for backward-compat storage."""
        return [s.model_dump() for s in self._snapshots]
