/**
 * Same form-item + same-family controls must emit unique xpath_smart + field_slot.
 *
 *   node scripts/characterization/cold/characterize-form-field-intra-slot.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PAGE_LOCATOR_HELPERS } from '../../../src/cdp/locator-candidates.js';

const FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>intra slot</title>
<style>
  .el-form-item { display:flex; gap:8px; }
  .el-select, .el-input { display:inline-block; min-width:80px; border:1px solid #ccc; }
  input { width:72px; }
</style></head><body>
<div class="titlebox"><div class="title">产品基础参数</div></div>
<div class="el-form-item" id="ratio-item">
  <label class="el-form-item__label">保证金比例</label>
  <div class="el-form-item__content">
    <div class="tsscInput"><div class="el-input"><input id="in-a" class="el-input__inner" placeholder="请输入" /></div></div>
    <div class="tssc-multi-select">
      <div id="sel-a" class="el-select"><input class="el-input__inner" placeholder="请选择 " readonly /></div>
      <div class="el-select-dropdown" style="display:none"><div class="el-select-dropdown__wrap"></div></div>
    </div>
    <div>值</div>
    <div class="tssc-multi-select">
      <div id="sel-b" class="el-select"><input class="el-input__inner" placeholder="请选择 " readonly /></div>
      <div class="el-select-dropdown" style="display:none"><div class="el-select-dropdown__wrap"></div></div>
    </div>
    <div class="tsscInput"><div class="el-input"><input id="in-b" class="el-input__inner" placeholder="请输入" /></div></div>
  </div>
</div>
<div class="el-form-item" id="single-item">
  <label class="el-form-item__label">业务产品编号</label>
  <div class="el-form-item__content">
    <input id="biz-no" class="el-input__inner" placeholder="请输入" />
  </div>
</div>
</body></html>`;

function snapExpr(selector, formLabel, kind) {
  const sel = JSON.stringify(selector);
  const fl = JSON.stringify(formLabel);
  const k = JSON.stringify(kind || '');
  return `(() => {
${PAGE_LOCATOR_HELPERS}
    const el = document.querySelector(${sel});
    if (!el) return null;
    const host = typeof normalizeTargetRoot === 'function' ? (normalizeTargetRoot(el) || el) : el;
    const loc = buildLocatorSnap(host, '', absXPath(host), ${fl}, { targetKind: ${k} || undefined });
    const hits = evalXpathAll(loc.xpath_smart || '');
    return {
      xpath_smart: loc.xpath_smart || '',
      formLabel: loc.formLabel || '',
      field_slot: loc.field_slot || '',
      display_label: loc.display_label || '',
      locator_occurrence: loc.locator_occurrence || 0,
      locator_verified: loc.locator_verified,
      locator_strategy: loc.locator_strategy || '',
      hitCount: hits.length,
      hitId: hits[0] && hits[0].id,
      hostId: host && host.id,
    };
  })()`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(FIXTURE);

  const selA = await page.evaluate(snapExpr('#sel-a', '保证金比例', 'form_select'));
  const selB = await page.evaluate(snapExpr('#sel-b', '保证金比例', 'form_select'));
  assert.equal(selA.hitCount, 1, 'select A unique: ' + selA.xpath_smart);
  assert.equal(selB.hitCount, 1, 'select B unique: ' + selB.xpath_smart);
  assert.equal(selA.hitId, 'sel-a');
  assert.equal(selB.hitId, 'sel-b');
  assert.notEqual(selA.xpath_smart, selB.xpath_smart);
  assert.ok(!selA.xpath_smart.includes("contains(@class,'el-select')")
    || selA.xpath_smart.includes('normalize-space(@class)'),
    'select leaf must be class-token, got ' + selA.xpath_smart);
  assert.ok(selA.xpath_smart.includes("normalize-space(@class)"));
  assert.equal(selA.formLabel, '保证金比例');
  assert.equal(selB.formLabel, '保证金比例');
  assert.equal(selA.field_slot, 'A');
  assert.equal(selB.field_slot, 'B');
  assert.equal(selA.display_label, '保证金比例-A');
  assert.equal(selB.display_label, '保证金比例-B');
  assert.equal(selA.locator_verified, true, 'select A verified with titlebox');
  assert.equal(selB.locator_verified, true, 'select B verified with titlebox');
  assert.equal(selA.locator_strategy, 'xpath_smart');
  assert.equal(selB.locator_strategy, 'xpath_smart');
  assert.ok(selA.xpath_smart.includes("el-form-item"), 'select A keeps field-internal pin');
  assert.ok(selB.xpath_smart.includes("el-form-item"), 'select B keeps field-internal pin');
  console.log('ok: dual select slots');

  const inA = await page.evaluate(snapExpr('#in-a', '保证金比例', 'form_input'));
  const inB = await page.evaluate(snapExpr('#in-b', '保证金比例', 'form_input'));
  assert.equal(inA.hitCount, 1, 'input A unique: ' + inA.xpath_smart);
  assert.equal(inB.hitCount, 1, 'input B unique: ' + inB.xpath_smart);
  assert.equal(inA.hitId, 'in-a');
  assert.equal(inB.hitId, 'in-b');
  assert.equal(inA.field_slot, 'A');
  assert.equal(inB.field_slot, 'B');
  assert.equal(inA.formLabel, '保证金比例');
  assert.equal(inA.locator_verified, true, 'input A verified with titlebox');
  assert.equal(inB.locator_verified, true, 'input B verified with titlebox');
  assert.equal(inA.locator_strategy, 'xpath_smart');
  assert.equal(inB.locator_strategy, 'xpath_smart');
  console.log('ok: dual input slots');

  const single = await page.evaluate(snapExpr('#biz-no', '业务产品编号', 'form_input'));
  assert.equal(single.hitCount, 1);
  assert.equal(single.field_slot, '');
  assert.equal(single.display_label, '');
  assert.equal(single.formLabel, '业务产品编号');
  console.log('ok: unique field has no slot');

  await browser.close();
  console.log('characterize-form-field-intra-slot: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
