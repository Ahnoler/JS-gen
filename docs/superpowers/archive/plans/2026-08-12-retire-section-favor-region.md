# Retire `section` (favor `region`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gradually make `region=` the only agent-facing scope name for form assistant / pending / save, while keeping `section=` as a silent compatibility alias until a final removal phase.

**Architecture:** Five shipped phases (A→E). Agent-visible surface moves first (prompts, tool descriptions, return JSON preference, error codes); internal dual-read (`region or section`) and `section_id`/`section_title` TaskItem fields stay until Phase E. L1 taxonomy `region_role=section` is **out of scope** (different meaning). Spec: `docs/superpowers/specs/2026-08-12-retire-section-favor-region-design.md`.

**Tech Stack:** Python agent tools (`scripts/controller/actions/_form.py`, `section_scope.py`, `form_scan_utils.py`), markdown prompts (`scripts/prompts/`), characterization scripts under `scripts/characterization/`.

## Global Constraints

- Until Phase E: always dual-read `region or section`; prefer `region` when both set.
- Do not rename CDP/L1 `region_role: "section"` or `sectionAnchorXPath`.
- Prefer `region_label` in new agent-facing copy; do not invent a third synonym.
- Characterization must stay green after each phase.
- Pure `scripts/` changes: CHANGELOG optional; if any `src/` / `config/` / routes touch, update `CHANGELOG.md` `[Unreleased]` with Python sync hint.
- Related product work (assistant fill → region-scoped `click_save` → validate) can land in parallel but must use **`region=` only** in new prompt text.

## File map

| File | Role |
|------|------|
| `scripts/prompts/agent-core.md` | Core rules: region 收窄 / 保存 |
| `scripts/prompts/agent-tools-form.md` | Tool docs for assistant / pending / save |
| `scripts/prompts/form-prompt.md` | Form assistant LLM fragment (if it mentions section) |
| `scripts/controller/actions/_form.py` | Action params `region`/`section`, LEGACY alias, returns |
| `scripts/controller/actions/section_scope.py` | Match / filter / `requires_section_declaration` |
| `scripts/controller/actions/form_scan_utils.py` | Section summaries, payload keys |
| `scripts/controller/actions/phase/intent_gates.py` | Any section wording in gates |
| `scripts/characterization/characterize-*.py` / `.mjs` | Regression for dual-read + preferred keys |
| `docs/superpowers/specs/2026-08-12-retire-section-favor-region-design.md` | Design source of truth |

---

### Task 1: Phase A — Prompts teach only `region=` ✅ (`98eb370`)

**Files:**
- Modify: `scripts/prompts/agent-core.md` (region 收窄 / 阶段区域 bullets)
- Modify: `scripts/prompts/agent-tools-form.md` (`run_form_assistant` / `get_pending_tasks` / `click_save` / workflow)
- Modify: `scripts/prompts/form-prompt.md` only if it mentions agent `section=` (skip LLM-internal “区块” Chinese prose that is not the tool arg)
- Test: grep + optional existing characterize that snapshots prompt strings (if any)

**Interfaces:**
- Consumes: current dual wording (`region=` 优先；`section=` 仍兼容)
- Produces: Agent instructions that **only** show `region='…'` in examples; at most one footnote: “`section=` is deprecated alias — do not use”

- [ ] **Step 1: Inventory prompt mentions**

```bash
rg -n "section=" scripts/prompts/
rg -n "section=" scripts/controller/actions/_form.py
```

Record every agent-facing example that still leads with `section=`.

- [ ] **Step 2: Rewrite agent-core region bullets**

Replace patterns like:

```markdown
须带 `region=`（`section=` 仍兼容）
```

with:

```markdown
须带 `region=`（折叠/Tab/卡片标题，见 `sections[].region_label`）。勿再传 `section=`（已弃用别名）。
```

Keep auto-scope log wording human-readable; if logs still say `auto section=`, leave for Task 3 (or change log string to `auto region=` in Task 3).

- [ ] **Step 3: Rewrite agent-tools-form**

- `click_save` / `run_form_assistant` / `get_pending_tasks`: examples use **only** `region=`.
- Describe return fields as `region_label` first; if payload still has `section`, say “internal/compat — prefer `region_label`”.
- Workflow steps: `get_pending_tasks(region='…')` / `click_save('保存', region='…')` only.
- Remove “`section=` 仍兼容” from the primary sentence; optional single deprecation footnote at bottom of form tools section.

- [ ] **Step 4: Spot-check form-prompt**

If `form-prompt.md` tells the **browser agent** to pass `section=`, align with Task 1. Do **not** rename Chinese “区块/折叠区” narrative that describes page structure to the form LLM.

- [ ] **Step 5: Verify no primary teach of section=**

```bash
rg -n "section='" scripts/prompts/
rg -n "section=\"" scripts/prompts/
```

Expect zero **recommended** call examples. Deprecation footnote may still contain the word `section=`.

- [ ] **Step 6: Commit**

```bash
git add scripts/prompts/agent-core.md scripts/prompts/agent-tools-form.md scripts/prompts/form-prompt.md
git commit -m "$(cat <<'EOF'
docs(prompts): teach region= only for form scope

Deprecate section= in agent-facing examples so fill/save flows standardize on region.
EOF
)"
```

---

### Task 2: Phase B — Soft deprecate `section=` in tool surface

**Files:**
- Modify: `scripts/controller/actions/_form.py` (`run_form_assistant`, `get_pending_tasks`, `click_save` — param descriptions + resolve helper)
- Create or modify: `scripts/characterization/characterize-region-section-alias.py` (or extend an existing form/region characterize)
- Test: that characterize script

**Interfaces:**
- Consumes: ActionModel fields `region: str = ''`, `section: str = ''`
- Produces:
  - `_resolve_scope(region, section) -> str` (prefer region)
  - When `section` non-empty and `region` empty: one stderr/log line `[deprecate] section= is deprecated; use region=`
  - When both non-empty and differ: prefer `region`, log conflict once

- [ ] **Step 1: Write failing characterize for prefer-region**

```python
# characterize-region-section-alias.py (sketch)
from scripts.controller.actions.section_scope import section_matches  # or import resolve helper once extracted

def test_prefer_region_when_both_set():
    # After implementation: import _resolve_scope from _form or section_scope
    assert _resolve_scope(region="系统评级结论", section="征信信息") == "系统评级结论"

def test_section_alone_still_resolves():
    assert _resolve_scope(region="", section="系统评级结论") == "系统评级结论"
```

Run and confirm import/`_resolve_scope` missing → fail.

- [ ] **Step 2: Implement `_resolve_scope` in `section_scope.py`**

```python
def resolve_scope(region: str = "", section: str = "") -> str:
    """Agent-facing scope: prefer region; section is legacy alias."""
    r = norm_sec(region)
    s = norm_sec(section)
    if r:
        return r
    return s
```

Wire `_form.py` call sites that today do `(region or section or "").strip()` to `resolve_scope(region, section)`.

- [ ] **Step 3: Add deprecation log (once per call)**

```python
import logging
log = logging.getLogger(__name__)

def resolve_scope(region: str = "", section: str = "", *, warn: bool = True) -> str:
    r = norm_sec(region)
    s = norm_sec(section)
    if warn and s and not r:
        log.warning("[deprecate] section= is deprecated; use region= instead (got %r)", s)
    if warn and r and s and r != s:
        log.warning("[deprecate] both region=%r and section=%r set; using region", r, s)
    return r or s
```

- [ ] **Step 4: Update Action / schema descriptions**

Wherever tool param docs are generated from Python (Pydantic Field `description=`, or registry), set:

- `region`: “折叠/Tab/卡片区域标题（推荐）”
- `section`: “【已弃用】同 region；请改用 region=”

- [ ] **Step 5: Run characterize**

```bash
python scripts/characterization/characterize-region-section-alias.py
```

Expect pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/controller/actions/section_scope.py scripts/controller/actions/_form.py scripts/characterization/characterize-region-section-alias.py
git commit -m "$(cat <<'EOF'
feat(agent): soft-deprecate section= alias for form scope

Centralize resolve_scope(prefer region) and warn when callers still pass section=.
EOF
)"
```

---

### Task 3: Phase C — Agent payloads prefer `region_label`

**Files:**
- Modify: `scripts/controller/actions/form_scan_utils.py` (`_build_section_summary`, pending item dicts, button dicts)
- Modify: `scripts/controller/actions/_form.py` (assistant return JSON, `get_pending_tasks` shape)
- Modify: prompts if they still list `pending_items[…, section]` as required
- Test: extend `characterize-region-section-alias.py` or form-scan characterize

**Interfaces:**
- Consumes: TaskItem / scan objects with `section_id`, `section_title`, `region_label`
- Produces: Agent-visible dicts that **always** include `region_label` (and optional `region` mirror of the scope key). Keep `section` / `section_id` / `section_title` as optional compat keys until Phase E.

- [ ] **Step 1: Define preferred payload shape**

For each pending/button/section summary entry exposed to the agent:

```json
{
  "label": "…",
  "region_label": "系统评级结论",
  "xpath_smart": "…",
  "kind": "select"
}
```

Compat (still emitted for now):

```json
{
  "section": "系统评级结论",
  "section_id": "…",
  "section_title": "…"
}
```

`pending_by_section` → add parallel `pending_by_region` with same content; keep old key until Phase E.

- [ ] **Step 2: Write characterize asserting region_label present**

Assert assistant / pending JSON samples include `region_label` on field and button entries when a block title exists.

- [ ] **Step 3: Implement dual-write in builders**

In `_build_section_summary` / pending serializers:

- Primary display key: `region_label` (fallback: `section_title` or `section_id`)
- Still set legacy `section` = same display string if currently emitted

- [ ] **Step 4: Align prompts with preferred keys**

`agent-tools-form.md`: document `pending_items[{label, xpath_smart, kind, region_label}]` without requiring `section`.

- [ ] **Step 5: Run characterization + commit**

```bash
python scripts/characterization/characterize-region-section-alias.py
# plus any form_scan / pending characterize already in repo
git commit -m "$(cat <<'EOF'
feat(agent): prefer region_label in form pending payloads

Keep legacy section_* keys dual-written for compatibility during retirement.
EOF
)"
```

---

### Task 4: Phase D — Rename agent-visible errors and helper names (compat alias)

**Files:**
- Modify: `scripts/controller/actions/section_scope.py` (`requires_section_declaration` → wrap)
- Modify: `scripts/controller/actions/_form.py` (error strings / codes)
- Modify: `scripts/prompts/agent-core.md` / `agent-tools-form.md` (error names)
- Test: characterize error codes

**Interfaces:**
- Consumes: `requires_section_declaration(tl)`, `err-section-required`
- Produces:
  - `requires_region_declaration(tl)` (canonical); old name = alias calling new
  - Primary error code `err-region-required`; when emitting, also accept/document that old `err-section-required` may appear in older logs
  - Prefer log `[click_save] auto region=…` over `auto section=`

- [ ] **Step 1: Characterize new error code**

Assert `click_save` path that needs scope returns a message containing `err-region-required` (and optionally still contains old code during transition — pick **one** primary code to avoid double noise: prefer **replace** string with `err-region-required` and update prompts in the same task).

- [ ] **Step 2: Rename with alias**

```python
def requires_region_declaration(tl: "TaskList") -> bool:
    return len(pending_by_section(tl)) >= 2

def requires_section_declaration(tl: "TaskList") -> bool:
    """Deprecated alias for requires_region_declaration."""
    return requires_region_declaration(tl)
```

Optionally add `pending_by_region = pending_by_section` alias.

- [ ] **Step 3: Swap user-visible error / log strings**

Replace agent-facing `err-section-required` → `err-region-required` in `_form.py` and prompts.

- [ ] **Step 4: Run tests + commit**

```bash
python scripts/characterization/characterize-region-section-alias.py
git commit -m "$(cat <<'EOF'
refactor(agent): prefer err-region-required and region helper names

Keep deprecated section_* aliases for one more phase.
EOF
)"
```

---

### Task 5: Phase E — Remove `section=` tool alias (gate carefully)

> **2026-08-12 decision (controller):** **DEFER.** A–D shipped the same day; no session-log bake yet. Keep `section=` as dual-read alias + `[deprecate]` stderr warn. Revisit after product/logs show near-zero `section=` usage (or explicitly request hard remove).

**Files:**
- Modify: `scripts/controller/actions/_form.py` (drop `section` param from actions **or** hard-reject with clear error)
- Modify: `scripts/controller/actions/section_scope.py` (remove warn path for section-only if param gone)
- Modify: payloads — stop emitting legacy `section` key if product agrees
- Modify: prompts — delete deprecation footnote
- Test: characterize that `section=` is ignored or errors; `region=` required path still works

**Gate before starting:**

- [ ] Confirm product SPA / external docs do not document `section=`
- [ ] Confirm recent session logs rarely use `section=` (spot-check)
- [ ] Confirm Phase A–D merged and stable

**Interfaces:**
- Consumes: only `region`
- Produces: no ActionModel `section` field (or Field deprecated + ignored with `err-region-required` guidance)

- [ ] **Step 1: Decide removal mode**

Pick one:

1. **Hard remove** param from Pydantic models (cleanest; old LLM text with `section=` fails schema — usually OK if prompts cleaned).
2. **Ignore + error**: accept unknown/extra for a while — only if framework allows.

Prefer (1) after gate checklist.

- [ ] **Step 2: Write characterize expecting section param gone / rejected**

- [ ] **Step 3: Remove dual-read and LEGACY flags**

Delete `LEGACY_SECTION_RETIRE` if it only exists for this alias. Keep internal `section_id` / `section_title` on TaskItem if still used by scan JS — renaming those is **optional follow-up**, not required for Phase E.

- [ ] **Step 4: Strip compat keys from agent JSON (optional same PR)**

If low risk: stop emitting `section` / `pending_by_section` in agent returns; keep `region_label` / `pending_by_region` only.

- [ ] **Step 5: Full characterize subset + commit**

```bash
python scripts/characterization/characterize-region-section-alias.py
python scripts/characterization/characterize-form-rules.py
# any click_save / pending characterizes
git commit -m "$(cat <<'EOF'
breaking(agent): remove section= alias; region= is the only scope arg

Internal section_id/title may remain; agent tools and prompts use region only.
EOF
)"
```

---

### Task 6 (optional follow-up): Internal rename hygiene

**Not required for product clarity.** Only if maintainers want naming consistency:

- Rename module `section_scope.py` → `region_scope.py` (re-export shim for one release)
- Rename `section_id` → keep as stable storage key **or** dual-field `region_id` already from L1
- JS scan `sectionTitle` / Python mirrors — large blast radius; schedule separately

Do **not** mix this into Phase E unless characterization coverage is already strong.

---

## Dependency / ordering

```
Task 1 (prompts) → Task 2 (soft deprecate) → Task 3 (payload prefer)
        → Task 4 (error rename) → [gate] → Task 5 (remove alias)
        → Task 6 optional
```

Can ship Task 1 alone for immediate agent behavior improvement (especially with fill-then-**region**-save work).

## Parallel product track

Assistant maximize-fill → `click_save(region=…)` → agent fixes validation → re-save: implement against **`region=` only**. Do not add new `section=` call sites while this plan runs.

## Done when

- [ ] Prompts and tool docs lead with `region=` only
- [ ] `resolve_scope` + deprecation warnings live (until E)
- [ ] Agent payloads expose `region_label` as primary
- [ ] `err-region-required` is the taught error
- [ ] After gate, `section=` removed from ActionModel
- [ ] Characterization covers prefer-region, alias (pre-E), and post-E removal
