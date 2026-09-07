# phase_done 跨 run 串台修复实施计划（runId 归属隔离）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每轮 AI 录制生成 runId 并全链路透传，phase_done/phase_error 及落库事件按归属过滤；所有异常结束路径补发 cancel_step——根除「旧僵尸 agent 的事件被新一轮录制误吃 → 提前弹『AI 录制结束』」。

**Architecture:** 控制面 `startTrajectoryRecording` 入口生成 runId，随 `step` 事件下发；执行机 Python `session_runner.py` 保存并回带到 phase_done/phase_error/phase_state_key；控制面等待与订阅用共享纯函数 `phaseEventOwnership` 过滤（payload 无 runId → 旧执行机兼容放行）；runner finally 无条件补发 cancel_step。归属判定抽成纯模块便于离线单测，runner 侧用文本 pin 断言接线，Python 侧沿用 characterize 文本 pin 模式。

**Tech Stack:** Node.js ESM (Express 控制面) + Python asyncio (browser_use 执行机) + node:assert characterization。

**Spec:** `docs/spec-phase-done-cross-run-fix.md`（P0 全部 + P1 全部；P2 heal 并发标记出范围，见 Task 6 遗留）。

## Global Constraints

- 不改前端（spec §2 已排除）；不改 `src/executor-event-hub.js` 既有导出签名（只新增消费，不破坏 menu-scan/replay/manual 等其他 13 处 waitForSessionEvent 调用点）。
- 兼容规则逐字执行：**payload 无 runId 字段 → 按旧行为放行**（legacy），runId 不匹配才丢；丢弃必须打 warn 日志（`phase_done_ignored_runid` / `phase_done_missing_runid` / `phase_done_ignored_canceled`）。
- characterization 文本 pin 纪律：只插入新断言与被 pin 的新代码段，**严禁删除/修改既有断言行**（AGENTS.md 硬约束）。
- 新公开函数必须有 JSDoc（docs/jsdoc-convention.md，eslint warn 清零）；`npm run lint` 不得引入新 warning。
- Python 改动后必须 module 级真实 import 验证（内存教训：文本 pin 拦不住 import 坏）。Python 用 `./python/python.exe`（缺失时回退 `D:/anaconda3/envs/browser_use/python.exe`，下称 `$PY`）。
- verify-all 基线当前 ALL GREEN（2026-09-07）；收尾必须保持。`bash scripts/refactor/verify-all.sh` 全量跑一次约数分钟。
- agent-log 协议：开工声明先 commit；子智能体不 commit、不写 agent-log，主会话验收后代提交。
- 湿测（spec §5 验收 1-3）需真机执行机，本计划不含——收尾移交产品/引擎湿测，见 Task 6。

---

### Task 1: 归属判定纯函数模块 + 离线单测

**Files:**
- Create: `src/services/trajectory/run-event-ownership.js`
- Test: `scripts/characterization/characterize-run-event-ownership.mjs`

**Interfaces:**
- Produces（后续 Task 2/3 消费）:
  - `phaseEventOwnership(payload, { runId, phaseNumber = null })` → `{ decision: 'accept'|'ignore'|'legacy', reason: string }`
  - `waitForSessionEventOwned({ addListener, type, runId, phaseNumber = null, onIgnored })` → `Promise<payload>`，promise 带 `.cancel()`（与 `waitForSessionEvent` 同接口语义：无超时、cancel 静默丢弃）
- `addListener` 签名：`(type, handler) => unsub`——即 `execSession.onSessionEvent` / `onSessionEvent`（executor-event-hub）。

- [ ] **Step 1: 写失败测试**

```js
/**
 * runId ownership filter (offline, no DB/session).
 * Run: node scripts/characterization/characterize-run-event-ownership.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  phaseEventOwnership,
  waitForSessionEventOwned,
} from '../../src/services/trajectory/run-event-ownership.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function testOwnership() {
  // owned + matching phase → accept
  assert.deepEqual(
    phaseEventOwnership({ runId: 'r1', phase: 2 }, { runId: 'r1', phaseNumber: 2 }),
    { decision: 'accept', reason: '' },
  );
  // runId mismatch → ignore（僵尸 agent 事件）
  assert.equal(
    phaseEventOwnership({ runId: 'stale', phase: 4 }, { runId: 'r1', phaseNumber: 1 }).decision,
    'ignore',
  );
  // phase mismatch（同 run 内等阶段 1 时到了阶段 2 的 done）→ ignore
  assert.equal(
    phaseEventOwnership({ runId: 'r1', phase: 2 }, { runId: 'r1', phaseNumber: 1 }).decision,
    'ignore',
  );
  // payload 无 runId → legacy（兼容旧执行机），phase 匹配时放行
  assert.deepEqual(
    phaseEventOwnership({ phase: 2 }, { runId: 'r1', phaseNumber: 2 }),
    { decision: 'legacy', reason: 'missing_runid' },
  );
  // persist 类订阅不传 phaseNumber → 不做阶段校验
  assert.equal(
    phaseEventOwnership({ runId: 'r1', phase: 9 }, { runId: 'r1' }).decision,
    'accept',
  );
  assert.equal(
    phaseEventOwnership({ runId: 'stale' }, { runId: 'r1' }).decision,
    'ignore',
  );
}

async function testOwnedWait() {
  const hub = new EventEmitter();
  const addListener = (type, handler) => {
    hub.on(type, handler);
    return () => hub.off(type, handler);
  };
  const ignored = [];
  const doneP = waitForSessionEventOwned({
    addListener,
    type: 'phase_done',
    runId: 'r1',
    phaseNumber: 1,
    onIgnored: (payload, reason) => ignored.push(reason),
  });
  // 僵尸 done：旧 run、无 runId 旧事件、phase 错位——都应被忽略
  hub.emit('phase_done', { runId: 'stale', phase: 4 });
  hub.emit('phase_done', { phase: 9 });
  hub.emit('phase_done', { runId: 'r1', phase: 2 });
  // 本轮 canceled done → 忽略（不计入阶段完成）
  hub.emit('phase_done', { runId: 'r1', phase: 1, canceled: true });
  assert.deepEqual(ignored, ['runid_mismatch', 'missing_runid', 'phase_mismatch', 'canceled']);
  // 真正的本轮阶段 1 done → resolve
  hub.emit('phase_done', { runId: 'r1', phase: 1, success: true });
  const payload = await doneP;
  assert.equal(payload.success, true);

  // cancel 语义：未被 resolve 的等待 cancel 后静默（无 unhandled rejection）
  const p2 = waitForSessionEventOwned({ addListener, type: 'phase_done', runId: 'rX' });
  p2.cancel();
  await p2; // must not throw / hang
}

function testRunnerWiring() {
  // 文本 pin：runner 已接线（Task 2/3 完成后本段通过）
  const runner = readFileSync(
    join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  assert.ok(runner.includes('runtime.currentRunId'), 'runner stores currentRunId');
  assert.ok(runner.includes('stepData.runId'), 'runner sends runId in step data');
  assert.ok(
    runner.includes("waitForSessionEventOwned({") ,
    'phase_done/phase_error waits go through owned filter',
  );
  assert.ok(runner.includes('cancel_step'), 'finally re-sends cancel_step');
}

function testRunnerOwnFilterWiring() {
  const runner = readFileSync(
    join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  // 订阅回调里的落库事件过滤（Task 3）：persist 事件必须先过 ownership 再计数/落库
  const cb = runner.split('subscribeSessionEvents(runtime.sessionId')[1] || '';
  assert.ok(cb.includes('phaseEventOwnership'), 'persist callback filters by ownership');
}

const steps = [testOwnership, testOwnedWait, testRunnerWiring, testRunnerOwnFilterWiring];
for (const [i, fn] of steps.entries()) {
  try {
    await fn();
  } catch (err) {
    console.error(`FAIL step ${i + 1} (${fn.name}): ${err.message}`);
    process.exit(1);
  }
}
console.log('PASS characterize-run-event-ownership');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node scripts/characterization/characterize-run-event-ownership.mjs`
Expected: FAIL（模块不存在 / 后续 wiring pin 未满足）

- [ ] **Step 3: 实现纯函数模块**

```js
/**
 * Run-scoped event ownership for AI recording (phase_done 跨 run 串台修复，
 * spec: docs/spec-phase-done-cross-run-fix.md)。
 *
 * 每轮录制生成 runId 随 step 下发，执行机回带；控制面按归属过滤事件。
 * 兼容规则：payload 无 runId 字段 → legacy 放行（旧执行机）；不匹配才丢。
 */
/** @typedef {{ decision: 'accept'|'ignore'|'legacy', reason: string }} OwnershipVerdict */

/**
 * Judge whether an executor session event belongs to the current recording run.
 * @param {object|null} payload event payload (runId / phase / canceled fields)
 * @param {{ runId: string|null, phaseNumber?: number|null }} opts current run id;
 *   phaseNumber given only for phase_done/phase_error waits (null for persist events)
 * @returns {OwnershipVerdict} accept = ours; ignore = foreign/filtered; legacy = old executor (allow)
 */
export function phaseEventOwnership(payload, { runId, phaseNumber = null } = {}) {
  const pRunId = payload?.runId;
  if (pRunId == null || pRunId === '') {
    return { decision: 'legacy', reason: 'missing_runid' };
  }
  if (runId != null && String(pRunId) !== String(runId)) {
    return { decision: 'ignore', reason: 'runid_mismatch' };
  }
  if (phaseNumber != null && Number(payload?.phase) !== Number(phaseNumber)) {
    return { decision: 'ignore', reason: 'phase_mismatch' };
  }
  return { decision: 'accept', reason: '' };
}

/**
 * Wait for the next OWNED session event (ownership-filtered waitForSessionEvent).
 * Non-owned payloads are ignored with onIgnored logging; a payload flagged
 * `canceled: true` is ignored too (spec 4.3.2: canceled phase_done 不计入阶段完成).
 * No timeout here — the caller's idle watchdog is the only timeout (runner race).
 * @param {{ addListener: (type: string, handler: (payload: object) => void) => () => void,
 *           type: string, runId: string|null, phaseNumber?: number|null,
 *           onIgnored?: (payload: object, reason: string) => void }} opts
 * @returns {Promise<object>} first owned payload; promise.cancel() detaches silently
 */
export function waitForSessionEventOwned({ addListener, type, runId, phaseNumber = null, onIgnored }) {
  let cancel = () => {};
  const promise = new Promise((resolve) => {
    const unsub = addListener(type, (payload) => {
      const own = phaseEventOwnership(payload, { runId, phaseNumber });
      if (own.decision === 'ignore') {
        onIgnored?.(payload, own.reason);
        return;
      }
      if (payload?.canceled === true) {
        onIgnored?.(payload, 'canceled');
        return;
      }
      unsub();
      resolve(payload);
    });
    cancel = () => {
      unsub();
    };
  });
  promise.cancel = cancel;
  promise.catch(() => {});
  return promise;
}
```

- [ ] **Step 4: 跑测试（ownership/wait 应过，wiring pin 仍红）**

Run: `node scripts/characterization/characterize-run-event-ownership.mjs`
Expected: 仍 FAIL，失败点在 `testRunnerWiring`（runner 尚未接线）

- [ ] **Step 5: Commit（wiring pin 未绿的测试文件也一并入库，Task 2/3 转绿）**

```bash
git add src/services/trajectory/run-event-ownership.js scripts/characterization/characterize-run-event-ownership.mjs
git commit -m "feat(engine): run-event ownership filter module (runId phase_done cross-run fix, TDD step 1)"
```

---

### Task 2: runner 生成 runId + step 下发 + phase_done/phase_error 归属等待

**Files:**
- Modify: `src/services/trajectory/trajectory-recording-runner.js`（三处：import、runtime.currentRunId 生成 ~:669、phase 循环 doneP/errRaw ~:803-804 与 stepData ~:846）

**Interfaces:**
- Consumes: Task 1 的 `phaseEventOwnership` 不直接用；`waitForSessionEventOwned({ addListener, type, runId, phaseNumber })`。
- Produces: `runtime.currentRunId`（string）——Task 3 的订阅过滤与 finally cancel_step 消费。

- [ ] **Step 1: 加 import**

文件顶部 import 区（`import { setActionLogCopy, ... } from './action-log-copy.js';` 附近）加：

```js
import { waitForSessionEventOwned } from './run-event-ownership.js';
```

- [ ] **Step 2: 入口生成 runId**

在 `runtime.phaseBusinessCounts = new Map();`（~:672）之后插入：

```js
  // phase_done 跨 run 串台修复（spec 4.1）：本轮录制唯一 runId，随 step 下发，
  // 事件按归属过滤；finally 补发 cancel_step 也以此标记本次 run。
  runtime.currentRunId = (await import('node:crypto')).randomUUID();
  runtime._sentStepThisRun = false;
```

（注：文件顶部已有 `import { state } from '../../state.js'` 等，直接静态 `import crypto from 'node:crypto'` 加到 import 区亦可——实现者任选一种，保持一致即可。）

- [ ] **Step 3: step 下发带 runId**

`stepData.trajectory_id = tid;`（~:846）之后加：

```js
      stepData.runId = runtime.currentRunId;
      runtime._sentStepThisRun = true;
```

- [ ] **Step 4: done/err 等待改走 owned 过滤**

替换（~:803-804）：

```js
      const doneP = execSession.waitForSessionEvent(runtime.sessionId, 'phase_done', null);
      const errRaw = execSession.waitForSessionEvent(runtime.sessionId, 'phase_error', null);
```

为：

```js
      const ownedWaitOpts = {
        addListener: execSession.onSessionEvent,
        runId: runtime.currentRunId,
        phaseNumber: phase.phaseNumber,
        onIgnored: (payload, reason) => {
          console.warn(
            `[record] phase_done_ignored_${reason === 'missing_runid' ? 'missing_runid' : reason}`
            + ` session=${runtime.sessionId} phase=${payload?.phase} gotRunId=${payload?.runId}`
            + ` expect=${runtime.currentRunId}`,
          );
        },
      };
      const doneP = waitForSessionEventOwned({ ...ownedWaitOpts, type: 'phase_done' });
      const errRaw = waitForSessionEventOwned({ ...ownedWaitOpts, type: 'phase_error' });
```

`Promise.race([doneP, errP, idleP])`、`finally { doneP.cancel?.(); errRaw.cancel?.(); clearPhaseActivity(); }` 及 `errP` 包装**保持不动**（errP 的 `.then(p => Promise.reject(...))` 照旧——owned 过滤后 errRaw 只会 resolve 本轮 phase_error）。

- [ ] **Step 5: 跑测试 + 语法 + lint**

Run: `node scripts/characterization/characterize-run-event-ownership.mjs && node --check src/services/trajectory/trajectory-recording-runner.js && npx eslint src/services/trajectory/trajectory-recording-runner.js src/services/trajectory/run-event-ownership.js`
Expected: 全过（ownership + 两个 wiring pin 转绿；`testRunnerOwnFilterWiring` 仍红，属 Task 3）

- [ ] **Step 6: Commit**

```bash
git add src/services/trajectory/trajectory-recording-runner.js scripts/characterization/characterize-run-event-ownership.mjs
git commit -m "feat(engine): recording runner issues runId, phase_done/phase_error waits ownership-filtered (spec 4.1)"
```

---

### Task 3: 订阅落库事件按 runId 过滤 + finally 补发 cancel_step

**Files:**
- Modify: `src/services/trajectory/trajectory-recording-runner.js`（subscribe 回调 ~:592-633、finally ~:1019）
- Test: `scripts/characterization/characterize-run-event-ownership.mjs`（Task 1 已含 wiring pin）

**Interfaces:**
- Consumes: Task 1 `phaseEventOwnership`（persist 场景 `phaseNumber` 传 null）；Task 2 `runtime.currentRunId`、`runtime._sentStepThisRun`。

- [ ] **Step 1: import 纯函数**

Task 2 的 import 行扩为：

```js
import { waitForSessionEventOwned, phaseEventOwnership } from './run-event-ownership.js';
```

- [ ] **Step 2: subscribe 回调加归属过滤**

在回调 `const work = (async () => {` **之前**（`[probe]` 日志行之前，保证僵尸事件连 watchdog 都喂不到）插入：

```js
    // 落库/观察事件按 runId 归属过滤（spec 4.1.4）：僵尸 run 的 action_log_sync
    // 不得写进本轮步骤表；无 runId 的旧执行机/manual/cdp 事件 legacy 放行。
    if (runtime.currentRunId) {
      const own = phaseEventOwnership(payload, { runId: runtime.currentRunId });
      if (own.decision === 'ignore') {
        console.warn(
          `[record] ${type}_ignored_runid session=${runtime.sessionId}`
          + ` got=${payload?.runId} expect=${runtime.currentRunId}`,
        );
        return;
      }
    }
```

（位置：`const unsubscribe = execSession.subscribeSessionEvents(runtime.sessionId, (type, payload) => {` 的回调体第一段，`if (type === 'phase_done' || ...)` probe 日志之前。）

- [ ] **Step 3: finally 无条件补发 cancel_step**

finally 块内 `clearPhaseActivity();` 之后加：

```js
    // spec 4.2：所有异常结束路径（空闲超时/phase_error）都必须叫停执行机 agent，
    // 否则 Python agent 成僵尸继续吐事件。幂等：stop 路径已发过，可再发
    //（_request_agent_stop 天然幂等）；正常完成路径发送亦无害（agent 已空闲）。
    if (runtime._sentStepThisRun) {
      try {
        execSession.forwardStdin({
          nodeUuid: runtime.executorNodeUuid,
          sessionId: runtime.sessionId,
          event: 'cancel_step',
          data: { runId: runtime.currentRunId },
        });
      } catch {}
    }
```

（`_sentStepThisRun` 保证 run 未发过 step 时不动会话。）

- [ ] **Step 4: 跑测试 + lint + verify-all**

Run: `node scripts/characterization/characterize-run-event-ownership.mjs && npx eslint src/services/trajectory/trajectory-recording-runner.js && bash scripts/refactor/verify-all.sh`
Expected: 全绿（Task 1 wiring pin 全部转绿）

- [ ] **Step 5: Commit**

```bash
git add src/services/trajectory/trajectory-recording-runner.js
git commit -m "feat(engine): persist events filtered by runId + finally resends cancel_step (spec 4.1.4/4.2)"
```

---

### Task 4: 执行机 runId 回带 + canceled 标记 + new-step 强制叫停（Python）

**Files:**
- Modify: `scripts/state.py`（新增 `_CURRENT_RUN_ID` + set/get，跟随 `_CURRENT_PHASE` 模式）
- Modify: `scripts/session_runner.py`（main loop `data = msg.get("data", {})` ~:523、`_run_step` ~:398-500、`_stdin_reader` ~:59-88）
- Modify: `scripts/agent/service.py`（phase_error emit ~:642-645）
- Test: `scripts/characterization/characterize-phase-done-runid.py`（新建，文本 pin 模式）

**Interfaces:**
- Consumes: 控制面下发的 `stepData.runId`（Task 2）。
- Produces: `phase_done`/`phase_error`/`phase_state_key` payload 回带 `runId`（string）与 `canceled`（bool，仅取消时出现）；控制面 legacy 规则兼容缺失。

- [ ] **Step 1: 写失败测试（文本 pin）**

```python
#!/usr/bin/env python3
"""Characterization: phase_done runId echo + cancel suppression (spec 4.3, offline text pins)."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
SR = ROOT / "scripts" / "session_runner.py"
SVC = ROOT / "scripts" / "agent" / "service.py"
STATE = ROOT / "scripts" / "state.py"

sr = SR.read_text(encoding="utf-8")
svc = SVC.read_text(encoding="utf-8")
state_src = STATE.read_text(encoding="utf-8")


def check(cond: bool, msg: str) -> None:
    if not cond:
        print(f"FAIL {msg}")
        sys.exit(1)


# 1. main loop saves runId from step data
check("data.get(\"runId\")" in sr or "data.get('runId')" in sr, "main loop reads data.runId")
check("set_current_run_id" in sr, "session_runner sets current run id")

# 2. phase_done echoes runId
check("phase_done_data[\"runId\"]" in sr or "phase_done_data['runId']" in sr,
      "phase_done echoes runId")

# 3. canceled step flags phase_done (spec 4.3.2)
check("'canceled'" in sr, "phase_done carries canceled flag when cancel flag set")

# 4. phase_state_key echoes runId
check("afterKey" in sr and sr.count("\"runId\"") + sr.count("'runId'") >= 3,
      "phase_state_key/runId echo wired (>=3 runId refs in session_runner)")

# 5. new step while agent busy → force stop (spec 4.3.3)
check("new_step_arrived" in sr, "_stdin_reader force-stops on new step while agent busy")

# 6. probe log carries runId (spec 验收 5)
check("runId=" in sr, "[probe] emit phase_done log includes runId")

# 7. state module exposes run id holder
check("_CURRENT_RUN_ID" in state_src and "def set_current_run_id" in state_src,
      "state exposes _CURRENT_RUN_ID + set_current_run_id")
check("get_current_run_id" in svc, "service phase_error reads current run id")

print("PASS characterize-phase-done-runid")
```

- [ ] **Step 2: 跑测试确认失败**

Run: `$PY scripts/characterization/characterize-phase-done-runid.py`
Expected: FAIL `main loop reads data.runId`

- [ ] **Step 3: state.py 加 run id 持有**

在 `_CURRENT_PHASE` 定义与 setter 附近（`grep -n "_CURRENT_PHASE" scripts/state.py | head`）按同模式加：

```python
_CURRENT_RUN_ID: str | None = None

def set_current_run_id(run_id):
    """Set current recording run id (echoed on phase_done/phase_error events)."""
    global _CURRENT_RUN_ID
    _CURRENT_RUN_ID = run_id

def get_current_run_id():
    """Return current recording run id (None when not set / legacy control plane)."""
    return _CURRENT_RUN_ID
```

- [ ] **Step 4: session_runner 主循环保存 runId**

`data = msg.get("data", {})`（~:523）之后加：

```js            # （Python 源码，无 js 标记——此处为示意，实际是 python 缩进块）
```

```python
            run_id = data.get("runId") or data.get("run_id") or None
            current_run_id = run_id  # nonlocal（_run_step 回带用）
            try:
                from . import state as _state_mod
                _state_mod.set_current_run_id(run_id)
            except Exception:
                pass
```

同时在 `run_session` 函数体开头（`cumulative_path` 等 nonlocal 声明处）加 `current_run_id = None` 并在 `_run_step` 的 `nonlocal cumulative_path` 行扩为 `nonlocal cumulative_path, current_run_id`。

- [ ] **Step 5: _run_step 回带 + canceled 判定**

(a) 阶段开始时清 cancel 残留（`agent_running_ref['value'] = True` 之前）：

```python
        # 新阶段开始：清掉上轮 cancel 残留（cancel_flag 是 per-session 常驻临时文件，
        # 不清会让后续所有阶段误判 canceled）。
        try:
            Path(cancel_flag_path).write_text('', encoding='utf-8')
        except Exception:
            pass
```

(b) `phase_done_data` 构造处（`"step_index": step_idx,` 之后）加：

```python
        if current_run_id:
            phase_done_data["runId"] = current_run_id
```

(c) agent 跑完、emit 之前（`register_current_page_screenshot` try 块之后）加取消判定：

```python
        step_canceled = False
        try:
            if Path(cancel_flag_path).read_text(encoding='utf-8').strip() == 'cancel':
                step_canceled = True
        except Exception:
            pass
        try:
            if isinstance(goal_tracker, dict) and goal_tracker.get('stopped'):
                step_canceled = True
        except Exception:
            pass
        if step_canceled:
            phase_done_data["canceled"] = True
            sys.stderr.write(f"[recorder] step canceled — phase_done flagged canceled phase={phase_num}\n")
            sys.stderr.flush()
```

(d) probe 日志（既有 `[probe] emit phase_done ...` 行，session_runner.py:486）追加 runId：

```python
            sys.stderr.write(f"[probe] emit phase_done phase={phase_num} actions={len(_probe_alog)} session={session_id} runId={current_run_id}\n")
```

(e) `phase_state_key` emit 的 data dict（~:429）加：

```python
                    "runId": current_run_id,
```

- [ ] **Step 6: _stdin_reader new-step 强制叫停**

`_stdin_reader` 中 `if event == "cancel_step":` 块（~:86）之后加：

```python
        # spec 4.3.3：旧 agent 仍在跑时新 step 已到（run N+1 排队）→ 立即叫停旧 agent，
        # 缩短僵尸窗口；被停 step 的 phase_done 由 _run_step 打 canceled，控制面过滤。
        if event == "step" and agent_running_ref.get('value'):
            _request_agent_stop(cancel_flag_path, goal_tracker, reason='new_step_arrived')
```

- [ ] **Step 7: service.py phase_error 回带**

两处 `emit_json({"event": "phase_error", ...}`（~:642、:645）：每处 data dict 加 `"runId": get_current_run_id(),`，并在文件对应 import 区补 `get_current_run_id`（service.py 已从 state import 其他符号，跟随现有 import 行即可）。

- [ ] **Step 8: 跑测试 + 真实 import 验证**

Run:
```bash
$PY scripts/characterization/characterize-phase-done-runid.py
$PY -c "import scripts.session_runner, scripts.agent.service, scripts.state; print('IMPORT-OK')"
```
Expected: 均通过（import 必须真实执行——文本 pin 之外的兜底）。

- [ ] **Step 9: Commit**

```bash
git add scripts/state.py scripts/session_runner.py scripts/agent/service.py scripts/characterization/characterize-phase-done-runid.py
git commit -m "feat(engine): executor echoes runId on phase_done/phase_error/phase_state_key, flags canceled steps, force-stops on new step (spec 4.3)"
```

---

### Task 5: verify-all 注册 + 全量回归

**Files:**
- Modify: `scripts/refactor/verify-all.sh`（characterization 注册区，`run "characterize-..."` 列表）

- [ ] **Step 1: 注册两个新测试**

在既有 `run "characterize-..."` 行附近（保持脚本风格对齐）加：

```bash
run "characterize-run-event-ownership" node scripts/characterization/characterize-run-event-ownership.mjs
run "characterize-phase-done-runid"    "$PY" scripts/characterization/characterize-phase-done-runid.py
```

- [ ] **Step 2: 全量回归**

Run: `bash scripts/refactor/verify-all.sh`
Expected: `verify-all: ALL GREEN`

- [ ] **Step 3: Commit**

```bash
git add scripts/refactor/verify-all.sh
git commit -m "test: register run-event-ownership + phase-done-runid characterization in verify-all"
```

---

### Task 6: agent-log 开工/收工 + 湿测移交

**Files:**
- Modify: `docs/superpowers/agent-log.md`（仅本条目）

- [ ] **Step 1: 开工声明（任务开始时即做，勿留到最后）**

按协议插入顶部并立即 commit（文件集=本计划所有任务文件 + agent-log；禁入区=前端仓库、data/kb/**、他线 WIP scripts/session_runner.py 若他线在改则先协调）。

- [ ] **Step 2: 收工条目 + 最终 commit**

收工条目含：各 Task commit hash、verify-all 证据、**湿测移交清单**（spec §5 验收 1-3 需真机：①伪造无 runId/旧 run phase_done 注入→控制面忽略；②空闲超时结束 run N 后立即重录 run N+1→互不串台；③stop 后 agent 步边界内停止且不再吐 done）。P2 出范围：`replay-heal-shared.js:124` heal 等待未加归属标记（spec §4.4：当前 UI 不允许并发，风险低，留种子）。

```bash
git add docs/superpowers/agent-log.md
git commit -m "docs(agent-log): phase_done cross-run fix complete + wet-test handover"
```

---

## Self-Review 记录

- **Spec 覆盖**：4.1（runId 生成/下发/等待过滤→Task 2；订阅过滤→Task 3）✓；4.2（finally cancel_step→Task 3）✓；4.3.1（回带→Task 4 Step 4/5/7）✓；4.3.2（canceled→Task 4 Step 5c + Task 1 wait filter）✓；4.3.3（new_step_arrived→Task 4 Step 6）✓；4.4 兼容（legacy 放行+missing_runid 日志→Task 1/2/3）✓；验收 5（probe 日志带 runId→Task 4 Step 5d）✓；验收 1-3 湿测→Task 6 移交 ✓。
- **类型一致**：`phaseEventOwnership` 返回 `{decision, reason}` 在 Task 1 测试/实现/Task 2/3 用法一致；`waitForSessionEventOwned` 参数对象 `{addListener, type, runId, phaseNumber, onIgnored}` 与 runner 调用一致；`runtime.currentRunId`/`_sentStepThisRun` 两处消费与 Task 2 产出一致。
- **占位符**：Task 4 Step 4 的代码块标注了 python 缩进示意（第一个空块仅为标签说明，实际代码紧随其后）——实现者注意该步代码是 Python 缩进块，插入位置为 `data = msg.get("data", {})` 之后。
- **行为红线**：`subscribeSessionEvents` 用 hub `'*'` 事件，回调里 `payload` 是内层负载（`{type, payload}` 解包后），过滤读 `payload.runId` 正确；manual/CDP 录制事件无 runId → legacy 放行，不受影响；`batch-record.js` 复用 `startTrajectoryRecording` 自动获得隔离（spec 4.4 已声明，无需改）。
