# Resolve-element ambiguous picker: L1 region preview + region-anchored xpath — Design

**Date:** 2026-08-10  
**Status:** Approved + Implemented 2026-08-10 — plan `docs/superpowers/plans/2026-08-10-resolve-ambiguous-l1-region-preview.md`. Characterization PASS; CDP wet: `region_label` distinguishes shell-header (客户管理→顶栏) vs main (查询→主区). **Recommended follow-up:** restart BiB executor so attached sessions inject new CDP helpers; Vue multi「新增」ambiguous-picker UI smoke on attached traj (not run in this cut).  
**Supersedes:** earlier draft of this file that keyed only on `sectionAnchorOf` (collapse/tab/card)  
**Related:** [fullpage visible controls scan](2026-08-10-fullpage-visible-controls-scan-design.md) (**algorithm B + L1** — primary); [dual-save section-anchored xpath](2026-08-10-dual-save-section-xpath-design.md) (xpath bake-in when L1 role is `section`); product auto-grab `POST .../resolve-element`  
**Trigger:** 自动抓取「新增」等多匹配时，选择器列出 N 条相同「新增 · button」+ 相同裸 xpath，无区域上下文。

## Product constraint (non-negotiable)

1. **Region model = fullpage L1** ([fullpage design](2026-08-10-fullpage-visible-controls-scan-design.md)): controls are never dropped because L1 mislabels; wrong label → `other` / 「页面」仍可展示。  
2. **Playwright locate contract** remains relative **`xpath_smart` only** — no `params.section` / `region_role` at execute time. When multi-hit, bake uniqueness into xpath whenever a verified region/section anchor exists.  
3. Ambiguous resolve **must not** silently pick one match; UI chooses.

## Problem

1. Preview has no **L1 region** cue → identical picker rows.  
2. Bare leaf xpath does not disambiguate.  
3. Draft that reused only D3 `sectionAnchorOf` (collapse/tab/card) **diverges** from the locked fullpage L1 vocabulary (`shell-header` / `shell-aside` / `main` / `section` / `table` / `overlay` / `other` / …). Shell and toolbar「新增」often have **no** collapse ancestor — old algorithm would all show「页面」, still useless.

## Goals

1. Each ambiguous match exposes **L1 assignment**: `region_role`, `region_id`, and a human **`region_label`** for the picker.  
2. Prefer the **same assign rules** as fullpage scan (`assignRegion` in `scan_form.py` / shared helper) — not a third vocabulary.  
3. When multi-hit, attempt **region-anchored `xpath_smart`** (see §2); verify unique host.  
4. Vue primary line shows `region_label` so users can choose; secondary line shows xpath.  
5. Written element after「使用所选」matches the chosen enrich.

## Non-goals

- BiB highlight / thumbnails (follow-up).  
- Playwright reading `region_role` at runtime.  
- Full dynamic L1c LLM classify inside resolve (P0 = **rule assignRegion**, same as current fullpage P0).  
- Replacing Element/CTRL write path with Playwright MCP a11y (T4-P4).  
- Healing old bare duplicate xpath steps.

## Chosen approach

**甲′ — Fullpage L1 assign for preview + region-aware xpath bake-in**

- **Display / bucketing:** algorithm B spirit — L2 match list first; attach L1 via shared `assignRegion(host)`.  
- **Xpath:** role-specific anchors (below); collapse `section` reuses existing `sectionAnchorOf` / `sectionAnchorXPath` as the *implementation* of role=`section`, not as the product-facing section model.  
- Rejected: Vue-only labels; D3-only picker titles; inventing a parallel fingerprint vocabulary.

## §1 — L1 semantics (source of truth)

Share / extract the P0 rule assigner used by fullpage scan (priority ≈ current `assignRegion`):

| Priority | DOM cue | `region_role` | `region_label` (picker) |
|----------|---------|---------------|-------------------------|
| 1 | `.el-dialog` / `.el-drawer` / `.el-message-box` | `overlay` | overlay title / aria-label / 「弹层」 |
| 2 | `.el-table` / known table hosts | `table` | 「表格」 or short title if any |
| 3 | `.el-collapse-item` | `section` | collapse header text |
| 4 | aside / sidebar / `.el-menu` | `shell-aside` | 「侧栏」 |
| 5 | header / navbar / tags-view | `shell-header` | 「顶栏」 |
| 6 | `.el-main` / `.app-main` / `main` | `main` | 「主区」 |
| 7 | else | `other` | 「其他」 / 「页面」 |

- Innermost / first matching priority wins (same as scan).  
- Optional later: L1a feature cards + LLM (fullpage P1) — **out of this cut**; resolve must call the **same** helper once extracted so scan and resolve cannot drift.  
- **Algorithm B:** assign failure never removes the match from `matches[]`.

`region_id` mirrors scan (`overlay:标题`, `section:标题`, `shell-aside`, …).

## §2 — Backend: resolve-element

**Files (intent):** extract shared `assignRegion` (JS) usable from CDP locator helpers + scan snippet; `buildLocatorSnap` / `toPreview`; Vue types + picker.

1. For each match host, set `region_role`, `region_id`, `region_label` via shared assigner.  
2. `toPreview` exposes those + xpath / `target_kind`.  
3. **Region-anchored xpath (multi-hit):**  
   - `section` → existing verified `sectionAnchorXPath` (dual-save).  
   - `overlay` → scope leaf under dialog/drawer title/scope helpers already used by locator `scopeOf`.  
   - `table` → prefer row/section-aware smart if already built; else keep leaf + rely on `region_label` for UI if xpath still ties.  
   - `shell-*` / `main` / `other` → do **not** invent fake collapse anchors; try existing smart/attr xpath; if still multi-hit, **no global `[n]`** when a tighter verified scope exists; else `xpath_full` / unverified smart + **UI still shows `region_label`**.  
4. Single-match: optionally still attach region_* (harmless).

## §3 — Frontend: ambiguous picker

**Primary line:** `{region_label} · {matchedLabel} · {target_kind}`  

**Secondary line:** truncate(`xpath_smart` || `xpath_full`, ~120).

Types: `preview.region_role`, `preview.region_id`, `preview.region_label` (prefer these over legacy `section_title` naming in new API; if both emitted briefly for compat, UI reads region_* first).

## §4 — Tests / characterization

1. Two collapse「新增」→ different `region_role=section` + different `region_label` + distinct section-anchored xpath when verifiable.  
2. Shell menu vs main toolbar same text → `shell-aside` vs `main` (or `other`) labels differ; both kept.  
3. Overlay vs main same button text → `overlay` vs `main`.  
4. Shared assigner: scan fullpage assign and resolve preview use the **same** function/module (characterization cue / import).  
5. Regression: unique menu `data-id` resolve unchanged.

## Success criteria

- Picker rows for multi「新增」are distinguishable by **L1 region_label** whenever assign can tell them apart.  
- Choosing a sectioned control writes verified region/section-anchored `xpath_smart` when possible.  
- Mis-assigned region never drops a match (algorithm B).  
- No third section vocabulary in Vue.

## Relationship to older “分块”

| | D3 `sectionAnchorOf` | Fullpage L1 (this spec) |
|--|----------------------|-------------------------|
| Product face | `section` for `click_save` | `region_role` / `region_label` for inventory + picker |
| Shell | ignored | first-class |
| Resolve picker | insufficient alone | **required** |
| Xpath bake-in | collapse/tab/card prefixes | role-specific; **section role reuses D3 helpers** |

## Out of scope reminders

- Executor restart ops.  
- L1c LLM inside resolve.  
- True Playwright MCP a11y as write path (T4-P4).

## Verification (2026-08-10)

| Check | Result |
|-------|--------|
| `characterize-resolve-ambiguous-region.mjs` | PASS (Tasks 1–3) |
| `characterize-resolve-element-auto-grab.mjs` | PASS (Task 4) |
| CDP direct resolve (`region_label`) | PASS — 顶栏 / 主区 |
| BiB attached traj ambiguous「新增」 | **Not verified** — executor not restarted |
| Vue OperationDialog multi-picker UI | **Deferred** — Vite smoke not run |
