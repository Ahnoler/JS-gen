# Recording Coach 湿测操作员补充计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 recording-coach 按合约线湿测草稿当操作员：自己把输入编成任务书、按管线录制、60 秒存快照并盯阶段 done/doneLogs、40 分钟封顶，最后一条消息按契约回报。

**Architecture:** 不改 Python 录制引擎，不改控制面。纯函数放新文件并用 characterization pin 卡住；`tools.mjs` 只负责调用它们和写证据。阶段机不新增 phase，用 `workflow.json` 上的标志位挡住跳步。给录制引擎的 `task` 只含业务门闩；操作员五段式任务书单独落在 `dispatch-brief.md`，禁止塞进 `task`。

**Tech Stack:** 现有 `tools/recording-coach` ESM、`node:assert` characterization pin、控制面 `GET/POST /api/v2`、Chrome CDP `http://127.0.0.1:<port>/json`。

**Parent plan:** [`2026-09-18-recording-coach-opencode.md`](./2026-09-18-recording-coach-opencode.md)

**Source draft (read-only, do not write back):** `D:\dev\JS-gen-contract\docs\superpowers\guides\2026-09-19-recording-coach-skill-draft.md`

**Evidence to copy behavior from, not to commit:** `D:\dev\JS-gen-contract\tmp\contract-wet7-20260919\`、`D:\dev\JS-gen-contract\tmp\contract-wet8-20260919\`

## Global Constraints

- 取代父计划两处锁定：轮询间隔改为 **60000 ms**；`start_record` 默认超时改为 **2400000 ms（40 分钟）**。超时仍 detach，结论 `BLOCKED_录制超时`。
- `phaseIds` 必须是数据库数字 id。UUID 或含 `-` 的值在 POST 之前抛错，错误文案含 `phaseIds must be database numeric ids`。
- `prepare` 只认响应 `data.ready === true`。否则不推进 phase。
- CDP 端口优先用 prepare 响应的 `data.stages.browser.cdpPort`；没有时用 `19242 + slotIndex`。禁止写死 19242。
- 关闭弹窗的针只允许：`天元相关配置`、`维度参数配置`、`公告`、`通知`。禁止用单独的 `配置` 或 `提示` 当针。
- `doneLogs` 文本在执行器源头约 400 字截断。摘要只取前 400 字，并标 `tailUnreliable: true`。验收不得依赖尾部。
- 不新增 MySQL 客户端，不读库密码。只读核查只允许 `GET` 且 path 以 `/api/v2/` 开头。
- 不改引擎、不重启 4097、不 detach 非本单轨迹。不把草稿回写到 `JS-gen-contract`。
- 用户没要求就不要 commit。下面的 commit 步是检查点，默认跳过。
- 新 pin 注册到 `scripts/refactor/verify-all.sh` 现有 `characterize-recording-coach-assert` 那一行的下一行。

## File map

| Path | Role |
|------|------|
| `tools/recording-coach/src/poll-watch.mjs` | 间隔、死线、`phaseDigest`、快照文件名 |
| `tools/recording-coach/src/phase-ids.mjs` | 数字 phaseId 校验；CDP 端口 |
| `tools/recording-coach/src/close-contract.mjs` | 结论枚举、五行收尾、从落库挑选 3 条证据 |
| `tools/recording-coach/src/cdp-precheck.mjs` | 枚举并关闭已知遮挡弹窗 |
| `tools/recording-coach/src/assert-steps.mjs` | 增加诚实失败 `REJECTED` |
| `tools/recording-coach/src/tools.mjs` | 接线：门闩、60 秒快照、40 分钟、报告 |
| `tools/recording-coach/src/workflow.mjs` | 标志位，不新增 phase |
| `tools/recording-coach/src/opencode-plugin.mjs` | 注册新工具 |
| `tools/recording-coach/skill/SKILL.md` | 吸收草稿；区分 task 与 dispatch brief |
| `scripts/characterization/cold/characterize-recording-coach-operator.mjs` | 本补充的 pin |
| `scripts/refactor/verify-all.sh` | 注册上一行 pin |

---

### Task 1: 轮询摘要与 40 分钟死线

**Files:**
- Create: `tools/recording-coach/src/poll-watch.mjs`
- Create: `scripts/characterization/cold/characterize-recording-coach-operator.mjs`
- Modify: `scripts/refactor/verify-all.sh`（assert pin 下一行）

**Interfaces:**
- Produces: `POLL_INTERVAL_MS = 60_000`
- Produces: `RECORD_DEADLINE_MS = 2_400_000`
- Produces: `phaseDigest(trajectory) → { phases: Array<{id:number, phaseNumber:number, status:string, done:boolean, doneLogTexts:string[], tailUnreliable:true}>, doneCount:number, phaseCount:number }`
- Produces: `pollSnapshotName(n: number) → string`，`n` 从 1 起，返回 `poll-${n}.json`
- Consumes: 无

- [ ] **Step 1: 写失败 pin**

把下面整段放进 `scripts/characterization/cold/characterize-recording-coach-operator.mjs`。此时模块还不存在，运行应失败。

```js
import assert from 'node:assert/strict';
import { POLL_INTERVAL_MS, RECORD_DEADLINE_MS, phaseDigest, pollSnapshotName } from '../../../tools/recording-coach/src/poll-watch.mjs';

assert.equal(POLL_INTERVAL_MS, 60_000);
assert.equal(RECORD_DEADLINE_MS, 2_400_000);
assert.equal(pollSnapshotName(1), 'poll-1.json');

const digest = phaseDigest({
  phases: [
    { id: 2300, phaseNumber: 1, status: 'completed', doneLogs: [{ text: 'x'.repeat(500) }] },
    { id: 2301, phaseNumber: 2, status: 'running', doneLogs: [] },
  ],
});
assert.equal(digest.doneCount, 1);
assert.equal(digest.phaseCount, 2);
assert.equal(digest.phases[0].done, true);
assert.equal(digest.phases[0].tailUnreliable, true);
assert.equal(digest.phases[0].doneLogTexts[0].length, 400);
assert.equal(digest.phases[1].done, false);

console.log('OK characterize-recording-coach-operator');
```

- [ ] **Step 2: 跑 pin，确认失败**

Run: `node scripts/characterization/cold/characterize-recording-coach-operator.mjs`

Expected: 失败，模块找不到或导出不存在。

- [ ] **Step 3: 实现 `poll-watch.mjs`**

```js
export const POLL_INTERVAL_MS = 60_000;
export const RECORD_DEADLINE_MS = 2_400_000;

export function pollSnapshotName(n) {
  return `poll-${n}.json`;
}

function logText(entry) {
  if (typeof entry === 'string') return entry;
  return String(entry?.text ?? '');
}

export function phaseDigest(trajectory) {
  const phases = Array.isArray(trajectory?.phases) ? trajectory.phases : [];
  const rows = phases.map((p) => {
    const doneLogTexts = (Array.isArray(p.doneLogs) ? p.doneLogs : [])
      .map(logText)
      .filter(Boolean)
      .map((t) => t.slice(0, 400));
    const status = String(p.status || '');
    return {
      id: p.id,
      phaseNumber: p.phaseNumber,
      status,
      done: status === 'completed' || status === 'done',
      doneLogTexts,
      tailUnreliable: true,
    };
  });
  return {
    phases: rows,
    doneCount: rows.filter((r) => r.done).length,
    phaseCount: rows.length,
  };
}
```

- [ ] **Step 4: 跑 pin，确认通过，并注册**

Run: `node scripts/characterization/cold/characterize-recording-coach-operator.mjs`

Expected: `OK characterize-recording-coach-operator`

在 `scripts/refactor/verify-all.sh` 的 `characterize-recording-coach-assert` 下一行加入：

```bash
run "characterize-recording-coach-operator" node scripts/characterization/cold/characterize-recording-coach-operator.mjs
```

- [ ] **Step 5: Commit（仅当用户要求）**

```bash
git add tools/recording-coach/src/poll-watch.mjs scripts/characterization/cold/characterize-recording-coach-operator.mjs scripts/refactor/verify-all.sh
git commit -m "$(cat <<'EOF'
test(coach): 卡住 60 秒轮询与 40 分钟死线

湿测操作员要按阶段 done/doneLogs 值守，不能再只记 stepCount。
EOF
)"
```

---

### Task 2: `start_record` 每 60 秒落完整快照

**Files:**
- Modify: `tools/recording-coach/src/tools.mjs`（`start_record`，约 164–241 行）

**Interfaces:**
- Consumes: `POLL_INTERVAL_MS`、`RECORD_DEADLINE_MS`、`phaseDigest`、`pollSnapshotName`
- Produces: 证据目录 `poll-1.json` 起的完整 GET 响应；`progress.log` 每行含 `doneCount/phaseCount`

- [ ] **Step 1: 改默认超时与轮询**

`start_record` 签名默认值改为 `timeoutMs = RECORD_DEADLINE_MS`。删除 `setInterval(poll, 5_000)`。用下面的循环替换现有 `poll` / `pollTimer`。`writeJson` 已存在，快照用它。

```js
import { phaseDigest, pollSnapshotName, POLL_INTERVAL_MS, RECORD_DEADLINE_MS } from './poll-watch.mjs';

let pollN = 0;
const started = Date.now();
const pollOnce = async () => {
  pollN += 1;
  const raw = await http.get(`/api/v2/trajectories/${id}`, { timeoutMs: 30_000 });
  writeJson(pollSnapshotName(pollN), raw);
  const d = unwrap(raw);
  const digest = phaseDigest(d);
  appendProgress(
    `poll n=${pollN} recordStatus=${d?.recordStatus} stepCount=${d?.stepCount ?? '?'} done=${digest.doneCount}/${digest.phaseCount}`,
  );
  if (Date.now() - started > timeoutMs) {
    throw new Error('BLOCKED_录制超时');
  }
};
const pollTimer = setInterval(() => {
  pollOnce().catch((e) => appendProgress(`poll error: ${e.message}`));
}, POLL_INTERVAL_MS);
void pollOnce();
```

POST `record/start` 的 `timeoutMs` 用同一个 `timeoutMs`。`finally` 里仍 `clearInterval(pollTimer)`。捕获到 `BLOCKED_录制超时` 时走现有失败分支：detach，`appendProgress`，不把 phase 留在 Recording 而不处理。

进度行不要只写 `recordStatus` 和 `stepCount`。快照是完整响应，不要改成摘要。

- [ ] **Step 2: 静态核对**

Run: `node --check tools/recording-coach/src/tools.mjs`

Expected: 退出码 0。

在 `tools.mjs` 里确认不再出现 `5_000` 或 `1_800_000`。

- [ ] **Step 3: Commit（仅当用户要求）**

```bash
git add tools/recording-coach/src/tools.mjs
git commit -m "$(cat <<'EOF'
feat(coach): 录制值守改为 60 秒快照并设 40 分钟上限

旧的 5 秒进度行不看阶段 done/doneLogs，也无法事后对照。
EOF
)"
```

---

### Task 3: 数字 phaseId 与 prepare 的 ready

**Files:**
- Create: `tools/recording-coach/src/phase-ids.mjs`
- Modify: `tools/recording-coach/src/tools.mjs`（`prepare_record`、`start_record` 取 id 处）
- Modify: `scripts/characterization/cold/characterize-recording-coach-operator.mjs`

**Interfaces:**
- Produces: `assertNumericPhaseIds(ids) → number[]`
- Produces: `cdpPortFromPrepare(prepareData, slotIndex) → number`
- Consumes: Task 1 的 pin 文件，往同一文件追加断言

- [ ] **Step 1: 先加会失败的断言**

追加到 operator pin：

```js
import { assertNumericPhaseIds, cdpPortFromPrepare } from '../../../tools/recording-coach/src/phase-ids.mjs';

assert.deepEqual(assertNumericPhaseIds([2338, '2339']), [2338, 2339]);
assert.throws(
  () => assertNumericPhaseIds(['b01aca42-1dbe-4814-b9af-3a9fb7c993f9']),
  /phaseIds must be database numeric ids/,
);
assert.equal(
  cdpPortFromPrepare({ stages: { browser: { cdpPort: 19243 } } }, 0),
  19243,
);
assert.equal(cdpPortFromPrepare({}, 1), 19243);
```

Run: `node scripts/characterization/cold/characterize-recording-coach-operator.mjs`

Expected: 失败。

- [ ] **Step 2: 实现**

```js
export function assertNumericPhaseIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('phaseIds must be database numeric ids');
  }
  return ids.map((id) => {
    const text = String(id);
    const n = Number(id);
    if (text.includes('-') || !Number.isInteger(n)) {
      throw new Error('phaseIds must be database numeric ids, not UUIDs');
    }
    return n;
  });
}

export function cdpPortFromPrepare(prepareData, slotIndex) {
  const fromPrepare = Number(prepareData?.stages?.browser?.cdpPort);
  if (Number.isInteger(fromPrepare) && fromPrepare > 0) return fromPrepare;
  const slot = Number(slotIndex);
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error('cdp port missing: no prepare cdpPort and no slotIndex');
  }
  return 19242 + slot;
}
```

`start_record` 在 POST 之前调用 `assertNumericPhaseIds(ids)`，用返回值当 `phaseIds`。

`prepare_record` 在 `unwrap` 之后：

```js
const data = unwrap(raw);
if (data?.ready !== true) {
  throw new Error('prepare not ready — stop');
}
```

`ready !== true` 时不要调用 `applyToolSuccess`。把 `cdpPortFromPrepare` 的结果写进 workflow：`wf.cdpPort = cdpPortFromPrepare(data, matchedSlot)`。`matchedSlot` 用 `list_executors` 里 `remoteSessionId === data.remoteSessionId` 的 `slotIndex`；对不上且 prepare 已给 `cdpPort` 时，slot 传 `null` 也可，因为函数会先用 prepare 的端口。

- [ ] **Step 3: 跑 pin 与语法检查**

Run: `node scripts/characterization/cold/characterize-recording-coach-operator.mjs && node --check tools/recording-coach/src/tools.mjs`

Expected: pin 打印 OK，`--check` 退出码 0。

- [ ] **Step 4: Commit（仅当用户要求）**

```bash
git add tools/recording-coach/src/phase-ids.mjs tools/recording-coach/src/tools.mjs scripts/characterization/cold/characterize-recording-coach-operator.mjs
git commit -m "$(cat <<'EOF'
fix(coach): prepare 只认 ready，phaseIds 拒绝 UUID

wet7 用 UUID 调 record/start 得到 400；没 ready 就开录会空等。
EOF
)"
```

---

### Task 4: 诚实失败算合法终局

**Files:**
- Modify: `tools/recording-coach/src/assert-steps.mjs`
- Modify: `scripts/characterization/cold/characterize-recording-coach-assert.mjs`

**Interfaces:**
- Consumes: 现有 `assertSteps(trajectory, criteria)`
- Produces: 在成功门闩未满足、且 `criteria.honestReject.enabled === true`、且某阶段 `doneLogs` 命中拒绝短语时，`verdict === 'REJECTED'`，`pass === false`，`rejectExcerpt` 为命中文本前 40 字
- 不改变现有三条 pin：0 步仍是 `BLOCKED`；`row_text=first` 仍是 `DONE`；错误 `row_text` 仍是 `paramEquals` 失败。未开 `honestReject` 时不得返回 `REJECTED`。

拒绝短语（整段匹配，不要再加宽）：`在途授信`、`评级未生效`、`已发起评级流程`、`请等待流程完成`。

- [ ] **Step 1: 在 assert pin 末尾追加失败用例**

```js
{
  const r = assertSteps(
    {
      recordStatus: 'failed',
      stepCount: 2,
      steps: [{ actionType: 'click_element_by_index', paramsJson: { text: '确认' } }],
      phases: [
        {
          status: 'completed',
          doneLogs: [{ text: '该客户已发起评级流程，请等待流程完成后再进行评级 全局流水号 abcdef' }],
        },
      ],
    },
    {
      honestReject: { enabled: true },
      requireActionTypes: ['click_table_row_radio'],
    },
  );
  assert.equal(r.pass, false);
  assert.equal(r.verdict, 'REJECTED');
  assert.match(r.rejectExcerpt, /已发起评级流程/);
}
```

Run: `node scripts/characterization/cold/characterize-recording-coach-assert.mjs`

Expected: 失败，`verdict` 仍是 `BLOCKED` 或 `rejectExcerpt` 不存在。

- [ ] **Step 2: 在算出 `pass` 之后插入判定**

成功门闩失败时先扫 `trajectory.phases[].doneLogs`。命中且 `honestReject.enabled` 才返回：

```js
return {
  pass: false,
  reasons,
  verdict: 'REJECTED',
  rejectExcerpt: hit.slice(0, 40),
};
```

没命中则保持现在的 `BLOCKED`。成功门闩通过时仍返回 `DONE` 或现有的 `DONE_WITH_CONCERNS`，不要因为 doneLogs 里有旧拒绝短语改判。

- [ ] **Step 3: 跑原 pin**

Run: `node scripts/characterization/cold/characterize-recording-coach-assert.mjs`

Expected: `OK characterize-recording-coach-assert`

- [ ] **Step 4: Commit（仅当用户要求）**

```bash
git add tools/recording-coach/src/assert-steps.mjs scripts/characterization/cold/characterize-recording-coach-assert.mjs
git commit -m "$(cat <<'EOF'
feat(coach): 服务端拒绝落在 doneLogs 时判 REJECTED

诚实失败是合法终局，不能和缺步骤的 BLOCKED 混成一类。
EOF
)"
```

---

### Task 5: 收尾五行契约

**Files:**
- Create: `tools/recording-coach/src/close-contract.mjs`
- Modify: `tools/recording-coach/src/tools.mjs`（新工具 `write_through_report`）
- Modify: `tools/recording-coach/src/opencode-plugin.mjs`（注册该工具）
- Modify: `scripts/characterization/cold/characterize-recording-coach-operator.mjs`

**Interfaces:**
- Produces: `formatOperatorClose({ conclusion, reportPath, evidence }) → string`
- Produces: `conclusionFromAssert(assertResult, productLabel) → string`
- Produces: `pickEvidence({ trajectory, evidenceDir }) → [string, string, string]`
- 结论只允许 `CREATED_`、`REJECTED_`、`BLOCKED_` 前缀，或恰好 `ERROR`。`DONE` 不能出现在结论行。
- 映射：`assertResult.verdict === 'DONE'` 或 `'DONE_WITH_CONCERNS'` → `CREATED_<productLabel>`；`'REJECTED'` → `REJECTED_<rejectExcerpt 去掉空白后的前 24 字>`；其余 → `BLOCKED_<reasons[0] 的前 24 字>`。`productLabel` 空则用 `steps`。

五行，不多不少：

```
结论：CREATED_steps
报告：D:\dev\JS-gen\tmp\recording-coach-x\through-report.md
证据1：traj-final.json id=899 actions=click_table_row_radio
证据2：click_table_row_radio row_text=first
证据3：poll-1.json done=1/4
```

- [ ] **Step 1: pin 格式与非法结论**

```js
import { formatOperatorClose, conclusionFromAssert } from '../../../tools/recording-coach/src/close-contract.mjs';

assert.equal(
  conclusionFromAssert({ verdict: 'DONE', pass: true }, 'click_table_row_radio_first'),
  'CREATED_click_table_row_radio_first',
);
assert.match(
  conclusionFromAssert({ verdict: 'REJECTED', rejectExcerpt: '已发起评级流程' }, 'steps'),
  /^REJECTED_/,
);
assert.throws(
  () => formatOperatorClose({ conclusion: 'DONE', reportPath: 'a', evidence: ['1', '2', '3'] }),
  /conclusion/,
);
const text = formatOperatorClose({
  conclusion: 'CREATED_steps',
  reportPath: 'D:/dev/JS-gen/tmp/recording-coach-x/through-report.md',
  evidence: ['traj-final.json id=1', 'row_text=first', 'poll-1.json done=1/4'],
});
assert.equal(text.split('\n').length, 5);
assert.match(text, /^结论：CREATED_steps\n报告：/);
assert.match(text, /证据3：poll-1\.json/);
```

- [ ] **Step 2: 实现格式化函数**

`formatOperatorClose` 要求 `evidence.length === 3`，每条非空，`reportPath` 以 `through-report.md` 结尾。否则抛错。

`pickEvidence` 从轨迹对象取，不接受模型自由发挥的步骤数：

1. `traj-final.json id=<id> actions=<去重 actionType 用逗号连接>`
2. 若有 `click_table_row_radio`：`click_table_row_radio row_text=<paramsJson.row_text>`；否则 `doneLogs=<第一段 doneLog 前 80 字>`
3. 证据目录里编号最大的 `poll-*.json` 对应 `done=<doneCount>/<phaseCount>`；没有 poll 文件则 `detach.json detached=<true|false>`

- [ ] **Step 3: 工具 `write_through_report`**

只允许 phase 为 `Done`。再 `GET /api/v2/trajectories/:id` 写入 `traj-final.json`（覆盖模型可能写过的摘要）。用这次 GET 的结果调用 `pickEvidence` 和 `conclusionFromAssert`。`productLabel` 用 `workflow.inputs.productLabel`，没有就用 `steps`。

写 `through-report.md`，至少包含：轨迹 id、结论、阶段表（id、status、doneLog 前 400 字）、`pickEvidence` 的三行。再写 `close.txt` 为 `formatOperatorClose` 的返回值。工具返回 `{ ok: true, closeMessage }`，`closeMessage` 与 `close.txt` 字节级一致。

插件描述写明：模型的最后一条消息必须与 `closeMessage` 完全相同，不能再加「8 步全通」这类自行计数。

- [ ] **Step 4: 跑 pin**

Run: `node scripts/characterization/cold/characterize-recording-coach-operator.mjs && node --check tools/recording-coach/src/tools.mjs && node --check tools/recording-coach/src/opencode-plugin.mjs`

Expected: pin OK，两个 `--check` 退出码 0。

- [ ] **Step 5: Commit（仅当用户要求）**

```bash
git add tools/recording-coach/src/close-contract.mjs tools/recording-coach/src/tools.mjs tools/recording-coach/src/opencode-plugin.mjs scripts/characterization/cold/characterize-recording-coach-operator.mjs
git commit -m "$(cat <<'EOF'
feat(coach): 收尾固定为结论、报告路径和三条证据

模型自写的摘要会把步骤数说错；契约改由工具从落库生成。
EOF
)"
```

---

### Task 6: 输入编排门闩（任务书与业务 task 分开）

**Files:**
- Modify: `tools/recording-coach/src/workflow.mjs`（`emptyWorkflow`）
- Modify: `tools/recording-coach/src/tools.mjs`
- Modify: `tools/recording-coach/src/opencode-plugin.mjs`
- Modify: `scripts/characterization/cold/characterize-recording-coach-operator.mjs`

**Interfaces:**
- Produces: `assertDispatchBrief(text) → true`
- `emptyWorkflow` 增加：`dispatchBriefPath: null`、`preflight: null`、`acceptedPhases: null`、`cdpChecked: false`、`inputs.businessProbeRequired: false`、`inputs.productLabel: ''`
- 新工具：`save_dispatch_brief`、`preflight_readonly`、`accept_phases`
- `create_trajectory` 不再在内部调用 `analyze_trajectory`

`assertDispatchBrief` 要求正文同时含这五个标题：`固定参数`、`业务目标`、`风险预告`、`管线步骤`、`产出契约`。缺一个就抛 `dispatch brief missing heading: <名>`。

`mark_inputs_ready` 额外拒绝：`taskText` 不含 `【硬性成功门闩`；trim 后长度小于 80；正文含 `POST /api/v2` 或 `curl`。错误文案：`taskText must be the business gate, not the operator runbook`。

`create_trajectory` 在组 body 之前拒绝，且不推进 phase：

- `!w.preflight?.ok` → `preflight required`
- `!w.dispatchBriefPath` → `dispatch brief required`
- `!Array.isArray(w.acceptedPhases) || w.acceptedPhases.length === 0` → `accept_phases required`
- `w.acceptedPhases.length > 10` → `phase count must be <= 10`

phases 只用 `w.acceptedPhases`。模型传入的 `args.phases` 忽略。

- [ ] **Step 1: pin `assertDispatchBrief`**

函数放在 `tools/recording-coach/src/dispatch-brief.mjs` 并导出。pin 只引这个文件，不要引 `tools.mjs`（那会拉 HTTP）。

```js
import { assertDispatchBrief } from '../../../tools/recording-coach/src/dispatch-brief.mjs';

const brief = ['固定参数', '业务目标', '风险预告', '管线步骤', '产出契约'].join('\n');
assert.equal(assertDispatchBrief(brief), true);
assert.throws(() => assertDispatchBrief('只有业务目标'), /dispatch brief missing heading: 固定参数/);
```

- [ ] **Step 2: 实现三个工具**

`save_dispatch_brief({ text })`：phase 必须是 `CollectInputs` 或 `ReadyToCreate`。校验通过后写 `dispatch-brief.md`，设 `w.dispatchBriefPath`。不改 phase。

`preflight_readonly({ probes })`：phase 必须是 `ReadyToCreate`。

- 调已有 `list_executors`。没有 `connected && inUse < capacity` 的节点 → 写 `preflight.json`，`ok: false`，抛 `BLOCKED_无空闲槽位`。
- `probes` 每项是 `{ label, path }`。`path` 不以 `/api/v2/` 开头就抛 `probe path must start with /api/v2/`。只 `GET`。
- `inputs.businessProbeRequired === true` 且 `probes` 为空 → 抛 `BLOCKED_前置未核`，`preflight.ok` 保持 false。
- 任一 probe 的 HTTP 状态不是 200 → `ok: false`，抛 `BLOCKED_前置未核`。
- 通过则 `w.preflight = { ok: true, at: ISO 时间 }`，写 `preflight.json`（含 executors 摘要和 probe 响应）。

`accept_phases()`：phase 必须是 `ReadyToCreate`。读 `analyze.json`，取 `unwrap` 后的 `phases`。0 条或超过 10 条抛错。任一条 `description` trim 后短于 20 字抛 `phase description too short`。通过则 `w.acceptedPhases = phases`。不在这里生成数字 id；数字 id 到 create 之后的 GET 才有。

- [ ] **Step 3: 语法检查与 pin**

Run: `node scripts/characterization/cold/characterize-recording-coach-operator.mjs && node --check tools/recording-coach/src/tools.mjs`

Expected: pin OK。

- [ ] **Step 4: Commit（仅当用户要求）**

```bash
git add tools/recording-coach/src/dispatch-brief.mjs tools/recording-coach/src/workflow.mjs tools/recording-coach/src/tools.mjs tools/recording-coach/src/opencode-plugin.mjs scripts/characterization/cold/characterize-recording-coach-operator.mjs
git commit -m "$(cat <<'EOF'
feat(coach): 建单前必须完成任务书、前置核查和阶段接受

业务 task 不再携带 API 步骤，避免录制引擎把 curl 当页面操作。
EOF
)"
```

---

### Task 7: CDP 预检

**Files:**
- Create: `tools/recording-coach/src/cdp-precheck.mjs`
- Modify: `tools/recording-coach/src/tools.mjs`
- Modify: `tools/recording-coach/src/opencode-plugin.mjs`

**Interfaces:**
- Consumes: `wf.cdpPort`（Task 3）
- Produces: `cdpPrecheck({ port, evidenceDir, needles }) → { dialogs: string[], closed: string[] }`
- 新工具 `cdp_precheck`：phase 必须是 `Prepared`。成功后 `w.cdpChecked = true`，写 `cdp-precheck.json`。
- `start_record` 在 POST 之前若 `wf.cdpChecked !== true` 则抛 `cdp precheck required`，不进入 Recording。

行为从 wet8 的 `cdp-precheck.mjs` 搬来，但改成导出函数，不读 `process.argv`。`needles` 默认就是 Global Constraints 里的四条。页面上没有这些针时返回空 `closed`，仍然算检查过。不要按 ESC 去关未知弹窗。不要关闭标题含「选择客户」的对话框。

实现用全局 `WebSocket` 连 `http://127.0.0.1:<port>/json` 里第一个 `type === 'page'` 的 `webSocketDebuggerUrl`。`Runtime.evaluate` 在页面里只点击匹配针的对话框关闭按钮。评价脚本失败时抛错，不要把 `cdpChecked` 设为 true。

此任务没有无浏览器的 pin。不要为了验证去连用户正在用的执行机。

- [ ] **Step 1: 写 `cdp-precheck.mjs` 并导出 `cdpPrecheck`**

关闭脚本只遍历默认四针。找到可见的 `.el-dialog` / `.el-drawer` / `.el-message-box`，其 `innerText` 含针，且不含 `选择客户`，再点其中 class 含 `headerbtn` 或 `close-btn`、或文字为 `关闭`/`取消` 的按钮。

- [ ] **Step 2: 接工具**

`cdp_precheck` 使用 `wf.cdpPort`。端口不是正整数就抛 `cdp port missing`。`start_record` 增加 `cdpChecked` 检查，放在 `applyToolSuccess(..., 'start_record')` 之前，避免未预检就进入 Recording。

- [ ] **Step 3: 语法检查**

Run: `node --check tools/recording-coach/src/cdp-precheck.mjs && node --check tools/recording-coach/src/tools.mjs`

Expected: 退出码 0。

- [ ] **Step 4: Commit（仅当用户要求）**

```bash
git add tools/recording-coach/src/cdp-precheck.mjs tools/recording-coach/src/tools.mjs tools/recording-coach/src/opencode-plugin.mjs
git commit -m "$(cat <<'EOF'
feat(coach): 开录前按 prepare 端口做 CDP 弹窗预检

不清已知遮挡弹窗时，录制引擎第一步就会被挡住。
EOF
)"
```

---

### Task 8: 把草稿吸进 skill

**Files:**
- Modify: `tools/recording-coach/skill/SKILL.md`
- Modify: `tools/recording-coach/README.md`（只加一小节「操作员顺序」）

**Interfaces:**
- Consumes: 工具名 `save_dispatch_brief`、`preflight_readonly`、`analyze_trajectory`、`accept_phases`、`create_trajectory`、`prepare_record`、`cdp_precheck`、`start_record`、`detach_trajectory`、`assert_steps`、`write_through_report`
- 不产生新的代码导出

保留现有 STC 锚点（functionId `9000000011`、客户 `26080511161570617`、`click_table_row_radio` + `row_text=first`）。删掉「约 5 秒轮询」如果 skill 里有；父 skill 正文没有这句就不要编造。

用草稿改写 skill 时必须写清这几条，原文标题保留：

1. 三个角色：编排者、操作员、录制引擎。本 coach 进程是操作员。它不打开浏览器做业务点击，不 git commit，不改仓库。
2. 用户输入先写成两份文本。`taskText` 给录制引擎：硬性门闩、禁区、关键数据、编号步骤，每阶段一个判据。`dispatch-brief.md` 五段：固定参数、业务目标、风险预告、管线步骤、产出契约。五段里可以写 API 路径；`taskText` 里禁止出现。
3. 调用顺序就是 Task 6 的工具顺序，然后 Task 7、Task 2 的 start、detach、assert、`write_through_report`。`create_trajectory` 的参数必须是 `{}`。
4. 派发前：槽位、控制面 GET 成功、业务前置。任务提到评级是否生效、在途授信、客户池时，设 `businessProbeRequired: true` 并给出 `/api/v2/` 的 GET。不知道查哪条 API 就停，结论 `BLOCKED_前置未核`，禁止开单。
5. 诚实失败：服务端拒绝原文加流水号记在 doneLogs 里就是合法终局，结论 `REJECTED_`。禁止再录一单，除非用户本回合明确要求。
6. 最后一条助手消息必须与 `close.txt` 完全相同。没有报告路径和三条证据就不算收工。
7. 值守：工具每 60 秒写 `poll-N.json`；操作员不在轮询间隙改页面或改任务。总长 40 分钟。

README 用十行列出上述工具顺序、两个超时（prepare 600 秒、start 40 分钟）和收尾文件名 `through-report.md`、`close.txt`。

- [ ] **Step 1: 改 SKILL.md 与 README.md**

不要把 `JS-gen-contract` 的 through-report 全文贴进来。可以写「行为对照见合约仓 tmp/contract-wet7 与 wet8，只读」。

- [ ] **Step 2: 自查标题都在**

Run（PowerShell）:

```powershell
$p = 'tools/recording-coach/skill/SKILL.md'
foreach ($s in @('固定参数','业务目标','风险预告','管线步骤','产出契约','BLOCKED_前置未核','close.txt','60','40')) {
  if (-not (Select-String -Path $p -Pattern $s -Quiet)) { throw "missing $s" }
}
```

Expected: 无输出、退出码 0。

- [ ] **Step 3: Commit（仅当用户要求）**

```bash
git add tools/recording-coach/skill/SKILL.md tools/recording-coach/README.md
git commit -m "$(cat <<'EOF'
docs(coach): 吸收湿测派发草稿到操作员 skill

任务书、前置核查、诚实失败和收尾契约不再只留在合约仓。
EOF
)"
```

---

## 覆盖核对

| 需求 | 任务 |
|------|------|
| 按输入自行编排录制任务 | Task 6 把五段式任务书和业务 task 分开，create 不能跳过 analyze 接受 |
| 按湿测提示词录制 | Task 3 的 ready 与数字 phaseId，Task 7 的 CDP，Task 8 的 skill |
| 60 秒快照、盯 done/doneLogs、40 分钟 | Task 1、Task 2 |
| 结论一行 + 报告路径 + 三条证据 | Task 5 |
| 吸收草稿且不回写 | Task 8；约束里禁止写 `JS-gen-contract` |

不做的事：直连 MySQL；只读核查员单独再开一个 OpenCode 进程；本计划执行时不跑真机湿测。真机要等用户点名，并且不得 detach 别人的轨迹。

## 执行注意

Task 1 的 pin 文件在 Task 3、5、6 继续往里加断言。后一个任务开始时先读该文件，不要整文件覆盖。新增的 `import` 放在文件顶部，新断言放在最后一行 `console.log` 之前。
