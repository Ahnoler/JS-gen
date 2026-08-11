# Browser / remote_session lifecycle — Design

**Date:** 2026-08-11  
**Status:** Approved (brainstorm) — awaiting implementation plan  
**Related:** `src/services/remote-session-service.js`, `src/services/remote-session-state.js`, `src/services/trajectory/trajectory-attach-service.js`, `src/services/trajectory-idle-reaper.js`, AGENTS.md multi-traj BiB notes; prior dirty-pointer fix (2026-08-04, still regressing)

**Trigger:** Live DB showed broken bidirectional mounts — e.g. traj `112` → `remote_session` `576` while `576.trajectory_id = 129`; half-empty mounts (`traj.remote_session_id` set, `rs.trajectory_id` NULL); same `remote_session` ownership drifting across trajs.

## Problem

1. **Dual FK without a single writer** — `trajectory.remote_session_id` and `remote_session.trajectory_id` are updated on multiple paths (`mount` / `unmount` / `attachLive` / `getLiveStatus` rewrite / `supersede` / reaper). Half-writes produce cross-links and ghost occupancy.
2. **`streamDetach` vs reclaim semantics are underspecified** — stream detach clears mounts inconsistently; idle Chrome reuse (`preferIdleChrome`) can reassign while another traj still “thinks” it owns the session.
3. **Prior “dirty pointer” fix did not hold** — reconcile helpers exist but are not the exclusive gate; product still observes invariant breaks via SQL.
4. **Low observability** — binding bugs are diagnosed only by ad-hoc JOINs; attach/deny/grace/reaper lack a consistent log contract.

## Goals

1. **Single source of truth:** `remote_session.trajectory_id` owns affiliation; `trajectory.remote_session_id` is a **derived cache** written only by the lifecycle facade.
2. **Documented state machine** for `attach` / `streamDetach` / grace expiry / `detach` / `close` / reaper, with hard exclusivity during grace.
3. **One write gate (`SessionLifecycle`)** — all binding/status mutations go through it; no side-path FK edits.
4. **Acceptance:** data invariants + product-visible behavior + structured lifecycle logs.

## Non-goals

- Rewriting executor **slot lease**, BiB bridge internals, or Chrome discovery (`preferIdleChrome` algorithm) beyond **pre-claim ownership checks**.
- DB-enforced dual-column FK symmetry (optional later: partial unique on occupied `trajectory_id`).
- Python control-plane full port in this cut (if HTTP error body gains `code`, note in CHANGELOG for sync).
- Changing product SPA beyond consuming clearer 409/`getLiveStatus` (frontend repo separate).

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Outcome | Map current model **and** ship an executable fix design |
| Truth | **`remote_session.trajectory_id`**; traj `remote_session_id` = cache |
| Scope | Binding + lifecycle semantics (not full resource orchestrator) |
| After `streamDetach` | **Grace period**: still owned by original traj; then unowned idle |
| Other traj during grace | **Hard 409** — no preemption |
| Done looks like | Invariants + product flows + observability |

**Approach:** SessionLifecycle facade + light schema (`grace_until`), not scatter-fix-only and not a full slot/BiB mega-refactor.

---

## §1 — Resource layers, ownership, state machine

### Resource layers

| Layer | Role | Torn down by |
|-------|------|--------------|
| Trajectory runtime (in-memory) | Record/replay handle in control plane | `detach` / idle reaper |
| **remote_session (DB)** | Browser occupancy row; **binding truth** | State machine |
| Agent session (executor Python) | Talks to Chrome | `detach` / `close` (kept across `streamDetach`) |
| Chrome + executor slot | Real browser + lease | `detach` / `close` / node offline |
| BiB stream | Screencast/input; identity = `remote_session.id` | May stop alone via `streamDetach` |

While mounted: **trajectory ↔ remote_session ↔ agent session are 1:1**. Parallel trajs use distinct `remote_session` rows.

### Ownership invariants

1. If `rs.status ∈ {active, idle}` and `rs.trajectory_id = T`, at most one traj cache may point at that `rs`.
2. **No cross-link:** never `t.remote_session_id = rs.id` while `rs.trajectory_id` is non-null and `≠ t.id`.
3. **Idle + within grace:** still owned by original traj; another traj claiming that Chrome → **409**.
4. **Grace expired:** set `trajectory_id → NULL`; then `preferIdleChrome` may claim.

### State machine (`remote_session.status`)

```text
                 attach (new or claim unowned idle)
                         │
                         ▼
                    ┌─────────┐
           ┌───────►│ active  │◄──────── attach (same traj reconnect)
           │        └────┬────┘
           │             │ streamDetach
           │             ▼
           │        ┌─────────┐
           │        │  idle   │  (grace_until: still owned)
           │        └───┬──┬──┘
           │   same traj │  │  grace expiry → trajectory_id=NULL
           │   re-attach │  │  (still idle; claimable)
           │             │  │
           │             │  ▼
           │             │  orphan idle → reaper close
           │             │
           └─────────────┘
                         │ detach / close / crash / node offline
                         ▼
                    ┌─────────┐
                    │ closed  │  (or crashed)
                    └─────────┘
```

### Operation semantics

| Op | BiB | Agent / Chrome / slot | `trajectory_id` | Traj cache |
|----|-----|------------------------|-----------------|------------|
| `attach` | start | present (new or claim unowned) | set to traj | sync |
| `streamDetach` | stop | **keep** | keep + set `grace_until` | **clear** cache; **reads use truth** |
| grace expiry | — | keep until reaper | **NULL** | clear if still pointing at rs |
| `detach` | stop | **close** | clear | clear |
| `close` | stop | close if needed | clear | clear |

**Sole writer:** `SessionLifecycle` facade (tighten `remote-session-service` or thin wrapper). Trajectory attach, reaper, and supersede **must not** mutate half of the FK pair themselves.

---

## §2 — Schema, facade API, errors, observability

### Schema

**`remote_session` (truth)**

| Column | Role |
|--------|------|
| `id` / `session_uuid` | PK; BiB identity |
| `status` | `active` \| `idle` \| `closed` \| `crashed` |
| `trajectory_id` | Current owner; `NULL` when unowned idle or closed |
| `agent_session_id` | May remain set after `streamDetach` |
| `grace_until` | **New**; set on `streamDetach`; blocks foreign claim until expiry |
| `executor_node_id` / `slot_index` | Slot location (read in this phase; lease rewrite out of scope) |

**`trajectory.remote_session_id` (cache)**

- Written only by the facade on attach / ownership change / detach / grace expiry / close.
- List/UI may read it; **conflict detection and claim decisions use `remote_session` only**.
- Boot + periodic `reconcile()` repairs cross-links, half-mounts, and cache pointing at `closed`/`crashed`.

Optional later: partial unique index on occupied `(trajectory_id)` where `status ∈ {active, idle}` and `trajectory_id IS NOT NULL`.

### Facade methods

Existing HTTP routes stay; internals funnel here:

| Method | Product trigger | Rules |
|--------|-----------------|-------|
| `attach(trajectoryId, …)` | record/prepare, attach | Same traj mounted → reuse; claim **unowned** idle OK; grace-owned by other → **409** |
| `streamDetach(trajectoryId \| remoteSessionId)` | stream/detach | → `idle`, set `grace_until`, keep Chrome |
| `detach(trajectoryId)` | detach | Stop BiB + agent + Chrome/slot; clear ownership + cache |
| `close(remoteSessionId)` | close | Force teardown; clear ownership |
| `onGraceExpired(remoteSessionId)` | reaper tick | `trajectory_id=NULL`; remain idle; claimable |
| `reapOrphans()` | idle-reaper | Unowned idle + no live agent → close |
| `reconcile()` | boot + periodic | Repair dirty bindings; never invent new ownership |

Fold `supersedeStaleForTrajectory` into the `attach` path so it cannot bypass the facade.

### HTTP errors

| Case | Status | Code / meaning |
|------|--------|----------------|
| Foreign claim during grace | **409** | `grace_owned` — still owned by traj X until `grace_until` |
| remote_session not owned by traj | **409** | Existing detach ownership check |
| No free slot / Chrome | **409** | Existing no-free-slots |
| Trajectory missing | **404** | |

### Observability

Structured logs with a shared prefix, at least:

- `lifecycle.attach` / `stream_detach` / `detach` / `close`
- `lifecycle.grace_set` / `grace_expire` / `claim_denied`
- `lifecycle.reconcile_fix`
- `lifecycle.reaper_close`

Suggested fields: `trajectoryId`, `remoteSessionId`, `agentSessionId`, `prevTrajectoryId`, `graceUntil`, `reason`.

Invariant check (characterization / ops):

```sql
-- Must return 0 rows while system is healthy:
SELECT t.id, t.remote_session_id, rs.trajectory_id
FROM trajectory t
JOIN remote_session rs ON rs.id = t.remote_session_id
WHERE rs.trajectory_id IS NOT NULL
  AND rs.trajectory_id <> t.id;
```

Also reject cache pointing at `closed`/`crashed`, and “cache set + truth NULL while still inside grace for another owner” shapes via reconcile tests.

### Out of scope (this phase)

- No rewrite of slot lease / BiB / idle-Chrome discovery beyond **facade ownership gate before claim**.
- Python sync only if response shape gains `code` (CHANGELOG note).

---

## §3 — Concurrency, grace default, migration, tests

### Concurrency and failure

- **Same-traj concurrent attach:** `withTrajectoryLock`; second call reuses; no second `remote_session`.
- **Cross-traj grace claim:** check `trajectory_id` + `grace_until` before claim; 409; no row mutation.
- **Partial failure:** e.g. BiB fails after Chrome opens → still persist `remote_session` with ownership on truth; never cache-only write.
- **Process restart:** boot `reconcile()` rebuilds in-memory bindings from DB; preserves unexpired grace ownership.
- **Executor offline:** existing node grace; once offline confirmed, `close`/`crashed` via facade clears ownership (lease redesign out of scope).

### Grace default

- Default: **`grace_until = streamDetach_at + 15 minutes`**, overridable via env (e.g. `REMOTE_SESSION_GRACE_MS`).
- Existing reaper tick (~45s) drives `onGraceExpired`.
- Hard `detach` / `close` clear ownership **immediately** (no wait for grace).

### Migration and backfill

1. Add nullable `grace_until` on `remote_session`.
2. One-shot backfill (migration and/or first boot reconcile):
   - **Cross-link:** trust `remote_session.trajectory_id`; clear other trajs’ caches to that `rs`; fix owner traj cache if wrong/empty.
   - **Half-empty** (traj → rs, `rs.trajectory_id` NULL): if rs still `active`/`idle` and no conflicting owner → set `trajectory_id`; if rs already closed → clear traj cache.
   - **Multiple caches → one occupied rs:** keep truth owner only; clear others.
3. Every repair emits `lifecycle.reconcile_fix`.

### Test plan

| Layer | Coverage |
|-------|----------|
| Unit / characterization | attach → streamDetach → foreign 409 in grace → expiry claimable → detach clears |
| Invariant SQL | After boot and cases: zero cross-links; no cache→closed |
| Concurrency | Double attach same traj → one rs; two trajs race grace idle → one win / one 409 |
| Smoke | Extend multi-traj lifecycle smoke with grace/409 |
| Manual | A streamDetach then B attach same Chrome → 409; after short test grace, B may claim |

### Risks and rollback

- **Risk:** UI that trusts only traj cache may briefly disagree with truth during grace → status APIs must resolve via truth (`getLiveStatus`).
- **Rollback:** env/flag treating `grace_until` as already expired (legacy “streamDetach ⇒ unowned”); do not drop the column in a panic rollback.

---

## Implementation sketch (for writing-plans)

1. Migration: `grace_until` + backfill SQL / reconcile.
2. Introduce or harden `SessionLifecycle` as sole mutator; route attach / streamDetach / detach / close / reaper through it.
3. Stop `mountTrajectoryRemoteSession` / `getLiveStatus` rewrite / supersede from writing cache without updating truth in the same facade transaction.
4. Wire grace expiry into idle-reaper tick; 409 `grace_owned` on foreign claim.
5. Structured lifecycle logs + characterization invariant assertions.
6. CHANGELOG `[Unreleased]` if routes/error body or schema change (Python sync hint).

## Open parameters (defaults locked unless plan overrides)

| Parameter | Default |
|-----------|---------|
| Grace duration | 15 minutes (`REMOTE_SESSION_GRACE_MS`) |
| Reaper tick | Keep existing ~45s |
| Cache after streamDetach | Prefer **clear** cache; UI uses truth via status API |
