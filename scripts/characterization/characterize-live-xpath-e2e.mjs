/**
 * Live DOM E2E for unified xpath_smart capture (AI / manual snap / resolve API).
 *
 * Launches ephemeral Chromium (or --cdp=http://127.0.0.1:9242), injects an
 * Element-UI-shaped fixture, and asserts the three write-path builders produce
 * verified relative xpath_smart for representative targets.
 *
 *   node scripts/characterization/characterize-live-xpath-e2e.mjs
 *   node scripts/characterization/characterize-live-xpath-e2e.mjs --cdp=http://127.0.0.1:9242
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PAGE_LOCATOR_HELPERS } from '../../src/cdp/locator-candidates.js';
import { buildResolveExpression } from '../../src/cdp/resolve-by-label.js';
import { prepareElementJson, hasUsableLocator } from '../../src/models/element.js';

const cdpArg = process.argv.find((a) => a.startsWith('--cdp='));
const CDP_URL = cdpArg ? cdpArg.slice('--cdp='.length) : '';

const FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>xpath e2e fixture</title>
<style>
  body { font-family: sans-serif; margin: 16px; }
  .el-menu { list-style: none; padding: 0; display: flex; gap: 8px; }
  .el-menu-item, .menu-item { padding: 8px 12px; cursor: pointer; border: 1px solid #ddd; }
  .el-form-item { margin: 12px 0; display: flex; align-items: center; gap: 8px; }
  .el-form-item__label { width: 96px; }
  .el-input__inner, .el-textarea__inner { min-width: 200px; padding: 4px 8px; }
  .el-select { border: 1px solid #ccc; padding: 4px 8px; min-width: 200px; }
  .el-date-editor input { min-width: 200px; }
  .el-radio-group label { margin-right: 8px; }
  .el-tabs__item { display: inline-block; padding: 6px 10px; border: 1px solid #ddd; margin-right: 4px; }
  .el-tabs__item.is-active { background: #eef; }
  .el-table { border-collapse: collapse; width: 100%; margin-top: 12px; }
  .el-table th, .el-table td { border: 1px solid #ddd; padding: 6px 8px; }
  .el-button { padding: 4px 10px; cursor: pointer; }
  .el-dialog { border: 1px solid #999; padding: 12px; margin-top: 16px; position: relative; }
  .el-dialog__headerbtn { position: absolute; right: 8px; top: 8px; }
  .el-icon-close::before { content: "×"; }
  .icon-btn i { font-style: normal; }
</style></head><body>
<nav>
  <ul class="el-menu">
    <li class="el-menu-item">首页</li>
    <li class="el-menu-item menu-item">客户管理</li>
    <li class="el-menu-item">系统设置</li>
  </ul>
</nav>
<form class="el-form">
  <div class="el-form-item">
    <label class="el-form-item__label">客户名称</label>
    <div class="el-form-item__content">
      <input class="el-input__inner" type="text" value="秘密值勿落库" />
    </div>
  </div>
  <div class="el-form-item">
    <label class="el-form-item__label">备注</label>
    <div class="el-form-item__content">
      <textarea class="el-textarea__inner"></textarea>
    </div>
  </div>
  <div class="el-form-item">
    <label class="el-form-item__label">状态</label>
    <div class="el-form-item__content">
      <div class="el-select"><span>请选择</span></div>
    </div>
  </div>
  <div class="el-form-item">
    <label class="el-form-item__label">生效日期</label>
    <div class="el-form-item__content">
      <div class="el-date-editor"><input class="el-input__inner" type="text" /></div>
    </div>
  </div>
  <div class="el-form-item">
    <label class="el-form-item__label">客户类型</label>
    <div class="el-form-item__content">
      <div class="el-radio-group">
        <label class="el-radio"><input type="radio" name="t" />个人</label>
        <label class="el-radio"><input type="radio" name="t" />企业</label>
      </div>
    </div>
  </div>
</form>
<div class="el-tabs__header">
  <div class="el-tabs__item">基本信息</div>
  <div class="el-tabs__item is-active">联系人</div>
</div>
<table class="el-table">
  <thead><tr><th>姓名</th><th>操作</th></tr></thead>
  <tbody>
    <tr class="el-table__row"><td>张三</td><td><button class="el-button">编辑</button></td></tr>
    <tr class="el-table__row"><td>李四</td><td><button class="el-button">编辑</button></td></tr>
  </tbody>
</table>
<button type="button" class="el-button icon-btn" title="刷新"><i class="el-icon-refresh">刷新</i></button>
<button type="button" class="el-button">新增</button>
<div class="el-dialog">
  <button type="button" class="el-dialog__headerbtn" aria-label="Close"><i class="el-icon-close"></i></button>
  <div>对话框内容</div>
  <button type="button" class="el-button">确定</button>
</div>
</body></html>`;

/** AI capture snippet — mirrors scripts/controller/actions/_js_snippets.JS_SMART_LOCATOR core. */
function aiSmartLocatorExpr(label) {
  const lit = JSON.stringify(label);
  return `(() => {
    const label = ${lit};
${PAGE_LOCATOR_HELPERS}
    const want = normalizeFormLabel(label);
    if (!want) return null;
    function formItemLabel(item) {
      const lbl = item.querySelector('.el-form-item__label');
      return normalizeFormLabel(lbl && lbl.textContent);
    }
    function pickControl(item) {
      const candidates = [
        item.querySelector('.el-input__inner'),
        item.querySelector('.el-textarea__inner'),
        item.querySelector('.el-select'),
        item.querySelector('.el-date-editor'),
        item.querySelector('.el-radio-group'),
        item.querySelector('input:not([type="hidden"])'),
        item.querySelector('textarea'),
      ].filter(Boolean);
      return candidates[0] || null;
    }
    let matched = null;
    for (const item of document.querySelectorAll('.el-form-item')) {
      const lbl = formItemLabel(item);
      if (!lbl) continue;
      if (lbl === want || lbl.includes(want) || want.includes(lbl)) {
        matched = { item, label: lbl };
        if (lbl === want) break;
      }
    }
    const target = matched ? pickControl(matched.item) : null;
    if (!target) return null;
    const host = normalizeTargetRoot(target) || target;
    const abs = absXPath(host);
    const loc = buildLocatorSnap(host, cleanVisibleText(host), abs, matched.label);
    return loc;
  })()`;
}

/** Manual/CDP inspect path — mirrors inspect.js / manual_recorder/js.py. */
function manualSnapExpr(selector, formLabel = '', targetKind = '') {
  const sel = JSON.stringify(selector);
  const fl = JSON.stringify(formLabel);
  const tk = JSON.stringify(targetKind);
  return `(() => {
${PAGE_LOCATOR_HELPERS}
    const el = document.querySelector(${sel});
    if (!el) return null;
    const host = normalizeTargetRoot(el) || el;
    const abs = absXPath(host);
    return buildLocatorSnap(host, cleanVisibleText(host), abs, ${fl}, { targetKind: ${tk} || undefined });
  })()`;
}

function assertSmart(loc, name, { mustInclude = [], actionType = 'click_element_by_index', params = {} } = {}) {
  assert.ok(loc, `${name}: missing locator snap`);
  assert.equal(loc.locator_strategy, 'xpath_smart', `${name}: strategy=${loc.locator_strategy}`);
  assert.equal(loc.locator_verified, true, `${name}: not verified`);
  assert.ok(
    loc.xpath_smart && (loc.xpath_smart.startsWith('//') || loc.xpath_smart.startsWith('(')),
    `${name}: xpath_smart not relative: ${loc.xpath_smart}`,
  );
  assert.ok(!String(loc.xpath_smart).startsWith('/html'), `${name}: absolute primary`);
  for (const s of mustInclude) {
    assert.ok(String(loc.xpath_smart).includes(s), `${name}: missing ${s} in ${loc.xpath_smart}`);
  }
  assert.ok(loc.xpath_full, `${name}: missing xpath_full`);
  const attrs = loc.attributes || {};
  assert.ok(!('value' in attrs), `${name}: value attr leaked`);
  const prepared = prepareElementJson({
    element: loc,
    actionType,
    params,
    requireUsable: true,
  });
  assert.ok(hasUsableLocator(prepared), `${name}: prepareElementJson unusable`);
  assert.equal(prepared.xpath, prepared.xpath_smart || prepared.xpath_full);
  console.log(`ok: ${name} → ${loc.xpath_smart}`);
  return prepared;
}

async function runOnPage(page) {
  await page.setContent(FIXTURE, { waitUntil: 'domcontentloaded' });

  // --- AI path (form fields) ---
  for (const [label, bits, action, params] of [
    ['客户名称', ['el-form-item', '客户名称', 'input'], 'fill_form_field', { label_text: '客户名称' }],
    ['备注', ['el-form-item', '备注', 'textarea'], 'fill_form_field', { label_text: '备注' }],
    ['状态', ['el-form-item', '状态', 'el-select'], 'select_option', { label_text: '状态' }],
    ['生效日期', ['el-form-item', '生效日期'], 'fill_date_field', { label_text: '生效日期' }],
    ['客户类型', ['el-form-item', '客户类型'], 'click_radio', { label_text: '客户类型' }],
  ]) {
    const loc = await page.evaluate(aiSmartLocatorExpr(label));
    assertSmart(loc, `AI fill ${label}`, { mustInclude: bits, actionType: action, params });
  }

  // --- Manual snap path ---
  const menu = await page.evaluate(manualSnapExpr('li.el-menu-item.menu-item', '', 'menu'));
  assertSmart(menu, 'manual menu 客户管理', {
    mustInclude: ['客户管理'],
    actionType: 'click_menu_item',
    params: { menu_text: '客户管理' },
  });

  const icon = await page.evaluate(manualSnapExpr('button.icon-btn', '', 'icon'));
  assertSmart(icon, 'manual icon refresh', {
    mustInclude: [],
    actionType: 'click_icon_button',
    params: { text: '刷新' },
  });

  const tab = await page.evaluate(manualSnapExpr('.el-tabs__item.is-active', '', 'tab'));
  assertSmart(tab, 'manual tab 联系人', {
    mustInclude: ['联系人'],
    actionType: 'click_tab',
    params: { tab_name: '联系人' },
  });

  const rowBtn = await page.evaluate(manualSnapExpr('tr.el-table__row:first-child button', '', 'table_row_button'));
  assertSmart(rowBtn, 'manual table row 编辑', {
    mustInclude: ['张三', '编辑'],
    actionType: 'click_table_row_button',
    params: { row_text: '张三', button_text: '编辑' },
  });

  const close = await page.evaluate(manualSnapExpr('.el-dialog__headerbtn', '', 'close'));
  assertSmart(close, 'manual dialog close', {
    mustInclude: [],
    actionType: 'close_dialog',
    params: {},
  });

  // --- API resolve-element path (page expression + prepare) ---
  const single = await page.evaluate(buildResolveExpression({
    labelText: '客户名称',
    actionType: 'fill_form_field',
    params: { label_text: '客户名称' },
  }));
  assert.ok(Array.isArray(single) ? single.length === 1 : single, 'resolve single missing');
  const one = Array.isArray(single) ? single[0] : single;
  assertSmart(one, 'API resolve 客户名称', {
    mustInclude: ['客户名称'],
    actionType: 'fill_form_field',
    params: { label_text: '客户名称' },
  });

  const menuResolve = await page.evaluate(buildResolveExpression({
    labelText: '',
    actionType: 'click_menu_item',
    params: { menu_text: '客户管理' },
  }));
  const menuOne = Array.isArray(menuResolve) ? menuResolve[0] : menuResolve;
  assertSmart(menuOne, 'API resolve menu', {
    mustInclude: ['客户管理'],
    actionType: 'click_menu_item',
    params: { menu_text: '客户管理' },
  });

  // Ambiguous: two "编辑" buttons without row scope → matches[]
  const amb = await page.evaluate(buildResolveExpression({
    labelText: '',
    actionType: 'click_element_by_index',
    params: { text: '编辑' },
  }));
  const ambList = Array.isArray(amb) ? amb : (amb ? [amb] : []);
  assert.ok(ambList.length >= 2, `expected ambiguous 编辑 matches, got ${ambList.length}`);
  for (const m of ambList) {
    assert.ok(m.xpath_smart || m.xpath_full, 'ambiguous match missing xpath');
  }
  console.log(`ok: API ambiguous 编辑 → ${ambList.length} matches`);
}

async function main() {
  let browser;
  let page;
  if (CDP_URL) {
    browser = await chromium.connectOverCDP(CDP_URL);
    const ctx = browser.contexts()[0] || await browser.newContext();
    page = ctx.pages()[0] || await ctx.newPage();
    console.log(`[live-xpath-e2e] connected ${CDP_URL}`);
  } else {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    console.log('[live-xpath-e2e] launched ephemeral Chromium');
  }
  try {
    await runOnPage(page);
    console.log('live-xpath-e2e: OK');
  } finally {
    if (!CDP_URL && browser) {
      await browser.close();
    } else if (CDP_URL) {
      await page.goto('about:blank').catch(() => {});
    }
  }
  // CDP WebSocket otherwise keeps Node alive and would close headed Chrome on browser.close().
  if (CDP_URL) process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
