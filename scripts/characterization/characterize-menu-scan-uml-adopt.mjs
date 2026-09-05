/**
 * Characterization: menu-scan-uml-adopt (modeling umlEcd → navigable leaf).
 * Run: node scripts/characterization/characterize-menu-scan-uml-adopt.mjs
 */
import assert from 'node:assert/strict';
import {
  isModelingUmlEcd,
  pickUmlEcdFromIntermediates,
} from '../../src/services/menu-scan-uml-adopt.js';

function testIsModelingUmlEcd() {
  assert.equal(isModelingUmlEcd('UML00005556'), true);
  assert.equal(isModelingUmlEcd('uml0001'), true);
  assert.equal(isModelingUmlEcd('9000000811'), false);
  assert.equal(isModelingUmlEcd(''), false);
}

function testPickByName() {
  const inter = [
    { name: '对公客户管理', umlEcd: 'UML00005556', pageIds: ['ZJJK1'] },
    { name: '产品要素管理', umlEcd: 'UML00092663', pageIds: ['ZJJK_E'] },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: '对公客户管理', umlEcd: '9001' }, inter),
    'UML00005556',
  );
  assert.equal(
    pickUmlEcdFromIntermediates({ name: '产品要素库', umlEcd: '9002' }, inter),
    '',
    'different SUT leaf name does not steal group uml',
  );
}

function testPickByPageId() {
  const inter = [
    { name: '产品信息管理', umlEcd: 'UML00092662', pageIds: ['ZJJK_A', 'ZJJK_B'] },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: '产品库管理', pageId: 'ZJJK_A', umlEcd: '1' }, inter),
    'UML00092662',
  );
}

function testDoNotOverwriteModelingUml() {
  const inter = [{ name: 'X', umlEcd: 'UML_NEW', pageIds: [] }];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: 'X', umlEcd: 'UML_OLD' }, inter),
    '',
  );
}

function main() {
  console.log('\n=== menu-scan-uml-adopt characterization ===\n');
  const tests = [
    ['isModelingUmlEcd', testIsModelingUmlEcd],
    ['pick by name', testPickByName],
    ['pick by pageId', testPickByPageId],
    ['do not overwrite existing UML…', testDoNotOverwriteModelingUml],
  ];
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }
  console.log(failed ? '\nFAIL' : '\nOK');
  process.exitCode = failed ? 1 : 0;
}

main();
