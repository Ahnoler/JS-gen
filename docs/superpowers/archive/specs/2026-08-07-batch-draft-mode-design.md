# Batch import draft mode — Design

**Date:** 2026-08-07  
**Status:** Awaiting user review before implementation plan  
**Note:** `docs/` is gitignored in this repo; this file is local-only (same as prior superpowers specs).

## Problem

Batch Excel import today is one-shot **analyze → draft → prepare → record/start → detach**. Product also needs a path that only creates draft trajectories (phases + case data) without starting recording or occupying executor slots — matching the single-transaction dialog’s「保存草稿」vs「保存并进入录制」split.

## Goals

1. Same「批量导入」dialog: user chooses mode via **radio**, then one「开始导入」submit.
2. **`mode=draft`:** per row `analyze → create draft trajectory`, then stop. No prepare / record / detach. No `USE_EXECUTOR` requirement; no slot lease.
3. **`mode=record`:** keep current one-shot behavior (including `USE_EXECUTOR=true` / 503 when false).
4. Still require `functionId` + `systemAccountId` for both modes.
5. Reuse Excel template, parse/validation, Idempotency-Key, cancel, poll, and `batch:*` WS.

## Non-goals

- Batch「continue recording」for drafts created by a draft-mode job (user records later from the trajectory list).
- Separate dialog or separate list-page entry button.
- Changing single-transaction create-dialog behavior.
- Supporting `.xls` (xlsx only, unchanged).

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Entry | Same dialog; **radio** for mode + single submit |
| Draft pipeline | analyze → draft only (same analyze quality as record mode) |
| Account / executor | Account required; executor **not** required for draft |
| After draft job | Done; manual record from list later |
| Backend shape | Same `POST .../batch/import` + `mode` field (Approach 1) |

## API

### `POST /api/v2/trajectories/batch/import`

Multipart fields (existing + new):

| Field | Required | Notes |
|-------|----------|--------|
| `file` | yes | `.xlsx` only |
| `functionId` | yes | |
| `systemAccountId` | yes | |
| `model` | no | |
| `mode` | no | `record` \| `draft`; **default `record`** for backward compatibility |

Header: `Idempotency-Key` required (unchanged).

Behavior:

- **`mode=draft`:** do **not** return 503 when `USE_EXECUTOR=false`.
- **`mode=record`:** unchanged (503 if `USE_EXECUTOR=false`).
- **Invalid `mode`:** HTTP 400 (do not silently coerce to `record` — avoids accidental recording).
- HTTP 202 + v2 envelope `code=200` on accept (unchanged).
- Response `data` includes `mode` plus existing `batchId`, `status`, `summary`, `items`.

### Unchanged paths (response gains `mode`)

- `GET /api/v2/trajectories/batch/template`
- `GET /api/v2/trajectories/batch/{batchId}`
- `POST /api/v2/trajectories/batch/{batchId}/cancel`
- WS `batch:progress` / `batch:done` — payload includes `mode`

## Data model

### `batch_recording_job`

- Add column `mode`: `enum('record','draft') NOT NULL DEFAULT 'record'`.
- Existing rows = `record`.
- **`request_hash`** = SHA-256 of file bytes + `functionId` + `systemAccountId` + `model` + **`mode`**.
  - Same Idempotency-Key with different mode → different hash → **409** (content mismatch), same as today’s hash-mismatch rule.

### `batch_recording_item`

- Add item status **`drafted`** (terminal success for draft mode: trajectory created with `recordStatus=draft`).
- Extend MySQL enum via migration; update `BATCH_ITEM_STATUSES` / `BATCH_ITEM_TERMINAL` in `src/models/constants.js`.

### Status matrix

| | `mode=record` | `mode=draft` |
|--|--|--|
| Item success terminal | `recorded` | `drafted` |
| Item path | pending → analyzing → analyzed → queued → … → recorded | pending → analyzing → analyzed → **drafted** |
| Job `waiting_executor` | possible | **never** |
| Summary | existing counters | add `drafted`; `recorded` stays 0 |

Job terminal statuses unchanged: `completed` / `completed_with_errors` / `failed` / `cancelled`.

## Scheduler / workers

File: `src/services/trajectory-batch-service.js` (primary).

1. Shared analyze pump (`BATCH_ANALYZE_CONCURRENCY`) for both modes.
2. After analyze, `createDraftFromAnalyzed` branches on `job.mode`:
   - **`draft`:** transactional create trajectory + phases + case (same helper as today) → bind item → status **`drafted`** (terminal). Do **not** call `bindTrajectoryAndQueue` / enqueue recording.
   - **`record`:** keep current path → queue → executor wait → prepare → record → detach → `recorded`.
3. Recording pump only claims items whose job `mode=record` and status in `queued|waiting_executor` (and existing lease rules).
4. Restart recovery: draft jobs only resume analyze / draft-create; never promote `drafted` into recording. In-flight prepare/recording recovery rules apply only to record-mode items.

## Cancel

- Same safety rules: do not downgrade `recorded` **or `drafted`** (keep created draft trajectories).
- Cancel during analyze: discard LLM result, no draft (unchanged).
- Draft mode has no preparing/recording cancel path.

## Errors

- Analyze failure / empty phases / draft create failure → item `failed`; job may end `completed_with_errors`.
- Draft mode + `USE_EXECUTOR=false` → import allowed.
- Record mode + `USE_EXECUTOR=false` → 503 (unchanged).

## Frontend (Vue: `BatchImportDialog` + `batchImport` store + `recording` API)

- Below upload: **`el-radio-group`** with two options:
  - 仅存草稿 → `draft`
  - 存草稿并录制 → `record` (**default**)
- Single primary button「开始导入」; submit sends selected `mode`.
- Preconditions: file + selected function + `accounts[0]`; show hint when missing.
- Task cards show mode badge（草稿 / 录制）; map `drafted` →「已存草稿」.
- Reuse poll / cancel / header badge / terminal list refresh.
- Client Idempotency-Key generation must remain Secure-Context-safe (existing fallback).

## Docs & characterization

- Update `src/dashboard/api-docs/catalog.js` batch-import group: `mode`, `drafted`, draft-mode executor note.
- Extend / add smoke: draft import without executor succeeds; successful items are `drafted` with draft trajectories; record mode regression unchanged.

## Testing notes

- Idempotency: same key + same file + same mode → replay; same key + same file + other mode → 409.
- Cancel after some rows `drafted`: those trajectories remain; remaining rows cancel.
- UI: radio default `record`; switching to draft and submitting does not hit executor gate.

## Out of scope follow-ups (explicit)

- `POST .../batch/{id}/start-recording` or similar resume API.
- Per-row mode mix inside one Excel upload.
