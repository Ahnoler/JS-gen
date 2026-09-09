#!/usr/bin/env node
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { collectPageCodes, sanitizeTaskDraftKeyData, isLegacyZjjkOnlyKeyData } = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/atom-keydata.js')).href,
);

let failed = 0;
async function run(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL - ${name}: ${e.message}`);
  }
}

console.log('characterize-atom-keydata');

await run('collectPageCodes merges llm + draft + cells, dedupes preserve order', () => {
  const out = collectPageCodes({
    llmPageCodes: ['ZJJK00107304', 'zjjk00107304', 'ZJJK00999999'],
    taskDraft: '1、进入主页（ZJJK00111111）。\n关键数据\n分类：A\n',
    zjjkCells: ['ZJJK00107304 / ZJJK00122222', '—'],
  });
  assert.deepEqual(out, [
    'ZJJK00107304',
    'ZJJK00999999',
    'ZJJK00111111',
    'ZJJK00122222',
  ]);
});

await run('sanitize strips ZJJK-only 关键数据 block and returns codes', () => {
  const raw =
    '1、进入产品库。\n\n来源：demo.docx\n\n关键数据\nZJJK00107304\n大页面：ZJJK00136564\n';
  const { taskDraft, extractedCodes } = sanitizeTaskDraftKeyData(raw);
  assert.equal(taskDraft.includes('关键数据'), false);
  assert.deepEqual(extractedCodes, ['ZJJK00107304', 'ZJJK00136564']);
  assert.match(taskDraft, /来源：demo\.docx/);
});

await run('sanitize keeps business KV lines; drops pure ZJJK lines', () => {
  const raw =
    '1、填表。\n\n关键数据\n分类名称：KB测\nZJJK00107304\n序号：1\n';
  const { taskDraft, extractedCodes } = sanitizeTaskDraftKeyData(raw);
  assert.match(taskDraft, /关键数据/);
  assert.match(taskDraft, /分类名称：KB测/);
  assert.match(taskDraft, /序号：1/);
  assert.equal(taskDraft.includes('ZJJK00107304'), false);
  assert.deepEqual(extractedCodes, ['ZJJK00107304']);
});

await run('isLegacyZjjkOnlyKeyData true for ZJJK-only body', () => {
  assert.equal(
    isLegacyZjjkOnlyKeyData('1、x\n\n关键数据\nZJJK00107304\nZJJK00136564\n'),
    true,
  );
  assert.equal(
    isLegacyZjjkOnlyKeyData('1、x\n\n关键数据\n分类名称：A\n'),
    false,
  );
});

if (failed) process.exit(1);
console.log('all passed');
