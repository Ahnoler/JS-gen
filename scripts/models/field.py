"""
Form field models — used by scan_form_fields / scan_visible_fields.

These models represent the output of the JS_SCAN_FORM_FIELDS browser evaluation,
which inspects .el-form-item elements inside the currently visible container
(dialog, drawer, tab pane, or main page).
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field

# ── Field kind ──────────────────────────────────────────────────────────────
FieldKind = Literal["input", "select", "date", "radio", "checkbox", "unknown"]

# ── Container kind ──────────────────────────────────────────────────────────
ContainerKind = Literal["main", "dialog", "drawer", "tab", "unknown"]


# ── Notification (el-notification popup) ───────────────────────────────────
class Notification(BaseModel):
    """Represents a visible el-notification popup on the page.

    Only captured when the notification is actually visible (positive dimensions,
    display != 'none'). Used to detect server-side validation errors.
    """

    visible: bool = True
    text: str = Field(
        default="",
        description="Notification text, whitespace-collapsed, max 300 chars",
    )


# ── Scanned form field ─────────────────────────────────────────────────────
class ScannedField(BaseModel):
    """One .el-form-item as returned by JS_SCAN_FORM_FIELDS.

    Fields use camelCase names to match the JS output exactly (JSON round-trip
    safe), so controller code can construct these directly from the browser
    evaluate result without renaming.
    """

    label: str = Field(
        default="",
        description="Text content of .el-form-item__label",
    )
    kind: FieldKind = Field(
        default="unknown",
        description="Classified by DOM element presence (input/select/date/radio/checkbox/unknown)",
    )
    currentValue: str = Field(
        default="",
        description="Current input value (DOM value, ARIA fallback, or attribute)",
    )
    options: list[str] = Field(
        default_factory=list,
        description="Available dropdown option texts (only populated for kind=select)",
    )
    placeholder: str = Field(
        default="",
        description="Placeholder attribute from the input element",
    )
    required: bool = Field(
        default=False,
        description="Three-level detection: is-required class, * in label, native required",
    )
    disabled: bool = Field(
        default=False,
        description="True if input is disabled, readOnly, or has aria-disabled='true'",
    )
    selected: bool = Field(
        default=False,
        description="True if a select option is currently selected",
    )


# ── Scan result (top-level) ────────────────────────────────────────────────
class FormScanResult(BaseModel):
    """Top-level result from JS_SCAN_FORM_FIELDS.

    Contains the container identifier, the list of scanned fields, and an
    optional notification if a visible error popup was detected.
    """

    container: str = Field(
        default="main",
        description="Container identifier: 'main', 'dialog:<title>', 'drawer:<label>', or 'tab:<tab-name>'",
    )
    fields: list[ScannedField] = Field(
        default_factory=list,
        description="All .el-form-item elements found in the container",
    )
    notification: Optional[Notification] = Field(
        default=None,
        description="Visible el-notification popup, if any",
    )

    # ── Convenience helpers ──────────────────────────────────────────────

    @property
    def empty_fields(self) -> list[ScannedField]:
        """Fields that are empty and enabled (candidates for filling)."""
        return [
            f
            for f in self.fields
            if not f.currentValue.strip() and not f.disabled
        ]

    @property
    def required_empty(self) -> list[ScannedField]:
        """Required fields that are empty and enabled."""
        return [f for f in self.empty_fields if f.required]

    @property
    def optional_empty(self) -> list[ScannedField]:
        """Optional fields that are empty and enabled."""
        return [f for f in self.empty_fields if not f.required]

    def parse_container(self) -> tuple[ContainerKind, str]:
        """Parse the container string into (kind, label).

        Returns:
            (kind, label) — e.g. ('dialog', '新增用户') or ('main', '')
        """
        if self.container == "main":
            return ("main", "")
        if self.container.startswith("dialog:"):
            return ("dialog", self.container[7:])
        if self.container.startswith("drawer:"):
            return ("drawer", self.container[7:])
        if self.container.startswith("tab:"):
            return ("tab", self.container[4:])
        return ("unknown", self.container)
