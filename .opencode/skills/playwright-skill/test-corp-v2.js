// 对公客户信息创建与个人关联维护 v7
// 修复：更换证件号码避免重复 + 完整流程
const { chromium } = require('playwright');
const TARGET_URL = 'http://172.19.87.161:9200/';
const SS = 'C:\\Users\\water\\AppData\\Local\\Temp\\opencode\\';
const CERT_NO = '9XYZ2026LMY05190001'; // 新证件号码，避免重复

async function ss(page, n) { await page.screenshot({ path: `${SS}${n}.png`, fullPage: true }); console.log(`📸 ${n}`); }
async function wait(page, ms) { await page.waitForTimeout(ms); }

async function dismissOverlays(page) {
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      const s = getComputedStyle(el);
      if (parseInt(s.zIndex) >= 100000 && el.offsetHeight > 200 && (s.position === 'fixed' || s.position === 'absolute')) el.style.display = 'none';
    });
    document.querySelectorAll('.el-drawer__wrapper .el-col-24, .el-drawer__wrapper .el-row').forEach(el => { el.style.pointerEvents = 'auto'; });
  }).catch(() => {});
  await wait(page, 300);
}

async function clickSelect(page, labelText, optionText) {
  const items = await page.locator('.el-form-item').all();
  for (const item of items) {
    const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
    if (label && label.replace(/\s+/g, '').includes(labelText.replace(/\s+/g, ''))) {
      await item.locator('input, .el-input__inner').first().scrollIntoViewIfNeeded().catch(() => {});
      await item.locator('input, .el-input__inner').first().click({ force: true });
      await wait(page, 800);
      const pop = page.locator('.el-select-dropdown:visible, .el-popper:visible').first();
      if (await pop.isVisible().catch(() => false)) {
        const opts = pop.locator('.el-select-dropdown__item');
        for (let i = 0; i < await opts.count(); i++) {
          const t = await opts.nth(i).textContent().catch(() => '');
          if (t && t.replace(/\s+/g, '').includes(optionText.replace(/\s+/g, ''))) {
            await opts.nth(i).click(); await wait(page, 400);
            console.log(`  ✓ ${labelText} → ${optionText}`); return true;
          }
        }
        console.log(`  ⚠ ${labelText}: 未找到"${optionText}"`);
        await page.keyboard.press('Escape');
      }
      return false;
    }
  }
  console.log(`  ⚠ 未找到: ${labelText}`); return false;
}

async function fillInput(page, labelText, value, skipN = 0) {
  const items = await page.locator('.el-form-item').all();
  let matched = 0;
  for (const item of items) {
    const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
    if (label && label.replace(/\s+/g, '').includes(labelText.replace(/\s+/g, ''))) {
      if (matched < skipN) { matched++; continue; }
      const inp = item.locator('input').first();
      const ro = await inp.getAttribute('readonly').catch(() => null);
      const dis = await inp.isDisabled().catch(() => false);
      if (ro === null && !dis) {
        await inp.scrollIntoViewIfNeeded().catch(() => {});
        await inp.click({ force: true });
        await inp.fill(value);
        console.log(`  ✓ ${labelText}[${skipN}] → ${value}`);
        return true;
      }
      matched++;
    }
  }
  console.log(`  ⚠ 未找到: ${labelText}[${skipN}]`);
  return false;
}

async function fillTextarea(page, labelText, value) {
  const items = await page.locator('.el-form-item').all();
  for (const item of items) {
    const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
    if (label && label.replace(/\s+/g, '').includes(labelText.replace(/\s+/g, ''))) {
      const ta = item.locator('textarea').first();
      if (await ta.isVisible().catch(() => false)) {
        await ta.scrollIntoViewIfNeeded().catch(() => {});
        await ta.click({ force: true }); await ta.fill(value);
        console.log(`  ✓ ${labelText} → ${value}`); return true;
      }
      const inp = item.locator('input').first();
      const ro = await inp.getAttribute('readonly').catch(() => null);
      if (ro === null) {
        await inp.scrollIntoViewIfNeeded().catch(() => {});
        await inp.click({ force: true }); await inp.fill(value);
        console.log(`  ✓ ${labelText}(input) → ${value}`); return true;
      }
    }
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(12000);
  page.on('console', msg => { if (msg.type() === 'error' && msg.text().includes('信息说明')) console.log(`[业务错误] ${msg.text().substring(0, 300)}`); });

  try {
    // ===== 1. 登录 =====
    console.log('\n=== 1. 登录 ===');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await wait(page, 2000);
    await page.locator('input[placeholder*="请选择法人"]').first().click();
    await wait(page, 800);
    await page.locator('.el-select-dropdown__item').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('.el-select-dropdown__item').first().click();
    await page.locator('input[placeholder*="用户名"]').first().fill('701994');
    await page.locator('input[placeholder*="密码"]').first().fill('1');
    await page.locator('button:has-text("登 录"), button:has-text("登录")').first().click();
    try { await page.waitForURL('**/home**', { timeout: 30000 }); } catch { await wait(page, 3000); }
    console.log('✓ 登录成功');
    await wait(page, 1500);
    await dismissOverlays(page);
    await page.keyboard.press('Escape'); await wait(page, 500);

    // ===== 2. 导航 =====
    console.log('\n=== 2. 导航到对公客户管理 ===');
    await page.locator('nav.navbar ul.menu-wrapper li.menu-item:has-text("客户管理")').first().click({ force: true });
    await wait(page, 1200);
    await page.evaluate(() => document.querySelector('.navbar__mask')?.remove()).catch(() => {});
    await page.locator('.submenu-wrapper:visible').getByText('对公客户管理', { exact: true }).click({ force: true });
    await wait(page, 2500);
    console.log('✓ 导航成功');

    // ===== 3. 点击新增 =====
    console.log('\n=== 3. 点击新增 ===');
    for (let i = 0; i < 20; i++) {
      if (await page.locator('button:has-text("新增")').first().isVisible().catch(() => false)) {
        await page.locator('button:has-text("新增")').first().click({ force: true });
        console.log('✓ 点击新增'); break;
      }
      await wait(page, 1000);
    }
    await wait(page, 1500);
    await dismissOverlays(page);

    // ===== 4. 填写基础信息 =====
    console.log('\n=== 4. 填写基础信息 ===');
    await fillInput(page, '客户名称', '李淼一有限责任公司', 0);
    await fillInput(page, '客户名称', '李淼一有限责任公司', 1);
    await clickSelect(page, '客户状态', '信贷正式客户');
    await clickSelect(page, '对公客户类型', '集体经济组织');
    await clickSelect(page, '证件类型', '证券业务许可证');
    await fillInput(page, '证件号码', CERT_NO);

    // ===== 5. 保存 =====
    console.log('\n=== 5. 保存基础档案 ===');
    await page.locator('button:has-text("保存")').first().click({ force: true });
    console.log('✓ 点击保存');
    await wait(page, 5000);

    // 检查结果
    const saveMsg = page.locator('.el-message:visible, .el-notification:visible, .el-message-box:visible').first();
    if (await saveMsg.isVisible().catch(() => false)) {
      const msg = (await saveMsg.textContent()).replace(/\s+/g, ' ').trim();
      console.log('提示:', msg.substring(0, 200));
      if (msg.includes('成功')) { console.log('✅ 保存成功！'); }
      else if (msg.includes('已存在') || msg.includes('重复')) {
        console.log('⚠ 客户已存在，需更换证件号码');
        await page.keyboard.press('Escape'); await wait(page, 500);
        // 更换证件号码
        await fillInput(page, '证件号码', '9XYZ2026LMY05190002');
        await page.locator('button:has-text("保存")').first().click({ force: true });
        console.log('✓ 再次保存');
        await wait(page, 5000);
      }
    }

    const fc = await page.locator('.el-form-item').count();
    console.log('字段数:', fc);

    if (fc > 50) {
      // ===== 6. 详情页填写 =====
      console.log('\n=== 6. 填写地址与财务信息 ===');
      await dismissOverlays(page);
      await clickSelect(page, '国别', '中华人民共和国');
      await fillInput(page, '外文名称', 'Li Miaoyi LLC');

      // 地址级联
      const addrItems = await page.locator('.el-form-item').all();
      for (const item of addrItems) {
        const label = await item.locator('.el-form-item__label').textContent().catch(() => '');
        if (label && (label.includes('地址') && !label.includes('邮政') && !label.includes('Email') && !label.includes('实际') && !label.includes('登记注册'))) {
          const cascader = item.locator('.el-cascader').first();
          if (await cascader.isVisible().catch(() => false)) {
            await cascader.click({ force: true }); await wait(page, 800);
            const menus = page.locator('.el-cascader-menu:visible');
            if (await menus.first().isVisible().catch(() => false)) {
              const fi = menus.first().locator('.el-cascader-node');
              for (let i = 0; i < await fi.count(); i++) { if ((await fi.nth(i).textContent().catch(() => '')).includes('湖南')) { await fi.nth(i).click(); console.log('  ✓ 湖南'); break; } }
              await wait(page, 600);
              if (await menus.count() > 1) { const si = menus.nth(1).locator('.el-cascader-node'); for (let i = 0; i < await si.count(); i++) { if ((await si.nth(i).textContent().catch(() => '')).includes('长沙')) { await si.nth(i).click(); console.log('  ✓ 长沙'); break; } } }
              await wait(page, 600);
              if (await menus.count() > 2) { const ti = menus.nth(2).locator('.el-cascader-node'); for (let i = 0; i < await ti.count(); i++) { if ((await ti.nth(i).textContent().catch(() => '')).includes('娄底')) { await ti.nth(i).click(); console.log('  ✓ 娄底'); break; } } }
            }
            break;
          }
        }
      }

      await fillInput(page, '行政区划名称', '111123');
      await fillInput(page, '登记注册地址', '111123');
      await fillInput(page, '经度', '132.34');
      await fillInput(page, '纬度', '31.2');
      await fillInput(page, '财务部联系人', '李四');
      await fillInput(page, '财务部联系人手机号码', '13308463344');

      // ===== 7. 工商登记 =====
      console.log('\n=== 7. 工商登记信息 ===');
      const drawer = page.locator('.el-drawer__body:visible').first();
      if (await drawer.isVisible().catch(() => false)) { await drawer.evaluate(el => el.scrollTop = el.scrollTop + 600).catch(() => {}); await wait(page, 400); }
      await clickSelect(page, '投资主体', '法人投资');
      await fillInput(page, '成立日期', '2020-01-01');
      await fillInput(page, '注册登记日期', '2020-01-15');
      await fillInput(page, '登记注册失效日期', '2040-01-15');
      await fillTextarea(page, '主营业务范围描述', '软件开发');
      await fillTextarea(page, '经营范围', '软件开发，金服系统');

      // ===== 8. 引入个人客户 =====
      console.log('\n=== 8. 引入个人客户 ===');
      await dismissOverlays(page);
      if (await drawer.isVisible().catch(() => false)) { await drawer.evaluate(el => el.scrollTop = 0).catch(() => {}); await wait(page, 400); }
      let introClicked = false;
      for (let i = 0; i < 20; i++) {
        if (await page.locator('button:has-text("引入")').first().isVisible().catch(() => false)) {
          await page.locator('button:has-text("引入")').first().click({ force: true }); introClicked = true;
          console.log('✓ 引入'); break;
        }
        if (await drawer.isVisible().catch(() => false)) { await drawer.evaluate(el => el.scrollTop = el.scrollTop + 200).catch(() => {}); }
        await wait(page, 800);
      }
      if (!introClicked) { await ss(page, 'error-intro'); throw new Error('未找到引入按钮'); }
      await wait(page, 2000);

      const dlgs = await page.locator('.el-dialog:visible').all();
      const dlg = dlgs.length > 0 ? dlgs[dlgs.length - 1] : null;
      if (dlg && await dlg.isVisible().catch(() => false)) {
        console.log('  弹窗可见');
        const noInp = dlg.locator('input[placeholder*="编号"]').first();
        if (await noInp.isVisible().catch(() => false)) { await noInp.click({ force: true }); await noInp.fill('26050610365798406'); console.log('  ✓ 客户编号'); }
        const nmInp = dlg.locator('input[placeholder*="名称"], input[placeholder*="姓名"]').first();
        if (await nmInp.isVisible().catch(() => false)) { await nmInp.click({ force: true }); await nmInp.fill('朱桂武'); console.log('  ✓ 朱桂武'); }
        const certItems = await dlg.locator('.el-form-item').all();
        for (const ci of certItems) {
          const ciL = await ci.locator('.el-form-item__label').textContent().catch(() => '');
          if (ciL && ciL.includes('证件类型')) {
            await ci.locator('input').first().click({ force: true }); await wait(page, 800);
            const idOpts = await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').all();
            for (const o of idOpts) { if ((await o.textContent().catch(() => '')).includes('身份证')) { await o.click(); console.log('  ✓ 居民身份证'); break; } }
            break;
          }
        }
        const certNo = dlg.locator('input[placeholder*="证件"]').first();
        if (await certNo.isVisible().catch(() => false)) { await certNo.click({ force: true }); await certNo.fill('110101198606047887'); console.log('  ✓ 证件号码'); }
        await wait(page, 800);
        const qBtn = dlg.locator('button:has-text("查询"), button:has-text("搜索")').first();
        if (await qBtn.isVisible().catch(() => false)) { await qBtn.click({ force: true }); console.log('  ✓ 查询'); }
        await wait(page, 2500);
        const rows = dlg.locator('.el-table__body-wrapper tr.el-table__row');
        if (await rows.count() > 0) { await rows.first().click({ force: true }); console.log('  ✓ 第1行'); }
        await wait(page, 500);
        const cfmBtn = dlg.locator('button:has-text("确认"), button:has-text("确定")').first();
        if (await cfmBtn.isVisible().catch(() => false)) { await cfmBtn.click({ force: true }); console.log('  ✓ 确认'); }
        await wait(page, 1500);
      }

      // ===== 9. 联网核查与保存 =====
      console.log('\n=== 9. 联网核查与保存 ===');
      await dismissOverlays(page);
      const vBtn = page.locator('button:has-text("联网核查")').first();
      if (await vBtn.isVisible().catch(() => false)) { await vBtn.click({ force: true }); console.log('✓ 联网核查'); await wait(page, 2500); }
      else console.log('  ⚠ 未找到联网核查');
      const finBtn = page.locator('button:has-text("保存"), button:has-text("提交")').first();
      if (await finBtn.isVisible().catch(() => false)) { await finBtn.click({ force: true }); console.log('✓ 保存'); }
      await wait(page, 3000);
      const ft = page.locator('.el-message:visible').first();
      if (await ft.isVisible().catch(() => false)) { console.log('提示:', (await ft.textContent()).replace(/\s+/g, ' ').trim().substring(0, 120)); }
    } else {
      console.log('⚠ 仍在新增抽屉(字段数=' + fc + ')，保存可能失败');
      await ss(page, 'still-in-drawer');
      // 打印所有错误
      const errs = await page.locator('.el-form-item__error:visible, .el-message:visible, .el-notification:visible, .el-message-box:visible').all();
      for (const e of errs) { console.log('错误:', (await e.textContent()).replace(/\s+/g, ' ').trim().substring(0, 200)); }
    }

    await ss(page, 'final-result');
    console.log('\n✅ 测试完成');
  } catch (err) {
    console.error(`\n❌ 阻塞: ${err.message}`);
    await ss(page, 'error-blocked');
  } finally {
    await wait(page, 20000);
    await browser.close();
  }
})();
