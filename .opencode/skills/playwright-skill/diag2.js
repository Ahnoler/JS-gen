// 诊断v2：分析保存按钮点击后的行为
const { chromium } = require('playwright');
const TARGET_URL = 'http://172.19.87.161:9200/';
const SS = 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(12000);

  // 监听console和network
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[CONSOLE ${msg.type()}] ${msg.text().substring(0, 200)}`); });
  page.on('response', resp => { if (resp.status() >= 400) console.log(`[HTTP ${resp.status()}] ${resp.url().substring(0, 120)}`); });

  // 登录
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('input[placeholder*="请选择法人"]').first().click();
  await page.waitForTimeout(800);
  await page.locator('.el-select-dropdown__item').first().click();
  await page.locator('input[placeholder*="用户名"]').first().fill('701994');
  await page.locator('input[placeholder*="密码"]').first().fill('1');
  await page.locator('button:has-text("登 录"), button:has-text("登录")').first().click();
  try { await page.waitForURL('**/home**', { timeout: 30000 }); } catch { await page.waitForTimeout(3000); }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelectorAll('*').forEach(el => { const s = getComputedStyle(el); if (parseInt(s.zIndex) >= 100000 && el.offsetHeight > 200 && (s.position === 'fixed' || s.position === 'absolute')) el.style.display = 'none'; }); }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 导航
  await page.locator('nav.navbar ul.menu-wrapper li.menu-item:has-text("客户管理")').first().click({ force: true });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.navbar__mask')?.remove()).catch(() => {});
  await page.locator('.submenu-wrapper:visible').getByText('对公客户管理', { exact: true }).click({ force: true });
  await page.waitForTimeout(2500);

  // 新增
  for (let i = 0; i < 20; i++) {
    if (await page.locator('button:has-text("新增")').first().isVisible().catch(() => false)) {
      await page.locator('button:has-text("新增")').first().click({ force: true }); break;
    }
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelectorAll('.el-drawer__wrapper .el-col-24, .el-drawer__wrapper .el-row').forEach(el => { el.style.pointerEvents = 'auto'; }); }).catch(() => {});

  // 填写（两个客户名称都填）
  const items = await page.locator('.el-form-item').all();
  let nameIdx = 0;
  for (const item of items) {
    const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
    const ln = label.replace(/\s+/g, '');
    if (ln.includes('客户名称')) {
      const inp = item.locator('input').first();
      const ro = await inp.getAttribute('readonly').catch(() => null);
      if (ro === null) {
        await inp.click({ force: true }); await inp.fill('李淼一有限责任公司');
        console.log(`✓ 客户名称[${nameIdx}] 已填`); 
      } else {
        console.log(`⚠ 客户名称[${nameIdx}] readonly`);
      }
      nameIdx++;
    }
    if (ln.includes('客户状态')) {
      await item.locator('input').first().click({ force: true });
      await page.waitForTimeout(800);
      const pop = page.locator('.el-select-dropdown:visible').first();
      if (await pop.isVisible().catch(() => false)) {
        const opts = pop.locator('.el-select-dropdown__item');
        for (let i = 0; i < await opts.count(); i++) {
          if ((await opts.nth(i).textContent()).includes('信贷正式客户')) { await opts.nth(i).click(); console.log('✓ 客户状态'); break; }
        }
      }
    }
    if (ln.includes('对公客户类型')) {
      await item.locator('input').first().click({ force: true });
      await page.waitForTimeout(800);
      const pop = page.locator('.el-select-dropdown:visible').first();
      if (await pop.isVisible().catch(() => false)) {
        const opts = pop.locator('.el-select-dropdown__item');
        for (let i = 0; i < await opts.count(); i++) {
          if ((await opts.nth(i).textContent()).includes('集体经济组织')) { await opts.nth(i).click(); console.log('✓ 对公客户类型'); break; }
        }
      }
    }
    if (ln.includes('证件类型') && !ln.includes('证件号码')) {
      await item.locator('input').first().click({ force: true });
      await page.waitForTimeout(800);
      const pop = page.locator('.el-select-dropdown:visible').first();
      if (await pop.isVisible().catch(() => false)) {
        const opts = pop.locator('.el-select-dropdown__item');
        for (let i = 0; i < await opts.count(); i++) {
          if ((await opts.nth(i).textContent()).includes('证券业务许可证')) { await opts.nth(i).click(); console.log('✓ 证件类型'); break; }
        }
      }
    }
    if (ln.includes('证件号码')) {
      const inp = item.locator('input').first();
      const ro = await inp.getAttribute('readonly').catch(() => null);
      if (ro === null) { await inp.click({ force: true }); await inp.fill('1234EF0SC9VDS12340'); console.log('✓ 证件号码'); }
    }
  }

  // 验证所有字段
  console.log('\n--- 验证所有字段值 ---');
  const items2 = await page.locator('.el-form-item').all();
  for (const item of items2) {
    const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
    const val = await item.locator('input').first().inputValue().catch(() => '');
    const ro = await item.locator('input').first().getAttribute('readonly').catch(() => null);
    console.log(`  ${label.trim()} = "${val}" ${ro !== null ? '[readonly]' : ''}`);
  }

  // 检查保存按钮
  console.log('\n--- 保存按钮分析 ---');
  const saveBtns = await page.locator('button:has-text("保存")').all();
  console.log(`保存按钮数: ${saveBtns.length}`);
  for (let i = 0; i < saveBtns.length; i++) {
    const visible = await saveBtns[i].isVisible().catch(() => false);
    const disabled = await saveBtns[i].isDisabled().catch(() => false);
    const text = await saveBtns[i].textContent().catch(() => '');
    const cls = await saveBtns[i].getAttribute('class').catch(() => '');
    console.log(`  保存按钮[${i}]: visible=${visible} disabled=${disabled} text="${text.trim()}" class="${cls}"`);
  }

  // 点击保存按钮（用evaluate直接触发click事件）
  console.log('\n--- 点击保存 ---');
  // 先用Playwright方式
  if (saveBtns.length > 0 && await saveBtns[0].isVisible().catch(() => false)) {
    // 检查按钮是否被遮挡
    const box = await saveBtns[0].boundingBox().catch(() => null);
    console.log('保存按钮位置:', box);
    
    await saveBtns[0].click({ force: true });
    console.log('Playwright click done');
  }

  await page.waitForTimeout(5000);

  // 检查所有toast/dialog
  const msgs = await page.locator('.el-message:visible, .el-notification:visible, .el-message-box:visible, .el-form-item__error:visible').all();
  console.log(`\n提示/错误数: ${msgs.length}`);
  for (const m of msgs) {
    const txt = (await m.textContent()).replace(/\s+/g, ' ').trim();
    console.log(`  "${txt.substring(0, 200)}"`);
  }

  // 检查URL是否变化
  console.log('URL:', page.url());

  // 检查字段数
  console.log('字段数:', await page.locator('.el-form-item').count());

  await page.screenshot({ path: `${SS}diag2-after-save.png`, fullPage: true });

  await page.waitForTimeout(30000);
  await browser.close();
})();
