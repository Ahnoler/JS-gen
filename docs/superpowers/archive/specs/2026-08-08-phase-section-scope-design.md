# Phase task ↔ section scope (LLM-declared) — Design

**Date:** 2026-08-08  
**Status:** Draft for user review  
**Note:** `docs/` is gitignored in this repo; local-only like prior superpowers specs.  
**Related:** xpath-primary ops; control-ops section chunks; log `err-pending-fields:["借款企业","法定代表人"]` on phase「系统评级结论…保存」.

## E2E baseline (CDP 9242, 2026-08-08)

Page: 客户评级申请修改视图（`FS00005854…` / `bsnPk=PJ20260806012032` 一类）。

| Collapse `section_title` | Action buttons (visible) | Scan notes |
|--------------------------|--------------------------|------------|
| 评级基本情况 | — | 14 fields, all disabled |
| 征信信息 | — | **2 editable empty radios: 借款企业, 法定代表人** |
| 评级等级测算 | 模拟 / 测算 / **暂存** | 25 editable fields (filled in baseline) |
| 系统评级结论 | **保存** | 6 fields; **0 editable-empty** in baseline |
| 历年评级情况 | — | (no editable in scan sample) |
| 客户综合评价 | **保存** | 1 editable empty: 综合评价 |
| (root) | 下一步 / 返回 | outside collapse |

**Gate simulation on this DOM:**

- Global fillable pending includes 征信 `借款企业` / `法定代表人` → today’s `click_save('保存')` returns `err-pending-fields` even when 系统评级结论 is already written.
- Section-scoped pending for `系统评级结论` → **empty** → save should be allowed.

**Scan caveat:** `buttons[]` may collapse multiple「保存」to one xpath (`//button[normalize-space()='保存']`) via xpath dedupe — **section on click_save remains required** for correct button targeting, not only for the pending gate.

## Problem

Phase tasks name a **UI block** (collapse/card), e.g.「在“系统评级结论”区域…然后点击保存」.  
Scan already attaches `section_id` / `section_title` to fields and buttons.  
But `check_pending_write_gate` / `can_submit_writes` treat **all** fillable pending in the container as blockers.

Result: unrelated block pending (征信 radios) blocks save for the phase’s block. That coupling is wrong for multi-collapse maintain pages.

## Goals

1. **LLM declares scope** via explicit `section=` (or equivalent) — no regex/contract hard-parse of phase text into section ids.
2. **Save gate** only considers fillable pending **inside the declared section**.
3. **Pending / assistant** can optionally filter by the same `section` so the Agent is not forced to “finish” the whole page.
4. Preserve existing multi-「保存」disambiguation via `click_save(..., section=)`.

## Non-goals

- Hard-coding section ids into phase-intent / phase-boundary JSON from NL.
- Removing the write gate entirely (recording still needs “writes before save” **within scope**).
- Full-page Agent DOM inventory redesign.
- Fixing button xpath dedupe for duplicate「保存」as a separate project (call out only; section click path must keep working).

## Approach (chosen): 甲 — `section` through gate + lists

Agent/LLM decides the block from the phase description and passes `section=` on save / pending / optional assistant. Code only filters; it does not invent the section from the contract.

Rejected:

- **乙** — gate-only change (assistant still fills whole page; noisy pending).
- **丙** — soft warn and allow save with cross-section pending (too loose for recording).
- Contract regex extraction of 「系统评级结论」(user rejected hard constraints).

## §1 — Principles and save gate

**Principle:** Scope is LLM-declared. Code does not parse phase copy for section titles.

**`click_save(button_text, section='')`:**

| `section` | Behavior |
|-----------|----------|
| **Non-empty** | Pending gate counts only fillable items whose `section_id` / `section_title` match (same normalization as existing save-button section match, including `#n` if already supported). Other sections **do not** block. Button click still section-scoped. |
| **Empty** | If fillable pending spans **≥2 distinct sections** → **do not click**; return `err-section-required` with `pending_by_section` summary. If pending is empty or confined to ≤1 section → keep current allow path. |

Matching: normalize and compare to `section_title` / `section_id` consistently with today’s `click_save` section filter (prefer exact; allow existing title containment / `#n` rules already in code — pick one and document in implementation plan).

## §2 — Pending / assistant API + prompt

| API | Change |
|-----|--------|
| `get_pending_tasks(section='')` | Non-empty → only that section’s pending. Empty → full list, but each item includes `section_id` / `section_title`, plus `pending_by_section` summary for LLM. |
| `run_form_assistant(section='')` | Non-empty → auto-fill only that section’s editable fields. Empty → current whole-container behavior; keep `sections[]` in the response. |
| `click_save` | §1 |

**Prompt (`agent-prompt.md`):**

- When the phase names a region, prefer `run_form_assistant(section=…)`, `get_pending_tasks(section=…)`, then `click_save('保存'|…, section=…)`.
- On `err-section-required` / section-local `err-pending-fields`, use `pending_by_section` to choose the phase’s block — **do not** fill unrelated collapses just to clear the global gate.
- Do **not** instruct “regex the phase title”; instruct “judge from 阶段目录 / 当前任务”.

## §3 — Error codes, tests, success

| Code | When |
|------|------|
| `err-section-required` | `click_save` without `section`, and fillable pending spans ≥2 sections |
| `err-pending-fields:[…]` | `section` set, but **that section** still has fillable pending (labels from that section only) |
| Existing save errors | Unchanged (`err-save-ambiguous`, validation, etc.) |

**Characterization:**

1. Store pending = {征信.借款企业, 征信.法定代表人} + 系统评级结论 fields done → `click_save(section='系统评级结论')` is **not** blocked by 征信.
2. Same pending, `click_save` with empty section → `err-section-required`.
3. `get_pending_tasks(section='系统评级结论')` excludes 征信 labels.
4. Prompt mentions `section=` + `err-section-required`.

**Success (this product case):** Phase「系统评级结论…点击保存」with LLM-supplied `section='系统评级结论'` is not blocked by 征信 empty radios.

## Data flow

```
phase task (NL) ──LLM judges──► section title/id
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
run_form_assistant(section)   get_pending_tasks(section)   click_save(..., section)
        │                             │                             │
        └──────── filter TaskItem/scan by section_* ────────────────┘
                                      │
                         pending gate (scoped) → click 保存 in that block
```

## Out of scope reminders

- Phase-boundary `requires_write_all_editable` semantics become **“all editable in declared section”** when `section` is set; when unset, empty-section rules above apply (may still require section on multi-collapse pages).
- Duplicate「保存」xpath dedupe in scan: follow-up; rely on section-scoped click in the meantime.
