import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import { GENERATED_DIR } from './config.js';
import { getInjectionCode, CTRL_PROMPT_BLOCK, CTRL_API_TABLE, CTRL_OBJECT } from './ctrl-actions.js';

export function ensureGeneratedDir() {
  if (!existsSync(GENERATED_DIR)) mkdirSync(GENERATED_DIR, { recursive: true });
}

export function loadGeneratedIndex() {
  ensureGeneratedDir();
  const fp = path.join(GENERATED_DIR, 'index.json');
  if (!existsSync(fp)) return [];
  try { return JSON.parse(readFileSync(fp, 'utf-8')); } catch { return []; }
}

export function saveGeneratedIndex(list) {
  ensureGeneratedDir();
  writeFileSync(path.join(GENERATED_DIR, 'index.json'), JSON.stringify(list, null, 2), 'utf-8');
}

export function buildScriptPrompt({ description, url, credentials, referenceScript, referenceScriptName, structuredActions }) {
  const hasActions = structuredActions && structuredActions.length > 0;

  let prompt = `Generate a Playwright test script based on the scenario below.

## Test Scenario
${description || '(not provided)'}`;

  // ====== Raw trajectory actions (for LLM to deduplicate and orchestrate) ======
  if (hasActions) {
    prompt += `\n\n## Browser Exploration Trajectory — Raw Action Sequence (contains exploratory noise)
Below is the raw action sequence recorded by the AI agent exploring the page. The trajectory includes **noise**: retries, diagnostic reads, redundant operations.
**Your task**: denoise, merge, orchestrate, and output a clean Playwright script.

### Raw Trajectory
` + '| # | Action Type | Label | Value | XPath |\n|---|------------|-------|-------|-------|\n';
    for (let i = 0; i < structuredActions.length; i++) {
      const a = structuredActions[i];
      prompt += `| ${i + 1} | ${a.type || ''} | ${a.label || '-'} | ${a.value || '-'} | ${a.xpath || '-'} |\n`;
    }
  }

  // ====== CTRL API — Element UI custom actions (from controller.py) ======
  if (hasActions) {
    prompt += `
### CTRL API — Element UI Custom Actions (copy this code block into your script)
Inject the complete CTRL object at the top of your script using \`page.evaluate\`. **Copy the code block below verbatim — do not modify it**:

${CTRL_PROMPT_BLOCK}

After injection, all Element UI operations are called via \`await page.evaluate(() => CTRL.xxx(args))\`.

### API Reference
${CTRL_API_TABLE}

### Orchestration Rules

> **⚠️ CRITICAL WARNING — Read This First**:
> The login page uses **Element UI \`el-select\`** for the legal person dropdown, NOT a native HTML \`<select>\`.
> If the trajectory says \`select_option\`, you MUST generate:
> \`\`\`javascript
> await page.evaluate(() => CTRL.selectOption('请选择法人', 'first'));
> \`\`\`
> **Never** use \`page.locator('select')\` or \`selectOption({index:N})\` — those only work on native \`<select>\` elements, not on \`el-select\`.

1. **Dedup at your discretion**: The trajectory contains exploratory noise (retries, diagnostics, redundant reads). Examine each action's goal description, parameter changes, and context to decide what to keep or discard
2. **🚨 el-select is NEVER native \`<select>\`**: Every dropdown in this app is Element UI \`el-select\`. The trajectory\'s \`select_option\` actions MUST become \`await page.evaluate(() => CTRL.selectOption(label, option))\`. \`page.locator('select')\` will ALWAYS fail because there is no native \`<select>\` element on the page. This is the #1 cause of test failures.
3. **🚨 CTRL is ONLY in browser context — always wrap**: ALL Element UI operations MUST use \`await page.evaluate(() => CTRL.xxx())\`. Never use bare \`await CTRL.xxx()\` — that runs in Node.js where CTRL doesn't exist. Also never use \`page.locator()\`, \`page.fill()\`, or \`querySelector\` for Element UI components.
4. **🚨 Inject CTRL AFTER page.goto, not before**: Navigate first (\`await page.goto(url)\`), THEN inject CTRL. If you inject CTRL before navigation, the page context is destroyed by navigation and CTRL will be lost. CORRECT:
   \`\`\`javascript
   await page.goto(TARGET_URL, { waitUntil: 'networkidle' });
   await page.evaluate(() => { window.CTRL = { /* ... */ }; });
   \`\`\`
   WRONG (CTRL will be lost):
   \`\`\`javascript
   await page.evaluate(() => { window.CTRL = { /* ... */ }; }); // WRONG: injected before goto
   await page.goto(TARGET_URL); // ← this destroys the page where CTRL was set
   \`\`\`
5. **Don't redefine CTRL**: Copy the injection code block above as-is. Do not re-implement or override CTRL methods
6. **Handle return values**: Check return values per the API table (e.g., 'field-disabled' → skip, 'is-date-picker' → use selectDate instead)
7. **Wait between steps**: Add \`await page.waitForTimeout(500)\` after each CTRL call to let Vue's reactivity settle
8. **Screenshots**: Add \`await page.screenshot({path: '/tmp/step_N.png'})\` before/after key steps
9. **Merge consecutive reads**: If 3+ consecutive \`read_case_data\` calls appear, merge them into a single variable declaration block
10. **Script structure** — Declare \`browser\` and \`page\` at the IIFE top, BEFORE \`try\`:
   \`\`\`javascript
   const { chromium } = require('playwright');

   (async () => {
     const browser = await chromium.launch({ headless: false, slowMo: 100 });
     const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
     const page = await context.newPage();

     // Paste the CTRL injection code block here
     await page.evaluate(() => { window.CTRL = { /* ... */ }; });

     try {
       // Test steps: only use await page.evaluate(() => CTRL.xxx())
     } catch (err) {
       console.error('Test failed:', err.message);
       try { await page.screenshot({ path: '/tmp/error.png' }); } catch {}
       throw err;
     } finally {
       await browser.close();
     }
   })().catch(err => { process.exit(1); });
   \`\`\`
   Note: \`page\` and \`browser\` are declared before \`try\`, making them accessible in \`catch\`/\`finally\`. The nested try-catch around screenshot prevents screenshot errors from masking the original failure.
11. **Do NOT invent CTRL methods**: CTRL only has the 12 methods listed above. \`CTRL.getPageState()\`, \`CTRL.extractContent()\`, and any other non-existent methods will throw errors. Use plain \`page.evaluate\` for operations not covered by CTRL.
`;
  }

  // ====== Data generation rules (from atp-rule skill) ======
  prompt += `\n\n## Form Field Data Generation Rules (atp-rule)
Embed the generator functions at the top of your script. Match form field labels by keyword to auto-generate valid random values:

### Generator Functions (copy to top of script)
\`\`\`javascript
// === atp-rule form field data generators ===
function genValidIdCard(prefix = '430101') {
  const birth = \`\${1950 + Math.floor(Math.random() * 55)}\${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}\${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}\`;
  const seq = String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const base = \`\${prefix}\${birth}\${seq}\`;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const map = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = base.split('').reduce((s, c, i) => s + parseInt(c) * weights[i], 0);
  return base + map[sum % 11];
}
function genMobile() {
  const second = [3, 4, 5, 6, 7, 8, 9][Math.floor(Math.random() * 7)];
  let num = '1' + second;
  for (let i = 0; i < 9; i++) num += Math.floor(Math.random() * 10);
  return num;
}
function genCreditCode() {
  const CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
  const WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
  let body = '91' + String(Math.floor(Math.random() * 900000) + 100000);
  for (let i = 0; i < 9; i++) body += CHARS[Math.floor(Math.random() * CHARS.length)];
  const total = body.split('').reduce((s, c, i) => s + CHARS.indexOf(c) * WEIGHTS[i], 0);
  return body + CHARS[(31 - total % 31) % 31];
}
function genName() {
  const surnames = ['张','李','王','刘','陈','杨','赵','黄','周','吴','朱','郑'];
  const names = ['伟','芳','敏','静','丽','强','磊','洋','涛','明','飞','峰','华','平','刚','杰'];
  return surnames[Math.floor(Math.random()*surnames.length)] + names[Math.floor(Math.random()*names.length)] + names[Math.floor(Math.random()*names.length)];
}
function genEmail() {
  const names = ['test','admin','user','contact','info','service'];
  const domains = ['example.com','company.com','test.org','mail.cn'];
  return names[Math.floor(Math.random()*names.length)] + '_' + Math.random().toString(36).substring(2,6) + '@' + domains[Math.floor(Math.random()*domains.length)];
}
function genBankCard() { let n='62'; for(let i=0;i<17;i++) n+=Math.floor(Math.random()*10); return n.slice(0,19); }
function genAmount() { return Math.floor(Math.random()*9900000+100000)+'.'+String(Math.floor(Math.random()*100)).padStart(2,'0'); }
function genAddress() { const cities=['北京市朝阳区','上海市浦东新区','广州市天河区','深圳市南山区','杭州市西湖区','长沙市岳麓区']; const roads=['中山路','人民路','解放路','建设路','五一路','芙蓉路']; return cities[Math.floor(Math.random()*cities.length)]+roads[Math.floor(Math.random()*roads.length)]+(Math.floor(Math.random()*200)+1)+'号'; }
function genAge() { return String(Math.floor(Math.random() * 48) + 18); }

function matchFormRule(label) {
  const t = label.replace(/\\s+/g, '');
  if (/身份证|身份证号|居民身份证/.test(t)) return genValidIdCard();
  if (/手机|电话|联系方式|联系电话|电话号码/.test(t)) return genMobile();
  if (/邮箱|Email|电子邮箱/.test(t)) return genEmail();
  if (/统一社会信用代码|信用代码|营业执照|证件号码/.test(t)) return genCreditCode();
  if (/银行卡|银行卡号|银行账号/.test(t)) return genBankCard();
  if (/金额|价格|费用|工资|收入/.test(t)) return genAmount();
  if (/邮编|邮政编码/.test(t)) return '100000';
  if (/姓名|用户名|联系人/.test(t)) return genName();
  if (/地址|详细地址|联系地址/.test(t)) return genAddress();
  if (/年龄/.test(t)) return genAge();
  return null;
}
\`\`\`

**Usage**: Before filling a form field, call \`matchFormRule(label)\` to generate a valid random value. If it returns null, use the value from the test description or a reasonable default. User-specified values in the description take priority over generators.`;

  // ====== Element UI component action reference (from element-ui-knowledge.md) ======
  prompt += `\n\n## Element UI Component Action Reference

### 1. Quick Reference (Scenario → Playwright Implementation)
| Scenario | Playwright Implementation |
|----------|------------------------|
| Navigate to URL | \`await page.goto(url)\` |
| Click button/link | \`await page.locator('xpath=//button[text()="button text"]').click()\` (prefer exact XPath) |
| Click icon-only button | \`page.evaluate\` to locate by class inside el-table__row (atp-ui §16) |
| el-select dropdown | \`page.evaluate\` click trigger + click .el-select-dropdown__item by text (atp-ui §14.6) |
| el-input text | \`page.evaluate\` native setter + input/change/blur (atp-ui §14.4) |
| el-textarea | \`page.evaluate\` HTMLTextAreaElement native setter + events (atp-ui §14.5) |
| el-radio | \`page.evaluate\` find .el-radio by text and click (atp-ui §14.7) |
| el-checkbox | \`page.evaluate\` find .el-checkbox by text and click .el-checkbox__inner (atp-ui §14.8) |
| el-date-picker | \`page.evaluate\` native setter + input/change/blur + Escape to close panel (atp-ui §11) |
| el-dialog operation | \`page.waitForSelector('.el-dialog', {state:'visible'})\` first, re-query each time (atp-ui §5) |
| el-dialog close | \`page.evaluate\` click × or cancel button (atp-ui §5.4) |
| el-menu navigation | \`page.evaluate\` expand el-submenu + click el-menu-item (atp-ui §6) |
| el-tabs switch | \`page.evaluate\` click .el-tabs__item (atp-ui §8) |
| el-table row action | \`page.evaluate\` locate row by text inside .el-table__row (atp-ui §4.1) |
| el-tree expand | \`page.evaluate\` click .el-tree-node__expand-icon (atp-ui §7) |
| el-loading wait | \`page.evaluate\` poll .el-loading-mask visibility (atp-ui §10) |
| el-cascader | Click each level .el-cascader-menu__item sequentially (atp-ui §13) |
| el-message detection | \`page.evaluate\` read .el-message text (atp-ui §9.1) |
| el-notification close | \`page.evaluate\` click .el-notification__closeBtn (atp-ui §9.3) |
| Table pagination | \`page.evaluate\` click .el-pagination .btn-next (atp-ui §4.4) |
| el-switch toggle | \`page.evaluate\` click .el-switch (atp-ui §14.9) |
| File upload el-upload | \`page.waitForEvent('filechooser')\` + \`fileChooser.setFiles()\` (atp-ui §12) |
| Adjacent button (选择/引入) | \`page.evaluate\` find button.el-button--primary.is-plain in .el-form-item and click (atp-ui §14.10) |
| Form error detection | \`page.evaluate\` scan .el-form-item__error / .el-message / .el-notification (atp-ui §15) |
| Post-operation value check | \`page.evaluate\` read back input.value to verify write (atp-ui §2.4) |

### 2. Core Principles (must follow, otherwise scripts will be invalid)
1. **Never use page.fill()**: Element UI uses Vue v-model. Always use native setter + bubbling events (input/change/blur with bubbles:true) (atp-ui §2.1)
2. **Re-query DOM every time**: Don't cache el-dialog/el-table/el-tree references — Vue may destroy and rebuild them asynchronously (atp-ui §2.2)
3. **Wait between steps**: Add \`await page.waitForTimeout(500)\` after each evaluate to give Vue reactivity time (atp-ui §2.3)
4. **Verify after writes**: Read back values to confirm, preventing LLM from re-filling the same field (atp-ui §2.4)
5. **Atomic operations**: Complete "find → check → act" in a single evaluate; don't split into two steps (atp-ui §20)
6. **Direct assign, don't clear first**: \`setter.call(input, 'X')\` directly. Never \`setter('')\` then \`setter('X')\` — Vue will overwrite (atp-ui §14.3)
7. **el-select: absolutely forbid click_element_by_index**: Option clicks must go through .el-select-dropdown__item. Wrong DOM layer renders Vue unable to detect selection (atp-ui §14.6)
8. **Address selector: check placeholder**: Readonly inputs check placeholder ("请选择" = not selected), not value (atp-ui §13.1)`;

  // ====== Script generation rules ======
  prompt += `\n\n## Script Generation Rules

### Locator Strategy
- 【XPath for clicks】ALL clicks (buttons, icons, tabs, table row actions, pagination, etc.) MUST use \`page.locator('xpath=...')\`:
  ✓ \`await page.locator('xpath=//span[text()="客户管理-新增潜客"]').last().click()\`
  ✓ \`await page.locator('xpath=//i[contains(@class,"bianji")]').first().click()\`
  ✗ \`page.locator('span:text-is("xxx")')\` — Do NOT use :text-is / :has-text pseudo-selectors
  ✗ \`page.evaluate\` with textContent traversal — Do NOT use
- 【XPath exact match】Text matching must use \`text()='exact text'\`. Do NOT use \`contains(text(),'text')\` fuzzy matching
- 【Dialog scoping】Use \`locator('.el-dialog').last()\` to scope inside dialogs; \`waitFor({state:'visible'})\` before acting
- 【Wait for readiness】After navigation, always \`await page.waitForSelector()\` for the target element — do NOT rely on waitForTimeout

### Script Structure
- 【Framework】\`const { chromium } = require('playwright')\`, headless:false, slowMo:100, viewport 1920x1080
- 【Template】Wrap in try-catch; screenshot + console.error on error; close browser in finally
- 【Logging】Prefix each step with // comment + \`console.log('✓ step description')\`; save screenshots to \`/tmp/{step_name}.png\`
- 【Constants】Define \`TARGET_URL\` at the top of the script

### Technical Constraints
- 【Selectors】:has-text / :text / :visible are ONLY for \`locator()\` — NOT for \`page.evaluate()\` / \`querySelector()\`
- 【evaluate scope】Variables defined in Node.js (e.g. \`const\`) are NOT accessible inside \`page.evaluate()\`. If you need native setter, define it inline inside the evaluate callback
- 【Dedup】Trajectory steps with "重新" or "修正" (retry/redo) prefixes: keep only the last successful attempt`;

  if (referenceScript) {
    prompt += `\n\n## Reference Script (${referenceScriptName || 'reference.js'})\n\`\`\`javascript\n${referenceScript}\n\`\`\``;
  }

  if (credentials?.username || credentials?.password) {
    prompt += `\n\n## Login Credentials\n- Username: ${credentials.username || '(not provided)'}\n- Password: ${credentials.password || '(not provided)'}`;
  }
	
  if (url) prompt += `\n\n## Target System\nTARGET_URL: ${url}`;

  prompt += `\n\n## Output Format
Follow this output structure strictly:

### Test Steps
1. Step description
2. Step description
...

### Script Code
\`\`\`javascript
const { chromium } = require('playwright');
...
\`\`\``;

  return prompt;
}

export function parseScriptFromResponse(text) {
  const lines = text.split('\n');
  const steps = [];
  let code = '';

  // Steps: from first "测试步骤" to first "脚本代码"
  let stepStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/测试步骤/.test(lines[i])) { stepStart = i + 1; break; }
  }
  if (stepStart >= 0) {
    for (let i = stepStart; i < lines.length; i++) {
      const t = lines[i].trim();
      if (/脚本代码/.test(t)) break;
      const m = t.match(/^\d+[\.\)、]\s*(.+)/);
      if (m) steps.push({ step: steps.length + 1, action: m[1].trim() });
    }
  }

  // Script: from "const { chromium }" to last "})();" or "})().catch"
  const playwrightIdx = text.search(/(?:const|let|var)\s*\{\s*chromium\s*\}\s*=\s*require\s*\(\s*['"]playwright['"]\s*\)/);
  if (playwrightIdx >= 0) {
    code = text.slice(playwrightIdx);
    // Try primary ending: })(); or })().then(...) or })().catch(...)
    const endMatch = code.match(/\}\)\s*\(\s*\)\s*;(?:\s*\.\w+\s*\([^)]*\)\s*;\s*)?$/);
    if (endMatch) {
      code = code.slice(0, endMatch.index + endMatch[0].length);
    } else {
      // Try multi-line catch: })().catch(\n  ...\n);
      const catchMatch = code.match(/\}\)\s*\(\s*\)\s*\.\w+\s*\([\s\S]*?\)\s*;\s*$/);
      if (catchMatch) {
        code = code.slice(0, catchMatch.index + catchMatch[0].length);
      } else {
        // Fallback: try to find last }); that closes the IIFE
        const lastClose = code.lastIndexOf('})();');
        if (lastClose >= 0) code = code.slice(0, lastClose + 5);
        else code = code.trim();
      }
    }
    // Strip trailing markdown fences or non-code content
    code = code.replace(/```[\s\S]*$/, '').trim();
  }

  // Fallback: grab everything after "脚本代码" line
  if (!code.trim()) {
    for (let i = 0; i < lines.length; i++) {
      if (/脚本代码/.test(lines[i])) {
        code = lines.slice(i + 1).join('\n').trim();
        // Strip trailing markdown/todos/comments
        const endMatch = code.match(/\}\)\s*\(\s*\)\s*;(?:\s*\.\w+\s*\([^)]*\)\s*;\s*)?$/);
        if (endMatch) {
          code = code.slice(0, endMatch.index + endMatch[0].length);
        } else {
          const catchMatch = code.match(/\}\)\s*\(\s*\)\s*\.\w+\s*\([\s\S]*?\)\s*;\s*$/);
          if (catchMatch) {
            code = code.slice(0, catchMatch.index + catchMatch[0].length);
          } else {
            const lastClose = code.lastIndexOf('})();');
            if (lastClose >= 0) code = code.slice(0, lastClose + 5);
          }
        }
        code = code.replace(/```[\s\S]*$/, '').trim();
        break;
      }
    }
  }

  return { code, steps, notes: '', stripped: '' };
}

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*.,;!@#$%^&()=+~`{}\[\]\s]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'unnamed';
}

export function extractTestName(description) {
  const keywords = ['登录', '测试', '创建', '新增', '查询', '删除', '修改', '编辑', '提交', '验证', '填写', '打开', '搜索', '导入', '导出', '审核', '审批', '流程'];
  let name = '';
  for (const kw of keywords) {
    const idx = description.indexOf(kw);
    if (idx !== -1) {
      name = description.slice(Math.max(0, idx - 4), idx + 8).trim();
      break;
    }
  }
  if (!name || name.length < 2) name = description.trim();
  if (name.length > 20) name = name.slice(0, 20);
  return sanitizeFileName(name);
}

export function generateUniqueFileName() {
  return `playwright_${Date.now()}.js`;
}

export function cleanupScriptFile(scriptPath) {
  try { if (existsSync(scriptPath)) unlinkSync(scriptPath); } catch {}
}

export function extractFlowFromTrajectory(trajectory) {
  const history = trajectory?.history || [];
  const flow = [];

  for (let i = 0; i < history.length; i++) {
    const step = history[i];
    const modelOutput = step.model_output;
    const state = step.state;
    const results = step.result || [];

    if (!modelOutput) continue;

    const isDone = results.some(r => r.is_done === true);
    if (isDone) {
      flow.push({
        stepNumber: i + 1,
        type: 'done',
        description: results.find(r => r.extracted_content)?.extracted_content || 'Task completed',
        url: state?.url || '',
        success: results.some(r => r.success === true),
      });
      continue;
    }

    const actions = modelOutput.action || [];
    const currentState = modelOutput.current_state || {};

    for (let j = 0; j < actions.length; j++) {
      const actionObj = actions[j];
      if (!actionObj || typeof actionObj !== 'object') continue;

      const actionKey = Object.keys(actionObj)[0];
      const actionParams = actionObj[actionKey] || {};

      const interactedEl = (state?.interacted_element && state.interacted_element[j]) || null;

      const elInfo = {};

      if (interactedEl) {
        elInfo.tag = interactedEl.tag_name || '';
        elInfo.xpath = interactedEl.xpath || '';
        elInfo.highlightIndex = interactedEl.highlight_index;

        const attrs = interactedEl.attributes || {};
        if (attrs) {
          elInfo.id = attrs.id || '';
          elInfo.class = attrs.class || '';
          elInfo.title = attrs.title || '';
          elInfo.placeholder = attrs.placeholder || '';
          elInfo.type = attrs.type || '';
          elInfo.name = attrs.name || '';
          elInfo.value = attrs.value || '';
          elInfo['aria-label'] = attrs['aria-label'] || '';
          elInfo['data-testid'] = attrs['data-testid'] || attrs['data-test-id'] || '';
          elInfo.text = attrs.text || attrs.value || attrs['aria-label'] || attrs.title || attrs.placeholder || '';
          elInfo.allAttrs = Object.entries(attrs)
            .filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => `${k}="${v}"`)
            .join('; ');
        }

        const branch = interactedEl.entire_parent_branch_path;
        if (Array.isArray(branch) && branch.length > 0) {
          elInfo.parentPath = branch.join(' > ');
        }
      }

      // Fallback: extract XPath from action result's | loc:... marker
      if (!elInfo.xpath) {
        const resultContent = (results[j]?.extracted_content || '');
        const locMatch = resultContent.match(/\| loc:([^\s|]+)/);
        if (locMatch) elInfo.xpath = locMatch[1];
      }

      flow.push({
        stepNumber: i + 1,
        actionIndex: j,
        type: actionKey,
        description: currentState.next_goal || '',
        url: state?.url || '',
        params: {
          text: actionParams.text || actionParams.label_text || actionParams.label || '',
          value: actionParams.value || '',
          index: actionParams.index,
          url: actionParams.url || '',
          raw: actionParams,
        },
        element: elInfo,
        success: results[j]?.success,
        error: results[j]?.error || null,
        extractedContent: results[j]?.extracted_content || '',
      });
    }
  }

  return flow;
}

/**
 * Parse a markdown trajectory table into structured action rows.
 * Format from sendToScriptGen in trajectory.js:
 *   | # | 操作 | 目标 | 元素 | XPath | 标签 | 值 |
 */
export function parseTrajectoryTable(text) {
  const rows = [];
  const lines = text.split('\n');
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.includes('操作') && trimmed.includes('目标')) {
      inTable = true;
      continue;
    }
    if (trimmed.startsWith('|---')) continue;
    if (!inTable || !trimmed.startsWith('|')) {
      if (inTable) break;
      continue;
    }

    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c !== '');
    if (cells.length < 2) continue;

    rows.push({
      num: parseInt(cells[0]) || 0,
      type: cells[1] || '',
      goal: cells[2] || '',
      tag: cells[3] || '',
      xpath: cells[4] === '-' ? '' : (cells[4] || ''),
      label: cells[5] || '',
      value: cells[6] || '',
    });
  }
  return rows;
}


const SCRIPT_TEMPLATE_HEAD = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  try {`;

const SCRIPT_TEMPLATE_TAIL = `
  } catch (err) {
    console.error('Test failed:', err.message);
    await page.screenshot({ path: '/tmp/error.png', fullPage: false });
    throw err;
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });`;

/**
 * Generate a robust script action line for a single trajectory action.
 * Each action uses the CTRL helpers (from controller.py) via page.evaluate().
 */
function genActionLine(row, idx) {
  const { type, label, value, xpath, goal } = row;
  const n = idx + 1;
  const comment = goal ? ` // ${goal.replace(/`/g, "'").slice(0, 100)}` : '';
  const esc = (s) => (s || '').replace(/\\/g, '\\\\').replace(/\`/g, '\\`').replace(/\${/g, '\\${');

  switch (type) {
    case 'fill_form_field':
      if (!label || !value) return '';
      return [
        `    console.log(\`[${n}] Fill "${label}" with "${value}"\`);${comment}`,
        `    const r${n} = await page.evaluate(() => CTRL.fillFormField('${esc(label)}', '${esc(value)}'));`,
        `    if (r${n} === 'field-disabled') console.log('  → disabled, already filled');`,
        `    else if (r${n} === 'is-date-picker') console.log('  → is date picker, use selectDate');`,
        `    await page.waitForTimeout(500);`,
      ];

    case 'select_option':
      if (!label) return '';
      return [
        `    console.log(\`[${n}] Select "${esc(value || 'first')}" in "${label}"\`);${comment}`,
        `    const r${n} = await page.evaluate(() => CTRL.selectOption('${esc(label)}', '${esc(value || 'first')}'));`,
        `    console.log('  →', r${n});`,
        `    await page.waitForTimeout(800);`,
      ];

    case 'select_date':
      if (!label || !value) return '';
      return [
        `    console.log(\`[${n}] Set date "${value}" for "${label}"\`);${comment}`,
        `    const r${n} = await page.evaluate(() => CTRL.selectDate('${esc(label)}', '${esc(value)}'));`,
        `    if (r${n}.startsWith('already:')) console.log('  → already set');`,
        `    await page.waitForTimeout(500);`,
      ];

    case 'click_radio':
      if (!label || !value) return '';
      return [
        `    console.log(\`[${n}] Click radio "${value}" in "${label}"\`);${comment}`,
        `    await page.evaluate(() => CTRL.clickRadio('${esc(label)}', '${esc(value)}'));`,
        `    await page.waitForTimeout(300);`,
      ];

    case 'click_menu_item': {
      const param = esc(label || value || '');
      if (!param) return '';
      return [
        `    console.log(\`[${n}] Click menu "${param}"\`);${comment}`,
        `    await page.evaluate(() => CTRL.clickMenuItem('${param}'));`,
        `    await page.waitForTimeout(800);`,
      ];
    }

    case 'click_table_row_action': {
      const rText = esc(label || '');
      const bText = esc(value || '');
      if (!rText || !bText) return '';
      return [
        `    console.log(\`[${n}] Click "${bText}" in row "${rText}"\`);${comment}`,
        `    await page.evaluate(() => CTRL.clickTableRowAction('${rText}', '${bText}'));`,
        `    await page.waitForTimeout(500);`,
      ];
    }

    case 'close_dialog':
      return [
        `    console.log(\`[${n}] Close dialog\`);${comment}`,
        `    const r${n} = await page.evaluate(() => CTRL.closeDialog());`,
        `    console.log('  →', r${n});`,
        `    await page.waitForTimeout(500);`,
      ];

    case 'wait_for_loading':
      return [
        `    console.log(\`[${n}] Wait for loading\`);${comment}`,
        `    await page.evaluate(() => CTRL.waitForLoading());`,
      ];

    case 'switch_tab': {
      const param = esc(label || value || '');
      if (!param) return '';
      return [
        `    console.log(\`[${n}] Switch to tab "${param}"\`);${comment}`,
        `    await page.evaluate(() => CTRL.switchTab('${param}'));`,
        `    await page.waitForTimeout(500);`,
      ];
    }

    case 'click_adjacent_button':
      if (!label) return '';
      return [
        `    console.log(\`[${n}] Click adjacent button for "${label}"\`);${comment}`,
        `    const r${n} = await page.evaluate(() => CTRL.clickAdjacentButton('${esc(label)}'));`,
        `    if (r${n} === 'already-filled') console.log('  → already filled');`,
        `    await page.waitForTimeout(500);`,
      ];

    case 'expand_all_el_tree':
      return [
        `    console.log(\`[${n}] Expand all tree nodes\`);${comment}`,
        `    await page.evaluate(() => CTRL.expandAllTreeNodes());`,
        `    await page.waitForTimeout(500);`,
      ];

    case 'check_field_value':
      if (!label) return '';
      return [
        `    console.log(\`[${n}] Check field "${label}"\`);${comment}`,
        `    const val${n} = await page.evaluate(() => CTRL.checkFieldValue('${esc(label)}'));`,
        `    console.log('  →', val${n});`,
      ];

    case 'save_case_data': {
      const k = label || `data_${n}`;
      const v = value || '';
      return [
        `    const ${k.replace(/[^a-zA-Z0-9_]/g, '_')} = '${esc(v)}';${comment}`,
      ];
    }

    case 'read_case_data': {
      const k = label || '';
      if (!k) return '';
      return [
        `    // read_case_data: ${k} (already stored as const)${comment}`,
      ];
    }

    case 'take_screenshot':
      return [
        `    console.log(\`[${n}] Screenshot\`);${comment}`,
        `    await page.screenshot({ path: '/tmp/step_${n}.png', fullPage: false });`,
      ];

    case 'extract_content':
      return [
        `    console.log(\`[${n}] Extract page content\`);${comment}`,
        `    const text${n} = await page.evaluate(() => document.body.innerText);`,
        `    console.log('  →', text${n}.slice(0, 200));`,
      ];

    case 'get_page_state':
      return [
        `    console.log(\`[${n}] Page state\`);${comment}`,
        `    const state${n} = await page.evaluate(() => ({ dialogs: document.querySelectorAll('.el-dialog').length, loading: !!document.querySelector('.el-loading-mask:not(.el-loading-mask--hidden)'), notifs: [...document.querySelectorAll('.el-notification')].filter(e=>e.offsetParent!==null).length }));`,
        `    console.log('  →', JSON.stringify(state${n}));`,
      ];

    case 'click_element_by_index':
    case 'click_element':
      if (xpath) {
        return [
          `    console.log(\`[${n}] Click by XPath\`);${comment}`,
          `    await page.locator('xpath=${esc(xpath)}').click();`,
          `    await page.waitForTimeout(500);`,
        ];
      }
      // No XPath — use evaluate with text check as last resort
      return [
        `    // [${n}] Click element (no XPath in trajectory)${comment}`,
        `    console.log(\`[${n}] Click element\`);`,
        `    // Try to find by text:`,
        `    const clicked${n} = await page.evaluate(() => {`,
        `      const btns = document.querySelectorAll('button, .el-button, a, [role="button"]');`,
        `      for (const b of btns) { if (b.offsetParent !== null && b.textContent.trim()) { b.click(); return b.textContent.trim(); } }`,
        `      return null;`,
        `    });`,
        `    if (clicked${n}) console.log('  → clicked:', clicked${n});`,
        `    await page.waitForTimeout(500);`,
      ];

    case 'go_to_url':
    case 'navigate':
      return [
        `    console.log(\`[${n}] Navigate\`);${comment}`,
        value && value.startsWith('http')
          ? `    await page.goto('${esc(value)}', { waitUntil: 'networkidle', timeout: 60000 });`
          : `    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });`,
        `    await page.waitForTimeout(2000);`,
        `    // Inject CTRL after navigation`,
        `    await page.evaluate(() => {`,
        `      window.CTRL = ${CTRL_OBJECT.replace(/\n/g, '\n      ')}`,
        `    });`,
      ];

    case 'done':
      return [
        `    console.log(\`[${n}] Task complete\`);${comment}`,
      ];

    default:
      // Unknown action — log it but don't generate broken code
      return [
        `    // [${n}] ${type} (unsupported action, skipping)${comment}`,
      ];
  }
}

/**
 * Convert parsed trajectory actions into a complete, runnable Playwright script.
 * Embeds controller.py Element UI helpers (CTRL object) for correct Vue interaction.
 * Returns null if parsing yields no actions.
 */
export function convertTrajectoryToScript(trajectoryTable) {
  const rows = parseTrajectoryTable(trajectoryTable);
  if (!rows || rows.length === 0) return null;

  const lines = [];
  lines.push(SCRIPT_TEMPLATE_HEAD);

  for (let i = 0; i < rows.length; i++) {
    const actionLines = genActionLine(rows[i], i);
    if (actionLines && actionLines.length > 0) {
      lines.push('');
      lines.push(`    // ----- Step ${i + 1}: ${rows[i].type}${rows[i].label ? ' (' + rows[i].label + ')' : ''} -----`);
      lines.push(...actionLines);
    }
  }

  lines.push(SCRIPT_TEMPLATE_TAIL);
  return lines.join('\n');
}

// ============================================================
// Phase-based script assembly with per-phase LLM generation
// ============================================================

const PHASE_RUNNER = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  // Inject CTRL into every page automatically (persists across all navigations)
  await context.addInitScript(() => {
    window.CTRL = ${CTRL_OBJECT.replace(/\n/g, '\n    ')};
  });

  const page = await context.newPage();

  try {
    // Phase functions are defined below; execute them sequentially
`;

const PHASE_RUNNER_END = `
  } catch (err) {
    console.error('Test failed:', err.message);
    try { await page.screenshot({ path: '/tmp/error.png' }); } catch {}
    throw err;
  } finally {
    await browser.close();
  }
})().catch(err => { process.exit(1); });`;

/**
 * Build a short, focused prompt for a single phase.
 * Each phase prompt is small → LLM can stay focused.
 */
export function buildPhasePrompt({ phaseIndex, totalPhases, phaseActions, testScenario }) {
  let prompt = `Generate Playwright action code for Phase ${phaseIndex + 1} of ${totalPhases}.`;

  if (testScenario) {
    prompt += `\n\nTest scenario:\n${testScenario.slice(0, 300)}`;
  }

  prompt += `\n\n## Actions for this phase
` + '| # | Action | Label | Value | XPath |\n|---|--------|-------|-------|-------|\n';
  for (let i = 0; i < phaseActions.length; i++) {
    const a = phaseActions[i];
    prompt += `| ${i + 1} | ${a.type || ''} | ${a.label || '-'} | ${a.value || '-'} | ${a.xpath || '-'} |\n`;
  }

  prompt += `\n## Rules
1. Output ONLY the code for this phase's actions — no \`const { chromium }\`, no \`browser.close()\`, no async wrapper
2. **If phase 1 has no \`page.goto\` as its first action, add \`await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 })\` + \`await page.waitForTimeout(2000)\` before all other actions.**

2. **🚨 CTRL exists ONLY in the browser — WRAP every call**: CTRL is injected inside \`page.evaluate\`, so you MUST always write:
   \`\`\`javascript
   await page.evaluate(() => CTRL.selectOption('label', 'option'));
   await page.evaluate(() => CTRL.fillFormField('label', 'value'));
   await page.evaluate(() => CTRL.waitForLoading());
   \`\`\`
   **NEVER write bare \`CTRL.xxx()\`** — that runs in Node.js context where CTRL doesn't exist. Example of what NOT to do:
   \`\`\`javascript
   await CTRL.selectOption('label', 'option');  // ❌ ReferenceError: CTRL is not defined
   await CTRL.fillFormField('label', 'value');  // ❌ ReferenceError: CTRL is not defined
   \`\`\`

3. **CTRL already injected** — do NOT redefine CTRL methods
4. **el-select dropdowns** → \`await page.evaluate(() => CTRL.selectOption(label, option))\`. NEVER use \`page.locator('select')\`
5. **Text inputs** → \`await page.evaluate(() => CTRL.fillFormField(label, value))\`
6. **Date fields** → \`await page.evaluate(() => CTRL.selectDate(label, 'YYYY-MM-DD'))\`
7. **Click menu** → \`await page.evaluate(() => CTRL.clickMenuItem(text))\`
8. **Close dialog** → \`await page.evaluate(() => CTRL.closeDialog())\`
9. **Wait for loading** → \`await page.evaluate(() => CTRL.waitForLoading())\`
10. **Add \`await page.waitForTimeout(500)\`** after each action
11. **Add \`console.log('✓ ...')\`** before each action
12. **save_case_data → const**: \`save_case_data(key, value)\` becomes \`const key = 'value';\`. \`read_case_data(key)\` becomes a reference to that variable. Don't skip them — they carry cross-phase data.
13. **Table rows**: Use \`CTRL.clickTableRowAction(rowText, btnText)\` for el-table row buttons. For selecting a row, use \`page.locator('.el-table__row').first().click()\` — NOT \`(//table/tbody/tr)[1]\` (el-table has a different DOM structure). Always wait for the table with \`await page.waitForSelector('.el-table__row', { timeout: 10000 })\` first.
14. **Screenshots**: \`await page.screenshot({ path: '/tmp/phase_${phaseIndex + 1}_step_N.png' })\` at key points
15. **Button locators**: Use \`page.locator('xpath=//button[contains(translate(.," ",""),"登录")]')\` — \`translate()\` removes ALL spaces which Chinese text often has. \`text()\` and \`normalize-space()\` cannot handle this.
16. **🚨 Do NOT invent CTRL methods**: Only the 12 methods in the API table exist. \`CTRL.getPageState()\`, \`CTRL.extractContent()\`, etc. do NOT exist and will throw errors. For non-CTRL operations, use plain \`page.evaluate\` or \`page.locator\`.`;

  return prompt;
}

/**
 * Build a targeted refine prompt from a failed script execution.
 * Extracts the actionable error and tells the LLM what pattern to fix.
 */
export function buildRefinePrompt({ script, error, stderr }) {
  const errorLine = (error || '').slice(0, 300);
  const stderrTail = (stderr || '').slice(-800);

  // Classify the error to give targeted fix instructions
  let fixHint = '';
  if (errorLine.includes('CTRL is not defined')) {
    fixHint = '**Fix**: CTRL calls must be wrapped in `page.evaluate(() => ...)`. Change `await CTRL.xxx()` → `await page.evaluate(() => CTRL.xxx())`.';
  } else if (errorLine.includes('locator.click') || errorLine.includes('locator.waitFor') || errorLine.includes('Timeout')) {
    fixHint = '**Fix**: The locator/xpath did not match any element. Common causes:\n'
      + '- Chinese text may contain hidden spaces → use `translate(.," ","")` to strip spaces before matching\n'
      + '- The element may be inside an el-dialog → scope XPath to `.el-dialog` or use `CTRL.*`\n'
      + '- The page may not have finished loading → add `waitForSelector` or longer timeout\n'
      + '- el-table rows use `.el-table__row` class, not `//table/tbody/tr`\n'
      + '- el-select dropdowns need `CTRL.selectOption()`, never `page.locator(\'select\')`';
  } else if (errorLine.includes('ReferenceError') || errorLine.includes('is not defined')) {
    fixHint = '**Fix**: A variable is not defined. Check all CTRL calls use `page.evaluate(() => CTRL.xxx())` and all helper functions are defined.';
  } else if (errorLine.includes('page.fill') || errorLine.includes('fill(')) {
    fixHint = '**Fix**: Never use `page.fill()`. Element UI inputs need native setter via `page.evaluate(() => CTRL.fillFormField(label, value))`.';
  } else if (errorLine.includes('selectOption') || errorLine.includes("locator('select')")) {
    fixHint = '**Fix**: el-select is NOT a native `<select>`. Use `await page.evaluate(() => CTRL.selectOption(label, option))`.';
  }

  return `The generated Playwright script failed during execution. Fix the issue and output the COMPLETE fixed script.

## Error
\`\`\`
${errorLine}
${stderrTail}
\`\`\`

${fixHint || '**Fix**: Review the error and adjust the script accordingly.'}

## Rules
1. Output the ENTIRE fixed script, not just the changed portion
2. Keep the \`context.addInitScript\` CTRL injection — do not remove it
3. All Element UI operations must use \`page.evaluate(() => CTRL.xxx())\`
4. \`save_case_data\` → \`const\` variables; \`read_case_data\` → reference those variables
5. Add proper waits before interacting with elements
6. Use \`translate(.," ","")\` in XPaths for Chinese text
7. For el-table rows, use \`.el-table__row\` class selector`;
}

/**
 * Parse action rows for a given phase, grouping actions between `done` markers.
 * Returns [{ actions: [...], doneAction: {...} }]
 */
export function splitIntoPhases(rows) {
  if (!rows || rows.length === 0) return [];

  const phases = [];
  let current = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (row.type === 'done' && current.length > 0) {
      current.push(row);
      phases.push(current);
      current = [];
      continue;
    }

    current.push(row);
  }

  if (current.length > 0) phases.push(current);
  return phases;
}

/**
 * Assemble per-phase scripts into a complete runnable script.
 * Runner uses context.addInitScript() to inject CTRL — persists across ALL navigations.
 * Phase scripts just call page.evaluate(() => CTRL.xxx()) — CTRL is always available.
 */
export function assemblePhasedScript(phaseCodeBlocks, targetUrl) {
  const lines = [];
  if (targetUrl) {
    lines.push(`const TARGET_URL = '${targetUrl.replace(/'/g, "\\'")}';`);
  }
  lines.push(PHASE_RUNNER);

  for (let p = 0; p < phaseCodeBlocks.length; p++) {
    lines.push(`    // ==============================`);
    lines.push(`    // Phase ${p + 1} of ${phaseCodeBlocks.length}`);
    lines.push(`    // ==============================`);
    lines.push(`    console.log('▶ Phase ${p + 1}/${phaseCodeBlocks.length}');`);

    lines.push(phaseCodeBlocks[p]);
    lines.push(`    console.log('✓ Phase ${p + 1}/${phaseCodeBlocks.length} complete');`);
  }

  lines.push(PHASE_RUNNER_END);
  return lines.join('\n');
}
