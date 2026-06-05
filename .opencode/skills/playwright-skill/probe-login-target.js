const { chromium } = require('playwright');

const TARGET_URL = 'http://101.89.127.196:9080/login?appKey=1920710182837141505&redirect=http://101.89.127.196:8761';
const SS = 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: `${SS}login-probe.png`, fullPage: true });
    console.log('screenshot saved');

    var inputs = await page.evaluate(function() {
      var els = document.querySelectorAll('input');
      return Array.from(els).map(function(el, i) {
        return {
          index: i,
          type: el.type,
          name: el.name,
          id: el.id,
          placeholder: el.placeholder,
          className: el.className,
          visible: el.offsetParent !== null
        };
      });
    });
    console.log('INPUTS: ' + JSON.stringify(inputs, null, 2));

    var buttons = await page.evaluate(function() {
      var els = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
      return Array.from(els).map(function(el, i) {
        return {
          index: i,
          tag: el.tagName,
          type: el.type,
          text: el.textContent.trim().replace(/\s+/g, ' '),
          className: el.className,
          id: el.id,
          visible: el.offsetParent !== null
        };
      });
    });
    console.log('BUTTONS: ' + JSON.stringify(buttons, null, 2));

  } catch (err) {
    console.error('ERROR: ' + err.message);
    await page.screenshot({ path: `${SS}login-probe-error.png`, fullPage: true }).catch(function() {});
  } finally {
    await browser.close();
  }
})();
