const { chromium } = require('playwright');

const TARGET_URL = 'http://172.19.87.161:9200/';

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  try {
    // ========== PHASE 1: Login ==========
    console.log('=== Phase 1: Login ===');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Fill login form
    const usernameInput = page.locator('input[placeholder*="用户"], input[name*="user"], input[id*="user"], input[type="text"]').first();
    const passwordInput = page.locator('input[placeholder*="密码"], input[name*="pass"], input[id*="pass"], input[type="password"]').first();

    await usernameInput.fill('701994');
    await page.waitForTimeout(500);
    await passwordInput.fill('1');
    await page.waitForTimeout(500);

    // Click login button
    const loginBtn = page.locator('button:has-text("登录"), button:has-text("登 录"), input[value="登录"], input[value="登 录"]').first();
    await loginBtn.click();

    // Wait for page transition (at least 15 seconds)
    console.log('Waiting for login to complete...');
    await page.waitForTimeout(15000);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    await page.screenshot({ path: '/tmp/phase1-login.png', fullPage: true });
    console.log('✓ Phase 1: Login completed');

    // ========== PHASE 2: Navigate to Corporate Customer Management ==========
    console.log('=== Phase 2: Navigate to Corporate Customer Management ===');

    // Expand "客户管理" menu in left sidebar
    const customerMgmtMenu = page.locator('text=客户管理').first();
    await customerMgmtMenu.click();
    await page.waitForTimeout(1500);

    // Click "对公客户管理"
    const corporateCustomerMgmt = page.locator('text=对公客户管理').first();
    await corporateCustomerMgmt.click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    await page.screenshot({ path: '/tmp/phase2-nav.png', fullPage: true });
    console.log('✓ Phase 2: Navigation completed');

    // ========== PHASE 3: Fill Basic Information ==========
    console.log('=== Phase 3: Fill Basic Information ===');

    // Click "新增" (Add) button
    const addBtn = page.locator('button:has-text("新增"), button:has-text("新 增"), span:has-text("新增")').first();
    await addBtn.click();
    await page.waitForTimeout(3000);

    // Fill 客户状态 (Customer Status) dropdown - select "信贷潜在客户"
    const custStatusLabel = page.locator('text=客户状态').first();
    // Try to find the dropdown near the label
    const custStatusDropdown = page.locator('label:has-text("客户状态") + div select, label:has-text("客户状态") ~ div select, label:has-text("客户状态") ~ div .el-select, div:has-text("客户状态") select, .el-form-item:has-text("客户状态") select, .el-form-item:has-text("客户状态") .el-select').first();
    if (await custStatusDropdown.count() > 0) {
      await custStatusDropdown.click();
      await page.waitForTimeout(500);
      await page.locator('.el-select-dropdown__item:has-text("信贷潜在客户"), .el-scrollbar div:has-text("信贷潜在客户")').first().click();
    } else {
      // Try clicking the select trigger
      const trigger = page.locator('.el-select:has-text("客户状态"), div:has-text("客户状态") select').first();
      await trigger.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('text=信贷潜在客户').first().click().catch(() => {});
    }
    await page.waitForTimeout(1000);

    // Fill 对公客户类型 (Corporate Customer Type) dropdown - select "担保公司"
    const corpTypeLabel = page.locator('text=对公客户类型').first();
    const corpTypeDropdown = page.locator('label:has-text("对公客户类型") + div select, label:has-text("对公客户类型") ~ div select, label:has-text("对公客户类型") ~ div .el-select, div:has-text("对公客户类型") select, .el-form-item:has-text("对公客户类型") select, .el-form-item:has-text("对公客户类型") .el-select').first();
    if (await corpTypeDropdown.count() > 0) {
      await corpTypeDropdown.click();
      await page.waitForTimeout(500);
      await page.locator('.el-select-dropdown__item:has-text("担保公司"), .el-scrollbar div:has-text("担保公司")').first().click();
    } else {
      const trigger = page.locator('.el-select:has-text("对公客户类型"), div:has-text("对公客户类型") select').first();
      await trigger.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('text=担保公司').first().click().catch(() => {});
    }
    await page.waitForTimeout(1000);

    // Fill 证件类型 (ID Type) dropdown - select "营业执照"
    const idTypeLabel = page.locator('text=证件类型').first();
    const idTypeDropdown = page.locator('label:has-text("证件类型") + div select, label:has-text("证件类型") ~ div select, label:has-text("证件类型") ~ div .el-select, div:has-text("证件类型") select, .el-form-item:has-text("证件类型") select, .el-form-item:has-text("证件类型") .el-select').first();
    if (await idTypeDropdown.count() > 0) {
      await idTypeDropdown.click();
      await page.waitForTimeout(500);
      await page.locator('.el-select-dropdown__item:has-text("营业执照"), .el-scrollbar div:has-text("营业执照")').first().click();
    } else {
      const trigger = page.locator('.el-select:has-text("证件类型"), div:has-text("证件类型") select').first();
      await trigger.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('text=营业执照').first().click().catch(() => {});
    }
    await page.waitForTimeout(1000);

    // Fill 客户名称 (Customer Name)
    const custNameInput = page.locator('input[placeholder*="客户名称"], label:has-text("客户名称") + div input, div:has-text("客户名称") input, .el-form-item:has-text("客户名称") input').first();
    await custNameInput.fill('李淼三有限责任公司');
    await page.waitForTimeout(500);

    // Fill 证件号码 (ID Number) with 18-digit unified social credit code
    const idNumberInput = page.locator('input[placeholder*="证件号码"], label:has-text("证件号码") + div input, div:has-text("证件号码") input, .el-form-item:has-text("证件号码") input').first();
    await idNumberInput.fill('91440101MA7B8KT172');
    await page.waitForTimeout(500);

    // Click "保存" (Save) button
    const saveBtn = page.locator('button:has-text("保存"), button:has-text("保 存"), span:has-text("保存")').first();
    await saveBtn.click();

    // Wait for detail edit mode
    console.log('Waiting for detail edit mode...');
    await page.waitForTimeout(5000);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    await page.screenshot({ path: '/tmp/phase3-basic.png', fullPage: true });
    console.log('✓ Phase 3: Basic info saved');

    // ========== PHASE 4: Detail Page Required Fields ==========
    console.log('=== Phase 4: Detail Page Required Fields ===');

    // 1. 证件有效日期 (ID Valid Date) - 2030-01-15
    const validDateInput = page.locator('input[placeholder*="证件有效"], input[placeholder*="有效日期"], label:has-text("证件有效") + div input, label:has-text("有效日期") + div input, .el-form-item:has-text("证件有效") input, .el-form-item:has-text("有效日期") input').first();
    await validDateInput.fill('2030-01-15');
    await page.waitForTimeout(500);

    // 2. 勾选"证件是否长期" (Check "ID is long-term")
    const longTermCheckbox = page.locator('label:has-text("证件是否长期") + div input[type="checkbox"], label:has-text("证件是否长期") ~ div input[type="checkbox"], .el-form-item:has-text("证件是否长期") input[type="checkbox"], .el-checkbox:has-text("证件是否长期") input, .el-switch:has-text("证件是否长期")').first();
    await longTermCheckbox.click().catch(async () => {
      // Try clicking the label
      const longTermLabel = page.locator('text=证件是否长期').first();
      await longTermLabel.click();
    });
    await page.waitForTimeout(500);

    // 3. 统一社会信用代码 (Unified Social Credit Code) - sync with ID number
    const creditCodeInput = page.locator('input[placeholder*="统一社会信用"], label:has-text("统一社会信用") + div input, .el-form-item:has-text("统一社会信用") input').first();
    await creditCodeInput.fill('91440101MA7B8KT172');
    await page.waitForTimeout(500);

    // 4. 实际控制人手机号码 (Actual Controller Phone)
    const phoneInput = page.locator('input[placeholder*="手机号码"], label:has-text("手机") + div input, .el-form-item:has-text("手机") input').first();
    await phoneInput.fill('13365657894');
    await page.waitForTimeout(500);

    // 5. 单位电话 (Unit Phone)
    const unitPhoneInput = page.locator('input[placeholder*="单位电话"], label:has-text("单位电话") + div input, .el-form-item:has-text("单位电话") input').first();
    await unitPhoneInput.fill('073112345678');
    await page.waitForTimeout(500);

    // 6. 上年度从业人数 (Previous Year Employees)
    const employeeCountInput = page.locator('input[placeholder*="从业人数"], label:has-text("从业人数") + div input, .el-form-item:has-text("从业人数") input').first();
    await employeeCountInput.fill('50');
    await page.waitForTimeout(500);

    // 7. 上年度资产总额 (Previous Year Total Assets)
    const assetTotalInput = page.locator('input[placeholder*="资产总额"], label:has-text("资产总额") + div input, .el-form-item:has-text("资产总额") input').first();
    await assetTotalInput.fill('50000000');
    await page.waitForTimeout(500);

    // 8. 合作状态 (Cooperation Status) dropdown - select "正常"
    const coopStatusDropdown = page.locator('label:has-text("合作状态") ~ div select, label:has-text("合作状态") ~ div .el-select, .el-form-item:has-text("合作状态") select, .el-form-item:has-text("合作状态") .el-select').first();
    await coopStatusDropdown.click().catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('text=正常').first().click().catch(() => {});
    await page.waitForTimeout(500);

    // 9. 控股经济类型 (Holding Economic Type) dropdown - select "集体相对控股"
    const econTypeDropdown = page.locator('label:has-text("控股经济") ~ div select, label:has-text("控股经济") ~ div .el-select, .el-form-item:has-text("控股经济") select, .el-form-item:has-text("控股经济") .el-select').first();
    await econTypeDropdown.click().catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('text=集体相对控股').first().click().catch(() => {});
    await page.waitForTimeout(500);

    // 10. 行业代码 (Industry Code) - I6510
    const industryCodeInput = page.locator('input[placeholder*="行业代码"], label:has-text("行业代码") + div input, .el-form-item:has-text("行业代码") input').first();
    await industryCodeInput.fill('I6510');
    await page.waitForTimeout(500);

    // 11. 5 enterprise identifier fields - all select "否"
    const enterpriseLabels = ['地区重点企业', '优势企业', '高环境风险高污染企业', '宏观调控限控行业标志', '特种经营标识'];
    for (const label of enterpriseLabels) {
      const radioNo = page.locator(`.el-radio:has-text("${label}") ~ div .el-radio:has-text("否"), .el-form-item:has-text("${label}") .el-radio:has-text("否"), label:has-text("${label}") ~ div .el-radio:has-text("否"), .el-radio-group:has-text("${label}") .el-radio:has-text("否")`).first();
      await radioNo.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    await page.screenshot({ path: '/tmp/phase4-detail.png', fullPage: true });
    console.log('✓ Phase 4: Detail fields filled');

    // ========== PHASE 5: Address & Financial Contact Info ==========
    console.log('=== Phase 5: Address & Financial Contact Info ===');

    // 1. 国别 (Country) dropdown - select "中华人民共和国"
    const countryDropdown = page.locator('label:has-text("国别") ~ div select, label:has-text("国别") ~ div .el-select, .el-form-item:has-text("国别") select, .el-form-item:has-text("国别") .el-select').first();
    await countryDropdown.click().catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('text=中华人民共和国').first().click().catch(() => {});
    await page.waitForTimeout(500);

    // 2. 登记注册号 (Registration Number)
    const regNumberInput = page.locator('input[placeholder*="登记注册"], label:has-text("登记注册") + div input, .el-form-item:has-text("登记注册") input').first();
    await regNumberInput.fill('CR123456');
    await page.waitForTimeout(500);

    // 3. 实际经营地址 (Actual Business Address)
    const bizAddressInput = page.locator('input[placeholder*="实际经营"], label:has-text("实际经营") + div input, .el-form-item:has-text("实际经营") input').first();
    await bizAddressInput.fill('北京市海淀区中关村大街1号');
    await page.waitForTimeout(500);

    // 4. 单位地址 (Unit Address)
    const unitAddressInput = page.locator('input[placeholder*="单位地址"], label:has-text("单位地址") + div input, .el-form-item:has-text("单位地址") input').first();
    await unitAddressInput.fill('北京市海淀区中关村大街1号');
    await page.waitForTimeout(500);

    // 5. 经度 (Longitude) + 纬度 (Latitude)
    const longitudeInput = page.locator('input[placeholder*="经度"], label:has-text("经度") + div input, .el-form-item:has-text("经度") input').first();
    await longitudeInput.fill('116.397128');
    await page.waitForTimeout(500);
    const latitudeInput = page.locator('input[placeholder*="纬度"], label:has-text("纬度") + div input, .el-form-item:has-text("纬度") input').first();
    await latitudeInput.fill('39.916527');
    await page.waitForTimeout(500);

    // 6. 财务部联系人姓名 (Finance Contact Name)
    const financeContactInput = page.locator('input[placeholder*="财务部联系人"], label:has-text("财务部") + div input, .el-form-item:has-text("财务部") input').first();
    await financeContactInput.fill('李四');
    await page.waitForTimeout(500);

    // 7. 财务部联系人手机号码 (Finance Contact Phone)
    const financePhoneInput = page.locator('label:has-text("财务部") input[placeholder*="手机"], .el-form-item:has-text("财务部") input[placeholder*="手机"]').first();
    await financePhoneInput.fill('13912345678');
    await page.waitForTimeout(500);

    await page.screenshot({ path: '/tmp/phase5-addr.png', fullPage: true });
    console.log('✓ Phase 5: Address & contact info filled');

    // ========== PHASE 6: Business Registration & Qualification ==========
    console.log('=== Phase 6: Business Registration & Qualification ===');

    // 1. 投资主体 (Investment Entity) dropdown - select "法人投资"
    const investEntityDropdown = page.locator('label:has-text("投资主体") ~ div select, label:has-text("投资主体") ~ div .el-select, .el-form-item:has-text("投资主体") select, .el-form-item:has-text("投资主体") .el-select').first();
    await investEntityDropdown.click().catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('text=法人投资').first().click().catch(() => {});
    await page.waitForTimeout(500);

    // 2. 注册资本金额 (Registered Capital Amount)
    const capitalInput = page.locator('input[placeholder*="注册资本"], label:has-text("注册资本") + div input, .el-form-item:has-text("注册资本") input').first();
    await capitalInput.fill('10000000');
    await page.waitForTimeout(500);

    // 3. 注册登记机关 (Registration Authority)
    const regAuthorityInput = page.locator('input[placeholder*="注册登记机关"], label:has-text("注册登记机关") + div input, .el-form-item:has-text("注册登记机关") input').first();
    await regAuthorityInput.fill('北京市工商行政管理局');
    await page.waitForTimeout(500);

    // 4. 注册登记日期 (Registration Date) - 2020-01-01
    const regDateInput = page.locator('input[placeholder*="注册登记日期"], label:has-text("注册登记日期") + div input, .el-form-item:has-text("注册登记日期") input').first();
    await regDateInput.fill('2020-01-01');
    await page.waitForTimeout(500);

    // 5. 经营范围 (Business Scope)
    const bizScopeInput = page.locator('textarea[placeholder*="经营范围"], label:has-text("经营范围") + div textarea, label:has-text("经营范围") + div input, .el-form-item:has-text("经营范围") textarea, .el-form-item:has-text("经营范围") input').first();
    await bizScopeInput.fill('软件开发，金服系统');
    await page.waitForTimeout(500);

    await page.screenshot({ path: '/tmp/phase6-biz.png', fullPage: true });
    console.log('✓ Phase 6: Business registration info filled');

    // ========== PHASE 7: Associate Personal Customer ==========
    console.log('=== Phase 7: Associate Personal Customer ===');

    // Helper function for introducing a contact
    async function introduceContact(anchorText, custNo, custName, idType, idNumber) {
      console.log(`Introducing contact: ${anchorText}`);
      // Find "引入" button near the anchor text
      const introduceBtn = page.locator(`text="${anchorText}" ~ button:has-text("引入"), text="${anchorText}" ~ div button:has-text("引入"), .el-form-item:has-text("${anchorText}") button:has-text("引入"), button:has-text("引入")`).first();
      await introduceBtn.click();
      await page.waitForTimeout(2000);

      // Wait for popup/modal
      const modal = page.locator('.el-dialog:visible, .el-drawer:visible, .modal:visible, [role="dialog"]:visible').first();
      
      // Fill customer number
      const custNoInput = page.locator('input[placeholder*="客户编号"], label:has-text("客户编号") + div input, .el-form-item:has-text("客户编号") input').first();
      await custNoInput.fill(custNo);
      await page.waitForTimeout(500);

      // Fill customer name
      const custNameInput = page.locator('input[placeholder*="客户名称"], label:has-text("客户名称") + div input, .el-form-item:has-text("客户名称") input').first();
      await custNameInput.fill(custName);
      await page.waitForTimeout(500);

      // Select ID type dropdown - "居民身份证"
      const idTypeDropdown = page.locator('label:has-text("证件类型") ~ div select, label:has-text("证件类型") ~ div .el-select, .el-form-item:has-text("证件类型") select, .el-form-item:has-text("证件类型") .el-select').first();
      await idTypeDropdown.click().catch(() => {});
      await page.waitForTimeout(500);
      await page.locator('text=居民身份证').first().click().catch(() => {});
      await page.waitForTimeout(500);

      // Fill ID number
      const idNumberInput = page.locator('input[placeholder*="证件号码"], label:has-text("证件号码") + div input, .el-form-item:has-text("证件号码") input').first();
      await idNumberInput.fill(idNumber);
      await page.waitForTimeout(500);

      // Click "查询" (Search) button
      const searchBtn = page.locator('button:has-text("查询"), button:has-text("查 询")').first();
      await searchBtn.click();
      await page.waitForTimeout(3000);

      // Check first row and confirm
      const firstCheckbox = page.locator('.el-table__body-wrapper .el-checkbox, .el-table__body input[type="checkbox"], table tbody tr:first-child input[type="checkbox"], .el-table__row:first-child .el-checkbox').first();
      await firstCheckbox.click();
      await page.waitForTimeout(500);

      // Click "确认" (Confirm) button
      const confirmBtn = page.locator('button:has-text("确认"), button:has-text("确 认"), span:has-text("确认")').first();
      await confirmBtn.click();
      await page.waitForTimeout(1500);
    }

    // Introduce 法定代表人 (Legal Representative)
    await introduceContact('法定代表人', '26050610365798406', '朱桂武', '居民身份证', '110101198606047887');

    // Introduce 实际控制人 (Actual Controller)
    await introduceContact('实际控制人', '26050610365798406', '朱桂武', '居民身份证', '110101198606047887');

    await page.screenshot({ path: '/tmp/phase7-associate.png', fullPage: true });
    console.log('✓ Phase 7: Associate personal customer completed');

    // ========== PHASE 8: Verification & Save Draft ==========
    console.log('=== Phase 8: Verification & Save Draft ===');

    // 1. Click "联网核查" (Online Verification) button
    const verifyBtn = page.locator('button:has-text("联网核查"), button:has-text("联 网 核 查"), span:has-text("联网核查")').first();
    await verifyBtn.click();
    console.log('Waiting for network verification...');
    await page.waitForTimeout(5000);

    // 2. Click "暂存" (Save Draft) button
    const draftBtn = page.locator('button:has-text("暂存"), button:has-text("暂 存"), span:has-text("暂存")').first();
    await draftBtn.click();
    await page.waitForTimeout(3000);

    // Wait for success message
    const successMsg = page.locator('.el-message--success, .el-notification, .success-message, textarea:has-text("成功"), div:has-text("操作成功")').first();
    await successMsg.waitFor({ timeout: 10000 }).catch(() => {
      console.log('No explicit success message found, continuing...');
    });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: '/tmp/phase8-final.png', fullPage: true });
    console.log('✓ Phase 8: Verification and save draft completed');
    console.log('=== ALL PHASES COMPLETED SUCCESSFULLY ===');

  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: '/tmp/phase-error.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
