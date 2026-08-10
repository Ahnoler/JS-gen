# Design: Full-page L2 P2 — icon / chrome menu noise filter

**Date:** 2026-08-10  
**Status:** Implemented 2026-08-10  
**Backlog:** Fullpage scan **P2** ([parent](2026-08-10-fullpage-visible-controls-scan-design.md))  
**Related:** P0/P1 fullpage L2; `scan_editable_summary`; wet-run `.superpowers/sdd/wet-fullpage-p1-results.json`

## Problem

P0/P1 fullpage L2 admits shell `menu_item` / `icon` into inventory (correct). On 天阳门户 modify 页，清单被门户 **chrome** 淹没：水平/垂直布局、主题色、关闭页签等，挤占 Agent 对业务侧栏与工具栏 icon 的注意力。装饰 icon 也可能过收录。

## Goals

1. **Hard-exclude** chrome menus and decorative icons from L2 fields and from `scan_editable_summary.buttons`.  
2. **Keep** business nav menus and toolbar icons that have usable accessible names / tooltips.  
3. Dual layer (**approach C**): JS admission gate + thin Python summary projection filter sharing the same label blocklist seed.

## Non-goals

- Menu_item **naming** polish (readable rewrite of labels).  
- Memory Fact Pack for shell controls.  
- LLM / vision L1 assist.  
- Changing `filter_fillable_scan_fields` (menu/icon/shell already non-fillable).  
- Removing legitimate business shell nav from inventory.

## Locked decisions (brainstorm 2026-08-10)

| Topic | Choice |
|-------|--------|
| Primary focus | Noise reduction (not naming / Fact Pack) |
| Exclude style | **Hybrid hard-exclude** |
| Chrome detection | Label blocklist **OR** structural chrome host |
| Architecture | **C**: JS L2 gate + Python summary safety net |

## Rules

### Chrome menu — exclude if **either** matches

**Label blocklist (seed from wet-run; extend carefully):**

- contains `布局` (e.g. 水平布局 / 垂直布局)  
- contains `主题` (e.g. 白色主题)  
- matches close-tab chrome: `关闭` + `页签`, or `固定页签` / `非固定页签` style ops  
- **P2-noise+ (2026-08-10):** same with synonym **`标签`** (e.g. `关闭所有标签(含固定)`) — do **not** exclude bare business labels that merely contain `标签` without `关闭`/`固定`

**Structural hosts (implement with `closest`; prefer chrome chrome, not all dropdowns):**

- Dropdown / popover that is **chrome-scoped**: under header settings, layout/theme switcher, or tags-view **context** menu — not every `.el-dropdown-menu` on the page (business cell/toolbar dropdowns stay).  
- Concrete seeds: `.tags-view-item` context ops, header user/settings menus, known theme/layout popover roots when class/role identifiable.  
- If structure is ambiguous, **label blocklist alone** may still exclude; do not blanket-drop all `.el-dropdown-menu__item`.

**Do not** exclude solely because the node is under `.el-aside .el-menu` (business sidebar must remain).

### Decorative icon — exclude if

- No usable name: empty `aria-label` / `title` / tooltip text, **or**  
- Class heuristic already used (arrow / caret / close / loading) plus small extensions if needed, **or**  
- Inside a chrome structural host above  

### Keep

- Business `menu_item` in primary nav (e.g. 客户管理)  
- Toolbar `icon` with usable tooltip / aria (e.g. 新增)

## Architecture

```text
JS_SCAN_FORM_FIELDS mode:fullpage
  menu/icon collectors
    → isChromeNoise(el, kind, label)?  → skip pushField
    → else pushField (L2)

build_editable_summary
  project menu_item/icon → buttons
    → label blocklist? → skip
    → else append to buttons
```

| Layer | File | Duty |
|-------|------|------|
| Primary gate | `scripts/controller/actions/js_snippets/scan_form.py` | Hard skip before `pushField` for fullpage menu/icon |
| Safety net | `scripts/controller/actions/form_scan_utils.py` (`build_editable_summary`) | Re-filter when projecting menu/icon → `buttons` |
| Shared seed | Prefer one documented blocklist (JS string + Python mirror, or thin shared comment + dual lists kept in sync via characterization) | Label patterns |
| Untouched | `filter_fillable_scan_fields` | Already excludes shell + menu_item + icon from TaskList |

## Testing

**Characterization**

- Cue: chrome / noise filter markers in `scan_form.py`  
- Unit: Python blocklist rejects 水平布局 / 白色主题 / 关闭当前页签; keeps 客户管理 / 新增  
- Summary: projected `buttons` must not include blocklisted chrome texts when fields still contain them (safety-net path) **or** fields already clean after JS (primary path) — assert both layers exist in source  

**Optional wet-run (9242)**

- Same modify rating page: chrome texts absent from `summary.buttons`  
- At least one business menu **or** named toolbar icon remains  
- Form/table field counts do not regress vs P1 baseline (~48 fillable / table cells still present)

## Success criteria

- [x] Chrome layout/theme/close-tab menus hard-excluded from L2 admission  
- [x] Decorative unnamed icons hard-excluded  
- [x] Business nav + named toolbar icons still appear in inventory / summary buttons  
- [x] Python summary projection applies the same label blocklist  
- [x] Characterization green; optional wet-run documented  

## Out of scope / later

- P2 naming polish for menu_item  
- Shell → memory Fact Pack  
- Vision assist for disputed hosts (parent spec “dynamic L1 P2” vision track — **orthogonal**; this doc is **noise filter P2**)
