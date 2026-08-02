#!/usr/bin/env node
/** Full xpath probe on current 对公客户管理 page (already open). */
import { chromium } from 'playwright';
import { PAGE_LOCATOR_HELPERS } from '../src/cdp/locator-candidates.js';
import { buildResolveExpression } from '../src/cdp/resolve-by-label.js';
import { prepareElementJson, hasUsableLocator } from '../src/models/element.js';

const CDP = 'http://127.0.0.1:9242';

function summarize(loc, name) {
  if (!loc) return { name, ok: false, error: 'null' };
  let prepared;
  try {
    prepared = prepareElementJson({ element: loc, actionType: 'click_element_by_index', requireUsable: true });
  } catch (e) {
    prepared = { error: e.message };
  }
  return {
    name,
    ok: !prepared.error && hasUsableLocator(prepared),
    strategy: loc.locator_strategy,
    verified: !!loc.locator_verified,
    kind: loc.target_kind || '',
    formLabel: loc.formLabel || '',
    text: (loc.text || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    smart: loc.xpath_smart || '',
    fallback: loc.locator_fallback_reason || '',
  };
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages().find((p) => !p.url().includes('devtools'));
  await page.waitForTimeout(1500);

  const inventory = await page.evaluate(`(() => {
${PAGE_LOCATOR_HELPERS}
    const labels = [...document.querySelectorAll('.el-form-item')]
      .filter((item) => item.offsetParent !== null || isVisible(item))
      .map((item) => {
        const lbl = normalizeFormLabel(item.querySelector('.el-form-item__label')?.textContent);
        const ctrl = item.querySelector('.el-input__inner, .el-textarea__inner, .el-select, .el-date-editor, .el-radio-group, input:not([type=hidden]), textarea');
        if (!lbl || !ctrl) return null;
        const host = normalizeTargetRoot(ctrl) || ctrl;
        const loc = buildLocatorSnap(host, cleanVisibleText(host), absXPath(host), lbl);
        return {
          label: lbl,
          strategy: loc.locator_strategy,
          verified: loc.locator_verified,
          kind: loc.target_kind,
          smart: loc.xpath_smart,
          fallback: loc.locator_fallback_reason || '',
        };
      })
      .filter(Boolean);

    const buttons = [];
    for (const t of ['查询', '重置', '新增', '修改', '查看', '联网核查', '法院信息', '影像资料']) {
      const el = [...document.querySelectorAll('button, .el-button')].find((b) => {
        const tx = (b.innerText || b.textContent || '').replace(/\\s+/g, ' ').trim();
        return tx === t || tx.includes(t);
      });
      if (!el || !(el.offsetParent !== null || isVisible(el))) continue;
      const host = normalizeTargetRoot(el) || el;
      const loc = buildLocatorSnap(host, cleanVisibleText(host), absXPath(host), '');
      buttons.push({ text: t, strategy: loc.locator_strategy, verified: loc.locator_verified, smart: loc.xpath_smart, kind: loc.target_kind });
    }

    const rowBtn = (() => {
      const btn = [...document.querySelectorAll('.el-table__body tr.el-table__row button, .el-table__body tr.el-table__row .el-button, .el-table__row a')]
        .find((b) => b.offsetParent !== null || isVisible(b));
      // Prefer toolbar 修改/查看 which may not be in-row; find first row cell action icons
      const row = document.querySelector('.el-table__body tr.el-table__row');
      if (!row) return { row: null, btn: null };
      const firstCell = row.querySelector('td .cell, td');
      const rowText = normalizeControlText(firstCell?.innerText || firstCell?.textContent || '');
      const inRow = row.querySelector('button, .el-button, a, [class*="el-icon"]');
      if (!inRow) return { rowText, btn: null, cells: (row.innerText || '').slice(0, 80) };
      const host = normalizeTargetRoot(inRow) || inRow;
      const loc = buildLocatorSnap(host, cleanVisibleText(host), absXPath(host), '');
      return { rowText, cells: (row.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100), strategy: loc.locator_strategy, verified: loc.locator_verified, smart: loc.xpath_smart, kind: loc.target_kind, text: loc.text };
    })();

    return {
      url: location.href,
      title: document.title,
      labels,
      buttons,
      rowBtn,
      tableRows: document.querySelectorAll('.el-table__body tr.el-table__row').length,
    };
  })()`);

  console.log(JSON.stringify(inventory, null, 2));

  // resolve checks
  for (const [actionType, params, labelText] of [
    ['click_menu_item', { menu_text: '客户管理' }, ''],
    ['click_menu_item', { menu_text: '对公客户管理' }, ''],
    ['fill_form_field', { label_text: '客户名称' }, '客户名称'],
    ['fill_form_field', { label_text: '客户编号' }, '客户编号'],
  ]) {
    const resolved = await page.evaluate(buildResolveExpression({ actionType, params, labelText }));
    const list = Array.isArray(resolved) ? resolved : (resolved ? [resolved] : []);
    console.log('[resolve]', actionType, params.menu_text || labelText || params.label_text, 'n=' + list.length, JSON.stringify(summarize(list[0], 'r'), null, 2));
  }

  // Verify smart xpaths actually resolve to 1 node and click-query works
  const verify = await page.evaluate(`(() => {
${PAGE_LOCATOR_HELPERS}
    const checks = [];
    const samples = [
      "//li[@data-id='RES000000001']",
      "//div[contains(@class,'el-form-item')][.//label[contains(normalize-space(.),'客户名称')]]//input",
      "//button[normalize-space()='查询']",
      "//button[normalize-space()='新增']",
    ];
    for (const xp of samples) {
      const nodes = evalXpathAll(xp);
      checks.push({ xp, count: nodes.length, visible: nodes.filter((n) => isVisible(n)).length });
    }
    return checks;
  })()`);
  console.log('[verify-xpath]', JSON.stringify(verify, null, 2));

  const formsOk = (inventory.labels || []).filter((x) => x.strategy === 'xpath_smart' && x.verified).length;
  const btnsOk = (inventory.buttons || []).filter((x) => x.strategy === 'xpath_smart' && x.verified).length;
  console.log(JSON.stringify({
    score: {
      formsOk, formsTotal: inventory.labels?.length || 0,
      buttonsOk: btnsOk, buttonsTotal: inventory.buttons?.length || 0,
      tableRows: inventory.tableRows,
    },
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
