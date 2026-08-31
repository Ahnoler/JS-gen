# 被测系统实地调研：天阳信贷统一门户（test.creditv5p2）

- 日期：2026-08-31
- 方式：ZCode 内置浏览器实地登录遍历（账号 701994 / 黄某某 / 客户经理 / 法人 XX农村商业银行有限公司 / 租户 9881）
- 目的：为 Python 侧 browser-use 型 Agent 提升浏览器操作能力，摸清网页框架设计与信贷业务流程
- 配套编排设计：`docs/superpowers/specs/2026-08-31-credit-agent-workflow-orchestration.md`

## 一、系统概览

| 项 | 事实 |
|---|---|
| 系统 | 天阳科技「信贷统一门户」（天阳宏业），低代码平台「天元」+ 微前端组装 |
| 环境 | `http://test.creditv5p2.tansun.com.cn/`（hash 路由 SPA，无 iframe 页面） |
| 登录 | 法人下拉（el-select，7 个法人）→ 用户名/密码 → 图形验证码（img）→ 手机验证码 → 登录；**实测测试环境两种验证码均不强制校验，全留空即可登录成功**（仅法人+账号+密码即通过，2026-08-31 退出重登验证） |
| 技术栈 | Vue2（`#app.__vue__`）+ Element UI（medium/mini 尺寸）+ tssc 自定义皮肤 + qiankun 风格微前端 + 天元低代码元数据驱动 |
| 网关 | `/prod-api/tansun-tcp-app-pc/{service}/...`，按域拆服务：`tansun-tcp-cst`（客户）、`tansun-tcp-cucrg`（授信）、`tansun-tcp-ipc`（场景命中）等 |
| 微前端 | `localStorage.microList` 27 个子应用，容器 `#tssc-main-micro`，`activeRule=#/{module}/`；信贷条线子应用集中在 `172.19.87.162:9527`，工作流 `:9630` |
| 会话 | 登录后显示「剩余登录时间」倒计时，实测约 50 分钟；`_usertoken` 在 localStorage |
| 业务日期 | `localStorage.businessDate = 2026-8-19`（滞后于真实日期 12 天）；表单日期默认值来自营业日期而非系统日期 |

## 二、页面框架设计（Agent 视角）

### 2.1 导航层

- **顶部 mega 菜单**：自研 `li.menu-item`（全站 429 项），双行排布 24 个一级模块。二级面板为整幅 flyout，**展开靠 click，收起只能面板外真实 mousedown**（hover/Escape/合成 click 无效——与 JS-gen 菜单切换已沉淀的经验一致）。
- **多页签工作区**：菜单项打开的都是**同一个浏览器标签页内的页签 chip**（`tag-item` class），持久化在 `localStorage.VISITEDVIEWS`（含 backChainPath、affix）。首页页签固定不可关。切页签 = mousedown+click chip。
- **面包屑**：`当前位置：客户管理/客户信息维护/对公客户管理/`。

### 2.2 路由形态（两类页面打开方式）

1. **列表页（菜单直达）**：`/#/{module}/{sub}/{page}Pg?needupdate=yes&part={全路径拼接}`
   例：`/#/cstMgt/csinfMnt/cpctMgt/cpctMgtPg`、`/#/crutMgt/corpCrutAply/corpCrutAplyMgtPg`。
2. **上下文页（带业务参数跳转）**：列表点行内客户名称按钮 → 360 视图，URL 携带完整天元编码 + 业务主键：
   `/#/cstMgt/cst360Vw/.../FS00008308CstmgrExmCst360Vw?cmptEcd=ZJJK00066153&fcnScnEcd=FS00008308&resource=avyEcd=UML00091259&cstNo=...&crdtNo=...&openMode=addTag&tagName=查看对公客户360视图`
3. **审批页**：待办「处理」→ `/#/cstMgt/workflow/detail?bsnPk=PMS20260723036387&viewType=edit&fcnScnEcd=FS00001448&nodeCode=UML00005985&tagName=...`

天元编码体系三件套贯穿所有跳转：**组件 cmptEcd（ZJJK…）/ 功能场景 fcnScnEcd（FS…）/ 场景活动 avyEcd·resource（UML…）**。这与 JS-gen 菜单切换沉淀的「菜单ID=umlEcd ≠ 页面ID=pdCmptEcd」完全对应。

### 2.3 组件体系（内容区全部 Element UI + tssc 皮）

| 模式 | 实现 | Agent 要点 |
|---|---|---|
| 列表页查询区 | `el-input`/`el-select`（placeholder 统一「请输入」「请选择」），**无 el-form 包裹**（对公客户管理页 `el-form=0`） | 不能按 form 分组定位；按列布局 label+input 相邻定位 |
| 操作按钮排 | `button.el-button` + 图标 `span.tsscBtn`（查询/重置/新增/修改/查看/撤销/流程轨迹…） | tsscBtn 是图标按钮，无文本 |
| 数据表格 | `el-table--mini` + `el-table--border` + fixed 左右列（DOM 中拆成 3 个 table 元素：主体+左固定+右固定）；选择列为 **radio 单选**（表头「单选」）；另有字典色点 `i.dictcolorround` | 行点击目标在 fixed column 时存在两份 DOM，须选可见那份；行内客户名称是 `button` |
| 分页 | `el-pagination`（10条/页 select + 前往 spinbutton） | 共 278 户 28 页 |
| **新增/编辑表单** | **`el-drawer`（`tssc-drawer`，rtl 右滑，width 50%）为主**，非 el-dialog。例：对公客户新增 = 「新增客户校验」抽屉（客户状态/对公客户类型/证件类型+OCR识别/客户名称/证件号码 + 保存/取消） | JS-gen 的 overlay 抽屉判定（`_is_overlay_region`）已覆盖此形态 |
| 选择器弹窗 | `el-dialog`（如「选择对公授信客户」：查询表单+el-table+单选+查询/重置/取消/确认） | 典型「先查询再单选后确认」三段式 |
| 向导式审批 | workflow detail 页内 **保存/下一步/返回** 分步表单 | 审批意见通常在最后一步 |
| 全局隐藏弹窗 | 修改密码 / 营业日期切换 / 智能机器人 / 天元相关配置（常驻 DOM、隐藏） | 快照/扫描须过滤隐藏容器，否则误报 |
| 证件识别 | 新增抽屉内「OCR识别」按钮（el-upload 类交互） | 文件上传是 Agent 已知禁区/需专项处理 |

### 2.4 框架级坑位清单（Agent 高频翻车点）

1. **验证码字段存在但不拦截**：测试环境图形/手机验证码均可留空直接登录——**登录可全自动化**（法人下拉展开靠 mousedown 事件合成）；生产环境大概率强制校验，Agent 登录自动化按环境开关处理。
2. **会话 50 分钟倒计时**：长录制会中途失效；Agent 应监测「剩余登录时间」并在低值时告警。
3. **营业日期滞后（2026-8-19）**：所有日期默认值/校验以营业日期为准，填今日日期可能被校验拒绝（「不能超过营业日期」类）。
4. **mega 菜单收起机制**：只能面板外真实 mousedown。
5. **placeholder 高度雷同**（请输入/请选择）：必须 label→input 关联定位，JS-gen 已支持。
6. **fixed column 双份 DOM**：xpath 命中不可见副本会静默失败。
7. **路由 query 巨长**（360 视图 20+ 参数）：不能靠 URL 重放到达页面，必须走 UI 导航链。
8. **字典缓存** `vue_Tansun_dict`：下拉选项来自前端缓存字典，选项文本与数据库字典不一定同步。

## 三、信贷业务流程（实测菜单树 + 页面动作）

### 3.1 主流程链（对公）

```
客户建档 → 评级 → 授信申请 → 授信批复 → 额度管控 → 用信申请 → 用信批复
   → 合同签订 → 放款申请 → 放款 → 还款/贷后 → (不良) 催收/资产保全
```

各环节入口页面与关键动作（实测）：

| 环节 | 模块（module） | 页面 | 动作按钮 |
|---|---|---|---|
| 客户建档 | cstMgt | 对公客户管理 | 查询/重置/**新增**/修改/查看/联网核查/法院信息/影像资料；客户状态：草稿客户→信贷预客户→信贷正式客户 |
| 评级 | rtgMgt | 对公客户评级（+同业/集团/查询） | 列表同构 |
| 授信 | crgMgt | 新增/变更对公授信管理、对公授信批复 | **选择客户**（弹窗）→查询/新增/修改/查看/撤销/流程轨迹 |
| 额度 | lmtMgt | 额度冻结/解冻/调账、限额、查询族 | 状态变更类操作 |
| 用信 | crutMgt | 对公用信申请 | **引入**（从授信拉数据）/查询/新增/修改/删除/查看/撤销/流程轨迹 |
| 合同 | ctrMgt | 对公/对私合同管理（待签订→已签订）、担保合同 | 签订流转 |
| 放还款 | lendRepyMgt | 对公放款申请/零售放款申请、提前还款、受托支付、借据查询 | 放款/还款流转 |
| 贷后 | pstloanMgt | 首次/常规贷后检查、分类认定、风险分类 | 检查任务+认定 |
| 催收 | collMgt | 催收任务/策略/评分卡/登记台账 | 催收流转 |
| 押品 | cltlMgt | 押品信息、估值、权证出入库、不动产登记 | 评估流程 |
| 审批 | wf（:9630） | 待办任务（工作台+任务事项）、流程跟踪、信审会 | 处理→向导式审批页 |
| 查询 | cprsvEnqr | 客户/额度/用信/押品台账查询族 | 只读 |

### 3.2 关键业务状态机（实测观察）

- 客户：`草稿客户`（新增抽屉保存后）→（走正式流程）`信贷预客户` → `信贷正式客户`；客户分类 60=对公。
- 用信列表可见「业务发生类型/发起模式/流程状态」，同一用信可多次发生（借据维度）。
- 一切业务变更走工作流：列表页「流程轨迹」+ 工作台待办（【广西对私用信流程】等），审批页 URL 由 `bsnPk`（如 PMS20260723036387）+ `nodeCode` 决定节点。

### 3.3 测试数据现状

- 278 户对公客户（28 页），近几日由测试者高频创建「测试科技发展有限公司·草稿客户」——**草稿态新增-丢弃是安全的调研路径**。
- 实测账号黄某某名下待办 10+ 条（权限申请/用信流程/评估费用等），可用于审批流演练。

## 四、对 Agent 操作能力的启示（结论）

1. **页面形态收敛为四种**：列表页 / 新增编辑抽屉 / 选择器弹窗 / 向导审批页。编排按这四种定型，不逐页适配。
2. **导航链必须走 UI**：菜单 click→flyout click→页签 chip 管理；JS-gen 的 click_menu_xpath 链路可直接复用。
3. **表单填写主战场在 el-drawer 内**：overlay 判定、native setter、el-select selectOption 等既有沉淀全部适用；差异点是查询区无 el-form 包裹。
4. **数据链贯穿靠选择器弹窗**：授信选客户、用信引授信，都是「查询→单选→确认」三段，值得做专用 snippet。
5. **日期语义=营业日期**：Agent 填日期前应读取 `localStorage.businessDate` 而非 `new Date()`。
6. **验证码不拦截（测试环境）**：登录全自动可行；真正的自动化边界是会话 50 分钟、文件上传（OCR识别/影像资料）与不可逆业务动作。
