import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GENERATED_DIR } from './config.js';

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

export function buildScriptPrompt({ description, url, credentials, referenceScript, referenceScriptName }) {
  let prompt = `根据以下描述生成 Playwright 测试脚本。

## 测试场景
${description || '(未提供)'}`;
  prompt += `\n\n## 规范（按优先级排列）

### 🔴 优先级 1 — 定位策略（直接影响脚本能否运行）
- 【点击一律用 XPath】所有点击/导航类操作（按钮、图标、标签页、树节点、表格行操作按钮、分页等）必须使用 xpath= 格式定位。示例：
  ✓ page.locator('xpath=//span[text()="客户管理-新增潜客"]').last().click()
  ✓ page.locator('xpath=//i[contains(@class,"bianji")]').first().click()
  ✗ page.evaluate(() => { ... textContent.includes('名称') ... })
  ✗ page.locator('span:text-is("客户管理-新增潜客")')
  ✗ page.locator('div:has-text("测试案例")')
  禁止使用 :text-is()、:has-text()、page.evaluate + textContent 等方式定位点击目标
- 【XPath 精确匹配】所有 XPath 内文本匹配必须用 text()='精确文本'（如 //span[text()='客户管理-新增潜客']），禁止使用 contains(text(),'文本') 做模糊匹配。禁止在 evaluate 中用 textContent 遍历查找节点
- 【弹窗定位】用 locator('.el-dialog').last() 限定弹窗内查找，操作前先 waitFor({state:'visible'})。禁止将 .el-dialog 与 [class*="drawer"] 混用
- 【等待就绪】页面导航或登录后，必须等待目标元素出现再操作（await page.waitForSelector() 或 await locator.waitFor()），不要仅依赖 waitForTimeout。例如登录后等 .el-tree 加载再展开节点
- 【步骤间等待】每次点击导航后，必须用 waitForSelector() 等待下一步目标元素出现。例如点击树节点后等待表格(.vxe-table/.el-table)加载再查找行

### 🟡 优先级 2 — 特定组件交互（参考 atp-ui 和 atp-rule 技能）
- 【加载技能】涉及 Element UI 组件交互时，先加载 \`atp-ui\` 技能获取最新操作指南；涉及表单字段值生成时加载 \`atp-rule\` 技能
- 【树菜单展开】不要逐个点击展开。先调用 page.evaluate 一次性展开所有节点（函数如下，复制到脚本顶部）。展开后用 XPath 定位叶节点
  async function expandAllTreeNodes(page) {
    for (let i = 0; i < 10; i++) {
      const clicked = await page.evaluate(() => {
        const tree = document.querySelector('.el-tree');
        if (!tree) return -1;
        let n = 0;
        tree.querySelectorAll('.el-tree-node:not(.is-expanded)').forEach(node => {
          const icon = node.querySelector(':scope > .el-tree-node__content > .el-tree-node__expand-icon');
          if (icon) { icon.click(); n++; }
        });
        return n;
      });
      if (clicked === -1 || clicked === 0) break;
      await page.waitForTimeout(500);
    }
  }
  用法：await page.waitForSelector('.el-tree'); await expandAllTreeNodes(page);
- 【Element UI 表单填充】禁止使用 page.fill()。用原生 setter + dispatchEvent 触发 v-model：
  function nativeInputSetter(input, val) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, val);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.dispatchEvent(new Event('blur',{bubbles:true}));
  }
  注意：直接赋值，**不要先清空(setter+'')再赋值**，否则 Vue 的异步更新会导致预填值被覆盖
  textarea 类似，用 HTMLTextAreaElement.prototype
- 【下拉选择(el-select)】先 click 触发器展开，再在 .el-select-dropdown__item 内按文本 click 选项
- 【弹窗(el-dialog)】每次操作前重新 querySelector，不缓存引用（Vue 可能销毁重建 DOM）
- 【表格(el-table)】点击行内操作按钮时，先在行上下文中按文字定位，再在行内查找图标按钮
- 【菜单(el-menu)】点击前先检查父级 el-submenu 是否展开，未展开时先点展开图标
- 【日期/时间】同样用原生 setter + input/change/blur 事件
- 【form-data 验证】操作后用 page.evaluate 回读值确认写入成功
- 【错误检测】提交后扫描 .el-form-item__error / .el-message / .el-notification

### 🟢 优先级 3 — 脚本结构与常规约束
- 【脚本框架】使用 require('playwright') 引入，headless:false, slowMo:100, viewport 1920x1080, TARGET_URL 常量脚本顶部
- 【模板代码】整体 try-catch 包裹，错误时截图 + console.error(err.message)，finally 中关闭 browser
- 【步骤日志】每个步骤前加 // 注释，用 console.log('✓ 步骤描述') 输出状态，截图保存到 /tmp/{步骤名}.png
- 【去冗余】轨迹中带"重新""修正"前缀的步骤表示覆盖重试，仅保留最后一次成功操作

### ⚪ 优先级 4 — 技术限制（必须遵守，否则报错）
- 【选择器合法性】:has-text()、:text()、:visible 等 Playwright 扩展伪选择器只用于 locator()，不能用于 page.evaluate() / querySelector()
- 【组合选择器】不要将 Playwright 扩展选择器与标准 CSS 混合传给 querySelector/evaluate
- 【evaluate 作用域】page.evaluate() 内无法访问 Node.js 中定义的函数和变量。如需要用 native setter，必须在 evaluate 的箭头函数体内重新定义或内联`;

  if (referenceScript) {
    prompt += `\n\n## 参考脚本 (${referenceScriptName || 'reference.js'})\n\`\`\`javascript\n${referenceScript}\n\`\`\``;
  }

  if (credentials?.username || credentials?.password) {
    prompt += `\n\n## 登录凭据\n- 用户名: ${credentials.username || '(未提供)'}\n- 密码: ${credentials.password || '(未提供)'}`;
  }
	
  if (url) prompt += `\n\n## 目标系统\nTARGET_URL: ${url}`;

  prompt += `\n\n## 输出格式
请严格按以下格式输出：

### 测试步骤
1. 步骤描述
2. 步骤描述
...

### 脚本代码
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

  // Script: from "const { chromium }" to last "})();"
  const playwrightIdx = text.search(/(?:const|let|var)\s*\{\s*chromium\s*\}\s*=\s*require\s*\(\s*['"]playwright['"]\s*\)/);
  if (playwrightIdx >= 0) {
    code = text.slice(playwrightIdx);
    const lastClose = code.lastIndexOf('})();');
    if (lastClose >= 0) code = code.slice(0, lastClose + 5).trim();
    else code = code.trim();
  }

  // Fallback: grab everything after "脚本代码" line
  if (!code.trim()) {
    for (let i = 0; i < lines.length; i++) {
      if (/脚本代码/.test(lines[i])) {
        code = lines.slice(i + 1).join('\n').trim();
        // Strip trailing markdown/todos/comments
        const lastClose = code.lastIndexOf('})();');
        if (lastClose >= 0) code = code.slice(0, lastClose + 5).trim();
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

export function generateUniqueFileName(dateStr, testName) {
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${dateStr}-${testName}-${suffix}.js`;
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
