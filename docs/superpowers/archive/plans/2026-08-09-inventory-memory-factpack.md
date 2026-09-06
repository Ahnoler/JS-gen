# T4-P2 inventory → memory Fact Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On successful `scan_editable_summary`, best-effort emit a `form_state` memory event with aggregate `form_inventory` facts via a small helper — never block the Agent return.

**Architecture:** Add `scripts/memory/inventory_emit.py` (`emit_editable_summary_memory`). Call it from `_form.scan_editable_summary` after building summary. Gated by existing `AI_MEMORY_EVENTS` inside `emit_memory_event`.

**Tech Stack:** Python agent memory writer; characterization scripts.

**Spec:** `docs/superpowers/specs/2026-08-09-inventory-memory-factpack-design.md`

## Global Constraints

- Never raise out of helper; never change summary return on emit failure.
- Never autofill / never write `task_list`.
- Aggregate facts only; truncate per spec constants.
- No new DB migration; use existing `form_state` event type.
- Do not flip `AI_MEMORY_FACT_PACK` default.
- scripts-only → CHANGELOG optional; still add brief Unreleased + `Python 同步提示：无` if touching behavior docs; backlog update required.
- TDD characterization.

## File map

| File | Role |
|------|------|
| `scripts/memory/inventory_emit.py` | truncate + facts + `emit_memory_event` |
| `scripts/controller/actions/_form.py` | one-line call after summary built |
| `scripts/characterization/characterize-inventory-memory.py` | helper + wiring asserts |
| `CHANGELOG.md` / backlog / spec status | docs |

---

### Task 1: Characterization red + helper green

**Files:** create `characterize-inventory-memory.py`; create `inventory_emit.py`

- [ ] Write failing tests: helper exported; given summary produces facts with attributes `container`, `pending_count`, `pending_labels`, `buttons`; truncation caps; `_form.py` calls `emit_editable_summary_memory`
- [ ] Implement helper to make unit tests pass (wiring assert may still fail until Task 2)
- [ ] Commit helper + char (or split red then green):  
  `feat: emit_editable_summary_memory helper for inventory facts`

---

### Task 2: Wire `scan_editable_summary`

**Files:** `_form.py`

- [ ] After `summary = build_editable_summary(...)`, call `emit_editable_summary_memory(summary, phase_number=...)` inside try or rely on helper swallow
- [ ] Resolve phase_number from case_data_store / known phase key (match existing recorder patterns; `None` OK)
- [ ] Full characterize-inventory-memory + characterize-scan-editable-summary green
- [ ] Commit: `feat: scan_editable_summary bypass-emits inventory memory facts`

---

### Task 3: Docs

- [ ] CHANGELOG Unreleased (scripts behavior; Python sync: 无)
- [ ] backlog T4-P2 已实施; next T4-P3 or T8
- [ ] Spec Status → Implemented
- [ ] Force-add plan/spec if committing docs
- [ ] Commit: `docs: CHANGELOG/backlog for T4-P2 inventory memory`

---

## Out of scope

- Auto inventory on phase start
- Fact Pack retrieve algorithm changes
- Per-field facts
- New feature flag beyond AI_MEMORY_EVENTS
