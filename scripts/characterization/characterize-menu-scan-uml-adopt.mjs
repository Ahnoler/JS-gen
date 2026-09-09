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
    { name: '对公客户管理', umlEcd: 'UML00005556', pages: [{ pageId: 'ZJJK1', activityUmlEcd: 'UML_ACT_1' }] },
    { name: '产品要素管理', umlEcd: 'UML00092663', pages: [{ pageId: 'ZJJK_E', activityUmlEcd: 'UML00031596' }] },
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

function testPickByPageIdUniqueActivity() {
  const inter = [
    {
      name: '产品信息管理',
      umlEcd: 'UML00092662',
      pages: [
        { pageId: 'ZJJK00110131', activityUmlEcd: 'UML00057701' },
        { pageId: 'ZJJK00095454', activityUmlEcd: 'UML00031743' },
      ],
    },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: '产品库管理', pageId: 'ZJJK00110131', umlEcd: '1' }, inter),
    'UML00057701',
    'pageId adopt uses activity code, not subdomain UML00092662',
  );
}

function testPickByPageIdAmbiguous() {
  const inter = [
    {
      name: '公告',
      umlEcd: 'UML_GROUP',
      pages: [
        { pageId: 'ZJJK00109712', activityUmlEcd: '' }, // cleared at import for 1:N
      ],
    },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: '查看公告', pageId: 'ZJJK00109712', umlEcd: '9' }, inter),
    '',
  );
  // Also: two non-empty different codes for same pageId across pages arrays
  const inter2 = [
    {
      name: 'G',
      umlEcd: 'UML_G',
      pages: [
        { pageId: 'ZJJK_SHARE', activityUmlEcd: 'UML_A' },
        { pageId: 'ZJJK_SHARE', activityUmlEcd: 'UML_B' },
      ],
    },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: 'X', pageId: 'ZJJK_SHARE', umlEcd: '1' }, inter2),
    '',
  );
}

function testDoNotOverwriteModelingUml() {
  const inter = [{ name: 'X', umlEcd: 'UML_NEW', pages: [] }];
  assert.equal(
    pickUmlEcdFromIntermediates({ name: 'X', umlEcd: 'UML_OLD' }, inter),
    '',
    'existing activity-like UML_OLD is not overwritten by name match to UML_NEW',
  );
}

function testOverwriteIntermediateGroupCode() {
  const inter = [
    {
      name: '产品信息管理',
      umlEcd: 'UML00092662',
      pages: [
        { pageId: 'ZJJK00110131', activityUmlEcd: 'UML00057701' },
        { pageId: 'ZJJK00095454', activityUmlEcd: 'UML00031743' },
      ],
    },
  ];
  assert.equal(
    pickUmlEcdFromIntermediates({
      name: '产品库管理',
      pageId: 'ZJJK00110131',
      umlEcd: 'UML00092662',
    }, inter),
    'UML00057701',
    'group umlEcd on leaf is replaced by unique activity code via pageId',
  );
}

function main() {
  console.log('\n=== menu-scan-uml-adopt characterization ===\n');
  const tests = [
    ['isModelingUmlEcd', testIsModelingUmlEcd],
    ['pick by name', testPickByName],
    ['pick by pageId unique activity', testPickByPageIdUniqueActivity],
    ['pick by pageId ambiguous', testPickByPageIdAmbiguous],
    ['do not overwrite existing UML…', testDoNotOverwriteModelingUml],
    ['overwrite intermediate group code', testOverwriteIntermediateGroupCode],
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
