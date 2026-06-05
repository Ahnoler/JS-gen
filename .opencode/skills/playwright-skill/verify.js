// 验证：检查客户列表是否有新创建的客户
const { chromium } = require('playwright');
const TARGET_URL = 'http://172.19.87.161:9200/';
const SS = 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(12000);

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
  await page.evaluate(() => { document.querySelectorAll('*').forEach(el => { const s = getComputedStyle(el); if (parseInt(s.zIndex) >= 100000 && el.offsetHeight > 200) el.style.display = 'none'; }); }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 导航到对公客户管理列表
  await page.locator('nav.navbar ul.menu-wrapper li.menu-item:has-text("客户管理")').first().click({ force: true });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.navbar__mask')?.remove()).catch(() => {});
  await page.locator('.submenu-wrapper:visible').getByText('对公客户管理', { exact: true }).click({ force: true });
  await page.waitForTimeout(3000);

  await page.screenshot({ path: `${SS}verify-list.png`, fullPage: true });
  console.log('📸 verify-list.png');

  // 读取列表内容
  const tableText = await page.locator('.el-table:visible').textContent().catch(() => '');
  console.log('\n表格文本(前500字):');
  console.log(tableText.replace(/\s+/g, ' ').trim().substring(0, 500));

  // 查找"李淼一"
  if (tableText.includes('李淼一')) {
    console.log('\n✅ 客户"李淼一有限责任公司"出现在列表中！');
  } else {
    console.log('\n⚠ 未在列表中找到"李淼一"');
  }

  // 查看所有按钮
  console.log('\n--- 按钮 ---');
  const btns = await page.locator('button:visible').all();
  for (let i = 0; i < Math.min(20, btns.length); i++) {
    console.log(`  [${i}] ${(await btns.nth(i).textContent()).trim().substring(0, 30)}`);
  }

  // 搜索功能
  console.log('\n--- 尝试搜索 ---');
  const searchInputs = await page.locator('input[placeholder*="客户名称"], input[placeholder*="客户编号"], input[placeholder*="证件"]').all();
  for (const inp of searchInputs) {
    const ph = await inp.getAttribute('placeholder').catch(() => '');
    console.log(`搜索框: placeholder="${ph}"`);
    if (ph && (ph.includes('客户名称') || ph.includes('客户姓名'))) {
      await inp.scrollIntoViewIfNeeded().catch(() => {});
      await inp.click({ force: true });
      await inp.fill('李淼一');
      console.log('  已输入"李淼一"');
    }
  }
  await page.waitForTimeout(1000);
  const queryBtn = page.locator('button:has-text("查询"), button:has-text("搜索")').first();
  if (await queryBtn.isVisible().catch(() => false)) {
    await queryBtn.click({ force: true });
    console.log('✓ 点击查询');
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SS}verify-search-result.png`, fullPage: true });
  console.log('📸 verify-search-result.png');

  const searchResult = await page.locator('.el-table:visible').textContent().catch(() => '');
  console.log('\n搜索结果:', searchResult.replace(/\s+/g, ' ').trim().substring(0, 500));

  if (searchResult.includes('李淼一')) {
    console.log('\n✅ 搜索验证通过！');
  } else {
    console.log('\n⚠ 搜索结果中未找到');
  }

  await page.waitForTimeout(20000);
  await browser.close();
})();
