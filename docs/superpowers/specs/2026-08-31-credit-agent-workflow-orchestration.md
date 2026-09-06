# 信贷系统（天阳 v5p2）Agent 工作流编排设计

- 日期：2026-08-31
- 依据：`docs/superpowers/research/2026-08-31-credit-sut-framework-research.md`（同日实地调研）
- 范围：Python 侧 browser-use 型 Agent（`scripts/`）在天阳信贷系统上的**录制与操作工作流编排**；先设计定稿，实现分批落地

## 一、设计目标

把 Agent 在该系统上的操作从「通用页面推理」升级为「信贷领域定型编排」：页面形态只有四种（列表页 / 编辑抽屉 / 选择器弹窗 / 向导审批页），导航链、表单链、数据链分别按定型策略编排，LLM 只在值填充与异常兜底上做自由推理。

## 二、四类定型工作流（编排核心）

### W0 登录工作流（Login，实测全自动可行）

```
[登录页探测] → [法人 el-select（mousedown 展开 + listitem click）] → [native setter 填账号/密码] → [验证码两栏留空] → [登录 click] → [token+home 探针]
```

- **实测（2026-08-31，退出重登验证）**：测试环境图形验证码与手机验证码均不强制校验，全留空直接登录成功。
- 法人下拉与业务 el-select 同构：readonly input + mousedown 展开 + 可见 listitem 点选。
- 登录成功探针：`localStorage._usertoken` 出现 + hash 变为 `#/home`。
- 环境开关：prompt/cue 中注明「生产环境验证码大概率强制」——登录自动化仅对测试环境启用，遇生产配置转人工。

### W1 导航工作流（Navigate）

```
[登录态检查] → [mega菜单 click 展开] → [flyout 项 click] → [页签 chip 校验] → [列表页就绪探针]
```

- 复用现有 `click_menu_xpath` 合成动作链；新增**收起守卫**：进入新页面前对面板外做一次真实 mousedown（JS_FIND_MENU_DISMISS_POINT 已沉淀，直接挂到信贷场景 cue）。
- 页签泛滥守卫：`VISITEDVIEWS` 已有页签优先激活（mousedown+click `tag-item`），不重复开页签；单次任务页签上限 N（建议 6），超限先关闭最旧非 affix 页签。
- 就绪探针：目标列表页的面包屑文本（`当前位置：A/B/C`）+ 表头列名双重校验，替代固定 sleep。

### W2 列表查询工作流（List-Query）

```
[label→input 定位] → [native setter 填查询条件] → [查询按钮(tsscBtn)] → [结果行校验] → [radio 单选] → [动作按钮]
```

- 查询区**无 el-form 包裹**：`scan_form` 需按「label 文本 + 相邻 input」配对，禁用 form 分组假设（改造点 A，见 §四）。
- 结果为 0 时进入兜底链：清条件→放宽条件→报告「无数据」而非继续盲操作。
- 行定位：命中 `el-table--mini` 可见行（过滤 fixed column 副本：取 `offsetParent !== null` 的那份）。

### W3 编辑抽屉工作流（Drawer-Edit）

```
[新增/修改 click] → [el-drawer 挂载探测 aria-label] → [抽屉内字段扫描] → [逐字段填充] → [保存] → [结果校验/抽屉收起确认]
```

- 复用 overlay 判定（`_is_overlay_region` / tasklist_scan_mode 限容器）——信贷系统新增/编辑全是 `tssc-drawer`，正好落在既有 overlay 抽屉逻辑内。
- 字段默认值语义：抽屉预填（如客户状态=信贷预客户）**视为已确认值**，LLM 不得擅自改默认值（cue 规则）。
- 日期字段：取 `localStorage.businessDate` 为「今天」基准（改造点 B）；不得填晚于营业日期的值。
- OCR识别/上传类按钮：cue 直接禁入（守卫列表）。

### W4 选择器弹窗工作流（Picker-Confirm）

```
[触发按钮(选择客户/引入)] → [el-dialog 挂载探测 aria-label] → [查询条件填入] → [查询] → [表格 radio 单选] → [确认] → [回填校验（源表单字段被填充）]
```

- 这是信贷系统特有的「数据链」形态（授信选客户、用信引授信、押品选客户），**值得做专用 js_snippet**：一段 JS 完成「dialog 探测→条件填写→查询→首行单选→确认→回填校验」并返回结构化结果（改造点 C）。
- 失败语义显式：查询 0 行 / 确认后回填字段仍为空 = 失败，上报不重试。

### W5 向导审批工作流（Wizard-Approve，二期）

```
[待办进入 workflow/detail] → [逐步 保存/下一步] → [末步审批意见 + 通过/退回] → [完成校验]
```

- 每步之间用表单内容截图做 phase-shot；审批意见由 LLM 按业务上下文生成，但**通过/退回按钮必须 LLM 显式声明意图后由引擎二次确认**（不可逆动作守卫，与 save 守卫同规格）。

## 三、阶段化录制编排（Phase 划分建议）

以「对公客户建档→授信申请」全链路录制为例：

| Phase | 内容 | Reviewer 门禁 |
|---|---|---|
| P0 预检 | 未登录则走 W0 自动登录；登录态/剩余登录时间>20min/营业日期读取/法人确认 | 硬门禁，失败即停 |
| P1 导航 | 菜单链到「对公客户管理」 | 面包屑+表头双探针 |
| P2 建档 | 列表查询(冲突检测：证件号码查重)→新增抽屉→保存草稿 | 抽屉收起+列表刷新出现新行 |
| P3 评级/授信 | 切页签→新增对公授信管理→W4 选客户→表单 | 选择器回填校验 |
| P4 提交 | 保存/提交→流程轨迹出现首节点 | 轨迹文本断言 |
| P5 收尾 | 页签清理+状态组截图归档 | — |

## 四、落地改造点（按优先级）

| # | 改造 | 位置 | 说明 |
|---|---|---|---|
| A | scan_form 支持无 form 查询区配对 | `scripts/controller/actions/js_snippets/scan_form.py` + `form_scan_actions.py` | label↔input 邻近配对兜底 |
| B | 营业日期感知 | 新增 `js_snippets` 读 `localStorage.businessDate` + prompt 规则「日期默认=营业日期」 | 消除日期默认值错填 |
| C | W4 选择器一键 snippet | `js_snippets` 新增 `picker_confirm.py` | dialog 探测→查询→单选→确认→回填校验，一次注入 |
| D | 页签管理 snippet | `js_snippets` 新增 `workspace_tabs.py`：列出/激活/关闭页签（`tag-item`） | 导航编排原子化 |
| E | 会话/弹窗守卫 cue | `scripts/prompts/` 录制 cue：剩余登录时间<20min 告警；「修改密码/营业日期切换/身份识别」全局弹窗出现即上报暂停 | 隐藏弹窗误触防护 |
| F | fixed-column 可见性过滤 | `page-locator-helpers.js`（生成链源头改，再 re-generate `_locator_helpers_js.py`） | 可见性过滤已有则补断言 |
| G | 业务术语词典 | prompts 附录：客户状态/授信/用信/借据/受托支付等术语→页面位置映射 | LLM 值推理质量 |

> 约束：C/D/E/F 均遵守「JS 片段唯一定义在 `scripts/controller/actions/js_snippets/*`」与生成物禁手改约定；涉及 `page-locator-helpers.js` 的改动走 `node scripts/_gen_locator_helpers_py.mjs` 重新生成，并跑 `characterize-xpath-three-sources.mjs` 护栏。

## 五、风险与边界（显式不做）

- 验证码：**测试环境实测不拦截，登录全自动**（W0）；生产环境如强制校验则不做突破，转人工/转授权编码。
- 会话 50min：编排层检测倒计时，不做自动续期。
- 文件上传（OCR识别/影像资料）：二期专项，一期禁入。
- 不可逆业务动作（放款、批复通过、删除）：一律「LLM 声明意图→引擎确认→执行→回读校验」四步，缺一不可。
