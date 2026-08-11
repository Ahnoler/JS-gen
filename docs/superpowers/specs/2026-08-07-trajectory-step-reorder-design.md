# Trajectory Step Reorder / Cross-Phase Move

**Date:** 2026-08-07  
**Status:** Approved for implementation planning  
**Repos:** JS-gen (control plane) + ui-auto-recording-agent-vue (StepsPanel)

## Problem

Product editing needs drag-and-drop to change step order within a trajectory and to move a step into another phase at a chosen position. Today:

- Ordering is global `trajectory_step.step_number` (1..n); phase membership is `trajectory_phase_id` (+ denormalized `phase_number`).
- After CRUD, the server only **compacts** numbers via `reorderByTrajectory`; there is no first-class move/reorder API.
- Vue `StepsPanel` uses SortableJS **within a phase only**, emits `move-step(groupId, fromIndex, toIndex)`, and `handleMoveStep` only splices locally (“不落库”).

Separately, column `trajectory_step.is_replay` is dead in practice (always 0) while request/runtime `isReplay` means “suppress persist during replay,” which repeatedly misleads designs and reviews. This work removes the column.

## Goals

1. After recording (edit UI): drag one step to a new position, including **across phases**, and persist order + phase binding.
2. Canonical sort key remains **`step_number`**; phase membership remains **`trajectory_phase_id`** (keep `phase_number` in sync).
3. Allow reorder whenever the session is **not** AI-recording / manual-recording / replaying — **do not** gate on trajectory `status`.
4. Remove dead `trajectory_step.is_replay` and all filters on it; keep replay **request/runtime** suppress-persist semantics.

## Non-goals

- Reordering phases themselves (existing `PUT .../phases` sync).
- Multi-select / block move (one step per drag).
- Auto-repair of soft `step_number` references (e.g. `operation_component_occurrence`).
- Renaming the replay request body field `isReplay` (document only; avoid FE breaking change).

## Approach (chosen)

**Relative move API** (not full-list PUT, not index-only payloads):

`POST /api/v2/trajectories/{trajectoryId}/steps/move`

```json
{
  "stepId": 123,
  "targetPhaseId": 7,
  "beforeStepId": 456
}
```

| Field | Rules |
|-------|--------|
| `stepId` | Required; must belong to the trajectory |
| `targetPhaseId` | Required; must belong to the trajectory. Orphan virtual group (`id === -1`) is not a valid target |
| `beforeStepId` | Optional. If set: insert **before** that step. If `null`/omitted: append to **end of target phase** |
| `beforeStepId` validation | If set: same trajectory, must already be (or will remain) in `targetPhaseId`; must not equal `stepId` |

Rejected alternatives: full ordered `{ stepId, phaseId }[]` (heavy, not one-drag shaped); `(groupId, fromIndex, toIndex)` only (fragile across refresh).

## API behavior

**Server (single transaction):**

1. Load non-artifact steps for the trajectory (after `is_replay` removal: all formal steps; historically this matched tree’s `includeReplay=false` set).
2. Validate step, target phase, and optional `beforeStepId`.
3. If recording/replay busy on the bound session → `409`.
4. Update moved row: `trajectory_phase_id`, `phase_number` from target phase.
5. Place step: before `beforeStepId`, or at end of that phase’s segment in the global list (phases ordered by `phase_number`).
6. Rewrite global `step_number` = 1..n for the formal step list.
7. Screenshots / form_snapshots stay on `trajectory_step.id` — no migration.
8. Idempotent no-op (same phase and same neighbors) → `200` without unnecessary writes.
9. Response: moved step (new `stepNumber`, `trajectoryPhaseId`, …). Client may `GET .../tree` to refresh.

**Errors:** `400` invalid ids/anchors; `409` session busy; no rejection based on trajectory status (`draft` / `recorded` / `completed`).

**Catalog:** document under trajectory step APIs in `src/dashboard/api-docs/catalog.js`.

## Frontend (Vue)

**SortableJS (`StepsPanel.vue`):**

- Shared `group: 'trajectory-steps'` across phase `.group-steps` containers (cross-phase drag).
- Keep disable rules: recording / AI busy / manual recording / replay busy; only `step.id > 0`.
- Orphan group (`id === -1`): allow **pull out** to a real phase; **`put: false`** (cannot drop into orphan).
- `onEnd`: resolve `stepId` (e.g. `data-step-id`), `targetPhaseId` from destination container, `beforeStepId` = next sibling’s id or `null` if last.

**Event (replace index-only):**

```ts
"move-step": [{
  stepId: number
  targetPhaseId: number
  beforeStepId: number | null
}]
```

**`handleMoveStep`:** optimistic local splice → `POST .../steps/move` → on success `refreshTree()`; on failure toast + rollback/refresh.

**API:** `moveTrajectoryStep(trajectoryId, body)` in `recording.ts`; `doMoveStep` in `useRecordingStudio`.

## Backend placement

- Route next to existing step routes in `src/routes/v2/trajectory.js`.
- Service: `trajectory-step-service.moveStep(...)`.
- Prefer extending/reusing compaction semantics of `reorderByTrajectory` so numbering stays one code path.

## Remove `trajectory_step.is_replay`

**Finding:** Product paths never persist `is_replay=1`. Recording writes `false`; replay with `isReplay: true` sets `runtime.isReplay` and **skips** `action_log_sync` entirely; Type B / manual create leave default `0`. Filters on the column are no-ops and cause repeated confusion with request body `isReplay`.

**Actions:**

| Area | Change |
|------|--------|
| Migration | Drop index + column `is_replay`; update `schemas/init.sql` and baseline table defs as appropriate |
| Read paths | Remove filters in `listByTrajectory`, step_count helpers, operation-component signature filters, smoke/characterization scripts that assume the column |
| Write paths | Remove persist / `batchSave` / entity mappings for `isReplay` ↔ column |
| Keep | `POST .../steps/replay` body `isReplay` = suppress persist; `runtime.isReplay`; Python stdin `is_replay` for replay_actions |
| Docs | Catalog: **request `isReplay` ≠ any table column** (column removed) |
| Vue types | Drop step-level DB `isReplay` if present; keep replay API `isReplay` |

## Testing

- Within-phase: move earlier, later, to end (`beforeStepId` omitted).
- Cross-phase: insert middle and append end; empty phase receives first step.
- Invalid `beforeStepId` / wrong trajectory → `400`.
- Busy recording/replay → `409`.
- After move, `GET .../tree` phase grouping and global `stepNumber` match UI.
- After migration: no code path references column `is_replay`; replay with `isReplay: true` still does not append steps to the trajectory.

## Success criteria

- Dragging a step in the product StepsPanel persists order and phase without manual refresh hacks beyond tree reload.
- Cross-phase drop updates both `trajectory_phase_id` and global `step_number`.
- No remaining `trajectory_step.is_replay` column or filter; naming confusion limited to documented runtime `isReplay`.
