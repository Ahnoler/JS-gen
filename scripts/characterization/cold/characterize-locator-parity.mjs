/**
 * Parity: offline locator-builders vs live PAGE_LOCATOR_HELPERS (formFieldXpathSmartOf).
 *
 *   node scripts/characterization/characterize-locator-parity.mjs
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  buildFormFieldXPathSmart,
  buildPlaceholderXPathSmart,
  PAGE_LOCATOR_HELPERS,
} from '../../src/cdp/locator-candidates.js';
import { scopedXPath } from '../../src/cdp/locator-builders/scope.js';

const FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>locator parity</title>
<style>
  .el-form-item { margin: 12px 0; display: flex; align-items: center; gap: 8px; }
  .el-form-item__label { width: 120px; }
  .el-input__inner { min-width: 200px; padding: 4px 8px; }
  .el-select { border: 1px solid #ccc; padding: 4px 8px; min-width: 200px; }
  .el-dialog, .el-drawer { border: 1px solid #999; padding: 12px; margin: 16px 0; }
</style></head><body>
<form class="el-form">
  <div class="el-form-item" data-case="bare-page">
    <label class="el-form-item__label">客户名称</label>
    <div class="el-form-item__content">
      <input id="bare-input" class="el-input__inner" type="text" />
    </div>
  </div>
  <div class="el-form-item" data-case="placeholder-only">
    <div class="el-form-item__content">
      <input id="ph-input" class="el-input__inner" type="text" placeholder="请输入账号" />
    </div>
  </div>
</form>
<div class="el-dialog" data-case="dialog">
  <div class="el-form-item">
    <label class="el-form-item__label">核心产品编号</label>
    <div class="el-form-item__content">
      <input id="dialog-input" class="el-input__inner" type="text" />
    </div>
  </div>
</div>
<div class="el-drawer" data-case="drawer">
  <div class="el-form-item">
    <label class="el-form-item__label">证件类型</label>
    <div class="el-form-item__content">
      <div id="drawer-select" class="el-select"><input id="drawer-select-input" class="el-input__inner" readonly /></div>
    </div>
  </div>
</div>
</body></html>`;

function normXp(xp) {
  return String(xp || '').replace(/\s+/g, '').trim();
}

function helperExpr(selector, formLabel = '') {
  const sel = JSON.stringify(selector);
  const fl = JSON.stringify(formLabel);
  return `(() => {
${PAGE_LOCATOR_HELPERS}
    const el = document.querySelector(${sel});
    if (!el) return '';
    const host = el;
    return formFieldXpathSmartOf(host, ${fl}) || '';
  })()`;
}

/** Offline builder side — mirrors enrich / dispatcher for each fixture kind. */
function builderXp(caseId, opts) {
  switch (caseId) {
    case 'dialog-input':
      return buildFormFieldXPathSmart({
        label: '核心产品编号',
        tag: 'input',
        className: 'el-input__inner',
        container: 'dialog',
      });
    case 'drawer-select':
      return buildFormFieldXPathSmart({
        label: '证件类型',
        tag: 'div',
        className: 'el-select',
        container: 'drawer',
      });
    case 'placeholder-only':
      return buildPlaceholderXPathSmart({
        placeholder: '请输入账号',
        tag: 'input',
      });
    case 'bare-page':
      return buildFormFieldXPathSmart({
        label: '客户名称',
        tag: 'input',
        className: 'el-input__inner',
      });
    default:
      return '';
  }
}

const CASES = [
  {
    id: 'dialog-input',
    selector: '#dialog-input',
    formLabel: '核心产品编号',
    family: 'dialog scope + form-item + label + //input',
  },
  {
    id: 'drawer-select',
    selector: '#drawer-select',
    formLabel: '证件类型',
    family: 'drawer scope + form-item + el-select',
  },
  {
    id: 'placeholder-only',
    selector: '#ph-input',
    formLabel: '',
    family: 'scoped placeholder xpath',
  },
  {
    id: 'bare-page',
    selector: '#bare-input',
    formLabel: '客户名称',
    family: 'page form-item + label + //input',
  },
  {
    id: 'dialog-xpathFull',
    selector: '#dialog-input',
    formLabel: '核心产品编号',
    family: 'dialog scope from xpathFull',
    builderOnly: () =>
      buildFormFieldXPathSmart({
        label: '核心产品编号',
        tag: 'input',
        className: 'el-input__inner',
        xpathFull: '/html/body/div[contains(@class,"el-dialog")]/div/input',
      }),
  },
  {
    id: 'drawer-select-inner-input',
    selector: '#drawer-select-input',
    formLabel: '证件类型',
    family: 'drawer select leaf when operable is inner input',
    builderOnly: () =>
      buildFormFieldXPathSmart({
        label: '证件类型',
        tag: 'input',
        className: 'el-input__inner',
        container: 'drawer',
        targetKind: 'form_select',
      }),
  },
];

function ok(name) {
  console.log(`ok: ${name}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(FIXTURE);

  // scopedXPath smoke — builders export matches helpers prefix shape
  const dialogPrefix = scopedXPath('div[contains(@class,"el-form-item")]', 'dialog');
  assert.ok(dialogPrefix.includes('el-dialog') || dialogPrefix.includes('el-message-box'));
  assert.ok(!dialogPrefix.includes('[last()]'), 'scopedXPath dialog: no [last()]');
  ok('scopedXPath dialog prefix');

  for (const c of CASES) {
    const helper = await page.evaluate(helperExpr(c.selector, c.formLabel));
    const builder = c.builderOnly ? c.builderOnly() : builderXp(c.id);
    assert.ok(helper, `${c.id}: helpers empty`);
    assert.ok(builder, `${c.id}: builder empty`);
    if (normXp(helper) !== normXp(builder)) {
      throw new Error(
        `${c.id} parity mismatch (${c.family})\n  helpers:  ${helper}\n  builder: ${builder}`,
      );
    }
    assert.ok(!helper.includes('[last()]'), `${c.id}: no [last()]`);
    ok(`parity ${c.id}`);
  }

  await browser.close();
  console.log('characterize-locator-parity: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
