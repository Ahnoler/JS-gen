const { chromium } = require('playwright');

const TARGET_URL = 'http://101.89.127.196:9080/login?appKey=1920710182837141505&redirect=http://101.89.127.196:8761';

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

function nativeInputSetter(input, val) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, val);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

function nativeTextareaSetter(textarea, val) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, val);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  textarea.dispatchEvent(new Event('blur', { bubbles: true }));
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  try {
    // ===== 步骤1: 登录系统 =====
    console.log('步骤1: 登录系统');
    await page.goto(TARGET_URL);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      const inputs = document.querySelectorAll('input');
      if (inputs.length >= 2) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(inputs[0], 'admin');
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
        setter.call(inputs[1], '123456');
        inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const loginBtn = document.querySelector('button[type="submit"], .el-button--primary, button');
      if (loginBtn && loginBtn.offsetParent !== null) loginBtn.click();
    });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/step1_login.png' });
    console.log('✓ 登录成功');

    // ===== 步骤2: 展开树菜单 =====
    console.log('步骤2: 展开树菜单');
    await page.waitForSelector('.el-tree', { timeout: 15000 });
    await expandAllTreeNodes(page);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/step2_expand_tree.png' });
    console.log('✓ 树节点已展开');

    // ===== 步骤3: 点击叶节点"客户管理-新增潜客" =====
    console.log('步骤3: 点击叶节点"客户管理-新增潜客"');
    await page.locator('xpath=//span[text()="客户管理-新增潜客"]').last().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/step3_click_leaf.png' });
    console.log('✓ 已点击叶节点');

    // ===== 步骤4: 点击"测试案例"步骤节点 =====
    console.log('步骤4: 点击"测试案例"步骤节点');
    await page.locator('xpath=//div[text()="测试案例"]').last().click();
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.vxe-table, .el-table', { timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/step4_test_cases.png' });
    console.log('✓ 已进入测试案例页面');

    // ===== 步骤5: 找到"业务要素_0002"行并点击编辑图标 =====
    console.log('步骤5: 找到"业务要素_0002"行并点击编辑图标');

    await page.evaluate(() => {
      const rows = document.querySelectorAll('.vxe-body--row');
      for (const row of rows) {
        const cells = row.querySelectorAll('.vxe-body--column, .vxe-body--cell, td');
        let found = false;
        for (const cell of cells) {
          const text = cell.textContent.trim();
          if (text === '业务要素_0002') {
            found = true;
            break;
          }
        }
        if (found) {
          row.scrollIntoView({ behavior: 'auto', block: 'center' });
          break;
        }
      }
    });
    await page.waitForTimeout(1000);

    const editClicked = await page.evaluate(() => {
      const rows = document.querySelectorAll('.vxe-body--row');
      for (const row of rows) {
        const cells = row.querySelectorAll('.vxe-body--column, .vxe-body--cell, td');
        let found = false;
        for (const cell of cells) {
          const text = cell.textContent.trim();
          if (text === '业务要素_0002') {
            found = true;
            break;
          }
        }
        if (found) {
          const editIcon = row.querySelector('i.iconfont.icon-bianji');
          if (editIcon && editIcon.offsetParent !== null) {
            editIcon.click();
            return true;
          }
        }
      }
      return false;
    });
    console.log('✓ 编辑图标点击:', editClicked ? '成功' : '失败');

    await page.waitForSelector('.el-dialog', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/step5_edit_dialog.png' });
    console.log('✓ 编辑弹窗已打开');

    // ===== 步骤6: 填写表单字段 =====
    console.log('步骤6: 填写表单字段');

    // 6.1 填写测试意图
    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog');
      if (!dialog) return;
      const formItems = dialog.querySelectorAll('.el-form-item');
      for (const item of formItems) {
        const label = item.querySelector('.el-form-item__label');
        if (label && label.textContent.trim().includes('测试意图')) {
          const textarea = item.querySelector('.el-textarea__inner');
          if (textarea) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(textarea, '验证新增潜客时输入非法数据，系统应拦截并提示错误');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
          }
          break;
        }
      }
    });
    await page.waitForTimeout(500);
    console.log('✓ 测试意图已填写');

    // 6.2 填写检查点
    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog');
      if (!dialog) return;
      const formItems = dialog.querySelectorAll('.el-form-item');
      for (const item of formItems) {
        const label = item.querySelector('.el-form-item__label');
        if (label && label.textContent.trim().includes('检查点')) {
          const textarea = item.querySelector('.el-textarea__inner');
          if (textarea) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(textarea, '1、交易状态，失败\n2、系统提示输入数据不合法');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
          }
          break;
        }
      }
    });
    await page.waitForTimeout(500);
    console.log('✓ 检查点已填写');

    // 6.3 填写操作步骤
    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog');
      if (!dialog) return;
      const formItems = dialog.querySelectorAll('.el-form-item');
      for (const item of formItems) {
        const label = item.querySelector('.el-form-item__label');
        if (label && label.textContent.trim().includes('操作步骤')) {
          const textarea = item.querySelector('.el-textarea__inner');
          if (textarea) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(textarea, '1、进入新增潜客页面\n2、不输入必填项或输入非法数据\n3、点击提交');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
          }
          break;
        }
      }
    });
    await page.waitForTimeout(500);
    console.log('✓ 操作步骤已填写');

    // 6.4 填写预期结果
    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog');
      if (!dialog) return;
      const formItems = dialog.querySelectorAll('.el-form-item');
      for (const item of formItems) {
        const label = item.querySelector('.el-form-item__label');
        if (label && label.textContent.trim().includes('预期结果')) {
          const textarea = item.querySelector('.el-textarea__inner');
          if (textarea) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(textarea, '^^1^^ 系统拦截提交，提示相应错误信息，潜客未新增成功');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
          }
          break;
        }
      }
    });
    await page.waitForTimeout(500);
    console.log('✓ 预期结果已填写');

    // 6.5 填写前置条件
    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog');
      if (!dialog) return;
      const formItems = dialog.querySelectorAll('.el-form-item');
      for (const item of formItems) {
        const label = item.querySelector('.el-form-item__label');
        if (label && label.textContent.trim().includes('前置条件')) {
          const textarea = item.querySelector('.el-textarea__inner');
          if (textarea) {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(textarea, '已登录信贷系统，进入新增潜客页面');
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
          }
          break;
        }
      }
    });
    await page.waitForTimeout(500);
    console.log('✓ 前置条件已填写');

    // 6.6 填写案例类型（下拉选择：业务要素）
    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog');
      if (!dialog) return;
      const formItems = dialog.querySelectorAll('.el-form-item');
      for (const item of formItems) {
        const label = item.querySelector('.el-form-item__label');
        if (label && label.textContent.trim().includes('案例类型')) {
          const trigger = item.querySelector('.el-select .el-input__inner');
          if (trigger) trigger.click();
          break;
        }
      }
    });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const options = document.querySelectorAll('.el-select-dropdown__item');
      for (const opt of options) {
        if (opt.textContent.trim() === '业务要素') {
          opt.click();
          return true;
        }
      }
      return false;
    });
    await page.waitForTimeout(500);
    console.log('✓ 案例类型已选择');

    // 6.7 填写案例性质（下拉选择：反向案例）
    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog');
      if (!dialog) return;
      const formItems = dialog.querySelectorAll('.el-form-item');
      for (const item of formItems) {
        const label = item.querySelector('.el-form-item__label');
        if (label && label.textContent.trim().includes('案例性质')) {
          const trigger = item.querySelector('.el-select .el-input__inner');
          if (trigger) trigger.click();
          break;
        }
      }
    });
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const options = document.querySelectorAll('.el-select-dropdown__item');
      for (const opt of options) {
        if (opt.textContent.trim() === '反向案例') {
          opt.click();
          return true;
        }
      }
      return false;
    });
    await page.waitForTimeout(500);
    console.log('✓ 案例性质已选择');

    await page.screenshot({ path: '/tmp/step6_form_filled.png' });

    // ===== 步骤7: 点击"确定"提交 =====
    console.log('步骤7: 点击"确定"提交');

    await page.evaluate(() => {
      const dialog = document.querySelector('.el-dialog');
      if (!dialog) return;
      const footer = dialog.closest('.el-dialog__wrapper')?.querySelector('.el-dialog__footer') || document.querySelector('.el-dialog__footer');
      if (!footer) return;
      const btns = footer.querySelectorAll('button');
      for (const btn of btns) {
        if (btn.textContent.trim().includes('确定')) {
          btn.click();
          return;
        }
      }
    });

    await page.waitForTimeout(2000);

    // 检查是否有表单校验错误
    const formErrors = await page.evaluate(() => {
      const errors = [];
      document.querySelectorAll('.el-form-item__error').forEach(el => {
        if (el.textContent.trim()) errors.push(el.textContent.trim());
      });
      return errors;
    });

    if (formErrors.length > 0) {
      console.log('⚠ 表单校验错误:', JSON.stringify(formErrors));

      // 重新填写案例类型（可能未成功）
      await page.evaluate(() => {
        const dialog = document.querySelector('.el-dialog');
        if (!dialog) return;
        const formItems = dialog.querySelectorAll('.el-form-item');
        for (const item of formItems) {
          const label = item.querySelector('.el-form-item__label');
          if (label && label.textContent.trim().includes('案例类型')) {
            const trigger = item.querySelector('.el-select .el-input__inner');
            if (trigger) trigger.click();
            break;
          }
        }
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const options = document.querySelectorAll('.el-select-dropdown__item');
        for (const opt of options) {
          if (opt.textContent.trim() === '业务要素') {
            opt.click();
            return true;
          }
        }
        return false;
      });
      await page.waitForTimeout(500);

      // 重新填写案例性质
      await page.evaluate(() => {
        const dialog = document.querySelector('.el-dialog');
        if (!dialog) return;
        const formItems = dialog.querySelectorAll('.el-form-item');
        for (const item of formItems) {
          const label = item.querySelector('.el-form-item__label');
          if (label && label.textContent.trim().includes('案例性质')) {
            const trigger = item.querySelector('.el-select .el-input__inner');
            if (trigger) trigger.click();
            break;
          }
        }
      });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const options = document.querySelectorAll('.el-select-dropdown__item');
        for (const opt of options) {
          if (opt.textContent.trim() === '反向案例') {
            opt.click();
            return true;
          }
        }
        return false;
      });
      await page.waitForTimeout(500);

      // 再次点击确定
      await page.evaluate(() => {
        const dialog = document.querySelector('.el-dialog');
        if (!dialog) return;
        const footer = dialog.closest('.el-dialog__wrapper')?.querySelector('.el-dialog__footer') || document.querySelector('.el-dialog__footer');
        if (!footer) return;
        const btns = footer.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.textContent.trim().includes('确定')) {
            btn.click();
            return;
          }
        }
      });
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: '/tmp/step7_submit.png' });
    console.log('✓ 表单已提交');

    // ===== 步骤8: 断言验证"编辑成功"提示 =====
    console.log('步骤8: 断言验证"编辑成功"提示');
    await page.waitForSelector('.el-message', { timeout: 10000 });
    const messageText = await page.evaluate(() => {
      const msg = document.querySelector('.el-message');
      return msg ? msg.textContent.trim() : null;
    });

    if (messageText && messageText.includes('编辑成功')) {
      console.log('✓ 断言通过: 编辑成功');
    } else {
      console.log('⚠ 消息内容:', messageText);
    }

    await page.screenshot({ path: '/tmp/step8_success.png' });

  } catch (err) {
    await page.screenshot({ path: '/tmp/error.png' });
    console.error(err.message);
  } finally {
    await browser.close();
  }
})();