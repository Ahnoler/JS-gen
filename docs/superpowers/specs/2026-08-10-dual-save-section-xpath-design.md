# Dual / duplicate controls: section-anchored relative xpath — Design

**Date:** 2026-08-10  
**Status:** Draft for user review  
**Related:** [phase-section-scope](2026-08-08-phase-section-scope-design.md) (deferred “duplicate 保存 xpath dedupe”); traj 73 phase 6 dual「保存」; Playwright export locators  
**Trigger:** 对公评级编辑页两 region 各有「保存」；录制/导出 xpath 为 `(//button[normalize-space()='保存'])[1]` → 永远点「系统评级结论」。

## Product constraint (non-negotiable)

Every step’s **relative `xpath_smart` is exported** and used as the **sole locator** in the Playwright execution engine. That engine does **not** re-read `params.section` for disambiguation.

Therefore: if two same-looking controls exist on one page, the exported relative xpath **must** already be unique for the intended host. Section (collapse / tab / card) must be **baked into** the relative xpath when needed.

## Problem

1. **Record-time wrong click:** `click_save` without explicit `section=` still prefers sticky `_phase_section`. After saving「系统评级结论」, a later phase that fills「客户综合评价」and calls bare `click_save()` reuses sticky section and clicks the first region’s 保存. Extracted content `ok-clicked-save:保存` proves this path.
2. **Bad export xpath:** `_enrich_click_element` / `pinOccurrence` turns multi-hit `//button[normalize-space()='保存']` into `(…)[1]` / `(…)[2]`. Occurrence index is **document order**, not region identity; Playwright export has no section metadata to recover intent.
3. **Generalization:** Same failure mode for any duplicate on-page control (同文案按钮、同结构 leaf)，not only 保存.

**Live evidence (CDP 9242 edit page):**  
`[1]` → 系统评级结论；`[2]` → 客户综合评价.  
`click_save('保存','')` → `ambiguous` with both candidates (correct when section empty and no sticky injection).

## Goals

1. **New recordings:** When ≥2 same-label save buttons are visible and LLM omits `section=`, **do not** apply sticky `_phase_section`; return `err-save-ambiguous` (existing), force explicit `section=`.
2. **Exported relative xpath:** When the candidate smart xpath matches **≥2** nodes and the host sits under a non-`__root__` section (collapse / tab / card per `attachSection`), emit a **section-anchored** relative xpath that evaluates to **exactly one** node — the host. **Never** ship bare occurrence pins `[n]` as the final exported `xpath_smart` for that case.
3. **Same-page duplicate-component disambiguation (in scope):** Apply the multi-hit → section-anchor rule on the shared locator / enrich path for **all** recorded clickable/control hosts, not only `click_save`.
4. **Replay / Playwright:** New trajectories succeed using **only** relative `xpath_smart` (product engine). Live `_replay.py` continues to prefer `xpath_smart` and benefits without requiring `params.section`.

## Non-goals

- Healing **old** trajectories already stored with `(…保存)[1]` (e.g. traj 73) — out of this cut (user chose success tier B, not C).
- Promoting recorded `action_type` from `click_element_by_index` to `click_save` as a schema migration.
- Making Playwright engine read `params.section` (product design forbids relying on that).
- Changing phase-intent NL → section hard-parse (still LLM-declared `section=` for save gate / click).

## Chosen approach

**甲 — Record disambiguation + section-anchored export xpath (general)**

Rejected:

- **乙** — Only clear sticky / prompt tweaks: export xpath can still be `[n]`, Playwright still wrong.
- **丙** — New `action_type=click_save` as primary fix: larger assembler/compat blast; does not by itself fix exported xpath for other duplicate controls.

## §1 — Principles

- Playwright export locator = relative `xpath_smart` only.
- Scope for **clicking** during recording may use LLM `section=`; scope for **export** must be encoded in xpath.
- Sticky `_phase_section` must not silently choose among multiple same-label saves.

## §2 — `click_save` section resolution (record)

Order:

1. **Explicit** `section=` → use it; `remember_phase_section`.
2. Else inspect same-label visible button candidates (same notion as `JS_CLICK_SAVE_BUTTON`):
   - **≥2** → **ignore sticky**; do not click; `err-save-ambiguous` (+ candidates).
   - **Exactly 1** → may use `unique_button_section` / empty section and click.
3. Sticky `_phase_section` is **not** consulted when step 2 would be multi-candidate.

Existing scoped pending gate / `err-section-required` unchanged when applicable.

Prompts / `preferred_submit_cue`: when scan shows ≥2「保存」(or preferred submit labels) in distinct sections, require `section=`.

## §3 — Locator: section-anchored relative xpath

**When (shared enrich / `xpathSmartOf` / post-`pinOccurrence` path):**

- Base smart expr for host evaluates to **N ≥ 2** nodes, **or** current code would emit `withOccurrence(…, n)`, **and**
- Host has section via existing attach rules (`.el-collapse-item` / `.el-tab-pane` / `.el-card` with title),

**Then:**

1. Build section-anchored relative xpath, e.g. collapse:

```text
//div[contains(@class,'el-collapse-item')][.//*[contains(@class,'el-collapse-item__header') and contains(normalize-space(.),'<SECTION_TITLE>')]]//button[normalize-space()='<BTN_TEXT>']
```

   (Tab/card variants mirror `attachSection` anchors; keep XPath 1.0 / existing helper style.)

2. Re-`evaluate`: must return **exactly one** node and that node **is** host (or verified equivalent).
3. Write that string to `element.xpath_smart` (and params copy if already mirrored today).
4. If section-anchor cannot uniquely verify → fail enrichment loudly / keep non-exported failure path; **do not** fall back to global `[n]` as the exported smart xpath for multi-hit duplicates.

**`params.section`:** still recorded on successful `click_save` when known (gate/logs/characterization). **Not** part of Playwright locate contract.

## §4 — Same-page duplicate-component disambiguation

Tracked as **in-scope work item** (user choice A), not a follow-up:

| Item | Detail |
|------|--------|
| TODO | 同页面重复组件消歧 |
| Mechanism | Multi-hit smart xpath → section-anchored relative xpath on shared locator path |
| Applies to | Any recorded control host that goes through enrich/pin (buttons and other clickable leaves), not only 保存 |
| Acceptance | Exported xpath alone uniquely hits the intended host on a page with ≥2 siblings of the same leaf pattern |

`click_save` sticky/ambiguous rules remain specific to save UX; xpath export rule is general.

## §5 — Tests / characterization

1. Sticky `_phase_section='系统评级结论'` + DOM two「保存」+ `click_save()` no section → **no click**, ambiguous / `err-save-ambiguous`.
2. `click_save(..., section='客户综合评价')` → click second region; exported `xpath_smart` contains section anchor; `evaluate` length === 1 and host match.
3. Generic duplicate: two same-label buttons in two collapses → enrich emits section-anchored xpath, **not** `(…)[1]`.
4. Regression: single unique「保存」still works; xpath may stay simple when N === 1.

## Success criteria

- New recording on dual-save page with correct `section=` produces Playwright-exportable xpath that clicks **客户综合评价** 保存 without reading section at execute time.
- Bare `click_save()` with sticky leftover cannot silently click the wrong region when two saves exist.
- Duplicate non-save controls get the same xpath treatment when multi-hit.

## Out of scope reminders

- Manual/DB rewrite of traj 73 step 56.
- Scan `buttons[]` xpath dedupe-only cleanup beyond what enrich already fixes on record (nice-to-have if cheap; not required if enrich always rewrites on click).
