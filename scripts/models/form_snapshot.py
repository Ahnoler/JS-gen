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

    Stored in case_data_store['form_snapshots'] (array, deduped by fields content)
    and case_data_store['form_snapshot'] (latest single entry).

    The action_index ties this snapshot to a position in the _ACTION_LOG so
    the assembler can place verifyFormStructure() at the correct point in the
    generated script.

    Container naming: when multiple snapshots share the same container base name
    (e.g. several "main" forms in a multi-step workflow), the collection auto-
    appends "#2", "#3", etc. based on insertion order.
    """

    container: str = Field(
        default="main",
        description="Container identifier: 'main', 'dialog:<title>', 'drawer:<label>', or 'main#2' etc.",
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

    # ── Fingerprint (for dedup-by-content) ─────────────────────────────────

    @property
    def fields_fingerprint(self) -> tuple[tuple[str, bool], ...]:
        """Ordered fingerprint: one (label, is_required) tuple per field.

        Two snapshots with the same fingerprint represent the same form —
        later scans replace earlier ones.  Different fingerprints mean
        different forms, even if they share the same container name.
        """
        return tuple((f.label, f.is_required) for f in self.fields)

    @staticmethod
    def _root_container(container: str) -> str:
        """Strip auto-number suffix: 'main#2' → 'main', 'dialog:x' → 'dialog:x'."""
        import re
        return re.sub(r'#\d+$', '', container)

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

    Dedup-by-content: compares fields_fingerprint (ordered (label, is_required)
    tuples).  Same fingerprint → replace (newer scan of same form).  Different
    fingerprint → new entry.  When multiple snapshots share the same container
    base name (e.g. "main"), later ones get "#2", "#3", etc. suffixes.

    Usage:
        coll = FormSnapshotCollection(case_data_store.get('form_snapshots', []))
        coll.upsert(snapshot)
        case_data_store['form_snapshots'] = coll.to_dicts()
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
        """Always append — each scan is a verification point at a specific
        action_index, even for the same form.  Cascading fields (选完A出现B)
        mean the same container can yield different structures at different
        points in the workflow.

        Auto-numbers container name on collision: "main" → "main#2" → "main#3".

        Returns False (never replaces).
        """
        root = FormSnapshot._root_container(snapshot.container)
        used_names = {s.container for s in self._snapshots}

        if snapshot.container in used_names:
            n = 2
            while f'{root}#{n}' in used_names:
                n += 1
            snapshot.container = f'{root}#{n}'

        self._snapshots.append(snapshot)
        return False

    def get(self, container: str) -> FormSnapshot | None:
        """Find a snapshot by exact container name (including any '#N' suffix)."""
        for s in self._snapshots:
            if s.container == container:
                return s
        return None

    def get_by_root(self, root_container: str) -> list[FormSnapshot]:
        """Return all snapshots whose root container name matches (e.g. 'main'
        matches 'main', 'main#2', 'main#3')."""
        return [s for s in self._snapshots
                if FormSnapshot._root_container(s.container) == root_container]

    def to_dicts(self) -> list[dict]:
        """Export as list of dicts for backward-compat storage."""
        return [s.model_dump() for s in self._snapshots]
