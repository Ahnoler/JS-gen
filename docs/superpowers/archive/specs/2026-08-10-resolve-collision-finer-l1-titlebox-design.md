# Resolve ambiguous: collision-driven finer L1 (titlebox) — Design

**Date:** 2026-08-10  
**Status:** Approved + Implemented 2026-08-10 — plan `docs/superpowers/plans/2026-08-10-resolve-collision-finer-l1-titlebox.md`. Characterization PASS; CDP wet: resolve「新增」→ 7 matches, 7 distinct titlebox `region_label`. **Recommended follow-up:** restart BiB executor so attached sessions inject collision-refine helpers; Vue ambiguous-picker UI smoke on attached traj (not run this session).  
**Related:** [fullpage visible controls scan](2026-08-10-fullpage-visible-controls-scan-design.md) (algorithm B + dynamic L1); [resolve ambiguous L1 region preview](2026-08-10-resolve-ambiguous-section-preview-design.md); dual-save section-anchored xpath  
**Trigger:** 对公客户编辑页 7 个真「新增」被压成「股东及关联人信息」/「经营情况 保存」两个粗 collapse；选择器 xpath 全是裸 `//button[normalize-space()='新增']`。现场 CDP：子块在 `div.titlebox` / `span.title`；collapse 锚仍命中 3 个按钮；`关联人信息` 面板锚命中 1。

## Product constraints

1. **Algorithm B:** finer L1 failure must not drop matches from ambiguous list.  
2. **Playwright locate = relative `xpath_smart` only** — bake uniqueness into xpath when a finer anchor verifies; never rely on `region_*` at execute.  
3. **Dynamic L1, not collapse-only** — align with fullpage: rigid `.el-collapse-item` is insufficient for TSSC `titlebox` panels.  
4. Ambiguous resolve still requires user pick; no silent choice among remaining collisions.

## Problem

P0 `assignRegion` stops at outer collapse → multiple same-label buttons share one `region_id` → picker rows look duplicated; section-anchored xpath under that collapse is multi-hit → falls back to bare leaf.

## Goals

1. Detect **region collision** among same-needle ambiguous matches.  
2. **Regenerate** finer `region_*` (and try xpath) for colliding groups using titlebox / titled-panel discovery.  
3. Keep shared assigner with scan where possible; collision refine is required on **resolve ambiguous path** (scan may adopt later).  
4. Vue continues to show `region_label`; after refine, labels like「关联人信息」vs「与其他客户关联信息」must differ when DOM allows.

## Non-goals

- L1c LLM classify in this cut.  
- BiB highlight.  
- Healing old stored steps.  
- Replacing Element/CTRL with Playwright MCP a11y.  
- Global always-on titlebox scan as the only L1 (collision-driven refine preferred — approach 甲).

## Chosen approach

**甲 — Collision then refine**

Rejected: 乙 always-global titlebox L1; 丙 UI-only nearTitle without xpath bake-in.

## §1 — Collision key and regenerate trigger

After initial `assignRegion` on each ambiguous host for needle `N`:

- Group by `(N, region_id)`.  
- Any group with **size ≥ 2** → that group **must regenerate**.  
- Non-colliding hosts keep initial assignment.

## §2 — Finer L1 discovery (P0 rules)

For a host under regenerate, walk ancestors (bounded depth) and collect titled-panel candidates:

| Priority | Cue | Title source |
|----------|-----|--------------|
| 1 | `.titlebox` | `span.title` or visible title text inside titlebox (≤40) |
| 2 | Row/panel whose first titled child is a short heading | that heading text |

**Title hygiene:**

- Strip icon/button noise; reject titles that are only action words（新增/修改/查看/删除/保存）or that equal the needle.  
- Collapse header pollution（e.g. `经营情况 保存`）: when refining, prefer titlebox title over polluted collapse header; optionally strip trailing bare「保存」from collapse titles in assigner hygiene (secondary).

Pick the **nearest** titlebox/panel whose title is non-empty and distinct. Emit:

- `region_role`: `section` (or `custom:titlebox` if we need to mark source — prefer `section` for picker simplicity unless scan already uses custom)  
- `region_id`: `section:<title>`  
- `region_label`: `<title>`

If no finer candidate → keep coarse region (algorithm B); still list the match.

## §3 — Xpath after refine

For regenerated hosts:

1. Build panel-anchored relative xpath, e.g. ancestor of titlebox with `normalize-space()=<title>` then `//button[normalize-space()='<needle>']` (XPath 1.0 / existing helper style).  
2. Evaluate: must be **exactly one** node and that node is host → set `xpath_smart`, `locator_verified=true`.  
3. If not unique → do **not** export global `(…)[n]`; may keep unverified leaf / `xpath_full`; **region_label still updated** so picker is usable.

Collapse `sectionAnchorXPath` remains for non-colliding single-button-under-collapse cases (dual-save).

## §4 — Where it runs

| Path | Behavior |
|------|----------|
| `resolve-element` ambiguous (≥2 matches) | Initial assign → collision detect → refine colliding groups → preview/element carry new region_* (+ xpath if verified) |
| Single match | No collision refine required |
| `scan_form` fullpage | Optional follow-up: same refine when summarizing duplicate buttons; **not required for P0** if resolve picker is fixed first |

Shared helpers live in `PAGE_LOCATOR_HELPERS` (`assignRegion`, `refineRegionOnCollision` / equivalent) so scan can call later without a third vocabulary.

## §5 — Vue

No new vocabulary: still `{region_label} · {label} · {kind}`. After refine, duplicate rows should show **different** `region_label` when titleboxes differ. If still identical after failed refine, secondary line may show truncated `xpath_full` (weak).

## §6 — Tests / characterization

1. Fixture or CDP cue: two titleboxes「关联人信息」「与其他客户关联信息」each with「新增」under one collapse → after resolve ambiguous, **two different** `region_label`; at least one verified panel-anchored xpath when eval uniqueness holds.  
2. Collapse-only unique「保存」— no false refine.  
3. Collision with no titlebox — matches kept; region may stay coarse.  
4. Regression: menu `data-id` / single resolve unchanged.  
5. Marker: collision refine helper present in helpers + wired from resolve ambiguous path.

## Success criteria

- On the live crtCpctInf page pattern, ambiguous「新增」picker rows are distinguishable by **子块 titlebox 标题**, not only outer collapse.  
- Where panel anchor verifies, saved `xpath_smart` uniquely hits that button.  
- Mis-refine never drops a button from `matches[]`.

## Out of scope reminders

- Executor restart ops for BiB.  
- Full dynamic L1a feature-card LLM.  
- Deduplicating matches that are the same DOM node (not observed; 7 hosts are distinct).

## Verification (2026-08-10)

| Check | Result |
|-------|--------|
| `characterize-resolve-collision-titlebox.mjs` | PASS (Tasks 1–4) |
| `characterize-resolve-ambiguous-region.mjs` | PASS |
| `characterize-resolve-element-auto-grab.mjs` | PASS |
| CDP wet `:9242` resolve「新增」(`crtCpctInf` edit) | PASS — 7 matches, 7 distinct titlebox `region_label` (关联人信息, 与其他客户关联信息, 受益人信息, 客户资质信息, 参与项目情况, 企业债券发行情况, 对外投资信息) |
| BiB attached traj ambiguous「新增」 | **Not verified** — executor reload may still be needed |
| Vue OperationDialog multi-picker UI | **Deferred** — not run this session |
