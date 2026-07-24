"""
StepEntry model — recorded controller action aligned with `trajectory_step` table.

Each entry is created by `_record_action()` in `_state.py` and stored in `_STEP_LOG`.
The format directly maps to `trajectory_step` columns for database persistence.

This model coexists with `ActionEntry` for backward compatibility:
- `StepEntry` -> `_STEP_LOG`, database `trajectory_step` table
- `ActionEntry` -> `action_{ts}.json` file format, `script_assembler` input
- `StepEntry.from_action()` bridges the two formats
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field

from .action import ElementInfo

StepSource = Literal['agent', 'manual', 'cdp']


class StepEntry(BaseModel):
    """One recorded controller action, aligned with `trajectory_step` table columns.

    Stored in `_STEP_LOG` (list[StepEntry]) in `_state.py`.
    Every field maps 1:1 to a `trajectory_step` column.
    """

    action: str = Field(default="", description="Action name -> action_type")
    params: dict = Field(default_factory=dict, description="Action parameters -> params_json")
    element: ElementInfo = Field(default_factory=ElementInfo, description="DOM element reference -> element_json")
    result: str = Field(default="", description="Result string -> extracted_content")
    description: str = Field(default="", description="Current goal (next_goal) -> description")
    success: Optional[bool] = Field(default=None, description="Whether the action succeeded -> success")
    error: Optional[str] = Field(default=None, description="Error message if failed -> error")
    trajectory_id: Optional[int] = Field(default=None, description="FK -> trajectory.id (set at persist time)")
    phase: int = Field(default=0, description="Phase number matching ActionEntry.phase")
    phase_number: int = Field(default=0, description="Alias for phase -> trajectory_step.phase_number")
    step_number: int = Field(default=0, description="Step order within the phase -> step_number")
    action_index: int = Field(default=0, description="Action index within step -> action_index")
    trajectory_phase_id: Optional[int] = Field(default=None, description="FK -> trajectory_phase.id")
    source: StepSource = Field(default='agent', description="agent | manual | cdp")

    class Config:
        from_attributes = True

    @classmethod
    def from_action(cls, entry, **context):
        """Build a StepEntry from an ActionEntry, with optional context overrides.

        Args:
            entry: ActionEntry instance or dict.
            **context: Override fields (e.g., description, phase_number, source).

        Returns:
            StepEntry with fields from ActionEntry plus context overrides.
        """
        from .action import ActionEntry, LocatorCandidate
        if not isinstance(entry, ActionEntry):
            entry = ActionEntry(**entry) if isinstance(entry, dict) else entry

        el = entry.element if isinstance(entry.element, dict) else {}
        raw_cands = el.get("candidates") if isinstance(el.get("candidates"), list) else []
        candidates = []
        for c in raw_cands:
            if isinstance(c, LocatorCandidate):
                candidates.append(c)
            elif isinstance(c, dict) and c.get("type") and c.get("value") is not None:
                candidates.append(LocatorCandidate(type=c.get("type"), value=str(c.get("value") or "")))

        return cls(
            action=entry.action,
            params=dict(entry.params) if entry.params else {},
            element=ElementInfo(
                tag_name=entry.tagName,
                xpath=entry.target,
                css_selector=entry.cssSelector,
                attributes=dict(entry.attributes) if entry.attributes else {},
                text=str(el.get("text") or ""),
                xpath_smart=str(el.get("xpath_smart") or ""),
                xpath_full=str(el.get("xpath_full") or ""),
                xpath_abs=str(el.get("xpath_abs") or ""),
                candidates=candidates,
            ),
            result=entry.result,
            phase=entry.phase,
            phase_number=entry.phase,
            **context,
        )

    def to_entity(self):
        """Convert to TrajectoryStepEntity for DAO persistence."""
        from .entity.trajectory_step_entity import TrajectoryStepEntity

        return TrajectoryStepEntity(
            trajectory_id=self.trajectory_id or 0,
            step_number=self.step_number,
            phase_number=self.phase_number or self.phase,
            action_index=self.action_index,
            action_type=self.action,
            description=self.description,
            params_json=dict(self.params) if self.params else None,
            element_json=self.element.to_element_json(),
            success=self.success,
            error=self.error,
            extracted_content=self.result,
            trajectory_phase_id=self.trajectory_phase_id,
            source=self.source,
        )
