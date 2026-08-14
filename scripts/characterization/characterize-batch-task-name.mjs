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

  const failedCount = failed;
  console.log(failedCount ? `\n${failedCount} failed` : '\nall ok');
  process.exit(failedCount ? 1 : 0);
}

main();
