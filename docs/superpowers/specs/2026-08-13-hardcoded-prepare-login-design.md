# Hardcoded prepare login (no browser-use Agent) — Design

**Date:** 2026-08-13  
**Status:** Approved — plan `docs/superpowers/plans/2026-08-13-hardcoded-prepare-login.md`  
**Related:** `src/services/trajectory/trajectory-record-lifecycle.js` (`runDefaultLogin`), `src/services/trajectory/trajectory-attach-runner.js` (`record/prepare`), `src/services/trajectory/trajectory-recording-runner.js` (`record/start`), `scripts/controller/actions/_form.py` (`login`), `scripts/controller/actions/_replay.py` (`go_to_url` / controller fallback), `scripts/event_dispatch.py` (`replay_actions`)

**Trigger:** `record/prepare` currently starts a browser-use Agent (`session.step` + NL `buildLoginInstruction`, max 10 LLM steps) just to navigate and sign in. Login is a fixed Element UI sequence; the Agent loop is slow, flaky, and unnecessary.

## Problem

`runDefaultLogin` sends a natural-language task (`Navigate to … / Enter username / Enter password / Click login / Wait`) as `session.step`. The executor starts `Agent.run()`, which typically calls `go_to_url` then the existing `login()` CTRL action. Prepare is blocked up to 300s on `phase_done` / `phase_error`.

The Python process and Chrome are already up from attach. Login does not belong in the LLM loop.

## Goals

1. Prepare (and start’s login fallback) **must not start browser-use**.
2. Navigation + login follow the **original Agent action sequence**: `go_to_url(url)` then `login(username, password)` — no captcha / SMS.
3. Login still **does not write** `trajectory_step` (keep `suppressStepPersist` / `isReplay`).
4. Same-session same-account skip (`loginDone` + `loginAccountId`) stays.
5. Failed navigate or failed login **fails prepare** (HTTP error + `recording:prepare` login stage `error`).

## Non-goals

- Captcha / SMS fill (`captcha` / `sms_code` stay empty).
- Skipping `go_to_url` based on current URL / cookie session (only `loginDone` skip).
- New stdin event or Node-side CDP fill (reuse `replay_actions`).
- Changing prepare stage order (session → browser → stream → login).
- Changing `buildLoginInstruction` (kept for characterization; unused by `runDefaultLogin` after this).
- Product SPA changes.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Transport | Existing `replay_actions` (no LLM) |
| Steps | `[go_to_url({url}), login({username, password})]` |
| Captcha | Never pass |
| Completion event | `replay_done` (not `phase_done`) |
| Timeout | 90s |
| Persist | Unchanged: suppress; not in `trajectory_step` |
| Skip | Unchanged: `loginDone` && same `accountId` |
| `login()` success | Fail if username fill, password fill, or login button click failed |

**Approach:** Change `runDefaultLogin` to the replay channel; tighten `login()` so a missed button is not `ok-login`.

---

## §1 — Data flow

```text
record/prepare
  attach / reuse Python session + Chrome
  BiB stream
  runDefaultLogin
    if loginDone && same account → skip
    else
      replay_actions:
        1. go_to_url(system.url)
        2. login(username, password)   // no captcha
      wait replay_done (90s)
      if failed>0 or !ok → throw (prepare login stage error)
      loginDone = true, loginAccountId = account.id
```

`record/start` already calls the same `runDefaultLogin` when not logged in — no second path.

Python Agent process stays alive for the session; only the **LLM step loop** is skipped for login.

URL source unchanged: `system.url`, fallback `account.loginUrl`; empty URL still 400.

---

## §2 — Components

### Control plane — `runDefaultLogin`

File: `src/services/trajectory/trajectory-record-lifecycle.js`

Replace `forwardStdin({ event: 'step', data: { instruction, max_steps: 10, phase_number: 0 } })` + wait `phase_done`/`phase_error` with:

- Resolve `url` / `username` / `password` the same way as today (`systemDao` + account). Empty URL still throws 400.
- `forwardStdin({ event: 'replay_actions', data: { actions: [...], is_replay: true, stop_on_fail: true } })`.
- Wait `replay_done` (90s). Treat `failed > 0`, missing payload, or `error` as login failure.
- Keep `suppressStepPersist`, `isReplay`, `session.busy`, `markConsumedActionLog`, `loginDone` / `loginAccountId`.

`replay_actions` is already mapped to `session.stdin` (`STDIN_TO_WS` default). Python `event_dispatch.py` already runs `_replay.replay_action_entries`; `go_to_url` uses `_replay_goto`; `login` falls through to the controller `login()` action.

Callers unchanged: `prepareTrajectoryRecordingUnlocked`, `startTrajectoryRecording`.

### Python — `login()` result

File: `scripts/controller/actions/_form.py`

Today `login()` always returns `ok-login | user:… pass:… btn:…` even when fills or the button fail. Replay `_result_ok` then treats the step as success.

After this change, return `_err('err-login | …')` so `_result_ok` is false (must **not** be a bare `label-not-found`, which replay treats as skip-OK). Fail when any of:

- username: after trying `用户名` then `账号`, the fill result does not start with `ok`
- password: `密码` fill does not start with `ok`
- button: click result is not `ok` (`not-found`)

On failure: do not `_record_action`. On success: keep 3s wait + `_record_action` (still not persisted during prepare). Do not fill captcha/SMS unless params are non-empty (prepare passes neither).

Agent-phase `login()` uses the same stricter result (correct: do not `done()` after a missed button).

### Docs / changelog

- `src/dashboard/api-docs/groups/recording.js`: prepare login is hardcoded `go_to_url` + `login`, not Agent.
- `CHANGELOG.md` `[Unreleased]`: behavior change on `record/prepare` login; Python control plane has no HTTP schema change (`scripts/` only + JS-gen service).

---

## §3 — Error handling

| Failure | Behavior |
|---------|----------|
| Empty system URL | 400 (existing) |
| `go_to_url` timeout / error | `replay_done.failed ≥ 1` → prepare throws; stage `login` = `error` |
| Username / password / button fail | `login()` returns `err-…` → same |
| `replay_done` timeout (90s) | prepare throws |
| Same account already `loginDone` | skip (stage `skipped`) |
| Reused Chrome, different account | run hardcoded login again (existing) |

No LLM heal on prepare login. Operator fixes URL/account or page, then prepare again.

---

## §4 — Testing

No live browser in CI.

1. `scripts/characterization/characterize-trajectory.mjs`  
   - `runDefaultLogin` source includes `replay_actions`, `go_to_url`, and `login`.  
   - Does **not** send `event: 'step'` / `instruction` / `max_steps: 10` for login.  
   - Waits for `replay_done`, not `phase_done`.

2. Python source characterization (small script or extend an existing form/login check):  
   - `login()` returns error when button is `not-found` (and when user/pass fills fail).  
   - Does not always `_ok('ok-login`.

3. `node scripts/characterization/characterize-trajectory.mjs` still passes (`buildLoginInstruction` tests unchanged).

---

## Out of scope (explicit)

- Local `USE_EXECUTOR=false` I/O unification (`writeAgentEvent`); keep current `execSession.forwardStdin` like other product replay.
- Detecting “already logged in” from DOM/URL.
- Passing `captcha='1111'`.
