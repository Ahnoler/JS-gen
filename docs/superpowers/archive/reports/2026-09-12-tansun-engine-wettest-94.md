# §9.4 人机分工湿测收官报告（tansun_ui_engine 兼容实装验收）

- 日期：2026-09-12
- 执行：ZCode 引擎线（主会话 + 用户人机分工）
- 被测：tansun_ui_engine（branch compat/js-gen-operations）六 type / 18 操作映射，A 档=同事 handler JS 原样派发
- SUT：test.creditv5p2.tansun.com.cn 信贷系统（Element UI / Vue）
- 结论：**20 项全部 PASS**（六 type 全覆盖 + click 八子路径中的八个全命中），湿测中发现并双侧修复 1 个 P1 数据变更缺陷，完成 1 项前端可见性变更

## 一、人机分工协议执行情况

- 用户负责：登录、页面导航、业务语义判读（性别校验拦截、隐私保护机制两处关键判读均由用户给出）
- ZCode 负责：按快照定位 → 原样派发同事 handler JS（MCP evaluate，`(args) => handler(args)` 包装）→ 业务证据回读判 PASS/FAIL
- 严格串行、evaluate 只读派发；数据变更操作均经用户授权（写入类只到 Vue model 层，未点「保存/提交」类真变更按钮）

## 二、20 项证据表

| # | 操作 | type | 页面/形态 | 判据（业务证据） | 结果 |
|---|------|------|-----------|------------------|------|
| 01 | radio 表格单选 | radio | 表格行内单选 | 选中态 + Vue model | PASS |
| 02 | 点击：修改 | click | 列表行按钮 | 编辑弹窗弹出 | PASS |
| 03 | 填写：英文名 | input | 表单文本框 | native setter + model 回读 | PASS |
| 04 | 填写：全字段 | input | 多类型输入 | 逐字段回读 | PASS |
| 05 | date 单日期 | date | 表单日期 | ok-date + model 回读 | PASS |
| 06 | 选择：字典 | select:click | 下拉字典 | option 命中（澳大利亚） | PASS |
| 07 | 树选：行业 | select:tree | 树选择器 | 节点选中 + model | PASS |
| 08 | 页签：切换 | click | workspace tabs | 面板切换 | PASS |
| 09 | 邻钮：点击 | click | 输入框相邻按钮 | 按钮生效 | PASS |
| 10 | 弹窗查询 | input | 放大镜弹窗 | 命中后发起查询 | PASS |
| 11 | 弹窗选择行 | select:click | 弹窗表格行 | 行选中（张波） | PASS |
| 12 | 确认引入回填 | click | 弹窗确认 | 4 禁用字段回填 | PASS |
| 13 | 关闭弹窗 | click | 弹窗关闭 | 取 消 命中无保存 | PASS |
| 14 | tssc 字典形态 | select:click | .tsscdatepicker 系字典 | 5 字典项命中 | PASS |
| 15 | tssc 远程表格形态 | select:click | .select-table 远程 | 精确→contains-shortest 收敛 | PASS |
| 16 | 表格：行/按钮 | click | 行内按钮 | 行钉住→按钮命中（发现 CLOSEBTN 缺陷） | PASS |
| 17 | 单选：表单 radio | radio | 表单单选组 | label JS 切换 | PASS |
| 18 | 展开树 | click | 展开树 | 61 点击 5 轮收敛，388 节点 0 剩余 | PASS |
| 19 | 菜单：个人客户管理 | click | 双菜单 DOM | 跨模块跳页，恒隐藏 LI.submenu-item 命中 | PASS |
| 20 | date daterange | date | 查询日期区间 | ok-date-range，三层回读一致 | PASS |

证据文件（JSON + 截图）：`tmp/tansun-wet/`（本仓 gitignore 本地）= `C:\Users\water\AppData\Local\Temp\tansun-wet\`，每项 JSON 含 engineSource file:line、派发方式、业务回读、lessons。

## 三、湿测发现与修复（WET-2026-0912-CLOSEBTN）

- **缺陷**：Element UI 样式化按钮「取 消」「确 定」含内部空格，引擎 `norm()`（\s+→' '）不剔除内部空白，取消匹配失败后落到第二候选「确 定」——**关闭弹窗变保存**（P1 数据变更风险）
- **双侧修复**：
  - 引擎 `click_subroutes.py` JS_CLOSE_VISIBLE_DIALOG 加 `flat()`（norm+剔全部空白再比较）+ 回归 pin test，commit **873d534**（280 passed）
  - JS-gen 源头 `scripts/controller/actions/js_snippets/close_dialog.py` 同修复，commit **b4b832e0**（用户明确授权解禁；非 raw 字符串故正则写 `\\s`）
- 实机复验：真机「取 消」命中、无新 updateCard 写入

### WET-2026-0912-DATEPANEL（用户复看截图时追问发现）

- **现象**：daterange 填值后日期面板不关闭，残留的双月日历盖在日志表格上方；用户追问「你的 daterange 不会自动关闭日期选择弹框吗」
- **根因**（实证链）：① 截图 `20-daterange-filled.png` 面板可见；② 实时探针 `el-picker-panel el-date-range-picker el-popper` 仍 `visuallyVisible=true`，且 `inlineDisplay` 已被抹回空、`is-hidden` 类消失；③ 组件状态探针 `vm.pickerVisible===true`。即 `closePanels()` 只改 DOM 样式，未触碰组件状态，Element 的 popper 按自身状态重绘时把 `display:none` 覆盖回去——样式压制对 Vue 重渲染无效
- **影响**：面板残留会遮住后续步骤的点击目标（真实用户点的第一下被 Element 的 clickoutside 吃掉），是回放链的跨步风险；单日期路径同病根（第 05 项证据 `knownCosmetic` 已记录同一残留观察）
- **修复**：加 `closePickerVm()` 状态级关闭（walk 到 ElDatePicker/TsscMultiDatePicker vm → `pickerVisible=false`，回落 `handleClose()`），单日期与 daterange 两分支的 blur 之后调用，原样式压制保留为兜底
  - 引擎 `ui_execute/engine/actions/date_action.py` + pin test，commit **013a67d**（pytest 281 passed；4 个 error 为 test_agent_e2e.py 缺浏览器可执行文件的环境问题，改动前后一致）
  - JS-gen 源头 `scripts/controller/actions/js_snippets/fill_date.py`（单日期路径同在），commit **b9694d1b**
- **真机复验**（修复后集成 JS，值换 `2026-08-01 - 2026-08-31`）：返回 `ok-date-range`；t0/500ms/2000ms 三次采样 `panelVisible=false`、`pickerVisible=false`（2 秒不被重新拉起），三层值一致 `["2026-08-01","2026-08-31"]`；证据 `20b-daterange-panel-closed-fix.png`
- **验证边界**：JS-gen 单日期路径的独立真机复验待做（本页无单日期控件；逻辑与引擎修复逐行同源，且关闭机制已在同一 SUT/同一 Element 版本上真机证明）——下次落到带单日期的页面（如对公客户修改详情页「成立日期」）顺手复验

## 四、前端可见性变更（用户指令）

- `src/models/meta-step-actions.js` 移除 `expand_all_el_tree`（commit **4adcf94e**）：展开树从 meta 步骤转为普通业务步骤——前端步骤列表可见+计入 stepCount、录制时 action_persisted 实时推送、回放时作为必做业务步（保树展开保真度）
- 三消费点语义核验：trajectory-step-service:30（列表过滤）/persist-live:269（直播抑制）/trajectory-session-replay:213（回放必含）
- 有意不动：LOCATOR_EXEMPT_ACTIONS（复合动作无单一目标）、_SKIP_SCREENSHOT_ACTIONS、rerun SKIP_REPLAY
- verify-all 3 红经 stash 对照=存量红非回归（step-highlight/layer-tree/export-v3）

## 五、湿测关键经验（供联调与后续录制）

1. **双菜单 DOM**：二级菜单恒隐藏 `LI.submenu-item[data-url]`，可见性点击必败；引擎 `hiddenSubmenuItem` 白名单 + `el.click()` 恰好覆盖（19 项实证）
2. **放大镜隐私保护**：客户名称为空时不发查询请求（用户判读）；须先填名称
3. **业务层校验实证**：配偶性别≠法定代表人被 SUT 拒绝——自动化已触达业务校验层的正面证据
4. **tssc 双形态共存**：同页面板同时渲染字典项与 .select-table；TsscMultiSelect model 存显示文本非代码值（与 ElSelect 存 code 相反）
5. **Element 内部噪声**：daterange 合成 change 触发 handleStart/EndChange 内部 TypeError，被 Vue 吞掉不影响三层结果；真机录制遇同报错属 Element 已知噪声非引擎缺陷
6. **展开树收敛判据**：is-leaf 在 expand-icon 上非节点 class；完整判据=无 is-expanded 且 expand-icon 非 is-leaf 可见

## 六、遗留与移交

1. **推送侧缺口**：expand_all_el_tree 录制步骤 locator=null（32578e3d 遗留），V3 payload.py:333-334 primaryLocator 硬校验会拒——推送链元素抓取须与引擎联调窗口一并安排
2. 联调前置项：引擎侧 pytest 280 passed 为本报告验收基线；后续 L2 端到端全链湿测（登录→导航→业务链）在 L1 收官后安排
3. 分支处置：tansun_ui_engine compat/js-gen-operations 与 JS-gen uara_V1.2 待用户+同事评审后推送/合并
4. 9000001715 湿测数据残留（登录线遗留）仍待清
