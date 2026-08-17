/**
 * Characterization smoke for batch task name（公式 / 迁移标记 / 列表统计）。
 * Usage: node scripts/characterization/characterize-batch-task-name.mjs
 */
import assert from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  stripExtension,
  formatMonthDayHourMinute,
  defaultJobName,
  BATCH_JOB_NAME_MAX_FILENAME,
} from '../../src/services/trajectory/batch-job-name.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let failed = 0;
function ok(name) { console.log(`  ✓ ${name}`); }
function fail(name, err) { failed += 1; console.error(`  ✗ ${name}:`, err?.message || err); }

function run(name, fn) {
  try { fn(); ok(name); } catch (err) { fail(name, err); }
}

async function main() {
  run('default name 模板_0814-1251', () => {
    assert.strictEqual(
      defaultJobName('批量录制导入模板.xlsx', new Date(2026, 7, 14, 12, 51)),
      '批量录制导入模板_0814-1251',
    );
  });
  run('strip last extension only', () => {
    assert.strictEqual(stripExtension('a.b.xlsx'), 'a.b');
    assert.strictEqual(stripExtension('noext'), 'noext');
    assert.strictEqual(stripExtension('.xlsx'), '.xlsx');
  });
  run('empty filename falls back to 批量导入', () => {
    const out = defaultJobName('', new Date(2026, 7, 14, 12, 51));
    assert.ok(out.startsWith('批量导入_'), out);
  });
  run('truncates filename part to 501', () => {
    const long = 'x'.repeat(600) + '.xlsx';
    const out = defaultJobName(long, new Date(2026, 7, 14, 12, 51));
    assert.strictEqual(out.length, BATCH_JOB_NAME_MAX_FILENAME + '_0814-1251'.length);
    assert.ok(out.startsWith('x'.repeat(BATCH_JOB_NAME_MAX_FILENAME)));
  });
  run('formats MMDD-HHmm with zero padding', () => {
    assert.strictEqual(formatMonthDayHourMinute(new Date(2026, 0, 5, 8, 5)), '0105-0805');
  });
  run('migration 1: name column + backfill via shared formula', () => {
    const mig = readFileSync(join(ROOT, 'migrations', '20260814100000_batch_job_name.js'), 'utf8');
    assert.ok(mig.includes("t.string('name', 512)"), 'name VARCHAR(512)');
    assert.ok(mig.includes('defaultJobName(row.original_filename, row.created_at)'), 'backfill formula');
    assert.ok(mig.includes("from '../src/services/trajectory/batch-job-name.js'"), 'shared module import');
  });

  run('migration 2: trajectory.batch_job_id (UUID, FK) + init.sql column only', () => {
    const mig = readFileSync(join(ROOT, 'migrations', '20260814110000_trajectory_batch_job.js'), 'utf8');
    assert.ok(mig.includes("t.string('batch_job_id', 36)"), 'batch_job_id VARCHAR(36)');
    assert.ok(mig.includes('fk_traj_batch_job'), 'FK constraint');
    assert.ok(mig.includes('ON DELETE SET NULL'), 'FK on delete set null');
    const init = readFileSync(join(ROOT, 'schemas', 'init.sql'), 'utf8');
    assert.ok(init.includes('`batch_job_id`       VARCHAR(36)'), 'init.sql column');
    assert.ok(init.includes('KEY `idx_batch_job_id`'), 'init.sql index');
    assert.ok(!init.includes('fk_traj_batch_job'), 'init.sql must NOT contain the FK');
  });

  run('creation chain: route param / service formula / dao persist / view field', () => {
    const route = readFileSync(join(ROOT, 'src', 'routes', 'v2', 'trajectory-batch.js'), 'utf8');
    assert.ok(route.includes('name: req.body?.name'), 'route passes name');
    const svc = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-batch-service.js'), 'utf8');
    assert.ok(svc.includes('defaultJobName(originalFilename, new Date())'), 'service default formula');
    assert.ok(svc.includes("import { defaultJobName } from './batch-job-name.js'"), 'service import');
    assert.ok(svc.includes('name: job.name || \'\''), 'job view returns name');
    const dao = readFileSync(join(ROOT, 'src', 'dao', 'batch-recording-dao.js'), 'utf8');
    assert.ok(dao.includes('name: job.name || \'\''), 'dao persists name');
  });

  run('batch trajectory binding: batchJobId through save chain', () => {
    const meta = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'trajectory-meta-service.js'), 'utf8');
    assert.ok(meta.includes('batchJobId = null,'), 'meta accepts batchJobId');
    const dao = readFileSync(join(ROOT, 'src', 'dao', 'trajectory-dao.js'), 'utf8');
    assert.ok(dao.includes('batchJobId: trajectory.batchJobId ?? null'), 'dao save batchJobId');
    const analyze = readFileSync(join(ROOT, 'src', 'services', 'trajectory', 'batch-analyze.js'), 'utf8');
    assert.ok(analyze.includes('batchJobId: job.id'), 'analyze passes job.id');
  });

  run('trajectory list: join / fuzzy filter / stats', () => {
    const dao = readFileSync(join(ROOT, 'src', 'dao', 'trajectory-dao.js'), 'utf8');
    assert.ok(dao.includes("leftJoin({ bj: 'batch_recording_job' }, 'bj.id', 't.batch_job_id')"), 'left join');
    assert.ok(dao.includes("query.where('bj.name', 'like', `%${v}%`)"), 'fuzzy filter');
    assert.ok(dao.includes("select('t.*', 'bj.name as batchTaskName')"), 'row field');
    assert.ok(dao.includes('countByRecordStatus({ functionId, keyword, batchTaskName, paasUserId })'), 'stats by function');
    assert.ok(dao.includes('countByRecordStatus({ keyword, batchTaskName, paasUserId })'), 'stats without function');
    assert.ok(dao.includes("const stats = { total: 0 };"), 'stats shape');
    const route = readFileSync(join(ROOT, 'src', 'routes', 'v2', 'trajectory.js'), 'utf8');
    assert.ok(route.includes('batchTaskName: batchTaskName ?? null'), 'route passes param');
    const docs = readFileSync(join(ROOT, 'src', 'dashboard', 'api-docs', 'groups', 'trajectory.js'), 'utf8');
    assert.ok(docs.includes("name: 'batchTaskName', type: 'string'"), 'api-docs param');
    assert.ok(docs.includes('batchTaskName: \'批量录制导入模板_0814-1251\''), 'api-docs example');
  });

  const failedCount = failed;
  console.log(failedCount ? `\n${failedCount} failed` : '\nall ok');
  process.exit(failedCount ? 1 : 0);
}

main();
