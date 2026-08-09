# Select dropdown lazy-load before pick — Design

**Date:** 2026-08-07  
**Status:** Implemented  
**Note:** `docs/` is gitignored; local-only. E2E: `.superpowers/sdd/cdp-e2e-select-lazy.json`

## Problem

AI recording / live replay selects `el-select` options via `JS_SELECT_OPTION`, which matches only options **currently in the open dropdown DOM**. Some selects (e.g. rating page **此次评级建议等级**) lazy-append more options when the list is scrolled to the bottom.

CDP E2E (2026-08-07):

| Moment | DOM option count | Notes |
|--------|------------------|-------|
| Just opened | **21** | Tail ends at `CCC`; no `较差` / `CCC-` / … |
| Scroll-bottom + ~200ms once | still **21** | Insufficient |
| Scroll until count/`scrollHeight` stable | **32** | Tail includes `优秀` / `较好` / `一般` / `较差` |

Scroll container on this page: `.el-select-dropdown__wrap.el-scrollbar__wrap` (`scrollHeight` 726 → 1100). This is **append-on-scroll**, not classic virtual recycling (initial 21 nodes stay in DOM).

Without a load pass after miss, picking a bottom option yields `option-not-found` even though the option exists after scroll.

## Goals

1. When the target option is not found in the first pass, **scroll the open dropdown to load more options**, then match again.
2. Cover **Agent** `select_option` and **product live replay** `_replay.py` (both already call `JS_SELECT_OPTION`).
3. Keep existing match rules (`exact`, `includes`, `first`, `exactOnly` for replay).

## Non-goals

- Changing canonical `CTRL.selectOption` / assembled Playwright scripts (this iteration).
- Always scrolling before every pick (even when the option is already present).
- Unbounded infinite-scroll loops with no cap.
- Changing trigger-open / xpath-first select wiring.

## Architecture

**Approach:** Embed “miss → stable scroll-load → rematch” inside shared `JS_SELECT_OPTION` (`scripts/actions/_js_snippets.py`).

```
open dropdown (existing)
  → collect items → match (existing rules)
  → hit → click → ok
  → miss (and not empty / no-items)
       → find scroll wrap
       → stable scroll-to-bottom (capped)
       → collect items → match again
       → hit → click → ok
       → still miss → option-not-found:preview…
```

Python Agent and `_replay.py` need **no fork** if the JS is shared. **`JS_SELECT_OPTION` becomes an `async` evaluate body** (Playwright `page.evaluate` already awaits returned Promises). Keep the public Python call sites as `page.evaluate(JS_SELECT_OPTION, …)` — no dual-call orchestration.

## Scroll container

Priority (first usable wins):

1. Visible dropdown `.el-select-dropdown__wrap`
2. Else `.el-scrollbar__wrap` inside that dropdown
3. Else a descendant with `overflow-y: auto|scroll` and `scrollHeight > clientHeight`
4. None → skip load; keep current miss result

Dropdown identity stays as today (`__last_select_trigger` / aria-owns / nearest visible popper) — do not fall back to all document items.

## Load rhythm (after first-pass miss)

```
stableStreak = 0
prevCount, prevHeight = current itemCount, wrap.scrollHeight
for round in 1..8:
  wrap.scrollTop = wrap.scrollHeight
  wait ~250ms
  if itemCount == prevCount and scrollHeight == prevHeight:
    stableStreak += 1
  else:
    stableStreak = 0
    prevCount, prevHeight = itemCount, scrollHeight
  if stableStreak >= 2:
    break
rematch once
```

Rationale from E2E: one bottom scroll + 200ms left count at 21; continued scrolls with ~250ms reached 32 then stabilized.

## When not to scroll

- First-pass hit (including `first` aliases)
- `no-items` or `.el-select-dropdown__empty`
- No visible dropdown
- No scroll wrap

## Error handling

| Case | Behavior |
|------|----------|
| Still missing after stable load | `option-not-found:` + preview (unchanged contract) |
| No wrap | No scroll; same miss as today |
| Scroll throws | Treat as load failed; rematch once on whatever is present, then miss if needed |

## Compatibility

- Replay `exactOnly=true` unchanged after load.
- Short lists that already contain the option: no scroll path (first-pass hit).
- `CTRL.selectOption` unchanged this iteration (document as follow-up if parity needed).

## Testing

1. **Characterization:** `JS_SELECT_OPTION` source contains wrap selectors + stable-load cues (`scrollHeight` / streak or equivalent markers).
2. **CDP E2E (此次评级建议等级):** after open, `较差` absent in first pool; after stable load (or via full `JS_SELECT_OPTION`), can select `较差`.
3. **Regression:** select whose option is in the first screen still succeeds without requiring load (and does not break).

## Decisions log

| Topic | Choice |
|-------|--------|
| Runtime surface | Agent `JS_SELECT_OPTION` + live `_replay.py` (shared) |
| CTRL / assemble | Out of scope this iteration |
| Strategy | B — match first; on miss, load then rematch |
| Implementation locus | Inside `JS_SELECT_OPTION` (not Python dual-call orchestration) |
| Load loop | Capped stable scroll (≤8 rounds, stop after 2 unchanged), not single 200ms scroll |

## Future TODO

- Port same load-before-pick into `CTRL.selectOption` if assembled replay must match → backlog **T8** / T4-P3。
- Optional: filterable/remote selects that need typeahead instead of scroll (separate design).
