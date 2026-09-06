/**
 * Characterization for trajectory record_status v2（枚举/文案/迁移/活跃判定）。
 * Usage: node scripts/characterization/characterize-record-status-v2.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  TRAJECTORY_RECORD_STATUSES,
  TRAJECTORY_RECORD_STATUS_LABELS,
} from '../../src/models/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let failed = 0;
function ok(name) { console.log(`  ✓ ${name}`); }
function fail(name, err) { failed += 1; console.error(`  ✗ ${name}:`, err?.message || err); }
function run(name, fn) { try { fn(); ok(name); } catch (err) { fail(name, err); } }

async function main() {
  run('five values, no live', () => {
    assert.deepStrictEqual(
      [...TRAJECTORY_RECORD_STATUSES],
      ['draft', 'recording', 'failed', 'recorded', 'completed'],
    );
  });
  run('chinese labels', () => {
    assert.deepStrictEqual(TRAJECTORY_RECORD_STATUS_LABELS, {
      draft: '未录制',
      recording: '录制中',
      failed: '录制异常',
      recorded: '待确认',
      completed: '已确认',
    });
  });
  run('migration: live→recording + enum', () => {
    const mig = readFileSync(join(ROOT, 'migrations', '20260814120000_trajectory_record_status_v2.js'), 'utf8');
    assert.ok(mig.includes("SET record_status = 'recording' WHERE record_status = 'live'"), 'live rows merged');
    assert.ok(mig.includes("ENUM('draft','recording','failed','recorded','completed')"), 'new enum');
    assert.ok(mig.includes('draft=未录制; recording=录制中; failed=录制异常; recorded=待确认; completed=已确认'), 'new comment');
  });
  run('init.sql enum sync', () => {
    const init = readFileSync(join(ROOT, 'schemas', 'init.sql'), 'utf8');
    assert.ok(init.includes("ENUM('draft','recording','failed','recorded','completed') NOT NULL DEFAULT 'draft'"), 'init enum');
    assert.ok(init.includes('draft=未录制'), 'init comment');
    assert.ok(!init.includes("'live'"), 'no live in init.sql record_status');
  });
  run('hasRunningPhase + isAiRecordingActive', () => {
    const dao = readFileSync(join(ROOT, 'src', 'dao', 'trajectory-dao.js'), 'utf8');
    assert.ok(dao.includes("status: 'running'"), 'hasRunningPhase running filter');
    assert.ok(dao.includes('export async function hasRunningPhase'), 'hasRunningPhase export');
    const utils = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-status-utils.js'), 'utf8');
    assert.ok(utils.includes('export async function isAiRecordingActive'), 'wrapper export');
    assert.ok(utils.includes('trajectoryDao.hasRunningPhase(trajectoryId)'), 'wrapper delegates');
  });
  run('start gate: AI-active recording → 409; pure-occupy can start', () => {
    // 4145e23 校准：录制中信号源 = 存在 running 阶段（isAiRecordingActive），而非瞬态 record_status；
    // 门禁为单条件 AI-active 检查（并发录制无论持久状态一律拦截，pure-occupy 放行）。
    const runner = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-recording-runner.js'), 'utf8');
    assert.ok(runner.includes('if (await isAiRecordingActive(tid)) {'), 'gate uses AI-active check');
    assert.ok(!runner.includes("recordStatus === 'recording' && (await isAiRecordingActive"), 'gate must not gate on transient record_status');
  });
  run('batch CAS-lost: live detach + recovery-path cleanup exists', () => {
    // 4145e23 校准：CAS 丢占用 → 轻量 detach(batch_cas_lost)，资源清理统一由重启恢复路径兜底；
    // 恢复路径对 preparing/recording 中断 item 仍执行 cleanupPersistedTrajectoryResources。
    const rec = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'batch-record.js'), 'utf8');
    assert.ok(rec.includes("reason: 'batch_cas_lost'"), 'CAS-lost path detaches live');
    const svc = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-batch-service.js'), 'utf8');
    assert.ok(svc.includes('cleanupPersistedTrajectoryResources(tid'), 'recovery path cleans persisted resources');
    assert.ok(svc.includes('restorePersistentRecordStatus'), 'recovery restores persistent base (no downgrade)');
  });

  run('step edit/move gate: AI-active only', () => {
    const svc = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-step-service.js'), 'utf8');
    assert.ok(svc.includes("traj?.recordStatus === 'recording' && (await isAiRecordingActive(tid))"), 'gate uses AI-active check');
    assert.ok(svc.includes('await assertNotBusyForStepEdit('), 'call sites await the async guard');
  });

  console.log(failed ? `\n${failed} failed` : '\nall ok');
  process.exit(failed ? 1 : 0);
}

main();
