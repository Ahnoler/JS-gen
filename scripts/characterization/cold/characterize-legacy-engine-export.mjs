/**
 * Characterization: traditional engine export (5-field contract).
 *
 * Run: node scripts/characterization/characterize-legacy-engine-export.mjs
 */
import assert from 'node:assert/strict';
import {
  LEGACY_ENGINE_FIELD_SCHEMA,
  LEGACY_ENGINE_EMITTED_TYPES,
  ACTION_TO_ENGINE_TYPE,
  mapStepToLegacyEngineOp,
  exportStepsToLegacyEngine,
  pickExportTarget,
  pickRelativeTarget,
  buildOperationName,
} from '../../src/services/legacy-engine-export.js';

function testSchema() {
  const keys = LEGACY_ENGINE_FIELD_SCHEMA.map((f) => f.key);
  assert.deepEqual(keys, ['name', 'type', 'value', 'locateBy', 'target']);
  assert.ok(LEGACY_ENGINE_FIELD_SCHEMA.every((f) => f.zh));
  assert.deepEqual(
    [...LEGACY_ENGINE_EMITTED_TYPES].sort(),
    ['click', 'date', 'input', 'radio', 'select:click', 'select:tree'],
  );
  assert.equal(ACTION_TO_ENGINE_TYPE.select_option, 'select:click');
  assert.ok(!('fill_date_field' in ACTION_TO_ENGINE_TYPE));
  assert.equal(ACTION_TO_ENGINE_TYPE.click_radio, 'radio');
  assert.ok(!('wait_for_loading' in ACTION_TO_ENGINE_TYPE));
  assert.ok(!('go_to_url' in ACTION_TO_ENGINE_TYPE));
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
  assert.equal(op.meta.targetSource, 'xpath_smart');
  assert.ok(op.meta.element && op.meta.element.xpath_smart);
  assert.equal(op.meta.params.text, '产品管理');
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

function testEngineTypeVariants() {
  const sel = mapStepToLegacyEngineOp({
    actionType: 'select_option',
    params: { label_text: '状态', option_text: '启用' },
    element: { xpath_smart: "//div[contains(@class,'el-select')]" },
  });
  assert.equal(sel.type, 'select:click');
  assert.equal(sel.value, '启用');

  const tree = mapStepToLegacyEngineOp({
    actionType: 'select_tree_option',
    params: { label_text: '行业', option_text: '金融' },
    element: { xpath_smart: "//div[contains(@class,'el-tree-select')]" },
  });
  assert.equal(tree.type, 'select:tree');

  const date = mapStepToLegacyEngineOp({
    actionType: 'fill_form_field',
    params: { label_text: '申请日期', value: '2026-01-01' },
    element: { xpath_smart: "//div[contains(@class,'el-date-editor')]//input" },
  });
  assert.equal(date.type, 'date');
  const dateAlias = mapStepToLegacyEngineOp({
    actionType: 'fill_date_field',
    params: { label_text: '申请日期', value: '2026-01-01' },
    element: { xpath_smart: "//div[contains(@class,'el-date-editor')]//input" },
  });
  assert.equal(dateAlias.type, 'date');
  assert.equal(dateAlias.meta.action, 'fill_form_field');

  const radio = mapStepToLegacyEngineOp({
    actionType: 'click_radio',
    params: { label_text: '是否', option_text: '是' },
    element: { xpath_smart: "//label[contains(@class,'el-radio')]" },
  });
  assert.equal(radio.type, 'radio');

  assert.equal(mapStepToLegacyEngineOp({ actionType: 'wait_for_loading', params: {} }), null);
  assert.equal(mapStepToLegacyEngineOp({ actionType: 'go_to_url', params: { url: 'http://x' } }), null);
}

function testAbsoluteFallbackKept() {
  assert.equal(mapStepToLegacyEngineOp({ actionType: 'scan_form_fields', params: {} }), null);
  const absOnly = mapStepToLegacyEngineOp({
    actionType: 'click_element_by_index',
    params: { text: 'x' },
    element: { xpath: '/html/body/div[1]/button', xpath_full: '/html/body/div[1]/button' },
  });
  assert.equal(absOnly.target, '/html/body/div[1]/button');
  assert.equal(absOnly.meta.ok, true);
  assert.equal(absOnly.meta.targetSource, 'xpath_full');
  assert.ok(absOnly.meta.warnings.includes('absolute_xpath_fallback'));
}

function testExportKeepsAbsoluteSteps() {
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
  const all = exportStepsToLegacyEngine(steps, { includeMeta: true });
  assert.equal(all.count, 2, 'absolute-only steps must not be dropped');
  assert.equal(all.stats.absoluteFallback, 1);
  assert.equal(all.operations[1].target, '/html/body/div[1]');
  const bare = exportStepsToLegacyEngine(steps, { includeMeta: false });
  assert.deepEqual(
    Object.keys(bare.operations[0]).sort(),
    ['locateBy', 'name', 'target', 'type', 'value'],
  );
}

function testPickExportTarget() {
  assert.equal(
    pickExportTarget({
      target: '/html/x',
      element: { xpath_smart: "//li[normalize-space()='t']" },
    }).target,
    "//li[normalize-space()='t']",
  );
  assert.equal(
    pickRelativeTarget({
      element: { xpath_full: '/html/body/div[9]' },
    }),
    '/html/body/div[9]',
  );
  assert.equal(buildOperationName('click_menu_item', { menu_text: '产品管理' }), '菜单:产品管理');
}

testSchema();
testClickMenu();
testFill();
testEngineTypeVariants();
testAbsoluteFallbackKept();
testExportKeepsAbsoluteSteps();
testPickExportTarget();
console.log('ok: characterization legacy-engine export');
