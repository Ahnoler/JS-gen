// 诊断脚本：分析保存后的页面状态
const { chromium } = require('playwright');
const TARGET_URL = 'http://172.19.87.161:9200/';
const SS = 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
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

  // 移除遮挡层
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      const s = getComputedStyle(el);
      if (parseInt(s.zIndex) >= 100000 && el.offsetHeight > 200 && (s.position === 'fixed' || s.position === 'absolute')) el.style.display = 'none';
    });
  }).catch(() => {});
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

  // 填写基础信息
  const clickSel = async (lt, ot) => {
    const items = await page.locator('.el-form-item').all();
    for (const item of items) {
      const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
      if (label && label.replace(/\s+/g, '').includes(lt)) {
        await item.locator('input, .el-input__inner').first().click({ force: true });
        await page.waitForTimeout(800);
        const pop = page.locator('.el-select-dropdown:visible, .el-popper:visible').first();
        if (await pop.isVisible().catch(() => false)) {
          const opts = pop.locator('.el-select-dropdown__item');
          for (let i = 0; i < await opts.count(); i++) {
            if ((await opts.nth(i).textContent().catch(() => '')).replace(/\s+/g, '').includes(ot)) {
              await opts.nth(i).click(); return;
            }
          }
        }
        return;
      }
    }
  };

  const fillInp = async (lt, v) => {
    const items = await page.locator('.el-form-item').all();
    for (const item of items) {
      const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
      if (label && label.replace(/\s+/g, '').includes(lt)) {
        const inp = item.locator('input').first();
        const ro = await inp.getAttribute('readonly').catch(() => null);
        if (ro === null) { await inp.click({ force: true }); await inp.fill(v); return; }
      }
    }
  };

  await clickSel('客户状态', '信贷正式客户');
  await clickSel('对公客户类型', '集体经济组织');
  await clickSel('证件类型', '证券业务许可证');
  await fillInp('客户名称', '李淼一有限责任公司');
  await fillInp('证件号码', '1234EF0SC9VDS12340');

  // 保存
  await page.locator('button:has-text("保存")').first().click({ force: true });
  console.log('保存已点击');
  await page.waitForTimeout(5000);

  // === 诊断：保存后页面状态 ===
  console.log('\n=== 诊断：保存后页面 ===');
  console.log('URL:', page.url());

  // 截图
  await page.screenshot({ path: `${SS}diag-after-save.png`, fullPage: true });
  console.log('📸 diag-after-save.png');

  // 检查toast消息
  const toast = page.locator('.el-message:visible, .el-notification:visible, .el-message-box:visible').first();
  if (await toast.isVisible().catch(() => false)) {
    console.log('Toast消息:', (await toast.textContent()).replace(/\s+/g, ' ').trim().substring(0, 200));
  }

  // 检查是否有抽屉打开
  const drawer = page.locator('.el-drawer__wrapper:visible, .el-drawer:visible').first();
  console.log('Drawer可见:', await drawer.isVisible().catch(() => false));

  // 检查表单字段数
  const formItems = await page.locator('.el-form-item').all();
  console.log('表单字段数:', formItems.length);

  // 打印前20个字段
  for (let i = 0; i < Math.min(20, formItems.length); i++) {
    const label = await formItems[i].locator('.el-form-item__label').textContent().catch(() => '');
    const ph = await formItems[i].locator('input,textarea').first().getAttribute('placeholder').catch(() => '');
    const ro = await formItems[i].locator('input').first().getAttribute('readonly').catch(() => null);
    console.log(`  [${i}] label="${label.trim()}" placeholder="${ph}" readonly=${ro !== null}`);
  }

  // 检查是否有tab标签页
  const tabs = page.locator('.el-tabs__item:visible');
  const tabCount = await tabs.count();
  console.log('Tab标签数:', tabCount);
  for (let i = 0; i < tabCount; i++) {
    console.log(`  Tab[${i}]:`, (await tabs.nth(i).textContent()).trim());
  }

  // 检查按钮
  const btns = page.locator('button:visible');
  const btnCount = await btns.count();
  console.log('按钮数:', btnCount);
  for (let i = 0; i < Math.min(15, btnCount); i++) {
    console.log(`  Btn[${i}]:`, (await btns.nth(i).textContent()).trim().substring(0, 30));
  }

  await page.waitForTimeout(30000);
  await browser.close();
})();
