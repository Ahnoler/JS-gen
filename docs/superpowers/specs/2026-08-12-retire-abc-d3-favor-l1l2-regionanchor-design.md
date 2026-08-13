# Design: Retire D3 section-chunking + SOURCE A/B/C; L1/L2 only; regionAnchor

**Date:** 2026-08-12  
**Status:** Approved — plan at `docs/superpowers/plans/2026-08-12-retire-abc-d3-favor-l1l2-regionanchor.md`  
**Backlog / context:** 待办「处理」(`div.todo-item-action`) 漏扫/不分区；全页可见可操作控件规格未真正落地  
**Related:** [fullpage visible controls](2026-08-10-fullpage-visible-controls-scan-design.md); [legacy-section-retire](../todos/2026-08-11-remove-legacy-section-chunking.md); [retire section favor region](2026-08-12-retire-section-favor-region-design.md); [dual-save section xpath](2026-08-10-dual-save-section-xpath-design.md)

## Problem

Three vocabularies still coexist in scan/locate code:

1. **D3「旧分块」** — `sectionOf` / `section_title` / product `section=` (产品面已退役，实现仍混用).  
2. **SOURCE A/B/C** — form-item / el-table / `button|.el-button` collectors used as **admission gates**.  
3. **L1/L2「分区」** — approved fullpage model: L2 = visible+classified+operable; L1 = region assign only.

Portal controls such as `div.todo-item-action` fail because implementation still gates on (2) and partitions with (1)’s Element-only hosts — contradicting algorithm **B** (container must not gate L2).

Additionally, `sectionAnchor*` still does real **xpath 消歧** work (dual-save duplicate buttons) but its name collides with retired「分块」, harming readability.

## Goals

1. **Single mental model:** page → **L2 pool** → **L1 regions** → assign → consumers (`scan_editable_summary`, resolve, recording).  
2. **Gradually demote then delete** (1) D3 product/judgment paths and (2) SOURCE A/B/C collector branches/names.  
3. **Rename** `sectionAnchor*` → **`regionAnchor*`** with comments stating purpose = **xpath 消歧** (not product chunking). Keep behavior; do not remove until a unified region-anchor API covers the same cases.  
4. **P0 acceptance sample:** 待办卡片「处理」enters L2 and gets a card-level `region_label` (e.g. business key `PJ…`), not dumped into `main`.

## Non-goals

- Do not change replay primary locate away from `xpath_smart`.  
- Do not hard-delete `section=` tool alias in this design (existing Phase E of retire-section-favor-region).  
- Do not ship L1-vision or Playwright a11y as primary write path (T4-P4).  
- Do not one-shot delete dual-save characterization coverage.

## Terminology (locked)

| Term | Meaning | Fate |
|------|---------|------|
| **L2** | Visible + taxonomy-classified + operable controls | **Keep — sole admission** |
| **L1 / region_*** | Structural regions; assignment metadata | **Keep — sole bucketing** |
| **SOURCE A/B/C** | Legacy collectors by container family | **Demote → delete** (may briefly exist as thin projections of L2) |
| **D3 旧分块 / `sectionOf` product face** | collapse/tab/card → `section_title` for Agent `section=` | **Demote → delete** product judgment |
| **`regionAnchor*`** (was `sectionAnchor*`) | Prefix relative xpath with titled host so duplicate leaves resolve uniquely | **Keep capability; rename; comment = xpath 消歧** |
| **titlebox / page-state anchors** | Other xpath disambiguators | **Keep**; eventually fold call sites under region-anchor narrative |

## Architecture (target)

```text
page
  → collectL2()     // full-page detectors; NO A/B/C gate
  → discoverL1()    // dynamic candidates + feature cards (+ optional L1c)
  → assign(L2→L1)   // ancestry / geometry; orphan → other (KEEP in L2)
  → project summary / resolve / record

xpath export:
  → regionAnchor*(host, leaf)   // xpath 消歧 for titled hosts
  → titlebox / page-state when applicable
  → never prefer bare occurrence [n] when a verified region anchor exists
```

### L2 admission (unchanged from fullpage spec)

Admit iff visible ∧ taxonomy match ∧ (operable ∨ disabled-of-that-kind).  
Taxonomy includes `button` as **text-like actionable controls**, not only `button`/`.el-button` tags (portal `div.todo-item-action` is in scope).

### L1 discovery

Not a frozen CSS allowlist forever. P0 may keep seed selectors (including `.todo-item`) while L1a/b/c matures; silent omission of hosts that contain L2 controls is a defect.

## regionAnchor rename (locked this session)

| Before | After |
|--------|-------|
| `sectionAnchorOf` | `regionAnchorOf` |
| `sectionAnchorXPath` | `regionAnchorXPath` |

**Comment convention (canonical JS + generated Python mirror):**

```js
/* regionAnchor* — xpath 消歧：为同名 leaf 加 titled host 前缀，导出唯一相对 xpath。
 * 不是产品「分块/section=」；产品区域请用 region_* / L1。 */
function regionAnchorOf(host) { ... }
function regionAnchorXPath(host, leafLocal) { ... }
```

**Compatibility:** R4 (2026-08-12) deleted `sectionAnchor*` aliases; use `regionAnchor*` only.

**Do not remove** the capability: dual-save / duplicate「保存」still depends on titled-host-prefixed xpath.

## Phased retirement

| Phase | Deliverable | Exit criteria |
|-------|-------------|---------------|
| **R0** | Rename `sectionAnchor*` → `regionAnchor*` + xpath-消歧 comments; chars updated | `characterize-section-anchored-xpath` (renamed or retargeted) green; dual-save cues green |
| **R1** | Introduce/extract `collectL2` + assign; wire `scan_editable_summary` to L2-first; A/B/C become projections only | 待办「处理」in buttons with card `region_label`; no SOURCE_* markers required for admission |
| **R2** | Delete SOURCE A/B/C branch names/markers from `scan_form.py`; callers only speak L2 kinds | Grep `SCAN_SOURCE_[ABC]` → 0 in live path; chars updated |
| **R3** | Delete D3 product judgment (`attachSection`/`sectionOf` as Agent-facing partition); region_* only | Summary/pending/save cues use region; `section=` alias-only until Phase E of favor-region spec |
| **R4** | Optional: fold titlebox/page-state call docs under region-anchor narrative; remove `sectionAnchor` aliases if any | Docs + chars; no behavior change |

## Error / edge rules

| Case | Behavior |
|------|----------|
| L1 miss / mis-label | Control **stays** in L2 (algorithm B) |
| Duplicate leaf under two titled hosts | `regionAnchorXPath` must yield unique smart xpath |
| Decorative chrome | Existing P2 noise filter |
| `section=` tool arg | Compat alias until favor-region Phase E — out of R0–R2 critical path |

## Testing

- Characterization: regionAnchor markers + dual-save / section-anchored (retarget names).  
- Characterization: L2 admits `.todo-item-action`; L1/region for `.todo-item`.  
- Wet (optional): 待办页 `scan_editable_summary` shows「处理」with `PJ…` region.

## Success criteria

- [x] Code and docs no longer teach SOURCE A/B/C as admission. *(R1–R2: `collectL2*` only; `SCAN_SOURCE_*` gone from live scan path)*  
- [x] D3「分块」not used for Agent-facing partition. *(R3: `attachSection` shim → `assignRegion`; product partition via `region_*`)*  
- [x] `regionAnchor*` exists with **xpath 消歧** comments; `sectionAnchor*` gone. *(R4 verified 2026-08-12)*  
- [x] Portal todo actions inventoriable and partitioned without one-off forever allowlists as the architecture. *(P0: `characterize-todo-item-action` green)*

## Open follow-ups

- Exact schedule for deleting `section=` alias (favor-region Phase E).  
- Whether `region_role: "section"` enum value is later renamed to `block` (optional; not required for R0–R3).
