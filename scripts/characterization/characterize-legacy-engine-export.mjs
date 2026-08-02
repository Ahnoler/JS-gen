/**
 * Characterization: traditional engine export (5-field contract).
 *
 * Run: node scripts/characterize-legacy-engine-export.mjs
 */
import assert from 'node:assert/strict';
import {
  LEGACY_ENGINE_FIELD_SCHEMA,
  mapStepToLegacyEngineOp,
  exportStepsToLegacyEngine,
  pickRelativeTarget,
  buildOperationName,
} from '../src/services/legacy-engine-export.js';

function testSchema() {
  const keys = LEGACY_ENGINE_FIELD_SCHEMA.map((f) => f.key);
  assert.deepEqual(keys, ['name', 'type', 'value', 'locateBy', 'target']);
  assert.ok(LEGACY_ENGINE_FIELD_SCHEMA.every((f) => f.zh));
}

function testClickMenu() {
  const op = mapStepToLegacyEngineOp({
    id: 2343,
    actionType: 'click_element_by_index',
    params: { text: '产品管理', index: -1, tag_name: 'li' },
    element: {
      text: '产品管理',
      xpath_smart: "//li[contains(concat(' ', normalize-space(@class), ' '), ' menu-item ')][normalize-space()='产品管理']",
      candidates: [{
        type: 'xpath_smart',
        value: "//li[contains(concat(' ', normalize-space(@class), ' '), ' menu-item ')][normalize-space()='产品管理']",
      }],
    },
  });
  assert.ok(op);
  assert.equal(op.name, '点击:产品管理');
  assert.equal(op.type, 'click');
  assert.equal(op.value, '');
  assert.equal(op.locateBy, 'xpath');
  assert.ok(op.target.includes('menu-item') && op.target.includes('产品管理'));
  assert.equal(op.meta.ok, true);
}

function testFill() {
  const op = mapStepToLegacyEngineOp({
    actionType: 'fill_form_field',
    params: { label_text: '搜索关键字', value: '贷款' },
    element: {
      xpath_smart: "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'搜索关键字')]]//input",
    },
  });
  assert.equal(op.name, '填写:搜索关键字');
  assert.equal(op.type, 'input');
  assert.equal(op.value, '贷款');
  assert.ok(op.target.startsWith('//'));
}

function testSkipMetaAndAbsolute() {
  assert.equal(mapStepToLegacyEngineOp({ actionType: 'scan_form_fields', params: {} }), null);
  const absOnly = mapStepToLegacyEngineOp({
    actionType: 'click_element_by_index',
    params: { text: 'x' },
    element: { xpath: '/html/body/div[1]/button', xpath_full: '/html/body/div[1]/button' },
  });
  assert.equal(absOnly.target, '');
  assert.equal(absOnly.meta.ok, false);
  assert.ok(absOnly.meta.warnings.includes('missing_relative_xpath'));
}

function testRequireTargetFilter() {
  const steps = [
    {
      id: 1,
      actionType: 'click_element_by_index',
      params: { text: 'A' },
      element: { xpath_smart: "//button[normalize-space()='A']" },
    },
    {
      id: 2,
      actionType: 'click_element_by_index',
      params: { text: 'B' },
      element: { xpath_full: '/html/body/div[1]' },
    },
    { id: 3, actionType: 'get_pending_tasks', params: {} },
  ];
  const all = exportStepsToLegacyEngine(steps, { includeMeta: false });
  assert.equal(all.count, 2);
  const strict = exportStepsToLegacyEngine(steps, { requireTarget: true, includeMeta: false });
  assert.equal(strict.count, 1);
  assert.equal(strict.operations[0].name, '点击:A');
  assert.deepEqual(
    Object.keys(strict.operations[0]).sort(),
    ['locateBy', 'name', 'target', 'type', 'value'],
  );
}

function testPickRelative() {
  assert.equal(
    pickRelativeTarget({
      target: '/html/x',
      element: { xpath_smart: "//li[normalize-space()='t']" },
    }),
    "//li[normalize-space()='t']",
  );
  assert.equal(buildOperationName('click_menu_item', { menu_text: '产品管理' }), '菜单:产品管理');
}

testSchema();
testClickMenu();
testFill();
testSkipMetaAndAbsolute();
testRequireTargetFilter();
testPickRelative();
console.log('ok: characterization legacy-engine export');
