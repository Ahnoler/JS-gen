"""
Task list models — manage the pending/done queue for form filling.

The task list is initialized from a FormScanResult (via init_task_list), and
individual items are moved from pending→done as fields are successfully filled.
Items in done can be moved back to pending by task_retry() or
sync_tasks_from_errors().
"""

from typing import Optional
from pydantic import BaseModel, Field

from .field import FieldKind


# ── Task item (one form field to fill or already filled) ────────────────────
class TaskItem(BaseModel):
    """A single form field tracked in the task list.

    Stores enough information for the LLM to decide what value to fill —
    including the field kind, current value, available options, and
    disabled/required status.

    Uses camelCase field names to match the existing controller dict format
    (same convention as ScannedField).
    """

    label: str = Field(
        default="",
        description="The .el-form-item__label text — used as the task identifier",
    )
    kind: FieldKind = Field(
        default="input",
        description="Field type classification: input, select, date, radio, checkbox",
    )
    currentValue: str = Field(
        default="",
        description="Current DOM value of the field (empty for pending items)",
    )
    options: list[str] = Field(
        default_factory=list,
        description="Available dropdown options (only for kind=select)",
    )
    placeholder: str = Field(
        default="",
        description="Input placeholder attribute",
    )
    disabled: bool = Field(
        default=False,
        description="True if the field is disabled or read-only",
    )
    required: bool = Field(
        default=False,
        description="True if the field is required",
    )
    hasButton: str = Field(
        default="",
        description="Button text if this field has an adjacent action button (引入/选择/验证/获取/获取地址), empty string otherwise.",
    )
    needs_intervention: bool = Field(
        default=False,
        description="True when field is disabled but has adjacent button — requires human-designed fill workflow.",
    )

    # ── Status checks ────────────────────────────────────────────────────

    @property
    def is_filled(self) -> bool:
        """A field is considered filled if it has a non-empty currentValue."""
        return bool(self.currentValue.strip())

    @property
    def is_pending(self) -> bool:
        """A field needs filling if it's empty and enabled."""
        return not self.is_filled and not self.disabled

    # ── Factory ──────────────────────────────────────────────────────────

    @classmethod
    def from_scanned(cls, field: dict) -> Optional["TaskItem"]:
        """Create a TaskItem from a raw scanned field dict.

        Returns None if the field should be skipped:
        - Already filled (has currentValue)
        - Disabled / read-only

        Fields with hasButton are kept in pending — their handling is
        determined by the caller (agent or auto-fill engine).
        """
        label = field.get("label", "")
        has_value = (field.get("currentValue", "") or "").strip() != ""
        is_disabled = field.get("disabled", False)
        has_button = field.get("hasButton", "") or ""

        # Filter: already filled → skip
        # Filter: disabled without button → truly unfillable → skip
        # Filter: disabled + not required → optional read-only, no need to fill
        if has_value:
            return None
        if is_disabled and not has_button:
            return None
        if is_disabled and not field.get("required", False):
            return None

        return cls(
            label=label,
            kind=field.get("kind", "input"),
            currentValue=field.get("currentValue", ""),
            options=field.get("options", []),
            placeholder=field.get("placeholder", ""),
            disabled=field.get("disabled", False),
            required=field.get("required", False),
            hasButton=has_button,
            needs_intervention=is_disabled and bool(has_button),
        )


# ── Task list ───────────────────────────────────────────────────────────────
class TaskList(BaseModel):
    """The complete task list stored in case_data_store['task_list'].

    Maintains two lists:
    - pending: fields still needing to be filled
    - done: fields that have been successfully filled
    """

    pending: list[TaskItem] = Field(
        default_factory=list,
        description="Fields still waiting to be filled",
    )
    done: list[TaskItem] = Field(
        default_factory=list,
        description="Fields that have been successfully filled",
    )

    # ── Core operations ──────────────────────────────────────────────────

    @property
    def total(self) -> int:
        return len(self.pending) + len(self.done)

    @property
    def is_complete(self) -> bool:
        """True when no pending items remain."""
        return len(self.pending) == 0

    def find_pending(self, label: str) -> Optional[TaskItem]:
        """Find a pending task by label text."""
        for item in self.pending:
            if item.label == label:
                return item
        return None

    def find_done(self, label: str) -> Optional[TaskItem]:
        """Find a done task by label text."""
        for item in self.done:
            if item.label == label:
                return item
        return None

    def find(self, label: str) -> Optional[tuple[str, TaskItem]]:
        """Find a task in either list. Returns (list_name, item) or None."""
        item = self.find_pending(label)
        if item:
            return ("pending", item)
        item = self.find_done(label)
        if item:
            return ("done", item)
        return None

    def mark_done(self, label: str) -> Optional[TaskItem]:
        """Move a task from pending to done. Returns the moved item or None."""
        for i, item in enumerate(self.pending):
            if item.label == label:
                self.pending.pop(i)
                self.done.append(item)
                return item
        return None

    def retry(self, label: str) -> TaskItem:
        """Move a task from done back to pending, or create a new one.

        Matching strategy:
        1. Exact match in done → move to pending
        2. Already in pending → return existing item (no-op)
        3. Not in either list → create new TaskItem(kind='input') in pending

        Always returns a TaskItem — never None.
        """
        # Tier 1: exact match in done — move to pending
        for i, item in enumerate(self.done):
            if item.label == label:
                self.done.pop(i)
                # 只读+有按钮 → 标记为需要人工干预
                if item.disabled and item.hasButton:
                    item.needs_intervention = True
                self.pending.append(item)
                return item
        # Tier 2: already in pending — no-op
        found = self.find_pending(label)
        if found:
            return found
        # Tier 3: not in either list — create new
        item = TaskItem(label=label, kind='input')
        self.pending.append(item)
        return item

    def sync_from_errors(self, error_labels: list[str]) -> list[TaskItem]:
        """Move tasks matching error labels from done back to pending.

        Matching strategy (three tiers):
        1. Exact match via find_done()
        2. Fuzzy match — bidirectional substring search across done labels
        3. Fallback — create a new TaskItem in pending if not found in either list

        Returns the list of retried/created items.
        """
        retried: list[TaskItem] = []
        for label in error_labels:
            # Tier 1: exact match
            found = self.find_done(label)
            if not found:
                # Tier 2: fuzzy — bidirectional substring
                for d in self.done:
                    if label in d.label or d.label in label:
                        found = d
                        break
            if found:
                self.retry(found.label)
                retried.append(found)
            elif self.find_pending(label) is None:
                # Tier 3: not in either list — create new
                item = TaskItem(label=label, kind='input')
                self.pending.append(item)
                retried.append(item)
        return retried

    # ── Factory ──────────────────────────────────────────────────────────

    @classmethod
    def from_scan(cls, fields: list[dict]) -> "TaskList":
        """Build a TaskList from raw scan fields, auto-filtering filled/disabled.

        Fields with a currentValue are placed directly in done[] so the task
        list always represents all DOM fields (not just empty ones).
        This prevents _ensure_scanned from falsely detecting a "new form"
        when the agent operates on a pre-filled field.

        Args:
            fields: Raw field dicts from scan_form_fields() result.
        """
        pending: list[TaskItem] = []
        done: list[TaskItem] = []
        for f in fields:
            has_value = (f.get("currentValue", "") or "").strip() != ""
            if has_value:
                done.append(TaskItem(
                    label=f.get("label", ""),
                    kind=f.get("kind", "input"),
                    currentValue=f.get("currentValue", ""),
                    options=f.get("options", []),
                    placeholder=f.get("placeholder", ""),
                    disabled=f.get("disabled", False),
                    required=f.get("required", False),
                    hasButton=f.get("hasButton", "") or "",
                ))
            else:
                item = TaskItem.from_scanned(f)
                if item is not None:
                    pending.append(item)
        return cls(pending=pending, done=done)

    @classmethod
    def from_store(cls, data: dict | None) -> "TaskList":
        """Deserialize from the case_data_store dict format."""
        if not data:
            return cls()
        return cls(
            pending=[TaskItem(**p) for p in data.get("pending", [])],
            done=[TaskItem(**d) for d in data.get("done", [])],
        )

    def to_store(self) -> dict:
        """Serialize to the case_data_store dict format."""
        return {
            "pending": [item.model_dump() for item in self.pending],
            "done": [item.model_dump() for item in self.done],
        }
