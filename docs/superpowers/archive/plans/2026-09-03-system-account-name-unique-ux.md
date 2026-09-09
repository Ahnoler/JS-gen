# 系统账号角色名唯一约束 A+B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 系统节点 `accounts[]` 同步时，包内重名与交叉占用在写库前用中文 400 拒绝；DB 唯一键失败映射为中文 409，不再返回 SQL。

**Architecture:** 在 `hierarchy-service.js` 抽出可单测的 `assertAccountNamesAvailable(existing, resolvedTargets)`；`normalizeSystemAccounts` 统一包内重名文案；`syncSystemAccounts` 在 update/create 前调用预检，并对 `ER_DUP_ENTRY`/`errno===1062` 兜底为 `CONFLICT`。不做自动交换。

**Tech Stack:** Node ESM、knex/mysql2 错误码、characterization（`node` 离线断言 + `readFileSync` pin）。

## Global Constraints

- 唯一约束 `(system_id, name)` **保留**；不做临时名中转 / 自动 swap
- 包内重名与交叉占用：`code: 'VALIDATION'` → HTTP 400
- DB 唯一键兜底：`code: 'CONFLICT'` → HTTP 409
- 文案必须与 spec 一致（见各 Task）；**禁止**把 `err.sql` / knex 原文写入 `Error.message`
- 名称比较：`String(name||'').trim().toLocaleLowerCase()`（与现有一致）
- Spec：`docs/superpowers/specs/2026-09-03-system-account-name-unique-ux-design.md`

## File map

| 文件 | 职责 |
|------|------|
| `src/services/hierarchy-service.js` | B1 文案、导出 `assertAccountNamesAvailable`、sync 预检 + A 兜底 |
| `scripts/characterization/characterize-system-node-accounts.mjs` | 离线测 normalize / 预检；pin sync 捕获 ER_DUP |
| `src/dashboard/api-docs/groups/overview.js` | POST/PUT nodes 一句说明 |
| `CHANGELOG.md` | `[Unreleased]` Fixed |
| `docs/superpowers/agent-log.md` | 收工顶插（实现会话末） |

---

### Task 1: 包内重名文案 + 预检纯函数（B1/B2 可测核心）

**Files:**
- Modify: `src/services/hierarchy-service.js`（`normalizeSystemAccounts` + 新增导出函数）
- Modify: `scripts/characterization/characterize-system-node-accounts.mjs`
- Test: `node scripts/characterization/characterize-system-node-accounts.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export function normalizeSystemAccounts(input): Array<{id?: number, name: string, account: string, password: string, loginUrl: string, remark: any, sortOrder: number}>`（文案变更）
  - `export function assertAccountNamesAvailable(existing: Array<{id: number|string, name: string}>, resolved: Array<{targetId: number|null, name: string}>): void`
    - `resolved[i].targetId`：已匹配到的现有行 id；新建为 `null`
    - 冲突时抛 `Error`，`code: 'VALIDATION'`，message 精确为：  
      `角色名称「{name}」已被占用。若要对调，请先将其中一条改为临时名称后再提交。`
    - `{name}` 用冲突项的展示名（`resolved` 里该项的 `name`，保留用户大小写）

- [ ] **Step 1: 写失败用例（文案 + 预检）**

在 `characterize-system-node-accounts.mjs` 增加：

```js
import {
  normalizeSystemAccounts,
  assertAccountNamesAvailable,
} from '../../src/services/hierarchy-service.js';

function testDuplicateNameMessage() {
  try {
    normalizeSystemAccounts([{ name: 'a' }, { name: 'A' }]);
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.code, 'VALIDATION');
    assert.equal(err.message, '同一系统下角色名称不能重复：「A」');
  }
}

function testAssertNamesAvailable() {
  const existing = [
    { id: 12, name: '黄正祥' },
    { id: 15, name: '李淼一' },
  ];
  // 自身同名保留：通过
  assertAccountNamesAvailable(existing, [
    { targetId: 12, name: '黄正祥' },
    { targetId: 15, name: '李淼一' },
  ]);
  // 交叉对调：拒绝
  try {
    assertAccountNamesAvailable(existing, [
      { targetId: 12, name: '李淼一' },
      { targetId: 15, name: '黄正祥' },
    ]);
    assert.fail('expected swap reject');
  } catch (err) {
    assert.equal(err.code, 'VALIDATION');
    assert.match(err.message, /^角色名称「.+」已被占用。若要对调，请先将其中一条改为临时名称后再提交。$/);
  }
  // 新建占用已有名：拒绝
  try {
    assertAccountNamesAvailable(existing, [{ targetId: null, name: '李淼一' }]);
    assert.fail('expected create conflict');
  } catch (err) {
    assert.equal(err.code, 'VALIDATION');
    assert.equal(
      err.message,
      '角色名称「李淼一」已被占用。若要对调，请先将其中一条改为临时名称后再提交。',
    );
  }
  // 改成全新名：通过
  assertAccountNamesAvailable(existing, [
    { targetId: 12, name: '临时甲' },
    { targetId: 15, name: '李淼一' },
  ]);
}
```

把两函数挂进 `tests` 数组。`testValidation` 里对 `[{ name: 'a' }, { name: 'A' }]` 的 `assert.throws` 可保留（仍抛错即可）。

- [ ] **Step 2: 跑测确认失败**

Run: `node scripts/characterization/characterize-system-node-accounts.mjs`  
Expected: `assertAccountNamesAvailable` 未导出 / 旧文案 `accounts 存在重复名称` → FAIL

- [ ] **Step 3: 最小实现**

1) `normalizeSystemAccounts` 将重复名称错误改为：

```js
throw Object.assign(new Error(`同一系统下角色名称不能重复：「${name}」`), { code: 'VALIDATION' });
```

2) 在同文件、`normalizeSystemAccounts` 旁新增并 **export**：

```js
/**
 * Reject writes that claim a name still held by another existing account row.
 * @param {Array<{id: number|string, name: string}>} existing rows for this system
 * @param {Array<{targetId: number|null, name: string}>} resolved planned writes
 * @returns {void}
 */
export function assertAccountNamesAvailable(existing, resolved) {
  const key = (name) => String(name || '').trim().toLocaleLowerCase();
  for (const item of resolved) {
    const nameKey = key(item.name);
    const holder = (existing || []).find((row) => key(row.name) === nameKey);
    if (!holder) continue;
    const holderId = Number(holder.id);
    const selfId = item.targetId == null ? null : Number(item.targetId);
    if (selfId != null && holderId === selfId) continue;
    throw Object.assign(
      new Error(
        `角色名称「${item.name}」已被占用。若要对调，请先将其中一条改为临时名称后再提交。`,
      ),
      { code: 'VALIDATION' },
    );
  }
}
```

JSDoc 必写（公开导出）。

- [ ] **Step 4: 再跑测**

Run: `node scripts/characterization/characterize-system-node-accounts.mjs`  
Expected: OK（含新用例）

- [ ] **Step 5: Commit**

```bash
git add src/services/hierarchy-service.js scripts/characterization/characterize-system-node-accounts.mjs
git commit -m "feat(system-account): 角色名包内重名文案 + 占用预检纯函数"
```

---

### Task 2: syncSystemAccounts 接入预检 + DB 唯一键中文兜底（A + B2 接线）

**Files:**
- Modify: `src/services/hierarchy-service.js`（`syncSystemAccounts`）
- Modify: `scripts/characterization/characterize-system-node-accounts.mjs`（源码 pin）
- Test: `node scripts/characterization/characterize-system-node-accounts.mjs`

**Interfaces:**
- Consumes: `assertAccountNamesAvailable`（Task 1）
- Produces: `syncSystemAccounts` 行为变更（仍为模块内私有 async 函数）

- [ ] **Step 1: 写 pin 失败用例**

```js
function testSyncGuardsPinned() {
  const service = readFileSync(join(root, 'src/services/hierarchy-service.js'), 'utf8');
  assert.match(service, /assertAccountNamesAvailable\(/);
  assert.match(service, /ER_DUP_ENTRY|errno === 1062/);
  assert.match(
    service,
    /同一系统下角色名称「\$\{.*\}」已存在，请修改后再提交。若要对调两条账号，请先将其中一条改为临时名称/,
  );
  assert.match(service, /code: 'CONFLICT'/);
}
```

加入 `tests` 数组。

- [ ] **Step 2: 跑测确认 pin 失败**

Run: `node scripts/characterization/characterize-system-node-accounts.mjs`  
Expected: `testSyncGuardsPinned` FAIL（尚未接线）

- [ ] **Step 3: 改 `syncSystemAccounts`**

在现有 `for (const item of normalized)` **之前**：

1. 先做一遍与循环相同的 target 解析，得到 `resolved`（含 id 归属校验；逻辑与循环内一致，避免写一半才发现 id 非法）。结构建议：

```js
const resolved = [];
for (const item of normalized) {
  let target = null;
  if (item.id !== undefined) {
    target = byId.get(item.id);
    if (!target || Number(target.systemId) !== Number(systemId)) {
      throw Object.assign(
        new Error(`accounts 中 id=${item.id} 不存在或不属于当前系统`),
        { code: 'VALIDATION' },
      );
    }
  } else {
    target = byName.get(key(item.name));
  }
  resolved.push({
    item,
    target,
    targetId: target ? Number(target.id) : null,
    name: item.name,
  });
}
assertAccountNamesAvailable(existing, resolved);
```

2. 原循环改为遍历 `resolved`，用已解析的 `target` / `item`，**不要**再解析一遍 id（可删重复校验）。

3. 将 `update`/`create` 包在 try/catch：

```js
let saved;
try {
  saved = target
    ? await systemAccountDao.update(target.id, data, trx)
    : await systemAccountDao.create({ systemId: Number(systemId), ...data }, trx);
} catch (err) {
  if (err?.errno === 1062 || err?.code === 'ER_DUP_ENTRY') {
    throw Object.assign(
      new Error(
        `同一系统下角色名称「${item.name}」已存在，请修改后再提交。若要对调两条账号，请先将其中一条改为临时名称。`,
      ),
      { code: 'CONFLICT' },
    );
  }
  throw err;
}
```

注意：catch 里 **只用** `item.name` 拼中文，不要拼接 `err.message` / `err.sql`。

删除路径上已有的 1451 处理保持不变。

- [ ] **Step 4: 再跑测**

Run: `node scripts/characterization/characterize-system-node-accounts.mjs`  
Expected: OK

- [ ] **Step 5: Commit**

```bash
git add src/services/hierarchy-service.js scripts/characterization/characterize-system-node-accounts.mjs
git commit -m "feat(system-account): sync 前占用预检 + 唯一键中文 CONFLICT"
```

---

### Task 3: api-docs + CHANGELOG + agent-log

**Files:**
- Modify: `src/dashboard/api-docs/groups/overview.js`（POST/PUT nodes 的 `desc`）
- Modify: `CHANGELOG.md` `[Unreleased]` Fixed（或 Changed）一条
- Modify: `docs/superpowers/agent-log.md`（顶插）
- Test: 目视 / 可选 `node -e` 读 docs 子串

**Interfaces:**
- Consumes: Task 1–2 已落地行为
- Produces: 文档与跨 Agent 可见记录

- [ ] **Step 1: 改 api-docs**

POST `desc` 末尾追加一句（可并入现有句）：

`同系统 accounts[].name 唯一；交叉更名/对调须先改为临时名称；冲突返回 400/409 中文提示，不返回 SQL。`

PUT `desc` 同样追加同一句（或 PUT 专用简写，语义一致即可）。

- [ ] **Step 2: CHANGELOG**

在 `## [Unreleased]` 下 Fixed 增加：

`- 系统节点 accounts 角色名：包内重名/交叉占用提交前中文 400；DB 唯一键映射中文 409，不再返回 SQL。`

- [ ] **Step 3: agent-log 顶插**

按文件头格式写一条：完成 Task 1–3 + commit hash；注意事项：对调须临时名两步；前端另仓若硬编码 SQL 需跟文案。

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/api-docs/groups/overview.js CHANGELOG.md docs/superpowers/agent-log.md
git commit -m "docs: system_account 角色名唯一约束 A+B 说明与 changelog"
```

---

## Spec coverage (self-review)

| Spec 项 | Task |
|---------|------|
| B1 包内重名文案 | Task 1 |
| B2 交叉/真占用预检 | Task 1 函数 + Task 2 接线 |
| A ER_DUP → 中文 CONFLICT | Task 2 |
| 不做自动 swap / 不改唯一键 | Global Constraints；无迁移 Task |
| api-docs 一句 | Task 3 |
| characterization | Task 1–2 |
| agent-log | Task 3 |

无 TBD；`assertAccountNamesAvailable` / 文案在各 Task 一致。
