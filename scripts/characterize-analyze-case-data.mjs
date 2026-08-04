#!/usr/bin/env node
/**
 * Characterization: extractCaseDataBlock (append-to-phase path, no KV split).
 *   node scripts/characterize-analyze-case-data.mjs
 */
import {
  extractCaseDataBlock,
  extractCaseEntriesFromRequirement,
} from '../src/services/trajectory-meta-service.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sample = [
  '1、点击客户管理，点击对公客户管理。',
  '2、新增一个对公潜在客户。',
  '',
  '关键数据',
  '对公客户基本信息：',
  '           法定责任人的客户名称：朱桂武',
  '客户标签：',
].join('\n');

const block = extractCaseDataBlock(sample);
assert(block.includes('关键数据'), 'header');
assert(block.includes('法定责任人的客户名称：朱桂武'), 'name line');
assert(block.includes('客户标签：'), 'empty label line kept');
assert(!block.includes('点击客户管理'), 'steps excluded');

const empty = extractCaseDataBlock('1. 登录系统\n2. 查询客户');
assert(empty === '', 'no case block');

// Legacy KV helper still works for characterize
const kv = extractCaseEntriesFromRequirement([
  '关键数据',
  '客户名称：测试公司111',
  '证件号码：11111111111',
].join('\n'));
assert(kv.length === 2, `kv len=${kv.length}`);

console.log('characterize-analyze-case-data: OK');
