# Hardcoded Prepare Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `record/prepare` (and `record/start` fallback) navigate + sign in via hardcoded `go_to_url` then `login()`, without starting a browser-use Agent.

**Architecture:** Change `runDefaultLogin` to send existing `replay_actions` (`go_to_url` + `login`) and wait for `replay_done` (90s). Tighten Python `login()` so a missed username/password/button returns `err-login` (replay `_result_ok` then fails). Keep suppress-persist and same-account skip.

**Tech Stack:** Node.js control plane (`src/services/trajectory/*`); Python executor actions (`scripts/controller/actions/_form.py`); characterization scripts (no live browser).

**Spec:** `docs/superpowers/specs/2026-08-13-hardcoded-prepare-login-design.md`

## Global Constraints

- Transport: existing `replay_actions` only — do **not** add a new stdin event or Node CDP fill.
- Steps: `[go_to_url({url}), login({username, password})]` — **never** pass `captcha` / `sms_code`.
- Completion: wait `replay_done` (90000 ms), **not** `phase_done` / `session.step`.
- Persist: keep `suppressStepPersist` + `isReplay`; login is **not** written to `trajectory_step`.
- Skip: unchanged — `runtime.loginDone && same accountId` in prepare/start callers.
- `login()` fail: username fill not ok (after 用户名 then 账号), password fill not ok, or button click ≠ `ok` → `_err('err-login | …')`. Must **not** return bare `label-not-found` (replay treats that as skip-OK).
- Empty URL still 400 (`system.url`, fallback `account.loginUrl`).
- Do **not** change `buildLoginInstruction` (characterization still uses it); stop calling it from `runDefaultLogin`.
- Do **not** change prepare stage order.
- Keep `execSession.forwardStdin` (do not switch to `writeAgentEvent`).
- CHANGELOG required (`src/services/` behavior). Python 同步提示：无 HTTP/schema；若代理侧 prepare 仍发 `session.step` 登录，改为 `replay_actions`.
- TDD: characterization fail first. No live browser.

## File map

| File | Role |
|------|------|
| `scripts/characterization/characterize-login-action.py` | Source cues for `login()` fail/success |
| `scripts/controller/actions/_form.py` | `login()` stricter result |
| `scripts/characterization/characterize-trajectory.mjs` | `runDefaultLogin` uses replay, not Agent |
| `src/services/trajectory/trajectory-record-lifecycle.js` | `runDefaultLogin` implementation |
| `src/dashboard/api-docs/groups/recording.js` | prepare desc |
| `CHANGELOG.md` | `[Unreleased]` Changed |

---

### Task 1: `login()` fails when fill or button fails

**Files:**
- Create: `scripts/characterization/characterize-login-action.py`
- Modify: `scripts/controller/actions/_form.py` (`async def login`, currently ~lines 123–171)
- Test: `python scripts/characterization/characterize-login-action.py`

**Interfaces:**
- Consumes: existing `login(username, password, captcha='', sms_code='')`; `_ok` / `_err` / `_is_ok_result` already imported in `_form.py`
- Produces: on fill/button failure `ActionResult` with `extracted_content` starting `err-login |`; on success unchanged `ok-login | …` after 3s wait + `_record_action`. Captcha/SMS still only filled when params are non-empty.

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-login-action.py`:

```python
#!/usr/bin/env python3
"""Characterize login(): fail closed on missing user/pass/button (not always ok-login)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
form = (ROOT / "scripts/controller/actions/_form.py").read_text(encoding="utf-8")


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def login_body() -> str:
    start = form.find("async def login(")
    assert_true(start >= 0, "login() present")
    nxt = form.find("\n    @controller.action", start + 10)
    return form[start : nxt if nxt > 0 else start + 3500]


def main() -> int:
    body = login_body()
    assert_true("err-login" in body, "failure result uses err-login prefix")
    assert_true("return _err(" in body, "failure returns _err")
    assert_true("_is_ok_result" in body, "username/password checked with _is_ok_result")
    assert_true("clicked != 'ok'" in body or 'clicked != "ok"' in body, "button not-found fails")
    rec = body.find("_record_action")
    err = body.find("return _err(")
    assert_true(err >= 0 and rec >= 0, "both _err return and _record_action present")
    assert_true(err < rec, "fail before _record_action / success wait")
    wait = body.find("wait_for_timeout(3000)")
    assert_true(wait > err, "3s wait only on success path (after fail return)")
    assert_true("return _ok(" in body and "ok-login" in body, "success still ok-login")
    assert_true("if captcha:" in body, "captcha fill remains optional")
    print("characterize-login-action: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run — expect FAIL**

```powershell
python scripts/characterization/characterize-login-action.py
```

Expected: `AssertionError: failure result uses err-login prefix` (current `login()` always `_ok('ok-login | …')`).

- [ ] **Step 3: Tighten `login()` in `_form.py`**

Replace the body of `async def login` after the captcha/sms optional fills (keep those `if captcha:` / `if sms_code:` blocks unchanged). After the button `page.evaluate` that sets `clicked`, replace the unconditional wait + `_record_action` + `_ok` with:

```python
        results.append(f'btn:{clicked}')

        summary = ' '.join(results)
        if (
            not _is_ok_result(str(u_r))
            or not _is_ok_result(str(p_r))
            or clicked != 'ok'
        ):
            return _err('err-login | ' + summary)

        await page.wait_for_timeout(3000)
        _record_action(
            'login',
            {'username': username, 'password': password, 'captcha': captcha, 'sms_code': sms_code},
            'ok-login',
        )
        return _ok('ok-login | ' + summary, include_in_memory=True)
```

Do **not** change username labels (`用户名` / `账号`), password label (`密码`), or the button JS (`登录` / `登錄` / `Login`). Do not fill captcha/SMS unless the existing `if captcha:` / `if sms_code:` branches run.

- [ ] **Step 4: Run — expect PASS**

```powershell
python scripts/characterization/characterize-login-action.py
```

Expected: `characterize-login-action: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/characterization/characterize-login-action.py scripts/controller/actions/_form.py
git commit -m "$(cat <<'EOF'
fix: fail login() when username, password, or button miss

Prepare/replay treated always-ok-login as success even when the button was not-found.
EOF
)"
```

---

### Task 2: `runDefaultLogin` uses `replay_actions` (no Agent)

**Files:**
- Modify: `scripts/characterization/characterize-trajectory.mjs`
- Modify: `src/services/trajectory/trajectory-record-lifecycle.js` (`runDefaultLogin`, ~lines 225–268)
- Test: `node scripts/characterization/characterize-trajectory.mjs`

**Interfaces:**
- Consumes: `execSession.forwardStdin` / `waitForSessionEvent`; Python `replay_actions` already handles `go_to_url` (`_replay_goto`) and `login` (controller). Task 1 `login()` `err-login` makes `replay_done.failed > 0`.
- Produces: `runDefaultLogin(runtime, account, system = null)` still sets `runtime.loginDone` / `loginAccountId` on success; throws on empty URL (400), `replay_done` timeout, `result.error`, `failed > 0`, or `ok < 2`. Callers (`prepareTrajectoryRecordingUnlocked`, `startTrajectoryRecording`) unchanged.

- [ ] **Step 1: Write the failing characterization**

In `scripts/characterization/characterize-trajectory.mjs`:

1. Add this import next to the existing trajectory-service import:

```javascript
import { runDefaultLogin } from '../../src/services/trajectory/trajectory-record-lifecycle.js';
```

2. Add this function after `testBuildLoginInstruction`:

```javascript
function testRunDefaultLoginHardcoded() {
  const body = Function.prototype.toString.call(runDefaultLogin);
  assert(/replay_actions/.test(body), 'runDefaultLogin sends replay_actions');
  assert(/go_to_url/.test(body), 'runDefaultLogin includes go_to_url');
  assert(/['"]login['"]/.test(body), 'runDefaultLogin includes login action');
  assert(/replay_done/.test(body), 'runDefaultLogin waits for replay_done');
  assert(/90000/.test(body), 'login replay timeout is 90000ms');
  assert(/stop_on_fail:\s*true/.test(body), 'login replay stop_on_fail');
  assert(!/event:\s*['"]step['"]/.test(body), 'must not send Agent step event');
  assert(!/max_steps:\s*10/.test(body), 'must not start Agent with max_steps 10');
  assert(!/phase_done/.test(body), 'must not wait phase_done');
  assert(!/buildLoginInstruction/.test(body), 'must not build NL login instruction');
  assert(/suppressStepPersist/.test(body), 'still suppress persist');
  assert(/loginDone/.test(body), 'sets loginDone');
}
```

3. Register it in `main()` tests array immediately after `buildLoginInstruction`:

```javascript
    ['buildLoginInstruction', testBuildLoginInstruction],
    ['runDefaultLogin hardcoded', testRunDefaultLoginHardcoded],
    ['buildSteps helpers', testBuildStepsHelpers],
```

Leave `testBuildLoginInstruction` unchanged.

- [ ] **Step 2: Run — expect FAIL**

```powershell
node scripts/characterization/characterize-trajectory.mjs
```

Expected: `✗ runDefaultLogin hardcoded — runDefaultLogin sends replay_actions` (current code sends `event: 'step'`). Other tests still `✓`.

- [ ] **Step 3: Replace `runDefaultLogin`**

In `src/services/trajectory/trajectory-record-lifecycle.js`:

1. Remove the unused `trajectory-account-service.js` import block entirely (`buildLoginInstruction` and `resolveTrajectoryAccount` are not used in this file after the change):

```javascript
import {
  buildLoginInstruction,
  resolveTrajectoryAccount,
} from '../trajectory-account-service.js';
```

Delete those four lines. Do not leave a dangling unused import.

2. Replace the function (keep the docstring and `finally` block):

```javascript
/**
 * Default login/navigate — NOT written to trajectory_step (is_replay / suppress persist).
 * Hardcoded go_to_url + login via replay_actions (no browser-use Agent).
 */
export async function runDefaultLogin(runtime, account, system = null) {
  const session = state.sessions.get(runtime.sessionId);
  if (session) session.busy = true;
  runtime.suppressStepPersist = true;
  runtime.isReplay = true;
  try {
    let sys = system;
    if (!sys?.url && account?.systemId) {
      sys = await systemDao.getById(Number(account.systemId));
    }
    const url = String(sys?.url || account?.loginUrl || '').trim();
    const username = String(account?.username || '').trim();
    const password = String(account?.password || '').trim();
    if (!url) {
      const err = new Error('System url is empty — set system.url (or legacy account.loginUrl)');
      err.statusCode = 400;
      throw err;
    }
    const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'replay_done', 90000);
    execSession.forwardStdin({
      nodeUuid: runtime.executorNodeUuid,
      sessionId: runtime.sessionId,
      event: 'replay_actions',
      data: {
        actions: [
          { action: 'go_to_url', params: { url } },
          { action: 'login', params: { username, password } },
        ],
        is_replay: true,
        stop_on_fail: true,
      },
    });
    const result = await doneP;
    const failed = Number(result?.failed || 0);
    const okCount = Number(result?.ok || 0);
    if (result?.error || failed > 0 || okCount < 2) {
      throw new Error(result?.error || `login replay failed (ok=${okCount} failed=${failed})`);
    }
    await markConsumedActionLog(runtime);
    runtime.loginDone = true;
    runtime.loginAccountId = Number(account.id);
  } finally {
    runtime.suppressStepPersist = false;
    runtime.isReplay = false;
    if (session) {
      session.busy = false;
      session.activePhaseId = null;
    }
    try {
      const { broadcastWatcherStatus } = await import('../../routes/browser-session/broadcasts.js');
      broadcastWatcherStatus();
    } catch {}
  }
}
```

Do **not** pass `captcha` / `sms_code` in `params`. Do not wait for `phase_error`. Callers in `trajectory-attach-runner.js` / `trajectory-recording-runner.js` stay as-is.

- [ ] **Step 4: Run — expect PASS**

```powershell
node scripts/characterization/characterize-trajectory.mjs
```

Expected: all tests `✓` including `runDefaultLogin hardcoded`, then `OK`.

- [ ] **Step 5: Commit**

```bash
git add scripts/characterization/characterize-trajectory.mjs src/services/trajectory/trajectory-record-lifecycle.js
git commit -m "$(cat <<'EOF'
feat: hardcode prepare login via replay_actions

Skip the browser-use Agent loop; navigate and sign in with go_to_url then login().
EOF
)"
```

---

### Task 3: API docs + CHANGELOG

**Files:**
- Modify: `src/dashboard/api-docs/groups/recording.js` (prepare `desc`, ~line 27)
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Test: `node scripts/characterization/characterize-trajectory.mjs` (still OK); visually confirm prepare `desc` in the file

**Interfaces:**
- Consumes: Task 2 behavior (hardcoded login, not Agent)
- Produces: `/api/docs` copy + changelog entry for Python-control-plane readers

- [ ] **Step 1: Update prepare endpoint `desc`**

In `src/dashboard/api-docs/groups/recording.js`, change the prepare endpoint `desc` string from:

```javascript
desc: '幂等。① 复用本交易已存活 session（含「断开画面」后空闲浏览器）；② 否则优先复用执行机上空闲孤儿 CDP Chrome；③ 再新建浏览器。无空闲槽位则 409。登录/导航不写入 trajectory_step。画面推流成功时将 recordStatus 置为 live（占用，非 AI 录制）。通过 WS 广播 recording:prepare。推流身份以 remote_session.id 为准，按 trajectory 隔离。',
```

to:

```javascript
desc: '幂等。① 复用本交易已存活 session（含「断开画面」后空闲浏览器）；② 否则优先复用执行机上空闲孤儿 CDP Chrome；③ 再新建浏览器。无空闲槽位则 409。登录为硬编码 go_to_url + login（不启动 Agent），不写入 trajectory_step。画面推流成功时将 recordStatus 置为 live（占用，非 AI 录制）。通过 WS 广播 recording:prepare。推流身份以 remote_session.id 为准，按 trajectory 隔离。',
```

- [ ] **Step 2: CHANGELOG `[Unreleased]`**

Insert a `### Changed` section **above** `### Fixed` under `## [Unreleased]`:

```markdown
### Changed

- 2026-08-13: **prepare 登录硬编码**：`record/prepare`（及 `record/start` 未登录兜底）改为 `replay_actions`：`go_to_url` + `login(username, password)`，不再发 `session.step` 启动 browser-use；失败（导航/填表/按钮）使 prepare 失败。登录仍不写入 `trajectory_step`。
  影响范围：service（prepare/start 登录）、scripts（`login()` 失败返回 `err-login`）、api-docs。
  文件：src/services/trajectory/trajectory-record-lifecycle.js, scripts/controller/actions/_form.py, src/dashboard/api-docs/groups/recording.js, scripts/characterization/characterize-trajectory.mjs, characterize-login-action.py
  Python 同步提示：无 HTTP/schema。若代理侧 prepare 登录仍发 session.step，改为 replay_actions（go_to_url + login，不传验证码）。
```

Keep existing `### Fixed` entries.

- [ ] **Step 3: Re-run characterizations**

```powershell
python scripts/characterization/characterize-login-action.py
node scripts/characterization/characterize-trajectory.mjs
```

Expected: both OK.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/api-docs/groups/recording.js CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: note hardcoded prepare login in api-docs and changelog
EOF
)"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| No browser-use / no `session.step` | Task 2 |
| `go_to_url` then `login(user, pass)` | Task 2 |
| No captcha/SMS params | Task 2 |
| Wait `replay_done` 90s | Task 2 |
| Suppress persist / `loginDone` | Task 2 |
| Empty URL 400 | Task 2 |
| `login()` err-login on user/pass/button | Task 1 |
| No `_record_action` on failure; 3s wait on success | Task 1 |
| Keep `buildLoginInstruction` tests | Task 2 (unchanged test) |
| Callers prepare/start unchanged | Task 2 |
| api-docs + CHANGELOG | Task 3 |
| Characterization, no live browser | Task 1–2 |
