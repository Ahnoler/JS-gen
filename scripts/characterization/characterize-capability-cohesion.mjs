#!/usr/bin/env node
/**
 * Capability-cohesion structural gate pins (spec 2026-09-16).
 * Cold: no live LLM. Helper-first; propose wiring pins live in later runs of this file.
 *
 * Run:
 *   node scripts/characterization/characterize-capability-cohesion.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HELPER_PATH = join(ROOT, 'src/services/req-draft-traj/capability-cohesion.js');
const mod = await import(pathToFileURL(HELPER_PATH).href);

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

const FALLBACK_THREE_GROUPS = [
  '1、新增一级分类，操作：【新增一级分类】→【确定】',
  '2、选中分类下新增子分类，操作：【新增分类】→【确定】',
  '3、分类下新增产品，操作：【新增产品】→【确定】',
  '',
  '来源：demo.docx / chapters/01-product-library.md',
  '',
].join('\n');

const PROMPT_GOOD_MAINTAIN = [
  '1、进入功能页，等待加载',
  '2、搜索/定位并选中已有对象',
  '3、打开该项能力对应的表单或页签，填写本能力字段',
  '4、一次【保存】成功',
  '',
  '来源：demo.docx / chapters/01-product-library.md',
  '',
  '关键数据',
  '已有对象：KB测对象',
  '已维护对象：KB测对象',
].join('\n');

const C1_MERGED_MAINTAIN_REORDER = [
  '1、进入功能页，等待加载',
  '2、搜索并选中已有对象',
  '3、维护基本信息并【保存】',
  '4、上移/下移该项',
].join('\n');

const C5_SINGLE_GROUP = '1、操作：维护基本信息后上移该项并【保存】';

console.log('characterize-capability-cohesion');

await run('parse: fallback 顿号 draft yields 3 groups; 来源 stripped', () => {
  const groups = mod.parseTaskDraftStepGroups(FALLBACK_THREE_GROUPS);
  assert.equal(groups.length, 3);
  assert.match(groups[0].haystack, /新增一级分类/);
  assert.doesNotMatch(groups.map((g) => g.raw).join('\n'), /来源：/);
});

await run('parse: dotted numbering plus 操作: halfwidth colon', () => {
  const groups = mod.parseTaskDraftStepGroups('1. 进入功能页\n2. 操作:【保存】');
  assert.equal(groups.length, 2);
  assert.match(groups[1].haystack, /【保存】/);
  assert.doesNotMatch(groups[1].haystack, /操作:/);
});

await run('parse: no numbered steps → one group of remaining body', () => {
  const groups = mod.parseTaskDraftStepGroups('进入功能页，等待加载\n来源：x');
  assert.equal(groups.length, 1);
  assert.match(groups[0].haystack, /进入功能页/);
});

await run('C5 classify: single haystack 维护+上移 → multi with both families', () => {
  const info = mod.inspectCapabilityGroup('维护基本信息后上移该项并【保存】');
  assert.equal(info.role, 'multi');
  assert.ok(info.families.includes('maintain'));
  assert.ok(info.families.includes('reorder'));
});

await run('classify: 填写+【保存】 same group is other not multi', () => {
  assert.equal(
    mod.classifyCapabilityGroup('打开该项能力对应的表单或页签，填写本能力字段并【保存】'),
    'other',
  );
});

await run('classify: 选中 then 启用 (unique persist-as-capability) is persist', () => {
  assert.equal(mod.classifyCapabilityGroup('选中对象后启用'), 'persist');
});

await run('classify: 未启用 is not persist-as-capability via 启用', () => {
  assert.equal(mod.classifyCapabilityGroup('状态为未启用，等待加载'), 'locate');
});

await run('classify: unknown prose is neutral', () => {
  assert.equal(mod.classifyCapabilityGroup('本笔只改名称字段的说明文字'), 'neutral');
});

await run('C1 helper: locate + maintain/save + reorder → multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护并排序',
    taskDraft: C1_MERGED_MAINTAIN_REORDER,
    produces: ['已维护对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('C5 helper: one numbered step 维护+上移 → multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护',
    taskDraft: C5_SINGLE_GROUP,
    produces: ['已维护对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('C2 helper: locate* → fill → one save passes', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: PROMPT_GOOD_MAINTAIN,
    produces: ['已维护对象'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('C6 helper: numbered fill then closer-only 【保存】 passes', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: [
      '1、进入功能页，等待加载',
      '2、搜索并选中已有对象',
      '3、填写本能力字段',
      '4、一次【保存】成功',
    ].join('\n'),
    produces: ['已维护对象'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('sequence: trailing locate after save still passes this gate', () => {
  const out = mod.assertCapabilityCohesion({
    title: '保存后查询说明',
    taskDraft: [
      '1、进入功能页',
      '2、【保存】',
      '3、查询列表确认',
    ].join('\n'),
    produces: ['已保存对象'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('sequence: 维护 + 启用 is multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护并启用',
    taskDraft: '1、维护字段并【保存】\n2、启用该项',
    produces: ['已维护对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('sequence: locate → persist → other is multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '保存后再维护',
    taskDraft: '1、进入功能页\n2、【保存】\n3、填写本能力字段',
    produces: ['已保存对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('sequence: reorder then maintain+save is multi_capability_task_draft', () => {
  const out = mod.assertCapabilityCohesion({
    title: '先排序再维护',
    taskDraft: '1、上移该项\n2、维护字段并【保存】',
    produces: ['已维护对象'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'multi_capability_task_draft');
});

await run('helper source has no scene blacklist literals', () => {
  const src = readFileSync(HELPER_PATH, 'utf8');
  assert.equal(src.includes('维护基本信息'), false);
  assert.equal(src.includes('不得出现上移'), false);
  assert.equal(src.includes('一级分类'), false);
});

if (failed) process.exit(1);
console.log('all passed');
