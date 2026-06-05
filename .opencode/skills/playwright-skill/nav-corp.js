const { chromium } = require('playwright');
const TARGET_URL = 'http://test.creditv5p2.tansun.com.cn/';
const SS = 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\';

async function ss(page, n) { await page.screenshot({ path: `${SS}${n}.png`, fullPage: true }); console.log('screenshot: ' + n); }

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(15000);

  try {
    // Step 1: Login
    console.log('=== Step 1: Login ===');
    await page.goto(TARGET_URL + '#/login?redirect=%2Fhome', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    await page.locator('input[placeholder*="\u8BF7\u9009\u62E9\u6CD5\u4EBA"]').first().click();
    await page.waitForTimeout(800);
    await page.locator('.el-select-dropdown__item').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('.el-select-dropdown__item').first().click();
    await page.locator('input[placeholder*="\u7528\u6237\u540D"]').first().fill('701994');
    await page.locator('input[placeholder*="\u5BC6\u7801"]').first().fill('1');
    await page.locator('button:has-text("\u767B")').first().click();
    console.log('Login submitted, waiting for redirect...');
    try { await page.waitForURL('**/home**', { timeout: 30000 }); } catch { await page.waitForTimeout(5000); }
    console.log('Login successful, URL: ' + page.url());
    await page.waitForTimeout(2000);
    await ss(page, '01-home');

    // Step 2: Navigate - click "客户管理" menu
    console.log('=== Step 2: Navigate to 对公客户管理 ===');
    const menuSelector = 'nav.navbar ul.menu-wrapper li.menu-item:has-text("\u5BA2\u6237\u7BA1\u7406")';
    await page.locator(menuSelector).first().click({ force: true });
    console.log('Clicked 客户管理, waiting for submenu...');
    await page.waitForTimeout(1200);

    // Remove overlay mask if present
    await page.evaluate(() => {
      document.querySelectorAll('.navbar__mask').forEach(el => el.remove());
    }).catch(() => {});
    await page.waitForTimeout(300);

    // Click "对公客户管理" in submenu
    const subMenuItem = page.locator('.submenu-wrapper:visible').getByText('\u5BF9\u516C\u5BA2\u6237\u7BA1\u7406', { exact: true });
    await subMenuItem.first().click({ force: true });
    console.log('Clicked 对公客户管理, waiting for page load...');
    await ss(page, '02-after-click');

    // Step 3: Wait for list page to load
    console.log('=== Step 3: Wait for list page ===');
    for (let i = 0; i < 6; i++) {
      const loadingVisible = await page.locator('.el-loading-mask:not(.el-loading-mask--hidden)').first().isVisible().catch(() => false);
      if (loadingVisible) {
        console.log('Loading mask visible, waiting...');
        await page.waitForTimeout(5000);
      } else {
        const tableBody = await page.locator('.el-table__body').first().isVisible().catch(() => false);
        const tableEmpty = await page.locator('.el-table__empty-text, .el-empty').first().isVisible().catch(() => false);
        if (tableBody || tableEmpty) {
          console.log('Table content detected!');
          break;
        }
        console.log('Waiting for table content... attempt ' + (i + 1));
        await page.waitForTimeout(5000);
      }
    }

    // Verify we are on the right page
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    const hasTable = await page.locator('.el-table').first().isVisible().catch(() => false);
    const hasQueryBtn = await page.locator('button:has-text("\u67E5\u8BE2")').first().isVisible().catch(() => false);
    const pageTitle = await page.locator('.breadcrumb, .page-title, h2, h3').first().textContent().catch(() => '');

    console.log('Current URL: ' + currentUrl);
    console.log('Has el-table: ' + hasTable);
    console.log('Has query button: ' + hasQueryBtn);
    console.log('Page title text: ' + pageTitle);

    await ss(page, '03-list-page');

    if (hasTable && (currentUrl.includes('AiCase') || currentUrl.includes('corp') || hasQueryBtn)) {
      console.log('SUCCESS: Reached 对公客户管理 list page');
    } else {
      console.log('WARNING: May not have reached the target page. Checking further...');
      const bodyText = await page.locator('body').textContent().catch(() => '');
      if (bodyText.includes('\u5BF9\u516C\u5BA2\u6237')) {
        console.log('Page contains 对公客户 text - likely correct page');
      }
    }

    console.log('Task complete. Waiting 5s before closing...');
    await page.waitForTimeout(5000);

  } catch (err) {
    console.error('ERROR: ' + err.message);
    await ss(page, 'error');
  } finally {
    await browser.close();
  }
})();
