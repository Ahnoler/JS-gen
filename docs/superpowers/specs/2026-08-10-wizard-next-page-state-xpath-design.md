# Wizard 下一步 / 上一步：page-state relative xpath — Design

**Date:** 2026-08-10  
**Status:** Draft for user review  
**Related:** [dual-save section-anchored xpath](2026-08-10-dual-save-section-xpath-design.md); traj 73 missing multi-page「下一步」; live CDP 9242 wizard (基本信息 → 影像资料)  
**Trigger:** 两页各点「下一步」，录制因连续同 `xpath_smart` coalesce 只留一步。

## Product constraint

Exported relative `xpath_smart` is the **sole** Playwright locate key. Steps that advance different wizard pages must not share one bare `//button[normalize-space()='下一步']`.

## Problem

1. **Identical export xpath across pages:** On the rating apply wizard, URL hash does not change between steps. Live probe (9242): before click `activeStep=基本信息`, after `activeStep=影像资料`, both「下一步」enrich to the same `xpath_smart`.
2. **Recording coalesce:** `_record_action` (`scripts/state.py`) uses `_element_identity` → `xpath:{xpath_smart}`. Consecutive agent/manual ops with the same identity **pop the earlier step** and keep the later. Empty intermediate pages → consecutive「下一步」→ first page transition lost.
3. **Assemble mirror:** `src/dedup.js` `elementDedupKey` uses the same xpath-first rule for consecutive-only assemble dedup (secondary; live record is the product path).

**Evidence (traj 73):** Only one wizard `click_element_by_index`「下一步」with `//button[normalize-space()='下一步']` (phase 6); intermediate 影像/风险 jumps not retained as separate steps.

## Goals

1. **Record:** Clicking「下一步」on page A then「下一步」on page B yields **two** trajectory steps (no silent coalesce).
2. **Export:** Each step’s relative `xpath_smart` embeds **page state** so Playwright can distinguish them; `document.evaluate` count === 1 for the host at record time.
3. **Scope this cut:** Only buttons whose normalized text is exactly **下一步** or **上一步**.

## Non-goals

- Healing old trajectories already collapsed to one「下一步」。
- Changing Playwright engine to read page-state metadata outside xpath.
- Disabling coalesce for all clicks (fill/select same-field coalesce stays).
- Implementing full “any clickable with same relative xpath but different page state” in this cut (tracked as TODO below).

## Chosen approach

**甲 — Page-state relative xpath; coalesce follows xpath**

Rejected:

- **乙** — Skip coalesce for 下一步/上一步 only: keeps two steps but identical xpath → fails Playwright-only locate.
- **丙** — Add `page_state` to coalesce key only: recording OK, export xpath still bare → fails product contract.

## §1 — Principles

- Playwright locate = relative `xpath_smart` only.
- Page state for this cut = wizard **active step title**, else breadcrumb / main title.
- Coalesce identity continues to prefer `xpath_smart`; distinct page-anchored xpaths naturally prevent consecutive merge.
- Prefer fail-soft: if page state cannot be resolved or anchored xpath does not uniquely verify, keep current bare button xpath (do not invent a wrong anchor).

## §2 — Locator: page-state anchor for 下一步 / 上一步

**When:** In canonical `src/cdp/page-locator-helpers.js` (`xpathSmartOf` / `buildLocatorSnap` path), host is a button/`el-button` whose normalized visible text is exactly `下一步` or `上一步`.

**Resolve page state (order C):**

1. Visible `.el-steps` / `.el-step`: title of the step that is `is-process` or `is-active` (match live probe).
2. Else short breadcrumb text (e.g. `.el-breadcrumb`).
3. Else a short main chrome title if already used elsewhere in helpers (keep consistent with existing normalize helpers).
4. Else empty → no page-state wrap.

**Build relative xpath:** Combine page-state literal with the leaf `button[normalize-space()='下一步'|'上一步']` under a stable ancestor that ties the chrome to the footer button (XPath 1.0 / existing `classTokenPred` / `xpathLiteral` style). Exact shape is an implementation detail; acceptance is:

- Contains the page-state string (e.g. `基本信息` vs `影像资料`).
- `evaluate` → exactly one node, equal to host.
- Two different active steps produce **different** `xpath_smart` strings.

**Regenerate:** Edit `page-locator-helpers.js`, then `node scripts/_gen_locator_helpers_py.mjs` — do not hand-edit the Python mirror as source of truth.

**Interaction with section-anchor (dual-save):** Section-anchor for collapse regions remains; page-state wrap applies to wizard nav labels. If both could apply, prefer the path that uniquely verifies; do not ship occurrence `[n]` when a verified page-state or section anchor exists (same product rule as dual-save).

## §3 — Recording coalesce

No special-case whitelist required for 下一步 if §2 works: `_element_identity` already keys on `xpath_smart`.

Optional hardening (only if characterization shows bare-xpath fallback still coalesces wrongly): treat 下一步/上一步 with empty page state as non-coalescable consecutive clicks — **prefer fixing xpath first**.

`src/dedup.js` needs no API change; new xpaths auto-diverge for consecutive assemble dedup.

## §4 — Follow-up TODO (explicit, out of this cut)

| Item | Detail |
|------|--------|
| TODO | 凡「相对 xpath 相同、但页态不同」的可点击控件都锚 |
| Meaning | Generalize page-state (or equivalent) anchoring beyond 下一步/上一步 whenever enrich would otherwise emit identical relative xpath on different wizard/SPA views |
| This cut | Nav buttons only |

## §5 — Tests / characterization

1. **HTML/Playwright fixture:** Two wizard panels with different `is-process` titles and a「下一步」each → enrich yields two distinct `xpath_smart`, each `eval_count === 1`, no shared bare `//button[normalize-space()='下一步']` as sole smart.
2. **Identity / coalesce:** Two consecutive `_element_identity` / `elementDedupKey` (or thin Python mirror of identity) with those xpaths → keys differ → coalesce would keep both.
3. **Wet (9242):** From 基本信息 click 下一步 → on 影像资料 enrich again → smart strings differ and each unique.
4. **Regression:** Single unique「下一步」without steps still works; field fill consecutive coalesce unchanged.

## Success criteria

- New recording that advances 基本信息 → 影像资料 → … keeps a「下一步」step per advance when the agent clicks each time.
- Exported relative xpath alone is sufficient for Playwright to click the correct page’s「下一步」in order.
- Spec TODO for general page-state duplicate controls is written and deferred.

## Out of scope reminders

- Rewriting traj 73 historical steps.
- Forcing agent phase plans to name every wizard page (prompt may mention later; not required for this locator fix).
