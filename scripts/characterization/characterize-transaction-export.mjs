/**
 * Characterization: partner transaction export envelope (V2).
 * Run: node scripts/characterization/characterize-transaction-export.mjs
 */
import assert from 'node:assert/strict';
import {
  mapStepToTransactionEvent,
  buildTransactionPayload,
  EVENT_TYPE_NAME,
} from '../../src/services/transaction-export.js';

function testFillInput() {
  const ev = mapStepToTransactionEvent({
    id: 10,
    actionType: 'fill_form_field',
    params: { label_text: '用户名', value: '701994' },
    element: {
      tag: 'input',
      xpath_smart: '//input[@placeholder="请输入您的用户名"]',
      attributes: { placeholder: '请输入您的用户名' },
    },
  });
  assert.equal(ev.eventTypeValue, 'input');
  assert.equal(ev.eventTypeName, '文本框输入');
  assert.equal(ev.propertiesName, '填写用户名');
  assert.equal(ev.objectValue, '701994');
  assert.equal(ev.elementType, '//input[@placeholder="请输入您的用户名"]');
  assert.equal(ev.options, '');
  assert.equal(ev.mothed, 'By.XPATH');
  assert.equal(ev.transcationType, 'playwright');
  assert.equal(Object.prototype.hasOwnProperty.call(ev, 'placeholder'), false);
}

function testSelectOptionsJson() {
  const ev = mapStepToTransactionEvent({
    actionType: 'select_option',
    params: { label_text: '状态', option_text: '启用', options: ['启用', '停用'] },
    element: {
      xpath_smart: "//div[contains(@class,'el-select')]",
      options: ['启用', '停用'],
    },
  });
  assert.equal(ev.eventTypeValue, 'select:click');
  assert.equal(ev.eventTypeName, EVENT_TYPE_NAME['select:click']);
  assert.equal(ev.objectValue, '启用');
  assert.equal(ev.options, JSON.stringify(['启用', '停用']));
}

function testSkipMeta() {
  assert.equal(mapStepToTransactionEvent({ actionType: 'wait_for_loading', params: {} }), null);
  assert.equal(mapStepToTransactionEvent({ actionType: 'go_to_url', params: { url: 'http://x' } }), null);
}

function testEnvelope() {
  const { payload, count, skipped } = buildTransactionPayload(
    {
      id: 99,
      name: '登录',
      steps: [
        {
          id: 1,
          actionType: 'fill_form_field',
          params: { label_text: '用户名', value: 'a' },
          element: { xpath_smart: '//input[@name="u"]' },
        },
        { id: 2, actionType: 'scan_form_fields', params: {} },
      ],
    },
    { systemId: 1, projectId: '7' },
  );
  assert.ok(Array.isArray(payload.transcationEventTypeList));
  assert.equal(payload.transcationEventTypeList.length, 1);
  const entry = payload.transcationEventTypeList[0];
  assert.equal(entry.transcId, '99');
  assert.equal(entry.transcationName, '登录');
  assert.equal(entry.systemId, '1');
  assert.equal(entry.projectId, '7');
  assert.equal(entry.transcationType, 'web');
  assert.equal(entry.testFrame, 'playwright');
  assert.equal(count, 1);
  assert.equal(entry.transcationProperties.length, 1);
  assert.equal(skipped.metaActions, 1);
  assert.ok(!('attributes' in entry.transcationProperties[0]));
  assert.ok(!('transcationEventType' in entry));
}

function testRequireIds() {
  assert.throws(
    () => buildTransactionPayload({ id: 1, steps: [] }, {}),
    (err) => err.statusCode === 400 && /systemId and projectId/.test(err.message),
  );
}

function testAbsoluteFallbackStat() {
  const { stats, payload } = buildTransactionPayload(
    {
      id: 1,
      name: 't',
      steps: [{
        actionType: 'click_element_by_index',
        params: { text: 'x' },
        element: { xpath_full: '/html/body/button' },
      }],
    },
    { systemId: '1', projectId: '1' },
  );
  assert.equal(payload.transcationEventTypeList[0].transcationProperties[0].elementType, '/html/body/button');
  assert.equal(stats.absoluteFallback, 1);
}

function testUniquePropertiesName() {
  const { payload } = buildTransactionPayload(
    {
      id: 2,
      name: 'dup',
      steps: [
        {
          actionType: 'fill_form_field',
          params: { label_text: '客户名称', value: 'a' },
          element: { xpath_smart: '//input[@name="a"]' },
        },
        {
          actionType: 'fill_form_field',
          params: { label_text: '客户名称', value: 'b' },
          element: { xpath_smart: '//input[@name="b"]' },
        },
        {
          actionType: 'fill_form_field',
          params: { label_text: '客户名称', value: 'c' },
          element: { xpath_smart: '//input[@name="c"]' },
        },
      ],
    },
    { systemId: '1', projectId: '1' },
  );
  const names = payload.transcationEventTypeList[0].transcationProperties.map((p) => p.propertiesName);
  assert.deepEqual(names, ['填写客户名称', '填写客户名称2', '填写客户名称3']);
  assert.equal(new Set(names).size, names.length);
}

testFillInput();
testSelectOptionsJson();
testSkipMeta();
testEnvelope();
testRequireIds();
testAbsoluteFallbackStat();
testUniquePropertiesName();
console.log('characterize-transaction-export: OK');
