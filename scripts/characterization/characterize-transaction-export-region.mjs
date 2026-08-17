/**
 * Transaction export V2 精简证据（2026-08-18）：
 *   - transcationProperties 条目不再含 regionId/parentRegionId（分层由 V3 result.groups 承担）；
 *   - entry 不再含 phases（阶段截图/全量元素 metadata 由 V3 承担）。
 *   node scripts/characterization/characterize-transaction-export-region.mjs
 */
import assert from 'node:assert/strict';

function ok(n) { console.log(`ok: ${n}`); }

{
  const { mapStepToTransactionEvent, TRANSACTION_SCHEMA_VERSION } =
    await import('../../src/services/transaction-export.js');
  assert.equal(TRANSACTION_SCHEMA_VERSION, 2);

  const ev1 = mapStepToTransactionEvent({
    actionType: 'fill_form_field',
    params: { label_text: '客户名称', value: 'x' },
    element: {
      xpath_smart: "//input[@id='a']",
      layers: [
        { role: 'tab', label: '客户基本信息' },
        { role: 'section', label: '对公客户概况' },
        { role: 'titlebox', label: '基本信息' },
      ],
    },
  });
  assert.equal(ev1.regionId, undefined, 'regionId removed (slim V2)');
  assert.equal(ev1.parentRegionId, undefined, 'parentRegionId removed (slim V2)');
  assert.equal(ev1.elementType, "//input[@id='a']", 'old fields unchanged');
  assert.equal(ev1.propertiesName, '填写客户名称', 'propertiesName intact');

  const ev2 = mapStepToTransactionEvent({
    actionType: 'select_option',
    params: { label_text: '类型', option_text: 'A' },
    element: { xpath_smart: "//div[@id='s']", region_id: 'tab:T|section:S' },
  });
  assert.equal(ev2.regionId, undefined, 'region_id input not leaked');
  assert.equal(ev2.eventTypeValue, 'select:click', 'event mapping intact');

  const ev3 = mapStepToTransactionEvent({ actionType: 'done', element: {} });
  assert.equal(ev3, null, 'meta actions still skipped');
  ok('mapStepToTransactionEvent slim (no regionId/parentRegionId)');
}

{
  const { buildTransactionEntry } =
    await import('../../src/services/transaction-export.js');
  const built = buildTransactionEntry(
    {
      id: 3,
      name: 't',
      steps: [
        { actionType: 'click_element_by_index', params: { text: '保存' }, element: { xpath_smart: "//button[.='保存']" } },
      ],
    },
    { systemId: '98', projectId: '31' },
  );
  assert.equal(built.entry.phases, undefined, 'entry.phases removed (slim V2)');
  assert.equal(built.entry.transcationProperties.length, 1);
  assert.equal(built.entry.transcationProperties[0].propertiesName, '点击保存');
  assert.equal(built.count, 1);
  ok('buildTransactionEntry slim (no phases)');
}

console.log('characterize-transaction-export-region: ok');
