#!/usr/bin/env node
/**
 * Continue real-system xpath probe after user login (CDP 9242).
 * Does NOT navigate away — inspects current page, optionally clicks menus.
 *
 *   node scripts/_probe_real_xpath_loggedin.mjs
 *   CLICK_MENU=客户管理 node scripts/_probe_real_xpath_loggedin.mjs
 */
import { chromium } from 'playwright';
import { PAGE_LOCATOR_HELPERS } from '../src/cdp/locator-candidates.js';
import { buildResolveExpression } from '../src/cdp/resolve-by-label.js';
import { prepareElementJson, hasUsableLocator } from '../src/models/element.js';

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9242';
const CLICK_MENU = (process.env.CLICK_MENU || '客户管理').trim();

function summarize(loc, name) {
  if (!loc) return { name, ok: false, error: 'null' };
  let prepared;
  try {
    prepared = prepareElementJson({
      element: loc,
      actionType: loc.target_kind === 'menu' ? 'click_menu_item' : 'fill_form_field',
      params: loc.formLabel
        ? { label_text: loc.formLabel }
        : { menu_text: loc.text || '' },
      requireUsable: true,
    });
  } catch (e) {
    prepared = { error: e.message };
  }
  const smart = loc.xpath_smart || '';
  const relative = !!(smart && (smart.startsWith('//') || smart.startsWith('(')) && !smart.startsWith('/html'));
  return {
    name,
    ok: loc.locator_strategy === 'xpath_smart' && loc.locator_verified === true && relative && hasUsableLocator(prepared) && !prepared.error,
    strategy: loc.locator_strategy,
    verified: !!loc.locator_verified,
    relative,
    kind: loc.target_kind || '',
    text: (loc.text || '').slice(0, 40),
    formLabel: loc.formLabel || '',
    smart: smart.slice(0, 160),
    fullHead: String(loc.xpath_full || '').slice(0, 60),
    fallback: loc.locator_fallback_reason || '',
    usable: hasUsableLocator(prepared) && !prepared.error,
  };
}

async function evalHelpers(page, body) {
  return page.evaluate(`(() => {\n${PAGE_LOCATOR_HELPERS}\n${body}\n})()`);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('no browser context');
  const page = ctx.pages().find((p) => {
    const u = p.url();
    return u.startsWith('http') && !u.includes('devtools');
  }) || ctx.pages()[0];
  if (!page) throw new Error('no page');

  const meta = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    hasPassword: !!document.querySelector('input[type="password"]'),
    menuCount: document.querySelectorAll('.el-menu-item, .el-submenu__title, .menu-item').length,
  }));
  console.log('[probe2] page', JSON.stringify(meta));
  if (meta.hasPassword && /login/i.test(meta.url)) {
    console.log('[probe2] still on login — abort');
    process.exit(2);
  }

  const menus = await evalHelpers(page, `
    const out = [];
    const nodes = [...document.querySelectorAll('.el-menu-item, .el-submenu__title, .menu-item, [role="menuitem"]')]
      .filter((el) => el.offsetParent !== null);
    for (const el of nodes.slice(0, 40)) {
      const host = normalizeTargetRoot(el) || el;
      const t = cleanVisibleText(host);
      if (!t) continue;
      const loc = buildLocatorSnap(host, t, absXPath(host), '', { targetKind: 'menu' });
      out.push({
        text: t,
        className: String(host.className || '').slice(0, 80),
        strategy: loc.locator_strategy,
        verified: loc.locator_verified,
        smart: loc.xpath_smart,
        kind: loc.target_kind,
        fallback: loc.locator_fallback_reason || '',
      });
    }
    return out;
  `);
  console.log('[probe2] menu snaps count', menus.length);
  const menuSummary = menus.map((m) => ({
    text: m.text,
    ok: m.strategy === 'xpath_smart' && m.verified,
    smart: (m.smart || '').slice(0, 120),
    fallback: m.fallback,
  }));
  console.log(JSON.stringify(menuSummary, null, 2));

  const target = menus.find((m) => m.text.includes(CLICK_MENU))
    || menus.find((m) => m.text.includes('客户'))
    || menus[0];

  if (target?.smart && target.verified) {
    console.log('[probe2] clicking', target.text, '→', target.smart);
    try {
      await page.locator(`xpath=${target.smart}`).first().click({ timeout: 8000 });
      await page.waitForTimeout(2500);
    } catch (e) {
      console.log('[probe2] xpath click failed:', e.message);
      try {
        await page.getByText(target.text, { exact: true }).first().click({ timeout: 5000 });
        await page.waitForTimeout(2500);
      } catch (e2) {
        console.log('[probe2] text click failed:', e2.message);
      }
    }
  } else if (target) {
    console.log('[probe2] target not verified, text click', target.text);
    try {
      await page.getByText(target.text, { exact: false }).first().click({ timeout: 5000 });
      await page.waitForTimeout(2500);
    } catch (e) {
      console.log('[probe2] click failed:', e.message);
    }
  }

  const after = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    labels: [...document.querySelectorAll('.el-form-item__label')]
      .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 30),
    buttons: [...document.querySelectorAll('button, .el-button')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim())
      .filter((t) => t && t.length <= 16)
      .slice(0, 30),
    tabs: [...document.querySelectorAll('.el-tabs__item')]
      .map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20),
    icons: [...document.querySelectorAll('[aria-label], [title]')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.getAttribute('aria-label') || el.getAttribute('title') || '')
      .filter((t) => t && t.length <= 20)
      .slice(0, 20),
  }));
  console.log('[probe2] after click', JSON.stringify({
    url: after.url,
    title: after.title,
    labels: after.labels,
    buttons: after.buttons,
    tabs: after.tabs,
    icons: after.icons,
  }, null, 2));

  // Form AI snaps
  const formResults = [];
  for (const label of after.labels.slice(0, 8)) {
    const loc = await page.evaluate(`((label) => {
${PAGE_LOCATOR_HELPERS}
      const want = normalizeFormLabel(label);
      function formItemLabel(item) {
        const lbl = item.querySelector('.el-form-item__label');
        return normalizeFormLabel(lbl && lbl.textContent);
      }
      function pickControl(item) {
        return (
          item.querySelector('.el-input__inner')
          || item.querySelector('.el-textarea__inner')
          || item.querySelector('.el-select')
          || item.querySelector('.el-date-editor')
          || item.querySelector('.el-radio-group')
          || item.querySelector('input:not([type="hidden"])')
          || item.querySelector('textarea')
        );
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
      if (!matched) return null;
      const target = pickControl(matched.item);
      if (!target) return null;
      const host = normalizeTargetRoot(target) || target;
      return buildLocatorSnap(host, cleanVisibleText(host), absXPath(host), matched.label);
    })(${JSON.stringify(label)})`);
    formResults.push(summarize(loc, `form:${label}`));
  }
  console.log('[probe2] form snaps', JSON.stringify(formResults, null, 2));

  // Button / icon / tab snaps
  const misc = await evalHelpers(page, `
    const out = [];
    for (const el of [...document.querySelectorAll('button.el-button, .el-button')].filter(e => e.offsetParent).slice(0, 10)) {
      const host = normalizeTargetRoot(el) || el;
      const t = cleanVisibleText(host);
      if (!t || t.length > 16) continue;
      const loc = buildLocatorSnap(host, t, absXPath(host), '');
      out.push({ kindHint: 'button', text: t, strategy: loc.locator_strategy, verified: loc.locator_verified, smart: loc.xpath_smart, target_kind: loc.target_kind });
    }
    for (const el of [...document.querySelectorAll('.el-tabs__item')].filter(e => e.offsetParent).slice(0, 6)) {
      const host = normalizeTargetRoot(el) || el;
      const t = cleanVisibleText(host);
      if (!t) continue;
      const loc = buildLocatorSnap(host, t, absXPath(host), '', { targetKind: 'tab' });
      out.push({ kindHint: 'tab', text: t, strategy: loc.locator_strategy, verified: loc.locator_verified, smart: loc.xpath_smart, target_kind: loc.target_kind });
    }
    for (const el of [...document.querySelectorAll('button[title], [aria-label]')].filter(e => e.offsetParent).slice(0, 6)) {
      const host = normalizeTargetRoot(el) || el;
      const t = el.getAttribute('aria-label') || el.getAttribute('title') || cleanVisibleText(host);
      if (!t || t.length > 20) continue;
      const loc = buildLocatorSnap(host, t, absXPath(host), '', { targetKind: 'icon' });
      out.push({ kindHint: 'icon', text: t, strategy: loc.locator_strategy, verified: loc.locator_verified, smart: loc.xpath_smart, target_kind: loc.target_kind });
    }
    // table row buttons
    for (const el of [...document.querySelectorAll('.el-table__body button, .el-table__body .el-button')].filter(e => e.offsetParent).slice(0, 4)) {
      const host = normalizeTargetRoot(el) || el;
      const t = cleanVisibleText(host);
      const loc = buildLocatorSnap(host, t, absXPath(host), '', { targetKind: 'table_row_button' });
      out.push({ kindHint: 'table_row_button', text: t, strategy: loc.locator_strategy, verified: loc.locator_verified, smart: loc.xpath_smart, target_kind: loc.target_kind });
    }
    return out;
  `);
  console.log('[probe2] misc snaps', JSON.stringify(misc.map((m) => ({
    kindHint: m.kindHint,
    text: m.text,
    ok: m.strategy === 'xpath_smart' && m.verified,
    smart: (m.smart || '').slice(0, 140),
    target_kind: m.target_kind,
  })), null, 2));

  // resolve-element API path
  if (target?.text) {
    const resolved = await page.evaluate(buildResolveExpression({
      actionType: 'click_menu_item',
      params: { menu_text: target.text },
    }));
    const one = Array.isArray(resolved) ? resolved[0] : resolved;
    console.log('[probe2] resolve menu', JSON.stringify(summarize(one, 'resolve-menu'), null, 2));
  }
  if (after.labels[0]) {
    const label = after.labels[0];
    const resolved = await page.evaluate(buildResolveExpression({
      labelText: label,
      actionType: 'fill_form_field',
      params: { label_text: label },
    }));
    const list = Array.isArray(resolved) ? resolved : (resolved ? [resolved] : []);
    console.log('[probe2] resolve form', JSON.stringify({
      label,
      count: list.length,
      first: summarize(list[0], 'resolve-form'),
    }, null, 2));
  }

  const menuOk = menus.filter((m) => m.strategy === 'xpath_smart' && m.verified).length;
  const formOk = formResults.filter((f) => f.ok).length;
  const miscOk = misc.filter((m) => m.strategy === 'xpath_smart' && m.verified).length;
  console.log('[probe2] SCORE', JSON.stringify({
    menus: `${menuOk}/${menus.length}`,
    forms: `${formOk}/${formResults.length}`,
    misc: `${miscOk}/${misc.length}`,
    url: after.url,
  }));

  process.exit(0);
}

main().catch((e) => {
  console.error('[probe2] FAIL', e);
  process.exit(1);
});
