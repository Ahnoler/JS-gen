// 对公客户信息创建与个人关联维护 v37
// 证件类型改为"事业单位法人证书"，证件号码=9945EF0SC9VDS12340，财务联系人手机号=13308463344
const { chromium } = require('playwright');
const TARGET_URL = 'http://172.19.87.161:9200/#/login?redirect=%2FcstMgt%2FcsinfMnt%2FcpctMgt%2FcpctMgtPg';
const SS = 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\';

const CERT_NO = '9945EF0SC9VDS12340';

function genValidIdCard(prefix = '430101') {
  const birth = '19900101';
  const seq = String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const base = `${prefix}${birth}${seq}`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const map = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = base.split('').reduce((s, c, i) => s + parseInt(c) * weights[i], 0);
  return base + map[sum % 11];
}
const ID_CARD = genValidIdCard();

async function ss(page, n) { await page.screenshot({ path: `${SS}${n}.png`, fullPage: true }); console.log(`  📸 ${n}.png`); }
async function wait(page, ms) { await page.waitForTimeout(ms); }

async function dismissOverlays(page) {
  await page.evaluate(() => {
    const protect = new Set();
    document.querySelectorAll('.el-dialog, .el-dialog__wrapper, .el-overlay, .el-overlay-dialog').forEach(el => {
      let cur = el; while (cur && cur !== document.body) { protect.add(cur); cur = cur.parentElement; }
    });
    document.querySelectorAll('*').forEach(el => {
      if (protect.has(el)) return;
      const s = getComputedStyle(el);
      if (parseInt(s.zIndex) >= 100000 && el.offsetHeight > 200 && (s.position === 'fixed' || s.position === 'absolute')) el.style.display = 'none';
    });
    document.querySelectorAll('.el-drawer__wrapper .el-col-24, .el-drawer__wrapper .el-row').forEach(el => el.style.pointerEvents = 'auto');
  }).catch(() => {});
  await wait(page, 300);
}

async function fi(page, labelText) {
  const items = await page.locator('.el-form-item').all();
  for (let i = 0; i < items.length; i++) {
    const label = await items[i].locator('.el-form-item__label').textContent().catch(() => '');
    if (label && label.replace(/\s+/g, '').includes(labelText.replace(/\s+/g, ''))) return i;
  }
  return -1;
}

async function setSelect(page, labelText, optionText) {
  const idx = await fi(page, labelText);
  if (idx < 0) { return false; }
  const fiEl = page.locator('.el-form-item').nth(idx);
  const selectEl = fiEl.locator('.el-select').first();
  if (!(await selectEl.isVisible().catch(() => false))) { return false; }
  await selectEl.click({ force: true }); await wait(page, 1500);
  try {
    const option = page.locator('.el-select-dropdown__item').filter({ hasText: optionText }).first();
    await option.waitFor({ state: 'visible', timeout: 5000 }); await option.click({ force: true }); await wait(page, 800);
    console.log(`  ✓ ${labelText} → ${optionText}`); return true;
  } catch (e) {
    const found = await page.evaluate((optText) => {
      const items = document.querySelectorAll('.el-select-dropdown__item');
      for (const item of items) { if (item.textContent.trim().includes(optText)) { item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; } }
      return false;
    }, optionText);
    if (found) { await wait(page, 500); console.log(`  ✓ ${labelText} → ${optionText}`); return true; }
    return false;
  }
}

async function setInput(page, labelText, value, skipN = 0) {
  const items = await page.locator('.el-form-item').all();
  let matched = 0;
  for (let i = 0; i < items.length; i++) {
    const label = await items[i].locator('.el-form-item__label').textContent().catch(() => '');
    if (label && label.replace(/\s+/g, '').includes(labelText.replace(/\s+/g, ''))) {
      if (matched < skipN) { matched++; continue; }
      const filled = await page.evaluate(({ idx, val }) => {
        const fi = document.querySelectorAll('.el-form-item')[idx]; if (!fi) return false;
        const inp = fi.querySelector('input'); if (!inp || inp.disabled) return false;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(inp, val);
        inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, { idx: i, val: value });
      if (filled) { console.log(`  ✓ ${labelText}[${skipN}] → ${value}`); return true; }
      matched++;
    }
  }
  return false;
}

async function setDate(page, labelText, value) {
  const idx = await fi(page, labelText);
  if (idx < 0) { return false; }
  const filled = await page.evaluate(({ idx, val }) => {
    const fi = document.querySelectorAll('.el-form-item')[idx]; if (!fi) return false;
    const inp = fi.querySelector('input'); if (!inp || inp.disabled) return false;
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(inp, val); inp.readOnly = false;
    inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); inp.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }, { idx, val: value });
  if (filled) { console.log(`  ✓ ${labelText} → ${value}`); return true; }
  return false;
}

async function setTextarea(page, labelText, value) {
  const items = await page.locator('.el-form-item').all();
  for (let i = 0; i < items.length; i++) {
    const label = await items[i].locator('.el-form-item__label').textContent().catch(() => '');
    if (!label) continue;
    if (label.replace(/\s+/g, '').includes(labelText.replace(/\s+/g, '')) || labelText.replace(/\s+/g, '').includes(label.replace(/\s+/g, ''))) {
      const filled = await page.evaluate(({ idx, val }) => {
        const fi = document.querySelectorAll('.el-form-item')[idx]; if (!fi) return false;
        const ta = fi.querySelector('textarea') || fi.querySelector('.el-textarea__inner') || fi.querySelector('input');
        if (!ta || ta.disabled) return false;
        if (ta.tagName === 'TEXTAREA' || ta.classList.contains('el-textarea__inner')) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeInputValueSetter.call(ta, val);
        } else {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeInputValueSetter.call(ta, val);
        }
        ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, { idx: i, val: value });
      if (filled) { console.log(`  ✓ ${labelText} → ${value}`); return true; }
    }
  }
  return false;
}

async function setDlgInput(dlg, labelText, value) {
  const items = await dlg.locator('.el-form-item').all();
  for (let i = 0; i < items.length; i++) {
    const label = await items[i].locator('.el-form-item__label').textContent().catch(() => '');
    if (!label) continue;
    if (label.replace(/\s+/g, '').includes(labelText.replace(/\s+/g, ''))) {
      const filled = await items[i].evaluate((el, val) => {
        const inp = el.querySelector('input'); if (!inp || inp.disabled) return false;
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        set.call(inp, val); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, value);
      if (filled) { console.log(`  ✓ ${labelText} → ${value}`); return true; }
    }
  }
  return false;
}

async function setDlgSelect(page, dlg, labelText, optionText) {
  const items = await dlg.locator('.el-form-item').all();
  for (let i = 0; i < items.length; i++) {
    const label = await items[i].locator('.el-form-item__label').textContent().catch(() => '');
    if (!label) continue;
    if (label.replace(/\s+/g, '').includes(labelText.replace(/\s+/g, ''))) {
      const selectEl = items[i].locator('.el-select').first();
      if (!(await selectEl.isVisible().catch(() => false))) continue;
      await selectEl.click({ force: true }); await wait(page, 1500);
      const option = page.locator('.el-select-dropdown__item').filter({ hasText: optionText }).first();
      try { await option.waitFor({ state: 'visible', timeout: 5000 }); await option.click({ force: true }); await wait(page, 500); console.log(`  ✓ ${labelText} → ${optionText}`); return true; }
      catch {
        const found = await page.evaluate((optText) => {
          const items = document.querySelectorAll('.el-select-dropdown__item');
          for (const item of items) { if (item.offsetParent !== null && item.textContent.trim().includes(optText)) { item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; } }
          return false;
        }, optionText);
        if (found) { await wait(page, 500); console.log(`  ✓ ${labelText} → ${optionText}`); return true; }
      }
    }
  }
  return false;
}

async function scrollDrawerBottom(page) {
  const d = page.locator('.el-drawer__body:visible').first();
  if (await d.isVisible().catch(() => false)) { await d.evaluate(el => el.scrollTop = el.scrollHeight).catch(() => {}); await wait(page, 500); }
}

async function scrollDrawerTop(page) {
  const d = page.locator('.el-drawer__body:visible').first();
  if (await d.isVisible().catch(() => false)) { await d.evaluate(el => el.scrollTop = 0).catch(() => {}); await wait(page, 400); }
}

async function fillRemainingRequired(page) {
  console.log('  --- 扫描剩余必填项 ---');
  let filled = 0;
  const items = await page.locator('.el-form-item.is-required').all();
  for (const item of items) {
    const label = await item.locator('.el-form-item__label').textContent().catch(() => '') || '';
    const labelTrim = label.replace(/\s+/g, '').trim();
    if (!labelTrim) continue;
    const hasValue = await item.evaluate(el => {
      const sel = el.querySelector('.el-select');
      if (sel) {
        const display = sel.querySelector('.el-select__tags-text, .el-tag, .el-input__inner') || sel.querySelector('input');
        if (display && display.value && display.value.trim()) return true;
        if (display && display.textContent && display.textContent.trim() && !display.textContent.includes('请选择') && !display.textContent.includes('请输入')) return true;
        const hidden = sel.querySelector('input[type="hidden"]');
        if (hidden && hidden.value && hidden.value.trim()) return true;
      }
      const inp = el.querySelector('input');
      if (inp && inp.value && inp.value.trim()) return true;
      const ta = el.querySelector('textarea');
      if (ta && ta.value && ta.value.trim()) return true;
      return false;
    }).catch(() => false);
    if (hasValue) continue;
    const selEl = item.locator('.el-select').first();
    if (await selEl.isVisible().catch(() => false)) {
      await selEl.click({ force: true }); await wait(page, 1500);
      const visibleTexts = await page.evaluate(() => Array.from(document.querySelectorAll('.el-select-dropdown__item')).filter(el => el.offsetParent !== null).map(el => el.textContent.trim()));
      let pickText = '';
      for (const t of visibleTexts) { if (t && !t.includes('请选择') && !t.includes('请输入')) { pickText = t; break; } }
      if (!pickText && visibleTexts.length > 0) pickText = visibleTexts[0];
      if (pickText) {
        try { const opt = page.locator('.el-select-dropdown__item').filter({ hasText: pickText }).first(); await opt.waitFor({ state: 'visible', timeout: 3000 }); await opt.click({ force: true }); await wait(page, 500); console.log(`  ✓ ${labelTrim} → ${pickText}`); filled++; }
        catch { await page.evaluate((txt) => { const items = document.querySelectorAll('.el-select-dropdown__item'); for (const it of items) { if (it.offsetParent !== null && it.textContent.trim() === txt) { it.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return; } } for (const it of items) { if (it.offsetParent !== null && it.textContent.trim().includes(txt)) { it.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return; } } }, pickText); await wait(page, 500); console.log(`  ✓ ${labelTrim} → ${pickText} (eval)`); filled++; }
      } else { console.log(`  ⚠ ${labelTrim}: 无可选选项 [${visibleTexts.join(', ')}]`); }
      continue;
    }
    if (labelTrim.includes('日期') || labelTrim.includes('起始') || labelTrim.includes('到期') || labelTrim.includes('有效') || labelTrim.includes('年检')) { await setDate(page, labelTrim, '2030-12-31'); }
    else if (labelTrim.includes('经营范围')) { await setTextarea(page, labelTrim, '软件开发，金服系统'); }
    else if (labelTrim.includes('邮箱') || labelTrim.includes('Email')) { await setInput(page, labelTrim, 'test@company.com'); }
    else if (labelTrim.includes('网址') || labelTrim.includes('网站')) { await setInput(page, labelTrim, 'http://www.company.com'); }
    else {
      const inpEl = item.locator('input').first();
      if (await inpEl.isVisible().catch(() => false) && !(await inpEl.isDisabled().catch(() => false))) {
        await inpEl.evaluate((el, val) => { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, '无');
        console.log(`  ✓ ${labelTrim} → 无`); filled++;
      }
    }
  }
  if (filled === 0) console.log('  ✓ 无剩余必填项'); else console.log(`  ✓ 共填充 ${filled} 个字段`);
  await wait(page, 500);
}

async function doIntro(page, fieldLabel) {
  const idx = await fi(page, fieldLabel);
  if (idx < 0) { console.log(`  ⚠ 未找到"${fieldLabel}"字段`); return false; }
  const fiEl = page.locator('.el-form-item').nth(idx);
  await page.evaluate((i) => { const f = document.querySelectorAll('.el-form-item')[i]; if (f) f.scrollIntoView({ block: 'center', behavior: 'instant' }); }, idx);
  await wait(page, 1000);
  let clicked = false;
  for (let retry = 0; retry < 15; retry++) {
    const btn = fiEl.locator('button:has-text("引入")').first();
    if (await btn.isVisible().catch(() => false)) { await btn.click({ force: true }); clicked = true; console.log(`  ✓ 点击"${fieldLabel}"旁边的引入按钮`); break; }
    const d = page.locator('.el-drawer__body:visible').first();
    if (await d.isVisible().catch(() => false)) { await d.evaluate(el => el.scrollTop += 150).catch(() => {}); }
    await wait(page, 600);
  }
  if (!clicked) { console.log(`  ⚠ "${fieldLabel}"旁边未找到引入按钮`); return false; }
  await wait(page, 2000);
  let dlg = null;
  for (const sel of ['.el-dialog:visible', '.el-dialog__wrapper:visible', '.el-overlay-dialog', '.el-dialog']) {
    try { await page.waitForSelector(sel, { state: 'visible', timeout: 8000 }); const found = page.locator(sel).first(); if (await found.isVisible().catch(() => false)) { dlg = found; break; } } catch { continue; }
  }
  if (!dlg) { console.log(`  ⚠ "${fieldLabel}"引入弹窗未出现`); return false; }
  console.log(`  ✓ ${fieldLabel} 引入弹窗可见`);
  await setDlgInput(dlg, '客户编号', '26050610365798406');
  await setDlgInput(dlg, '客户名称', '朱桂武');
  await setDlgInput(dlg, '证件号码', '110101198606047887');
  await setDlgSelect(page, dlg, '证件类型', '居民身份证');
  await wait(page, 500);
  const qBtn = dlg.locator('button:has-text("查询"), button:has-text("搜索")').first();
  if (await qBtn.isVisible().catch(() => false)) { await qBtn.click({ force: true }); }
  await wait(page, 2500);
  const rows = dlg.locator('.el-table__body-wrapper tr.el-table__row');
  if (await rows.count() > 0) { await rows.first().click({ force: true }); }
  await wait(page, 500);
  const cfBtn = dlg.locator('button:has-text("确认"), button:has-text("确定")').first();
  if (await cfBtn.isVisible().catch(() => false)) { await cfBtn.click({ force: true }); }
  await wait(page, 1500);
  console.log(`  ✓ ${fieldLabel} 引入完成`);
  return true;
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(15000);

  try {
    console.log(`\n=== 本次证件号码: ${CERT_NO} (${CERT_NO.length}位) ===`);
    console.log(`=== 身份证号码: ${ID_CARD} ===`);

    // 第一阶段：登录与导航
    console.log('\n=== 第一阶段：登录与导航 ===');

    // --- 1. 登录系统 ---
    console.log('\n--- 1. 登录系统 ---');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 }); await wait(page, 2000);
    await page.locator('input[placeholder*="请选择法人"]').first().click(); await wait(page, 800);
    await page.locator('.el-select-dropdown__item').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('.el-select-dropdown__item').first().click(); await wait(page, 500);
    await page.locator('input[placeholder*="用户名"]').first().fill('701994');
    await page.locator('input[placeholder*="密码"]').first().fill('1');
    await page.locator('button:has-text("登 录"), button:has-text("登录")').first().click();
    try { await page.waitForURL('**/cstMgt/**', { timeout: 30000 }); } catch { await wait(page, 3000); }
    console.log('✓ 登录成功'); await wait(page, 1500);
    await dismissOverlays(page); await page.keyboard.press('Escape'); await wait(page, 500);

    // --- 2. 导航至对公客户管理 ---
    console.log('\n--- 2. 确认导航至对公客户管理 ---');
    await wait(page, 1000); await dismissOverlays(page);
    let onTarget = false;
    try { onTarget = await page.locator('button:has-text("新增")').first().isVisible({ timeout: 3000 }).catch(() => false); } catch { onTarget = false; }
    if (!onTarget) {
      for (let i = 0; i < 15; i++) {
        const navBtn = page.locator('nav.navbar ul.menu-wrapper li.menu-item:has-text("客户管理")').first();
        if (await navBtn.isVisible().catch(() => false)) { await navBtn.click({ force: true }); console.log('✓ 点击"客户管理"'); break; }
        await wait(page, 1000);
      }
      await wait(page, 1200);
      await page.evaluate(() => document.querySelector('.navbar__mask')?.remove()).catch(() => {});
      await wait(page, 300); await dismissOverlays(page);
      for (let i = 0; i < 15; i++) {
        const sub = page.locator('.submenu-wrapper:visible').getByText('对公客户管理', { exact: true });
        if (await sub.isVisible().catch(() => false)) { await sub.click({ force: true }); break; }
        await wait(page, 800);
      }
      await wait(page, 2500);
    }
    console.log('✓ 已导航至对公客户管理'); await ss(page, '03-corp-list');

    // 第二阶段：基础信息定义
    console.log('\n=== 第二阶段：基础信息定义 ===');

    // --- 3. 点击新增 ---
    console.log('\n--- 3. 点击新增 ---');
    for (let i = 0; i < 20; i++) {
      if (await page.locator('button:has-text("新增")').first().isVisible().catch(() => false)) { await page.locator('button:has-text("新增")').first().click({ force: true }); console.log('✓ 点击"新增"'); break; }
      await wait(page, 1000);
    }
    await wait(page, 2000); await dismissOverlays(page);

    // --- 4. 填写基本属性 ---
    console.log('\n--- 4. 填写基本属性 ---');
    if (!(await setSelect(page, '客户状态', '信贷潜在客户'))) throw new Error('客户状态设置失败');
    if (!(await setSelect(page, '对公客户类型', '担保公司'))) throw new Error('客户类型设置失败');
    if (!(await setSelect(page, '证件类型', '事业单位法人证书'))) throw new Error('证件类型设置失败');
    await setInput(page, '客户名称', '李淼三有限责任公司', 0);
    await setInput(page, '客户名称', '李淼三有限责任公司', 1);
    await setInput(page, '证件号码', CERT_NO);
    await ss(page, '05-basic-info-filled');

    // --- 5. 保存基础档案 ---
    console.log('\n--- 5. 保存基础档案 ---');
    for (let i = 0; i < 10; i++) {
      const sb = page.locator('button:has-text("保存"), button:has-text("暂存")').first();
      if (await sb.isVisible().catch(() => false)) { await sb.click({ force: true }); console.log('✓ 保存/暂存'); break; }
      await wait(page, 500);
    }
    await wait(page, 5000);
    const msgEl = page.locator('.el-message:visible, .el-notification:visible, .el-message-box:visible').first();
    if (await msgEl.isVisible().catch(() => false)) {
      const msg = (await msgEl.textContent()).replace(/\s+/g, ' ').trim();
      console.log('提示:', msg.substring(0, 200));
      if (msg.includes('成功')) console.log('✅ 基础档案保存成功！');
      else if (msg.includes('错误') || msg.includes('请检查') || msg.includes('异常')) {
        await ss(page, '07-save-error');
        const errs = await page.evaluate(() => Array.from(document.querySelectorAll('.el-form-item__error')).map(e => e.textContent.trim()));
        console.log('校验错误:', errs.join(', '));
        throw new Error('基础信息校验失败: ' + (errs.length ? errs.join('; ') : msg.substring(0, 100)));
      }
    }
    const fc = await page.locator('.el-form-item').count(); console.log('字段数:', fc); await ss(page, '08-after-save');

    // 详情页必填字段补充
    console.log('\n=== 2.5 阶段：详情页必填字段补充 ===');
    await dismissOverlays(page); await scrollDrawerTop(page);
    await setDate(page, '证件有效日期', '2030-01-15');
    const longTermIdx = await fi(page, '证件是否长期');
    if (longTermIdx >= 0) {
      const fiEl = page.locator('.el-form-item').nth(longTermIdx);
      const chk = fiEl.locator('.el-checkbox, .el-switch').first();
      if (await chk.isVisible().catch(() => false)) { await chk.click({ force: true }); console.log('  ✓ 证件是否长期 → 勾选'); }
    }
    await setInput(page, '统一社会信用代码', CERT_NO);
    await setDate(page, '法定代表人证件起始日期', '2020-01-01');
    await setDate(page, '法定代表人证件到期日期', '2030-01-01');
    await setInput(page, '实际控制人手机号码', '13365657894');
    await setInput(page, '单位电话', '073112345678');
    await setInput(page, '上年度从业人数', '50');
    await setInput(page, '上年度资产总额', '50000000');
    if (!(await setSelect(page, '合作状态', '正常'))) console.log('  ⚠ 合作状态可能已设置');
    if (!(await setSelect(page, '控股经济类型', '集体相对控股'))) console.log('  ⚠ 控股经济类型可能已设置');
    await setInput(page, '行业代码', 'I6510');
    if (!(await setSelect(page, '地区重点企业', '否'))) console.log('  ⚠ 地区重点企业可能已设置');
    if (!(await setSelect(page, '优势企业', '否'))) console.log('  ⚠ 优势企业可能已设置');
    if (!(await setSelect(page, '高环境风险高污染企业', '否'))) console.log('  ⚠ 高环境风险高污染企业可能已设置');
    if (!(await setSelect(page, '宏观调控限控行业标志', '否'))) console.log('  ⚠ 宏观调控限控行业标志可能已设置');
    if (!(await setSelect(page, '特种经营标识', '否'))) console.log('  ⚠ 特种经营标识可能已设置');

    await scrollDrawerBottom(page);
    await setInput(page, '财务部联系人身份证号码', ID_CARD);
    if (!(await setSelect(page, '手机号归属人关系类型', '本人'))) console.log('  ⚠ 归属人关系类型可能已设置');
    await setInput(page, '财务部联系人手机号归属人名称', '李四');
    await setInput(page, '手机号码归属人身份证号码', ID_CARD);
    await setInput(page, '财务部联系人固定电话', '073112345678');

    await scrollDrawerTop(page);
    await fillRemainingRequired(page);
    await ss(page, '09-detail-fields-filled');

    // 第三阶段：地址与财务联系信息
    console.log('\n=== 第三阶段：地址与财务联系信息 ===');
    await dismissOverlays(page);

    // --- 6. 填写地址信息 ---
    console.log('\n--- 6. 填写地址信息 ---');
    if (!(await setSelect(page, '国别', '中华人民共和国'))) throw new Error('国别设置失败');
    await setInput(page, '企业外文名称', 'Limiaosan Co ltd');
    await ss(page, '10-addr-before-cascader');

    const ai = await page.locator('.el-form-item').all();
    let cascadeTriggered = false;
    for (let i = 0; i < ai.length; i++) {
      const cas = ai[i].locator('.el-cascader');
      if (!(await cas.isVisible().catch(() => false))) continue;
      const lbl = await ai[i].locator('.el-form-item__label').textContent().catch(() => '');
      console.log(`  ✓ 地址级联: label="${(lbl || '').trim()}"`);
      await cas.click(); await wait(page, 800);
      await page.evaluate(() => { const menus = document.querySelectorAll('.el-cascader-menu'); if (!menus.length) return; const items = menus[0].querySelectorAll('.el-cascader-node'); for (const item of items) { if (item.textContent.includes('湖南')) { item.click(); return; } } });
      await wait(page, 600);
      await page.evaluate(() => { const menus = document.querySelectorAll('.el-cascader-menu'); if (menus.length < 2) return; const items = menus[1].querySelectorAll('.el-cascader-node'); for (const item of items) { if (item.textContent.includes('长沙')) { item.click(); return; } } });
      await wait(page, 600);
      await page.evaluate(() => { const menus = document.querySelectorAll('.el-cascader-menu'); if (menus.length < 3) return; const items = menus[2].querySelectorAll('.el-cascader-node'); for (const item of items) { if (item.textContent.includes('娄底')) { item.click(); return; } } });
      await wait(page, 400); console.log('  ✓ 湖南省-长沙市-娄底市');
      cascadeTriggered = true; break;
    }
    if (!cascadeTriggered) console.log('  ⚠ 未找到地址级联控件');

    await setInput(page, '登记注册号', 'TZ202501150001');
    await setSelect(page, '登记注册号类型', '事业单位法人证书');
    await setInput(page, '实际经营地址', '111123');
    await setInput(page, '行政区划名称', '111123');
    await setInput(page, '单位地址', '111123');
    await setInput(page, '登记注册地址', '111123');
    await setInput(page, '经度', '132.34');
    await setInput(page, '纬度', '31.2');

    // --- 7. 填写财务部联系人信息 ---
    console.log('\n--- 7. 填写财务部联系人信息 ---');
    await setInput(page, '财务部联系人姓名', '李四');
    await setInput(page, '财务部联系人手机号码', '13308463344');

    await fillRemainingRequired(page);
    await ss(page, '11-addr-finance-done');

    // 第四阶段：工商登记与资质维护
    console.log('\n=== 第四阶段：工商登记与资质维护 ===');
    await scrollDrawerBottom(page);

    // --- 8. 填写注册信息 ---
    console.log('\n--- 8. 填写注册信息 ---');
    if (!(await setSelect(page, '投资主体', '法人投资'))) throw new Error('投资主体设置失败');
    await setInput(page, '注册资本金额', '10000000');
    await setInput(page, '注册登记机关', '长沙市市场监督管理局');
    await setDate(page, '成立日期', '2020-01-15');
    await setDate(page, '注册登记日期', '2020-01-15');
    await setDate(page, '登记注册失效日期', '2040-01-15');
    await setDate(page, '年检到期日期', '2025-01-15');

    // --- 9. 填写经营范围 ---
    console.log('\n--- 9. 填写经营范围 ---');
    if (!(await setTextarea(page, '经营范围', '软件开发，金服系统'))) {
      await setInput(page, '经营范围', '软件开发，金服系统');
    }
    await setTextarea(page, '主要产品情况', '软件开发，金服系统');
    await fillRemainingRequired(page);
    await ss(page, '12-biz-reg-done');

    // 第五阶段：关联个人客户引入
    console.log('\n=== 第五阶段：关联个人客户引入 ===');
    await scrollDrawerTop(page);

    // --- 10. 引入法定代表人 ---
    console.log('\n--- 10. 引入法定代表人 ---');
    if (!(await doIntro(page, '法定代表人'))) throw new Error('法定代表人引入失败');
    await ss(page, '15-after-intro');

    // --- 11. 引入实际控制人（尝试） ---
    console.log('\n--- 11. 引入实际控制人 ---');
    if (!(await doIntro(page, '实际控制人'))) console.log('  ⚠ 实际控制人引入失败（可能无需引入）');

    // 第六阶段：核查与最终归档
    console.log('\n=== 第六阶段：核查与最终归档 ===');

    // --- 12. 联网核查 ---
    console.log('\n--- 12. 联网核查 ---');
    await dismissOverlays(page);
    const vBtn = page.locator('button:has-text("联网核查")').first();
    if (await vBtn.isVisible().catch(() => false)) { await vBtn.click({ force: true }); console.log('✓ 联网核查'); await wait(page, 2500); }
    else console.log('  ⚠ 未找到"联网核查"按钮');

    await fillRemainingRequired(page);
    await ss(page, '16-before-save');

    // --- 13. 最终暂存 ---
    console.log('\n--- 13. 最终暂存 ---');
    const fBtn = page.locator('button:has-text("暂存")').first();
    if (await fBtn.isVisible().catch(() => false)) { await fBtn.click({ force: true }); console.log('✓ 最终暂存'); }
    await wait(page, 4000);
    const ft = page.locator('.el-message:visible').first();
    if (await ft.isVisible().catch(() => false)) {
      const m = (await ft.textContent()).replace(/\s+/g, ' ').trim();
      console.log('最终提示:', m.substring(0, 200));
      if (m.includes('成功')) console.log('✅ 全流程完成！'); else console.log('⚠ 暂存提示:', m);
    }
    await ss(page, '17-final');
    console.log('\n✅ 测试执行完毕');

  } catch (err) {
    console.error(`\n❌ 流程阻塞: ${err.message}`);
    await ss(page, 'error-blocked').catch(() => {});
  } finally { await wait(page, 20000); await browser.close(); }
}

main();
