# Ops Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a standalone `/ops` page that lists executor slots and pending screenshots, and shows agent stderr as step, replay, and injection cards with a full-text modal.

**Architecture:** A pure parser in `log-cards.js` turns stderr text into blocks. Python writes full `[step]` lines and one-line `[card]` JSON at each injection site. The page is static HTML under `src/dashboard/ops-console/`, served by `GET /ops`. The two live boards leave `/api/docs`; their actions stay on the new page.

**Tech Stack:** Node ESM characterization tests, Python characterization pins, Express `sendFile`, vanilla HTML/CSS/JS modules. No build step. No new HTTP API.

## Global Constraints

- Page files live only in `src/dashboard/ops-console/`. No build. `GET /ops` sends `index.html`. `/src/dashboard` already serves the directory.
- Do not add auth. Do not add HTTP routes besides `GET /ops`.
- `[step]` drops `goal[:200]`, `act[:500]`, and `_compact_last_result` `max_chars=120`. No new config flag.
- `_ACTION_LOG` slices (`[:120]`, `[:400]`) stay. `scripts/agent_utils.py` `next_goal[:200]` stays.
- `flow_summary_text` limit 800 stays. `_PREAMBLE_TOTAL_MAX` 8000 stays. Card `text` is the string actually appended, with no second slice.
- Scenario stderr short line `summary[:80]` and `emit_json` `summary[:300]` stay. The page does not parse those short lines into cards.
- `api-docs.css` `.mon-*` rules stay (auth-recording panel uses them). Login/logout recording panel stays on `/api/docs`.
- Before editing `scripts/recorder.py` or `scripts/agent/service.py`, re-read `docs/superpowers/agent-log.md`. If another open declaration lists those files as in-progress edits, stop and switch files.
- Commit messages in Chinese: first line says what changed and why.

---

### Task 1: Stderr card parser

**Files:**
- Create: `src/dashboard/ops-console/log-cards.js`
- Test: `scripts/characterization/characterize-ops-log-cards.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `parseAgentLog(text: string) -> Block[]`
  - `Block` is one of:
    - `{ kind: 'phase', phase: number, title: string }`
    - `{ kind: 'info', cardKind: string, phase: number|null, title: string, score: number|null, text: string }`
    - `{ kind: 'step', step: number, done: boolean, stopped: boolean, goal: string, act: string, res: string, err: string, status: 'fail'|'done'|'empty'|'ok', raw: string }`
    - `{ kind: 'replay', index: string, goal: string, operation: string, result: string, status: 'ok'|'fail', raw: string }`
    - `{ kind: 'other', lines: string[] }`
  - `stepStatus(done, stopped, act, res, err) -> 'fail'|'done'|'empty'|'ok'`

- [ ] **Step 1: Write the failing test**

Create `scripts/characterization/characterize-ops-log-cards.mjs`:

```javascript
import { readFileSync } from 'fs';
import { parseAgentLog } from '../../src/dashboard/ops-console/log-cards.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sample = readFileSync(
  'logs/agent-stderr/700fced0-2bd9-4137-aa3a-1733ef87a23a.log',
  'utf8',
);
const blocks = parseAgentLog(sample);
assert(blocks.some((b) => b.kind === 'phase' && b.phase === 1), 'phase 1 header');
assert(
  blocks.some((b) => b.kind === 'replay' && b.operation === 'go_to_url' && b.status === 'ok'),
  'replay go_to_url',
);
assert(
  blocks.some((b) => b.kind === 'step' && b.goal.includes('点击「确 定」')),
  'legacy step goal',
);
assert(!blocks.some((b) => b.kind === 'info'), 'old log has no [card] lines');

const longText = `甲`.repeat(201) + '\n第二行';
const cardLine = '[card] ' + JSON.stringify({
  kind: 'kb', phase: 1, title: '对公用信申请', score: 100, text: longText,
});
const parsed = parseAgentLog('[slot:0 sid:abc] ' + cardLine);
const info = parsed.find((b) => b.kind === 'info');
assert(info && info.text === longText && info.score === 100, 'card text round-trip');

const stepLine = '[step 4] done=yes stopped=no | goal='
  + JSON.stringify('目标\n含|act')
  + ' | act=' + JSON.stringify('{"done":{}}')
  + ' | res=' + JSON.stringify('全文结果')
  + ' | err=' + JSON.stringify('');
const step = parseAgentLog(stepLine).find((b) => b.kind === 'step');
assert(step && step.goal === '目标\n含|act' && step.status === 'done', 'json step line');

const empty = parseAgentLog(
  '[step 3] done=no stopped=no | goal="Execute AgentOutput" | act="{}" | res="None" | err=""',
);
assert(empty.find((b) => b.kind === 'step').status === 'empty', 'empty act');

console.log('characterize-ops-log-cards: OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/characterization/characterize-ops-log-cards.mjs`

Expected: FAIL with `Cannot find module` for `log-cards.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/dashboard/ops-console/log-cards.js`. Strip a leading `[slot:N sid:…]` or `[session …]` the same way as `stripLinePrefix` in `src/services/agent-stderr-log-service.js`. Export `parseAgentLog` and `stepStatus`.

`stepStatus` order: non-empty `err` or `stopped` → `'fail'`; else `done` → `'done'`; else `act` is `''`, `'{}'`, or `'-'`, or `res` is `'None'` → `'empty'`; else `'ok'`. An empty `res` string is not empty-act.

Phase header: `/^Phase (\d+): (.*) \(max_steps=\d+\)$/`. Replay action: `/^\[replay\] \[(\d+\/\d+)\] (\S+)(?: (.*))?$/`. Replay result: `/^\[replay\] \[\d+\/\d+\] (OK → .*)$/` is ok, any other `[replay] [i/n]` result line is fail. Pair the result with the pending action of the same index. Unpaired action at end of input becomes a replay block with `result: ''` and `status: 'fail'`. Lines like `[replay] Done:` or `[replay] login_probe →` go to `other`.

`[card] ` + `JSON.parse` of the rest → `info`. Ignore malformed JSON by putting the raw line in `other`.

`[step]` : if the value after `goal=` starts with `"`, `JSON.parse` each of `goal`, `act`, `res`, `err` (err may be absent → `''`). Otherwise split the legacy line on the first ` | act=` and then the first ` | res=` / ` | err=`.

Consecutive non-matching lines become one `{ kind: 'other', lines }` block. Do not emit empty `other` blocks.

Replay `goal`: `go_to_url` → `打开 ${url}`; `fill_form_field` → `填写「${label_text}」`; click actions with `text` → `点击「${text}」`; else the action name. Read Python-style `{'url': '...'}` with a small regex, not `JSON.parse`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/characterization/characterize-ops-log-cards.mjs`

Expected: `characterize-ops-log-cards: OK`

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/ops-console/log-cards.js scripts/characterization/characterize-ops-log-cards.mjs
git commit -m "test(ops): 日志行解析成阶段、步骤、回放和注入卡"
```

---

### Task 2: Full `[step]` stderr line

**Files:**
- Modify: `scripts/recorder.py` (`_compact_last_result` around line 41; the `[step]` write around lines 206-214)
- Test: `scripts/characterization/characterize-ops-step-line.py`

**Interfaces:**
- Consumes: nothing from Task 1 (Python writer; the JS parser already accepts this shape)
- Produces: `format_step_stderr_line(n_steps: int, done: bool, stopped: bool, goal: str, act: str, res: str, err: str) -> str`

- [ ] **Step 1: Write the failing test**

Create `scripts/characterization/characterize-ops-step-line.py`:

```python
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.recorder import format_step_stderr_line

def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)

goal = ("目标" * 120) + "\n含 | act= 分隔"
line = format_step_stderr_line(4, True, False, goal, '{"done":{}}', "结果" * 80, "")
assert_true("\n" not in line, line)
assert_true(line.startswith("[step 4] done=yes stopped=no | goal="), line)
rest = line.split(" | goal=", 1)[1]
g, rest = rest.split(" | act=", 1)
a, rest = rest.split(" | res=", 1)
r, e = rest.split(" | err=", 1)
assert_true(json.loads(g) == goal, g)
assert_true(json.loads(a) == '{"done":{}}', a)
assert_true(json.loads(r) == "结果" * 80, r)
assert_true(json.loads(e) == "", e)

src = (ROOT / "scripts/recorder.py").read_text(encoding="utf-8")
step_fn = src.split("def format_step_stderr_line", 1)[1].split("\ndef ", 1)[0]
assert_true("[:200]" not in step_fn and "[:500]" not in step_fn, "step formatter still slices")
assert_true("max_chars=120" not in src, "compact 120 cap still present")
action_log = src.split("log_line =", 1)[1].split("_ACTION_LOG.append", 1)[0]
assert_true("[:120]" in action_log and "[:400]" in action_log, "ACTION_LOG slices must stay")

print("characterize-ops-step-line: OK")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python scripts/characterization/characterize-ops-step-line.py`

Expected: FAIL with `ImportError` (`format_step_stderr_line`).

- [ ] **Step 3: Write minimal implementation**

Add at module level in `scripts/recorder.py`:

```python
def format_step_stderr_line(n_steps, done, stopped, goal, act, res, err):
    """One physical stderr line. Fields are JSON strings so newlines and pipes stay inside."""
    return (
        f"[step {n_steps}] "
        f"done={'yes' if done else 'no'} stopped={'yes' if stopped else 'no'} | "
        f"goal={json.dumps(goal if goal is not None else '', ensure_ascii=False)} | "
        f"act={json.dumps(act if act is not None else '', ensure_ascii=False)} | "
        f"res={json.dumps(res if res is not None else '', ensure_ascii=False)} | "
        f"err={json.dumps(err if err is not None else '', ensure_ascii=False)}"
    )
```

In `on_step_end`, build `res_text` / `err_text` from `extracted_content` and `error` on each item of `_last_result` (list or one object), joined with `\n`, with no character cap. Pass the joined action JSON string as `act` (empty string when there are no actions). Replace the `sys.stderr.write` of the `[step]` line with `format_step_stderr_line(...)`. Delete `_compact_last_result`. Leave the `_ACTION_LOG` block's `[:120]` and `[:400]` as they are.

- [ ] **Step 4: Run test to verify it passes**

Run: `python scripts/characterization/characterize-ops-step-line.py`

Expected: `characterize-ops-step-line: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/recorder.py scripts/characterization/characterize-ops-step-line.py
git commit -m "fix(recorder): [step] 行写全文，不再按 200/500/120 截断"
```

---

### Task 3: `[card]` lines and full phase header

**Files:**
- Create: `scripts/agent/stderr_cards.py`
- Modify: `scripts/agent/service.py` (phase header near line 174; preamble near 348; fact pack near 367; kb near 424; refill/contract near 436; success gates near 501; business hint near 512; kb dict near 531)
- Modify: `scripts/controller/actions/_scenario_describer.py` (stderr write near line 367)
- Test: `scripts/characterization/characterize-ops-card-line.py`

**Interfaces:**
- Consumes: nothing from the page
- Produces:
  - `format_card_line(kind: str, phase: int, title: str, text: str, score: int | None = None) -> str`
  - `format_phase_header_line(step_index: int, task_text: str, max_steps) -> str`

- [ ] **Step 1: Write the failing test**

Create `scripts/characterization/characterize-ops-card-line.py`:

```python
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.agent.stderr_cards import format_card_line, format_phase_header_line

def assert_true(cond, msg):
    if not cond:
        raise AssertionError(msg)

text = "摘要" * 100 + "\n第二行"
line = format_card_line("kb", 1, "对公用信申请", text, score=100)
assert_true("\n" not in line, line)
payload = json.loads(line.split("[card] ", 1)[1])
assert_true(payload["text"] == text and payload["score"] == 100, payload)

header = format_phase_header_line(3, "第一行\n第二行" * 20, 300)
assert_true(header.startswith("Phase 3: ") and header.endswith(" (max_steps=300)"), header)
assert_true("\n" not in header and "\\n" in header, header)
assert_true("task_text[:80]" not in Path(ROOT / "scripts/agent/service.py").read_text(encoding="utf-8"),
            "phase header still slices at 80")

print("characterize-ops-card-line: OK")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python scripts/characterization/characterize-ops-card-line.py`

Expected: FAIL with `ImportError` (`stderr_cards`).

- [ ] **Step 3: Write minimal implementation**

`scripts/agent/stderr_cards.py`:

```python
import json
import sys

def format_card_line(kind, phase, title, text, score=None):
    payload = {"kind": kind, "phase": int(phase), "title": title, "text": text if text is not None else ""}
    if score is not None:
        payload["score"] = score
    return "[card] " + json.dumps(payload, ensure_ascii=False)

def format_phase_header_line(step_index, task_text, max_steps):
    flat = str(task_text or "").replace("\r\n", "\n").replace("\n", "\\n")
    return f"Phase {step_index}: {flat} (max_steps={max_steps})"

def emit_card(kind, phase, title, text, score=None):
    if not str(text or "").strip():
        return
    sys.stderr.write(format_card_line(kind, phase, title, text, score=score) + "\n")
    sys.stderr.flush()
```

In `service.py`:

- Replace the `Phase {step_index}: {task_text[:80]}` write with `format_phase_header_line(step_index, task_text, max_steps)`.
- After `agent_task = format_phase_preamble(...)`, `emit_card("phase-task", step_index, f"阶段 {step_index}", agent_task)`.
- After fact-pack append, `emit_card("fact-pack", step_index, "事实包", fp_text)`.
- After `agent_task = agent_task + '\n\n' + summary` for kb, `emit_card("kb", step_index, card.get("flow") or "", summary, score=score)`. Keep the existing `kb_flow injected:` line.
- After appending `recording_refill_hint(...)` and `contract_summary_hint(...)`, emit `refill` / `contract` only when the appended string is non-empty. Keep those strings' existing content.
- After success-gates append, `emit_card("success-gates", step_index, "成功门闩", gates_text)`.
- After business-hint append, `emit_card("business-data", step_index, "业务数据", hint)`.
- After the `【KB 码表】` append, `emit_card("kb-dict", step_index, "码表", dict_text)` where `dict_text` is the exact suffix appended.
- Do not remove `agent_task preview: {agent_task[:400]}`.

In `_scenario_describer.py`, keep the `summary[:80]` stderr line and the `summary[:300]` `emit_json`. Immediately after a successful inject, call `emit_card("scenario", phase, "场景摘要", summary)` with `phase` from `scripts.state.get_current_phase()` (0 when it returns nothing).

- [ ] **Step 4: Run test to verify it passes**

Run: `python scripts/characterization/characterize-ops-card-line.py`

Expected: `characterize-ops-card-line: OK`

- [ ] **Step 5: Commit**

```bash
git add scripts/agent/stderr_cards.py scripts/agent/service.py scripts/controller/actions/_scenario_describer.py scripts/characterization/characterize-ops-card-line.py
git commit -m "feat(agent): 阶段任务和每次注入各打一行完整 [card]"
```

---

### Task 4: `/ops` shell

**Files:**
- Create: `src/dashboard/ops-console/index.html`
- Create: `src/dashboard/ops-console/ops.css`
- Create: `src/dashboard/ops-console/app.js`
- Modify: `server.mjs` (next to the `GET /` `sendFile`, around lines 41-42)
- Modify: `api-docs.html` (sidebar links, around lines 16-19)
- Test: `scripts/characterization/characterize-ops-page.mjs`

**Interfaces:**
- Consumes: nothing from the parser yet
- Produces: DOM ids `#ops-tab-exec`, `#ops-tab-shots`, `#ops-panel-exec`, `#ops-panel-shots`. `app.js` toggles `.ops-panel.is-active` and does not fetch logs.

- [ ] **Step 1: Write the failing test**

```javascript
import { readFileSync } from 'fs';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const server = readFileSync('server.mjs', 'utf8');
assert(server.includes("app.get('/ops'"), 'GET /ops missing');
assert(server.includes('ops-console/index.html') || server.includes("ops-console', 'index.html'"), 'sendFile target');

const html = readFileSync('src/dashboard/ops-console/index.html', 'utf8');
assert(html.includes('id="ops-tab-exec"') && html.includes('id="ops-tab-shots"'), 'tabs');
assert(html.includes('ops.css') && html.includes('app.js'), 'assets');

const docs = readFileSync('api-docs.html', 'utf8');
assert(docs.includes('href="/ops"'), 'docs link');

console.log('characterize-ops-page: OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/characterization/characterize-ops-page.mjs`

Expected: FAIL because `index.html` does not exist or `GET /ops` is absent.

- [ ] **Step 3: Write minimal implementation**

`index.html`: Chinese `lang`, title `执行机与日志`, link `/src/dashboard/ops-console/ops.css`, two buttons `执行机` / `待上传截图`, two panels, module script `/src/dashboard/ops-console/app.js`.

`app.js`: click handlers set `hidden` on the inactive panel and `aria-selected` on the tabs. No fetch.

`ops.css`: page background, tab row, active tab. Enough that the two labels are visible. Do not import `api-docs.css`.

`server.mjs`:

```javascript
app.get('/ops', (req, res) => res.sendFile(path.join(PROJECT_DIR, 'src', 'dashboard', 'ops-console', 'index.html')));
```

`api-docs.html` sidebar: `<a href="/ops">执行机与日志</a>` next to the health-check link.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/characterization/characterize-ops-page.mjs`

Expected: `characterize-ops-page: OK`

- [ ] **Step 5: Commit**

```bash
git add server.mjs api-docs.html src/dashboard/ops-console/index.html src/dashboard/ops-console/ops.css src/dashboard/ops-console/app.js scripts/characterization/characterize-ops-page.mjs
git commit -m "feat(ops): 增加 /ops 空页面和文档侧栏入口"
```

---

### Task 5: Executor panel and log modal

**Files:**
- Create: `src/dashboard/ops-console/executor-panel.js`
- Modify: `src/dashboard/ops-console/app.js`
- Modify: `src/dashboard/ops-console/ops.css`
- Modify: `src/dashboard/ops-console/log-cards.js` (add `renderLogCards`)
- Test: extend `scripts/characterization/characterize-ops-page.mjs`

**Interfaces:**
- Consumes: `parseAgentLog` from Task 1. `mountExecutorPanel(wrap: HTMLElement): void`
- Produces: `renderLogCards(container: HTMLElement, text: string, state: { stickToBottom: boolean }): void` which fills `container` from `parseAgentLog` and opens one modal.

- [ ] **Step 1: Write the failing test**

Append to `characterize-ops-page.mjs`:

```javascript
const app = readFileSync('src/dashboard/ops-console/app.js', 'utf8');
assert(app.includes('mountExecutorPanel'), 'executor mount');
const cards = readFileSync('src/dashboard/ops-console/log-cards.js', 'utf8');
assert(cards.includes('export function renderLogCards'), 'renderLogCards');
const css = readFileSync('src/dashboard/ops-console/ops.css', 'utf8');
assert(css.includes('.ops-modal') && css.includes('.ops-card-fail'), 'modal and fail color');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/characterization/characterize-ops-page.mjs`

Expected: FAIL on `mountExecutorPanel` or `renderLogCards`.

- [ ] **Step 3: Write minimal implementation**

Move `buildViewModel`, `statusBadge`, `renderSlotRow`, `renderNodeCard`, and the action handlers from `src/dashboard/api-docs/slot-monitor.js` (from the helper `$` through `mountSlotMonitor`) into `executor-panel.js`. Export `mountExecutorPanel`. Rename classes `mon-` → `ops-` in this file only.

Copy `.mon-*` rules from `api-docs.css` (the block starting at `/* Slot / executor monitor */`, excluding `.ar-*` and the docs `@media`) into `ops.css` with the same rename. Point colors at hex values already in those rules (`#059669`, `#dc2626`), not `var(--docs-muted)` — use `#667085` instead.

Replace the `<details class="mon-log-box">` / `<pre>` log UI with a `<div class="ops-log"></div>`. `fetchStderr` passes the response text to `renderLogCards(logEl, display, followState)`.

`renderLogCards`:
- Calls `parseAgentLog`.
- Phase → a heading. `info` / `step` / `replay` → a `<button class="ops-card ops-card-${status}">`. Info cards use `ops-card-info`, `ops-card-kb` when `cardKind === 'kb'`.
- Face text is one line (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`). Step face labels are 目标 / 操作 / 结果. Info face uses `title` and the first line of `text`.
- Click sets a single `.ops-modal` dialog (one element reused). Body is the full goal, act, res, err, or info `text`, in `<pre>` with `white-space: pre-wrap`. Backdrop click and a 关闭 button remove `open`.
- If `state.stickToBottom` is true, set `container.scrollTop = container.scrollHeight` after paint. A scroll listener sets `stickToBottom` false when the user is more than 24px above the bottom, and a 「回到底部」 button sets it true and scrolls.
- A 「复制全文」 button writes the raw stderr string (the same text passed into `renderLogCards`) to the clipboard.
- Auto-refresh of the slot table must not call `fetchStderr`.

`app.js` calls `mountExecutorPanel` on `#ops-panel-exec` once at load. Switching tabs only toggles `hidden`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/characterization/characterize-ops-page.mjs`

Expected: `characterize-ops-page: OK`

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/ops-console/executor-panel.js src/dashboard/ops-console/log-cards.js src/dashboard/ops-console/app.js src/dashboard/ops-console/ops.css scripts/characterization/characterize-ops-page.mjs
git commit -m "feat(ops): 执行机槽位和日志卡片弹窗"
```

---

### Task 6: Pending-screenshot panel

**Files:**
- Create: `src/dashboard/ops-console/screenshots-panel.js`
- Modify: `src/dashboard/ops-console/app.js`
- Modify: `src/dashboard/ops-console/ops.css`
- Test: extend `scripts/characterization/characterize-ops-page.mjs`

**Interfaces:**
- Consumes: `mountExecutorPanel` already called from `app.js`
- Produces: `mountScreenshotsPanel(wrap: HTMLElement): void`

- [ ] **Step 1: Write the failing test**

Append:

```javascript
assert(app.includes('mountScreenshotsPanel'), 'screenshots mount');
const shots = readFileSync('src/dashboard/ops-console/screenshots-panel.js', 'utf8');
assert(shots.includes('/api/v2/screenshots/pending'), 'pending list');
assert(shots.includes('/pending/upload'), 'upload all');
assert(shots.includes("method: 'DELETE'"), 'delete');
```

Re-read `app.js` inside the test after the earlier `const app` if the file is loaded once at the top — read it again here.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/characterization/characterize-ops-page.mjs`

Expected: FAIL on `mountScreenshotsPanel`.

- [ ] **Step 3: Write minimal implementation**

Move `mountPendingScreenshots` and its helpers from `src/dashboard/api-docs/pending-screenshots.js` into `screenshots-panel.js`. Export `mountScreenshotsPanel`. Keep the same requests: `GET /api/v2/screenshots/pending`, `POST .../pending/upload`, `POST /api/v2/screenshots/:id/upload`, `DELETE /api/v2/screenshots/:id`, preview link `/api/v2/screenshots/:id/image`. Keep confirm on upload-all and delete, the busy flag, and the separate 5s timer.

Rename `ps-` / `mon-` classes to `ops-` in this file. Add any missing table/button rules to `ops.css`.

`app.js` calls `mountScreenshotsPanel(document.querySelector('#ops-panel-shots'))` once. The shots panel starts `hidden`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/characterization/characterize-ops-page.mjs`

Expected: `characterize-ops-page: OK`

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/ops-console/screenshots-panel.js src/dashboard/ops-console/app.js src/dashboard/ops-console/ops.css scripts/characterization/characterize-ops-page.mjs
git commit -m "feat(ops): 待上传截图标签"
```

---

### Task 7: Remove the boards from `/api/docs` and register pins

**Files:**
- Modify: `src/dashboard/api-docs/app.js` (imports near lines 6-7; `renderGroup` near 289-298)
- Modify: `src/dashboard/api-docs/catalog.js` (`API_GROUPS` near lines 56-59; drop `GROUP_SLOT_MONITOR` and `GROUP_PENDING_SCREENSHOTS` if nothing else imports them)
- Delete: `src/dashboard/api-docs/slot-monitor.js`
- Delete: `src/dashboard/api-docs/pending-screenshots.js`
- Modify: `scripts/refactor/verify-all.sh` (`PINS_CORE` list, after `characterize-agent-llm-error`)
- Test: extend `scripts/characterization/characterize-ops-page.mjs`

**Interfaces:**
- Consumes: `/ops` page from Tasks 4-6
- Produces: docs page no longer mounts the two boards

- [ ] **Step 1: Write the failing test**

Append:

```javascript
const docsApp = readFileSync('src/dashboard/api-docs/app.js', 'utf8');
assert(!docsApp.includes('slot-monitor.js') && !docsApp.includes('pending-screenshots.js'), 'docs still imports boards');
const catalog = readFileSync('src/dashboard/api-docs/catalog.js', 'utf8');
assert(!catalog.includes('...GROUP_SLOT_MONITOR') && !catalog.includes('...GROUP_PENDING_SCREENSHOTS'), 'catalog still lists boards');
const verify = readFileSync('scripts/refactor/verify-all.sh', 'utf8');
assert(verify.includes('characterize-ops-log-cards'), 'log pin not registered');
assert(verify.includes('characterize-ops-step-line'), 'step pin not registered');
assert(verify.includes('characterize-ops-card-line'), 'card pin not registered');
assert(verify.includes('characterize-ops-page'), 'page pin not registered');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/characterization/characterize-ops-page.mjs`

Expected: FAIL because `app.js` still imports `slot-monitor.js`.

- [ ] **Step 3: Write minimal implementation**

Remove the two imports and the `group.id === 'pending-screenshots'` / `mountSlotMonitor` branches from `renderGroup`. Leave `mountAuthRecordingPanel`. Remove the two groups from `API_GROUPS`. Delete the two JS files. Append to `PINS_CORE` in `verify-all.sh`:

```text
characterize-ops-log-cards|node scripts/characterization/characterize-ops-log-cards.mjs
characterize-ops-step-line|"$PY" scripts/characterization/characterize-ops-step-line.py
characterize-ops-card-line|"$PY" scripts/characterization/characterize-ops-card-line.py
characterize-ops-page|node scripts/characterization/characterize-ops-page.mjs
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
node scripts/characterization/characterize-ops-log-cards.mjs
python scripts/characterization/characterize-ops-step-line.py
python scripts/characterization/characterize-ops-card-line.py
node scripts/characterization/characterize-ops-page.mjs
```

Expected: each prints its `OK` line.

Then run: `bash scripts/refactor/verify-all.sh core`

Expected: the four new pins pass inside the core pipeline. If `bash` is unavailable, run the four commands above and record that the full shell pipeline was not run.

- [ ] **Step 5: Manual check**

Start the control plane if it is not already up. Open `http://localhost:4097/ops`. Confirm the executor tab lists slots (or the empty/error state if no executor is connected), the screenshot tab lists pending rows or the empty state, and `/api/docs` shows the new link and not the two old nav items.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/api-docs/app.js src/dashboard/api-docs/catalog.js scripts/refactor/verify-all.sh scripts/characterization/characterize-ops-page.mjs
git add -u src/dashboard/api-docs/slot-monitor.js src/dashboard/api-docs/pending-screenshots.js
git commit -m "refactor(docs): 执行机和待上传截图从文档页挪到 /ops"
```
