#!/usr/bin/env node
/**
 * Characterization: extractBusinessEntriesFromRequirement + extractBusinessDataBlock (no LLM).
 *   node scripts/characterization/characterize-analyze-case-data.mjs
 */
import {
  extractBusinessDataBlock,
  extractBusinessEntriesFromRequirement,
} from '../../src/services/trajectory/trajectory-meta-service.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

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

console.log('characterize-analyze-case-data: OK');
