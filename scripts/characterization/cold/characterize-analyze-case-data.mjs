#!/usr/bin/env node
/**
 * Characterization: extractBusinessEntriesFromRequirement + extractBusinessDataBlock (no LLM).
 *   node scripts/characterization/cold/characterize-analyze-case-data.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  extractBusinessDataBlock,
  extractBusinessEntriesFromRequirement,
  phaseNeedsBusinessData,
} from '../../../src/services/trajectory/trajectory-meta-service.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

const sample = [
  '1、点击客户管理，点击对公客户管理。',
  '2、新增一个对公潜在客户。',
  '',
  '关键数据',
  '客户名称：测试公司111',
  '证件号码：11111111111',
].join('\n');

const entries = extractBusinessEntriesFromRequirement(sample);
assert(entries.length === 2, `expected 2 entries, got ${JSON.stringify(entries)}`);
assert(entries[0].fieldKey === '客户名称' && entries[0].fieldValue === '测试公司111', 'name');
assert(entries[1].fieldKey === '证件号码' && entries[1].fieldValue === '11111111111', 'idno');

const empty = extractBusinessEntriesFromRequirement('1. 登录系统\n2. 查询客户');
assert(empty.length === 0, 'no case block → empty');

const inline = extractBusinessEntriesFromRequirement('案例数据：客户名称：ACME\n手机号=13800138000');
assert(inline.some((e) => e.fieldKey === '客户名称' && e.fieldValue === 'ACME'), 'inline header');
assert(inline.some((e) => e.fieldKey === '手机号' && e.fieldValue === '13800138000'), 'eq form');

// extractBusinessDataBlock (append-to-phase path): block extraction keeps header/label lines, excludes steps.
const blockSample = [
  '1、点击客户管理，点击对公客户管理。',
  '2、新增一个对公潜在客户。',
  '',
  '关键数据',
  '对公客户基本信息：',
  '           法定责任人的客户名称：朱桂武',
  '客户标签：',
].join('\n');

const block = extractBusinessDataBlock(blockSample);
assert(block.includes('关键数据'), 'block header');
assert(block.includes('法定责任人的客户名称：朱桂武'), 'block name line');
assert(block.includes('客户标签：'), 'block empty label line kept');
assert(!block.includes('点击客户管理'), 'block steps excluded');

const emptyBlock = extractBusinessDataBlock('1. 登录系统\n2. 查询客户');
assert(emptyBlock === '', 'no case block');

// #676: search / locate phases must opt into 业务数据 on the control-plane side too
const searchPhase =
  '在产品树搜索并选中一级分类「KB测一级-20260907-1835」。预期结果：该节点被选中。';
assert(phaseNeedsBusinessData(searchPhase) === true, '#676 search-locate needs biz');
assert(
  phaseNeedsBusinessData('按客户名称查询。预期结果：列表展示匹配行。') === true,
  '#676 pure query needs biz',
);
assert(
  phaseNeedsBusinessData('点击客户管理。预期结果：抵达对公客户管理页面。') === false,
  'open-page still skips biz',
);

// #676 analyze prompt: keep step targets; do not vague-out to bare「关键字」
const analyzeSrc = readFileSync(
  path.join(ROOT, 'src/services/trajectory/trajectory-meta-service.js'),
  'utf8',
);
assert(analyzeSrc.includes('必须原样保留'), 'analyze rule keeps user targets');
assert(analyzeSrc.includes('禁止把具体名抹成'), 'analyze rule forbids vague rewrite');
assert(!/不要在 phases 字符串里复制任何业务数据/.test(analyzeSrc), 'old wipe-all rule 7 gone');

console.log('characterize-analyze-case-data: OK');
