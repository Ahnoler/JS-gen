#!/usr/bin/env node
/**
 * Capability-cohesion structural gate pins (spec 2026-09-16).
 * Cold: no live LLM. Helper-first; propose wiring pins live in later runs of this file.
 *
 * Run:
 *   node scripts/characterization/characterize-capability-cohesion.mjs
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HELPER_PATH = join(ROOT, 'src/services/req-draft-traj/capability-cohesion.js');
const mod = await import(pathToFileURL(HELPER_PATH).href);
process.env.KB_STAGING_DIR = mkdtempSync(join(tmpdir(), 'kb-observe-cohesion-'));
const { proposeDraftTrajectories } = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose.js')).href
);
const demoRoot = join(ROOT, 'scripts/characterization/fixtures/req-draft-traj/demo-mod');
const PRODUCT_LIBRARY_CARD = {
  _stem: 'product_library',
  flow: '产品库管理',
  keywords: ['新增一级分类', '新增产品'],
  menu_path: '产品管理→产品信息管理→产品库管理',
  preconditions: [],
  nodes: [{
    id: 'prod_add_dlg',
    page: '新增产品弹窗',
    enter: '从产品树新增',
    buttons: ['确定'],
    fields: ['名称'],
  }],
};

/**
 * @param {object} llmAtom One fake LLM atom (chainId/stepIndexes/title/taskDraft/…)
 * @returns {Promise<{ atoms: object[], rejected: object[] }>} Propose result
 */
async function proposeOne(llmAtom) {
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-cohesion-'));
  cpSync(demoRoot, join(tmp, 'demo-mod'), { recursive: true });
  const out = await proposeDraftTrajectories({
    moduleKey: 'demo-mod',
    rootDir: tmp,
    callLLM: async () => JSON.stringify({ atoms: [llmAtom] }),
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [PRODUCT_LIBRARY_CARD],
  });
  rmSync(tmp, { recursive: true, force: true });
  return out;
}

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

await run('classify: 进入编辑页，等待加载 is locate (or neutral), not other/multi', () => {
  const info = mod.inspectCapabilityGroup('进入编辑页，等待加载');
  assert.ok(
    info.role === 'locate' || info.role === 'neutral',
    `expected locate|neutral, got ${info.role} families=${JSON.stringify(info.families)}`,
  );
  assert.notEqual(info.role, 'other');
  assert.notEqual(info.role, 'multi');
  assert.equal(info.families.includes('maintain'), false);
});

await run('classify: 编辑字段 / 编辑基本信息 stay maintain other', () => {
  const fields = mod.inspectCapabilityGroup('编辑字段');
  assert.equal(fields.role, 'other');
  assert.ok(fields.families.includes('maintain'));
  const basic = mod.inspectCapabilityGroup('编辑基本信息');
  assert.equal(basic.role, 'other');
  assert.ok(basic.families.includes('maintain'));
});

await run('helper: locate 进入编辑页 + other 维护概况并【保存】 with business produce key passes', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护概况',
    taskDraft: '1、进入编辑页\n2、维护概况并【保存】',
    produces: ['信贷潜在客户'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('helper: locate 进入编辑页 + maintain + verify + closer-only 保存 passes', () => {
  const out = mod.assertCapabilityCohesion({
    title: '草稿客户转为信贷潜在客户',
    taskDraft: '1、进入编辑页\n2、维护概况\n3、联网核查\n4、保存',
    produces: ['信贷潜在客户'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('helper: fallback 操作：【保存概况】 then closer 【保存】 is cohesive', () => {
  const out = mod.assertCapabilityCohesion({
    title: '保存（信贷潜在客户）',
    taskDraft: [
      '1、进入编辑页',
      '2、维护概况（客户编辑页），操作：【保存概况】',
      '3、联网核查（客户编辑页），操作：【联网核查】',
      '4、保存（信贷潜在客户）（客户编辑页），操作：【保存】',
    ].join('\n'),
    produces: ['保存（信贷潜在客户）产物'],
  });
  assert.deepEqual(out, { ok: true });
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

await run('C4 helper: produces exact title → produces_eq_title even when draft is cohesive', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: PROMPT_GOOD_MAINTAIN,
    produces: ['维护基本信息'],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'produces_eq_title');
});

await run('C4 helper: produces title plus another key is not produces_eq_title', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: PROMPT_GOOD_MAINTAIN,
    produces: ['维护基本信息', '已维护对象'],
  });
  assert.deepEqual(out, { ok: true });
});

await run('C4 helper: empty produces is not produces_eq_title', () => {
  const out = mod.assertCapabilityCohesion({
    title: '维护基本信息',
    taskDraft: PROMPT_GOOD_MAINTAIN,
    produces: [],
  });
  assert.deepEqual(out, { ok: true });
});

await run('synthesizeFallbackProduceKey never equals trimmed title', () => {
  assert.equal(typeof mod.synthesizeFallbackProduceKey, 'function');
  assert.equal(mod.synthesizeFallbackProduceKey('维护基本信息'), '维护基本信息产物');
  assert.notEqual(mod.synthesizeFallbackProduceKey('维护基本信息'), '维护基本信息');
  assert.equal(mod.synthesizeFallbackProduceKey(''), 'atom_output');
  assert.equal(mod.synthesizeFallbackProduceKey('  '), 'atom_output');
});

await run('C1 propose: merged maintain+reorder rejected and not in atoms', async () => {
  const out = await proposeOne({
    chainId: 'chain-a',
    stepIndexes: [2],
    title: '维护并排序',
    flowRef: 'product_library',
    nodeId: 'prod_add_dlg',
    taskDraft: `${C1_MERGED_MAINTAIN_REORDER}\n\n来源：demo.docx / chapters/01-product-library.md\n`,
    produces: ['已维护对象'],
    dataDependsOn: [],
    phaseHints: ['维护'],
    suggestedFunctionId: null,
  });
  assert.equal(out.atoms.length, 0, `expected no atoms, got ${JSON.stringify(out.atoms)}`);
  assert.ok(
    out.rejected.some((r) => r.reason === 'multi_capability_task_draft'),
    `expected multi_capability_task_draft, got ${JSON.stringify(out.rejected)}`,
  );
});

await run('C3 propose: THREE_CONFIRM_DRAFT stays multi_persist_task_draft (not multi_capability)', async () => {
  const out = await proposeOne({
    chainId: 'chain-a',
    stepIndexes: [2],
    title: '新增一级分类',
    flowRef: 'product_library',
    nodeId: 'prod_add_dlg',
    taskDraft: FALLBACK_THREE_GROUPS,
    produces: ['一级分类'],
    dataDependsOn: [],
    phaseHints: ['新增一级分类'],
    suggestedFunctionId: null,
  });
  assert.ok(
    out.rejected.some((r) => r.reason === 'multi_persist_task_draft'),
    `expected multi_persist_task_draft, got ${JSON.stringify(out.rejected)}`,
  );
  assert.equal(
    out.rejected.filter((r) => r.reason === 'multi_capability_task_draft').length,
    0,
    'must not rebrand multi-confirm as multi_capability',
  );
});

await run('C4 propose: title-as-key cohesive draft → produces_eq_title, not in atoms', async () => {
  const out = await proposeOne({
    chainId: 'chain-a',
    stepIndexes: [2],
    title: '维护基本信息',
    flowRef: 'product_library',
    nodeId: 'prod_add_dlg',
    taskDraft: `${PROMPT_GOOD_MAINTAIN}`,
    produces: ['维护基本信息'],
    dataDependsOn: [],
    phaseHints: ['维护'],
    suggestedFunctionId: null,
  });
  assert.equal(out.atoms.length, 0);
  assert.ok(out.rejected.some((r) => r.reason === 'produces_eq_title'));
});

await run('C2 propose: cohesive maintain with business produce key is accepted', async () => {
  const out = await proposeOne({
    chainId: 'chain-a',
    stepIndexes: [2],
    title: '维护基本信息',
    flowRef: 'product_library',
    nodeId: 'prod_add_dlg',
    taskDraft: `${PROMPT_GOOD_MAINTAIN}`,
    produces: ['已维护对象'],
    dataDependsOn: [{ key: '已有对象', source: 'preset' }],
    phaseHints: ['维护'],
    suggestedFunctionId: null,
  });
  assert.ok(out.atoms.length >= 1, `expected atoms, rejected=${JSON.stringify(out.rejected)}`);
  assert.equal(out.rejected.filter((r) => r.reason === 'multi_capability_task_draft').length, 0);
});

if (failed) process.exit(1);
console.log('all passed');
