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
} from '../../src/services/sys-msg/sys-msg-compose.js';
import { decodeUploadFilename } from '../../src/http/decode-upload-filename.js';

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

const garbledFilename = Buffer.from('批量导入模板.xlsx', 'utf8').toString('latin1');
assert.match(garbledFilename, /æ/);
assert.doesNotMatch(garbledFilename, /批量导入模板/);
assert.equal(decodeUploadFilename(garbledFilename), '批量导入模板.xlsx');
assert.equal(decodeUploadFilename('批量导入模板.xlsx'), '批量导入模板.xlsx');
assert.equal(decodeUploadFilename('batch.xlsx'), 'batch.xlsx');
assert.equal(decodeUploadFilename('café.xlsx'), 'café.xlsx');
assert.equal(decodeUploadFilename(''), '');

const repairedCompose = composeBatchImportMsgContent({
  functionName: '对公客户管理',
  filename: garbledFilename,
  jobStatus: 'completed',
  summary: { total: 3, accepted: 3, rejected: 0, drafted: 0, recorded: 3, failed: 0 },
});
assert.equal(repairedCompose, full.replace('客户导入.xlsx', '批量导入模板.xlsx'));
assert.doesNotMatch(repairedCompose, /æ/);

const oldStored = [
  `对公客户管理 · ${garbledFilename} · 已完成`,
  '共 3 条 · 受理 3 · 拒绝 0 · 已存草稿 0 · 已录制 3 · 失败 0',
].join('<br>');
const listed = shapeSysMsgApi({ id: 9, msgContent: oldStored, msgStatus: 2 });
assert.match(listed.msgContent, /对公客户管理/);
assert.match(listed.msgContent, /批量导入模板\.xlsx/);
assert.match(listed.msgContent, /已完成/);
assert.doesNotMatch(listed.msgContent, /æ/);

assert.equal(
  batchImportLinkUrl('11111111-2222-3333-4444-555555555555'),
  '/ui-recording?batchId=11111111-2222-3333-4444-555555555555',
);

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

const initSql = readFileSync(join(ROOT, 'schemas/init.sql'), 'utf-8');
assert.match(initSql, /CREATE TABLE `sys_msg`/);
assert.match(initSql, /UNIQUE KEY `uk_sys_msg_source` \(`source_type`, `source_id`\)/);
assert.match(initSql, /INSERT[\s\S]*'sys_msg_type'/);
assert.match(initSql, /批量导入任务/);

const mig = readFileSync(join(ROOT, 'migrations/20260813160000_sys_msg.js'), 'utf-8');
assert.match(mig, /createTable\('sys_msg'/);
assert.match(mig, /sys_msg_type/);
assert.match(mig, /批量导入任务/);

const constantsSrc = readFileSync(join(ROOT, 'src/models/constants.js'), 'utf-8');
  assert.match(constantsSrc, /export const MSG_TYPE_BATCH_IMPORT = 1/);
  assert.match(constantsSrc, /export const DICT_TYPE_SYS_MSG = 'sys_msg_type'/);

  const daoSrc = readFileSync(join(ROOT, 'src/dao/sys-msg-dao.js'), 'utf-8');
assert.match(daoSrc, /export async function insertIgnoreDuplicate/);
assert.match(daoSrc, /uk_sys_msg_source|ER_DUP_ENTRY|duplicate/i);
assert.match(daoSrc, /export async function list/);
assert.match(daoSrc, /export async function countUnread/);
assert.match(daoSrc, /whereNot\(\{ msg_status: MSG_STATUS_READ \}\)/);
assert.match(daoSrc, /export async function markRead/);
assert.match(daoSrc, /export async function markAllRead/);

const svcSrc = readFileSync(join(ROOT, 'src/services/sys-msg/sys-msg-service.js'), 'utf-8');
assert.match(svcSrc, /export async function insertSysMsgFromBatchJob/);
assert.match(svcSrc, /listByTypeActive\(DICT_TYPE_SYS_MSG\)|listByTypeActive\('sys_msg_type'\)/);
assert.match(svcSrc, /MSG_TITLE_BATCH_IMPORT/);
assert.match(svcSrc, /insertIgnoreDuplicate/);
assert.match(svcSrc, /export async function listMessages/);
assert.match(svcSrc, /export async function getUnreadCount/);
assert.match(svcSrc, /export async function markMessageRead/);
assert.match(svcSrc, /httpError\(404/);
assert.match(svcSrc, /export async function markAllMessagesRead/);

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

const batchSrc = readFileSync(
  join(ROOT, 'src/services/trajectory/trajectory-batch-service.js'),
  'utf-8',
);
assert.match(batchSrc, /async function notifyBatchTerminalMessage/);
assert.match(batchSrc, /insertSysMsgFromBatchJob/);
assert.match(batchSrc, /console\.warn\('\[sys-msg\] insert skipped:/);
assert.match(
  batchSrc,
  /forceUpdateJob\(batchId,\s*\{\s*status:\s*'cancelled'\s*\}\)[\s\S]{0,200}notifyBatchTerminalMessage/,
);
assert.match(
  batchSrc,
  /forceUpdateJob\(batchId,\s*\{\s*status:\s*terminal\s*\}\)[\s\S]{0,200}notifyBatchTerminalMessage/,
);
assert.doesNotMatch(batchSrc, /emitProgress\([\s\S]{0,80}insertSysMsgFromBatchJob/);

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
assert.match(changelog, /中文文件名乱码/);

const decodeSrc = readFileSync(join(ROOT, 'src/http/decode-upload-filename.js'), 'utf-8');
assert.match(decodeSrc, /export function decodeUploadFilename/);
assert.match(decodeSrc, /latin1/);

const uploadSrc = readFileSync(join(ROOT, 'src/http/upload-xlsx.js'), 'utf-8');
assert.match(uploadSrc, /defParamCharset:\s*['"]utf8['"]/);
assert.match(uploadSrc, /decodeUploadFilename/);

const batchRouteSrc = readFileSync(join(ROOT, 'src/routes/v2/trajectory-batch.js'), 'utf-8');
assert.match(batchRouteSrc, /decodeUploadFilename/);

const composeSrc = readFileSync(join(ROOT, 'src/services/sys-msg/sys-msg-compose.js'), 'utf-8');
assert.match(composeSrc, /decodeUploadFilename/);
assert.match(composeSrc, /repairMojibakeText/);

assert.match(batchSrc, /decodeUploadFilename/);

console.log('characterize-sys-msg: ok');
