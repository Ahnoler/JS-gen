/**
 * Same form-item multi-control scan must emit one row per leaf control.
 *
 *   node scripts/characterization/cold/characterize-same-family-scan.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PAGE_LOCATOR_HELPERS } from '../../../src/cdp/locator-candidates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCAN_FORM_PY = join(__dirname, '../../controller/actions/js_snippets/scan_form.py');

const FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>same family scan</title>
<style>
  .el-form-item { display:flex; gap:8px; }
  .el-select, .el-input { display:inline-block; min-width:80px; border:1px solid #ccc; }
  input { width:72px; }
</style></head><body>
<div class="titlebox"><div class="title">产品基础参数</div></div>
<div class="el-form-item" id="ratio-item">
  <label class="el-form-item__label">保证金比例</label>
  <div class="el-form-item__content">
    <div class="tsscInput"><div class="el-input"><input id="in-a" class="el-input__inner" placeholder="请输入" value="9" /></div></div>
    <div class="tssc-multi-select">
      <div id="sel-a" class="el-select"><input class="el-input__inner" placeholder="请选择 " readonly value="元" /></div>
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
<div class="el-form-item" id="date-item">
  <label class="el-form-item__label">生效日期</label>
  <div class="el-form-item__content">
    <div class="el-date-editor el-input el-date-editor--date">
      <input id="date-in" class="el-input__inner" placeholder="选择日期" />
    </div>
  </div>
</div>
<div class="el-form-item" id="radio-item">
  <label class="el-form-item__label">是否启用</label>
  <div class="el-form-item__content">
    <div class="el-radio-group">
      <label class="el-radio"><span class="el-radio__input"><input type="radio" name="en" /></span><span class="el-radio__label">是</span></label>
      <label class="el-radio"><span class="el-radio__input"><input type="radio" name="en" /></span><span class="el-radio__label">否</span></label>
    </div>
  </div>
</div>
<div class="el-form-item" id="mixed-dd-item">
  <label class="el-form-item__label">混合下拉</label>
  <div class="el-form-item__content">
    <div id="plain-sel" class="el-select"><input class="el-input__inner" placeholder="请选择" readonly /></div>
    <div class="tssc-multi-select">
      <div id="tssc-sel" class="el-select"><input class="el-input__inner" placeholder="请选择" readonly /></div>
    </div>
  </div>
</div>
</body></html>`;

function evalScan() {
  return `(() => {
${PAGE_LOCATOR_HELPERS}
    function hitId(xpath) {
      const hits = evalXpathAll(xpath || '');
      return { count: hits.length, id: hits[0] && hits[0].id };
    }
    const item = document.getElementById('ratio-item');
    const rows = listFormItemScanFields(item);
    const single = listFormItemScanFields(document.getElementById('single-item'));
    const dateRows = listFormItemScanFields(document.getElementById('date-item'));
    const radioRows = listFormItemScanFields(document.getElementById('radio-item'));
    const mixedDd = listFormItemScanFields(document.getElementById('mixed-dd-item'));
    return {
      rows,
      kinds: rows.map((r) => r.kind),
      slots: rows.map((r) => r.field_slot),
      labels: rows.map((r) => r.label),
      xpaths: rows.map((r) => r.xpath_smart),
      hits: rows.map((r) => hitId(r.xpath_smart)),
      values: rows.map((r) => r.currentValue),
      single,
      dateRows,
      radioRows,
      mixedDd: {
        kinds: mixedDd.map((r) => r.kind),
        slots: mixedDd.map((r) => r.field_slot),
        length: mixedDd.length,
      },
    };
  })()`;
}

function assertPhase1SplitGate() {
  const src = readFileSync(SCAN_FORM_PY, 'utf8');
  assert.ok(
    /listFormItemScanFields/.test(src),
    'scan_form Phase 1 must call listFormItemScanFields',
  );
  // Gate continue on family >= 2 (field_slot), not any non-empty split (hijacks one-field items).
  assert.ok(
    /useSplit/.test(src) && /split\.some/.test(src) && /field_slot/.test(src),
    'Phase 1 must continue into split only when a family count is >= 2 (field_slot gate)',
  );
  assert.ok(
    !/if\s*\(\s*split\s*&&\s*split\.length\s*\)\s*\{/.test(src),
    'Phase 1 must not continue solely because split.length is truthy',
  );
}

async function main() {
  assertPhase1SplitGate();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(FIXTURE);

  const out = await page.evaluate(evalScan());

  assert.equal(out.rows.length, 4);
  assert.deepEqual(out.kinds, ['input', 'tssc-multi-select', 'tssc-multi-select', 'input']);
  assert.deepEqual(out.slots, ['A', 'A', 'B', 'B']);
  assert.ok(out.labels.every((l) => l === '保证金比例'));
  assert.equal(out.rows[0].display_label, '保证金比例-A');
  assert.equal(out.values[0], '9');
  assert.equal(out.values[1], '元');

  const xpaths = new Set(out.xpaths);
  assert.equal(xpaths.size, 4, 'xpath_smart must be unique: ' + JSON.stringify(out.xpaths));
  for (const h of out.hits) {
    assert.equal(h.count, 1, 'each xpath_smart must hit exactly one node');
  }
  assert.equal(out.hits[0].id, 'in-a');
  assert.equal(out.hits[3].id, 'in-b');

  assert.equal(out.single.length, 1);
  assert.equal(out.single[0].field_slot, '');
  assert.equal(out.single[0].kind, 'input');
  assert.ok(!out.single[0].display_label);

  assert.equal(out.dateRows.length, 0, 'date item must not be slotted as plain input');
  assert.equal(out.radioRows.length, 0, 'radio item must not be slotted as plain input');

  assert.equal(out.mixedDd.length, 2);
  assert.deepEqual(out.mixedDd.kinds, ['select', 'tssc-multi-select']);
  assert.deepEqual(out.mixedDd.slots, ['A', 'B'], 'plain select + tssc share dropdown family slots');

  await browser.close();
  console.log('ok: same-family scan split');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
