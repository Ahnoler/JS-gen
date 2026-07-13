"""
Action entry models — represent recorded controller actions in _ACTION_LOG.

Each action entry is created by _record_action() in controller.py and later
consumed by script_assembler.py to generate Playwright scripts. Entries are
also persisted to disk as action JSON files (action_<ts>.json) in the
atp-record import-compatible format.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field


# ── Action type ─────────────────────────────────────────────────────────────
# Actions that are recorded in _ACTION_LOG and appear in generated scripts.
ActionType = Literal[
    "fill_form_field",
    "fill_date_field",
    "select_option",
    "click_element_by_index",
    "click_menu_item",
    "click_table_row_button",
    "click_table_row_radio",
    "click_adjacent_button",
    "click_radio",
    "switch_tab",
    "close_dialog",
    "wait_for_loading",
    "go_to_url",
    "expand_all_el_tree",
    "save_form_snapshot",
]

# Actions that are SKIPPED by the script assembler (no Playwright code generated)
SkippedActionType = Literal[
    "scroll_down",
    "scroll_up",
    "get_page_state",
    "scan_form_fields",
    "scan_visible_fields",
    "check_field_value",
    "verify_field_value",
    "take_screenshot",
    "save_trajectory",
    "save_case_data",
    "read_case_data",
    "match_form_rule",
    "init_task_list",
    "get_pending_tasks",
    "sync_tasks_from_errors",
    "expand_all_el_tree",
    "select_tree_option",
    "login",
    "task_done",
    "task_retry",
    "save_form_snapshot",
]

# Command type (legacy format)
CommandType = Literal[
    "input", "select", "click", "tab", "close", "wait", "navigate", "expand",
]

# Mapping from action → command (must stay in sync with controller._ACTION_TO_COMMAND)
ACTION_TO_COMMAND: dict[str, CommandType] = {
    "fill_form_field": "input",
    "fill_date_field": "input",
    "select_option": "select",
    "click_element_by_index": "click",
    "click_menu_item": "click",
    "click_table_row_button": "click",
    "click_table_row_radio": "click",
    "click_adjacent_button": "click",
    "click_radio": "click",
    "switch_tab": "tab",
    "close_dialog": "close",
    "wait_for_loading": "wait",
    "go_to_url": "navigate",
    "expand_all_el_tree": "expand",
    "save_form_snapshot": "input",  # treated as input for command
}


# ── Element info (captured DOM reference) ──────────────────────────────────
class ElementInfo(BaseModel):
    """Captured DOM element reference for an action entry.

    Used by the assembler to generate resilient locators.
    """

    tag_name: str = Field(default="", description="Element tag name (e.g., input, button)")
    xpath: str = Field(default="", description="Relative XPath to the element")
    css_selector: str = Field(default="", description="CSS selector to the element")
    attributes: dict[str, str] = Field(
        default_factory=dict,
        description="Element attributes (class, type, id, placeholder, etc.)",
    )
    text: str = Field(default="", description="Visible text content of the element")


# ── Action entry ───────────────────────────────────────────────────────────
class ActionEntry(BaseModel):
    """One recorded action in the _ACTION_LOG.

    Created by _record_action() every time a controller action is executed.
    The action + params fields drive script generation. The element info
    provides DOM references for robust locator generation.
    """

    id: str = Field(
        default="",
        description="UUID v4 string, unique per entry",
    )
    timestamp: int = Field(
        default=0,
        description="Unix timestamp in milliseconds (int(time.time() * 1000))",
    )
    action: str = Field(
        default="",
        description="Action name (fill_form_field, select_option, click_element_by_index, etc.)",
    )
    params: dict = Field(
        default_factory=dict,
        description=(
            "Action-specific parameters. Keys vary by action:\n"
            "  fill_form_field / fill_date_field: {label_text, value}\n"
            "  select_option / click_radio:        {label_text, option_text}\n"
            "  click_element_by_index:             {index, tag_name, text}\n"
            "  click_menu_item:                    {menu_text}\n"
            "  click_table_row_button:             {row_text, button_text}\n"
            "  click_table_row_radio:              {row_text}\n"
            "  click_adjacent_button:              {label_text}\n"
            "  switch_tab:                         {tab_name}\n"
            "  close_dialog:                       {}\n"
            "  go_to_url:                          {url}\n"
            "  save_form_snapshot:                 snapshot_entry dict"
        ),
    )
    result: str = Field(
        default="",
        description="Result string, truncated to 200 chars",
    )
    command: str = Field(
        default="",
        description="Legacy command type: input, select, click, tab, close, wait, navigate, expand",
    )
    target: str = Field(
        default="",
        description="Relative XPath to the target element (from element info)",
    )
    cssSelector: str = Field(
        default="",
        description="CSS selector to the target element (from element info)",
    )
    tagName: str = Field(default="", description="Element tag name")
    attributes: dict[str, str] = Field(
        default_factory=dict,
        description="Element attributes dict",
    )
    phase: int = Field(
        default=0,
        description="Phase number (step_index). Used by Dashboard to group actions by phase.",
    )

    # ── Legacy compat (used by script_assembler) ────────────────────────

    @property
    def propertiesName(self) -> str:
        """Legacy alias: the label text for fill/select actions."""
        return self.params.get("label_text", "")

    @property
    def value(self) -> str:
        """Legacy alias: the fill value or click index."""
        if self.action in ("fill_form_field", "fill_date_field"):
            return self.params.get("value", "")
        if self.action == "click_element_by_index":
            return str(self.params.get("index", ""))
        return ""

    @property
    def targetType(self) -> str:
        """Legacy alias: always 'xpath'."""
        return "xpath"

    @property
    def type(self) -> str:
        """Legacy alias: always 'ATTRIBUTE'."""
        return "ATTRIBUTE"

    # ── Helpers ─────────────────────────────────────────────────────────

    @property
    def is_skipped_by_assembler(self) -> bool:
        """True if the script assembler will skip this action."""
        return self.action not in ACTION_TO_COMMAND

    @property
    def label_text(self) -> Optional[str]:
        """The form field label text, if this action targets a labeled field."""
        return self.params.get("label_text")

    @property
    def option_text(self) -> Optional[str]:
        """The selected option text, if this is a select/radio action."""
        return self.params.get("option_text")

    @property
    def element(self) -> dict:
        """Legacy element dict for atp-record format."""
        return {
            "tag_name": self.tagName,
            "xpath": self.target,
            "css_selector": self.cssSelector,
            "attributes": self.attributes,
            "text": "",
        }

    # ── Factory ─────────────────────────────────────────────────────────

    @classmethod
    def from_record(
        cls,
        action_name: str,
        params: dict,
        result: str = "",
        element: ElementInfo | dict | None = None,
        phase: int = 0,
    ) -> "ActionEntry":
        """Build an ActionEntry matching _record_action() output.

        Args:
            action_name: The controller action name.
            params: Action-specific parameters dict.
            result: Result string from the action.
            element: Optional captured DOM element info.
            phase: Phase number (step_index) for Dashboard grouping.
        """
        import uuid
        import time

        entry = cls(
            id=str(uuid.uuid4()),
            timestamp=int(time.time() * 1000),
            action=action_name,
            params=dict(params) if params else {},
            result=str(result)[:200] if result else "",
            command=ACTION_TO_COMMAND.get(action_name, action_name),
            phase=phase,
        )

        if element:
            elem = dict(element) if isinstance(element, dict) else element.model_dump()
            entry.target = elem.get("xpath", "") or ""
            entry.cssSelector = elem.get("css_selector", "") or ""
            entry.tagName = elem.get("tag_name", "") or ""
            attrs = elem.get("attributes", {})
            entry.attributes = attrs if isinstance(attrs, dict) else {}

        return entry


# ── Action file (persisted to disk) ─────────────────────────────────────────
class ActionFile(BaseModel):
    """The top-level structure of an action_<ts>.json file on disk.

    Compatible with the atp-record import format consumed by the dashboard.
    """

    id: str = Field(description="UUID for the exploration run")
    name: str = Field(default="browser-use-exploration", description="Run name")
    url: str = Field(default="http://unknown", description="Page URL at capture time")
    actions: list[ActionEntry] = Field(
        default_factory=list,
        description="Recorded action entries",
    )
    form_snapshot: Optional[str] = Field(
        default=None,
        description="Relative path to the form structure snapshot file (scripts/forms/form_<ts>.json)",
    )

    @classmethod
    def from_action_log(
        cls,
        actions: list[dict],
        url: str = "",
        name: str = "browser-use-exploration",
    ) -> "ActionFile":
        """Build an ActionFile from the raw _ACTION_LOG list."""
        import uuid
        return cls(
            id=str(uuid.uuid4()),
            name=name,
            url=url or "http://unknown",
            actions=[ActionEntry(**a) if isinstance(a, dict) else a for a in actions],
        )
