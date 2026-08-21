# Design: Gradually retire `section` in favor of `region`

**Date:** 2026-08-12  
**Status:** Approved — Phases A–D implemented (2026-08-12). Phase E (hard-remove `section=` param) **deferred** until bake/log evidence.

## Problem

Agent-facing APIs already prefer `region=` (`run_form_assistant` / `get_pending_tasks` / `click_save`), with `section=` as a legacy alias (`LEGACY_SECTION_RETIRE`). Internals and prompts still mix:

- Tool params: `region` + `section`
- Payload keys: `region_label` alongside `section` / `section_id` / `section_title`
- Error codes: `err-section-required`, `err-save-ambiguous`
- Module/helpers: `section_scope.py`, `requires_section_declaration`, `pending_by_section`
- Prompts still teach “`section=` 仍兼容”

This confuses agents (two names for one concept) and slows the fill → **region-scoped save** product path.

## Goal

Make **`region` the only agent-facing name** for fold/card/tab scope. Keep L1 taxonomy `region_role=section` (meaning “page block”) unchanged — that is not the tool parameter.

## Non-goals

- Do not rename DOM/L1 `region_role: "section"` or `sectionAnchorXPath` in CDP.
- Do not require a big-bang rename of every internal `section_id` in one PR.
- Do not break old trajectories/logs that already contain `section=` in recorded agent text.

## Phased approach

| Phase | Agent-visible | Internals | Risk |
|-------|---------------|-----------|------|
| **A** Docs/prompts | Teach only `region=`; mention `section=` only as deprecated | none | low |
| **B** Soft deprecate | Log / tool-desc warn when `section=` used; prefer `region` in returns | dual-read unchanged | low |
| **C** Payload prefer | Agent JSON primary keys `region_label` / `region`; drop teaching `section` field | keep dual write | medium |
| **D** Error rename | Prefer `err-region-required` (alias old code) | rename helpers gradually | medium |
| **E** Remove alias | Drop `section=` from ActionModel | delete LEGACY dual | high — only after A–D settle |

## Compatibility rules

1. Until Phase E: `region or section` dual-read stays (`_form.py` pattern).
2. Until Phase E: `LEGACY_SECTION_RETIRE = True` (or equivalent) remains.
3. Characterization must cover: `region=` alone works; `section=` alone still works until E; both set → prefer `region`.
4. CHANGELOG `[Unreleased]` only if touching `src/routes` / `src/services` / `config` — pure `scripts/` agent changes usually skip; still note in plan commits.

## Success criteria

- New agent prompts never recommend `section=` as a first-class arg.
- Logs for new sessions show `region=` on assistant / pending / save in the common path.
- Phase E can delete the alias without breaking characterization or product prompts.
