/**
 * Tree-node dirty suffix: partner export propertiesName sanitization.
 *
 *   node scripts/characterization/cold/characterize-tree-text-export.mjs
 */
import assert from 'node:assert/strict';
import {
  buildBusinessObjectName,
  mapStepToTransactionEvent,
} from '../../../src/services/transaction-export.js';

function testTreeNodeClickStripsTrailingDash() {
  const name = buildBusinessObjectName(
    'click_element_by_index',
    { text: '年龄限制 -' },
    { target_kind: 'tree_node', xpath_smart: "//div[contains(@class,'el-tree-node')]" },
  );
  assert.equal(name, '年龄限制');

  const ev = mapStepToTransactionEvent({
    actionType: 'click_element_by_index',
    params: { text: '年龄限制 -' },
    element: {
      target_kind: 'tree_node',
      xpath_smart: "//div[contains(@class,'el-tree-node')]//span[normalize-space()='年龄限制']",
    },
  });
  assert.equal(ev.propertiesName, '年龄限制');
}

function testTreeNodeStripsChildCount() {
  const name = buildBusinessObjectName(
    'click_element_by_index',
    { text: '金融新产品(7)' },
    { target_kind: 'tree_node' },
  );
  assert.equal(name, '金融新产品');

  const ev = mapStepToTransactionEvent({
    actionType: 'click_element_by_index',
    params: { text: '金融新产品(7)' },
    element: { target_kind: 'tree_node', text: '金融新产品(7)' },
  });
  assert.equal(ev.propertiesName, '金融新产品');
}

function testTreeNodeKeepsVersionSuffix() {
  const name = buildBusinessObjectName(
    'click_element_by_index',
    { text: '测试111[V-0.0.1]' },
    { target_kind: 'tree_node' },
  );
  assert.equal(name, '测试111[V-0.0.1]');

  const ev = mapStepToTransactionEvent({
    actionType: 'click_element_by_index',
    params: { text: '测试111[V-0.0.1]' },
    element: { target_kind: 'tree_node' },
  });
  assert.equal(ev.propertiesName, '测试111[V-0.0.1]');
}

function testNonTreeButtonUnchanged() {
  const name = buildBusinessObjectName(
    'click_element_by_index',
    { text: '下一步' },
    { target_kind: 'button', xpath_smart: "//button[normalize-space()='下一步']" },
  );
  assert.equal(name, '下一步');

  const ev = mapStepToTransactionEvent({
    actionType: 'click_element_by_index',
    params: { text: '下一步' },
    element: { target_kind: 'button', xpath_smart: "//button[normalize-space()='下一步']" },
  });
  assert.equal(ev.propertiesName, '下一步');
}

function testFormLabelNotStripped() {
  const name = buildBusinessObjectName(
    'fill_form_field',
    { label_text: '客户名称 -', value: 'x' },
    { target_kind: 'input' },
  );
  assert.equal(name, '客户名称 -');
}

function testSelectTreeOptionStripsDirtyOption() {
  const name = buildBusinessObjectName(
    'select_tree_option',
    { option_text: '金融新产品(7)' },
    { xpath_smart: "//div[contains(@class,'el-select')]" },
  );
  assert.equal(name, '金融新产品');
}

testTreeNodeClickStripsTrailingDash();
testTreeNodeStripsChildCount();
testTreeNodeKeepsVersionSuffix();
testNonTreeButtonUnchanged();
testFormLabelNotStripped();
testSelectTreeOptionStripsDirtyOption();
console.log('characterize-tree-text-export: OK');
