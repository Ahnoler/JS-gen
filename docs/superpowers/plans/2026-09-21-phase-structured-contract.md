# 阶段结构元数据（方案 D · 第 2 刀）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分析拆阶段时把 `mode` / `refill` / `submitRequired` / `successWhen` 写入 `trajectory_phase.contract_json`，录制时原样下发；有效则执行机直接签 `_phase_intent` 与 `_phase_boundary`，不再按描述重编译。

**Architecture:** Node 与 Python 各有一份相同允许集的纯函数。分析响应仍返回 `phases: string[]`，合约走并行的 `phaseContracts`。录制 runner 只在合约有效时设置 `stepData.phase_contract`。执行机在 reviewer 之前消费该字段；缺失或非法则走今天的 reviewer + `compile_boundary` 路径。

**Tech Stack:** Node ESM、Knex 迁移、Python 阶段合约（`intent_contract.py`）、characterization pin、`verify-all.sh` 的 phase 域。

**Spec:** [`../specs/2026-09-21-phase-structured-contract-design.md`](../specs/2026-09-21-phase-structured-contract-design.md)

## Global Constraints

- 有效合约在场时，执行机不调用 `compile_boundary`、`compile_phase_intent`、`review_phase_contract`、`_apply_cross_phase_token_guard`。
- 合约缺失、解析失败或字段不在允许集内时，整份丢弃，行为与今天的文本分类路径一致。
- 不回填历史行。`contract_json` 为空的旧轨迹走兜底。
- 不改 `phase_done_ok` 语义，不改令牌种类，不实现核验型阶段主收口，不启用 `mode=verify`。
- 不把运行时编译器搬到 Node，也不在录制前用文本规则预编译再存。
- 用户改写阶段描述（文本与原描述不同）时，该行 `contract_json` 置 `NULL`。描述未变则保留。
- 对外分析响应保持 `phases: string[]`。合约在等长的 `phaseContracts` 里，`null` 表示兜底。
- `heal_mode` 为真时忽略 `phase_contract`。
- `scripts/agent/service.py` 在 E1–E4（`engine/replay-cancel-20260921`）合入 `uara_V2.0` 之前不改。Task 7 开始前必须确认这一点。
- 用户没要求就不要 commit。下面的 commit 步是检查点，默认跳过。
- 中文 commit message（若用户要求提交）。新代码公开函数带 JSDoc（`@param` / `@returns`），不加 `@author`。
- 新 pin 登记 `scripts/refactor/verify-all.sh` 的 `PINS_PHASE`。

## File map

| Path | Role |
|------|------|
| `src/services/trajectory/phase-contract.js` | **新建**：允许集与 `normalizePhaseContract` |
| `scripts/characterization/characterize-phase-contract.mjs` | **新建**：Node 允许集 + 解析 pin |
| `migrations/20260921120000_phase_contract_json.js` | **新建**：可空 `contract_json` |
| `schemas/init.sql` | `trajectory_phase` 增加同列 |
| `src/dao/trajectory-phase-dao.js` | 读出时解析 `contractJson`；写入时 JSON 序列化 |
| `src/services/trajectory/trajectory-phase-service.js` | 描述变化清空合约 |
| `src/services/trajectory/trajectory-meta-service.js` | 提示词、解析对象阶段、`phaseContracts`、创建时写入 |
| `src/services/trajectory/trajectory-recording-runner.js` | `stepData.phase_contract` |
| `src/dashboard/api-docs/groups/trajectory.js` | 补可选字段说明 |
| `scripts/controller/actions/phase/phase_contract_snapshot.py` | **新建**：Python 允许集与 `apply_persisted_phase_contract` |
| `scripts/characterization/characterize-persisted-phase-contract.py` | **新建**：持久化签合同 pin |
| `scripts/agent/service.py` | Task 7：有效快照走持久化应用 |
| `scripts/refactor/verify-all.sh` | 登记两条 pin |

---

### Task 1: Node 允许集

**Files:**
- Create: `src/services/trajectory/phase-contract.js`
- Create: `scripts/characterization/characterize-phase-contract.mjs`
- Modify: `scripts/refactor/verify-all.sh`（`PINS_PHASE` 末尾追加一行；Task 6 再追加 Python 那行）

**Interfaces:**
- Consumes: 无
- Produces: `normalizePhaseContract(raw: unknown) => object | null`。成功时返回 `{ v: 1, mode, refill, submitRequired, successWhen, source: 'analyze' }`。

- [ ] **Step 1: 写失败 pin**

`scripts/characterization/characterize-phase-contract.mjs`：

```javascript
import { normalizePhaseContract } from '../../src/services/trajectory/phase-contract.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const nav = normalizePhaseContract({
  v: 1,
  mode: 'navigate',
  refill: 'none',
  submitRequired: false,
  successWhen: ['url_change', 'page_opened', 'url_change'],
  source: 'analyze',
});
assert(nav && nav.mode === 'navigate', 'navigate kept');
assert(nav.successWhen.join(',') === 'url_change,page_opened', 'kinds deduped, order kept');

assert(normalizePhaseContract({ v: 1, mode: 'verify', refill: 'none', submitRequired: false, successWhen: [], source: 'analyze' }) === null, 'verify rejected');
assert(normalizePhaseContract({ v: 1, mode: 'create', refill: 'all_editable', submitRequired: true, successWhen: ['not_a_kind'], source: 'analyze' }) === null, 'unknown kind rejected');
assert(normalizePhaseContract({ v: 1, mode: 'query', refill: 'all_editable', submitRequired: false, successWhen: ['query_clicked'], source: 'analyze' }) === null, 'refill only on create/modify');
assert(normalizePhaseContract({ v: 1, mode: 'navigate', refill: 'none', submitRequired: true, successWhen: ['page_opened'], source: 'analyze' }) === null, 'submitRequired only on create/modify/introduce_pick');
assert(normalizePhaseContract({ v: 2, mode: 'other', refill: 'none', submitRequired: false, successWhen: [], source: 'analyze' }) === null, 'version rejected');
assert(normalizePhaseContract(null) === null, 'null rejected');

const fill = normalizePhaseContract({
  v: 1, mode: 'create', refill: 'all_editable', submitRequired: false, successWhen: [], source: 'analyze',
});
assert(fill && fill.successWhen.length === 0, 'empty kinds allowed');

console.log('characterize-phase-contract OK');
```

- [ ] **Step 2: 跑 pin，确认失败**

Run: `node scripts/characterization/characterize-phase-contract.mjs`

Expected: FAIL，`Cannot find module ... phase-contract.js`

- [ ] **Step 3: 实现 `normalizePhaseContract`**

`src/services/trajectory/phase-contract.js`：

```javascript
/** 方案 D v1 允许的 mode。 */
export const PHASE_CONTRACT_MODES = Object.freeze([
  'login', 'query', 'navigate', 'create', 'modify', 'introduce_pick', 'other',
]);

/** 方案 D v1 允许的 successWhen 令牌。 */
export const PHASE_CONTRACT_KINDS = Object.freeze([
  'toast_ok', 'url_change', 'saved_navigation', 'query_clicked', 'page_opened',
  'nav_next_clicked', 'picker_closed', 'confirm_click', 'dialog_confirmed',
  'introduced_backfilled',
]);

const SUBMIT_MODES = new Set(['create', 'modify', 'introduce_pick']);

/**
 * 校验并归一化阶段合约。非法则返回 null，不抛错。
 * @param {unknown} raw 分析模型或库中的合约对象
 * @returns {{ v: 1, mode: string, refill: 'none'|'all_editable', submitRequired: boolean, successWhen: string[], source: 'analyze' } | null}
 */
export function normalizePhaseContract(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Number(raw.v) !== 1) return null;
  if (raw.source !== 'analyze') return null;
  const mode = raw.mode;
  if (!PHASE_CONTRACT_MODES.includes(mode)) return null;
  const refill = raw.refill;
  if (refill !== 'none' && refill !== 'all_editable') return null;
  if (refill === 'all_editable' && mode !== 'create' && mode !== 'modify') return null;
  if (typeof raw.submitRequired !== 'boolean') return null;
  if (raw.submitRequired && !SUBMIT_MODES.has(mode)) return null;
  if (!Array.isArray(raw.successWhen)) return null;
  const successWhen = [];
  for (const kind of raw.successWhen) {
    if (!PHASE_CONTRACT_KINDS.includes(kind)) return null;
    if (!successWhen.includes(kind)) successWhen.push(kind);
  }
  return { v: 1, mode, refill, submitRequired: raw.submitRequired, successWhen, source: 'analyze' };
}
```

- [ ] **Step 4: 跑 pin，确认通过**

Run: `node scripts/characterization/characterize-phase-contract.mjs`

Expected: `characterize-phase-contract OK`

- [ ] **Step 5: 登记 phase 域**

在 `PINS_PHASE` 最后一条后追加：

```
characterize-phase-contract|node scripts/characterization/characterize-phase-contract.mjs
```

Run: `bash scripts/refactor/verify-all.sh phase` 中至少能看到该 pin 被调度（本任务只要求单 pin 绿；全量 phase 域若有他线红，记录名字，不在本任务里改）。

- [ ] **Step 6: Commit（仅用户要求时）**

```bash
git add src/services/trajectory/phase-contract.js scripts/characterization/characterize-phase-contract.mjs scripts/refactor/verify-all.sh
git commit -m "$(cat <<'EOF'
feat(trajectory): 阶段合约允许集校验

分析侧持久化合约前先拒绝非法 mode、令牌与 refill/submit 组合，避免录制时把坏合同当成权威。

EOF
)"
```

---

### Task 2: 落库列与描述失效

**Files:**
- Create: `migrations/20260921120000_phase_contract_json.js`
- Modify: `schemas/init.sql`（`trajectory_phase.description` 行后）
- Modify: `src/dao/trajectory-phase-dao.js`（`parseCandidates`、`update`）
- Modify: `src/services/trajectory/trajectory-phase-service.js`（`upsertPhaseDescription` 约 38–45 行；`syncTrajectoryPhaseDescriptions` 约 371–377 行）
- Modify: `scripts/characterization/characterize-phase-contract.mjs`（追加源码针）

**Interfaces:**
- Consumes: `normalizePhaseContract`
- Produces: 列 `trajectory_phase.contract_json`；实体字段 `contractJson`（对象或 null）。描述文本变化的更新把该列置 NULL。

- [ ] **Step 1: 迁移与 init.sql**

`migrations/20260921120000_phase_contract_json.js`：

```javascript
/**
 * trajectory_phase.contract_json — 分析侧签下的阶段合约（方案 D v1）。空则录制时走文本分类。
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('trajectory_phase'))) return;
  if (await knex.schema.hasColumn('trajectory_phase', 'contract_json')) return;
  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.json('contract_json').nullable()
      .comment('阶段合约 v1 {v,mode,refill,submitRequired,successWhen,source}；空则录制兜底');
  });
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('trajectory_phase'))) return;
  if (!(await knex.schema.hasColumn('trajectory_phase', 'contract_json'))) return;
  await knex.schema.alterTable('trajectory_phase', (t) => {
    t.dropColumn('contract_json');
  });
}
```

`schemas/init.sql` 的 `description` 列后加：

```sql
  `contract_json`  JSON NULL COMMENT '阶段合约 v1 {v,mode,refill,submitRequired,successWhen,source}；空则录制兜底',
```

- [ ] **Step 2: DAO 读出解析、写入序列化**

在 `parseCandidates` 里、`doneLogs` 解析之前：

```javascript
  const contractRaw = obj.contractJson;
  if (contractRaw != null && typeof contractRaw === 'string') {
    try {
      obj.contractJson = JSON.parse(contractRaw);
    } catch {
      obj.contractJson = null;
    }
  }
```

在 `update` 里、`doneLogs` 分支旁：

```javascript
  if ('contractJson' in fields || 'contract_json' in fields) {
    const raw = fields.contractJson ?? fields.contract_json ?? null;
    patch.contract_json = raw == null || typeof raw === 'string' ? raw : JSON.stringify(raw);
    delete patch.contractJson;
  }
```

`create` 走 `toDbRow`。若 `toDbRow` 不会把对象收成 JSON 字符串，在 `create` 插入前对 `data.contractJson` 做同样的 stringify（对象 → `JSON.stringify`，已是字符串则原样）。不要改 `toDbRow` 的全局行为。

- [ ] **Step 3: 描述一变就清合约**

`upsertPhaseDescription` 的 existing 分支，`update({...})` 改为：

```javascript
      const patch = {
        description: desc,
        status: 'running',
        completed_at: null,
      };
      if (String(existing.description || '') !== desc) patch.contract_json = null;
      await db('trajectory_phase').where({ id: existing.id }).update(patch);
```

`syncTrajectoryPhaseDescriptions` 里更新已有行的 `update({...})` 改为：

```javascript
        const patch = {
          description,
          phase_number: phaseNumber,
          special_element_candidates_json: candidatesJson,
        };
        if (String(phaseRow.description || '') !== description) patch.contract_json = null;
        await db('trajectory_phase').where({ id: phaseRow.id }).update(patch);
```

新插入的行不带合约（这两条路径不是分析创建）。

- [ ] **Step 4: 源码针**

在 `characterize-phase-contract.mjs` 末尾、`console.log` 之前读文件并断言：

```javascript
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const phaseSvc = readFileSync(join(root, 'src/services/trajectory/trajectory-phase-service.js'), 'utf8');
assert(phaseSvc.includes('patch.contract_json = null'), 'description change clears contract');
const initSql = readFileSync(join(root, 'schemas/init.sql'), 'utf8');
assert(initSql.includes('contract_json'), 'init.sql has contract_json');
```

Run: `node scripts/characterization/characterize-phase-contract.mjs`

Expected: `characterize-phase-contract OK`

- [ ] **Step 5: Commit（仅用户要求时）**

```bash
git add migrations/20260921120000_phase_contract_json.js schemas/init.sql src/dao/trajectory-phase-dao.js src/services/trajectory/trajectory-phase-service.js scripts/characterization/characterize-phase-contract.mjs
git commit -m "$(cat <<'EOF'
feat(trajectory): 阶段合约落库，改描述即作废

contract_json 只保存分析时签下的合同；描述被改写后清空，避免按旧措辞继续当权威。

EOF
)"
```

---

### Task 3: 分析输出 phaseContracts

**Files:**
- Modify: `src/services/trajectory/trajectory-meta-service.js`（`parseAnalyzePayload` 约 84–133 行；提示词「输出必须是严格 JSON」之前；`analyzeRequirementToPhases` 返回值约 296–310 行）
- Modify: `scripts/characterization/characterize-phase-contract.mjs`

**Interfaces:**
- Consumes: `normalizePhaseContract`
- Produces: `parseAnalyzePayload(raw) => { phases: Array<{ description: string, contract: object|null }> }`；`analyzeRequirementToPhases` 返回 `{ phases: string[], phaseContracts: Array<object|null>, businessEntries }`，两数组等长。

- [ ] **Step 1: 先改 pin，再改解析（pin 先红）**

在 pin 里动态 import `parseAnalyzePayload`（它已 `export`）：

```javascript
import { parseAnalyzePayload } from '../../src/services/trajectory/trajectory-meta-service.js';

const legacy = parseAnalyzePayload('{"phases":["点击菜单。预期结果：抵达列表。"]}');
assert(legacy.phases.length === 1 && legacy.phases[0].description.includes('点击菜单'), 'string phase kept');
assert(legacy.phases[0].contract === null, 'string phase has no contract');

const obj = parseAnalyzePayload(JSON.stringify({
  phases: [{
    description: '点击【引入】。预期结果：打开客户选择窗口。',
    mode: 'navigate', refill: 'none', submitRequired: false,
    successWhen: ['url_change', 'page_opened'],
  }, { description: '', mode: 'other' }],
}));
assert(obj.phases.length === 1, 'empty description dropped');
assert(obj.phases[0].contract && obj.phases[0].contract.mode === 'navigate', 'object contract normalized');

const bad = parseAnalyzePayload(JSON.stringify({
  phases: [{ description: '填写名称。预期结果：填写完成。', mode: 'verify', refill: 'none', submitRequired: false, successWhen: [] }],
}));
assert(bad.phases.length === 1 && bad.phases[0].contract === null, 'bad mode keeps description, drops contract');
```

此时 `parseAnalyzePayload` 仍把元素 `String()` 掉，对象阶段的 description 会变成 `"[object Object]"`，pin 失败。

- [ ] **Step 2: 解析两种元素**

用 `normalizePhaseContract`。字符串元素 → `{ description, contract: null }`。对象元素取 `description`，合约字段交给 `normalizePhaseContract({ v: 1, mode, refill, submitRequired, successWhen, source: 'analyze' })`。`description` 空白则丢弃该元素。容错抽取 `extractPhaseElementsLoose` 的字符串结果同样包成 `contract: null`。

`analyzeRequirementToPhases` 里现有的三条 `filter` 改滤 `row.description`。返回：

```javascript
  return {
    phases: phases.map((row) => row.description),
    phaseContracts: phases.map((row) => row.contract),
    businessEntries: extractBusinessEntriesFromRequirement(desc),
  };
```

更新该函数的 JSDoc `@returns`。

- [ ] **Step 3: 提示词增加合约字段**

在「输出必须是严格 JSON」之前插入下面整段（不要改规则 1–10 与 3.1 的原文）：

```
【阶段合约 — 与描述一起输出】
每个阶段是对象，不是纯字符串。description 仍遵守上文全部规则。另外给出 mode、refill、submitRequired、successWhen，取值只能来自下面对照，禁止发明：
- 仅打开选择器/弹窗/页面 → mode=navigate，refill=none，submitRequired=false，successWhen=["url_change","page_opened"]
- 纯填写/选择且保存或确认在后续阶段 → mode=create 或 modify，refill=all_editable，submitRequired=false，successWhen=[]
- 本阶段确有保存/确认 → mode=create 或 modify，refill=all_editable，submitRequired=true，successWhen=["toast_ok","url_change"]
- 查询 → mode=query，refill=none，submitRequired=false，successWhen=["query_clicked"]
- 引入并在本阶段确认或回填 → mode=introduce_pick，refill=none，submitRequired=true，successWhen 从 picker_closed、confirm_click、dialog_confirmed、introduced_backfilled 里点名，至少一个
- 登录 → mode=login，refill=none，submitRequired=false，successWhen=[]
- 其余 → mode=other，refill=none，submitRequired=false，successWhen=[]
```

把「格式：{"phases":[...字符串...]}」改成：

```
格式：{"phases":[{"description":"…一行…","mode":"navigate","refill":"none","submitRequired":false,"successWhen":["url_change","page_opened"]}]}。
```

示例 1–8 的 JSON 不必逐条改成对象（解析器仍接受字符串）。不要把活模型输出钉进 pin。

- [ ] **Step 4: 跑 pin**

Run: `node scripts/characterization/characterize-phase-contract.mjs`

Expected: `characterize-phase-contract OK`

- [ ] **Step 5: Commit（仅用户要求时）**

```bash
git add src/services/trajectory/trajectory-meta-service.js scripts/characterization/characterize-phase-contract.mjs
git commit -m "$(cat <<'EOF'
feat(trajectory): 分析拆阶段同时给出阶段合约

phases 仍是描述字符串；等长的 phaseContracts 在字段非法时为 null，录制再走文本分类。

EOF
)"
```

---

### Task 4: 创建轨迹时写入合约

**Files:**
- Modify: `src/services/trajectory/trajectory-meta-service.js`（`createTransactionWithPhases` 参数与约 455–472 行的 `trajectoryPhaseDao.create`）
- Modify: `scripts/characterization/characterize-phase-contract.mjs`（源码针）

**Interfaces:**
- Consumes: `normalizePhaseContract`；`trajectoryPhaseDao.create({ ..., contractJson })`
- Produces: `createTransactionWithPhases({ phases, phaseContracts })`。`phaseContracts[i]` 与 `phases[i]` 对齐；缺省、长度不够或非法 → 该阶段 `contractJson: null`。

- [ ] **Step 1: 源码针先红**

```javascript
const meta = readFileSync(join(root, 'src/services/trajectory/trajectory-meta-service.js'), 'utf8');
assert(meta.includes('phaseContracts'), 'create accepts phaseContracts');
assert(meta.includes('contractJson: normalizePhaseContract'), 'create normalizes before insert');
```

- [ ] **Step 2: 写入**

函数增加参数 `phaseContracts = []`。JSDoc 补 `@param {Array<object|null>} [opts.phaseContracts]`。

创建循环里，`parsed` 仍是描述字符串数组。对齐：

```javascript
      const rawContract = Array.isArray(phaseContracts) ? phaseContracts[i] : null;
      await trajectoryPhaseDao.create({
        phaseId: randomUUID(),
        phaseNumber: i + 1,
        trajectoryId: trajId,
        status: 'pending',
        description: parsed[i],
        specialElementCandidatesJson: candidates?.length ? JSON.stringify(candidates) : null,
        contractJson: normalizePhaseContract(rawContract),
      }, client);
```

文件顶部 import `normalizePhaseContract`。不要在 `phases` 元素是对象时再从元素上刮字段；只认 `phaseContracts`。

- [ ] **Step 3: 跑 pin**

Run: `node scripts/characterization/characterize-phase-contract.mjs`

Expected: OK

- [ ] **Step 4: Commit（仅用户要求时）**

```bash
git add src/services/trajectory/trajectory-meta-service.js scripts/characterization/characterize-phase-contract.mjs
git commit -m "$(cat <<'EOF'
feat(trajectory): 创建阶段时写入校验后的合约

phaseContracts 与 phases 按下标对齐，非法项存空，不让坏合同挡住建轨。

EOF
)"
```

---

### Task 5: 录制下发 phase_contract

**Files:**
- Modify: `src/services/trajectory/trajectory-recording-runner.js`（组 `stepData` 处，约 1069–1075 行，`instruction` 赋值之后）
- Modify: `scripts/characterization/characterize-phase-contract.mjs`

**Interfaces:**
- Consumes: 阶段行上的 `contractJson`（dao 已解析为对象或 null）；`normalizePhaseContract`
- Produces: 有效时 `stepData.phase_contract` 为归一化对象。无效或空时该字段不存在。

- [ ] **Step 1: 源码针**

```javascript
const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
assert(runner.includes('phase_contract'), 'runner forwards phase_contract');
assert(runner.includes('normalizePhaseContract'), 'runner re-validates before send');
```

- [ ] **Step 2: 下发**

在 `const stepData = { instruction, ... }` 之后：

```javascript
      const phaseContract = normalizePhaseContract(phase.contractJson);
      if (phaseContract) stepData.phase_contract = phaseContract;
```

顶部 import `normalizePhaseContract`。不要在无效时赋 `{}` 或 `null`。

- [ ] **Step 3: 跑 pin**

Run: `node scripts/characterization/characterize-phase-contract.mjs`

Expected: OK

- [ ] **Step 4: Commit（仅用户要求时）**

```bash
git add src/services/trajectory/trajectory-recording-runner.js scripts/characterization/characterize-phase-contract.mjs
git commit -m "$(cat <<'EOF'
feat(trajectory): 录制阶段下发已持久化的合约

有效 contract_json 才进入 stepData.phase_contract，空合约不占字段，执行机仍走文本分类。

EOF
)"
```

---

### Task 6: Python 持久化签合同

**Files:**
- Create: `scripts/controller/actions/phase/phase_contract_snapshot.py`
- Create: `scripts/characterization/characterize-persisted-phase-contract.py`
- Modify: `scripts/refactor/verify-all.sh`（`PINS_PHASE` 追加 Python pin）

**Interfaces:**
- Consumes: `apply_phase_contract` 不直接用（它会跑跨阶段守卫）。本任务自己写 store。
- Produces:
  - `normalize_phase_contract(raw) -> dict | None`
  - `apply_persisted_phase_contract(business_data_store, raw) -> dict | None`
  - 成功时 store 含 `_phase_intent`、`_phase_boundary`（`source=='persisted'`）、`_phase_intent_flag_locked=True`、`_phase_boundary_flag_locked=True`、`_task_mode`、`_evidence_observed=[]`

- [ ] **Step 1: 写失败 pin**

`scripts/characterization/characterize-persisted-phase-contract.py`：

```python
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scripts.controller.actions.phase.phase_contract_snapshot import (
    apply_persisted_phase_contract,
    normalize_phase_contract,
)

def check(cond, msg):
    if not cond:
        raise SystemExit(msg)

nav = {
    'v': 1, 'mode': 'navigate', 'refill': 'none', 'submitRequired': False,
    'successWhen': ['url_change', 'page_opened'], 'source': 'analyze',
}
assert normalize_phase_contract(nav)['mode'] == 'navigate'
assert normalize_phase_contract({**nav, 'mode': 'verify'}) is None

store = {}
# 描述含「引入」「确认」，若走文本编译会签 introduce_pick。持久化必须保持 navigate。
contract = apply_persisted_phase_contract(store, nav)
check(contract and contract['mode'] == 'navigate', 'mode stayed navigate')
check(store['_phase_boundary']['source'] == 'persisted', 'boundary source persisted')
check(store['_phase_boundary']['success_when'] == ['url_change', 'page_opened'], 'kinds from snapshot')
check(store['_phase_boundary']['role'] == 'navigate', 'role mapped')
check(store['_phase_intent']['submit']['required'] is False, 'submit false')
check('compile_boundary' not in (store.get('_phase_boundary') or {}).get('source', ''), 'not rules')

fill = {
    'v': 1, 'mode': 'create', 'refill': 'all_editable', 'submitRequired': False,
    'successWhen': [], 'source': 'analyze',
}
store2 = {}
apply_persisted_phase_contract(store2, fill)
check(store2['_phase_intent']['submit']['required'] is False, 'fill-only no submit')
check(store2['_phase_boundary']['success_when'] == [], 'fill-only no kinds')
check(store2['_task_mode'] == 'form_fill', 'create maps to form_fill')

store3 = {'sentinel': 1}
check(apply_persisted_phase_contract(store3, {**nav, 'mode': 'nope'}) is None, 'invalid returns None')
check(store3 == {'sentinel': 1}, 'invalid does not write store')

print('characterize-persisted-phase-contract OK')
```

- [ ] **Step 2: 跑 pin，确认失败**

Run: `python scripts/characterization/characterize-persisted-phase-contract.py`

Expected: FAIL，`ModuleNotFoundError` 或 import 错误。

- [ ] **Step 3: 实现**

`phase_contract_snapshot.py` 复制与 Node 相同的允许集（mode、kinds、refill 只许 create/modify、submitRequired 只许 create/modify/introduce_pick、`v==1`、`source=='analyze'`、kinds 去重保序）。

`apply_persisted_phase_contract`：

```python
_MODE_TO_ROLE = {
    'create': 'maintain', 'modify': 'maintain', 'query': 'query',
    'navigate': 'navigate', 'introduce_pick': 'introduce',
    'login': 'other', 'other': 'other',
}
# 与 intent_contract._MODE_TO_TASK 一致：navigate / introduce_pick 的 task_mode 都是 other。
_MODE_TO_TASK = {
    'create': 'form_fill', 'modify': 'form_modify', 'query': 'query',
    'login': 'login', 'navigate': 'other', 'introduce_pick': 'other', 'other': 'other',
}

def apply_persisted_phase_contract(business_data_store, raw):
    if business_data_store is None:
        return None
    doc = normalize_phase_contract(raw)
    if not doc:
        return None
    mode = doc['mode']
    submit_required = doc['submitRequired']
    via = 'any'
    if submit_required and mode in ('create', 'modify'):
        via = 'click_save'
    contract = {
        'mode': mode,
        'refill': doc['refill'],
        'submit': {'required': submit_required, 'via': via, 'button_text': ''},
        'success': {'kinds': list(doc['successWhen']), 'evidence': []},
        'source': 'persisted',
        'allow_form_assistant': doc['refill'] == 'all_editable' and mode in ('create', 'modify'),
    }
    boundary = {
        'role': _MODE_TO_ROLE.get(mode, 'other'),
        'requires_write_all_editable': doc['refill'] == 'all_editable',
        'goals': [],
        'success_when': list(doc['successWhen']),
        'task_mode': _MODE_TO_TASK.get(mode, 'other'),
        'source': 'persisted',
        'forbid_index_submit': mode in ('create', 'modify'),
        'picker_allowed': mode in ('create', 'modify', 'introduce_pick'),
    }
    business_data_store['_phase_intent'] = contract
    business_data_store['_phase_intent_flag_locked'] = True
    business_data_store['_phase_boundary'] = boundary
    business_data_store['_phase_boundary_flag_locked'] = True
    business_data_store['_task_mode'] = boundary['task_mode']
    business_data_store['_query_task'] = mode == 'query'
    business_data_store['_force_refill_all'] = boundary['requires_write_all_editable']
    business_data_store['_evidence_observed'] = []
    return contract
```

不要 import `compile_boundary` 或 `_apply_cross_phase_token_guard`。`_MODE_TO_ROLE` / `_MODE_TO_TASK` 与 `intent_contract.py` 里的同名表保持一致（`navigate` 与 `introduce_pick` 的 `_task_mode` 都是 `other`）。

- [ ] **Step 4: 跑 pin 并登记**

Run: `python scripts/characterization/characterize-persisted-phase-contract.py`

Expected: `characterize-persisted-phase-contract OK`

`PINS_PHASE` 追加：

```
characterize-persisted-phase-contract|"$PY" scripts/characterization/characterize-persisted-phase-contract.py
```

- [ ] **Step 5: Commit（仅用户要求时）**

```bash
git add scripts/controller/actions/phase/phase_contract_snapshot.py scripts/characterization/characterize-persisted-phase-contract.py scripts/refactor/verify-all.sh
git commit -m "$(cat <<'EOF'
feat(phase): 有效持久化合约直接写入阶段意图

不经文本编译和跨阶段守卫，避免录制时按描述重签本阶段产不出的令牌。

EOF
)"
```

---

### Task 7: 执行机接线（E1–E4 合入之后）

**Files:**
- Modify: `scripts/agent/service.py`（`_run_agent_step_prepare`，heal 判断之后、`review_phase_contract` 之前，约 237–299 行）
- Modify: `scripts/characterization/characterize-persisted-phase-contract.py`（源码针 + heal 忽略）

**Interfaces:**
- Consumes: `apply_persisted_phase_contract`
- Produces: `instruction.phase_contract` 或 `phaseContract` 有效、且非 heal 时，不再调用 reviewer / `compile_boundary`。日志含 `phase_contract=persisted`。

- [ ] **Step 0: 开工门**

读 `docs/superpowers/agent-log.md` 顶部。只有 E1–E4 已有收工条目且 `engine/replay-cancel-20260921` 已并入当前分支基线时才改 `service.py`。否则停在本任务，报告「接线待 E1–E4 收工」，不要改这个文件。

- [ ] **Step 1: 源码针**

```python
svc = (ROOT / 'scripts/agent/service.py').read_text(encoding='utf-8')
check('apply_persisted_phase_contract' in svc, 'service dispatches persisted contract')
check('phase_contract=persisted' in svc, 'log line present')
```

heal 行为用函数级断言，不启动浏览器。在 snapshot 模块加：

```python
def persisted_contract_from_instruction(instruction, heal_mode):
    if heal_mode:
        return None
    if not isinstance(instruction, dict):
        return None
    raw = instruction.get('phase_contract')
    if raw is None:
        raw = instruction.get('phaseContract')
    return raw
```

pin：

```python
from scripts.controller.actions.phase.phase_contract_snapshot import persisted_contract_from_instruction
check(persisted_contract_from_instruction({'phase_contract': nav}, True) is None, 'heal ignores snapshot')
check(persisted_contract_from_instruction({'phase_contract': nav}, False) == nav, 'non-heal returns raw')
```

- [ ] **Step 2: 接到现有分支**

在 `else:`（非 heal）里、`review_phase_contract` 之前：

```python
                from ..controller.actions.phase.phase_contract_snapshot import (
                    apply_persisted_phase_contract,
                    persisted_contract_from_instruction,
                )
                raw_snapshot = persisted_contract_from_instruction(instruction, heal_mode=False)
                persisted = apply_persisted_phase_contract(business_data_ref, raw_snapshot)
                if persisted:
                    contract = persisted
                    mode = business_data_ref.get('_task_mode') or 'other'
                    sys.stderr.write(
                        "phase_contract=persisted "
                        f"mode={persisted.get('mode')} "
                        f"submit={bool((persisted.get('submit') or {}).get('required'))} "
                        f"success_when={(business_data_ref.get('_phase_boundary') or {}).get('success_when')}\n"
                    )
                    sys.stderr.flush()
                else:
                    # 下面保持今天的 reviewed / apply_phase_intent 整段，缩进进这个 else
                    ...
```

把现有 `try: reviewed = await review_phase_contract` 到 `apply_phase_intent` 的整段移入 `else`。不要删 heal 分支。不要在 persisted 分支里调用 `compile_boundary`。

- [ ] **Step 3: 跑 pin**

Run: `python scripts/characterization/characterize-persisted-phase-contract.py`

Expected: OK

再跑：`python scripts/characterization/characterize-phase-reviewer.py` 与 `python scripts/characterization/cold/characterize-phase-boundary.py`

Expected: 与改前相同的通过（兜底路径未被改语义）。若失败，只修接线把兜底缩进弄坏的部分，不改编译器。

- [ ] **Step 4: Commit（仅用户要求时）**

```bash
git add scripts/agent/service.py scripts/controller/actions/phase/phase_contract_snapshot.py scripts/characterization/characterize-persisted-phase-contract.py
git commit -m "$(cat <<'EOF'
feat(agent): 录制阶段优先使用已持久化的合约

快照有效时跳过文本重签；缺失或 heal 仍走原来的 reviewer 与规则编译。

EOF
)"
```

---

### Task 8: API 文档一句

**Files:**
- Modify: `src/dashboard/api-docs/groups/trajectory.js`（分析接口 desc，约 22 行；创建接口 phases 说明，约 85 行；详情 phases 说明，约 107 行）

**Interfaces:**
- Consumes: 响应字段 `phaseContracts`、阶段实体 `contractJson`
- Produces: `/api/docs` 文案与实现一致

- [ ] **Step 1: 补三处句子**

分析接口 `desc` 末尾追加：`可选 phaseContracts 与 phases 等长；元素为合约 v1 或 null（null 表示录制时按描述分类）。`

创建接口 `desc` 末尾追加：`可选 phaseContracts 与 phases 按下标对齐写入 trajectory_phase.contract_json。`

详情 `desc` 末尾追加：`phases[].contractJson 为分析时签下的合约或 null。`

不改示例 JSON 里的 phases 字符串数组。

- [ ] **Step 2: 源码针**

在 `characterize-phase-contract.mjs` 断言 `trajectory.js` 含 `phaseContracts` 与 `contractJson`。

Run: `node scripts/characterization/characterize-phase-contract.mjs`

Expected: OK

- [ ] **Step 3: 域验收**

Run: `bash scripts/refactor/verify-all.sh phase`

Expected: 本计划新增的两条 pin 为绿。他线既有红记在收工说明里，不在本计划里放宽。

- [ ] **Step 4: Commit（仅用户要求时）**

```bash
git add src/dashboard/api-docs/groups/trajectory.js scripts/characterization/characterize-phase-contract.mjs
git commit -m "$(cat <<'EOF'
docs(api): 说明阶段合约 phaseContracts 与 contractJson

分析与创建可以带等长合约；空值表示录制仍按阶段描述分类。

EOF
)"
```

---

## Spec coverage

| Spec | Task |
|------|------|
| §4 形状与允许集 | Task 1、Task 6 |
| §5 分析产出、字符串兼容、`phaseContracts` | Task 3 |
| §6 列、创建写入、描述变更清空 | Task 2、Task 4 |
| §7 runner 省略无效字段 | Task 5 |
| §8 执行机跳过编译 / reviewer / 守卫；heal 忽略 | Task 6、Task 7 |
| §9 行为对照 | Task 1 pin、Task 6 pin、Task 7 heal |
| §10 登记 verify-all | Task 1、Task 6 |
| §11 api-docs | Task 8 |
| §12 `service.py` 等 E1–E4 | Task 7 Step 0 |
| §13 非法值丢弃、不钉活模型输出 | Task 1、Task 3 |

不在计划内：湿测、重启 4097、核验型阶段主收口、历史回填。
