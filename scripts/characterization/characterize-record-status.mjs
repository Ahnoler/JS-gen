/**
 * Characterization: trajectory recordStatus 状态机（offline，不连 DB）。
 * SUT: src/dao/trajectory-dao.js 的 recordStatus 状态机
 *   （enterTransientRecording / finishTransientRecording / restorePersistentRecordStatus /
 *    setPersistentRecordStatus / updateMetaIf，及私有 writeRecordStatusResilient）。
 *
 * 这些函数是 DB 绑定（knex），离线策略分两层：
 * 1. 行为测试：src/models/constants.js 为纯模块，可完全离线验证
 *    PERSISTENT_RECORD_STATUSES / isPersistentRecordStatus / resolvePostRecordingStatus 语义。
 * 2. 源码结构断言（readFileSync + assert.match）：钉住 dao 内 CAS / 双状态字段 /
 *    恢复基线调用链等关键语义，以及 services 层调用链 wiring。
 * Run: node scripts/characterization/characterize-record-status.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

let constants = null;
let constantsAvailable = false;
try {
  constants = await import('../../src/models/constants.js');
  constantsAvailable = true;
} catch (err) {
  constantsAvailable = false;
}

let trajectoryDao = null;
let daoAvailable = false;
try {
  trajectoryDao = await import('../../src/dao/trajectory-dao.js');
  daoAvailable = true;
} catch (err) {
  // getDB 是惰性 knex 单例，import 本身不连 DB；此分支仅防御异常环境。
  daoAvailable = false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 读取 SUT 源码（trajectory-dao.js 全文）。
 * @returns {string} 源码文本
 */
function daoSource() {
  return readFileSync(join(root, 'src/dao/trajectory-dao.js'), 'utf8');
}

/**
 * 断言源码中包含全部给定片段（缺失时报出缺失的片段名）。
 * @param {string} src 源码文本
 * @param {Array<[string, RegExp]>} pairs [说明, 正则] 列表
 */
function assertAllMatch(src, pairs) {
  for (const [label, re] of pairs) {
    assert.match(src, re, `missing: ${label}`);
  }
}

// ---------------------------------------------------------------------------
// 行为测试：constants.js 纯函数（完全离线）
// ---------------------------------------------------------------------------

function testPersistentStatusesExcludeRecording() {
  if (!constantsAvailable) { console.log('    (skipped: constants not importable)'); return; }
  assert.deepEqual(constants.PERSISTENT_RECORD_STATUSES, ['draft', 'recorded', 'completed', 'failed'],
    '持久态为 draft/recorded/completed/failed');
  assert.ok(!constants.PERSISTENT_RECORD_STATUSES.includes('recording'),
    'recording 是临时态，不在持久态集合中（transient 与 persistent 两套状态字段的前提）');
}

function testTrajectoryStatusesIncludeRecording() {
  if (!constantsAvailable) { console.log('    (skipped: constants not importable)'); return; }
  assert.deepEqual(constants.TRAJECTORY_RECORD_STATUSES,
    ['draft', 'recording', 'failed', 'recorded', 'completed'],
    '全量记录状态共五态，含临时态 recording');
}

function testIsPersistentRecordStatus() {
  if (!constantsAvailable) { console.log('    (skipped: constants not importable)'); return; }
  for (const s of ['draft', 'recorded', 'completed', 'failed']) {
    assert.equal(constants.isPersistentRecordStatus(s), true, `isPersistentRecordStatus(${s}) = true`);
  }
  for (const s of ['recording', '', 'unknown', null, undefined]) {
    assert.equal(constants.isPersistentRecordStatus(s), false, `isPersistentRecordStatus(${String(s)}) = false`);
  }
}

function testResolvePostRecordingSuccess() {
  if (!constantsAvailable) { console.log('    (skipped: constants not importable)'); return; }
  // outcome='success' 一律 → 待确认(recorded)，无论持久基线为何（覆盖基线）。
  for (const base of ['draft', 'recorded', 'completed', 'failed', 'recording', null, undefined]) {
    assert.equal(constants.resolvePostRecordingStatus(base, 'success'), 'recorded',
      `resolvePostRecordingStatus(${String(base)}, 'success') = recorded`);
  }
}

function testResolvePostRecordingFailure() {
  if (!constantsAvailable) { console.log('    (skipped: constants not importable)'); return; }
  // outcome='failure' 一律 → 录制异常(failed)，无论持久基线为何。
  for (const base of ['draft', 'recorded', 'completed', 'failed', 'recording', null]) {
    assert.equal(constants.resolvePostRecordingStatus(base, 'failure'), 'failed',
      `resolvePostRecordingStatus(${String(base)}, 'failure') = failed`);
  }
}

function testResolvePostRecordingRestore() {
  if (!constantsAvailable) { console.log('    (skipped: constants not importable)'); return; }
  // outcome='restore'（非终结性）：恢复到录制前持久基线，杜绝降级。
  assert.equal(constants.resolvePostRecordingStatus('completed', 'restore'), 'completed',
    'restore 恢复基线 completed');
  assert.equal(constants.resolvePostRecordingStatus('recorded', 'restore'), 'recorded',
    'restore 恢复基线 recorded');
  assert.equal(constants.resolvePostRecordingStatus('failed', 'restore'), 'failed',
    'restore 恢复基线 failed');
  assert.equal(constants.resolvePostRecordingStatus('draft', 'restore'), 'draft',
    'restore 恢复基线 draft');
  // 基线缺失/非持久态（如旧数据 baseline 被写成 recording）→ 兜底 draft。
  for (const badBase of ['recording', '', null, undefined]) {
    assert.equal(constants.resolvePostRecordingStatus(badBase, 'restore'), 'draft',
      `restore 非持久基线(${String(badBase)}) → draft`);
  }
}

// ---------------------------------------------------------------------------
// wiring：trajectory-dao 导出面（import 不连 DB，getDB 惰性）
// ---------------------------------------------------------------------------

function testDaoExports() {
  if (!daoAvailable) { console.log('    (skipped: trajectory-dao not importable)'); return; }
  for (const fnName of [
    'enterTransientRecording',
    'finishTransientRecording',
    'restorePersistentRecordStatus',
    'setPersistentRecordStatus',
    'updateMetaIf',
    'updateMeta',
  ]) {
    assert.equal(typeof trajectoryDao[fnName], 'function', `trajectory-dao 导出 ${fnName}`);
  }
}

// ---------------------------------------------------------------------------
// wiring：源码结构断言（readFileSync + assert.match）
// ---------------------------------------------------------------------------

function testWiringEnterTransientRecording() {
  const src = daoSource();
  // enterTransientRecording：基线链 recordStatus(持久) → persistentRecordStatus(持久) → draft，
  // 写 recording + 回写基线，返回 { recordStatus:'recording', persistentBase }。
  const body = src.slice(src.indexOf('export async function enterTransientRecording'),
    src.indexOf('export async function finishTransientRecording'));
  assert.ok(body.length > 0, 'enterTransientRecording 函数体存在');
  assert.match(body,
    /isPersistentRecordStatus\(row\.recordStatus\)\s*\?\s*row\.recordStatus\s*:\s*\(isPersistentRecordStatus\(row\.persistentRecordStatus\)\s*\?\s*row\.persistentRecordStatus\s*:\s*'draft'\)/,
    '基线选择链：持久 recordStatus → 持久 persistentRecordStatus → draft');
  assert.match(body, /updateMeta\(trajectoryDbId, \{ recordStatus: 'recording' \}\)/,
    '写入临时态 recordStatus=recording');
  assert.match(body, /updateMeta\(trajectoryDbId, \{ persistentRecordStatus: base \}\)/,
    '录制前先落持久基线 persistent_record_status');
  assert.match(body, /\{ recordStatus: 'recording', persistentBase: base \}/,
    '返回 recording + persistentBase');
  assert.match(body, /if \(!row\) return \{ recordStatus: 'recording', persistentBase: 'draft' \}/,
    '轨迹行不存在时兜底 {recording, draft}');
}

function testWiringFinishTransientRecording() {
  const src = daoSource();
  // finishTransientRecording：恢复基线调用链
  // getRecordStatusRow → 基线(非持久则 draft) → resolvePostRecordingStatus → writeRecordStatusResilient。
  const body = src.slice(src.indexOf('export async function finishTransientRecording'),
    src.indexOf('export async function restorePersistentRecordStatus'));
  assert.ok(body.length > 0, 'finishTransientRecording 函数体存在');
  assert.match(body, /await getRecordStatusRow\(trajectoryDbId\)/,
    '先读双状态行（含持久基线）');
  assert.match(body,
    /isPersistentRecordStatus\(row\?\.persistentRecordStatus\)\s*\?\s*row\.persistentRecordStatus\s*:\s*'draft'/,
    '基线取 persistentRecordStatus（持久态校验），否则 draft');
  assert.match(body, /resolvePostRecordingStatus\(base, outcome\)/,
    '结果态由 resolvePostRecordingStatus(base, outcome) 解析');
  assert.match(body, /writeRecordStatusResilient\(trajectoryDbId, next, trx\)/,
    '经 writeRecordStatusResilient 同步写双状态字段');
}

function testWiringRestorePersistentRecordStatus() {
  const src = daoSource();
  const body = src.slice(src.indexOf('export async function restorePersistentRecordStatus'),
    src.indexOf('export async function setPersistentRecordStatus'));
  assert.ok(body.length > 0, 'restorePersistentRecordStatus 函数体存在');
  assert.match(body, /if \(!row\) return null/, '轨迹不存在 → null');
  assert.match(body, /if \(row\.recordStatus !== 'recording'\)/,
    '非录制中分支存在（不覆盖当前状态）');
  assert.match(body, /return row\.recordStatus/,
    '非录制中仅同步基线并返回当前状态');
  assert.match(body, /writeRecordStatusResilient\(trajectoryDbId, base, trx\)/,
    '录制中分支恢复到持久基线');
  assert.match(body, /trajectory_phase[\s\S]*?status: 'running'[\s\S]*?status: 'pending', completed_at: null/,
    '非终结性释放：running 阶段重置为 pending（completed_at 置空）');
}

function testWiringSetPersistentRecordStatus() {
  const src = daoSource();
  const body = src.slice(src.indexOf('export async function setPersistentRecordStatus'),
    src.indexOf('export async function getMaxStepNumber'));
  assert.ok(body.length > 0, 'setPersistentRecordStatus 函数体存在');
  // CAS：非持久态直接拒绝（0 行受影响），持久态经 writeRecordStatusResilient 落双字段。
  assert.match(body, /if \(!PERSISTENT_RECORD_STATUSES\.includes\(status\)\) return 0/,
    '非持久态 CAS 拒绝：return 0');
  assert.match(body, /return writeRecordStatusResilient\(trajectoryDbId, status, trx\)/,
    '持久态经 writeRecordStatusResilient 写入');
}

function testWiringUpdateMetaIfCas() {
  const src = daoSource();
  const body = src.slice(src.indexOf('export async function updateMetaIf'),
    src.indexOf('export async function getRecordStatusRow'));
  assert.ok(body.length > 0, 'updateMetaIf 函数体存在');
  assert.match(body, /Array\.isArray\(recordStatusIn\) && recordStatusIn\.length/,
    'recordStatusIn 为非空数组才启用 CAS 条件');
  assert.match(body, /whereIn\('record_status', recordStatusIn\)/,
    'CAS 条件：whereIn record_status');
  assert.match(body, /return q\.update\(patch\)/, '条件 update 执行 patch');
  assert.match(body, /if \(!Object\.keys\(patch\)\.length\) return 0/, '空 patch 返回 0');
}

function testWiringWriteRecordStatusResilient() {
  const src = daoSource();
  // 私有 writeRecordStatusResilient：record_status 必写，persistent 列缺失时降级 warn。
  const body = src.slice(src.indexOf('async function writeRecordStatusResilient'),
    src.indexOf('export async function enterTransientRecording'));
  assert.ok(body.length > 0, 'writeRecordStatusResilient 函数体存在');
  assert.match(body, /updateMeta\(trajectoryDbId, \{ recordStatus: next \}, trx\)/,
    'record_status 必写');
  assert.match(body, /try \{\s*await updateMeta\(trajectoryDbId, \{ persistentRecordStatus: next \}, trx\);\s*\} catch/,
    'persistent_record_status 尽力写（try/catch）');
  assert.match(body, /persistent_record_status write skipped for #/,
    '列缺失降级时输出 warn 日志');
}

function testWiringDualStatusFields() {
  const src = daoSource();
  // 双状态字段并存：getRecordStatusRow 同时读 record_status 与 persistent_record_status。
  const body = src.slice(src.indexOf('export async function getRecordStatusRow'),
    src.indexOf('async function writeRecordStatusResilient'));
  assert.match(body, /first\('record_status'\)/, '读 record_status');
  assert.match(body, /first\('persistent_record_status'\)/, '读 persistent_record_status');
  assert.match(body, /persistentRecordStatus = pr\?\.persistent_record_status \?\? null/,
    '旧库缺列时 persistentRecordStatus 兜底 null');
}

function testWiringCallChains() {
  // 显式结束录制 → finishTransientRecording(success/failure)；非终结性释放 → restorePersistentRecordStatus。
  const lifecycle = readFileSync(join(root, 'src/services/trajectory/trajectory-record-lifecycle.js'), 'utf8');
  assert.match(lifecycle, /finishTransientRecording\(\s*tid,\s*success \? 'success' : 'failure',?\s*\)/,
    'record stop：finishTransientRecording 按 success/failure 解析结果态');
  const runner = readFileSync(join(root, 'src/services/trajectory/trajectory-recording-runner.js'), 'utf8');
  assert.match(runner, /finishTransientRecording\(tid, 'success'\)/, '录制成功 → outcome success');
  assert.match(runner, /finishTransientRecording\(tid, 'failure'\)/, '录制失败 → outcome failure');
  assert.match(runner, /enterTransientRecording\(tid\)/, '录制启动 → enterTransientRecording');
  // 非终结性（关浏览器/断开/回收）：clearMount / repairStale 链走 restorePersistentRecordStatus。
  assert.match(daoSource(),
    /demoteLive && row\.record_status === 'recording'[\s\S]{0,400}restorePersistentRecordStatus\(row\.id, db\)/,
    'clearMountByRemoteSessionId 对 recording 轨迹恢复持久基线');
  const batch = readFileSync(join(root, 'src/services/trajectory/trajectory-batch-service.js'), 'utf8');
  assert.match(batch, /restorePersistentRecordStatus\(tid\)/, '批量回收链恢复持久基线');
  const attach = readFileSync(join(root, 'src/services/trajectory/trajectory-attach-service.js'), 'utf8');
  assert.match(attach, /restorePersistentRecordStatus\(tid\)/, 'attach 释放链恢复持久基线');
}

function testWiringConfirmAndCasUsages() {
  // 确认/取消确认走 setPersistentRecordStatus + updateMetaIf CAS（recordStatusIn 条件）。
  const meta = readFileSync(join(root, 'src/services/trajectory/trajectory-meta-service.js'), 'utf8');
  assert.match(meta, /setPersistentRecordStatus\(tid, 'completed'\)/, '确认 → completed 持久态');
  assert.match(meta, /updateMetaIf\(tid, \{[\s\S]{0,200}recordStatus: 'recorded',[\s\S]{0,200}\}, \{ recordStatusIn: \['completed'\] \}\)/,
    '取消确认 CAS：仅 completed 态可降回 recorded');
  assert.match(meta, /persistentRecordStatus: 'recorded'[\s\S]{0,120}recordStatusIn: \['recorded'\]/,
    '取消确认后同步持久基线 recorded（CAS recordStatusIn）');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  console.log('\n=== recordStatus state machine characterization ===\n');
  const tests = [
    ['行为: PERSISTENT_RECORD_STATUSES 四持久态，不含 recording', testPersistentStatusesExcludeRecording],
    ['行为: TRAJECTORY_RECORD_STATUSES 五态（含临时态 recording）', testTrajectoryStatusesIncludeRecording],
    ['行为: isPersistentRecordStatus 持久态 true / recording 与空值 false', testIsPersistentRecordStatus],
    ['行为: resolvePostRecordingStatus success → recorded（覆盖基线）', testResolvePostRecordingSuccess],
    ['行为: resolvePostRecordingStatus failure → failed（覆盖基线）', testResolvePostRecordingFailure],
    ['行为: resolvePostRecordingStatus restore → 恢复持久基线，坏基线兜底 draft', testResolvePostRecordingRestore],
    ['wiring: trajectory-dao 导出状态机函数（enter/finish/restore/set/updateMetaIf/updateMeta）', testDaoExports],
    ['wiring: enterTransientRecording 基线链 + 写 recording + 落基线', testWiringEnterTransientRecording],
    ['wiring: finishTransientRecording 调用链 getRecordStatusRow→resolve→writeResilient', testWiringFinishTransientRecording],
    ['wiring: restorePersistentRecordStatus 三分支（无行/非录制中/录制中）', testWiringRestorePersistentRecordStatus],
    ['wiring: setPersistentRecordStatus 非持久态 CAS 拒绝', testWiringSetPersistentRecordStatus],
    ['wiring: updateMetaIf 条件更新 whereIn record_status（CAS）', testWiringUpdateMetaIfCas],
    ['wiring: writeRecordStatusResilient 必写 record_status，persistent 缺列降级 warn', testWiringWriteRecordStatusResilient],
    ['wiring: 双状态字段 record_status + persistent_record_status（getRecordStatusRow）', testWiringDualStatusFields],
    ['wiring: 调用链 显式结束→finishTransientRecording，非终结→restorePersistentRecordStatus', testWiringCallChains],
    ['wiring: 确认/取消确认 setPersistentRecordStatus + updateMetaIf CAS', testWiringConfirmAndCasUsages],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }
  console.log(failed ? '\nFAIL' : '\nOK');
  process.exitCode = failed ? 1 : 0;
}

main();
