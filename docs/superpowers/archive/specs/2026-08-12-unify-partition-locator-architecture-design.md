# Design: Unify partition & locator architecture (manual / auto-grab / AI)

**Date:** 2026-08-12  
**Status:** Approved — plan at `docs/superpowers/plans/2026-08-12-unify-partition-locator-architecture.md`  
**Trigger:** 待办「处理」人工可录可回放，自动抓取曾漏抓；修复后能列出全部「处理」，但歧义列表分区不可读（20×「处理 / button」，仅靠截断 xpath）  
**Related:** [retire A/B/C + D3 → L1/L2 regionAnchor](2026-08-12-retire-abc-d3-favor-l1l2-regionanchor-design.md); [retire section favor region](2026-08-12-retire-section-favor-region-design.md); [L1c LLM region classify](2026-08-10-l1c-llm-region-classify-design.md); [AG-fullpage inventory](2026-08-10-auto-grab-fullpage-inventory-design.md)

## Problem

Three product entry points still use **discrete admission and partition paths**, while sharing only parts of xpath export:

| Entry | How controls are found | Partition | XPath export |
|-------|------------------------|-----------|--------------|
| Manual record | Real click → DOM event target | `parent_text` / `assignRegion` when present | `buildLocatorSnap` |
| Auto-grab / resolve | `collectInventoryHosts` + `inventoryKindOf` + `kindsForAction` | Inventory / resolve region fields | Snap after hit |
| AI record | `collectL2*` / `scan_form` + TaskList | L1 `assignRegion` (`region_*`) | Scan `xpath_smart` or capture on action |

Shared kernel today: `PAGE_LOCATOR_HELPERS` (`normalizeTargetRoot`, `assignRegion`, `buildLocatorSnap`, `regionAnchor*`).  
**Not shared:** “what counts as an operable control” and “what a human sees when many hits share the same label.”

Concrete failures:

1. **Admission fork** — Portal 待办 wraps cards in `.el-checkbox-group`. Inventory classified `.todo-item-action` as `form_checkbox` and dropped it from `click_element` projection, while manual click → snap succeeded.  
2. **Partition UX fork** — After admission fix, auto-grab lists every「处理」as identical `button` under a useless `section` group; only truncated xpath differs. Users cannot tell which todo card (e.g. `DGSX…` / `PJ…`) they are selecting.

## Goals

1. **Single mental model:** host normalize → operable classify (L2 admit) → region assign (L1) → locator snap.  
2. **One admission kernel** used by manual snap path, auto-grab / resolve inventory, and AI L2 scan.  
3. **One partition kernel** (`assignRegion` / `region_*`); ambiguity UI must show **human-usable** `region_label` (card business key / title), not xpath-only disambiguation.  
4. **Phased convergence:** unify classify first; then make L2 pool the sole collector so auto-grab is a projection, not a parallel CSS/kind table.

## Non-goals

- Do not change replay primary locate away from recorded `xpath_smart`.  
- Do not hard-delete `section=` tool alias (favor-region Phase E).  
- Do not rewrite agent tool surface / CTRL APIs in this design.  
- Do not auto-heal old trajectories that already stored bad xpath (e.g. checkbox-group).  
- Do not require L1c LLM for P0 todo-card labels (rules must suffice when `L1C_LLM` is off).

## Locked decisions

| # | Decision |
|---|----------|
| 1 | Target state = **C**: shared L2 admission + shared L1 assign; auto-grab must not maintain a parallel kind rulebook. |
| 2 | Delivery = **U1 then U2** (thin shared classify first; then sole `collectL2` source). |
| 3 | Scope includes manual record, auto-grab, AI scan, and **resolve-element**; replay keeps xpath_smart priority but **host/kind normalize** must share the U1 kernel. |
| 4 | Ambiguity picker (“选择匹配的控件”) **U1 exit criterion**: each duplicate「处理」shows a distinguishable card-level `region_label`. |
| 5 | Algorithm **B**: L1 failure must not delete L2; action filters only shrink projections. |

## Terminology

| Term | Meaning |
|------|---------|
| **L2** | Visible + taxonomy-classified + operable (or disabled-of-kind) controls — sole admission concept |
| **L1 / `region_*`** | Structural region metadata — sole bucketing concept for product/Agent |
| **`classifyOperable`** | Unique kind + admit decision (absorbs `detectTargetKind` / `inventoryKindOf` rule order) |
| **`normalizeHost`** | Unique host pick before classify/snap (absorbs `normalizeTargetRoot` precedence, e.g. todo-action ≻ checkbox-group) |
| **`collectL2`** | Page-wide L2 collection (U2: sole collector; U1 may still have multiple collectors calling the same classify) |
| **`regionAnchor*`** | XPath 消歧 (titled-host prefix) — not product “分块” |
| **Projection** | Filtered view of L2 for a consumer (`kindsForAction`, scan summary, AG list) |

## Architecture (target)

```text
DOM node / page
  → normalizeHost()
  → classifyOperable()        // unique L2 admit + kind
  → assignRegion()            // unique L1
  → buildLocatorSnap()        // unique xpath (+ regionAnchor*)

page-wide:
  → collectL2()               // U2 sole collect; U1: collectors share classify
  → assign(L2→L1)
  → project:
       AI scan / scan_editable_summary
       auto-grab / resolve inventory (kindsForAction filter)
       manual: click event → same four steps (no full-page collect required)
```

### Hard rules

1. Admission decisions live only in `classifyOperable` (and its documented helpers). No second kind ladder in inventory vs L2 collectors.  
2. Partition decisions live only in `assignRegion`. `parent_text` may assist recording/replay text scope; it does not replace `region_*` for product disambiguation UI.  
3. XPath export lives only in `buildLocatorSnap` / `regionAnchor*`.  
4. Ambiguity list display fields (`region_label`, optional short card summary) **must be the same fields** written into the chosen snap / stored step — no “show A, save B.”  
5. Filter box “区域 / 名称 / 类型 / xpath” searches the same region string shown in the list.

## Phased delivery

| Phase | Deliverable | Exit criteria |
|-------|-------------|---------------|
| **U1 — Unify admission (+ readable partition for AG)** | Extract `normalizeHost` + `classifyOperable` in `PAGE_LOCATOR_HELPERS`; wire inventory, L2 button/field collectors, and snap-path host normalize to them; regen `_locator_helpers_js.py`. Ensure todo-card `assignRegion` yields readable `region_label` (business key / title line). Surface `region_label` on resolve / auto-grab ambiguity payload and UI. | Same DOM:「处理」is `button` for inventory + L2; host is not checkbox-group; multi-hit AG list shows **distinct card-level labels**; cross-path characterization green. |
| **U2 — Sole L2 collect** | Auto-grab / resolve inventory become projections of `collectL2()` (+ assigned regions). Remove parallel host selector tables / parallel kind special-cases (thin aliases OK for one release). | Production path has one collector table; new control types prefer a single L2 change; wet: AG list ≡ scan regions for todo「处理」. |

### Expected touchpoints

- Canonical: `src/cdp/page-locator-helpers.js`  
- Mirror: `scripts/controller/actions/js_snippets/_locator_helpers_js.py` (regen)  
- Consumers: `src/cdp/resolve-by-label.js`, `scripts/controller/actions/js_snippets/scan_form.py`, manual recorder snap path, AG / resolve ambiguity UI payload  
- Characterization: cross-path admit + multi-todo `region_label` distinctness  

### Compatibility

- Old steps with bad xpath remain as-is; durable text guards already reject false checkbox-group hits when `want` text is set.  
- Legacy `section_*` mirrors may remain read-only until favor-region Phase E; new writes prefer `region_*`.

## Error / edge rules

| Case | Behavior |
|------|----------|
| L1 cannot extract business key | Keep L2; `region_label` falls back to first visible card title line; never silently drop the control |
| Multiple cards share the same title | Prefer business key in `region_label`; if still colliding, list shows label **and** short xpath — never label-only「处理」 |
| `kindsForAction` excludes a kind | Projection shrinks only; classify definition unchanged |
| `L1C_LLM` off | Rule-based todo-card labels still required for P0 |
| Decorative chrome | Existing noise filters; do not reintroduce SOURCE A/B/C gates |

## Testing

- Characterization: shared classify/host precedence (todo-action before checkbox-group) across inventory, L2, and snap.  
- Characterization: checkbox-group–wrapped multiple「处理」→ multiple inventory/resolve hits with **pairwise-distinct readable `region_label`**.  
- Contract: ambiguity payload includes UI-facing `region_label` (and optional `region_role`); filter tokens match display.  
- Optional wet: 待办 page auto-grab「处理」→ picker identifiable by card → selected xpath anchors that card.

## Success criteria

1. Manual / auto-grab / AI scan no longer maintain separate “is this a control?” rulebooks (U1 kernel; U2 sole collect).  
2. Multiple「处理」on one page: a human can pick the right card **without** decoding xpath.  
3. After U2, adding a new portal control type preferentially touches one L2 admission/collect site.  
4. Replay remains xpath_smart-first; region is for assignment, AG UX, and xpath 消歧 — not a replay substitute.

## Relationship to prior specs

This design **does not reopen** L1/L2 vocabulary or `regionAnchor*` rename. It closes the remaining gap those specs left open: **admission/collect still forked for auto-grab**, and **ambiguity UX not bound to readable L1 labels**.
