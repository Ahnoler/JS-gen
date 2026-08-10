# Resolve-element ambiguous picker: section preview + section-anchored xpath — Design

**Date:** 2026-08-10  
**Status:** Spec draft — awaiting user review of this file  
**Related:** [dual-save section-anchored xpath](2026-08-10-dual-save-section-xpath-design.md); [control-ops section closed loop](../archive/specs/2026-08-07-control-ops-section-closed-loop-design.md); product auto-grab `POST .../resolve-element`  
**Trigger:** 自动抓取「新增」等多匹配时，选择器列出 N 条相同「新增 · button」+ 相同 `//button[normalize-space()='新增']`，无区块上下文，用户无法选择。

## Product constraint (non-negotiable)

Aligned with dual-save:

- Exported / saved relative **`xpath_smart` is the sole Playwright locate contract** — execution does **not** re-read `params.section`.
- When ≥2 same-leaf controls exist and the host sits under a recognisable section (collapse / tab / card), the written `xpath_smart` **must** be **section-anchored** and uniquely verified against that host whenever possible.
- Ambiguous resolve **must not** silently pick one match; UI chooses.

## Problem

1. **UI:** `resolve-element` ambiguous response `matches[].preview` exposes label / `target_kind` / xpath only — **no `section_title`**. Vue `OperationDialog` renders identical rows.
2. **Locator:** Several matches still surface the same bare leaf xpath (`//button[normalize-space()='新增']`), so even the xpath line does not disambiguate; dual-save section-anchor may not be applied or may fail without leaving a human-readable section cue.
3. **Gap vs existing designs:** Scan / `click_save` already attach `section_*` and refuse blind multi-「保存」. Manual auto-grab resolve path did not reuse that surface for the picker.

## Goals

1. Each ambiguous match carries a readable **`section_title`** (fallback display **「页面」** when no collapse/tab/card).
2. When a DOM section exists and leaf/smart is multi-hit, that match’s **`xpath_smart` is the verified section-anchored expression** (same helpers as dual-save: `sectionAnchorOf` / `sectionAnchorXPath`).
3. Vue picker primary line shows section so users can choose; secondary line shows xpath (smart preferred, else full).
4. The element written after「使用所选」matches the chosen match’s enriched locators (including section-anchored smart when present).

## Non-goals

- BiB highlight / screenshot thumbnails in the picker (follow-up).
- Teaching Playwright to read `params.section`.
- Changing Agent `click_save` / phase sticky-section rules.
- Inventing new P0 section types beyond collapse / tab / card (dialog/drawer stay as weak `locator_scope` hint only when title is「页面」and xpath still collide).
- Healing historical steps already saved with bare duplicate leaf xpath.

## Chosen approach

**甲 — Shared `sectionAnchorOf` for preview + xpath (generalise dual-save onto resolve-element)**

Rejected:

- **乙** — Vue-only display strings without backend xpath/section fields: picker usable briefly, saved xpath still collides.
- **丙** — Separate “region fingerprint” for picker only: second section vocabulary, drifts from scan/dual-save.

## §1 — Section semantics (source of truth)

Reuse locator helpers already used by dual-save / control-ops:

| Priority | DOM | `section_kind` | `section_title` |
|----------|-----|----------------|-----------------|
| 1 | `.el-collapse-item` | `collapse` | header visible text (≤40, strip icon noise) |
| 2 | `.el-tab-pane` | `tab` | matching tab label |
| 3 | `.el-card` with header | `card` | card header text |
| 4 | none | `''` | display fallback **「页面」** (do not invent fake ids in preview) |

- Innermost collapse wins when nested.
- Same rules as `sectionAnchorOf` / attachSection — **no parallel title extractor** in Vue.

## §2 — Backend: resolve-element enrich / preview

**Files (intent):** `src/cdp/page-locator-helpers.js` (`buildLocatorSnap` return), `src/cdp/resolve-by-label.js` (`toPreview` / enrich), optional thin pass-through in trajectory resolve service; Vue types + `OperationDialog` picker.

1. Snap / enrich each host with:
   - `section_title` — from `sectionAnchorOf(host).title` or `''`
   - `section_kind` — `collapse` | `tab` | `card` | `''`
2. `toPreview` includes: existing fields + `section_title`, `section_kind`, and keep `xpath_smart` / `xpath_full` / `target_kind` / `locator_scope`.
3. **Section-anchored xpath (per match, especially when N≥2 for same label):**
   - If `sectionAnchorOf(host)` and evaluating the bare leaf (or current smart) yields ≥2 nodes → build `sectionAnchorXPath(host, leaf)`;
   - Re-evaluate: must be **exactly one** node and that node is host → set `xpath_smart` to anchored expr, `locator_verified=true`;
   - If anchor cannot uniquely verify → do **not** export global `(…)[n]` as smart when a section exists (same dual-save rule); may leave smart empty / strategy `xpath_full`; **still** emit `section_title` for UI.
4. Single-match path unchanged aside from optionally exposing `section_*` on element (harmless; UI may ignore).

## §3 — Frontend: ambiguous picker

**Primary line:** `{sectionDisplay} · {matchedLabel} · {target_kind}`  
where `sectionDisplay = preview.section_title || '页面'`.

**Secondary line:** truncate(`xpath_smart` || `xpath_full`, ~120).

**Types:** extend `ResolveElementMatch.preview` with `section_title?`, `section_kind?`.

No silent auto-select; cancel leaves locator empty as today.

## §4 — Tests / characterization

1. Fixture / expression-level: two collapse regions each with button text「新增」(or「保存」) → `buildResolveExpression` / snap returns two matches with **different** `section_title` and **distinct** section-anchored `xpath_smart` (each eval length 1 → host).
2. No section hosts, two root「新增」→ both `section_title` empty / UI「页面」; still `ambiguous: true` (no silent pick).
3. Regression: single unique menu/button resolve still 1 match; menu `data-id` / title smart paths unchanged.
4. Optional Vue smoke: picker renders `section_title` when present (if repo has component test harness; else manual checklist).

## Success criteria

- On a page with two sectioned「新增」, the picker shows two different section titles; choosing one writes a verified section-anchored `xpath_smart` that uniquely hits that button.
- Users are never shown N identical rows with no section cue when DOM sections exist.
- Dual-save / scan section rules remain the single source of truth for titles and xpath prefixes.

## Out of scope reminders

- Restart/deploy notes for executor loading `resolve-by-label` (ops, not this spec).
- Mapping `click_element_by_index` ↔ `menu_text` compatibility (already handled separately).
- Extending section detection to custom SUT wrappers beyond Element collapse/tab/card in this cut.
