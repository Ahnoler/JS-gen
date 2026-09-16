#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
process.env.KB_STAGING_DIR = mkdtempSync(join(tmpdir(), 'kb-observe-atom-depend-'));
const mod = await import(
  pathToFileURL(join(ROOT, 'src/services/req-draft-traj/atom-depend.js')).href,
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

console.log('characterize-atom-depend');

await run('normalizeProduces dedupes preserve order', () => {
  assert.deepEqual(mod.normalizeProduces(['一级分类', '一级分类', ' 子分类 ', '', null]), [
    '一级分类',
    '子分类',
  ]);
});

await run('normalizeDataDependsOn strings default source atom', () => {
  assert.deepEqual(mod.normalizeDataDependsOn(['一级分类', { key: '子分类', source: 'preset' }]), [
    { key: '一级分类', source: 'atom' },
    { key: '子分类', source: 'preset' },
  ]);
});

await run('675/676/678 isomorphic chain passes', () => {
  const { rejected, warnings } = mod.validateAtomDependGraph([
    { atomKey: 'a675', produces: ['一级分类'], dataDependsOn: [] },
    { atomKey: 'a676', produces: ['子分类'], dataDependsOn: ['一级分类'] },
    { atomKey: 'a678', produces: ['产品'], dataDependsOn: ['一级分类', '子分类'] },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(warnings, []);
});

await run('merged L1+child+product self_produce_depend', () => {
  const { rejected } = mod.validateAtomDependGraph([
    {
      atomKey: 'merged',
      produces: ['一级分类', '子分类', '产品'],
      dataDependsOn: ['一级分类', '子分类'],
    },
  ]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'self_produce_depend');
  assert.equal(rejected[0].atomKey, 'merged');
});

await run('dangling_data_depend when upstream missing', () => {
  const { rejected } = mod.validateAtomDependGraph([
    { atomKey: 'a678', produces: ['产品'], dataDependsOn: ['一级分类', '子分类'] },
  ]);
  assert.ok(rejected.some((r) => r.reason === 'dangling_data_depend'));
});

await run('preset source skips dangling', () => {
  const { rejected } = mod.validateAtomDependGraph([
    {
      atomKey: 'a676',
      produces: ['子分类'],
      dataDependsOn: [{ key: '一级分类', source: 'preset' }],
    },
  ]);
  assert.deepEqual(rejected, []);
});

await run('missing both fields → reject missing_depend_fields', () => {
  const { rejected, warnings } = mod.validateAtomDependGraph([
    { atomKey: 'legacy', title: 'x' },
  ]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'missing_depend_fields');
  assert.equal(rejected[0].atomKey, 'legacy');
  assert.deepEqual(warnings, []);
});

await run('empty produces/dataDependsOn after normalize → reject missing_depend_fields', () => {
  const { rejected, warnings } = mod.validateAtomDependGraph([
    { atomKey: 'empty-arr', produces: [], dataDependsOn: [] },
  ]);
  assert.ok(rejected.some((r) => r.reason === 'missing_depend_fields' && r.atomKey === 'empty-arr'));
  assert.deepEqual(warnings, []);
});

await run('whitespace-only produces → reject missing_depend_fields', () => {
  const { rejected } = mod.validateAtomDependGraph([
    { atomKey: 'ws', produces: ['  ', ''], dataDependsOn: [] },
  ]);
  assert.equal(rejected[0].reason, 'missing_depend_fields');
});

await run('non-empty produces with empty dataDependsOn (root) still passes', () => {
  const { rejected, warnings } = mod.validateAtomDependGraph([
    { atomKey: 'root', produces: ['一级分类'], dataDependsOn: [] },
  ]);
  assert.deepEqual(rejected, []);
  assert.deepEqual(warnings, []);
});

await run('empty produces does not contribute keys for downstream dangling', () => {
  const { rejected } = mod.validateAtomDependGraph([
    { atomKey: 'empty-up', produces: [], dataDependsOn: [] },
    { atomKey: 'child', produces: ['子分类'], dataDependsOn: ['一级分类'] },
  ]);
  assert.ok(rejected.some((r) => r.atomKey === 'empty-up' && r.reason === 'missing_depend_fields'));
  assert.ok(rejected.some((r) => r.atomKey === 'child' && r.reason === 'dangling_data_depend'));
});

await run('propose materialize keeps produces/depends and rejects self_produce batch', async () => {
  // Marker-style pin on propose.js source (fast, no DB): fields + validate call present.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(join(ROOT, 'src/services/req-draft-traj/propose.js'), 'utf8');
  assert.ok(src.includes("from './atom-depend.js'"));
  assert.ok(src.includes('validateAtomDependGraph'));
  assert.ok(src.includes('self_produce_depend') || src.includes('validateAtomDependGraph('));
  assert.ok(src.includes('missing_depend_fields'));
  assert.ok(src.includes('warnings'));
});

await run('propose LLM empty produces after materialize → missing_depend_fields', async () => {
  const { mkdtempSync, cpSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { proposeDraftTrajectories } = await import(
    pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose.js')).href,
  );
  const fixtureRoot = join(ROOT, 'scripts/characterization/fixtures/req-draft-traj/demo-mod');
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-empty-depend-'));
  cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });
  try {
    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: async () => JSON.stringify({
        atoms: [{
          chainId: 'chain-a',
          stepIndexes: [2],
          title: '新增一级分类',
          taskDraft: '1、新增一级分类。\n\n来源：demo.docx\n',
          phaseHints: ['新增一级分类'],
          produces: [],
          dataDependsOn: [],
        }],
      }),
      listSystemsFn: async () => [],
    });
    assert.equal(out.atoms.length, 0, `expected 0 atoms, got ${out.atoms.length}`);
    assert.ok(
      out.rejected.some((r) => r.reason === 'missing_depend_fields'),
      `expected missing_depend_fields, got rejected=${JSON.stringify(out.rejected)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await run('propose LLM omitted depend fields after materialize → missing_depend_fields', async () => {
  const { mkdtempSync, cpSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { proposeDraftTrajectories } = await import(
    pathToFileURL(join(ROOT, 'src/services/req-draft-traj/propose.js')).href,
  );
  const fixtureRoot = join(ROOT, 'scripts/characterization/fixtures/req-draft-traj/demo-mod');
  const tmp = mkdtempSync(join(tmpdir(), 'req-draft-omit-depend-'));
  cpSync(fixtureRoot, join(tmp, 'demo-mod'), { recursive: true });
  try {
    const out = await proposeDraftTrajectories({
      moduleKey: 'demo-mod',
      rootDir: tmp,
      callLLM: async () => JSON.stringify({
        atoms: [{
          chainId: 'chain-a',
          stepIndexes: [2],
          title: '新增一级分类',
          taskDraft: '1、新增一级分类。\n\n来源：demo.docx\n',
          phaseHints: ['新增一级分类'],
        }],
      }),
      listSystemsFn: async () => [],
    });
    assert.equal(out.atoms.length, 0, `expected 0 atoms, got ${out.atoms.length}`);
    assert.ok(
      out.rejected.some((r) => r.reason === 'missing_depend_fields'),
      `expected missing_depend_fields, got rejected=${JSON.stringify(out.rejected)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

await run('atomize prompt XML partitions + few-shots', async () => {
  const { readFileSync } = await import('node:fs');
  const prompt = readFileSync(join(ROOT, 'scripts/prompts/req-draft-traj-atomize-prompt.md'), 'utf8');
  for (const tag of ['role', 'output_contract', 'split_rules', 'examples', 'anti_patterns', 'checklist']) {
    assert.ok(prompt.includes(`<${tag}>`), `missing <${tag}>`);
    assert.ok(prompt.includes(`</${tag}>`), `missing </${tag}>`);
  }
  const goods = prompt.match(/<good>/g) || [];
  const bads = prompt.match(/<bad\s+reason=/g) || [];
  assert.ok(goods.length >= 3, `expected >=3 <good>, got ${goods.length}`);
  assert.ok(bads.length >= 2, `expected >=2 <bad reason=>, got ${bads.length}`);
  for (const reason of [
    'same-page multi-capability',
    'maintain missing locate/search/select prep',
    'multi-persist/multi-create chain',
    '#504-style fallback pollution',
  ]) {
    assert.ok(prompt.includes(`reason="${reason}"`), `missing <bad reason="${reason}">`);
  }
  const contract = prompt.slice(prompt.indexOf('<output_contract>'), prompt.indexOf('</output_contract>'));
  assert.match(contract, /produces/);
  assert.match(contract, /dataDependsOn/);
  assert.match(contract, /taskDraft/);
  const split = prompt.slice(prompt.indexOf('<split_rules>'), prompt.indexOf('</split_rules>'));
  assert.doesNotMatch(split, /产品树每一层|上移|下移/);
});

await run('atom-depend samples cover good/bad pairs from prompt', async () => {
  const { readFileSync } = await import('node:fs');
  const samples = readFileSync(
    join(ROOT, 'docs/superpowers/prompt-engineering/atom-depend-split-samples.md'),
    'utf8',
  );
  assert.match(samples, /G1/);
  assert.match(samples, /G2/);
  assert.match(samples, /G3/);
  assert.match(samples, /same-page multi-capability/);
  assert.match(samples, /maintain missing locate\/search\/select prep/);
  assert.match(samples, /multi-persist/);
  assert.match(samples, /#504-style fallback pollution/);
  assert.match(samples, /produces 必须非空|produces` 必须非空/);
});

if (failed) process.exit(1);
console.log('all passed');
