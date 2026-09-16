#!/usr/bin/env node
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
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

await run('missing both fields → warning missing_depend_fields', () => {
  const { rejected, warnings } = mod.validateAtomDependGraph([
    { atomKey: 'legacy', title: 'x' },
  ]);
  assert.deepEqual(rejected, []);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, 'missing_depend_fields');
});

if (failed) process.exit(1);
console.log('all passed');
