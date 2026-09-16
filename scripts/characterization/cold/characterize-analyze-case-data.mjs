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

// Phase state-boundary rule: a phase whose expected result is「打开确认弹窗」must
// carry every action that opens it (选中行 + 点击删除); the modal button click
// belongs ONLY to the next phase. Prevents a phase's actions being split across
// the boundary (observed: 选中表格行/点击删除 recorded under the 点【确定】phase).
assert(analyzeSrc.includes('状态边界原则'), 'analyze rule pins phase state boundaries');
assert(
  analyzeSrc.includes('禁止让下一阶段承担上一阶段未完成的动作'),
  'analyze rule forbids prior-phase actions landing in the next phase',
);

// State-boundary rule hardening (same flow): rule 3 must defer to 3.1 for confirm
// dialogs; 3.1(c) merge is the exception only; 6.1 must keep filter field/values;
// rule 8 must make the record identity / filter condition explicit.
assert(
  analyzeSrc.includes('确认/提示弹窗」按 3.1 处理'),
  'rule 3 defers confirm-dialog boundaries to 3.1',
);
assert(
  analyzeSrc.includes('例外（仅在必要时）') && analyzeSrc.includes('不得为省事而合并'),
  '3.1(c) merge stays a narrow exception',
);
assert(
  analyzeSrc.includes('若所列的字段名/取值是后续本阶段或下一阶段要操作的筛选条件'),
  '6.1 keeps filter field names/values (no clash with rules 7/8)',
);
assert(
  analyzeSrc.includes('若原文未给出唯一标识') && analyzeSrc.includes('选中首条匹配记录'),
  'rule 8 requires record identity or explicit filter condition',
);
// A worked few-shot for the boundary rule (nothing pinned it before).
assert(
  analyzeSrc.includes('示例6：确认弹窗的状态边界') && analyzeSrc.includes('弹窗内【确定】只归下一阶段'),
  'analyze prompt ships a confirm-dialog boundary example',
);

// 业务数据 classification: the real delete+confirm phase text must opt in (this JS
// classifier disagreed with Python needs_business_data_context, which said true),
// while a pure confirm-click phase and pure open-page stay out.
const realDeletePhase =
  '在业务记录列表中先搜索/查询"审批状态"为"待发起"的记录，再单选选中该记录，点击【删除】按钮。'
  + '预期结果：打开"您确定删除这条记录吗?"确认弹窗。';
assert(
  phaseNeedsBusinessData(realDeletePhase) === true,
  'delete phase ending on a confirm dialog needs biz data',
);
assert(
  phaseNeedsBusinessData(
    '在弹出的确认提示"您确定删除这条记录吗?"中，点击【确定】按钮。'
    + '预期结果：删除完成并刷新列表，该记录从列表中消失。',
  ) === false,
  'pure confirm-click phase (删除 only in the dialog copy) must not need biz data',
);
assert(
  phaseNeedsBusinessData('选中业务编号为 PJ20260907016008 的记录并点击【删除】。预期结果：打开确认弹窗。') === true,
  'row-select + delete needs biz data',
);

console.log('characterize-analyze-case-data: OK');
