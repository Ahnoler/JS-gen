---
name: req-doc-to-kb
description: >-
  模块级需求分册导入 KB 作业区：登记 data/kb/req/<moduleKey>、officecli 切片
  chapters + through-chains；逐叶真机湿测（wet-test.md 判定表，match/drift/blocked/
  not-found）；drift 分类回填 chapters；blocked 补测台账；可选 drafts（门槛=match 叶）。
  禁止写 data/kb/flows、禁止 promote。
---

# 需求文档 → KB 作业区

> **生命周期一览**：切片（`sliced`）→ 逐叶湿测（`wet-test.md` 判定表）→ drift 回填 chapters → 可选 drafts（门槛=match 叶，sourceRefs 引湿测叶号）。promote 另线。

> **批量 / Agent Team：** 见同目录 [`USAGE.md`](./USAGE.md)（语料优先级、`moduleKey` 表、Lead 派工与并行规则）。单模块仍按本文步骤执行。

## 何时使用

用户要求导入/切片某模块需求分册、建 req 作业区时。

触发示例：「导入/切片某某模块需求分册」「按需求建模块作业区」；「把 `docs/天阳信贷系统需求文档` 全部需求跑一遍」（→ 先读 USAGE.md）。
## 作业区目录树

登记成功后，模块作业区位于 `data/kb/req/<moduleKey>/`：

```
data/kb/req/<moduleKey>/
├── manifest.json          # 模块元数据与 status
├── source.link.json       # 源文档路径登记
├── chapters/              # 视图1：章节保真（Agent 填）
│   └── *.md
├── through-chains.md      # 视图2：可贯通主链清单
├── wet-test.md            # 视图3：逐叶湿测证据表（湿测阶段填；模板见下文）
└── drafts/                # 可选：流程卡草稿（非正式 flows/）
    └── *.json
```

- `moduleKey`：`^[a-z0-9]+(-[a-z0-9]+)*$`（如 `product-mgmt`）；中文名写在 manifest。
- `manifest.status` 枚举：`registered` | `sliced` | `drafted`（见下文状态流转）。

## 步骤

1. **登记作业区** — `POST /api/v2/kb/req-modules`（或按契约手建目录）。Body：`moduleKey`、`moduleName`、`sourcePath`、可选 `note`。API 不可用时手建目录并注明。
2. **读源** — officecli 读 `sourcePath`；剥 `RQM_META` 噪声；不改源文件。**officecli 全文截断/读失败时按预案降级**（实证：6 批切片 5 批走此路径）：用 browser_use env python（`D:/anaconda3/envs/browser_use/python.exe`）+ python-docx 提取标题/段落/表格、解码 `RQM_MERMAID` base64；临时文件放 `tmp/` 用后清理。
3. **视图1：章节保真** — 填 `chapters/`：按文档目录拆章；含标题路径、ZJJK（若有）、要点摘要；文档口径与 SUT 差异单列「待湿测」。**强制契约**：
   - 每章末尾必须有**机器可解析的清单行**（湿测阶段据此机械提取叶节点清单），**三种合法形态**（第 4 轮修订）：
     - ①标准形态：`ZJJK编号（页面名）`、顿号分隔，兼容斜杠组（`ZJJKa/ZJJKb（名）`，第二编号须带 ZJJK 前缀）；
     - ②无编号分册形态（源册全册无 ZJJK/FS，docx 扫描实证后）：`—（页面名）`、顿号分隔，页名取自正文标题，不编造；模块级 FS 无则显式声明「无」；
     - ③接口分册形态（接口/报文类分册）：以接口号替代 ZJJK 作叶标识，`接口号（交易名）`（如 `1.1.1（额度创建）`）；
   - **表格 ≠ 清单行**：章内 ZJJK 表格/头部注释/「ZJJK 汇总」表不满足契约，必须另立标准清单行；
   - 已知 **FS 场景号 / 路由名**（`fcnScnEcd` / `avyEcd`）必须随章记录（SUT URL 实测新发现的场景号回填补录）；模块 FS 缺失的显式声明「无」而非默认缺省；
   - 按钮/字段文案写明是**文档口径**（SUT 实际文案可能漂移，如文档「提交流程」vs SUT「流程提交」），不要把文档措辞当成 SUT 事实。
   - 文档以「同××」复用而无独立 ZJJK 的页面（如「五类合作方同评估机构」），章内须列明**各复用页名称清单**（无编号），供湿测逐页核查存在性。
4. **视图2：主链清单** — 写 `through-chains.md`：候选主链（闭环目标、步骤、前置、章节出处）；旁路/Out 单列；可建议挂载叶子/functionId。**文件头必须带时效声明**（第 3 轮协议）：`> 时效声明：本文为需求文档口径提炼，叶级真值以同目录 wet-test.md 湿测判定为准；链级修订由 Lead 在模块收口时统一处理。`
5. **可选草稿** — 仅当用户明示「出草稿卡」时写 `drafts/*.json`（`draftFrom: "req"`、`moduleKey`、`sourceRefs`；schema 同正式 flows）。**湿测门槛（2026-09-05 用户拍板）**：草稿卡只允许引用 `wet-test.md` 判定为 `match` 的叶节点；`drift` 叶须先回填 chapters（以 SUT 实测为准）再出卡；`blocked`/`not-found` 叶禁止出卡。**可回溯要求（第 2 轮修订）**：`sourceRefs` 必须引用 `wet-test.md` 叶号——卡上每一步可回溯到湿测证据行。
6. **收工** — 更新 `manifest.status` → `sliced` 或 `drafted`；列章节数、主链条数、草稿数、建议下一湿测主链；收工汇报。

### 状态流转

| status | 含义 |
|--------|------|
| `registered` | 已登记作业区，尚未切片 |
| `sliced` | 已完成 chapters + through-chains |
| `drafted` | 在 sliced 基础上已写 drafts |

> 湿测进度**不进** status 枚举（避免动 characterization pin）：以 `wet-test.md` 存在性及其中 pending 计数为准。

## 湿测（视图3：逐叶真机验证）

> 2026-09-05 用户拍板方针：**逐模块、逐叶节点**跑真机湿测；湿测铁证是出 drafts / promote 的门槛。切片（sliced）完成 ≠ 作业区终态。

### 清单建立

从 `chapters/` 各章末尾的清单行（三形态，见步骤 3）+ `through-chains.md` 提取该模块全部叶节点，按主链分组建 `wet-test.md` 判定表（初始全部 `pending`）。每行：`# | ZJJK/接口号/占行 | 页面名 | 菜单路径（文档口径） | 判定 | 差异/证据`。

**Step 0 入口可达性预检**（第 4 轮修订，2026-09-06 digital-mobile 教训）：移动端/H5/外部系统类模块在**建表前**先探测 SUT 是否有可达入口（菜单树/路由/微前端注册表五层法）——不可达则整模块判 not-found 并写环境补测条件，避免建 93 行 pending 表后逐行空判。

> **存量回补条款**（2026-09-05 rating 首跑发现）：契约升级前切片的模块，章末可能无标准清单行——预备阶段必须逐章校验并回补（格式 `ZJJK编号（页面名）`、顿号分隔；缺页面名的从正文提取，正文没有的不得编造），wet-test.md 头部注明「协议检验注」。
>
> **文档复用页条款**（2026-09-05 customer-corp 发现）：文档以「同××」复用而无独立 ZJJK 的页面（如五类合作方），判定表**不新增编号行**，但运行记录必须逐页记存在性核查结果；SUT 多出的文档未收录页面同记运行记录，回填 chapters 时单列。

### wet-test.md 必含段落（2026-09-05 第 2 轮修订）

判定表之外，尾部「运行记录」节必含：

1. **会话起止 + 判定统计**（match/drift/blocked/not-found 计数）；
2. **跨模块观察**：①console 错误按**错误名归集**（「调用search/diabf/nextBefore结果为false」疑同族=同一前端拦截层，Lead 汇总跨模块台账供引擎线消费）；②与其他模块**相反或不一致**的公共行为对照（如列表自动加载 vs 手动查询）；③SUT 多出的文档未收录页面。

### 判定词表（每行必含日期）

| 判定 | 含义 | 要求 |
|------|------|------|
| `pending` | 尚未测到（建表初始态） | 不允许跨模块收口残留——收口时必须为 0（checker 强制） |
| `match` | 与文档一致 | 写关键实证（字段/按钮/列名清单或与文档差异为空） |
| `drift` | 有差异 | 写明差异类别与明细（见下「drift 分类学」） |
| `blocked` | 数据/权限条件不足，或**写操作黑名单禁止**（提交类叶只读不可达）。**证据形态三子类**（第 4 轮定案）：①黑名单禁止（补测=用户明示的单独提交通道/业务端代提交后经已办核验）；②前端校验拦截（console 报错，可能不阻断 UI）；③静默拦截（无弹窗无 toast 无 console，如「已分配不允许再分配」——规则成立但提示缺失，照实记录） | **写补测条件**（如「待有在途审批流程」）；拦截类必须留异常原文——后端 BizException 抄全文，前端拦截（console 自定义错误如「调用diabf结果为false」）抄 console 原文，静默拦截写明「三无」观察，三者视同同级证据 |
| `not-found` | 菜单/页面在 SUT 不存在 | 写导航尝试路径 |

> **复合叶规则**（2026-09-06 customer-common 叶105 发现）：一个叶号覆盖多个页面/状态（如主页 match 但查看页白屏）时，**按最严重状态判**（match < drift < blocked/not-found），其余状态写进证据列；信息量过大时拆叶。

> **跨视图复用组件口径**（2026-09-06 Lead 拍板）：多视图复用同一 ZJJK（如客户360 头部组件）**一处一行**验证组件本身；某视图表现不同时差异写进该视图分组证据，不另加行。

### 写操作黑名单（共享测试系统安全约束）

湿测**只读验证**：允许打开向导/弹窗、切换步骤、展开折叠区、查询列表；**禁止**一切业务落库动作——确认、提交、保存、作废、删除、撤销、审批同意等一律不点。走到最终确认前一步即止，截图存证后关闭。

### drift 分类学与回流（湿测铁证 > 需求原文）

| 类别 | 例（2026-09-05 credit-corp 实测） | 去向 |
|------|------|------|
| wording 措辞 | SUT「流程提交」≠ 文档「提交流程」 | 回填 chapters，标注「SUT 实测」 |
| behavior 行为 | 主页列表默认不自动加载；放大镜无条件查询返回 search false | 回填 chapters **并**沉淀引擎提示词 cue / KB 卡规则字段（自动化致命坑）。**无记录数据也可验 behavior**：进入页面即核对「列表是否自动加载/查询后加载」，写入证据列。回填时**必须注明与其他模块的对照**（2026-09-05 实证：对公主页默认自动加载 292 条 vs 授信/评级需手动查询——同系统内逐模块相反，不注明对照会被下个模块误当普适规则） |
| validation 校验 | 作废前置=批复下无关联在途/生效用信合同 | KB 卡前置条件字段；后端异常原文留在 wet-test.md |
| structure 结构 | 查看批复页左侧子导航 ≠ 文档「标签页」；任务页文档写「页签」SUT 实为折叠区（customer-corp） | 回填 chapters |
| api-contract 接口 | 报文字段缺失/口径矛盾；**半译码/裸码**（同表已译+未译列混显，如执行状态显「1」）记 observation 不判 wording；**数据错位**（同证件号不同客户名）单列 bug 台账候选 | chapters「待湿测」升级为引擎 cue |

回填 chapters 时**以 SUT 实测为准**，保留原需求口径并标注两源（不得用需求原文覆盖湿测铁证）。

### 执行规则（硬协议）

- **串行**：共享浏览器，模块间也不并行；一次一个模块、一个 SUT 登录窗口（会话倒计时实为**请求续期**——持续操作会自动续期，「约 50 分钟」是挂起态口径，持续湿测的窗口比它长）。
- **大模块两棒接力**（>80 叶模块，2026-09-06 asset 两模块实证）：拆 B1/B2 两棒，B1 完成叶 1~N 在运行记录注明接力点，B2 重派时读已填行了解口径续跑——配合增量写回，回传故障零浪费。
- **同构页批量核验**（postloan-check 150 叶实证）：同链同构页（对私/对公任务页、四链同构向导）首叶全量取证，后续同构叶证据列写「同叶N + 差异点」——150 叶模块靠此单窗口跑完。
- **接口分册湿测指引**（limit-ctrl-api 实证）：无页面叶的接口分册，判定对象=接口在 SUT 的**间接业务痕迹**（额度台账字段/业务页占用余额/关联额度编号）；**SUT「查询交易信息」页（trdlog）存历史报文全量，可一次性建立交易码↔接口映射**（limit-ctrl-api 1031 笔实证）；查询类接口无前端入口判 **blocked**（补测=API 调用通道），不判 not-found（UI 无法证伪接口存在性）。
- **无编号模块定位法**（portal/meeting-mgmt 实证）：浏览器 localStorage 取 Bearer 后 `POST /tansun-tcp-sys/menu` 拉全量菜单树 grep——最硬定位证据（首页【菜单搜索】实为卡片搜索，搜不到菜单树，勿依赖）。
- **Lead 预验账号**（meeting-mgmt 教训）：派发前 Lead 须确认指定角色账号可登录（账号≠角色名；X0023 是角色而非账号，七法人登录全败实锤）。
- 操作纪律：Playwright MCP `snapshot → click` 真点（Element UI 自带 mousedown）；固定列表格遮挡时优先点行内单元格/固定列内元素。
- 证据：截图存 `tmp/kb-wet-test/<moduleKey>/`（tmp 短寿命，**文字证据为准**，截图路径仅作辅助索引）。
- 流程推进类规则（wf 分流、多节点审批路由）**无法只读验证属常态**：判 blocked + 补测条件即可，不视为任务失败（customer-corp wf_cust_005/006 先例）。主链 blocked 时后续链允许**级联引用**（「同叶N」，meeting-mgmt 实证）。
- **机械验收**：模块收口前跑 `node scripts/kb/wet-test-check.mjs <moduleKey>`，FAIL 必须清零（人工抽查仍保留）。checker 支持三形态叶（ZJJK/NOZJJK 占行/IFACE 接口号，按模块门控自动启用）与判定格宽容解析（判定词+子类+日期同格）。

### 草稿卡产出契约（drafts，第 5 轮修订成文；产出前提=用户明示「出草稿卡」）

草稿卡 = 从湿测证据凝练的候选流程卡（`drafts/*.json`，schema 同正式 flows + draft 专有字段）。**门槛**（步骤 5）：steps[] 只允许引用 match/drift 叶（drift 须已回填 chapters）；blocked/not-found 叶**禁止进 steps**，改放 `pendingSteps[]`（每条含 leafRef + reason + retry_condition）。

每张卡必带：
- 顶层：`draftFrom:"req"`、`moduleKey`、`flow`、`aliases`、`menu_path`、`sourceRefs`（wet-test.md 叶号数组）、`coverage:{total,match,drift,blocked,notFound,gate}`；
- `gate` 取值：全 match/drift = `pass`/`full`/`match`；混 blocked = `partial`；**纯 blocked 主链/业务块不产卡**，列名回报并按级联归并；
- 特殊形态①**NOT-FOUND 环境卡**（2026-09-06 digital-mobile 实证）：模块级环境不可达（入口五层探测实证）时，不建 pending 表逐行空判，产单张 `cardType:"NOT-FOUND"` 卡（notFoundReason=探测摘要、retest=环境条件、coverage.gate="not-found-env"）；
- 特殊形态②**接口分册卡**（limit-ctrl-api 实证）：无页面叶，steps 以接口号叶（match=trdlog 报文映射实证）承载，查询类接口无前端入口判 blocked（补测=API 调用通道）不判 not-found；
- 同构 blocked 组归并进 pendingSteps 单条；级联 blocked 用「同叶N」引用；
- 无编号模块 leafRef = wet-test 行号 + 页面名（不用 ZJJK）；
- 产出后自检：逐文件 JSON.parse + steps 零 blocked/not-found 引用 + coverage 计数与判定表对平。

### 晋升管线（drafts → data/kb/flows/，第 5 轮修订成文）

工具：`node scripts/kb/promote_draft.mjs`（默认 dry-run 产出审查表 `tmp/promote-review.md`；`--apply` 写 flows；`--card` 过滤单卡；`tmp/promote-curation.json` = `{new:["module/file.json"]}` 为 Lead 裁决覆盖）。

流程与裁决口径：
1. **dry-run**：gate 白名单（pass/full/match）动态扫描 → 审查表（动作 new/merge、目标文件、nodes/rules 数、同域建议）。
2. **Lead 过表裁决**：同域 merge 仅限**同菜单二级组 + 同业务对象**（一级菜单同 ≠ 同域——2026-09-06 实证 6 条误配降级：委托贷款/社团×2/对私用信×2/提醒配置按「每流程一卡」粒度独立新建）。
3. **--apply**：new 写新卡（文件名冲突加模块前缀）；merge 向既有卡 append nodes/rules/exceptions（page+keyword 去重）。apply 不删 drafts/（存档）。
4. **验证**：flows 全量 JSON.parse；`bash scripts/refactor/verify-all.sh`；新卡 recall 抽样（flow/aliases/keywords/hash_markers 至少一条可命中）。
- **坑**：`git add` 带 gitignore 路径（tmp/）会整条失败且被 `2>/dev/null` 吞错——commit 前查 ignore 名单、不吞错（2026-09-06 首笔晋升 commit 实证）。

### 实测坑清单（situational，随模块滚动补充）

| 坑 | 处置 |
|----|------|
| Element UI 顶栏菜单 mask 拦截按钮点击（rating 首跑） | 先按 Esc 或点空白收起菜单再操作 |
| el-table 固定列单选钮在视口外点不到（rating） | 点固定列内可见单选或行内单元格 |
| 弹窗/抽屉无标题（rating 同业选择抽屉；**变体**：heading 有值但 aria 名错挂「消息列表」——repay 实证） | 以「heading 实文 + 按钮集/字段集清单」作结构证据（宽选择器取 `.el-drawer__header`） |
| 主页返回后行选择丢失，再点操作提示「请选择有效数据」（customer-common） | 返回后重选行再操作；该提示本身可作黑名单行为证据 |
| **已办入口无独立菜单**（credit-group 修正 v4 表述） | 已办藏在 `任务事项→我的任务→待办任务` 页的**页签**内（已办未结/已办已结），无「已办任务」独立菜单 |
| el-drawer / tsscMutilDialog 关闭后**残留 mask 拦截全页点击**（customer-group/credit-corp） | Esc 无效，用 evaluate 置 `display:none` 或点其 close 钮强清 |
| 树形节点/下拉选项纯 click 无响应（collateral-info 向导） | JS 注入 mousedown/mouseup/click 三连（`.el-tree-node__content` / `.el-select-dropdown:visible`） |
| 无文字图标按钮（产品管理树操作） | hover 取 tooltip 作取证锚点 |
| 删除类无确认框（portal 卡片库单击即删，事故已还原） | 黑名单「打开确认框后取消」前先**实证确认框存在性**；无确认框页面禁止触发删除 |
| 盘库【手动盘库】等点击即创建流程（collateral-func，无确认步骤） | 黑名单假设「打开向导即安全」不总成立——小步触发校验再深入 |
| look 态任务页步骤条直点不切换（loan-retail） | 用底部【下一步】推进 |

## 禁区

- **禁止**写 `data/kb/flows/**`
- **禁止**调用 `promote.py` / **禁止**写 `staging`
- **禁止**一次多模块；**禁止**做手册/接口/案例/计划导入（见 spec §3.1）
- 不改 `_kb.py` / `promote.py` / 正式 `flows/` / `staged_flows.jsonl`（除非另开任务且声明）
- 不以需求原文覆盖湿测铁证

## 检查清单

- [ ] manifest 字段齐全（moduleKey、中文名、源路径、时间、status）
- [ ] chapters 非空或显式说明失败原因
- [ ] 每章末尾 ZJJK 清单行机器可解析（湿测/出卡依赖此接口）
- [ ] through-chains 有候选或「无闭环主链」
- [ ] （湿测已开展时）wet-test.md 判定表齐全：无 pending；drift 已分类；blocked 含补测条件与异常原文；写操作零落库
- [ ] 未触碰正式 flows
- [ ] 未调用 promote / 未写 staging

---

## 协议版本史

- **v1**（2026-09-05 `9681934`）：切片契约初版（登记/切片/状态机/禁区/检查清单）。
- **v2**（2026-09-05 `9d02790`+`76642ae`）：湿测协议（视图3 wet-test.md/判定词表/写操作黑名单/drift 分类学/串行）+ 首轮 7 条实战疏漏（存量回补/behavior 无数据可验/blocked 认 console 原文/菜单 mask/fixed 列 radio/无标题弹窗/审批侧走已办）。
- **v3**（2026-09-05 `1484335`）：第 2 轮修订（跨模块观察段/链组增量写回/drafts sourceRefs 叶号/behavior 逐模块对照/复用页名称清单/流程推进 blocked 常态化/Phase E 团队流水线+元演化/回传丢失产物考古）。
- **v4**（2026-09-06 `5916e49`→`8aacebb`）：第 3 轮修订（checker 机械验收 `scripts/kb/wet-test-check.mjs`/B 湿测代理模板/双台账定家/pending 词表行/blocked「黑名单禁止」子类/复合叶规则/跨视图复用口径/through-chains 时效声明/坑清单分层）+ checker 能力增强（relCmpts 括注剥离/判定格宽容/斜杠组/JLCP）。
- **v5**（2026-09-06 本轮）：第 4 轮修订（清单行三形态契约化：无编号分册 `—（页面名）` 与接口分册接口号叶；表格≠清单行；**Step 0 入口可达性预检**；blocked 证据三子类含静默拦截；同构页批量核验；大模块两棒接力；接口分册间接痕迹判定+trdlog 报文映射法；无编号模块 Bearer 菜单树定位法；Lead 预验账号；坑清单扩至 11 条含已办路径修正/残留 mask/无确认框删除）。checker 30/30 模块 ALL GREEN 实证。
- **v6**（2026-09-06 本轮）：第 5 轮修订——**草稿卡产出契约**（门槛/steps 零 blocked/pendingSteps 结构/coverage 对平/NOT-FOUND 环境卡/接口分册卡/同构归并/级联引用/无编号 leafRef=行号+页面名）+ **晋升管线契约**（promote_draft.mjs dry-run→Lead curation 裁决→apply→verify-all+recall 抽样；同域 merge 裁决口径=同菜单二级组+同业务对象，一级同不算同域；2026-09-06 实证 63 卡晋升 new 52/merge 11，flows 29→82）+ USAGE Phase F（F1 产出/F2 晋升）。至此全链：切片→湿测→回填→草稿卡→晋升均成文。
