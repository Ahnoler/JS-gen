# Reviewer 审批请求：JS-gen 侧三笔改动（§9.4 湿测产出）

> 用途：提交给 reviewer 审批。范围＝ JS-gen 仓（uara_V1.2）三笔代码改动，均在本地未推送。
> 提出时间：2026-09-12 · 提出方：ZCode 引擎线（§9.4 人机分工湿测执行方）

## 一、请求审批的三笔改动

| # | commit | 文件 | 一句话 |
|---|--------|------|--------|
| 1 | `b4b832e0` | `scripts/controller/actions/js_snippets/close_dialog.py` | 关闭弹窗的按钮文案比对剔除全部空白 |
| 2 | `4adcf94e` | `src/models/meta-step-actions.js` | `expand_all_el_tree` 移出 META_STEP_ACTIONS，前端可见 |
| 3 | `b9694d1b` | `scripts/controller/actions/js_snippets/fill_date.py` | 日期面板改为状态级关闭 |

### 1. `b4b832e0` close_dialog「取 消」匹配失败会把关闭弹窗变成保存（P1 数据变更）

- **问题**：SUT 的按钮用样式空格排版（「取 消」「确 定」）。原实现 `norm()` 只把连续空白压成一个空格，不剔内部空白，于是「取 消」匹配不上「取消」，落到候选表第二项「确 定」——**关闭弹窗的动作实际点了保存**。
- **改法**：比对前加 `flat() = norm() + 剔除全部空白`，`flat('取 消') === flat('取消')` 成立。仅影响匹配口径，不改点击目标选择顺序。
- **证据**：引擎侧同源修复 `873d534`（含回归 pin，pytest 280 passed）；真机复验命中的是「取 消」，且无新 updateCard 写入（即未触发保存）。湿测编号 WET-2026-0912-CLOSEBTN。
- **授权**：用户在本轮明确指示修 JS-gen 源头缺陷（原话「JS-gen 源头的缺陷，你也修复吧」）。

### 2. `4adcf94e` expand_all_el_tree 移出 meta，转为前端可见的业务步骤

- **背景**：该动作原先列在 `META_STEP_ACTIONS`，被三处消费点按 meta 对待，前端步骤列表看不到它。
- **改法**：从集合移除一项。语义随之变化有三处，均为本次期望：
  1. `trajectory-step-service.js`（`whereNotIn('action_type', META)`）→ 产品步骤列表可见、计入 stepCount；
  2. `persist-live.js`（`isMetaStepAction` → 抑制 action_persisted 广播）→ 录制时实时推送该步；
  3. `trajectory-session-replay.js`（`whereIn(META)` 自动纳入 meta 检查点）→ 回放中成为必做业务步，保住展开树的保真度。
- **有意不动**：`LOCATOR_EXEMPT_ACTIONS`（复合动作无单一目标）、`_SKIP_SCREENSHOT_ACTIONS`、rerun 的 `SKIP_REPLAY`（重建失败现场不需要展开树）。
- **授权**：用户指示（原话「既然是推送步骤的话，请你还是在前端展示吧」）。
- **验证**：`characterize-meta-step-filter` / `characterize-trajectory` OK；`verify-all` 3 项红经 `git stash` 对照判定为**存量红**（step-highlight / layer-tree / export-v3），与本改动无关；pre-commit eslint 通过。
- **注意**：新录轨迹立即生效；数据库里已有轨迹行本身不带 meta 过滤，历史数据无需回填。

### 3. `b9694d1b` 日期面板状态级关闭（同 WET-2026-0912-DATEPANEL）

- **问题**：原实现只对面板做 DOM 样式压制（`display:none` + `is-hidden`），组件 `vm.pickerVisible` 仍为 true，Element 的 popper 按自身状态重绘时把压制覆盖回去 → **面板残留**，会盖住后续步骤的点击目标（真实点击被 Element 的 clickoutside 吃掉，属回放链跨步风险）。用户复看第 20 项截图时发现。
- **改法**：新增 `closePickerVm()`，walk 到 ElDatePicker / TsscMultiDatePicker 实例后置 `pickerVisible = false`（回落 `handleClose()`），原样式压制保留为兜底。
- **证据**：引擎侧同源修复 `013a67d`（含 pin，pytest 281 passed）；真机复验 t0/500ms/2000ms 三次采样面板均关闭、未被重新拉起，三层值（input 显示 / vm.value / form.model）一致。
- **授权说明（需 reviewer 注意）**：这一笔是我在用户追问后自行判断「源头同病根一并修」落地的，**未经用户逐字点名**（前一笔 close_dialog 是用户点名）。已单独 commit，回退成本＝一次 revert。请 reviewer 在批准时一并确认这个边界是否可接受。

## 二、请 reviewer 重点裁决的三个点

1. **`flat()` 的匹配口径是否过宽**：flat 后 `t.indexOf(flat(w)) !== -1` 是包含匹配，极端情况下「确 定取消」这类复合文案可能被「取消」命中。当前 SUT 未出现该形态，是否需要收紧为「先精确、后包含」的两段式？
2. **`expand_all_el_tree` 转业务步的连带影响**：回放时该步从「自动纳入的 meta 检查点」变成「必做业务步」，若某个历史轨迹录制时该步失败，回放是否应整体失败（当前会）？这是期望行为还是需要降级策略？
3. **日期面板状态级关闭对 tssc 日期组件的影响**：`closePickerVm` 的 vm 名匹配用 `/date/i`，会覆盖 `TsscMultiDatePicker`；本仓湿测只在 ElDatePicker（单日期 + daterange）上真机验证过，tssc 日期控件的真机复验尚未做。

## 三、已知边界（不阻塞审批，但需备案）

- JS-gen 单日期路径（第 3 笔）的**独立真机复验待做**：当页无单日期控件；关闭机制已在同一 SUT / 同一 Element 版本上真机证明，逻辑与引擎修复逐行同源。下次落到带单日期的页面（如对公客户修改详情页「成立日期」）补验。
- 三笔改动均**未推送**（内网 DNS 限制，与其余各线提交一起攒批）。
- 本仓特征化脚本未钉这三处源码片段（已核查 `scripts/characterization/` 无 `is-hidden` / `closePanels` / `flat(` 相关断言），故无 pin 需同步更新。

## 四、测试与验证口径

- 引擎侧 pytest：`281 passed`（4 个 error 属 `test_agent_e2e.py` 缺浏览器可执行文件的环境问题，改动前后一致）
- JS-gen 侧：`characterize-meta-step-filter`、`characterize-trajectory` OK；`verify-all` 与 HEAD 对照无新增红
- 真机证据：`tmp/tansun-wet/`（20 项湿测 JSON + 截图，含本题第 3 笔的 `20b-daterange-panel-closed-fix.png`）
- 收官报告：`docs/superpowers/reports/2026-09-12-tansun-engine-wettest-94.md`
