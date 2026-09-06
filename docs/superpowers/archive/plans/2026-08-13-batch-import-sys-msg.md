# Batch Import Terminal Messages (sys_msg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist one product message when a batch-import job first reaches a terminal status, and serve Vue’s existing `/v2/messages*` drawer contract.

**Architecture:** Pure compose helpers build the two-line HTML body. `maybeFinalizeJob` inserts one `sys_msg` row (unique `batch_import` + batchId). Four `/api/v2/messages*` routes list and mark read. `msgType` is seeded in `sys_dict_*`. User columns stay nullable; read state is global until task/user management.

**Tech Stack:** Node ESM, Knex/MySQL, Express `/api/v2` envelope, characterization `node scripts/characterization/*.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-13-batch-import-sys-msg-design.md`

## Global Constraints

- Vue repo is **out of scope** (`D:\dev\ui-auto-recording-agent-vue-master`). Do not edit it.
- One message per job, **only** on first terminal status: `completed` / `completed_with_errors` / `failed` / `cancelled`.
- Do **not** write on `batch:progress`, import accept, or item status changes.
- Do **not** backfill historical terminal jobs.
- Duplicate `(source_type, source_id)` = success, **do not update** the first snapshot.
- Insert failure = `console.warn('[sys-msg] …')`; `maybeFinalizeJob` still returns; `batch:done` still fires.
- `msg_status`: `0` unread, `2` read (global). `create_by` default `系统`. `user_id` / `user_flag` / `rule_id` / `product_code` nullable, unused.
- `linkUrl` = `/ui-recording?batchId=<uuid>` (relative). No file download URL.
- Title / `workItemName` = dict label `批量导入任务` (`sys_msg_type` / `dict_value=1`), fallback the same literal. `msg_type` still `1` if dict missing.
- Body: two lines joined by `<br>`; escape **function name and filename** only; omit empty line-1 segments (no `· ·`).
- Stats from existing `summarizeJob` only (`total`, `accepted`, `rejected`, `drafted`, `recorded`, `failed`); missing → `0`. Do not scan items.
- List query param is `pageNum` (not `page`), default `pageSize=20`.
- Schema / routes / services → `CHANGELOG.md` `[Unreleased]` Added with Python 同步提示.
- **Commit only when the user explicitly asks.** Do not commit secrets.

## File map

| File | Role |
|------|------|
| `src/services/sys-msg-compose.js` | Pure: status labels, HTML escape, body, link, API shape, time format |
| `scripts/characterization/characterize-sys-msg.mjs` | Compose + source-cue suite |
| `migrations/20260813160000_sys_msg.js` | `sys_msg` + `sys_msg_type` seed |
| `schemas/init.sql` | Same DDL + seed INSERTs |
| `src/dao/sys-msg-dao.js` | insert-ignore-dup, list, unread count, get, mark read |
| `src/services/sys-msg-service.js` | `insertSysMsgFromBatchJob`, list/unread/read APIs |
| `src/routes/v2/messages.js` | Four HTTP routes (specific paths first) |
| `src/routes/v2/__init__.js` | `registerMessages` |
| `src/services/trajectory/trajectory-batch-service.js` | Hook after terminal `forceUpdateJob` |
| `src/dashboard/api-docs/groups/messages.js` | `/api/docs` group |
| `src/dashboard/api-docs/catalog.js` | Register group |
| `src/dashboard/api-docs/groups/hierarchy.js` | Mention `sys_msg_type` on dict group |
| `CHANGELOG.md` | Unreleased Added |

```text
maybeFinalizeJob → forceUpdateJob(terminal)
  → insertSysMsgFromBatchJob(job, summary)
       systemDao.getById(functionId) → name
       dict sys_msg_type / 1 → title
       composeBatchImportMsgContent
       dao.insertIgnoreDuplicate
GET/POST /api/v2/messages* → sys-msg-service
```

---

### Task 1: Pure compose helpers + characterization (TDD)

**Files:**
- Create: `src/services/sys-msg-compose.js`
- Create: `scripts/characterization/characterize-sys-msg.mjs`

**Interfaces:**
- Consumes: N/A
- Produces:
  - `MSG_TYPE_BATCH_IMPORT = 1`
  - `MSG_TITLE_BATCH_IMPORT = '批量导入任务'`
  - `SOURCE_TYPE_BATCH_IMPORT = 'batch_import'`
  - `MSG_STATUS_UNREAD = 0`
  - `MSG_STATUS_READ = 2`
  - `DICT_TYPE_SYS_MSG = 'sys_msg_type'`
  - `escapeHtml(s: string) → string`
  - `jobStatusLabel(status: string) → string`
  - `composeBatchImportMsgContent({ functionName, filename, jobStatus, summary }) → string`
  - `batchImportLinkUrl(batchId: string) → string`
  - `formatMsgCreateTime(value: Date|string|null) → string` (`YYYY-MM-DD HH:mm:ss`)
  - `shapeSysMsgApi(row, { msgTypeLabel }?) → Vue SysMsgItem + msgTypeLabel`

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-sys-msg.mjs`:

```javascript
/**
 * Characterization: sys_msg compose + batch-terminal insert cues.
 * Run: node scripts/characterization/characterize-sys-msg.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MSG_TYPE_BATCH_IMPORT,
  MSG_TITLE_BATCH_IMPORT,
  SOURCE_TYPE_BATCH_IMPORT,
  MSG_STATUS_UNREAD,
  MSG_STATUS_READ,
  escapeHtml,
  jobStatusLabel,
  composeBatchImportMsgContent,
  batchImportLinkUrl,
  formatMsgCreateTime,
  shapeSysMsgApi,
} from '../../src/services/sys-msg-compose.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

assert.equal(MSG_TYPE_BATCH_IMPORT, 1);
assert.equal(MSG_TITLE_BATCH_IMPORT, '批量导入任务');
assert.equal(SOURCE_TYPE_BATCH_IMPORT, 'batch_import');
assert.equal(MSG_STATUS_UNREAD, 0);
assert.equal(MSG_STATUS_READ, 2);

assert.equal(jobStatusLabel('completed'), '已完成');
assert.equal(jobStatusLabel('completed_with_errors'), '已完成（有失败）');
assert.equal(jobStatusLabel('failed'), '失败');
assert.equal(jobStatusLabel('cancelled'), '已取消');
assert.equal(jobStatusLabel(''), '');

assert.equal(escapeHtml('a <b> & "c"'), 'a &lt;b&gt; &amp; &quot;c&quot;');

const full = composeBatchImportMsgContent({
  functionName: '对公客户管理',
  filename: '客户导入.xlsx',
  jobStatus: 'completed',
  summary: { total: 3, accepted: 3, rejected: 0, drafted: 0, recorded: 3, failed: 0 },
});
assert.equal(
  full,
  '对公客户管理 · 客户导入.xlsx · 已完成<br>共 3 条 · 受理 3 · 拒绝 0 · 已存草稿 0 · 已录制 3 · 失败 0',
);

const noFile = composeBatchImportMsgContent({
  functionName: '对公客户管理',
  filename: '',
  jobStatus: 'failed',
  summary: { total: 1, accepted: 1, rejected: 0, drafted: 0, recorded: 0, failed: 1 },
});
assert.equal(
  noFile,
  '对公客户管理 · 失败<br>共 1 条 · 受理 1 · 拒绝 0 · 已存草稿 0 · 已录制 0 · 失败 1',
);
assert.equal(noFile.includes('· ·'), false);

const noFn = composeBatchImportMsgContent({
  functionName: '',
  filename: 'a.xlsx',
  jobStatus: 'cancelled',
  summary: {},
});
assert.equal(
  noFn,
  'a.xlsx · 已取消<br>共 0 条 · 受理 0 · 拒绝 0 · 已存草稿 0 · 已录制 0 · 失败 0',
);

const draft = composeBatchImportMsgContent({
  functionName: '对公客户管理',
  filename: '草稿.xlsx',
  jobStatus: 'completed',
  summary: { total: 2, accepted: 2, rejected: 0, drafted: 2, recorded: 0, failed: 0 },
});
assert.match(draft, /已存草稿 2/);
assert.match(draft, /已录制 0/);

const xss = composeBatchImportMsgContent({
  functionName: 'x',
  filename: 'a<script>.xlsx',
  jobStatus: 'completed',
  summary: { total: 0 },
});
assert.equal(xss.includes('<script>'), false);
assert.match(xss, /a&lt;script&gt;\.xlsx/);

assert.equal(
  batchImportLinkUrl('11111111-2222-3333-4444-555555555555'),
  '/ui-recording?batchId=11111111-2222-3333-4444-555555555555',
);

assert.equal(formatMsgCreateTime(new Date('2026-08-13T16:00:00+08:00')), '2026-08-13 16:00:00');
assert.equal(formatMsgCreateTime('2026-08-13 16:00:00.123'), '2026-08-13 16:00:00');
assert.equal(formatMsgCreateTime(null), '');

const api = shapeSysMsgApi({
  id: 7,
  msgTitle: '批量导入任务',
  msgContent: full,
  msgType: 1,
  msgStatus: 0,
  createTime: '2026-08-13 16:00:00',
  createBy: '系统',
  belongItemName: '对公客户管理',
  linkUrl: '/ui-recording?batchId=abc',
}, { msgTypeLabel: '批量导入任务' });
assert.deepEqual(api, {
  msgId: 7,
  msgTitle: '批量导入任务',
  workItemName: '批量导入任务',
  msgContent: full,
  msgType: 1,
  msgTypeLabel: '批量导入任务',
  msgStatus: 0,
  createTime: '2026-08-13 16:00:00',
  createBy: '系统',
  belongItemName: '对公客户管理',
  linkUrl: '/ui-recording?batchId=abc',
});
assert.equal(shapeSysMsgApi({ id: 1, msgStatus: 2 }).msgStatus, 2);
assert.equal(shapeSysMsgApi({ id: 1, msgStatus: 1 }).msgStatus, 0);

console.log('characterize-sys-msg: compose ok');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/characterization/characterize-sys-msg.mjs`

Expected: `ERR_MODULE_NOT_FOUND` for `src/services/sys-msg-compose.js`

- [ ] **Step 3: Implement compose helpers**

Create `src/services/sys-msg-compose.js`:

```javascript
export const MSG_TYPE_BATCH_IMPORT = 1;
export const MSG_TITLE_BATCH_IMPORT = '批量导入任务';
export const SOURCE_TYPE_BATCH_IMPORT = 'batch_import';
export const MSG_STATUS_UNREAD = 0;
export const MSG_STATUS_READ = 2;
export const DICT_TYPE_SYS_MSG = 'sys_msg_type';

const JOB_STATUS_LABEL = {
  completed: '已完成',
  completed_with_errors: '已完成（有失败）',
  failed: '失败',
  cancelled: '已取消',
};

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function jobStatusLabel(status) {
  const key = String(status || '');
  if (!key) return '';
  return Object.prototype.hasOwnProperty.call(JOB_STATUS_LABEL, key)
    ? JOB_STATUS_LABEL[key]
    : key;
}

function summaryInt(summary, key) {
  const v = Number(summary?.[key]);
  return Number.isFinite(v) ? v : 0;
}

export function composeBatchImportMsgContent({
  functionName = '',
  filename = '',
  jobStatus = '',
  summary = {},
} = {}) {
  const line1 = [functionName, filename, jobStatusLabel(jobStatus)]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');
  const line2 = `共 ${summaryInt(summary, 'total')} 条 · 受理 ${summaryInt(summary, 'accepted')} · 拒绝 ${summaryInt(summary, 'rejected')} · 已存草稿 ${summaryInt(summary, 'drafted')} · 已录制 ${summaryInt(summary, 'recorded')} · 失败 ${summaryInt(summary, 'failed')}`;
  return `${line1}<br>${line2}`;
}

export function batchImportLinkUrl(batchId) {
  return `/ui-recording?batchId=${encodeURIComponent(String(batchId || ''))}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatMsgCreateTime(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())} ${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;
  }
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return formatMsgCreateTime(d);
  return s;
}

export function shapeSysMsgApi(row, { msgTypeLabel } = {}) {
  const r = row || {};
  const title = String(r.msgTitle || MSG_TITLE_BATCH_IMPORT);
  const status = Number(r.msgStatus) === MSG_STATUS_READ ? MSG_STATUS_READ : MSG_STATUS_UNREAD;
  return {
    msgId: r.id,
    msgTitle: title,
    workItemName: title,
    msgContent: r.msgContent || '',
    msgType: Number(r.msgType) || MSG_TYPE_BATCH_IMPORT,
    msgTypeLabel: msgTypeLabel || title,
    msgStatus: status,
    createTime: formatMsgCreateTime(r.createTime),
    createBy: r.createBy || '系统',
    belongItemName: r.belongItemName || '',
    linkUrl: r.linkUrl || '',
  };
}
```

Note: `formatMsgCreateTime(new Date('2026-08-13T16:00:00+08:00'))` uses **local** `getHours()`. The characterization machine is UTC+8. If the runner is not UTC+8, keep the ISO-offset fixture and also assert the string-parse path (`'2026-08-13 16:00:00.123'`), which does not depend on TZ. If the Date fixture fails on TZ, drop that one assertion and keep the string parse assertion.

- [ ] **Step 4: Run characterization**

Run: `node scripts/characterization/characterize-sys-msg.mjs`

Expected: `characterize-sys-msg: compose ok` and exit 0

- [ ] **Step 5: Commit only if the user asked**

---

### Task 2: Migration + init.sql

**Files:**
- Create: `migrations/20260813160000_sys_msg.js`
- Modify: `schemas/init.sql` (after `sys_dict_data` CREATE; plus seed INSERTs near default data)
- Modify: `scripts/characterization/characterize-sys-msg.mjs` (append SQL/migration cues)

**Interfaces:**
- Consumes: Task 1 constants (`sys_msg_type`, `dict_value=1`)
- Produces: table `sys_msg`; dict type `sys_msg_type`; dict data `1` / `批量导入任务`

- [ ] **Step 1: Extend characterization with schema cues (must fail)**

Append to `scripts/characterization/characterize-sys-msg.mjs` (after compose tests, before the final `console.log`):

```javascript
const initSql = readFileSync(join(ROOT, 'schemas/init.sql'), 'utf-8');
assert.match(initSql, /CREATE TABLE `sys_msg`/);
assert.match(initSql, /UNIQUE KEY `uk_sys_msg_source` \(`source_type`, `source_id`\)/);
assert.match(initSql, /dict_type=sys_msg_type|`sys_msg_type`/);
assert.match(initSql, /批量导入任务/);

const mig = readFileSync(join(ROOT, 'migrations/20260813160000_sys_msg.js'), 'utf-8');
assert.match(mig, /createTable\('sys_msg'/);
assert.match(mig, /sys_msg_type/);
assert.match(mig, /批量导入任务/);
```

Move `console.log('characterize-sys-msg: compose ok')` to the end and change it to `characterize-sys-msg: ok`.

- [ ] **Step 2: Run — expect fail**

Run: `node scripts/characterization/characterize-sys-msg.mjs`

Expected: fail on missing `CREATE TABLE \`sys_msg\`` and/or missing migration file.

- [ ] **Step 3: Add migration**

Create `migrations/20260813160000_sys_msg.js`:

```javascript
/**
 * Product messages: sys_msg + first msg type (batch import) in sys_dict_*.
 */
export async function up(knex) {
  if (!(await knex.schema.hasTable('sys_msg'))) {
    await knex.schema.createTable('sys_msg', (t) => {
      t.bigIncrements('id').unsigned().primary();
      t.string('msg_title', 128).notNullable().defaultTo('')
        .comment('展示标题；第一种=批量导入任务');
      t.text('msg_content').notNullable()
        .comment('两行 HTML：功能·文件·状态 / 统计；用户字段已转义');
      t.integer('msg_type').notNullable()
        .comment('sys_dict_data.dict_value (sys_msg_type)');
      t.specificType('msg_status', 'tinyint').notNullable().defaultTo(0)
        .comment('0未读 2已读（现阶段全局）');
      t.string('link_url', 512).notNullable().defaultTo('');
      t.string('belong_item_name', 255).notNullable().defaultTo('')
        .comment('功能名');
      t.bigInteger('belong_item_id').unsigned().nullable()
        .comment('system.id type=3');
      t.string('source_type', 32).notNullable().defaultTo('')
        .comment('batch_import');
      t.string('source_id', 64).notNullable().defaultTo('')
        .comment('batch UUID');
      t.string('product_code', 64).nullable().comment('挂起');
      t.string('create_by', 64).notNullable().defaultTo('系统');
      t.bigInteger('user_id').unsigned().nullable().comment('挂起');
      t.specificType('user_flag', 'tinyint').nullable().comment('挂起');
      t.bigInteger('rule_id').unsigned().nullable().comment('挂起');
      t.string('remark', 500).nullable();
      t.datetime('create_time', 3).notNullable().defaultTo(knex.fn.now(3));
      t.datetime('update_time', 3).notNullable().defaultTo(knex.fn.now(3));
      t.unique(['source_type', 'source_id'], 'uk_sys_msg_source');
      t.index(['create_time'], 'idx_sys_msg_created');
      t.index(['msg_status'], 'idx_sys_msg_status');
    });
  }

  if (await knex.schema.hasTable('sys_dict_type')) {
    const typeRow = await knex('sys_dict_type').where({ dict_type: 'sys_msg_type' }).first();
    if (!typeRow) {
      await knex('sys_dict_type').insert({
        dict_name: '消息类型',
        dict_type: 'sys_msg_type',
        status: '0',
        create_by: '',
        update_by: '',
        remark: '产品消息抽屉 msgType',
      });
    }
  }

  if (await knex.schema.hasTable('sys_dict_data')) {
    const dataRow = await knex('sys_dict_data')
      .where({ dict_type: 'sys_msg_type', dict_value: '1' })
      .first();
    if (!dataRow) {
      await knex('sys_dict_data').insert({
        dict_sort: 1,
        dict_label: '批量导入任务',
        dict_value: '1',
        dict_type: 'sys_msg_type',
        status: '0',
        is_default: 'N',
        create_by: '',
        update_by: '',
      });
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('sys_dict_data')) {
    await knex('sys_dict_data').where({ dict_type: 'sys_msg_type' }).del();
  }
  if (await knex.schema.hasTable('sys_dict_type')) {
    await knex('sys_dict_type').where({ dict_type: 'sys_msg_type' }).del();
  }
  await knex.schema.dropTableIfExists('sys_msg');
}
```

- [ ] **Step 4: Sync `schemas/init.sql`**

Immediately after the `sys_dict_data` `CREATE TABLE` block (before 特殊元素库), insert:

```sql
-- ─────────────────────────────────────────────────────────────
-- 产品消息（批量导入终态等）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE `sys_msg` (
  `id`               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `msg_title`        VARCHAR(128) NOT NULL DEFAULT '' COMMENT '展示标题；第一种=批量导入任务',
  `msg_content`      TEXT NOT NULL COMMENT '两行 HTML：功能·文件·状态 / 统计；用户字段已转义',
  `msg_type`         INT NOT NULL COMMENT 'sys_dict_data.dict_value (sys_msg_type)',
  `msg_status`       TINYINT NOT NULL DEFAULT 0 COMMENT '0未读 2已读（现阶段全局）',
  `link_url`         VARCHAR(512) NOT NULL DEFAULT '',
  `belong_item_name` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '功能名',
  `belong_item_id`   BIGINT UNSIGNED NULL COMMENT 'system.id type=3',
  `source_type`      VARCHAR(32) NOT NULL DEFAULT '' COMMENT 'batch_import',
  `source_id`        VARCHAR(64) NOT NULL DEFAULT '' COMMENT 'batch UUID',
  `product_code`     VARCHAR(64) NULL COMMENT '挂起',
  `create_by`        VARCHAR(64) NOT NULL DEFAULT '系统',
  `user_id`          BIGINT UNSIGNED NULL COMMENT '挂起',
  `user_flag`        TINYINT NULL COMMENT '挂起',
  `rule_id`          BIGINT UNSIGNED NULL COMMENT '挂起',
  `remark`           VARCHAR(500) NULL,
  `create_time`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `update_time`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY `uk_sys_msg_source` (`source_type`, `source_id`),
  KEY `idx_sys_msg_created` (`create_time`),
  KEY `idx_sys_msg_status` (`msg_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品消息';
```

In the default-data section (after `sys_dict` tables exist, before or after `INSERT INTO system`), add:

```sql
INSERT INTO `sys_dict_type` (`dict_name`, `dict_type`, `status`, `create_by`, `update_by`, `remark`) VALUES
  ('消息类型', 'sys_msg_type', '0', '', '', '产品消息抽屉 msgType');

INSERT INTO `sys_dict_data` (`dict_sort`, `dict_label`, `dict_value`, `dict_type`, `status`, `is_default`, `create_by`, `update_by`) VALUES
  (1, '批量导入任务', '1', 'sys_msg_type', '0', 'N', '', '');
```

If a greenfield `init.sql` would collide with later migrations that also insert the same dict row, the migration already skips existing `dict_type` / `dict_value`. Keep both: migrate existing DBs; init.sql for fresh installs.

- [ ] **Step 5: Re-run characterization**

Run: `node scripts/characterization/characterize-sys-msg.mjs`

Expected: `characterize-sys-msg: ok` exit 0

If a local MySQL is configured, also run the repo’s usual knex migrate (do not invent a new command). Skip migrate if DB is not available; schema cues are the gate.

- [ ] **Step 6: Commit only if the user asked**

---

### Task 3: DAO

**Files:**
- Create: `src/dao/sys-msg-dao.js`
- Modify: `scripts/characterization/characterize-sys-msg.mjs`

**Interfaces:**
- Consumes: `toDbRow` / `fromDbRow` / `fromDbRows` from `src/dao/helpers.js`; `MSG_STATUS_READ` from compose
- Produces:
  - `insertIgnoreDuplicate(data) → { id, duplicate: boolean, row }`
  - `list({ pageNum, pageSize }) → { rows, total }` (`create_time DESC`)
  - `countUnread() → number` (`msg_status <> 2`)
  - `getById(id) → row|null`
  - `markRead(id) → row|null` (sets `msg_status=2`; missing → null)
  - `markAllRead() → number` (rows updated)

- [ ] **Step 1: Add DAO source cues to characterization**

```javascript
const daoSrc = readFileSync(join(ROOT, 'src/dao/sys-msg-dao.js'), 'utf-8');
assert.match(daoSrc, /export async function insertIgnoreDuplicate/);
assert.match(daoSrc, /uk_sys_msg_source|ER_DUP_ENTRY|duplicate/i);
assert.match(daoSrc, /export async function list/);
assert.match(daoSrc, /export async function countUnread/);
assert.match(daoSrc, /msg_status.*<>.*2|whereNot\(\{ msg_status: MSG_STATUS_READ \}\)|whereNot\(\{ msg_status: 2 \}\)/);
assert.match(daoSrc, /export async function markRead/);
assert.match(daoSrc, /export async function markAllRead/);
```

Use a cue that matches the actual implementation you write (prefer `whereNot({ msg_status: MSG_STATUS_READ })` and assert that exact substring).

- [ ] **Step 2: Run — expect fail (file missing)**

- [ ] **Step 3: Implement DAO**

Create `src/dao/sys-msg-dao.js`:

```javascript
import { getDB } from '../../config/database.js';
import { toDbRow, fromDbRow, fromDbRows } from './helpers.js';
import { MSG_STATUS_READ } from '../services/sys-msg-compose.js';

const TABLE = 'sys_msg';

function isDup(err) {
  return err?.code === 'ER_DUP_ENTRY' || /uk_sys_msg_source/i.test(String(err?.message || ''));
}

export async function insertIgnoreDuplicate(data) {
  const row = toDbRow(data);
  try {
    const [id] = await getDB()(TABLE).insert(row);
    const created = await getById(id);
    return { id, duplicate: false, row: created };
  } catch (err) {
    if (!isDup(err)) throw err;
    const existing = await getDB()(TABLE)
      .where({
        source_type: row.source_type,
        source_id: row.source_id,
      })
      .first();
    const shaped = fromDbRow(existing);
    return { id: shaped?.id ?? null, duplicate: true, row: shaped };
  }
}

export async function getById(id) {
  const row = await getDB()(TABLE).where({ id }).first();
  return fromDbRow(row);
}

export async function list({ pageNum = 1, pageSize = 20 } = {}) {
  const page = Math.max(1, Number(pageNum) || 1);
  const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const db = getDB();
  const [{ total }] = await db(TABLE).count('* as total');
  const rows = await db(TABLE)
    .orderBy('create_time', 'desc')
    .orderBy('id', 'desc')
    .limit(size)
    .offset((page - 1) * size);
  return { rows: fromDbRows(rows), total: Number(total) || 0 };
}

export async function countUnread() {
  const row = await getDB()(TABLE).whereNot({ msg_status: MSG_STATUS_READ }).count({ c: '*' }).first();
  return Number(row?.c || 0);
}

export async function markRead(id) {
  const existing = await getById(id);
  if (!existing) return null;
  if (Number(existing.msgStatus) !== MSG_STATUS_READ) {
    await getDB()(TABLE).where({ id }).update({
      msg_status: MSG_STATUS_READ,
      update_time: getDB().fn.now(),
    });
  }
  return getById(id);
}

export async function markAllRead() {
  return getDB()(TABLE).whereNot({ msg_status: MSG_STATUS_READ }).update({
    msg_status: MSG_STATUS_READ,
    update_time: getDB().fn.now(),
  });
}
```

Do **not** update `msg_content` on duplicate.

- [ ] **Step 4: Run characterization**

Run: `node scripts/characterization/characterize-sys-msg.mjs`

Expected: exit 0

- [ ] **Step 5: Commit only if the user asked**

---

### Task 4: Service (insert from batch job + list/read)

**Files:**
- Create: `src/services/sys-msg-service.js`
- Modify: `scripts/characterization/characterize-sys-msg.mjs`

**Interfaces:**
- Consumes: dao Task 3; compose Task 1; `systemDao.getById`; `dataDao.listByTypeActive('sys_msg_type')`
- Produces:
  - `insertSysMsgFromBatchJob(job, summary) → { id, duplicate }` (never throws to caller if you wrap internally — **prefer throw**, caller in Task 6 catches)
  - `listMessages({ pageNum, pageSize }) → { rows, total }` rows already `shapeSysMsgApi`
  - `getUnreadCount() → { count }`
  - `markMessageRead(id)` throws `{ statusCode: 404 }` if missing; else `{ success: true }`
  - `markAllMessagesRead() → { success: true }`

`job` uses camelCase from `batch-recording-dao` (`id`, `status`, `functionId`, `originalFilename`).

- [ ] **Step 1: Add service source cues (fail)**

```javascript
const svcSrc = readFileSync(join(ROOT, 'src/services/sys-msg-service.js'), 'utf-8');
assert.match(svcSrc, /export async function insertSysMsgFromBatchJob/);
assert.match(svcSrc, /listByTypeActive\(DICT_TYPE_SYS_MSG\)|listByTypeActive\('sys_msg_type'\)/);
assert.match(svcSrc, /MSG_TITLE_BATCH_IMPORT/);
assert.match(svcSrc, /insertIgnoreDuplicate/);
assert.match(svcSrc, /export async function listMessages/);
assert.match(svcSrc, /export async function getUnreadCount/);
assert.match(svcSrc, /export async function markMessageRead/);
assert.match(svcSrc, /statusCode = 404/);
assert.match(svcSrc, /export async function markAllMessagesRead/);
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement service**

Create `src/services/sys-msg-service.js`:

```javascript
import * as systemDao from '../dao/system-dao.js';
import * as dataDao from '../dao/sys-dict-data-dao.js';
import * as msgDao from '../dao/sys-msg-dao.js';
import {
  MSG_TYPE_BATCH_IMPORT,
  MSG_TITLE_BATCH_IMPORT,
  SOURCE_TYPE_BATCH_IMPORT,
  MSG_STATUS_UNREAD,
  DICT_TYPE_SYS_MSG,
  composeBatchImportMsgContent,
  batchImportLinkUrl,
  shapeSysMsgApi,
} from './sys-msg-compose.js';

function httpError(status, message) {
  const err = new Error(message);
  err.statusCode = status;
  return err;
}

async function resolveTitle() {
  try {
    const rows = await dataDao.listByTypeActive(DICT_TYPE_SYS_MSG);
    const hit = (rows || []).find((r) => String(r.dictValue) === String(MSG_TYPE_BATCH_IMPORT));
    const label = String(hit?.dictLabel || '').trim();
    if (label) return label;
  } catch { /* dict missing → fallback */ }
  return MSG_TITLE_BATCH_IMPORT;
}

async function resolveFunctionName(functionId) {
  const id = Number(functionId);
  if (!Number.isFinite(id) || id <= 0) return { name: '', id: null };
  try {
    const node = await systemDao.getById(id);
    return { name: String(node?.name || '').trim(), id };
  } catch {
    return { name: '', id };
  }
}

export async function insertSysMsgFromBatchJob(job, summary = {}) {
  const batchId = String(job?.id || '');
  if (!batchId) return { id: null, duplicate: false };
  const { name: functionName, id: belongItemId } = await resolveFunctionName(job.functionId);
  const title = await resolveTitle();
  const msgContent = composeBatchImportMsgContent({
    functionName,
    filename: job.originalFilename || '',
    jobStatus: job.status,
    summary,
  });
  return msgDao.insertIgnoreDuplicate({
    msgTitle: title,
    msgContent,
    msgType: MSG_TYPE_BATCH_IMPORT,
    msgStatus: MSG_STATUS_UNREAD,
    linkUrl: batchImportLinkUrl(batchId),
    belongItemName: functionName,
    belongItemId,
    sourceType: SOURCE_TYPE_BATCH_IMPORT,
    sourceId: batchId,
    createBy: '系统',
  });
}

async function typeLabelMap() {
  try {
    const rows = await dataDao.listByTypeActive(DICT_TYPE_SYS_MSG);
    const map = {};
    for (const r of rows || []) map[String(r.dictValue)] = r.dictLabel;
    return map;
  } catch {
    return {};
  }
}

export async function listMessages({ pageNum = 1, pageSize = 20 } = {}) {
  const { rows, total } = await msgDao.list({ pageNum, pageSize });
  const labels = await typeLabelMap();
  return {
    rows: rows.map((r) => shapeSysMsgApi(r, { msgTypeLabel: labels[String(r.msgType)] })),
    total,
  };
}

export async function getUnreadCount() {
  const count = await msgDao.countUnread();
  return { count };
}

export async function markMessageRead(id) {
  const row = await msgDao.markRead(id);
  if (!row) throw httpError(404, 'Message not found');
  return { success: true };
}

export async function markAllMessagesRead() {
  await msgDao.markAllRead();
  return { success: true };
}
```

- [ ] **Step 4: Run characterization + syntax check**

Run:

```
node scripts/characterization/characterize-sys-msg.mjs
node --check src/services/sys-msg-service.js
node --check src/dao/sys-msg-dao.js
```

Expected: all exit 0

- [ ] **Step 5: Commit only if the user asked**

---

### Task 5: HTTP routes

**Files:**
- Create: `src/routes/v2/messages.js`
- Modify: `src/routes/v2/__init__.js`
- Modify: `scripts/characterization/characterize-sys-msg.mjs`

**Interfaces:**
- Consumes: `listMessages`, `getUnreadCount`, `markMessageRead`, `markAllMessagesRead`
- Produces: Vue paths (baseURL `/api`):
  - `GET /api/v2/messages?pageNum&pageSize` → `{ rows, total }`
  - `GET /api/v2/messages/unread-count` → `{ count }`
  - `POST /api/v2/messages/:id/read` → `{ success: true }` or HTTP 404
  - `POST /api/v2/messages/read-all` → `{ success: true }`

Register **unread-count** and **read-all** before `/:id/read`. Envelope middleware already wraps `res.json`.

- [ ] **Step 1: Add route cues (fail)**

```javascript
const routesSrc = readFileSync(join(ROOT, 'src/routes/v2/messages.js'), 'utf-8');
assert.match(routesSrc, /\/api\/v2\/messages\/unread-count/);
assert.match(routesSrc, /\/api\/v2\/messages\/read-all/);
assert.match(routesSrc, /\/api\/v2\/messages\/:id\/read/);
assert.match(routesSrc, /\/api\/v2\/messages'/);
assert.ok(
  routesSrc.indexOf('/api/v2/messages/unread-count')
    < routesSrc.indexOf('/api/v2/messages/:id/read'),
);
assert.ok(
  routesSrc.indexOf('/api/v2/messages/read-all')
    < routesSrc.indexOf('/api/v2/messages/:id/read'),
);

const initSrc = readFileSync(join(ROOT, 'src/routes/v2/__init__.js'), 'utf-8');
assert.match(initSrc, /registerMessages/);
assert.match(initSrc, /from '\.\/messages\.js'/);
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement routes**

Create `src/routes/v2/messages.js`:

```javascript
import * as sysMsgService from '../../services/sys-msg-service.js';

function statusOf(err) {
  return err?.statusCode || 500;
}

export default function registerMessages(app) {
  app.get('/api/v2/messages/unread-count', async (req, res) => {
    try {
      const data = await sysMsgService.getUnreadCount();
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.post('/api/v2/messages/read-all', async (req, res) => {
    try {
      const data = await sysMsgService.markAllMessagesRead();
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.post('/api/v2/messages/:id/read', async (req, res) => {
    try {
      const data = await sysMsgService.markMessageRead(req.params.id);
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });

  app.get('/api/v2/messages', async (req, res) => {
    try {
      const data = await sysMsgService.listMessages({
        pageNum: req.query.pageNum,
        pageSize: req.query.pageSize,
      });
      res.json(data);
    } catch (err) {
      res.status(statusOf(err)).json({ error: err.message });
    }
  });
}
```

In `src/routes/v2/__init__.js` add:

```javascript
import registerMessages from './messages.js';
```

Call `registerMessages(app);` next to `registerSysDict(app)` (before trajectory routes is fine).

Empty table / missing table: do **not** special-case 500 into `[]` unless `err.code` is `ER_NO_SUCH_TABLE`. Spec says empty table → `rows=[]` / `count=0` (normal DAO count). Un-migrated DB 500 is acceptable; do not swallow all errors.

- [ ] **Step 4: Run**

```
node scripts/characterization/characterize-sys-msg.mjs
node --check src/routes/v2/messages.js
node --check src/routes/v2/__init__.js
```

Expected: exit 0

- [ ] **Step 5: Commit only if the user asked**

---

### Task 6: Hook `maybeFinalizeJob`

**Files:**
- Modify: `src/services/trajectory/trajectory-batch-service.js` (`maybeFinalizeJob` only)
- Modify: `scripts/characterization/characterize-sys-msg.mjs`

**Interfaces:**
- Consumes: `insertSysMsgFromBatchJob(job, summary)`
- Produces: after each successful terminal `forceUpdateJob`, one insert attempt; errors swallowed with `console.warn('[sys-msg] insert skipped:'`

There are **two** terminal writes in `maybeFinalizeJob`:

1. Cancel branch: `forceUpdateJob(..., { status: 'cancelled' })` then `summarizeJob` then `broadcast('batch:done', …)`
2. Normal: `deriveJobTerminalStatus` truthy → `forceUpdateJob(..., { status: terminal })` then broadcast

Hook **both**, after `forceUpdateJob`, using the **updated** job row (`getJobById`) so `job.status` is the Chinese-label key.

Do **not** hook `emitProgress`.

- [ ] **Step 1: Add hook cues (fail until wired)**

```javascript
const batchSrc = readFileSync(
  join(ROOT, 'src/services/trajectory/trajectory-batch-service.js'),
  'utf-8',
);
assert.match(batchSrc, /insertSysMsgFromBatchJob/);
assert.match(batchSrc, /console\.warn\('\[sys-msg\] insert skipped:/);
assert.equal((batchSrc.match(/insertSysMsgFromBatchJob/g) || []).length >= 3, true);
// import + two call sites (or import + helper + two helper calls — then assert helper name instead)
assert.doesNotMatch(batchSrc, /emitProgress\([\s\S]{0,80}insertSysMsgFromBatchJob/);
```

If you extract `notifyBatchTerminalMessage(job, summary)`, assert that name and that `maybeFinalizeJob` calls it in both branches (search `status: 'cancelled'` block and `status: terminal` block each contain the helper or insert call). Prefer a local helper:

```javascript
async function notifyBatchTerminalMessage(job, summary) {
  try {
    await insertSysMsgFromBatchJob(job, summary);
  } catch (err) {
    console.warn('[sys-msg] insert skipped:', err?.message || err);
  }
}
```

Then characterization:

```javascript
assert.match(batchSrc, /async function notifyBatchTerminalMessage/);
assert.match(batchSrc, /insertSysMsgFromBatchJob/);
assert.match(batchSrc, /console\.warn\('\[sys-msg\] insert skipped:/);
assert.equal((batchSrc.match(/notifyBatchTerminalMessage\(/g) || []).length >= 3, true);
```

(`function` declaration + two calls = 3).

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Wire the hook**

At top of `src/services/trajectory/trajectory-batch-service.js` add:

```javascript
import { insertSysMsgFromBatchJob } from '../sys-msg-service.js';
```

(Path from `src/services/trajectory/` to `src/services/sys-msg-service.js` is `../sys-msg-service.js`.)

Add `notifyBatchTerminalMessage` next to `maybeFinalizeJob`.

Cancel branch — after `forceUpdateJob` + `summarizeJob`, before `broadcast`:

```javascript
    const cancelledJob = await batchDao.getJobById(batchId);
    await notifyBatchTerminalMessage(cancelledJob, summary);
    try {
      broadcast('batch:done', {
```

Keep the existing `return batchDao.getJobById(batchId)` (or return `cancelledJob`).

Normal terminal branch — after `forceUpdateJob`, before `broadcast`:

```javascript
  const doneJob = await batchDao.getJobById(batchId);
  await notifyBatchTerminalMessage(doneJob, summary);
  try {
    broadcast('batch:done', {
```

Do not insert when `maybeFinalizeJob` returns early (already terminal, still in-flight cancel, or `terminal` falsy).

- [ ] **Step 4: Run**

```
node scripts/characterization/characterize-sys-msg.mjs
node --check src/services/trajectory/trajectory-batch-service.js
```

Expected: exit 0

- [ ] **Step 5: Commit only if the user asked**

---

### Task 7: api-docs + CHANGELOG

**Files:**
- Create: `src/dashboard/api-docs/groups/messages.js`
- Modify: `src/dashboard/api-docs/catalog.js`
- Modify: `src/dashboard/api-docs/groups/hierarchy.js` (sys-dict description + example row)
- Modify: `CHANGELOG.md` `[Unreleased]` **Added**
- Modify: `scripts/characterization/characterize-sys-msg.mjs` (docs cues)

**Interfaces:**
- Consumes: HTTP contract from Task 5
- Produces: `/api/docs` group; Python sync hint

- [ ] **Step 1: Docs cues (fail)**

```javascript
const docs = readFileSync(join(ROOT, 'src/dashboard/api-docs/groups/messages.js'), 'utf-8');
assert.match(docs, /\/api\/v2\/messages\/unread-count/);
assert.match(docs, /pageNum/);
assert.match(docs, /msgTypeLabel/);
assert.match(docs, /ui-recording\?batchId=/);

const catalog = readFileSync(join(ROOT, 'src/dashboard/api-docs/catalog.js'), 'utf-8');
assert.match(catalog, /GROUP_MESSAGES/);

const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf-8');
assert.match(changelog, /sys_msg/);
assert.match(changelog, /sys_msg_type/);
assert.match(changelog, /\/api\/v2\/messages/);
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Add api-docs group**

Create `src/dashboard/api-docs/groups/messages.js`:

```javascript
import { J } from './_j.js';

/** @type {TagGroup[]} */
export const GROUP_MESSAGES = [
  {
    id: 'messages',
    name: '消息',
    description: '产品通知抽屉。第一种类型：批量导入任务终态一条。用户字段挂起，全员同一份列表/已读。',
    endpoints: [
      {
        method: 'GET', path: '/api/v2/messages',
        summary: '消息列表（新→旧）',
        params: [
          { name: 'pageNum', type: 'number', in: 'query', example: '1' },
          { name: 'pageSize', type: 'number', in: 'query', example: '20' },
        ],
        respExample: J({
          code: 200,
          message: 'ok',
          data: {
            rows: [{
              msgId: 1,
              msgTitle: '批量导入任务',
              workItemName: '批量导入任务',
              msgContent: '对公客户管理 · 客户导入.xlsx · 已完成<br>共 3 条 · 受理 3 · 拒绝 0 · 已存草稿 0 · 已录制 3 · 失败 0',
              msgType: 1,
              msgTypeLabel: '批量导入任务',
              msgStatus: 0,
              createTime: '2026-08-13 16:00:00',
              createBy: '系统',
              belongItemName: '对公客户管理',
              linkUrl: '/ui-recording?batchId=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            }],
            total: 1,
          },
        }),
        notes: [
          'pageNum 从 1；默认 pageSize=20，最大 100',
          'msgStatus 0 未读 / 2 已读（现阶段全局）',
          'msgType 见字典 sys_msg_type；第一种 dict_value=1 批量导入任务',
          '终态才插入；不补历史任务',
        ],
      },
      {
        method: 'GET', path: '/api/v2/messages/unread-count',
        summary: '未读数量',
        respExample: J({ code: 200, message: 'ok', data: { count: 3 } }),
      },
      {
        method: 'POST', path: '/api/v2/messages/{id}/read',
        summary: '单条已读',
        params: [{ name: 'id', type: 'number', required: true, in: 'path', example: '1' }],
        respExample: J({ code: 200, message: 'ok', data: { success: true } }),
        notes: ['已读再点仍 200；不存在 HTTP 404'],
      },
      {
        method: 'POST', path: '/api/v2/messages/read-all',
        summary: '全部已读',
        respExample: J({ code: 200, message: 'ok', data: { success: true } }),
      },
    ],
  },
];
```

In `src/dashboard/api-docs/catalog.js`:

- `import { GROUP_MESSAGES } from './groups/messages.js';`
- Insert `...GROUP_MESSAGES,` in `API_GROUPS` after hierarchy (or after system-mgmt).

In `src/dashboard/api-docs/groups/hierarchy.js` sys-dict `description`, append `；消息类型 dict_type=sys_msg_type（1=批量导入任务）`.

- [ ] **Step 4: CHANGELOG `[Unreleased]` → `### Added` (top of Added)**

```markdown
- 2026-08-13: **产品消息表（批量导入终态）**：新建 `sys_msg`；字典 `sys_msg_type`（`1`=批量导入任务）。批量任务第一次进入终态插入一条；标题「批量导入任务」；正文两行（功能·文件·状态 / 共N条统计）；`linkUrl=/ui-recording?batchId=`。`GET /api/v2/messages`（`pageNum`）/ `unread-count` / `POST :id/read` / `read-all`。`user_id` 挂起，全员同一列表与已读。
  影响范围：schema、字典种子、batch finalize、v2 消息 API、api-docs。
  文件：migrations/20260813160000_sys_msg.js, schemas/init.sql, src/services/sys-msg-compose.js, src/services/sys-msg-service.js, src/dao/sys-msg-dao.js, src/routes/v2/messages.js, src/services/trajectory/trajectory-batch-service.js
  Python 同步提示：对齐表 `sys_msg` 与字典 `sys_msg_type`；透传 `/api/v2/messages*`（无用户过滤）；勿从 batch 表虚拟拼消息。
```

- [ ] **Step 5: Final verify**

```
node scripts/characterization/characterize-sys-msg.mjs
node --check src/dashboard/api-docs/groups/messages.js
node --check src/dashboard/api-docs/catalog.js
```

Expected: exit 0

- [ ] **Step 6: Commit only if the user asked**

---

## Out of scope (do not do)

- Vue `messageDrawer.vue` / `message.ts` / `?batchId=` dialog open / `msgTypeLabel` tag / `POST :id/read` on click
- Backfill old batch jobs
- Second message type
- Per-user read table
- File download `linkUrl`

## Self-review (plan vs spec)

| Spec item | Task |
|-----------|------|
| `sys_msg` DDL + unique source | 2 |
| dict `sys_msg_type` / `1` | 2 |
| two-line body, escape, omit empty segments, four status labels, summarizeJob stats | 1 |
| `linkUrl` relative batchId | 1, 4 |
| insert on first terminal only; both cancel + complete | 6 |
| duplicate no update | 3 |
| insert error does not fail job | 6 |
| list / unread / read / read-all + pageNum | 5 |
| `msgTypeLabel`, `workItemName`, createTime format | 1, 4 |
| user fields hung, global read | 2, 3 |
| no Vue | Global |
| CHANGELOG + api-docs | 7 |
| no historical backfill | 6 (no extra job) |
