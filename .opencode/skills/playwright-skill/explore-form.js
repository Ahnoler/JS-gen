const { chromium } = require('playwright');

const TARGET_URL = 'http://101.89.127.196:9080/login?appKey=1920710182837141505&redirect=http://101.89.127.196:8761';
const STEP_URL = 'http://101.89.127.196:8761/AiCase/step?catalogueName=%E5%AE%A2%E6%88%B7%E7%AE%A1%E7%90%86-%E6%96%B0%E5%A2%9E%E6%BD%9C%E5%AE%A2&step=3&id=3936';

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: false, slowMo: 100 });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1920, height: 1080 });

    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1000);

    const usernameInput = page.locator('input[placeholder*="用户名"], input[placeholder*="账号"], input[name="username"], input[type="text"]').first();
    await usernameInput.fill('admin');

    const passwordInput = page.locator('input[type="password"], input[placeholder*="密码"]').first();
    await passwordInput.fill('123456');

    const loginBtn = page.locator('button[type="submit"], button:has-text("登录"), button:has-text("Login")').first();
    await loginBtn.click();

    await page.waitForTimeout(10000);
    await page.waitForLoadState('networkidle');
    console.log('✓ 登录完成');

    await page.goto(STEP_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log('✓ 已跳转到步骤3页面');

    const testCaseLink = page.locator('text=测试案例').first();
    await testCaseLink.waitFor({ timeout: 10000 });
    await testCaseLink.click();
    await page.waitForTimeout(2000);
    console.log('✓ 点击测试案例');

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const bizElement = page.locator('text=业务要素').first();
    await bizElement.waitFor({ timeout: 10000 });
    await bizElement.click();
    await page.waitForTimeout(2000);
    console.log('✓ 点击业务要素');

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await page.waitForSelector('table, .el-table, .ant-table', { timeout: 10000 });

    const allRows = await page.locator('tr, .el-table__row').all();
    let targetRow = null;
    for (let i = 0; i < allRows.length; i++) {
      const rowText = await allRows[i].textContent();
      if (rowText.includes('业务要素_0002')) {
        targetRow = allRows[i];
        console.log(`✓ 找到目标行: 行${i}`);
        break;
      }
    }

    if (!targetRow) {
      const tableContainer = page.locator('.el-table__body-wrapper, .ant-table-body, table').first();
      await tableContainer.evaluate(el => el.scrollTop = el.scrollHeight);
      await page.waitForTimeout(1000);

      const allRowsAfterScroll = await page.locator('tr, .el-table__row').all();
      for (let i = 0; i < allRowsAfterScroll.length; i++) {
        const rowText = await allRowsAfterScroll[i].textContent();
        if (rowText.includes('业务要素_0002')) {
          targetRow = allRowsAfterScroll[i];
          console.log(`✓ 滚动后找到目标行: 行${i}`);
          break;
        }
      }
    }

    if (!targetRow) {
      throw new Error('未找到包含"业务要素_0002"的表格行');
    }

    await targetRow.hover();
    await page.waitForTimeout(1000);

    let modifyBtn = null;
    const btnWithText = targetRow.locator('button:has-text("修改"), a:has-text("修改"), span:has-text("修改")').first();
    const hasTextBtn = await btnWithText.count();
    if (hasTextBtn > 0) {
      modifyBtn = btnWithText;
    } else {
      const editIconSelectors = [
        'button:has(.el-icon-edit)', 'button:has(.el-icon-edit-outline)',
        'button:has(.anticon-edit)', 'button:has(svg)',
        'a:has(.el-icon-edit)', 'a:has(.anticon-edit)',
        'i.el-icon-edit', 'i.el-icon-edit-outline', 'i.anticon-edit',
        'i.icon-edit', 'i.fa-edit', 'i.icon-modify', 'i.icon-bianji'
      ];
      for (const selector of editIconSelectors) {
        const btn = targetRow.locator(selector).first();
        const count = await btn.count();
        if (count > 0) {
          const isVisible = await btn.isVisible();
          if (isVisible) { modifyBtn = btn; break; }
        }
      }
      if (!modifyBtn) {
        const lastTd = targetRow.locator('td').last();
        const firstBtnInLastTd = lastTd.locator('button, a, .el-button, .ant-btn, i').first();
        if (await firstBtnInLastTd.count() > 0) modifyBtn = firstBtnInLastTd;
      }
      if (!modifyBtn) {
        const firstBtn = targetRow.locator('button, a, .el-button, .ant-btn, i').first();
        if (await firstBtn.count() > 0) modifyBtn = firstBtn;
      }
    }

    if (!modifyBtn) throw new Error('未找到修改按钮');

    await modifyBtn.click({ force: true });
    await page.waitForTimeout(3000);
    console.log('✓ 点击修改按钮');
    await page.screenshot({ path: '/tmp/explore-1-after-modify-click.png', fullPage: true });

    // ========== 核心探索：寻找"编辑案例"表单 ==========
    console.log('\n========== 开始探索表单结构 ==========');

    // 策略1: 通过文本"编辑案例"查找所有可能包含该文字的元素
    const editTextElements = await page.locator(':text("编辑案例")').all();
    console.log(`\n--- 策略1: 文本匹配"编辑案例" ---`);
    console.log(`找到 ${editTextElements.length} 个包含"编辑案例"文本的元素`);
    for (let i = 0; i < editTextElements.length; i++) {
      const el = editTextElements[i];
      const tag = await el.evaluate(e => e.tagName);
      const cls = await el.evaluate(e => e.className);
      const id = await el.evaluate(e => e.id);
      const xpath = await el.evaluate(e => {
        const parts = [];
        let node = e;
        while (node && node.nodeType === 1) {
          let idx = 1;
          let sib = node.previousSibling;
          while (sib) {
            if (sib.nodeType === 1 && sib.tagName === node.tagName) idx++;
            sib = sib.previousSibling;
          }
          const prefix = node.tagName.toLowerCase();
          parts.unshift(`${prefix}[${idx}]`);
          node = node.parentNode;
        }
        return '/' + parts.join('/');
      });
      console.log(`  元素${i}: tag=${tag}, class="${cls}", id="${id}"`);
      console.log(`    xpath: ${xpath}`);
    }

    // 策略2: 通过XPath直接查找标题为"编辑案例"的元素，然后找其父容器
    const dialogByTitle = await page.locator('xpath=//*[contains(text(),"编辑案例")]').all();
    console.log(`\n--- 策略2: XPath contains(编辑案例) ---`);
    console.log(`找到 ${dialogByTitle.length} 个元素`);
    for (let i = 0; i < dialogByTitle.length; i++) {
      const el = dialogByTitle[i];
      const tag = await el.evaluate(e => e.tagName);
      const cls = await el.evaluate(e => e.className);
      console.log(`  元素${i}: tag=${tag}, class="${cls}"`);

      // 向上查找父容器（drawer/dialog/modal）
      const parentInfo = await el.evaluate(e => {
        let node = e.parentElement;
        const parents = [];
        let depth = 0;
        while (node && depth < 10) {
          const info = {
            tag: node.tagName,
            class: node.className,
            id: node.id,
            role: node.getAttribute('role'),
            ariaLabel: node.getAttribute('aria-label'),
            depth: depth + 1
          };
          parents.push(info);
          if (
            node.classList.contains('el-drawer') ||
            node.classList.contains('el-dialog') ||
            node.classList.contains('ant-modal') ||
            node.classList.contains('ant-drawer') ||
            node.getAttribute('role') === 'dialog' ||
            node.classList.contains('modal')
          ) {
            info.isDialogContainer = true;
            break;
          }
          node = node.parentElement;
          depth++;
        }
        return parents;
      });
      console.log(`  父级链:`);
      for (const p of parentInfo) {
        console.log(`    深度${p.depth}: <${p.tag}> class="${p.class}" id="${p.id}" role="${p.role}" ariaLabel="${p.ariaLabel}" ${p.isDialogContainer ? '*** 对话框容器 ***' : ''}`);
      }
    }

    // 策略3: 查找所有可见的对话框/drawer/modal容器
    const dialogContainers = await page.locator('.el-drawer, .el-dialog, .ant-modal, .ant-drawer, [role="dialog"], .modal').all();
    console.log(`\n--- 策略3: 对话框容器 ---`);
    console.log(`找到 ${dialogContainers.length} 个对话框容器`);
    for (let i = 0; i < dialogContainers.length; i++) {
      const container = dialogContainers[i];
      const isVisible = await container.isVisible();
      const tag = await container.evaluate(e => e.tagName);
      const cls = await container.evaluate(e => e.className);
      const id = await container.evaluate(e => e.id);
      const ariaLabel = await container.getAttribute('aria-label');
      const titleText = await container.evaluate(e => {
        const titleEl = e.querySelector('.el-drawer__title, .el-dialog__title, .ant-modal-title, .ant-drawer-title, [role="heading"]');
        return titleEl ? titleEl.textContent : '(无标题元素)';
      });
      console.log(`  容器${i}: visible=${isVisible}, tag=${tag}, class="${cls}", id="${id}", ariaLabel="${ariaLabel}", title="${titleText}"`);
    }

    // 策略4: 找到"编辑案例"标题对应的对话框后，深度扫描表单
    const editCaseDialog = await page.locator('xpath=//*[contains(text(),"编辑案例")]/ancestor::*[self::div[contains(@class,"el-drawer")] or self::div[contains(@class,"el-dialog")] or self::div[contains(@class,"ant-modal")] or self::div[contains(@class,"ant-drawer")] or self::div[@role="dialog"]][1]').first();
    const dialogCount = await editCaseDialog.count();
    console.log(`\n--- 策略4: 通过"编辑案例"文本定位的对话框 ---`);
    console.log(`找到 ${dialogCount} 个`);

    if (dialogCount > 0) {
      const dialogCls = await editCaseDialog.evaluate(e => e.className);
      const dialogTag = await editCaseDialog.evaluate(e => e.tagName);
      console.log(`对话框: tag=${dialogTag}, class="${dialogCls}"`);

      // 生成XPath
      const dialogXpath = await editCaseDialog.evaluate(e => {
        const parts = [];
        let node = e;
        while (node && node.nodeType === 1) {
          let idx = 1;
          let sib = node.previousSibling;
          while (sib) {
            if (sib.nodeType === 1 && sib.tagName === node.tagName) idx++;
            sib = sib.previousSibling;
          }
          let prefix = node.tagName.toLowerCase();
          if (node.id) prefix += `[@id="${node.id}"]`;
          else if (node.className && typeof node.className === 'string') {
            const mainClass = node.className.split(' ')[0];
            if (mainClass) prefix += `[contains(@class,"${mainClass}")]`;
          }
          parts.unshift(prefix);
          node = node.parentNode;
        }
        return '/' + parts.join('/');
      });
      console.log(`对话框XPath: ${dialogXpath}`);

      // 扫描表单内的所有input
      const inputs = await editCaseDialog.locator('input, textarea, select').all();
      console.log(`\n--- 表单内输入元素 (共${inputs.length}个) ---`);
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const tag = await input.evaluate(e => e.tagName);
        const type = await input.getAttribute('type') || '';
        const placeholder = await input.getAttribute('placeholder') || '';
        const name = await input.getAttribute('name') || '';
        const id = await input.getAttribute('id') || '';
        const value = await input.evaluate(e => {
          if (e.tagName === 'SELECT') return e.value;
          return e.value;
        });
        const cls = await input.evaluate(e => e.className);
        const isVisible = await input.isVisible();
        const label = await input.evaluate(e => {
          // 尝试找关联的label
          if (e.id) {
            const label = document.querySelector(`label[for="${e.id}"]`);
            if (label) return label.textContent.trim();
          }
          // 尝试找父级form-item的label
          let parent = e.parentElement;
          for (let d = 0; d < 5; d++) {
            if (!parent) break;
            if (parent.classList.contains('el-form-item') || parent.classList.contains('ant-form-item')) {
              const labelEl = parent.querySelector('.el-form-item__label, .ant-form-item-label');
              if (labelEl) return labelEl.textContent.trim();
            }
            parent = parent.parentElement;
          }
          return '';
        });

        // 生成简短XPath
        const inputXpath = await input.evaluate(e => {
          const parts = [];
          let node = e;
          while (node && node.nodeType === 1) {
            let idx = 1;
            let sib = node.previousSibling;
            while (sib) {
              if (sib.nodeType === 1 && sib.tagName === node.tagName) idx++;
              sib = sib.previousSibling;
            }
            let prefix = node.tagName.toLowerCase();
            if (node.id) {
              prefix += `[@id="${node.id}"]`;
              parts.unshift(prefix);
              break;
            }
            if (node.className && typeof node.className === 'string') {
              const mainClass = node.className.split(' ')[0];
              if (mainClass && mainClass.length < 50) prefix += `[contains(@class,"${mainClass}")]`;
            }
            parts.unshift(`${prefix}[${idx}]`);
            node = node.parentNode;
          }
          return parts.length > 0 && parts[0].startsWith('/') ? parts.join('/') : '/' + parts.join('/');
        });

        console.log(`  [${i}] tag=${tag} type="${type}" visible=${isVisible}`);
        console.log(`      label="${label}" placeholder="${placeholder}" name="${name}" id="${id}"`);
        console.log(`      value="${String(value).substring(0, 80)}" class="${cls}"`);
        console.log(`      xpath: ${inputXpath}`);
      }

      // 扫描el-select / ant-select
      const selects = await editCaseDialog.locator('.el-select, .ant-select').all();
      console.log(`\n--- 表单内下拉选择组件 (共${selects.length}个) ---`);
      for (let i = 0; i < selects.length; i++) {
        const sel = selects[i];
        const isVisible = await sel.isVisible();
        const label = await sel.evaluate(e => {
          let parent = e.parentElement;
          for (let d = 0; d < 5; d++) {
            if (!parent) break;
            if (parent.classList.contains('el-form-item') || parent.classList.contains('ant-form-item')) {
              const labelEl = parent.querySelector('.el-form-item__label, .ant-form-item-label');
              if (labelEl) return labelEl.textContent.trim();
            }
            parent = parent.parentElement;
          }
          return '';
        });
        const currentText = await sel.evaluate(e => {
          const input = e.querySelector('input');
          return input ? input.value : (e.textContent || '').trim().substring(0, 50);
        });
        const cls = await sel.evaluate(e => e.className);
        const selXpath = await sel.evaluate(e => {
          const parts = [];
          let node = e;
          while (node && node.nodeType === 1) {
            let idx = 1;
            let sib = node.previousSibling;
            while (sib) {
              if (sib.nodeType === 1 && sib.tagName === node.tagName) idx++;
              sib = sib.previousSibling;
            }
            let prefix = node.tagName.toLowerCase();
            if (node.className && typeof node.className === 'string') {
              const mainClass = node.className.split(' ')[0];
              if (mainClass && mainClass.length < 50) prefix += `[contains(@class,"${mainClass}")]`;
            }
            parts.unshift(`${prefix}[${idx}]`);
            node = node.parentNode;
          }
          return '/' + parts.join('/');
        });
        console.log(`  [${i}] visible=${isVisible} label="${label}" currentText="${currentText}"`);
        console.log(`      class="${cls}"`);
        console.log(`      xpath: ${selXpath}`);
      }

      // 扫描按钮
      const buttons = await editCaseDialog.locator('button, .el-button, .ant-btn').all();
      console.log(`\n--- 表单内按钮 (共${buttons.length}个) ---`);
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const text = (await btn.textContent() || '').trim();
        const isVisible = await btn.isVisible();
        const type = await btn.getAttribute('type') || '';
        const cls = await btn.evaluate(e => e.className);
        console.log(`  [${i}] text="${text}" visible=${isVisible} type="${type}" class="${cls}"`);
      }
    }

    // 策略5: 如果上面没找到，用更宽泛的方式搜索
    if (dialogCount === 0) {
      console.log('\n--- 策略5: 宽泛搜索所有可见的浮层/弹窗 ---');
      const overlays = await page.evaluate(() => {
        const allEls = document.querySelectorAll('*');
        const results = [];
        for (const el of allEls) {
          const style = window.getComputedStyle(el);
          if (
            (style.position === 'fixed' || style.position === 'absolute') &&
            style.zIndex !== 'auto' &&
            parseInt(style.zIndex) > 100 &&
            el.offsetWidth > 200 &&
            el.offsetHeight > 200
          ) {
            const text = el.textContent || '';
            if (text.includes('编辑案例')) {
              results.push({
                tag: el.tagName,
                class: el.className,
                id: el.id,
                zIndex: style.zIndex,
                width: el.offsetWidth,
                height: el.offsetHeight,
                textPreview: text.substring(0, 200)
              });
            }
          }
        }
        return results;
      });
      console.log(`找到 ${overlays.length} 个高z-index且包含"编辑案例"的浮层`);
      for (let i = 0; i < overlays.length; i++) {
        console.log(`  浮层${i}:`, JSON.stringify(overlays[i], null, 2));
      }

      // 最后尝试: 直接在页面body层面搜索"编辑案例"
      const allTextWithEdit = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const results = [];
        while (walker.nextNode()) {
          const text = walker.currentNode.textContent.trim();
          if (text.includes('编辑案例')) {
            const parent = walker.currentNode.parentElement;
            results.push({
              text: text.substring(0, 100),
              parentTag: parent.tagName,
              parentClass: parent.className,
              parentId: parent.id
            });
          }
        }
        return results;
      });
      console.log(`\n--- 页面中包含"编辑案例"文本的所有文本节点 ---`);
      console.log(JSON.stringify(allTextWithEdit, null, 2));
    }

    await page.screenshot({ path: '/tmp/explore-final.png', fullPage: true });
    console.log('\n========== 探索完成 ==========');

    await page.waitForTimeout(5000);

  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
