# Transaction export V2 (对接约定信封) — Design

**Date:** 2026-08-10  
**Status:** Draft for user review  
**Related:** V1 five-field export (`src/services/legacy-engine-export.js`, `/api/v2/export/.../legacy-engine`); `trajectoryStepToActionEntry`; assemble-file (unchanged)  
**Trigger:** 对接同事约定（`参数.txt`）+ 轨迹脏标记 `is_export`；取代此前以 `result.txt` ActionFile 为主格式的草案。

## Goals

1. Export a trajectory as the **partner envelope** (field names and typos as specified: `transcation*`, `mothed`, `transcId`).
2. Map only **currently recordable** UI actions into `transcationEventType[]`.
3. Track export freshness via trajectory `is_export` (0/1).
4. Support **single** and **batch** full-trajectory export; caller supplies `systemId` / `projectId`.
5. Keep V1 legacy-engine export and `assemble-file` untouched (V1 = development record).

## Non-goals

- Calling partner APIs to resolve project/system trees (caller queries those, then passes ids).
- Partial export (`stepIds` / `phaseIds`) and export coverage metadata — **TODO comments only**.
- Emitting `placeholder` — **TODO** (wait whether relative xpath / partner fields cover it).
- Mapping the full traditional-engine catalog (`mouse:*`, `iframe:*`, `alert`, `checkbox`, …).
- Changing Playwright assemble / replay paths.

## Chosen approach

**Independent V2 export service + routes under `export-mgmt`**, reusing V1 mapping primitives (`ACTION_TO_ENGINE_TYPE`, `pickExportTarget`, `buildOperationName`, `pickOperationValue`, `SKIP_ACTIONS`) via `trajectoryStepToActionEntry`.

Not chosen: extending `assemble-file` with a format flag (mixes product export with assembler I/O); dual-view inside V1 service (couples deprecated contract to product V2).

## Architecture

```
Caller: systemId, projectId
        +
trajectoryDao.getById → steps, name, id
        ↓
trajectoryStepToActionEntry
        ↓
transaction-export.js (new)
  · map steps → partner envelope
  · on full export success → is_export = 1
        ↓
export-mgmt.js routes
```

**Dirty flag:** any phase/step add/update/delete (including live record persist) → `is_export = 0`.

## Operation types (exportable)

| `eventTypeValue` | `eventTypeName` | Source actions |
|------------------|-----------------|----------------|
| `click` | 点击 | `click_element_by_index`, `click_menu_item`, `click_table_row_button`, `click_adjacent_button`, `click_icon_button`, `switch_tab`, `close_dialog`, `expand_all_el_tree` |
| `input` | 文本框输入 | `fill_form_field` |
| `select:click` | 下拉框点击选择 | `select_option` |
| `select:tree` | 下拉框树形选择 | `select_tree_option` |
| `radio` | 单选框选择 | `click_radio`, `click_table_row_radio` |
| `date` | 日期 | `fill_date_field` |

Skipped (meta/nav): `go_to_url`, `wait_for_loading`, scroll/scan/screenshot/task/case helpers, `login`, `done`, etc. → counted in `skipped.metaActions`, not in the array.

## Envelope field mapping

### Top level

| Field | Rule |
|-------|------|
| `transcId` | `String(trajectory.id)` |
| `transcationName` | `trajectory.name` or `trajectory-{id}` |
| `systemId` | Required from caller (stringified) |
| `projectId` | Required from caller (stringified) |
| `transcationType` | `"web"` (written for联调; partner may ignore) |
| `testFrame` | `"selenium"` (same) |
| `transcationEventType` | Array of mapped events |

### Each `transcationEventType[]` item

| Field | Rule |
|-------|------|
| `eventTypeValue` | From `ACTION_TO_ENGINE_TYPE` |
| `eventTypeName` | Category Chinese from table above |
| `propertiesName` | `buildOperationName(...)` (same as V1 readable name, e.g. `填写:用户名`) |
| `objectValue` | `pickOperationValue(...)`; clicks → `""` |
| `elementType` | XPath: prefer `xpath_smart`, else `xpath_full` |
| `options` | None → `""`; else `JSON.stringify(string[])` |
| `mothed` | `"By.XPATH"` |
| `transcationType` | `"selenium"` |

Do **not** emit `action` / `params` / `attributes` / `placeholder`. Preserve partner spellings (do not “fix” names).

## `is_export` product rules

| Item | Rule |
|------|------|
| Column | `trajectory.is_export` (0/1); API `isExport` |
| Default | New rows `0`; migration sets existing to `0` |
| Set `1` | Successful **full** single or batch item export |
| Set `0` | Any phase or step add/update/delete, including live persist |
| Empty trajectory | `count: 0` still sets `1` (export of current content succeeded) |
| Partial export | Not implemented; TODO comment only |

## API

### Schema

- `GET /api/v2/export/transaction/schema` — envelope fields + event type map

### Single (full trajectory only)

- `GET|POST /api/v2/export/trajectories/:id/transaction`
- Required: `systemId`, `projectId`
- Optional: `download=1` → body is pure payload attachment; still set `is_export=1`
- Success wrapper:
  - `trajectoryId`, `isExport`, `schemaVersion`, `payload`, `count`, `skipped`, `stats`
- Errors: `404` missing traj; `400` missing ids

### Batch

- `POST /api/v2/export/transactions`
- Body: `{ trajectoryIds: number[], systemId, projectId }`
- Response: `{ schemaVersion, systemId, projectId, items: [...], summary: { ok, failed } }`
- Each successful item sets that trajectory’s `is_export=1`; failures leave flag unchanged and include `error`
- One trajectory → one `payload` envelope (shared system/project ids; distinct `transcId`)

### Read APIs

- Trajectory list/detail include `isExport`

## Error handling & stats

- `stats.absoluteFallback` — steps that used full xpath
- `stats.missingOptions` — select-like steps without options inventory
- No invented options/placeholder at export time

## Testing / acceptance

1. Unit/characterization: step → event fields (`options` empty vs JSON string; `mothed`; spellings).
2. Skip set does not appear in `transcationEventType`.
3. Missing `systemId`/`projectId` → 400.
4. `is_export`: export → 1; mutate phase/step → 0; batch ok/fail independence.
5. V1 legacy-engine + assemble-file regressions green.
6. Manual: export payload importable by partner; dirty flag visible in UI/API.

## Implementation sketch (for planning)

- Migration: `is_export` on trajectory
- `src/services/transaction-export.js` (name flexible)
- Wire dirty resets in phase/step/persist write paths
- Extend `export-mgmt.js` + `catalog.js`
- Characterization under `scripts/characterization/`
- TODO comments: partial export, coverage scope, placeholder

## Open TODOs (explicit, not blockers)

1. Partial export / export coverage range  
2. `placeholder` if partner or relative xpath later requires it  
3. Partner project/system query APIs remain outside this repo  

## Approval

Design sections §1–§4 approved in brainstorming (2026-08-10). Spec pending user file review before writing-plans.
