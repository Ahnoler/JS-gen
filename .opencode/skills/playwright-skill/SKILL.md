---
name: playwright-skill
description: Complete browser automation with Playwright. Auto-detects dev servers, writes clean test scripts to /tmp. Test pages, fill forms, take screenshots, check responsive design, validate UX, test login flows, check links, automate any browser task. Use when user wants to test websites, automate browser interactions, validate web functionality, or perform any browser-based testing.
---

> **⚠️ IMPORTANT: Element UI / Vue Project Override**
> When writing scripts for Element UI / Vue-based apps (like the credit system):
> - **Never use `page.fill()`** — Element UI inputs require native setter via `page.evaluate()`.
> - **Never use `page.locator('select')`** — Element UI uses `el-select` (custom dropdown), not native `<select>`.
> - **Never use `page.locator()` with CSS selectors for form fields** — use the CTRL helpers.
> - **Use the injected `CTRL.*` helpers** (from `context.addInitScript`):
>   * `await page.evaluate(() => CTRL.fillFormField(label, value))` — text inputs
>   * `await page.evaluate(() => CTRL.selectOption(label, option))` — el-select dropdowns
>   * `await page.evaluate(() => CTRL.selectDate(label, 'YYYY-MM-DD'))` — date pickers
>   * `await page.evaluate(() => CTRL.clickMenuItem(text))` — menu navigation
>   * `await page.evaluate(() => CTRL.clickRadio(label, option))` — radio buttons
>   * `await page.evaluate(() => CTRL.clickAdjacentButton(label))` — 选择/引入 buttons
>   * `await page.evaluate(() => CTRL.clickTableRowAction(rowText, btnText))` — table row actions
>   * `await page.evaluate(() => CTRL.closeDialog())` — close dialogs/notifications
>   * `await page.evaluate(() => CTRL.waitForLoading())` — wait for loading masks
> - **Button clicks**: Use `page.locator('xpath=...').click()` but with `translate(.," ","")` to handle Chinese spaces.
> - The `buildScriptPrompt` function in `script-utils.js` already includes these rules; follow them.

> **🔄 NEW: Script Assembly Pipeline**
> Scripts are now also generated via a Python assembler (`scripts/script_assembler.py`) that reads `action_{ts}.json` files and maps recorded controller actions directly to CTRL calls — no LLM guessing needed.
> See `docs/脚本维护功能设计方案.md` for details.

**IMPORTANT - Path Resolution:**
This skill can be installed in different locations (plugin system, manual installation, global, or project-specific). Before executing any commands, determine the skill directory based on where you loaded this SKILL.md file, and use that path in all commands below. Replace `$SKILL_DIR` with the actual discovered path.

Common installation paths:

- Plugin system: `~/.claude/plugins/marketplaces/playwright-skill/skills/playwright-skill`
- Manual global: `~/.claude/skills/playwright-skill`
- Project-specific: `<project>/.claude/skills/playwright-skill`

# Playwright Browser Automation

General-purpose browser automation skill. I'll write custom Playwright code for any automation task you request and execute it via the universal executor.

**CRITICAL WORKFLOW - Follow these steps in order:**

1. **Auto-detect dev servers** - For localhost testing, ALWAYS run server detection FIRST:

   ```bash
   cd $SKILL_DIR && node -e "require('./lib/helpers').detectDevServers().then(servers => console.log(JSON.stringify(servers)))"
   ```

   - If **1 server found**: Use it automatically, inform user
   - If **multiple servers found**: Ask user which one to test
   - If **no servers found**: Ask for URL or offer to help start dev server

2. **Write scripts to /tmp** - NEVER write test files to skill directory; always use `/tmp/playwright-test-*.js`

3. **Use visible browser by default** - Always use `headless: false` unless user specifically requests headless mode

4. **Parameterize URLs** - Always make URLs configurable via environment variable or constant at top of script

## How It Works

1. You describe what you want to test/automate
2. I auto-detect running dev servers (or ask for URL if testing external site)
3. I write custom Playwright code in `/tmp/playwright-test-*.js` (won't clutter your project)
4. I execute it via: `cd $SKILL_DIR && node run.js /tmp/playwright-test-*.js`
5. Results displayed in real-time, browser window visible for debugging
6. Test files auto-cleaned from /tmp by your OS

## Setup (First Time)

```bash
cd $SKILL_DIR
npm run setup
```

This installs Playwright and Chromium browser. Only needed once.

## Execution Pattern

**Step 1: Detect dev servers (for localhost testing)**

```bash
cd $SKILL_DIR && node -e "require('./lib/helpers').detectDevServers().then(s => console.log(JSON.stringify(s)))"
```

**Step 2: Write test script to /tmp with URL parameter**

```javascript
// /tmp/playwright-test-page.js
const { chromium } = require('playwright');

// Parameterized URL (detected or user-provided)
const TARGET_URL = 'http://localhost:3001'; // <-- Auto-detected or from user

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(TARGET_URL);
  console.log('Page loaded:', await page.title());

  await page.screenshot({ path: '/tmp/screenshot.png', fullPage: true });
  console.log('📸 Screenshot saved to /tmp/screenshot.png');

  await browser.close();
})();
```

**Step 3: Execute from skill directory**

```bash
cd $SKILL_DIR && node run.js /tmp/playwright-test-page.js
```

## Common Patterns (Element UI / Vue Projects)

For Element UI / Vue based apps, inject CTRL helpers and use them for all component interactions.

### CTRL API Reference

The following functions are available after CTRL injection (via `context.addInitScript` in the runner template).

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `CTRL.fillFormField` | (label, value) | `'ok'` / `'field-disabled'` / `'is-date-picker'` / `'label-not-found'` | Fill el-input/textarea via native setter + input/change/blur |
| `CTRL.selectOption` | (label, option) | `'triggered'` / `'label-not-found'` / `'select-disabled'` | Click el-select trigger, select option by text |
| `CTRL.selectDate` | (label, dateStr) | `'selected:YYYY-MM-DD'` / `'already:YYYY-MM-DD'` / `'label-not-found'` | Set el-date-editor value + close picker |
| `CTRL.clickRadio` | (label, option) | `'ok'` / `'option-not-found'` | Click el-radio by text |
| `CTRL.clickMenuItem` | (text) | `'ok'` / `'ok-expanded'` / `'not-found'` | Click el-menu-item, auto-expand submenu |
| `CTRL.clickTableRowAction` | (rowText, btnText) | `'ok'` / `'ok-icon'` / `'button-not-found'` | Click button inside el-table row |
| `CTRL.closeDialog` | () | `'ok'` / `'ok-notification'` / `'no-overlay-open'` | Close notification/dialog/drawer |
| `CTRL.waitForLoading` | () | Promise | Wait for el-loading-mask to disappear |
| `CTRL.switchTab` | (name) | `'ok'` / `'tab-not-found'` | Switch el-tabs tab |
| `CTRL.checkFieldValue` | (label) | value string / `'empty'` / `'label-not-found'` | Read current input value |
| `CTRL.clickAdjacentButton` | (label) | `'clicked'` / `'already-filled'` / `'no-button-found'` | Click adjacent 选择/引入 button |
| `CTRL.expandAllTreeNodes` | () | count | Expand all el-tree nodes |

**Usage pattern — always wrap CTRL calls in page.evaluate:**
```javascript
await page.evaluate(() => CTRL.fillFormField('客户名称', '测试科技有限公司'));
await page.evaluate(() => CTRL.selectOption('证件类型', '营业执照'));
await page.evaluate(() => CTRL.selectDate('成立日期', '2026-01-01'));
await page.evaluate(() => CTRL.waitForLoading());
```

**Never use these for Element UI components:**
- ❌ `page.fill('input', value)` — use `CTRL.fillFormField(label, value)`
- ❌ `page.locator('select')` — use `CTRL.selectOption(label, option)`
- ❌ `page.click('button')` for form submit — use XPath with translate for Chinese text

### Standard Button/Link Click (non-Element UI)

For generic buttons, use XPath with `translate()` to handle Chinese spacing:
```javascript
await page.locator('xpath=//button[contains(translate(.," ",""),"登录")]').click();
```

### Test Login Flow (Element UI)

```javascript
const { chromium } = require('playwright');
const TARGET_URL = 'http://test.creditv5p2.tansun.com.cn/';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  // Inject CTRL once — persists across all navigations
  await context.addInitScript(() => {
    window.CTRL = {
      getContainer: () => {
        for (const d of document.querySelectorAll('.el-dialog')) if (d.offsetParent !== null) return d;
        for (const d of document.querySelectorAll('.el-drawer')) if (d.offsetParent !== null) return d;
        return document;
      },
      fillFormField: (label, val) => {
        const c = window.CTRL.getContainer();
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
          if (!lbl.includes(label)) continue;
          const t = item.querySelector('input:not([type="hidden"])') || item.querySelector('textarea');
          if (!t) return 'no-input-found';
          if (t.disabled || t.readOnly) return 'field-disabled';
          if (t.closest('.el-date-editor, .tsscdatepicker')) return 'is-date-picker';
          const setter = Object.getOwnPropertyDescriptor((t.tagName==='TEXTAREA'?HTMLTextAreaElement:HTMLInputElement).prototype,'value').set;
          setter.call(t, val);
          t.dispatchEvent(new Event('input',{bubbles:true}));
          t.dispatchEvent(new Event('change',{bubbles:true}));
          t.dispatchEvent(new Event('blur',{bubbles:true}));
          return 'ok';
        }
        return 'label-not-found';
      },
      selectOption: (label, option) => {
        const c = window.CTRL.getContainer();
        for (const item of c.querySelectorAll('.el-form-item')) {
          const lbl = item.querySelector('.el-form-item__label')?.textContent?.trim() || '';
          if (!lbl.includes(label)) continue;
          const trigger = item.querySelector('.el-select .el-input__inner');
          if (!trigger) return 'no-select-found';
          trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
          trigger.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          trigger.click();
          setTimeout(() => {
            const opts = document.querySelectorAll('.el-select-dropdown__item');
            const first = ['first','1st','第一个','第一项'];
            const t = first.includes(option.toLowerCase().trim())
              ? [...opts].find(it => it.offsetParent !== null) || opts[0]
              : [...opts].find(it => it.textContent.trim() === option) || [...opts].find(it => it.textContent.trim().includes(option));
            if (!t) return;
            t.scrollIntoView({block:'nearest'});
            t.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
            t.click();
          }, 200);
          return 'triggered';
        }
        return 'label-not-found';
      },
      waitForLoading: () => new Promise(resolve => {
        let el=0;
        const ck=()=>{ if(el>=30000){resolve('timeout');return; } const m=document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)'); if(!m||m.offsetParent===null) resolve(); else { el+=200; setTimeout(ck,200); } };
        ck();
      }),
    };
  });

  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  try {
    // All Element UI operations use CTRL.*
    await page.evaluate(() => CTRL.selectOption('请选择法人', 'first'));
    await page.waitForTimeout(500);
    await page.evaluate(() => CTRL.fillFormField('请输入您的用户名', '701994'));
    await page.waitForTimeout(500);
    await page.evaluate(() => CTRL.fillFormField('请输入您的密码', '1'));
    await page.waitForTimeout(500);
    // Login button: use XPath with translate for Chinese text
    await page.locator('xpath=//button[contains(translate(.," ",""),"登录")]').click();
    await page.waitForTimeout(15000);
    await page.screenshot({ path: '/tmp/login-result.png' });
    console.log('✓ Login completed');
  } catch (err) {
    console.error('Test failed:', err.message);
    await page.screenshot({ path: '/tmp/error.png' });
  } finally {
    await browser.close();
  }
})();
```

### Fill Element UI Form

```javascript
await page.evaluate(() => CTRL.fillFormField('客户名称', '测试科技有限公司'));
await page.waitForTimeout(500);
await page.evaluate(() => CTRL.selectOption('国别', '中国'));
await page.waitForTimeout(500);
await page.evaluate(() => CTRL.selectDate('成立日期', '2026-01-01'));
await page.waitForTimeout(500);
```

### Navigate Menu

```javascript
await page.evaluate(() => CTRL.clickMenuItem('客户管理'));
await page.waitForTimeout(500);
await page.evaluate(() => CTRL.clickMenuItem('对公客户管理'));
await page.waitForTimeout(500);
await page.evaluate(() => CTRL.waitForLoading());
```

### Handle Dialog

```javascript
// Wait for dialog
await page.waitForSelector('.el-dialog', { state: 'visible' });
await page.waitForTimeout(500);
// Fill fields inside dialog
await page.evaluate(() => CTRL.fillFormField('客户名称', '测试'));
await page.waitForTimeout(500);
// Close dialog
await page.evaluate(() => CTRL.closeDialog());
```

### Click Table Row Action

```javascript
await page.evaluate(() => CTRL.clickTableRowAction('测试客户', '编辑'));
await page.waitForTimeout(500);
```

### Take Screenshot with Error Handling

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3000', {
      waitUntil: 'networkidle',
      timeout: 10000,
    });
    await page.screenshot({ path: '/tmp/screenshot.png', fullPage: true });
    console.log('📸 Screenshot saved to /tmp/screenshot.png');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
```

### Check for Broken Links

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000');

  const links = await page.locator('a[href^="http"]').all();
  const results = { working: 0, broken: [] };

  for (const link of links) {
    const href = await link.getAttribute('href');
    try {
      const response = await page.request.head(href);
      if (response.ok()) {
        results.working++;
      } else {
        results.broken.push({ url: href, status: response.status() });
      }
    } catch (e) {
      results.broken.push({ url: href, error: e.message });
    }
  }

  console.log(`✅ Working links: ${results.working}`);
  console.log(`❌ Broken links:`, results.broken);

  await browser.close();
})();
```

### Take Screenshot with Error Handling

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:3000', {
      waitUntil: 'networkidle',
      timeout: 10000,
    });

    await page.screenshot({
      path: '/tmp/screenshot.png',
      fullPage: true,
    });

    console.log('📸 Screenshot saved to /tmp/screenshot.png');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
})();
```

### Test Responsive Design

```javascript
// /tmp/playwright-test-responsive-full.js
const { chromium } = require('playwright');

const TARGET_URL = 'http://localhost:3001'; // Auto-detected

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const viewports = [
    { name: 'Desktop', width: 1920, height: 1080 },
    { name: 'Tablet', width: 768, height: 1024 },
    { name: 'Mobile', width: 375, height: 667 },
  ];

  for (const viewport of viewports) {
    console.log(
      `Testing ${viewport.name} (${viewport.width}x${viewport.height})`,
    );

    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });

    await page.goto(TARGET_URL);
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: `/tmp/${viewport.name.toLowerCase()}.png`,
      fullPage: true,
    });
  }

  console.log('✅ All viewports tested');
  await browser.close();
})();
```

## Inline Execution (Simple Tasks)

For quick one-off tasks, you can execute code inline without creating files:

```bash
# Take a quick screenshot
cd $SKILL_DIR && node run.js "
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('http://localhost:3001');
await page.screenshot({ path: '/tmp/quick-screenshot.png', fullPage: true });
console.log('Screenshot saved');
await browser.close();
"
```

**When to use inline vs files:**

- **Inline**: Quick one-off tasks (screenshot, check if element exists, get page title)
- **Files**: Complex tests, responsive design checks, anything user might want to re-run

## Available Helpers

Optional utility functions in `lib/helpers.js`:

```javascript
const helpers = require('./lib/helpers');

// Detect running dev servers (CRITICAL - use this first!)
const servers = await helpers.detectDevServers();
console.log('Found servers:', servers);

// Safe click with retry
await helpers.safeClick(page, 'button.submit', { retries: 3 });

// Safe type with clear
await helpers.safeType(page, '#username', 'testuser');

// Take timestamped screenshot
await helpers.takeScreenshot(page, 'test-result');

// Handle cookie banners
await helpers.handleCookieBanner(page);

// Extract table data
const data = await helpers.extractTableData(page, 'table.results');
```

See `lib/helpers.js` for full list.

## Custom HTTP Headers

Configure custom headers for all HTTP requests via environment variables. Useful for:

- Identifying automated traffic to your backend
- Getting LLM-optimized responses (e.g., plain text errors instead of styled HTML)
- Adding authentication tokens globally

### Configuration

**Single header (common case):**

```bash
PW_HEADER_NAME=X-Automated-By PW_HEADER_VALUE=playwright-skill \
  cd $SKILL_DIR && node run.js /tmp/my-script.js
```

**Multiple headers (JSON format):**

```bash
PW_EXTRA_HEADERS='{"X-Automated-By":"playwright-skill","X-Debug":"true"}' \
  cd $SKILL_DIR && node run.js /tmp/my-script.js
```

### How It Works

Headers are automatically applied when using `helpers.createContext()`:

```javascript
const context = await helpers.createContext(browser);
const page = await context.newPage();
// All requests from this page include your custom headers
```

For scripts using raw Playwright API, use the injected `getContextOptionsWithHeaders()`:

```javascript
const context = await browser.newContext(
  getContextOptionsWithHeaders({ viewport: { width: 1920, height: 1080 } }),
);
```

## Advanced Usage

For comprehensive Playwright API documentation, see [API_REFERENCE.md](API_REFERENCE.md):

- Selectors & Locators best practices
- Network interception & API mocking
- Authentication & session management
- Visual regression testing
- Mobile device emulation
- Performance testing
- Debugging techniques
- CI/CD integration

## CRITICAL: Script Output Rules

- **NEVER append ANY text after the final `})();`** in the generated .js file. The file must be pure, valid JavaScript only — no trailing comments, no Chinese status messages (like "脚本已写入..."), no natural language explanations, no markdown. Everything after `})();` will cause a SyntaxError.
- **Use Unicode escapes for Chinese characters** inside string literals to avoid encoding issues on Windows (e.g. `\u8BF7\u8F93\u5165` instead of raw `请输入`).
- **Element UI / Vue override**: For this project, NEVER use `page.fill()` or `page.locator('select')`. Always use `await page.evaluate(() => CTRL.xxx())` for Element UI components. See CTRL API Reference above.

## Tips

- **CRITICAL: Detect servers FIRST** - Always run `detectDevServers()` before writing test code for localhost testing
- **Custom headers** - Use `PW_HEADER_NAME`/`PW_HEADER_VALUE` env vars to identify automated traffic to your backend
- **Use /tmp for test files** - Write to `/tmp/playwright-test-*.js`, never to skill directory or user's project
- **Parameterize URLs** - Put detected/provided URL in a `TARGET_URL` constant at the top of every script
- **DEFAULT: Visible browser** - Always use `headless: false` unless user explicitly asks for headless mode
- **Headless mode** - Only use `headless: true` when user specifically requests "headless" or "background" execution
- **Slow down:** Use `slowMo: 100` to make actions visible and easier to follow
- **Wait strategies:** Use `waitForURL`, `waitForSelector`, `waitForLoadState` instead of fixed timeouts
- **Error handling:** Always use try-catch for robust automation
- **Console output:** Use `console.log()` to track progress and show what's happening

## Troubleshooting

**Playwright not installed:**

```bash
cd $SKILL_DIR && npm run setup
```

**Module not found:**
Ensure running from skill directory via `run.js` wrapper

**Browser doesn't open:**
Check `headless: false` and ensure display available

**Element not found:**
Add wait: `await page.waitForSelector('.element', { timeout: 10000 })`

## Example Usage

```
User: "Test if the marketing page looks good"

Claude: I'll test the marketing page across multiple viewports. Let me first detect running servers...
[Runs: detectDevServers()]
[Output: Found server on port 3001]
I found your dev server running on http://localhost:3001

[Writes custom automation script to /tmp/playwright-test-marketing.js with URL parameterized]
[Runs: cd $SKILL_DIR && node run.js /tmp/playwright-test-marketing.js]
[Shows results with screenshots from /tmp/]
```

```
User: "Check if login redirects correctly"

Claude: I'll test the login flow. First, let me check for running servers...
[Runs: detectDevServers()]
[Output: Found servers on ports 3000 and 3001]
I found 2 dev servers. Which one should I test?
- http://localhost:3000
- http://localhost:3001

User: "Use 3001"

[Writes login automation to /tmp/playwright-test-login.js]
[Runs: cd $SKILL_DIR && node run.js /tmp/playwright-test-login.js]
[Reports: ✅ Login successful, redirected to /dashboard]
```

## Notes

- Each automation is custom-written for your specific request
- Not limited to pre-built scripts - any browser task possible
- Auto-detects running dev servers to eliminate hardcoded URLs
- Test scripts written to `/tmp` for automatic cleanup (no clutter)
- Code executes reliably with proper module resolution via `run.js`
- Progressive disclosure - API_REFERENCE.md loaded only when advanced features needed
