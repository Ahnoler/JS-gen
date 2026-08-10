# Page-state-gen: collision-only clickable anchors — Design

**Date:** 2026-08-10  
**Status:** Draft — brainstorm approved (路径甲); awaiting user review of this file  
**Backlog ID:** **page-state-gen**  
**Related:** [wizard 下一步 page-state](2026-08-10-wizard-next-page-state-xpath-design.md) (§4 TODO); [dual-save section xpath](2026-08-10-dual-save-section-xpath-design.md); [titlebox collision L1](2026-08-10-resolve-collision-finer-l1-titlebox-design.md); [AG-fullpage inventory](2026-08-10-auto-grab-fullpage-inventory-design.md)

## Product decisions (locked)

| # | Decision |
|---|----------|
| 1 | 页态信号 **C**：步骤条当前项 → 否则 dialog/drawer 标题 → 否则主区/breadcrumb 短标题 |
| 2 | 仅当裸相对 xpath **多命中**（会撞）时才包装 **A** |
| 3 | 链路 **C**：CDP snap/enrich 为主；resolve-element inventory/歧义同样尝试 |
| 4 | 路径 **甲**：推广现有 wizard page-state helper 为通用 `pageStateOf` / wrap |
| 5 | Playwright 主定位仍是相对 **`xpath_smart` only**；算法 B / fail-soft |
| 6 | 与 titlebox/section：验唯一者胜；禁止 `(…)[n]` 冒充消歧 |

## Goals

1. Generalize wizard「下一步/上一步」page-state anchoring to **any colliding clickable** leaf whose relative xpath would otherwise be identical across page states.  
2. Keep **unique** clickables unchanged (no unnecessary xpath bloat).  
3. One shared helper for record snap and resolve collision aftermath.  
4. Preserve wizard nav behavior via the same API (no regression).

## Non-goals

- Healing historical coalesced trajectories.  
- Playwright reading page-state outside xpath.  
- Disabling global consecutive coalesce.  
- Vision / L1c-LLM (orthogonal).  
- Forcing page-state wrap on unique form inputs’ label-anchored xpath.

## §1 — Detect / wrap / priority

### `pageStateOf(el)` order (C)

1. Visible `.el-steps` / `.el-step` title with `is-process` or `is-active`.  
2. Else visible `el-dialog` / `el-drawer` title text.  
3. Else short main chrome / breadcrumb title (align existing normalize helpers).  
4. Else empty → **do not wrap**.

### When to wrap

In `buildLocatorSnap` / `xpathSmartOf`, and after resolve collision/titlebox refine:

- Candidate leaf (button / el-button / text link / text tab, etc.) has `eval_count ≥ 2` (or uniqueness verify fails) for its current relative expression, **and**  
- `pageStateOf(el)` is non-empty  

→ build page-state–anchored xpath; **re-verify** unique and equals host; only then set `xpath_smart`.

### Priority (first uniquely verified wins)

1. Existing verified titlebox / section anchor  
2. Page-state wrap  
3. Bare leaf  

Never ship occurrence `[n]` when a verified state/section/titlebox anchor exists.

### Scope of hosts

Clickables in the enrich/resolve clickable surface (buttons, menu-ish text hosts, tabs as text controls). Do **not** force-wrap already-unique labeled form inputs.

### Sync

Edit `src/cdp/page-locator-helpers.js` as source of truth → `node scripts/_gen_locator_helpers_py.mjs`. Wizard 下一步/上一步 becomes a caller of the shared helper (same acceptance as before).

## §2 — Wire / failure / acceptance

### Record

After section/titlebox attempts, if leaf still multi-hit → page-state wrap → verify.

### Resolve-element

Inventory / ambiguous path: after collision refine + titlebox, if same-needle hosts still share a bare leaf (or multi-eval) → try page-state wrap per host.

### Failure (fail-soft)

No page state / wrap still multi-hit / host mismatch → keep best prior xpath; **do not drop** matches.

### Acceptance

1. Two wizard pages, same button text → two distinct `xpath_smart`, each `eval_count === 1`.  
2. Same-label「确定」inside vs outside dialog when colliding → xpath includes dialog title.  
3. Page-unique「保存」→ xpath not lengthened without need.  
4. Wizard 下一步 characterization / wet path does not regress.  
5. Characterization: shared `pageStateOf` + wrap-only-on-collision cues.

## Implementation sketch (not a plan)

- Extract/generalize page-state helpers next to existing wizard-specific code in `page-locator-helpers.js`.  
- Call from `buildLocatorSnap` uniqueness path; optional explicit call from resolve refine.  
- Char script extend or new `characterize-page-state-gen.mjs`.  
- CHANGELOG if product-visible xpath semantics expand beyond wizard nav.

## Open points (non-blocking)

- Exact XPath 1.0 shape for dialog-title wrap — mirror wizard step literal style in implementation.  
- Whether offline `enrichLocatorFields` gets a weak text-only fallback without DOM — **out of P0** (live CDP verify required).
