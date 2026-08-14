/**
 * Transaction export per-step region evidence.
 *   node scripts/characterization/characterize-transaction-export-region.mjs
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
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
  assert.equal(ev1.regionId, 'titlebox:基本信息');
  assert.equal(ev1.parentRegionId, 'section:对公客户概况');
  assert.equal(ev1.elementType, "//input[@id='a']", 'old fields unchanged');

  const ev2 = mapStepToTransactionEvent({
    actionType: 'select_option',
    params: { label_text: '类型', option_text: 'A' },
    element: { xpath_smart: "//div[@id='s']", region_id: 'tab:T|section:S' },
  });
  assert.equal(ev2.regionId, 'section:S');
  assert.equal(ev2.parentRegionId, 'tab:T');

  const ev3 = mapStepToTransactionEvent({
    actionType: 'click_element_by_index',
    params: { text: '保存' },
    element: { xpath_smart: "//button[.='保存']", region_label: '基本信息 / 对公客户概况' },
  });
  assert.equal(ev3.regionId, '对公客户概况');
  assert.equal(ev3.parentRegionId, '基本信息');

  const ev4 = mapStepToTransactionEvent({
    actionType: 'click_element_by_index',
    params: { text: '保存' },
    element: { xpath_smart: "//button[.='保存']" },
  });
  assert.equal(ev4.regionId, '');
  assert.equal(ev4.parentRegionId, '');

  const ev5 = mapStepToTransactionEvent({ actionType: 'done', element: {} });
  assert.equal(ev5, null, 'meta actions still skipped');
  ok('mapStepToTransactionEvent region evidence');
}

console.log('characterize-transaction-export-region: ok');
