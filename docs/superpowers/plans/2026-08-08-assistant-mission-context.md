# Assistant mission context + Agent final check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject phase mission + business data + readonly snapshots into the form assistant; skip uncertain fields as `needs_agent`; update main Agent prompt for final-check-then-save and remove outdated “assistant → direct click_save” guidance.

**Architecture:** `_form.py` builds an `AssistantMissionContext` from `case_data_store` / `_scan_fields` and passes it into `_llm_generate_values`. Form LLM returns actions + `needs_agent[]`. Auto-fill executes only actions; `run_form_assistant` surfaces `needs_agent` in its JSON. `form-prompt.md` + `agent-prompt.md` encode the new contract (prompt-only Agent final check — no click_save hard gate).

**Tech Stack:** Python agent (`_llm_values.py`, `_form.py`), markdown prompts, characterization scripts.

**Spec:** `docs/superpowers/specs/2026-08-08-assistant-mission-context-design.md`

## 分层总览（LV）

| 层 | 中文名 | 交付物 | Task |
|----|--------|--------|------|
| **L1** | Context builder | `build_assistant_mission_context` + 表征 | Task 1 |
| **L2** | Form LLM I/O | inject context; parse `needs_agent`; skip fills | Task 2 |
| **L3** | run_form_assistant surface | return JSON includes `needs_agent` | Task 3 |
| **L4** | form-prompt | mission-first + skip rules | Task 4 |
| **L5** | agent-prompt hygiene + final check | 终检 + 删过时直接 click_save | Task 5 |
| **L6** | CHANGELOG + full green | Unreleased + suite | Task 6 |

```
L1 context builder ──► L2 _llm_generate_values
                              │
                              ▼
                       L3 run_form_assistant JSON
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
        L4 form-prompt                  L5 agent-prompt
                              │
                              ▼
                           L6 CHANGELOG
```

## Global Constraints

- Approach **甲**: dual prompts + context injection + `needs_agent` handoff.
- Main Agent final check is **prompt-only** — no code gate blocking `click_save`.
- Assistant context = phase task + 【业务数据】 + same-section readonly/filled snapshot.
- Uncertain fields: **do not write**; add `{label, reason}` to `needs_agent`; leave pending for Agent.
- No regex hard-parse of phase NL into field mappings; no hardcoded「建议等级 := 系统评级等级」.
- Surgical `agent-prompt` hygiene only (remove conflicting outdated lines; do not full rewrite).
- `docs/` gitignored — commit `scripts/` / `CHANGELOG.md` / prompts when user asks.
- TDD: characterization red → green per task.
- Prefer small helpers in `_llm_values.py` (or thin `_assistant_context.py` if `_llm_values` grows unwieldy) over bloating `_form.py` further.

## File map

| File | Role |
|------|------|
| `scripts/actions/_llm_values.py` | Context build + LLM prompt + parse `needs_agent` |
| `scripts/actions/_form.py` | Pass context into generate; accumulate `needs_agent`; surface on assistant return |
| `scripts/prompts/form-prompt.md` | Mission-first assistant system prompt |
| `scripts/prompts/agent-prompt.md` | Final check + hygiene |
| `scripts/characterization/characterize-assistant-mission-context.py` | New characterization (create) |
| `CHANGELOG.md` | Unreleased Changed |

## Context sources (canonical keys)

Use whatever already exists on `case_data_store` (do not invent new persistence APIs):

| Context piece | Preferred keys (check in order) |
|---------------|----------------------------------|
| Phase task text | `_phase_intent.goal` / `_phase_intent.task_text_excerpt` / `_agent_task_text` / `_last_step_task` — **discover actual key in codebase during Task 1**; if only excerpt exists, use it + note in report |
| 业务数据 | `_case_scenario_text` (existing) |
| Scan snapshot | `_scan_fields` list of dicts (`label`, `currentValue`, `disabled`, `section_id`, `section_title`) |
| Section filter | `_assistant_section_filter` (set by `run_form_assistant`) |

`needs_agent` item shape: `{"label": str, "reason": str}`.

---

### Task 1（L1）：`build_assistant_mission_context` + characterization

**Files:**
- Modify: `scripts/actions/_llm_values.py` (add helpers)
- Create: `scripts/characterization/characterize-assistant-mission-context.py`

**Interfaces:**
- Produces:
  ```python
  def build_assistant_mission_context(case_data_store: dict | None, section: str = "") -> dict:
      """Return {
        'phase_task': str,
        'business_data': str,
        'related_snapshot': list[{'label': str, 'value': str, 'disabled': bool}],
        'instruction': str,  # default Chinese mission-aware instruction
      }
      """
  ```
- `related_snapshot`: fields from `_scan_fields` matching `section` (via same rules as `section_matches`) that are disabled **or** have non-empty `currentValue`; cap list length (e.g. 40) to bound tokens.
- Consumes: `case_data_store`, `section_matches` from `_section_scope`.

- [ ] **Step 1: Write failing characterization**

```python
#!/usr/bin/env python3
"""Characterize assistant mission context injection + needs_agent handoff."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.actions._llm_values import (  # noqa: E402
    build_assistant_mission_context,
    format_assistant_human_message,
    parse_form_llm_response,
)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def test_build_context_includes_task_business_snapshot() -> None:
    store = {
        "_case_scenario_text": "关键数据\n系统评级等级应对齐",
        "_scan_fields": [
            {
                "label": "系统评级等级",
                "currentValue": "A",
                "disabled": True,
                "section_id": "系统评级结论",
                "section_title": "系统评级结论",
            },
            {
                "label": "此次评级建议等级",
                "currentValue": "",
                "disabled": False,
                "section_id": "系统评级结论",
                "section_title": "系统评级结论",
            },
            {
                "label": "资产负债率",
                "currentValue": "35%",
                "disabled": False,
                "section_id": "评级等级测算",
                "section_title": "评级等级测算",
            },
        ],
        "_phase_intent": {
            "goal": "在系统评级结论区域根据系统评级等级选择建议评级并保存",
            "task_text_excerpt": "根据系统评级等级选择建议评级",
        },
    }
    ctx = build_assistant_mission_context(store, section="系统评级结论")
    assert_true("系统评级" in (ctx.get("phase_task") or ""), f"phase_task={ctx.get('phase_task')!r}")
    assert_true("关键数据" in (ctx.get("business_data") or ""), "business_data")
    labels = [r["label"] for r in ctx.get("related_snapshot") or []]
    assert_true("系统评级等级" in labels, f"snapshot should include readonly 系统评级等级, got {labels}")
    assert_true("资产负债率" not in labels, "other section excluded when section filter set")
    assert_true("跳过" in (ctx.get("instruction") or "") or "不确定" in (ctx.get("instruction") or ""),
                "instruction must not be bare 生成合理的测试数据")


def test_format_human_message_orders_context_before_fields() -> None:
    ctx = {
        "phase_task": "根据系统评级等级选择建议评级",
        "business_data": "关键数据\nX",
        "related_snapshot": [{"label": "系统评级等级", "value": "A", "disabled": True}],
        "instruction": "按任务背景填写；不确定则跳过并申报",
    }
    fields_block = '1. label: "此次评级建议等级", kind: select'
    msg = format_assistant_human_message(ctx, fields_block)
    i_task = msg.find("根据系统评级等级")
    i_fields = msg.find("此次评级建议等级")
    assert_true(0 <= i_task < i_fields, "mission context before field list")
    assert_true("系统评级等级" in msg and "A" in msg, "snapshot in message")


def main() -> int:
    test_build_context_includes_task_business_snapshot()
    test_format_human_message_orders_context_before_fields()
    print("characterize-assistant-mission-context: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL** (`ImportError` or missing symbols)

```bash
python scripts/characterization/characterize-assistant-mission-context.py
```

- [ ] **Step 3: Implement helpers in `_llm_values.py`**

Minimal shapes:

```python
def build_assistant_mission_context(case_data_store: dict | None, section: str = "") -> dict:
    store = case_data_store or {}
    # resolve phase_task from _phase_intent goal/excerpt (and any discovered key)
    # business_data = store.get('_case_scenario_text') or ''
    # related_snapshot from _scan_fields filtered by section_matches + (disabled or has value)
    # instruction = '按任务背景与相关字段快照填写；无法判断则跳过并申报 needs_agent，禁止无依据猜测。'
    ...


def format_assistant_human_message(ctx: dict, fields_block: str) -> str:
    # 【阶段任务】\n...\n【业务数据】\n...\n【相关字段快照】\nlabel=value\n\n当前表单待填字段：\n{fields_block}\n\n指令：{instruction}
    ...
```

- [ ] **Step 4: Run — expect PASS** (Task 1 tests only; `parse_form_llm_response` may be stubbed later — remove from import until Task 2 if needed)

If Step 1 imported `parse_form_llm_response` early, either implement a tiny stub or trim the import until Task 2.

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add scripts/actions/_llm_values.py scripts/characterization/characterize-assistant-mission-context.py
git commit -m "feat: build assistant mission context from phase/business/snapshot"
```

---

### Task 2（L2）：Wire `_llm_generate_values` — inject + parse `needs_agent`

**Files:**
- Modify: `scripts/actions/_llm_values.py`
- Modify: `scripts/characterization/characterize-assistant-mission-context.py`

**Interfaces:**
- Change signature (backward compatible):
  ```python
  def _llm_generate_values(
      llm, items, case_data_store=None,
      instruction: str | None = None,
      section: str = "",
  ) -> list | tuple[list, list]:
  ```
  **Prefer always return `(actions: list, needs_agent: list[dict])`** and update the single call site in `_form.py` in this task or Task 3. Document the chosen return type in the characterization.

- `parse_form_llm_response(parsed) -> tuple[list, list]`:
  - If LLM returns `{"actions": [...], "needs_agent": [...]}` → split
  - If LLM returns bare `[...]` → actions only, `needs_agent=[]`
  - Filter actions whose `label` appears in `needs_agent` (skip wins)

- HumanMessage uses `format_assistant_human_message(build_assistant_mission_context(...), field_lines)`.
- Default instruction comes from context builder when `instruction is None`.

- [ ] **Step 1: Extend characterization**

```python
def test_parse_form_llm_response_split() -> None:
    actions, needs = parse_form_llm_response({
        "actions": [
            {"action": "select_option", "label": "理由说明", "option": "x"},
            {"action": "select_option", "label": "此次评级建议等级", "option": "AA"},
        ],
        "needs_agent": [
            {"label": "此次评级建议等级", "reason": "应对齐系统评级等级"},
        ],
    })
    labels = [a.get("label") for a in actions]
    assert_true("此次评级建议等级" not in labels, "needs_agent label must not remain in actions")
    assert_true(any(n.get("label") == "此次评级建议等级" for n in needs), "needs_agent kept")


def test_llm_generate_uses_mission_context_in_prompt(monkeypatch_or_source) -> None:
    # Source inspection OK if no LLM: assert format_assistant_human_message /
    # build_assistant_mission_context referenced inside _llm_generate_values body
    src = (ROOT / "scripts/actions/_llm_values.py").read_text(encoding="utf-8")
    assert_true("build_assistant_mission_context" in src, "wired")
    assert_true("format_assistant_human_message" in src, "wired")
    assert_true("parse_form_llm_response" in src or "needs_agent" in src, "needs_agent path")
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement parse + wire HumanMessage + return `(actions, needs_agent)`**

Update call site in `_execute_round` (`_form.py` ~1333) to unpack:

```python
actions, needs = _llm_generate_values(llm, sub, case_data_store=case_data_store, section=filt)
# accumulate needs into case_data_store.setdefault('_assistant_needs_agent', [])
```

Clear `_assistant_needs_agent` at start of `_auto_fill_pending` / `run_form_assistant`.

- [ ] **Step 4: Run characterization — PASS**; also `python scripts/characterization/characterize-form-assistant.py`

- [ ] **Step 5: Commit** (if user asked)

```bash
git commit -m "feat: form LLM mission context and needs_agent parse"
```

---

### Task 3（L3）：Surface `needs_agent` on `run_form_assistant`

**Files:**
- Modify: `scripts/actions/_form.py` (`run_form_assistant` payload)
- Modify: characterization

- [ ] **Step 1: Characterization**

```python
def test_run_form_assistant_payload_mentions_needs_agent() -> None:
    form = (ROOT / "scripts/actions/_form.py").read_text(encoding="utf-8")
    chunk = form.split("async def run_form_assistant", 1)[1][:1200]
    assert_true("needs_agent" in chunk, "run_form_assistant returns needs_agent")
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```python
payload = {
    'status': ...,
    'section_filter': sec or None,
    'needs_agent': list(case_data_store.get('_assistant_needs_agent') or []),
    **_build_section_summary(...),
}
```

Ensure accumulation across `_execute_round` rounds; dedupe by label (last reason wins).

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** (if user asked)

```bash
git commit -m "feat: expose needs_agent on run_form_assistant result"
```

---

### Task 4（L4）：Update `form-prompt.md`

**Files:**
- Modify: `scripts/prompts/form-prompt.md`
- Modify: characterization

- [ ] **Step 1: Characterization markers**

```python
def test_form_prompt_mission_first() -> None:
    p = (ROOT / "scripts/prompts/form-prompt.md").read_text(encoding="utf-8")
    assert_true("needs_agent" in p, "documents needs_agent")
    assert_true("跳过" in p or "不确定" in p, "skip when unsure")
    assert_true("猜测" in p or "禁止" in p, "forbid unjustified guesses")
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Rewrite system rules** (keep action JSON types; add):

- Read 【阶段任务】/【业务数据】/【相关字段快照】 before choosing values.
- Prefer aligning selects to related snapshot values when task implies it.
- If unsure → omit from `actions`, list in `needs_agent: [{label, reason}]`.
- Return either `{"actions":[...],"needs_agent":[...]}` or actions-only array (legacy); prefer object form.
- `commandValue` still wins when present.
- Do not invent options not in `options` list.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** (if user asked)

---

### Task 5（L5）：`agent-prompt.md` final check + hygiene

**Files:**
- Modify: `scripts/prompts/agent-prompt.md`
- Modify: characterization

- [ ] **Step 1: Characterization**

```python
def test_agent_prompt_final_check_and_hygiene() -> None:
    p = (ROOT / "scripts/prompts/agent-prompt.md").read_text(encoding="utf-8")
    assert_true("needs_agent" in p or "终检" in p or "最终检查" in p, "final check")
    assert_true("草稿" in p or "不可默认" in p or "不默认" in p or "不可信" in p,
                "assistant not trusted by default")
    # obsolete direct-save line must be gone
    assert_true(
        "完成后（pending≈0）：直接调用 `click_save()`" not in p
        and "完成后（pending≈0）：直接调用 click_save()" not in p,
        "obsolete direct click_save after assistant removed",
    )
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Edit agent-prompt**

Add CRITICAL block near form-assistant section:

1. After `run_form_assistant`, read `needs_agent` — fill those fields yourself.
2. Final check vs 阶段任务 / 业务数据 / page readonly relationships (`check_field_value` as needed).
3. Only then `click_save` / `NEXT_ACTION`.
4. Assistant = draft; do not assume correctness.

Hygiene removals/replacements (must):

- Replace「`run_form_assistant` 完成后（pending≈0）：直接调用 `click_save()`」with final-check-then-save.
- Align examples that still imply bare save when sections/NEXT_ACTION exist.
- Leave valid rules (no index-click save, xpath-primary, section scope, unique-save auto).

- [ ] **Step 4: PASS** + skim for leftover contradictory “直接 click_save after assistant” phrases

- [ ] **Step 5: Commit** (if user asked)

```bash
git commit -m "docs: agent final-check after assistant; prompt hygiene"
```

---

### Task 6（L6）：CHANGELOG + full green

**Files:**
- Modify: `CHANGELOG.md`
- Modify: characterization if needed

- [ ] **Step 1: CHANGELOG under `[Unreleased]` → `### Changed`**

```markdown
- 2026-08-08: **表单助手注入阶段任务/业务数据/只读快照；不确定字段 `needs_agent` 交主 Agent：** `_llm_generate_values` 带使命上下文；吃不准不写入。`run_form_assistant` 返回 `needs_agent[]`。主 Agent prompt 要求终检后再保存，并清理「助手完直接 click_save」过时句。
  影响范围：run_form_assistant、form/agent prompts、自动填值。
  文件：scripts/actions/_llm_values.py, scripts/actions/_form.py, scripts/prompts/form-prompt.md, scripts/prompts/agent-prompt.md, scripts/characterization/characterize-assistant-mission-context.py
  Python 同步提示：无（scripts 子进程）。
```

- [ ] **Step 2: Full suite**

```bash
python scripts/characterization/characterize-assistant-mission-context.py
python scripts/characterization/characterize-form-assistant.py
python scripts/characterization/characterize-phase-section-scope.py
python scripts/characterization/characterize-xpath-primary-ops.py
```

Expected: all OK.

- [ ] **Step 3: Commit** (if user asked)

```bash
git commit -m "docs: CHANGELOG assistant mission context"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Context C (task + business + snapshot) | 1–2 |
| Skip unsure → `needs_agent` | 2–4 |
| Surface on `run_form_assistant` | 3 |
| form-prompt mission-first | 4 |
| Agent final check prompt-only | 5 |
| Prompt hygiene (no direct click_save after assistant) | 5 |
| No click_save hard gate / no hard field mapping | all (non-goals) |
| CHANGELOG | 6 |

## Self-review notes

- Return type of `_llm_generate_values` must be updated at the single call site — avoid silent drop of `needs_agent`.
- Snapshot must include **disabled** fields (系统评级等级) even though they are not pending.
- Section filter uses existing `section_matches`.
- Skipped labels stay pending (do not `mark_done`).
- Token cap on snapshot list.
