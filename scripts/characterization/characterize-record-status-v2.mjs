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

  console.log(failed ? `\n${failed} failed` : '\nall ok');
  process.exit(failed ? 1 : 0);
}

main();
