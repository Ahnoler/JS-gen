# Design: Full-page visible operable controls scan (two-layer)

**Date:** 2026-08-10  
**Status:** **Approved** 2026-08-10 (algorithm B + dynamic L1 + MCP-inspired model)  
**Reference UX:** Cursor browser MCP / Playwright MCP — accessibility-like control pool first; region labels second  
**Backlog:** Revises α / 壳层定稿； evolves T4 scan + subsumes container-gated T5 framing  
**Related:** [scan_editable_summary](2026-08-09-scan-editable-summary-design.md); [T5 credit gap](2026-08-10-t5-credit-scan-gap-design.md); `docs/superpowers/backlog-visible-editable-controls.md`

## Problem

Today Source A / B / C each **gate** collection by container family (form-item, `.el-table`, button heuristics). Layout wrappers (`tssc-*`, collapse, edit vs view) and **shell menus** are treated inconsistently or excluded. The product need is: **every visible, classified, operable control on the page** in one pool — placement and container are metadata, not admission tests.

## Goals

1. **Whole page in scope** — including top menu and left navigation (壳层 **进入**清单).  
2. **Two-layer scan**  
   - **L1 — regions/containers:** discover structural regions (header, aside/nav, main, overlay, table hosts, collapse sections, …).  
   - **L2 — controls:** collect all **visible + classified + operable** controls **without** requiring membership in a specific A/B/C container first.  
   - **Assign:** map each L2 control back to an L1 region by geometry / ancestry for A/B/C / summary consumers.  
3. **Shared L2** feeds existing A/B/C and `scan_editable_summary` (enhance, don’t permanently dual-track).  
4. **No auto-fill** from the inventory; Agent still decides writes.  
5. **Not raw DOM dump** — only taxonomy-classified controls (see below).

## Non-goals

- Replacing Element/CTRL write path with Playwright MCP a11y as primary (still T4-P4 optional).  
- Auto-clicking shell menus from the scan itself.  
- Unknown/unclassified nodes entering the operable set (may list separately later as `unknown`, out of P0).  
- Changing replay DB schema in this cut.

## Taxonomy (operable kinds)

| Kind | Examples |
|------|----------|
| input | text/number/textarea |
| select | `el-select` / search-select |
| date | date/datetime editors |
| radio / checkbox | including table cells |
| button | text buttons |
| icon | tooltip / aria icon controls (filter pure caret/chevron chrome where possible) |
| tree | tree node contents |
| menu_item | top/side nav entries that are operable |

Disabled-but-visible controls: include with `enabled: false` (Agent sees them; write tools still refuse as today).

## Architecture

```text
page
  → L2 first (admission): all visible + classified + operable controls on the full page
       (optional single DOM walk may also record L1 region stack)
  → L1 regions: header / aside / main / table / overlay / section / …
  → assign(control → region) by ancestry / geometry; orphan → region=page|other (KEEP in inventory)
  → project into Source A / B / C views + scan_editable_summary
```

**Locked algorithm choice (2026-08-10):** **B — completeness first.**  
Do **not** admit controls only by walking inside discovered containers (A). Container success must never gate whether a control exists in the inventory. Implementation may use one pass that tags both L1 and L2, but admission remains full-page L2.

### Why not A (collect only inside containers while discovering them)

| A risk | Effect |
|--------|--------|
| L1 misses a region / wrapper | Controls in that area vanish from the inventory |
| Shell selectors incomplete | Top/left nav silently dropped — conflicts with 壳层进清单 |
| Nested form+table | Easy double-count without a global pool |

Failure mode under B: wrong `region` bucket; control **still listed**. That is acceptable; missing controls are not.

## Dynamic L1 — real-time container discovery & classification

### Dead board (problem with fixed L1 labels)

Hard-coding only `collapse` / `navigator` / `header` / a few business hosts leaves **unknown wrappers** (`tssc-*`, future TableNet hosts, new portals) as permanent `other`. That is a labeling dead board — not an L2 admission failure (algorithm B still keeps controls), but Agent/summary still cannot say *what kind of place* a control lives in.

### Goal

L1 must **discover candidate containers from the live page**, read **features**, and **classify** them — including novel hosts — instead of only matching a frozen CSS allowlist.

### Can we do it?

**Yes.** Preferred shape is **hybrid**, not “LLM invents every box every time”:

| Layer | Who | What |
|-------|-----|------|
| **L1a Discover** | Deterministic JS | Propose container *candidates* from live DOM: landmarks, large visible blocks, known frameworks *and* generic “hosts” (forms, tables, menus, overlays, scroll roots, titled panels). |
| **L1b Features** | Deterministic JS | Per candidate emit a **feature card**: tag/class tokens, role/aria, title text, size/position band (top/side/center), child control counts by kind, scrollable?, overlay?, table-like?, menu-like?. |
| **L1c Classify** | Rules first + **LLM optional** | Map feature card → `region_role` + confidence. Rules cover common Element/TSSC/portal patterns; **low-confidence / novel** cards go to a small LLM JSON classify (or Agent tool) using the feature card — **not** raw HTML dump. |
| **L1d Persist (optional)** | Memory / case | Cache (systemId + feature signature → role) so the same host is not re-asked every step. |

L2 stays algorithm **B**: full-page operable controls are collected regardless of L1c success. Dynamic L1 only improves **labels / bucketing**.

```text
page
  → L2 pool (always)
  → L1a candidates (live)
  → L1b feature cards
  → L1c role = rules(card) or LLM(card) if unsure
  → assign L2 → L1
```

### What “AI sees the container” means (precise)

- **Not:** screenshot-only or whole outerHTML to the model every scan.  
- **Yes:** structured **feature cards** (tens of fields, truncated class/title) so classification is cheap and replayable.  
- Optional later: one screenshot crop for disputed candidates (P2+).

### Open role vocabulary (extensible, not a closed dead enum)

Seed roles remain useful as *labels*, but classifiers may emit **`role=custom:<slug>`** when nothing fits, as long as the feature card is stored. Seed:

`shell-header` | `shell-aside` | `shell-tabs` | `main` | `section` | `table` | `overlay` | `menu` | `custom:*` | `page` | `other`

### Non-goals for dynamic L1

- LLM required on every candidate on every step (cost/latency).  
- Letting LLM **drop** controls from L2.  
- Training a private CV model in P0.

### Phasing add-on

| Phase | Dynamic L1 |
|-------|------------|
| **P0** | L1a+L1b feature cards + rule classify; `custom`/`other` with features attached to summary |
| **P1** | LLM classify for low-confidence cards; optional memory cache |
| **P2** | Vision assist for disputed hosts |

### Success add-on

- [ ] A never-before-seen wrapper that still contains L2 controls appears in L1 as `custom:…` or `other` **with a non-empty feature card**, not silent omission.  
- [ ] Mis-classified shell vs main does **not** remove those controls from L2.

### L2 admission

A node is admitted iff:

1. Visible (non-zero box, not `display:none` / `visibility:hidden` / opacity 0), and  
2. Matches a taxonomy detector, and  
3. Is operable **or** explicitly disabled control of that kind (still listed).

**No** requirement that it sit under `.el-form-item` or `.el-table` to exist in L2.

### Assignment

- Prefer DOM ancestry into an L1 root.  
- Else largest intersecting L1 rect.  
- Ambiguous → `region=other` + still kept in L2 / summary.

### Consumer projection

| Consumer | Uses |
|----------|------|
| Source A-shaped fields | L2 where kind∈form fields; label from form-item **or** cell lead/header **or** accessible name |
| Source B-shaped fields | L2 inside `region=table` (any table host: `.el-table`, future non-el-table) |
| Buttons / Source C | L2 kind∈{button, icon, menu_item} |
| `scan_editable_summary` | Counts + labels + buttons from assigned L2; include `region` in summary entries |

## Decisions (locked 2026-08-10)

| Topic | Choice |
|-------|--------|
| Shell (top/left nav) | **In inventory** |
| Container as gate | **No** — L2 full-page admission; L1/assignment only (**algorithm B**) |
| L1 classification | **Dynamic**: discover candidates → feature cards → rules (+ optional LLM); not a frozen CSS-only allowlist |
| LLM on L1 | Optional for low-confidence only (P1); never gates L2 |
| A/B/C | **Reuse L2 pool** via projection |
| Auto-fill | Never from scan |
| Primary deliverable | Enhance `JS_SCAN_FORM_FIELDS` / `scan_editable_summary` path; extract shared L2 helper in `scan_form.py` (or sibling snippet) |
| T5 “custom grid” | Folded into L2+table region; no separate TableNet-only scanner unless a non-classified host appears |

## Phased delivery

| Phase | Deliverable |
|-------|-------------|
| **P0** | L2 full-page collectors + L1 region tags + assignment; wire into `scan_editable_summary` (show region); characterization cues |
| **P1** | **已实施** | Rebase Source A/B/C callers onto L2 (`mode:'fullpage'`) + shell excluded from fillable | [plan](plans/2026-08-10-fullpage-visible-controls-scan-p1.md) |
| **P2** | **已实施** | Icon / chrome menu **noise filter** (hard-exclude); naming + Fact Pack later | [spec](specs/2026-08-10-fullpage-p2-icon-chrome-noise-design.md) · [plan](plans/2026-08-10-fullpage-p2-icon-chrome-noise.md) |

## Errors / edges

| Case | Behavior |
|------|----------|
| Hidden tab panel | Not visible → not in L2 |
| Duplicate nodes (fixed columns) | Dedupe by rect+kind+name hash |
| Pure decorative icons | Prefer exclude (P2); P0 may over-include |
| Iframe | Out of scope (same as browser MCP limits) |

## Success criteria (P0)

- [x] Characterization: fullpage L2/L1 markers + `scan_editable_summary` wires `mode:'fullpage'`  
- [x] `build_editable_summary` propagates `scope=fullpage` + `regions`  
- [ ] On modify-mode 对公评级页 live: L2 includes table cell selects **and** at least one shell menu item (optional wet-run)  
- [x] Backlog 目标定稿 updated (壳层进清单) — see backlog 2026-08-10  

**P0 code status:** Implemented 2026-08-10 — `mode:'fullpage'` in `scan_form.py`; summary action wired.

## Open follow-ups

- Exact CSS for `shell-header` / `shell-aside` on 天阳门户 (tune in P0 against live page).  
- Whether `plugin-nav` (right rail) is `section` vs `other` (assignment only).
