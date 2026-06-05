// 对公客户信息创建与个人关联维护 - UI自动测试 v3
// 修复：1) 登录后移除遮挡层 2) drawer内force:true
const { chromium } = require('playwright');

const TARGET_URL = 'http://172.19.87.161:9200/';
const SCREENSHOT_DIR = 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\';
const STEP_TIMEOUT = 15000;

async function screenshot(page, name) {
  const path = `${SCREENSHOT_DIR}${name}.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`  📸 截图: ${path}`);
}

async function step(name, fn) {
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
    console.log(`  ✓ ${name} 成功`);
  } catch (err) {
    console.error(`  ✗ ${name} 失败: ${err.message}`);
    throw err;
  }
}

async function findFormItem(page, labelText) {
  const items = await page.locator('.el-form-item').all();
  for (const item of items) {
    const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
    if (label && label.replace(/\s+/g, '').includes(labelText)) {
      return item;
    }
  }
  return null;
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.el-overlay, .v-modal, .navbar__mask, .el-dialog__wrapper, .el-message-box__wrapper').forEach(el => {
      const style = getComputedStyle(el);
      if (parseInt(style.zIndex) >= 1000 && el.offsetHeight > 200) {
        el.remove();
      }
    });
    document.querySelectorAll('.el-drawer__wrapper .el-col-24, .el-drawer__wrapper .el-row').forEach(el => {
      el.style.pointerEvents = 'auto';
    });
  }).catch(() => {});
  await page.waitForTimeout(300);
}

async function clickSelectByLabel(page, labelText, optionText) {
  const item = await findFormItem(page, labelText);
  if (!item) {
    console.log(`  ⚠ 未找到字段: ${labelText}`);
    return false;
  }
  const input = item.locator('input, .el-input__inner').first();
  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);

  let popover = page.locator('.el-select-dropdown:visible, .el-popper:visible').first();
  if (!(await popover.isVisible().catch(() => false))) {
    await page.waitForTimeout(500);
    popover = page.locator('.el-select-dropdown:visible, .el-popper:visible').first();
  }
  if (await popover.isVisible().catch(() => false)) {
    const opts = popover.locator('.el-select-dropdown__item');
    const count = await opts.count();
    for (let i = 0; i < count; i++) {
      const txt = await opts.nth(i).textContent().catch(() => '');
      if (txt && txt.replace(/\s+/g, '').includes(optionText.replace(/\s+/g, ''))) {
        await opts.nth(i).click();
        await page.waitForTimeout(500);
        console.log(`  ✓ ${labelText} → ${optionText}`);
        return true;
      }
    }
    console.log(`  ⚠ ${labelText}: 未找到 "${optionText}"`);
    for (let i = 0; i < count; i++) {
      const txt = await opts.nth(i).textContent().catch(() => '');
      console.log(`    选项[${i}]: "${txt ? txt.trim() : ''}"`);
    }
    await page.keyboard.press('Escape');
    return false;
  }
  console.log(`  ⚠ ${labelText}: 下拉菜单未弹出`);
  return false;
}

async function fillInputByLabel(page, labelText, value, fillAll = false) {
  const items = await page.locator('.el-form-item').all();
  let filled = 0;
  for (const item of items) {
    const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
    if (label && label.replace(/\s+/g, '').includes(labelText)) {
      const input = item.locator('input').first();
      const readonly = await input.getAttribute('readonly').catch(() => null);
      const disabled = await input.isDisabled().catch(() => false);
      if (readonly === null && !disabled) {
        await input.scrollIntoViewIfNeeded().catch(() => {});
        await input.click({ force: true }).catch(() => {});
        await input.fill(value);
        filled++;
        if (!fillAll) {
          console.log(`  ✓ ${labelText} → ${value}`);
          return true;
        }
      }
    }
  }
  if (fillAll && filled > 0) {
    console.log(`  ✓ ${labelText} ×${filled} → ${value}`);
    return true;
  }
  if (filled === 0) console.log(`  ⚠ 未找到可编辑字段: ${labelText}`);
  return filled > 0;
}

async function clickButton(page, text) {
  const btn = page.locator(`button:has-text("${text}")`).first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ force: true });
    console.log(`  ✓ 点击 "${text}"`);
    return true;
  }
  console.log(`  ⚠ 未找到按钮: "${text}"`);
  return false;
}

async function scanFormFields(page) {
  console.log('\n--- 扫描表单字段 ---');
  const items = await page.locator('.el-form-item').all();
  console.log(`表单字段数: ${items.length}`);
  for (const f of items) {
    const label = await f.locator('.el-form-item__label').textContent().catch(() => '');
    const ph = await f.locator('input,textarea').first().getAttribute('placeholder').catch(() => '');
    const readonly = await f.locator('input').first().getAttribute('readonly').catch(() => null);
    console.log(`  label="${label ? label.trim() : ''}" placeholder="${ph}" readonly=${readonly !== null}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(STEP_TIMEOUT);

  try {
    // ===== 1. 登录系统 =====
    await step('1. 登录系统', async () => {
      await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);

      // 选择法人
      const orgSelector = page.locator('input[placeholder*="请选择法人"]').first();
      if (await orgSelector.isVisible().catch(() => false)) {
        await orgSelector.click();
        await page.waitForTimeout(1000);
        const firstItem = page.locator('.el-select-dropdown__item').first();
        await firstItem.waitFor({ state: 'visible', timeout: 5000 });
        await firstItem.click();
        console.log('  ✓ 选择法人');
        await page.waitForTimeout(1000);
      }

      // 填写用户名
      await page.locator('input[placeholder*="用户名"]').first().fill('701994');
      console.log('  ✓ 填写用户名: 701994');

      // 填写密码
      await page.locator('input[placeholder*="密码"]').first().fill('1');
      console.log('  ✓ 填写密码');

      // 点击登录
      await page.locator('button:has-text("登 录"), button:has-text("登录")').first().click();
      console.log('  ✓ 点击登录');

      try {
        await page.waitForURL('**/home**', { timeout: 30000 });
        console.log('  ✓ 登录成功, URL:', page.url());
      } catch {
        await page.waitForTimeout(3000);
        console.log('  URL:', page.url());
      }
    });

    await page.waitForTimeout(2000);

    // ===== 1.5 移除登录后遮挡层 =====
    await step('1.5 移除首页遮挡层', async () => {
      // 等待页面加载
      await page.waitForTimeout(2000);

      // 尝试关闭弹窗（公告/欢迎弹窗等）
      const closeBtns = [
        page.locator('.el-dialog__headerbtn:visible').first(),
        page.locator('.el-message-box__headerbtn:visible').first(),
        page.locator('button:has-text("关闭"):visible').first(),
        page.locator('button:has-text("确定"):visible').first(),
        page.locator('.el-dialog__close:visible').first(),
        page.locator('.el-icon-close:visible').first(),
      ];
      for (const btn of closeBtns) {
        if (await btn.isVisible().catch(() => false)) {
          await btn.click({ force: true }).catch(() => {});
          console.log('  ✓ 关闭弹窗');
          await page.waitForTimeout(500);
        }
      }

      // 强制移除高z-index遮挡层
      await page.evaluate(() => {
        document.querySelectorAll('*').forEach(el => {
          const style = getComputedStyle(el);
          const zIndex = parseInt(style.zIndex);
          if (zIndex >= 100000 && el.offsetHeight > 200 && (style.position === 'fixed' || style.position === 'absolute')) {
            console.log('移除遮挡层:', el.tagName, el.className, 'z=', zIndex);
            el.remove();
          }
        });
      }).catch(() => {});
      await page.waitForTimeout(500);

      // 也尝试ESC关闭
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // 再次检查
      const remainingOverlays = await page.evaluate(() => {
        const overlays = [];
        document.querySelectorAll('*').forEach(el => {
          const style = getComputedStyle(el);
          const zIndex = parseInt(style.zIndex);
          if (zIndex >= 1000 && el.offsetHeight > 200 && (style.position === 'fixed' || style.position === 'absolute')) {
            overlays.push({ tag: el.tagName, cls: el.className.toString().substring(0, 60), z: zIndex });
          }
        });
        return overlays;
      }).catch(() => []);
      if (remainingOverlays.length > 0) {
        console.log('  剩余遮挡层:', JSON.stringify(remainingOverlays));
        // 强制移除所有
        await page.evaluate(() => {
          document.querySelectorAll('*').forEach(el => {
            const style = getComputedStyle(el);
            const zIndex = parseInt(style.zIndex);
            if (zIndex >= 1000 && el.offsetHeight > 200 && (style.position === 'fixed' || style.position === 'absolute')) {
              el.style.display = 'none';
            }
          });
        }).catch(() => {});
        await page.waitForTimeout(500);
      }

      await screenshot(page, 'after-overlay-removal');
    });

    // ===== 2. 导航到对公客户管理 =====
    await step('2. 导航到对公客户管理', async () => {
      // 尝试多种方式点击"客户管理"
      let clicked = false;
      const menuSelectors = [
        page.locator('nav.navbar ul.menu-wrapper li.menu-item:has-text("客户管理")').first(),
        page.locator('.el-menu-item:has-text("客户管理")').first(),
        page.locator('span:has-text("客户管理")').first(),
        page.locator('li:has-text("客户管理")').first(),
      ];
      for (const sel of menuSelectors) {
        if (await sel.isVisible().catch(() => false)) {
          await sel.click({ force: true });
          clicked = true;
          console.log('  ✓ 点击"客户管理"');
          break;
        }
      }
      if (!clicked) {
        // 扫描页面上所有可能的菜单元素
        console.log('  扫描页面菜单元素...');
        const allMenuElements = await page.evaluate(() => {
          const items = [];
          document.querySelectorAll('li, span, a, div').forEach(el => {
            const txt = el.textContent?.trim();
            if (txt && txt.includes('客户管理') && txt.length < 20) {
              items.push({ tag: el.tagName, cls: el.className.toString().substring(0, 80), text: txt, visible: el.offsetHeight > 0 });
            }
          });
          return items;
        }).catch(() => []);
        console.log('  找到的"客户管理"元素:', JSON.stringify(allMenuElements));

        // 尝试用JavaScript直接点击
        const jsClicked = await page.evaluate(() => {
          const elements = document.querySelectorAll('li, span, a, div');
          for (const el of elements) {
            const txt = el.textContent?.trim();
            if (txt === '客户管理' && el.offsetHeight > 0 && el.offsetHeight < 100) {
              el.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);
        if (jsClicked) {
          clicked = true;
          console.log('  ✓ 通过JS点击"客户管理"');
        }
      }
      if (!clicked) {
        await screenshot(page, 'error-menu-customer');
        throw new Error('未找到"客户管理"菜单项');
      }

      await page.waitForTimeout(1500);

      // 点击子菜单"对公客户管理"
      clicked = false;
      const submenuSelectors = [
        page.locator('.submenu-wrapper:visible').getByText('对公客户管理', { exact: true }),
        page.locator('.el-menu--popup:visible span:has-text("对公客户管理")').first(),
        page.locator('span:has-text("对公客户管理"):visible').first(),
      ];
      for (const sel of submenuSelectors) {
        if (await sel.isVisible().catch(() => false)) {
          await sel.click({ force: true });
          clicked = true;
          console.log('  ✓ 点击"对公客户管理"');
          break;
        }
      }
      if (!clicked) {
        await page.evaluate(() => document.querySelector('.navbar__mask')?.remove()).catch(() => {});
        await page.waitForTimeout(500);
        const jsSubClicked = await page.evaluate(() => {
          const elements = document.querySelectorAll('li, span, a');
          for (const el of elements) {
            const txt = el.textContent?.trim();
            if (txt === '对公客户管理' && el.offsetHeight > 0 && el.offsetHeight < 100) {
              el.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);
        if (jsSubClicked) {
          clicked = true;
          console.log('  ✓ 通过JS点击"对公客户管理"');
        }
      }
      if (!clicked) {
        await screenshot(page, 'error-submenu-corp');
        throw new Error('未找到"对公客户管理"子菜单');
      }

      await page.waitForTimeout(3000);
      console.log('  当前URL:', page.url());
    });

    // ===== 3. 点击新增 =====
    await step('3. 点击新增', async () => {
      let clicked = false;
      for (let i = 0; i < 20; i++) {
        const addBtn = page.locator('button:has-text("新增")').first();
        if (await addBtn.isVisible().catch(() => false)) {
          await addBtn.click({ force: true });
          clicked = true;
          console.log(`  ✓ 点击"新增" (等待${i + 1}s)`);
          break;
        }
        await page.waitForTimeout(1000);
      }
      if (!clicked) {
        await screenshot(page, 'error-no-add-btn');
        throw new Error('未找到"新增"按钮');
      }
      await page.waitForTimeout(2000);
      await dismissOverlays(page);
    });

    // ===== 4. 扫描表单 =====
    await step('4. 扫描表单字段', async () => {
      await scanFormFields(page);
    });

    // ===== 5. 填写基础信息 =====
    await step('5. 填写基础信息', async () => {
      await dismissOverlays(page);

      await clickSelectByLabel(page, '客户状态', '信贷正式客户');
      await clickSelectByLabel(page, '客户类型', '集体经济组织');
      await clickSelectByLabel(page, '证件类型', '证券业务许可证');
      await fillInputByLabel(page, '客户名称', '李淼一有限责任公司', true);
      await fillInputByLabel(page, '证件号码', '1234EF0SC9VDS12340');

      const errMsgs = await page.locator('.el-form-item__error:visible, .el-message--error:visible').all();
      if (errMsgs.length > 0) {
        console.log('\n⚠ 校验错误:');
        for (const err of errMsgs) {
          console.log(`  ${await err.textContent()}`);
        }
        await screenshot(page, 'validation-errors');
      }
    });

    // ===== 6. 保存基础档案 =====
    await step('6. 保存基础档案', async () => {
      await dismissOverlays(page);
      const saved = await clickButton(page, '保存');
      if (!saved) {
        await screenshot(page, 'error-save-btn');
        throw new Error('未找到"保存"按钮');
      }
      await page.waitForTimeout(3000);

      const toast = page.locator('.el-message:visible, .el-notification:visible').first();
      if (await toast.isVisible().catch(() => false)) {
        const msg = (await toast.textContent()).replace(/\s+/g, ' ').trim();
        console.log(`提示消息: ${msg.substring(0, 150)}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
      }
    });

    // ===== 7. 填写地址与财务信息 =====
    await step('7. 填写地址与财务信息', async () => {
      await page.waitForTimeout(2000);
      await dismissOverlays(page);
      await scanFormFields(page);

      await clickSelectByLabel(page, '国别', '中华人民共和国');
      await fillInputByLabel(page, '外文名称', 'Li Miaoyi LLC');

      // 地址级联选择器
      const cascaderItem = await findFormItem(page, '地址');
      if (cascaderItem) {
        const cascader = cascaderItem.locator('.el-cascader, .el-input').first();
        if (await cascader.isVisible().catch(() => false)) {
          await cascader.click({ force: true });
          await page.waitForTimeout(1000);
          const menus = page.locator('.el-cascader-menu:visible');
          const menuCount = await menus.count();
          console.log(`  级联菜单数: ${menuCount}`);
          if (menuCount > 0) {
            const firstItems = menus.first().locator('.el-cascader-node');
            const fCount = await firstItems.count();
            for (let i = 0; i < fCount; i++) {
              const txt = await firstItems.nth(i).textContent().catch(() => '');
              if (txt && txt.includes('湖南')) { await firstItems.nth(i).click(); console.log('  ✓ 湖南省'); break; }
            }
            await page.waitForTimeout(800);
            if (await menus.count() > 1) {
              const secondItems = menus.nth(1).locator('.el-cascader-node');
              const sCount = await secondItems.count();
              for (let i = 0; i < sCount; i++) {
                const txt = await secondItems.nth(i).textContent().catch(() => '');
                if (txt && txt.includes('长沙')) { await secondItems.nth(i).click(); console.log('  ✓ 长沙市'); break; }
              }
            }
            await page.waitForTimeout(800);
            if (await menus.count() > 2) {
              const thirdItems = menus.nth(2).locator('.el-cascader-node');
              const tCount = await thirdItems.count();
              for (let i = 0; i < tCount; i++) {
                const txt = await thirdItems.nth(i).textContent().catch(() => '');
                if (txt && txt.includes('娄底')) { await thirdItems.nth(i).click(); console.log('  ✓ 娄底市'); break; }
              }
            }
          }
        }
      } else {
        await clickSelectByLabel(page, '省', '湖南省');
        await clickSelectByLabel(page, '市', '长沙市');
        await clickSelectByLabel(page, '区', '娄底市');
      }

      await fillInputByLabel(page, '详细地址', '111123');
      await fillInputByLabel(page, '经度', '132.34');
      await fillInputByLabel(page, '纬度', '31.2');
      await fillInputByLabel(page, '联系人', '李四');
      await fillInputByLabel(page, '手机', '13308463344');
      await fillInputByLabel(page, '手机号码', '13308463344');
    });

    // ===== 8. 工商登记信息 =====
    await step('8. 填写工商登记信息', async () => {
      await dismissOverlays(page);
      const drawer = page.locator('.el-drawer__body:visible').first();
      if (await drawer.isVisible().catch(() => false)) {
        await drawer.evaluate(el => el.scrollTop = el.scrollTop + 500).catch(() => {});
        await page.waitForTimeout(500);
      }

      await clickSelectByLabel(page, '投资主体', '法人投资');
      await clickSelectByLabel(page, '投资主体类型', '法人投资');

      const dates = [
        { label: '成立日期', value: '2020-01-01' },
        { label: '注册登记日期', value: '2020-01-15' },
        { label: '失效日期', value: '2040-01-15' },
        { label: '登记注册失效日期', value: '2040-01-15' },
      ];
      for (const d of dates) {
        await fillInputByLabel(page, d.label, d.value);
        await page.waitForTimeout(300);
      }

      await fillInputByLabel(page, '主营', '软件开发');
      await fillInputByLabel(page, '主营业务', '软件开发');
      await fillInputByLabel(page, '经营范围', '软件开发，金服系统');

      const textareas = await page.locator('textarea:visible').all();
      for (const ta of textareas) {
        const ph = await ta.getAttribute('placeholder').catch(() => '');
        const label = await ta.evaluate(el => el.closest('.el-form-item')?.querySelector('.el-form-item__label')?.textContent || '').catch(() => '');
        if (ph.includes('经营') || ph.includes('主营') || label.includes('经营') || label.includes('主营')) {
          await ta.click({ force: true }).catch(() => {});
          await ta.fill('软件开发，金服系统');
          console.log(`  ✓ textarea → 软件开发，金服系统`);
        }
      }
    });

    // ===== 9. 引入个人客户 =====
    await step('9. 引入个人客户', async () => {
      await dismissOverlays(page);
      const drawer = page.locator('.el-drawer__body:visible').first();
      if (await drawer.isVisible().catch(() => false)) {
        await drawer.evaluate(el => el.scrollTop = 0).catch(() => {});
        await page.waitForTimeout(500);
      }

      let clicked = false;
      for (let i = 0; i < 15; i++) {
        const selectors = [
          page.locator('button:has-text("引入")').first(),
          page.locator('.el-button:has-text("引入")').first(),
        ];
        for (const sel of selectors) {
          if (await sel.isVisible().catch(() => false)) {
            await sel.click({ force: true });
            clicked = true;
            console.log('  ✓ 点击"引入"');
            break;
          }
        }
        if (clicked) break;
        if (await drawer.isVisible().catch(() => false)) {
          await drawer.evaluate(el => el.scrollTop = el.scrollTop + 300).catch(() => {});
        }
        await page.waitForTimeout(1000);
      }
      if (!clicked) {
        await screenshot(page, 'error-intro-btn');
        throw new Error('未找到"引入"按钮');
      }

      await page.waitForTimeout(3000);

      // 弹窗
      const dialogs = await page.locator('.el-dialog:visible').all();
      const dlg = dialogs.length > 0 ? dialogs[dialogs.length - 1] : page.locator('.el-dialog:visible').first();

      if (await dlg.isVisible().catch(() => false)) {
        console.log('  弹窗可见');
        const dialogInputs = await dlg.locator('input').all();
        console.log(`  弹窗输入框数: ${dialogInputs.length}`);
        for (const inp of dialogInputs) {
          const ph = await inp.getAttribute('placeholder').catch(() => '');
          const label = await inp.evaluate(el => el.closest('.el-form-item')?.querySelector('.el-form-item__label')?.textContent || '').catch(() => '');
          console.log(`    placeholder="${ph}" label="${label.trim()}"`);
        }

        const cstNoInput = dlg.locator('input[placeholder*="客户编号"], input[placeholder*="编号"]').first();
        if (await cstNoInput.isVisible().catch(() => false)) {
          await cstNoInput.click({ force: true }).catch(() => {});
          await cstNoInput.fill('26050610365798406');
          console.log('  ✓ 输入客户编号');
        }

        const cstNameInput = dlg.locator('input[placeholder*="客户名称"], input[placeholder*="姓名"]').first();
        if (await cstNameInput.isVisible().catch(() => false)) {
          await cstNameInput.click({ force: true }).catch(() => {});
          await cstNameInput.fill('朱桂武');
          console.log('  ✓ 输入客户名称: 朱桂武');
        }

        const certTypeItems = await dlg.locator('.el-form-item').all();
        for (const ci of certTypeItems) {
          const ciLabel = await ci.locator('.el-form-item__label').textContent().catch(() => '');
          if (ciLabel && ciLabel.includes('证件类型')) {
            await ci.locator('input').first().click({ force: true }).catch(() => {});
            await page.waitForTimeout(800);
            const idOpt = page.locator('.el-select-dropdown:visible .el-select-dropdown__item:has-text("居民身份证")').first();
            if (await idOpt.isVisible().catch(() => false)) {
              await idOpt.click();
              console.log('  ✓ 证件类型: 居民身份证');
            } else {
              const allOpts = await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').all();
              for (const o of allOpts) {
                const txt = await o.textContent().catch(() => '');
                if (txt && txt.includes('身份证')) { await o.click(); console.log('  ✓ 证件类型: 居民身份证'); break; }
              }
            }
            await page.waitForTimeout(500);
            break;
          }
        }

        const certNoInput = dlg.locator('input[placeholder*="证件号码"], input[placeholder*="证件号"]').first();
        if (await certNoInput.isVisible().catch(() => false)) {
          await certNoInput.click({ force: true }).catch(() => {});
          await certNoInput.fill('110101198606047887');
          console.log('  ✓ 输入证件号码');
        }

        await page.waitForTimeout(1000);
        const queryBtn = dlg.locator('button:has-text("查询"), button:has-text("搜索")').first();
        if (await queryBtn.isVisible().catch(() => false)) {
          await queryBtn.click({ force: true });
          console.log('  ✓ 点击查询');
        }

        await page.waitForTimeout(3000);

        const tableRows = dlg.locator('.el-table__body-wrapper tr.el-table__row');
        const rowCount = await tableRows.count();
        console.log(`  表格行数: ${rowCount}`);
        if (rowCount > 0) {
          await tableRows.first().click({ force: true });
          console.log('  ✓ 选择第1行');
        }

        await page.waitForTimeout(500);
        const confirmBtn = dlg.locator('button:has-text("确认"), button:has-text("确定")').first();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click({ force: true });
          console.log('  ✓ 点击确认');
        } else {
          await screenshot(page, 'error-confirm-btn');
          throw new Error('弹窗中未找到确认按钮');
        }
        await page.waitForTimeout(2000);
      } else {
        await screenshot(page, 'error-no-dialog');
        throw new Error('未找到弹窗');
      }
    });

    // ===== 10. 联网核查与最终保存 =====
    await step('10. 联网核查与提交', async () => {
      await dismissOverlays(page);

      const verifyBtn = page.locator('button:has-text("联网核查"), button:has-text("核查")').first();
      if (await verifyBtn.isVisible().catch(() => false)) {
        await verifyBtn.click({ force: true });
        console.log('  ✓ 点击联网核查');
        await page.waitForTimeout(3000);
      } else {
        console.log('  ⚠ 未找到"联网核查"按钮');
      }

      const errs = await page.locator('.el-form-item__error:visible, .el-message--error:visible').all();
      if (errs.length > 0) {
        console.log('\n⚠ 提交前校验错误:');
        for (const err of errs) { console.log(`  ${await err.textContent()}`); }
        await screenshot(page, 'pre-submit-errors');
      }

      const saveBtn = page.locator('button:has-text("保存"), button:has-text("提交")').first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click({ force: true });
        console.log('  ✓ 点击保存');
      }

      await page.waitForTimeout(4000);

      const toast = page.locator('.el-message:visible, .el-notification:visible').first();
      if (await toast.isVisible().catch(() => false)) {
        const msg = (await toast.textContent()).replace(/\s+/g, ' ').trim();
        console.log(`提示消息: ${msg.substring(0, 150)}`);
        if (msg.includes('成功')) { console.log('  ✅ 对公客户创建成功！'); }
        else if (msg.includes('失败') || msg.includes('错误')) {
          await screenshot(page, 'final-submit-failed');
          console.log('  ❌ 提交失败');
        }
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    });

    console.log('\n=== 11. 最终截图 ===');
    await screenshot(page, 'final-result');
    console.log('\n✅ 测试执行完成');
  } catch (err) {
    console.error(`\n❌ 测试阻塞于: ${err.message}`);
    await screenshot(page, 'error-blocked');
    console.log('当前URL:', page.url());
  } finally {
    console.log('\n等待30秒后关闭浏览器...');
    await page.waitForTimeout(30000);
    await browser.close();
  }
})();
