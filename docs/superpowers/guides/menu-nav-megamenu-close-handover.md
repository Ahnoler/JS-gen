# 交接：执行引擎菜单导航后子菜单（mega-menu 面板）不收起 — 排查与修复配方

> 2026-09-10 · JS-gen 引擎线整理，供执行引擎（同事侧）修复参考。
> 现象：菜单导航点击后，门户顶栏的子菜单面板（mega-menu）展开后**再也不收起**，盖住页面上沿，遮挡后续截图与顶部区域点击。
> 结论先行：**不是"没渲染就点击"**（那只导致点空/导航失败），根因在"关闭机制"——本被测系统的菜单**只认面板外的真实（trusted）mousedown**，合成事件怎么都关不掉。

---

## 一、被测系统菜单的实测机制（真机单变量验证）

验证方式：`probe-menu-close-v2.py`（附录 A，一次只变一个变量，在 CDP 19242 活页面实测）。定案：

| 操作 | 效果 |
|---|---|
| 合成 `el.click()` 点菜单项 | **能展开**子菜单（开面板合成事件就够） |
| 真实 hover 移开面板 | **不收起** |
| Escape 键 | **不收起** |
| JS 合成 click / dispatchEvent（isTrusted=false）点面板外 | **不收起** |
| **面板外空白点的真实 mousedown**（CDP/Playwright 可信事件） | **收起 ✅** |

推理链：回放引擎若全程用 JS 合成事件点击，则整场录制**一次真实 mousedown 都不会发生** → 面板展开后永不关闭 → 与现象完全吻合。

## 二、排查四步（按锁定速度排序）

1. **查点击实现**（大概率真凶）：点菜单用的是 `el.click()`/`dispatchEvent`（合成）还是 Playwright/Selenium 常规 click / CDP `Input.dispatchMouseEvent`（可信）？合成→见上表，需补"关闭尾巴"。
2. **活页面单变量探针复测**：拿附录 A 脚本连活页面，逐个验证①hover 移开②Escape③合成点击④真实 mousedown，确认关闭信号与本系统一致。
3. **查点的目标元素**：本系统是**双菜单 DOM**——二级菜单 `li[data-id]` 恒隐藏（display:none，386/410 条占 94%），可见 flyout 链接是 `li.submenu-item[data-url]`。JS 合成点击能点中隐藏节点（不受 visibility 限制），但可能点在不可见分支上，导航成了、面板状态没走对。若用常规点击工具点 `li[data-id]` 则 94% 的二级菜单直接定位不到（这就是之前同事反馈"定位不到"的根因，见 `tmp/menu_crawl/verify-report.md`）。
4. **浏览器控制台**看 Vue 告警/JS 报错（点击处理器抛异常会让关闭监听没挂上）。

## 三、修复配方（已真机验证，可直接移植）

点击菜单后补一次"**安全空白点真实 mousedown**"收尾。三件套：

### ① JS 找安全收起点（JS_FIND_MENU_DISMISS_POINT）

`scripts/controller/actions/js_snippets/page_id.py:190`。要点：
- 从视口下沿往上按比例布候选点（fx×fy 网格），逐点 `document.elementFromPoint`；
- 命中 `body/html` 最优，纯容器标签（div/span/p/main/section/…）次之；
- **排除交互元素**：`a,button,input,select,textarea,label,li,tr,td,th,[role=button],[onclick],.el-button,.el-dropdown,.el-table,.el-dialog,.el-drawer,.el-date-picker,.el-select,.el-cascader`（表格行点击会改选中态）；
- **排除弹窗遮罩**：存在可见 `.v-modal / .el-overlay / .el-dialog__wrapper` 时直接返回 null（遮罩上点击会误关弹窗）→ 调用方跳过收起，不影响主流程；
- 无安全点返回 null。

### ② 发真实 mousedown（trusted 事件通道）

`scripts/controller/actions/_replay.py:194` `_dismiss_menu_overlay`：

```python
pt = await page.evaluate(JS_FIND_MENU_DISMISS_POINT)
if pt:
    await page.mouse.move(pt['x'], pt['y'], steps=3)
    await page.mouse.down()
    await page.wait_for_timeout(30)   # down/up 间隔 30ms
    await page.mouse.up()
```

- Playwright 用 `page.mouse.*`；裸 CDP 用 `Input.dispatchMouseEvent`（mousePressed + mouseReleased，同一坐标，间隔 30ms，button='left', clickCount=1）。
- **禁止**用 JS `dispatchEvent(new MouseEvent(...))` 模拟——isTrusted=false，实测无效。
- 整段 best-effort（try/except 静默），收起失败不阻断主流程。

### ③ 点击后沉降等待

菜单点击后 `wait 600ms` 再走下一步（`_replay.py:222`）；且 `JS_CLICK_MENU_XPATH`（`page_id.py:164`）**点击前在 JS 内轮询等元素出现（34×300ms）**，兜住"登录后菜单尚未渲染"的时机问题——注意这只解决"点空"，不解决"不收起"。

### 参考调用序列（我们引擎的 click_menu_xpath 直派回放）

```
result = page.evaluate(JS_CLICK_MENU_XPATH, xpath)   # 轮询+DOM click
_dismiss_menu_overlay(page)                          # 安全点真实 mousedown 收面板
page.wait_for_timeout(600)                           # 沉降
```

## 四、速查：三条易踩坑（本系统实证）

1. **二级菜单定位**：可见分支用 `//li[@data-url='/cstMgt/...']`（或点一级后等 flyout 渲染再点 `li.submenu-item`）；`li[data-id]` 是恒隐藏节点，"要求元素可见"的工具点不到。
2. **关闭**：只认面板外真实 mousedown（见 §一表）。
3. **渲染时机**：点击前 JS 内轮询等元素（≈10s 上限），不要写死 sleep。

---

## 附录 A：单变量探针脚本（可直接复用）

`tmp/probe-menu-close-v2.py`（本仓）。要点：连 `http://127.0.0.1:<CDP端口>` 活页面 → 用合成 el.click() 重新打开面板 → ①按住 mousedown 不 up → 看是否收起 ②完整 down+up → 看是否收起；对每个可见"菜单文案"实例输出祖先类链（向上 5 层 tag.class）区分数面板实例，避免计数被 tags-view 标签/面包屑污染。v1 结论（hover/Escape 无效）与 v2 结论（真实 down+up 收起）都出自它。

## 附录 B：本仓代码坐标（供同事对照阅读）

| 内容 | 位置 |
|---|---|
| 安全点选取 JS | `scripts/controller/actions/js_snippets/page_id.py:190`（JS_FIND_MENU_DISMISS_POINT） |
| 菜单点击 JS（轮询+el.click） | `scripts/controller/actions/js_snippets/page_id.py:164`（JS_CLICK_MENU_XPATH） |
| 真实 mousedown 收起 | `scripts/controller/actions/_replay.py:194`（_dismiss_menu_overlay） |
| click_menu_xpath 直派分支 | `scripts/controller/actions/_replay.py:216` |
| 双菜单 DOM 实证报告 | `tmp/menu_crawl/verify-report.md`（410 条 xpath 真机复核） |
