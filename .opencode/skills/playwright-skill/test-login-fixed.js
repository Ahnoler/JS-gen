const { chromium } = require('playwright');

const TARGET_URL = 'http://101.89.127.196:9080/login?appKey=1920710182837141505';

(async () => {
  let browser;
  let context;
  let page;
  try {
    browser = await chromium.launch({ headless: false, slowMo: 100 });
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    page = await context.newPage();

    console.log('✓ 打开登录页面');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: '/tmp/01-login-page.png', fullPage: true });
    await page.waitForTimeout(500);

    console.log('✓ 输入账号 admin');
    await page.fill('input[placeholder*="账号"], input[placeholder*="用户名"], input[name="username"]', 'admin');
    await page.screenshot({ path: '/tmp/02-username-filled.png', fullPage: true });
    await page.waitForTimeout(500);

    console.log('✓ 输入密码');
    await page.fill('input[placeholder*="密码"], input[name="password"], input[type="password"]', '123456');
    await page.screenshot({ path: '/tmp/03-password-filled.png', fullPage: true });
    await page.waitForTimeout(500);

    console.log('✓ 点击登录按钮');
    await page.click('button[type="submit"], .el-button--primary, button:has-text("登录"), button:has-text("登 录")');
    await page.screenshot({ path: '/tmp/04-after-click-login.png', fullPage: true });

    // 等待登录完成：检测 URL 跳转（非/login路径）
    console.log('✓ 等待登录跳转');
    try {
      await page.waitForURL(url => {
        const u = typeof url === 'string' ? url : String(url);
        return !u.includes('/login');
      }, { timeout: 30000 });
    } catch (e) {
      // waitForURL 可能因 hash 路由或 SPA 而不触发
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/05-after-login.png', fullPage: true });

    // 断言登录成功
    console.log('✓ 检查登录结果');
    const currentUrl = page.url();
    const hasNav = await page.locator('.navbar, .menu, nav, .sidebar, .layout-header, .top-menu').first().isVisible().catch(() => false);
    const notLoginPage = !currentUrl.includes('/login') && !currentUrl.includes('/#/login');

    if (notLoginPage || hasNav) {
      console.log('✓ 登录成功！URL:', currentUrl);
    } else {
      console.log('可能未登录成功，当前 URL:', currentUrl);
      await page.screenshot({ path: '/tmp/06-login-failed.png', fullPage: true });
    }

  } catch (err) {
    console.error('执行出错:', err.message);
    // 页面可能已关闭，仅做安全截图
    try {
      const pages = context ? context.pages() : [];
      if (pages.length > 0) {
        await pages[0].screenshot({ path: '/tmp/99-error.png' });
      }
    } catch (_) {}
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
})();
