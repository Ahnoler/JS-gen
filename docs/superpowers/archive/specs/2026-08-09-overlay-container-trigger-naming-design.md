# Overlay container naming with trigger button

**Date:** 2026-08-09  
**Status:** Approved for planning  
**Scope:** Recording identity for `dialog:` / `drawer:` containers; replay verify title extraction; LLM-readable IDs.

## Problem

Element UI overlays often have empty titles, so recording emits `dialog:unnamed` / `drawer:unnamed`. That is opaque to the LLM and brittle for humans reading trajectories. We already fixed verify matching for the `unnamed` sentinel (empty title/aria). Separately, product wants the **trigger button name** in the container id so the agent can tell *which* control opened the overlay (e.g. 新增 vs 引入).

## Goals

- Record overlay containers as `dialog:<按钮>|<标题>` when a trigger button is known.
- Keep button segment **LLM-facing only**; locate / `verifyFormStructure` match on **title only**.
- Backward-compatible with existing snapshots (`dialog:选择客户`, `dialog:unnamed`).
- No DB migration; no DOM reverse-inference of the trigger.

## Non-goals

- Renaming `main` / `tab:` containers.
- Migrating historical MySQL / trajectory snapshot container strings.
- Inferring trigger from DOM (`aria-expanded`, etc.).
- Changing Type B heal policy beyond title parsing.

## Naming contract (§1)

Type prefix remains ASCII `dialog:` / `drawer:` / `main`.

Button and title are separated by **`|`** (pipe). Do not use fullwidth `：` (rejected) or ASCII `:` after the type prefix (would collide with `dialog:`).

| Case | Recorded `container` |
|------|----------------------|
| Trigger + titled overlay | `dialog:新增\|新增客户校验` |
| Trigger + empty title | `dialog:新增\|unnamed`（保留哨兵，避免与标题真为「新增」的旧 ID 冲突） |
| No trigger + titled | `dialog:新增客户校验` (legacy shape) |
| No trigger + empty title | `dialog:unnamed` (keep sentinel) |

Same rules for `drawer:` (title from aria-label / drawer header as today).

### Verify parse (title only)

Given a container id:

1. Strip `dialog:` or `drawer:` → `rest`.
2. If `rest` contains `|`, **title** = substring after the first `|`; button segment ignored.
3. Else entire `rest` is the title (legacy ids only — never treat bare `dialog:新增` as empty-title).
4. Empty title or literal `unnamed` → match visible overlay with empty title/aria (existing unnamed rule).

Compose must therefore emit `|unnamed` when the trigger is known and the DOM title is empty, so verify stays unambiguous.
## Data flow (§2)

### Remember trigger

On **successful** click-like actions that typically open an overlay, write `case_data_store['_last_trigger_button']` from params:

- `click_element_by_index` → `text`
- `click_icon_button` → `button_text`
- Table / row button helpers → button label when present

**Exclude / do not overwrite** with: empty text, calendar day noise, concatenated option dumps, routine `click_save` / 查询 unless later proven to open a named overlay (YAGNI: start with open-ish clicks only).

### Compose

DOM identify / scan continue to emit raw ids (`dialog:<title|unnamed>`, etc.). After raw id is known (e.g. in `_save_form_snapshot` / first-touch scan path), apply:

`compose_overlay_container(raw_id, trigger) → display_id`

- Only rewrite `dialog:` / `drawer:`.
- With trigger + raw title `unnamed` or empty → `dialog:<trigger>|unnamed`.
- With trigger + real title → `dialog:<trigger>|<title>`.
- Without trigger → return `raw_id` unchanged.
- Failures: silent fallback to `raw_id`; never abort recording.

### Lifecycle

- Clear `_last_trigger_button` when returning to `main` or after successful `close_dialog` (avoid stale hang onto the next overlay).
- Within the same overlay, keep the **first** composed id for subsequent scans in that container (do not re-compose from later clicks inside the overlay).

### Replay

Replay / Type B verify does **not** use `_last_trigger_button`. It only parses the stored container string per §1.

## Implementation touchpoints (§3)

| Layer | Change |
|-------|--------|
| Python helpers | `compose_overlay_container`, `overlay_title_from_container_id` (unit-tested) |
| Recording | Set/clear `_last_trigger_button`; call compose when persisting overlay container on snapshot / scan |
| `JS_IDENTIFY_CONTAINER` | Unchanged (still title / unnamed) |
| `JS_VERIFY_FORM_STRUCTURE` + CTRL `verifyFormStructure` | Parse `|` / button-only id before `matchTitle` |
| Characterization | Compose truth table; title extract + match; source wires for memory + compose call |

Error path: missing container after parse still returns `container_not_found`; Type B remains unsafe / no snapshot mutate (existing policy).

## Testing

1. Compose truth table (pipe, no title, no trigger, drawer, unnamed+trigger).
2. Title extract / match: new ids by title; legacy ids regression; `dialog:新增|unnamed` → empty-title; bare `dialog:unnamed` sentinel still works.
3. Source asserts: trigger memory write sites; compose invoked on snapshot path.
4. Existing `characterize-verify-form-structure.mjs` extended for `|` parse (CTRL + agent parity).

## Success criteria

- New recordings of untitled overlays opened via 「新增」 persist `dialog:新增|unnamed` (or `dialog:新增|<title>` when titled), visible to the LLM in snapshot / step context.
- Replay of those checkpoints matches the live overlay by **title** (or empty title), ignoring the button prefix.
- Old trajectories with `dialog:unnamed` / `dialog:选择客户` keep working without migration.

## Open decisions (resolved)

- Format: **A** — button + separator + title.
- Separator: **`|`**.
- Trigger source: last successful open-ish click text.
- Compat: verify ignores button; title-only match; no DB migrate.
- Approach: compose in Python after DOM identify (not dual schema fields).
