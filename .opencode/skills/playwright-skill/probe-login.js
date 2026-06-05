const { chromium } = require('playwright');

const TARGET_URL = 'http://172.19.87.161:9200/';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    console.log('Page title:', await page.title());

    // Dump all input elements
    const inputs = await page.locator('input').all();
    console.log('Found inputs:', inputs.length);
    for (const inp of inputs) {
      const name = await inp.getAttribute('name');
      const id = await inp.getAttribute('id');
      const type = await inp.getAttribute('type');
      const placeholder = await inp.getAttribute('placeholder');
      const className = await inp.getAttribute('class');
      console.log(`  Input: name="${name}" id="${id}" type="${type}" placeholder="${placeholder}" class="${className}"`);
    }

    // Dump all buttons
    const buttons = await page.locator('button, input[type="submit"]').all();
    console.log('Found buttons:', buttons.length);
    for (const btn of buttons) {
      const text = await btn.textContent();
      const tag = await btn.evaluate(el => el.tagName);
      const type = await btn.getAttribute('type');
      const name = await btn.getAttribute('name');
      const className = await btn.getAttribute('class');
      console.log(`  Button: tag="${tag}" type="${type}" name="${name}" text="${text?.trim()}" class="${className}"`);
    }

    // Dump page HTML structure around form area
    const formHtml = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (form) return form.outerHTML;
      // look for login containers
      const main = document.querySelector('.login, #login, .login-form, .login-box, .login-page');
      if (main) return main.outerHTML;
      return 'No form or login container found';
    });
    console.log('Form HTML:', formHtml);

    await page.screenshot({ path: 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\probe.png', fullPage: true });
    console.log('Screenshot saved');
  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\probe-error.png' });
  } finally {
    await browser.close();
  }
})();
