#!/usr/bin/env node
/**
 * Pins: detail-page maintain/save must not merge tree-sort (上移/下移 / 同层排序).
 * Gold shape is traj #708 (search/locate unpublished product → basic info → save).
 *
 * Run:
 *   node scripts/characterization/characterize-atom-capability.mjs
 */
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.KB_STAGING_DIR = mkdtempSync(join(tmpdir(), 'kb-observe-capability-'));

const cap = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/atom-capability.js')).href
);
const { proposeDraftTrajectories } = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose.js')).href
);

const demoRoot = join(ROOT, 'scripts/characterization/fixtures/req-draft-traj/demo-mod');

/** Wet propose bug: chain-a:6 merged tree-sort into maintain/save. */
const MIXED_SORT_AND_BASIC_INFO = [
  '1、同层排序（与相邻节点互换序号），操作：【上移】/【下移】',
  '2、（可选）维护基本信息（征信三级联动等 14 必填）→【保存】',
  '',
  '来源：demo.docx / chapters/03-配置产品信息.md',
  '',
].join('\n');

/** Gold traj #708: locate/select unpublished product, then basic-info save. */
const GOLD_708_BASIC_INFO = [
  '1、进入产品库管理主页，等待加载',
  '2、搜索/定位并选中已有未启用「产品」',
  '3、右侧打开基本信息页签',
  '4、维护必填字段',
  '5、【保存】',
  '',
  '来源：demo.docx / chapters/03-配置产品信息.md',
  '',
  '关键数据',
  '产品：KB测产品',
  '',
].join('\n');

const SORT_ONLY = [
  '1、进入产品库管理主页，等待加载',
  '2、搜索/定位并选中已有节点',
  '3、同层排序：【上移】或【下移】与相邻节点互换序号',
  '',
  '来源：demo.docx / chapters/03-配置产品信息.md',
  '',
].join('\n');

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

console.log('characterize-atom-capability');

await run('mixesSortWithBasicInfoSave true for 同层排序 + 维护基本信息【保存】', () => {
  assert.equal(typeof cap.mixesSortWithBasicInfoSave, 'function');
  assert.equal(cap.mixesSortWithBasicInfoSave(MIXED_SORT_AND_BASIC_INFO), true);
});

await run('mixesSortWithBasicInfoSave false for #708-shaped locate+basic-info save', () => {
  assert.equal(cap.mixesSortWithBasicInfoSave(GOLD_708_BASIC_INFO), false);
});

await run('mixesSortWithBasicInfoSave false for sort-only atom', () => {
  assert.equal(cap.mixesSortWithBasicInfoSave(SORT_ONLY), false);
});

await run('mixesSortWithBasicInfoSave true for 上移 + 【保存】 without 维护基本信息 phrase', () => {
  assert.equal(
    cap.mixesSortWithBasicInfoSave('1、【上移】与相邻节点互换序号\n2、编辑后【保存】\n'),
    true,
  );
});

await run('mixesSortWithBasicInfoSave false for fill+one save without sort', () => {
  assert.equal(
    cap.mixesSortWithBasicInfoSave('1、进入编辑页\n2、维护概况\n3、【保存】\n'),
    false,
  );
});

await run('empty/non-string is not a mix', () => {
  assert.equal(cap.mixesSortWithBasicInfoSave(''), false);
  assert.equal(cap.mixesSortWithBasicInfoSave(null), false);
});

await run('propose mixed sort+basic-info taskDraft → unrelated_capability_merge', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-cap-mix-'));
  cpSync(demoRoot, join(tmp, 'demo-mod'), { recursive: true });

  const fakeLLM = async () => JSON.stringify({
    atoms: [{
      chainId: 'chain-a',
      stepIndexes: [2],
      title: '维护基本信息',
      taskDraft: MIXED_SORT_AND_BASIC_INFO,
      phaseHints: ['同层排序', '保存'],
      produces: [],
      dataDependsOn: ['产品'],
      suggestedFunctionId: null,
    }],
  });

  const out = await proposeDraftTrajectories({
    moduleKey: 'demo-mod',
    rootDir: tmp,
    callLLM: fakeLLM,
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [],
  });
  rmSync(tmp, { recursive: true, force: true });
  assert.ok(
    out.rejected.some((r) => r.reason === 'unrelated_capability_merge'),
    `expected unrelated_capability_merge, got rejected=${JSON.stringify(out.rejected)} atoms=${out.atoms.length}`,
  );
  assert.equal(
    out.atoms.filter((a) => cap.mixesSortWithBasicInfoSave(a.taskDraft)).length,
    0,
    'mixed sort+basic-info taskDraft must not be emitted',
  );
});

await run('propose #708-shaped basic-info save is kept', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-cap-708-'));
  cpSync(demoRoot, join(tmp, 'demo-mod'), { recursive: true });

  const fakeLLM = async () => JSON.stringify({
    atoms: [{
      chainId: 'chain-a',
      stepIndexes: [2],
      title: '维护基本信息',
      taskDraft: GOLD_708_BASIC_INFO,
      phaseHints: ['定位产品', '保存'],
      produces: [],
      dataDependsOn: [{ key: '产品', source: 'preset' }],
      suggestedFunctionId: null,
    }],
  });

  const out = await proposeDraftTrajectories({
    moduleKey: 'demo-mod',
    rootDir: tmp,
    callLLM: fakeLLM,
    listSystemsFn: async () => [],
    listFlowCardsFn: async () => [],
  });
  rmSync(tmp, { recursive: true, force: true });
  assert.equal(
    out.rejected.filter((r) => r.reason === 'unrelated_capability_merge').length,
    0,
    `unexpected unrelated_capability_merge: ${JSON.stringify(out.rejected)}`,
  );
  assert.ok(out.atoms.length >= 1, `expected kept atom, got atoms=${out.atoms.length}`);
  assert.match(out.atoms[0].taskDraft, /搜索\/定位并选中/);
  assert.match(out.atoms[0].taskDraft, /关键数据[\s\S]*产品：/);
});

await run('atomize prompt forbids unrelated capability merge and requires locate+select', () => {
  const prompt = readFileSync(
    join(ROOT, 'scripts/prompts/req-draft-traj-atomize-prompt.md'),
    'utf8',
  );
  assert.match(prompt, /禁止.*互不相关的能力/);
  assert.match(prompt, /上移\/下移/);
  assert.match(prompt, /维护基本信息/);
  assert.match(prompt, /搜索\/定位/);
  assert.match(prompt, /dataDependsOn/);
});

await run('#708 gold sketch and sort+save anti-example exist', () => {
  const sample = readFileSync(
    join(ROOT, 'docs/superpowers/prompt-engineering/atom-maintain-save-samples.md'),
    'utf8',
  );
  assert.match(sample, /#708/);
  assert.match(sample, /搜索\/定位并选中/);
  assert.match(sample, /dataDependsOn/);
  assert.match(sample, /不要这样|反例/);
  assert.match(sample, /同层排序/);
  assert.match(sample, /维护基本信息/);
});

await run('propose.js wires mixesSortWithBasicInfoSave / unrelated_capability_merge', () => {
  const src = readFileSync(join(ROOT, 'src/services/req-draft-traj/propose.js'), 'utf8');
  assert.match(src, /from '\.\/atom-capability\.js'/);
  assert.match(src, /mixesSortWithBasicInfoSave/);
  assert.match(src, /unrelated_capability_merge/);
});

if (failed) process.exit(1);
console.log('all passed');
