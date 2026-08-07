/**
 * Characterization smoke for batch Excel parse / template (no DB / LLM / executor).
 *
 * Usage: node scripts/characterization/characterize-batch-import.mjs
 */
import assert from 'assert';
import {
  buildTemplateBuffer,
  parseBatchExcelBuffer,
  BATCH_EXCEL_HEADERS,
  sampleTemplateRows,
} from '../../src/services/trajectory-batch-excel.js';
import { buildRequestHash } from '../../src/services/trajectory-batch-service.js';
import {
  BATCH_JOB_MODES,
  BATCH_JOB_STATUSES,
  BATCH_ITEM_STATUSES,
  BATCH_ITEM_RESUMABLE,
  BATCH_ITEM_TERMINAL,
} from '../../src/models/constants.js';
import { deriveJobTerminalStatus } from '../../src/dao/batch-recording-dao.js';

let failed = 0;

function ok(name) {
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed += 1;
  console.error(`  ✗ ${name}:`, err?.message || err);
}

async function testTemplateRoundTrip() {
  const buf = await buildTemplateBuffer();
  assert.ok(Buffer.isBuffer(buf) && buf.length > 100, 'template buffer');
  const parsed = await parseBatchExcelBuffer(buf);
  assert.strictEqual(parsed.valid.length, 1, 'one sample row');
  assert.strictEqual(parsed.valid[0].name, sampleTemplateRows()[0].name);
  assert.ok(parsed.valid[0].requirement.includes('登录'));
  assert.strictEqual(parsed.rejected.length, 0);
  ok('template round-trip');
}

async function testRejectEmptyAndPartial() {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('t');
  ws.addRow([...BATCH_EXCEL_HEADERS]);
  ws.addRow(['', '']); // empty — skip
  ws.addRow(['有名无需求', '']); // rejected
  ws.addRow(['', '有需求无名']); // rejected
  ws.addRow(['正常交易', '1、步骤一']); // valid
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parseBatchExcelBuffer(buf);
  assert.strictEqual(parsed.skippedEmpty, 1);
  assert.strictEqual(parsed.rejected.length, 2);
  assert.strictEqual(parsed.valid.length, 1);
  assert.strictEqual(parsed.valid[0].name, '正常交易');
  ok('empty skip + partial reject');
}

async function testBadHeader() {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('t');
  ws.addRow(['名称', '描述']);
  ws.addRow(['a', 'b']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  let threw = false;
  try {
    await parseBatchExcelBuffer(buf);
  } catch (err) {
    threw = true;
    assert.strictEqual(err.code, 'VALIDATION');
  }
  assert.ok(threw, 'bad header should throw');
  ok('bad header rejected');
}

async function testMaxRows() {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('t');
  ws.addRow([...BATCH_EXCEL_HEADERS]);
  for (let i = 0; i < 5; i++) ws.addRow([`n${i}`, `r${i}`]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  let threw = false;
  try {
    await parseBatchExcelBuffer(buf, { maxRows: 3 });
  } catch (err) {
    threw = /上限/.test(err.message);
  }
  assert.ok(threw, 'max rows should throw');
  ok('max rows enforced');
}

function testRequestHash() {
  const a = buildRequestHash({
    fileBuffer: Buffer.from('abc'),
    functionId: 1,
    systemAccountId: 2,
    model: 'm',
  });
  const b = buildRequestHash({
    fileBuffer: Buffer.from('abc'),
    functionId: 1,
    systemAccountId: 2,
    model: 'm',
  });
  const c = buildRequestHash({
    fileBuffer: Buffer.from('abd'),
    functionId: 1,
    systemAccountId: 2,
    model: 'm',
  });
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, c);
  ok('request hash stable');
}

function testConstantsAndTerminal() {
  assert.ok(BATCH_JOB_MODES.includes('draft'));
  assert.ok(BATCH_JOB_MODES.includes('record'));
  assert.ok(BATCH_JOB_STATUSES.includes('completed_with_errors'));
  assert.ok(BATCH_ITEM_STATUSES.includes('waiting_executor'));
  assert.ok(BATCH_ITEM_STATUSES.includes('drafted'));
  assert.ok(BATCH_ITEM_RESUMABLE.includes('analyzed'));
  assert.ok(BATCH_ITEM_TERMINAL.includes('rejected'));
  assert.ok(BATCH_ITEM_TERMINAL.includes('drafted'));

  assert.strictEqual(
    deriveJobTerminalStatus({
      accepted: 2, recorded: 2, failed: 0, rejected: 0, cancelled: 0,
      pending: 0, analyzing: 0, analyzed: 0, queued: 0, waitingExecutor: 0,
      preparing: 0, recording: 0,
    }),
    'completed',
  );
  assert.strictEqual(
    deriveJobTerminalStatus({
      accepted: 2, recorded: 1, failed: 1, rejected: 0, cancelled: 0,
      pending: 0, analyzing: 0, analyzed: 0, queued: 0, waitingExecutor: 0,
      preparing: 0, recording: 0,
    }),
    'completed_with_errors',
  );
  assert.strictEqual(
    deriveJobTerminalStatus({
      accepted: 2, recorded: 0, failed: 2, rejected: 0, cancelled: 0,
      pending: 0, analyzing: 0, analyzed: 0, queued: 0, waitingExecutor: 0,
      preparing: 0, recording: 0,
    }),
    'failed',
  );
  assert.strictEqual(
    deriveJobTerminalStatus({
      accepted: 2, recorded: 1, failed: 0, rejected: 0, cancelled: 0,
      pending: 0, analyzing: 0, analyzed: 0, queued: 0, waitingExecutor: 0,
      preparing: 0, recording: 1,
    }),
    null,
  );
  assert.strictEqual(
    deriveJobTerminalStatus({
      accepted: 2, recorded: 0, drafted: 2, failed: 0, rejected: 0, cancelled: 0,
      pending: 0, analyzing: 0, analyzed: 0, queued: 0, waitingExecutor: 0,
      preparing: 0, recording: 0,
    }),
    'completed',
  );
  assert.strictEqual(
    deriveJobTerminalStatus({
      accepted: 2, recorded: 0, drafted: 1, failed: 1, rejected: 0, cancelled: 0,
      pending: 0, analyzing: 0, analyzed: 0, queued: 0, waitingExecutor: 0,
      preparing: 0, recording: 0,
    }),
    'completed_with_errors',
  );
  ok('job terminal derivation');
}

async function main() {
  console.log('\n=== characterize-batch-import ===\n');
  for (const [name, fn] of [
    ['templateRoundTrip', testTemplateRoundTrip],
    ['rejectEmptyAndPartial', testRejectEmptyAndPartial],
    ['badHeader', testBadHeader],
    ['maxRows', testMaxRows],
    ['requestHash', testRequestHash],
    ['constantsAndTerminal', testConstantsAndTerminal],
  ]) {
    try {
      await fn();
    } catch (err) {
      fail(name, err);
    }
  }
  console.log(failed ? `\nFAILED: ${failed}` : '\nAll passed.');
  process.exit(failed ? 1 : 0);
}

main();
