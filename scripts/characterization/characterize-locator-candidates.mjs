/**
 * Characterize relative xpath builders (form / menu / icon / tab / table / close).
 *
 *   node scripts/characterization/characterize-locator-candidates.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildAdjacentButtonXPathSmart,
  buildCloseXPathSmart,
  buildFormFieldXPathSmart,
  buildIconXPathSmart,
  buildMenuXPathSmart,
  buildStableAttrXPathSmart,
  buildTabXPathSmart,
  buildTableRowButtonXPathSmart,
  buildTableRowRadioXPathSmart,
  buildTreeNodeXPathSmart,
  buildPlaceholderXPathSmart,
  buildXPathSmart,
  classTokenPred,
  detectContainerKind,
  enrichLocatorFields,
  isGeneratedId,
  xpathLiteral,
} from '../../src/cdp/locator-candidates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function ok(name) {
  console.log(`ok: ${name}`);
}

{
  assert.equal(xpathLiteral("客户名称"), "'客户名称'");
  assert.equal(xpathLiteral("O'Brien"), `"O'Brien"`);
  assert.ok(xpathLiteral("a'b\"c").startsWith('concat('));
  ok('xpathLiteral');
}

{
  assert.ok(classTokenPred('el-menu-item').includes("normalize-space(@class)"));
  assert.ok(!classTokenPred('menu-item').includes('[class*='));
  ok('classTokenPred exact token');
}

{
  assert.equal(isGeneratedId('el-id-abc'), true);
  assert.equal(isGeneratedId('12345'), true);
  assert.equal(isGeneratedId('tab-1735097474632972'), true);
  assert.equal(isGeneratedId('customer-menu'), false);
  assert.equal(isGeneratedId('RES000000001'), false);
  ok('isGeneratedId');
}

{
  const xp = buildFormFieldXPathSmart({
    label: '客户名称',
    tag: 'input',
    className: 'el-input__inner',
  });
  assert.equal(
    xp,
    "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'客户名称')]]//input",
  );
  ok('form field xpath_smart');
}

{
  const xp = buildFormFieldXPathSmart({
    label: '搜索关键字：',
    tag: 'input',
    xpathFull: '/div[1]/div[2]/div[contains(@class,"el-dialog")]/input[1]',
  });
  assert.ok(xp.includes('el-dialog'));
  assert.ok(xp.includes('搜索关键字'));
  assert.ok(xp.endsWith('//input'));
  ok('form field dialog-scoped');
}

{
  const xp = buildFormFieldXPathSmart({
    label: '备注',
    tag: 'textarea',
    className: 'el-textarea__inner',
  });
  assert.ok(xp.endsWith('//textarea'));
  ok('form field textarea');
}

{
  const xp = buildFormFieldXPathSmart({
    label: '状态',
    tag: 'div',
    className: 'el-select',
  });
  assert.ok(xp.includes("div[contains(@class,'el-select')]"));
  ok('form field select');
}

{
  const xp = buildFormFieldXPathSmart({
    label: '日期',
    className: 'el-date-editor',
  });
  assert.ok(xp.includes("div[contains(@class,'el-date-editor')]"));
  ok('form field date');
}

{
  const xp = buildFormFieldXPathSmart({
    label: '行业代码',
    tag: 'span',
    className: 'el-tooltip my-popover item',
  });
  assert.ok(xp.includes('行业代码'));
  assert.ok(xp.includes("span[contains(@class,'my-popover')]"));
  ok('form field tsscTree my-popover');
}

{
  const xp = buildXPathSmart({
    tag: 'button',
    text: '确定',
    className: 'el-button el-button--primary',
  });
  assert.equal(xp, "//button[normalize-space()='确定']");
  ok('button xpath_smart');
}

{
  const xp = buildMenuXPathSmart({
    tag: 'li',
    text: '客户管理',
    className: 'el-menu-item',
  });
  assert.ok(xp.includes('客户管理'));
  assert.ok(xp.includes(classTokenPred('el-menu-item')));
  assert.ok(!xp.includes('[class*='));
  // XPath 1.0: predicates must be siblings of self:: or — not (self::a or self::b)[pred]
  assert.ok(xp.includes('*[self::li or self::a or self::div or self::span]['));
  assert.ok(!/\(self::li or self::a[^)]*\)\[/.test(xp));
  ok('menu xpath_smart class token');
}

{
  const xp = buildMenuXPathSmart({
    tag: 'div',
    text: '系统设置',
    className: 'el-submenu__title',
  });
  assert.ok(xp.includes('系统设置'));
  assert.ok(xp.includes(classTokenPred('el-submenu__title')));
  ok('submenu title host');
}

{
  const xp = buildStableAttrXPathSmart({
    tag: 'li',
    attributes: { 'data-id': 'customer-mgmt' },
  });
  assert.equal(xp, "//li[@data-id='customer-mgmt']");
  ok('stable data-id attr');
}

{
  const xp = buildStableAttrXPathSmart({
    tag: 'div',
    attributes: { id: 'el-id-12345' },
  });
  assert.equal(xp, '');
  ok('rejects generated id');
}

{
  const xp = buildIconXPathSmart({
    text: '刷新',
    attributes: { 'aria-label': '刷新' },
  });
  assert.ok(xp.includes('@aria-label'));
  assert.ok(xp.includes('刷新'));
  ok('icon xpath_smart');
}

{
  const xp = buildIconXPathSmart({
    text: '删除',
    className: 'el-tooltip el-icon-delete',
  });
  assert.ok(xp.includes("el-icon-delete"));
  assert.ok(!xp.includes('@aria-label'));
  ok('icon prefers el-icon class');
}

{
  const xp = buildTreeNodeXPathSmart({ text: '贷款(272)' });
  assert.ok(xp.includes('贷款'));
  assert.ok(!xp.includes('(272)'));
  assert.ok(xp.includes('starts-with'));
  ok('tree strips volatile count');
}

{
  const xp = buildTreeNodeXPathSmart({ text: '票据', parentText: '提货担保' });
  assert.ok(xp.includes('提货担保'));
  assert.ok(xp.includes('el-tree-node__children'));
  ok('tree parent axis');
}

{
  const xp = buildFormFieldXPathSmart({
    label: '搜索关键字：',
    tag: 'input',
    xpathFull: '/div[1]/div[2]/div[contains(@class,"el-dialog")]/input[1]',
  });
  assert.ok(!xp.includes('[last()]'), xp);
  ok('dialog scope without [last()]');
}

{
  const xp = buildPlaceholderXPathSmart({ placeholder: '搜索关键字' });
  assert.ok(xp.includes('@placeholder'));
  assert.ok(xp.includes('搜索关键字'));
  ok('placeholder xpath_smart');
}

{
  const xp = buildTabXPathSmart({ tabName: '基本信息' });
  assert.ok(xp.includes('基本信息'));
  assert.ok(xp.includes(classTokenPred('el-tabs__item')));
  ok('tab xpath_smart');
}

{
  const xp = buildTableRowButtonXPathSmart({
    rowText: '张三',
    buttonText: '编辑',
  });
  assert.ok(xp.includes('张三'));
  assert.ok(xp.includes('编辑'));
  assert.ok(xp.includes('tr['));
  ok('table row button');
}

{
  const xp = buildTableRowRadioXPathSmart({ rowText: '李四' });
  assert.ok(xp.includes('李四'));
  assert.ok(xp.includes(classTokenPred('el-radio')));
  ok('table row radio');
}

{
  const xp = buildCloseXPathSmart({ targetKind: 'dialog_close' });
  assert.ok(xp.includes('el-dialog'));
  assert.ok(xp.includes(classTokenPred('el-dialog__headerbtn')));
  ok('dialog close');
}

{
  // Element UI drawer close uses inner i.el-dialog__close — must NOT scope to dialog only.
  assert.notEqual(
    detectContainerKind('/div[4]/header[1]/button[1]/i[1]', 'el-dialog__close el-icon el-icon-close'),
    'dialog',
    'el-dialog__close icon class must not detect as dialog container',
  );
  ok('detectContainerKind ignores el-dialog__close icon');
}

{
  const xp = buildCloseXPathSmart({
    targetKind: 'dialog_close',
    className: 'el-dialog__close el-icon el-icon-close',
    xpathFull: '/div[4]/div[1]/div[1]/header[1]/button[1]/i[1]',
  });
  assert.ok(
    xp.includes("contains(@class,'el-drawer')"),
    'icon-only close xpath must include el-drawer scope (traj36 regression)',
  );
  assert.ok(xp.includes('el-dialog') || xp.includes('el-message-box'), 'still covers dialog');
  ok('close xpath covers drawer when only icon class known');
}

{
  const xp = buildCloseXPathSmart({
    targetKind: 'dialog_close',
    className: 'el-drawer__close-btn',
    container: 'drawer',
  });
  assert.ok(xp.includes("contains(@class,'el-drawer')"));
  assert.ok(!xp.startsWith("//div[contains(@class,'el-dialog')"));
  ok('explicit drawer close scopes to drawer');
}

{
  const xp = buildAdjacentButtonXPathSmart({
    formLabel: '手机号',
    buttonText: '获取验证码',
  });
  assert.ok(xp.includes('手机号'));
  assert.ok(xp.includes('获取验证码'));
  ok('adjacent button');
}

{
  const xp = buildTreeNodeXPathSmart({ text: '华东区' });
  assert.ok(xp.includes('华东区'));
  assert.ok(xp.includes(classTokenPred('el-tree-node__content')));
  ok('tree node');
}

{
  const xp = buildXPathSmart({
    targetKind: 'menu',
    text: '客户管理',
    className: 'menu-item',
    attributes: { 'data-id': 'cust' },
  });
  assert.equal(xp, "//li[@data-id='cust']");
  ok('menu prefers stable attr');
}

{
  const enriched = enrichLocatorFields({
    tag: 'input',
    text: '测试人员某',
    formLabel: '客户名称',
    xpath_full: '/div[1]/form[1]/div[3]/input[1]',
    cssSelector: 'input.el-input__inner',
    attributes: { class: 'el-input__inner', disabled: 'disabled', value: 'SECRET' },
  });
  assert.equal(
    enriched.xpath_smart,
    "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'客户名称')]]//input",
  );
  assert.equal(enriched.xpath, enriched.xpath_smart);
  assert.equal(enriched.locator_strategy, 'xpath_smart');
  assert.equal(enriched.candidates[0].type, 'xpath_smart');
  assert.equal(enriched.candidates[1].type, 'xpath_full');
  assert.equal(enriched.attributes.value, undefined);
  ok('enrichLocatorFields prefers form label over input value');
}

{
  const enriched = enrichLocatorFields({
    tag: 'input',
    text: '测试人员某',
    xpath_full: '/div[1]/input[1]',
    cssSelector: 'input.el-input__inner',
  });
  assert.equal(enriched.xpath_smart, '');
  assert.equal(enriched.xpath, '/div[1]/input[1]');
  assert.equal(enriched.locator_strategy, 'xpath_full');
  assert.ok(enriched.locator_fallback_reason);
  ok('input without formLabel keeps absolute primary');
}

{
  const enriched = enrichLocatorFields({
    tag: 'li',
    text: '客户管理',
    className: 'el-menu-item',
    xpath_full: '/ul[1]/li[3]',
    attributes: { class: 'el-menu-item' },
    target_kind: 'menu',
  });
  assert.ok(enriched.xpath_smart.includes('客户管理'));
  assert.equal(enriched.locator_strategy, 'xpath_smart');
  assert.equal(enriched.target_kind, 'menu');
  ok('enrich menu target_kind');
}

{
  // Python mirror must contain the same page helpers.
  const py = readFileSync(join(__dirname, '..', 'controller', 'actions', 'js_snippets', '_locator_helpers_js.py'), 'utf8');
  assert.ok(py.includes('buildLocatorSnap'));
  assert.ok(py.includes('normalizeTargetRoot'));
  assert.ok(py.includes('classTokenPred'));
  assert.ok(py.includes('MENU_CLASS_TOKENS'));
  ok('python PAGE_LOCATOR_HELPERS mirror present');
}

console.log('characterize-locator-candidates: OK');
