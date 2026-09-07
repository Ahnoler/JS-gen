# 登录演练任务

目标：在当前登录页用页面可见表单完成一次真实登录，成功后停留在系统首页。

## 步骤

1. 用 `get_page_state()` 确认当前是登录页（存在账号、密码输入框与登录按钮）。
2. 用 `scan_visible_fields()` 扫描登录表单，定位账号与密码字段的 label。
3. 用 `fill_form_field` 填入账号 `__AUTH_USERNAME__`，再用 `fill_form_field` 填入密码 `__AUTH_PASSWORD__`（native setter 提交，不要用 input_text）。两个 fill 可同批输出。账号密码只使用上述占位符注入的值，**禁止尝试其他任何账号或密码**。
   **禁止使用复合 `login` 动作**——必须按 `fill_form_field`（账号）→ `fill_form_field`（密码）→ `real_click(text=登录)` 逐步执行，保证录制出可回放的细粒度步骤。
4. 单独一步用 `real_click(text=登录)` 真实点击登录按钮；不要用 click_element 提交。
5. 等待跳转（`wait_for_loading()`），再用 `get_page_state()` 验证已进入系统首页（登录表单不再可见）。

## 纪律

- 凭据只来自占位符 `__AUTH_USERNAME__` / `__AUTH_PASSWORD__` 注入的值，禁止尝试其他账号或猜测密码。
- 若页面出现验证码/短信验证码：不要猜测或绕过，立即以 `done(text, success=false)` 如实报告「出现验证码，无法自动登录」并退出。
- 登录失败（错误提示、仍在登录页）时如实报告失败原因，**不得伪造成功**、不得重试超过 2 次。
- 只操作登录表单内的元素，不要点击任何与登录无关的链接、菜单或弹窗。
- 每个改状态动作后验证预期效果是否出现，不以「没报错」为判定。
