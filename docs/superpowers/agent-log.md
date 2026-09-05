# Agent 协作日志

> **协议（2026-09-05 定稿，AGENTS.md 同步）**：任何会话**动代码前**在本块之下顶部插入**开工条目**——时刻 + 范围（文件/目录清单）+ 禁入区 + 方式，并立即 commit；**任务单元结束**插入**收工条目**回链开工条目——完成（含 commit hash）/ 验收证据 / 遗留移交，状态以收工条目为准。条目格式 `## 日期 · 工具/角色 — 标题`，要点用 完成/进行中/注意 前缀。文件集须与所有在途声明及工作区未提交改动不相交；子智能体由主会话代为声明、不直接写本文件、不 commit。提交本文件若顺带携带他线条目，commit message 注明。

## 2026-09-05 22:50 · ZCode Lead — 收工：SKILL 步骤2 补 python-docx 降级预案（回链 22:20 开工的补遗）
- 完成：用户核对想法清单发现 4 号（python-docx 降级一等公民）只落在 USAGE §6（Lead 视角）；已在 SKILL.md 步骤2「读源」补同款降级预案（worker 契约可见）。想法 2（FS 场景号）/3（文档口径标注）核实已完整落地（SKILL.md L43/L44）
- 验收：grep 双文件凭证齐全；pin 不涉及
- 提交：本条 commit

## 2026-09-05 22:35 · ZCode Lead — 收工：req-doc-to-kb SKILL/USAGE 湿测协议化（回链 22:20 开工）
- 完成：SKILL.md（视图3 wet-test.md 入目录树；ZJJK 清单行/FS 场景号/文档口径标注三强制契约；新增「湿测」节=判定词表+写操作黑名单+drift 分类学与回流+串行与会话窗口规则；drafts 湿测门槛；检查清单+2）；USAGE.md（§1.3 湿测阶段；Phase E 逐模块逐叶编排；Lead 湿测开场指令模板；§6 python-docx 降级详化+blocked 行）
- 验收：characterize-kb-req-modules OK 11（pin 未动、无脚本 pin skill 文件）；manifest/status 枚举未改（湿测进度以 wet-test.md 为准，规避 pin 风险）
- 决策记录：截图证据=文字为准、tmp 截图短寿命（用户未选入库方案，维持现状并写入 SKILL）
- 遗留：drift 回填 chapters 尚未执行（credit-corp 的 3 处 drift 待回流，属湿测战役下一窗口）；引擎 cue 沉淀通道（behavior 类）暂记 wet-test.md，待引擎线接手
- 提交：本条 commit 含 SKILL.md/USAGE.md/本文件

## 2026-09-05 22:20 · ZCode Lead — 开工声明：req-doc-to-kb SKILL/USAGE 契约升级（湿测协议化）
- 开工：22:20。依据 credit-corp 首轮逐叶湿测经验（41/48，527db33），把湿测方法契约化，经用户批准按建议顺序执行
- 范围：`scripts/prompts/skills/req-doc-to-kb/SKILL.md`、`USAGE.md`、本文件（纯文档契约）；已核实 characterization 无脚本 pin 此二文件（grep 空），`characterize-kb-req-modules.mjs` 为服务行为 pin 不受影响
- 内容：①ZJJK 清单行升为强制契约+FS 场景号+按钮文案标「文档口径」②新增湿测协议（视图3 wet-test.md 模板/判定词表/写操作黑名单/blocked 处理/串行与会话窗口规则）③drift 分类学与回流机制（湿测铁证>需求原文）④drafts 湿测门槛
- 禁入：`src/**`、`data/kb/**`（wet-test.md 数据文件不在本条范围）、manifest/状态机与 pin 不动（单独验证才可改）、他线 WIP
- 方式：主线程直编；完成后跑 characterize-kb-req-modules 确认 pin 绿

## 2026-09-05 22:00 · ZCode Lead — 阶段回报：credit-corp 逐叶湿测 41/48（战役继续，回链 21:40 开工）
- 完成：credit-corp 48 叶清单建账（`data/kb/req/credit-corp/wet-test.md`）；本会话逐叶湿测 **41/48：match 33 / drift 3 / blocked 10**（提交 1037acd/320a6f5 + 本条提交）
- 湿测铁证（文档未载，切片作业区已回填）：①作废前置校验=批复下存在关联在途/生效用信合同则不允许作废（后端 BizException 全文在案）；②授信向导客户放大镜**无条件查询返回 search false，必须带条件**；③未选行操作提示「请选择有效数据」；④SUT 按钮名「流程提交」≠文档「提交流程」；⑤主页列表默认不自动加载
- blocked（10 叶）：#21-25/#33-37 审批任务页（无在途授信审批流程）；#46-48 作废链（被后端关联校验拦截=规则实证）；待数据条件具备补测
- 方式：Playwright MCP 主线程串行（snapshot→click 纪律）；只读验证+向导走到风险阻断即止，未创建/提交任何业务单据
- 下一会话：rating 模块同法开测；credit-corp 补测项见 wet-test.md 运行记录
- 注意：SUT 会话 50 分钟过期，长会话需重新登录

## 2026-09-05 21:40 · ZCode Lead — 开工声明：req 作业区逐模块逐叶节点湿测战役
- 开工：21:40。用户拍板方案：30 个 req 模块逐模块、逐叶节点（ZJJK 功能页）跑真机湿测，湿测铁证作为后续 drafts/promote 门槛；promote 仍待用户明示
- 范围：`data/kb/req/<key>/wet-test.md`（每模块叶节点湿测证据表，新增）、`tmp/kb-wet-test/`（截图/探针，gitignore）、本文件；SUT=test.creditv5p2.tansun.com.cn（701994/1，验证码不拦截），经 Playwright MCP 操作共享有头浏览器（snapshot→click 纪律，串行）
- 禁入：`data/kb/flows/**`（只读）、`scripts/kb/promote.py`、`data/kb/staging/`、源 `.docx`、他线 WIP（service.py / trajectory*）、禁止恢复 `save_section.py`
- 方式：Lead 主线程串行湿测 + 每模块收口 commit；叶节点清单由 chapters/through-chains 的 ZJJK 提取；判定词表=match / drift(差异明细) / not-found / blocked；第一批=credit-corp，随后按业务链推进（rating→loan→disburse→repay→postloan…）
- 进度表：`tmp/kb-wet-test/progress.md`

## 2026-09-05 21:05 · ZCode Lead — 收工：需求分册批量导入 30/30 sliced（回链 20:05 开工）
- 完成：30 个 moduleKey 全部 registered→sliced（P0=A_v5.2需求文档0824 27 册 + P1 补洞 collateral-info/collateral-func/system-mgmt）；product-mgmt 升级切片（sourcePath 换仓库内 0824 K01，未 reset）；每模块 chapters/ + through-chains.md 齐备，零 drafts、零 flows/staging/promote 触碰
- 提交链：`bf75337`(开工) → `1ec6f0b`(batch1 会议/客户×3/评级) → `7fe573f`(batch2 授信×4/限额) → `d8ca1fb`(batch3 管控接口/用信×2/放还款×2) → `fc975b4`(batch4 贷后×3/催收/产品) → `81f472a`(batch5 档案/智控/门户/保全×2) → `09c30e2`(batch6 数字化×2/押品×2/系统管理)
- 验收：逐批 manifest.status=sliced + chapters 非空 + through-chains 存在 30/30；characterize-kb-req-modules OK 11；`GET /api/v2/kb/req-modules` rows=30 全 sliced（控制面已重启至含该路由的构建，executor 已重连 online）
- 方式：Lead 直调 registerReqModule 登记 + 6 批 ×5 并行子智能体切片（moduleKey 互斥，worker 未 commit）；officecli 全文超限时各 worker 按 USAGE §6 降级 python-docx（browser_use env），临时文件均已清理；源 .docx 未改动
- 遗留：本批按约定不出 drafts；flows/promote/staging 另开任务；limit-ctrl-api 源文档报文字段整体缺失（各章已标待湿测）；个别文档口径矛盾点已逐章标「待湿测」；进度表 `tmp/kb-req-batch/`（gitignore）
- 注意：他线未提交 WIP（service.py / trajectory*）未碰

## 2026-09-05 20:05 · ZCode Lead — 开工声明：需求分册批量导入 KB（registered→sliced）
- 开工：20:05。按 `scripts/prompts/skills/req-doc-to-kb/USAGE.md` 批量导入：语料 P0=`A_v5.2需求文档0824`（27 册）+ P1 补洞（押品×2、系统管理×1），共 30 个 moduleKey
- 范围：`data/kb/req/**`（新建/升级 30 个模块作业区：chapters/、through-chains.md、manifest）、`tmp/kb-req-batch/progress.md`、本文件；控制面路由 404 故经 `src/services/kb-req-modules.js` Node 直调登记（服务文件只读）
- 禁入：`data/kb/flows/**`、`scripts/kb/promote.py`、`data/kb/staging/`、源 `.docx` 只读、**禁止恢复 `save_section.py`**、他线未提交 WIP（`scripts/agent/service.py`、`recording-runner-business-data.js`、`trajectory-meta-service.js`）
- 方式：Lead 登记+代写日志+分批 commit；子智能体（≤5 并行，moduleKey 互斥）执行 officecli 切片，不 commit；默认不出 drafts
- 进度表：`tmp/kb-req-batch/progress.md`

## 2026-09-05 19:35 · Cursor Lead — 收工：需求导入 KB 实现 T1–T4（回链 19:16 开工）
- 完成：Skill `req-doc-to-kb`；服务+pin OK 11；`/api/v2/kb/req-modules*` + 501 上传 stub；`product-mgmt` registered；`verify-all` 接入 pin
- 提交链：`9681934` → `dc4f84d` → `25a75c2` → `9e345e8` → `c05e99f`
- 验收：characterize-kb-req-modules OK 11；终审 Conditional Approve（本机 sourcePath 作 exemplar；:4097 需重启后 curl）
- 遗留：完整 officecli `sliced` 跟跑；reset 不清 through-chains；勿恢复 save_section.py
- 注意：他线未提交 WIP（service.py / trajectory*）未碰

## 2026-09-05 19:20 · Cursor Lead — 跨会话冲突备忘：save_section 勿恢复
- 注意：他线（统一保存→`click_save`）有意删除 `scripts/controller/actions/js_snippets/save_section.py`（`5f4f7b5` 去注册/import/prompt；`c7f16a5` 补删本体）。本会话曾误恢复（`a160a3e`/`c1c4fbf`）——**禁止再恢复该文件**。characterization 契约已对齐。
- 注意：工作区未提交的 `scripts/agent/service.py`、`recording-runner-business-data.js`、`trajectory-meta-service.js` 属他线/本会话未声明改动，需求导入线勿碰。

## 2026-09-05 19:16 · Cursor Lead — 开工声明：需求导入 KB 实现（Subagent-Driven）
- 开工：19:16。执行 `docs/superpowers/plans/2026-09-05-req-doc-kb-import.md` T1–T4
- 范围：`data/kb/req/`、`scripts/prompts/skills/req-doc-to-kb/`、`src/services/kb-req-modules.js`、`src/routes/v2/kb.js`、`src/dashboard/api-docs/groups/kb.js`、`scripts/characterization/characterize-kb-req-modules.mjs`、本文件、计划勾选
- 禁入：`data/kb/flows/**`、`scripts/kb/promote.py`、`data/kb/staging/`、他线 WIP（用信/客户查询引擎、`scripts/agent/service.py` 等未声明改动）、**禁止恢复 `save_section.py`（有意删除→click_save，见 5f4f7b5/c7f16a5）**
- 方式：Subagent-Driven；子智能体不 commit；主会话验收后提交；ledger `.superpowers/sdd/2026-09-05-req-doc-kb-import/`

## 2026-09-05 19:12 · Cursor Lead — 收工：需求导入实现计划（writing-plans）
- 完成：`docs/superpowers/plans/2026-09-05-req-doc-kb-import.md`（T1 Skill → T2 服务+pin → T3 路由+docs → T4 跟跑）
- 注意：待用户选 Subagent-Driven 或 Inline 执行；尚未写产品代码

## 2026-09-05 19:06 · Cursor Lead — spec 补记：共享资料包地图（用户选 A）
- 完成：`2026-09-05-req-doc-kb-import-design.md` 增 §3.1；第一版仍只导入 **X_需求文档**；手册/接口/案例/计划仅文档化 Out
- 注意：writing-plans 已于 19:12 收工条目闭环

## 2026-09-05 18:57 · Cursor Lead — 收工回报：需求导入 KB 设计 spec（回链 18:57 开工）
- 完成：brainstorming 方案 1 + §1–§4 用户批准；spec `docs/superpowers/specs/2026-09-05-req-doc-kb-import-design.md`
- 验收：自检无 TBD/矛盾；范围=Skill@`scripts/prompts/skills/req-doc-to-kb` + 薄 API 登记；草稿禁 promote
- 遗留：待用户审 spec 后 writing-plans；未实现代码

## 2026-09-05 18:57 · Cursor Lead — 开工声明：需求文档导入 KB 设计落盘
- 开工：18:57。将已批准的需求→KB 作业区设计写入 specs；零产品代码
- 范围：`docs/superpowers/specs/2026-09-05-req-doc-kb-import-design.md`、本文件
- 禁入：`src/**`、`data/kb/flows/**`、`scripts/kb/promote.py`、他线客户查询/用信 WIP
- 方式：主会话写 spec + commit；计划等用户审阅后再 writing-plans

## 2026-09-05 18:35 · Cursor Task 5 — 收工回报：客户信息查询 KB 档位 B（回链 18:08）
- 完成：traj **#526** recorded（stepCount=4，functionId=9000000039）；stamp **KB测客户-20260905-1315** 列表 hit=true；`customer_query.json` source 回填 + 重置 rule；todo ⑦ 档位 B 闭环；计划 Tasks 1–5 全勾选
- 验收：`tmp/customer-mgmt/query/through-report.md`；`tmp/customer-mgmt/query/cdp-list-check.json`；`tmp/customer-mgmt/query/list526_stamp.png`
- 注意：commit **`8b52bff`**；未带 docs 三文件删除 / `.env` / 他线 WIP
- 遗留移交：引擎 phase_done 门闩（P1/P3 仍 0 步假完成，与建档 #524 同类）；查询前重置已入卡 rules

## 2026-09-05 18:08 · Cursor Lead — 开工声明：客户信息查询 KB 档位 B（设计→计划）
- 开工：18:08。用户选档位 B；成功浅 A；复用 stamp 1315；方案 1 独立新卡+湿测；§1–§3 已口头批准，落 spec
- 范围：`docs/superpowers/specs/2026-09-05-customer-query-kb-design.md`、随后 `plans/2026-09-05-customer-query-kb.md`、`data/kb/flows/customer_query.json`、`tmp/customer-mgmt/query/**`、本文件、`todo-list.md`
- 禁入：引擎/`_kb.py`/prompts、建档卡主链改写、OCR/影像、用信授信、`config/.env*`、他线 WIP（含 docs 三文件删除）
- 方式：主会话；先 spec commit → 用户审 spec → writing-plans → 再实施湿测

## 2026-09-05 17:05 · Zcode Lead — 产品裁定落地：文件上传场景全面搁置（回链 16:45）
- 完成：用户转达产品意见——**SUT 涉及文件上传的场景一律不推进、全部搁置**。已计入 todo-list（⑤ 工作线 P3-C 段）；KB duigong_contract_sign 卡新增「文件上传场景搁置」规则（+恢复条件）。
- 影响：纸质签上传影像生效路线封死（A7 一并含入）；链B 止于合同 9881020044006 已保存态（ctrSt=1，可回退）；链B 后续（担保合同期限→提交→生效→放款）待产品排期上传能力后续跑。

## 2026-09-05 16:45 · Zcode Lead — 收工回报：链B合同签订信息填齐+账户落库（回链 16:05）
- 完成：主合同 9881020044006 系批复生效后自动创建（推翻 A6 手动创建结论）；发起签订进签订表单，签订信息全部填齐并保存（双方签署/份数 2/受托支付/送达三件套/公证否/**合同账户放款+还款主双账户 saveCtrAccinf 200**）。
- 完成：提交（contSubmitValidate 200）被「担保合同 988104260032001 期限不能为空」拦——用信自动创建的担保合同无起止日，主签订页与担保合同管理列表均无编辑入口，需走担保合同自身签订流程（下一步探明）。
- 完成：KB duigong_contract_sign 卡 +4 规则（8 条）；plan §9 补记；报告 tmp/e2e/p3c_report.md。
- 注意：按开工声明停在不可逆点之前（ctrSt=1 已保存可回退，提交未执行）；生效路线（纸质影像=A7 搁置 vs 电子签=KB 禁令）待用户拍板。
- 遗留移交：①担保合同期限维护入口（担保合同签订流程）②提交→签订中③生效路线拍板④合同生效后放款（loan 卡配方）。

## 2026-09-05 16:05 · Zcode Lead — 开工声明：链B合同签订（批复项下合同创建+签订信息，卡不可逆提交点）
- 开工：16:05。接「继续」——链B深化第一步：为用信批复 DGYXPF202609050016010 创建对公合同并填齐签订信息（配方=duigong_contract_sign 卡）
- 范围：tmp/e2e/（报告+截图）、docs/superpowers/agent-log.md、docs/superpowers/research/2026-09-05-engine-closure-phase2-plan.md、必要时 data/kb/flows/duigong_contract_sign.json；SUT 实机（701994）
- 禁入：他线 WIP（src/services/trajectory/trajectory-meta-service.js、docs 删除项）、config/.env*、「模拟电子签」「电子签合同状态生效」按钮（KB 一律禁止）
- 方式：主会话 Playwright MCP 实操；**签订提交为不可逆动作（KB 约定需用户授权），本轮只做合同创建+填齐，到提交点停下问询**

## 2026-09-05 15:15 · Zcode Lead — 收工回报：链B用信支线全链贯通（回链 10:38）
- 完成：**链B补债收官**——授信批复 DGSXPF20260905020004 项下发起对公用信申请 **YXPC20260905012041**（贯通验证企业190416 / 政采贷（流动资金贷款）/ 10 万 / 12 月），wf_usecredit_001 全链 001(701994)→002(WN0001)→003(701994)→004(WN0001 同意) 通过，**用信批复 DGYXPF202609050016010 自动生成已生效**。链B至此=客户→评级→授信→授信批复→用信→用信批复 全链与链A等深。
- 完成：新实证 4 项已沉淀 KB 卡 credit_usage（+4 规则，13→17）：①方案品种产品必须命中授信分项品种（validLmtSubExist，额度四字段自动回填=正向信号）②信用担保死路→保证+引入保证人（弹窗行内先填关系+金额）③tssc-multi-select 的 $emit 不落 model 须直写 form.model（涉农真键 agrirelLoanInd）④DIGT_IDY_CL 列超长 SUT 缺陷（'0' 绕行）+ i18n 崩溃吞 toast 用 formComp.validate() 诊断。
- 验收：报告 tmp/e2e/p3b_report.md + 截图 4 张（意见步/审批中/002弹窗/批复生效）；plan §8 已补。A7 影像上传继续搁置。
- 注意：本仓另有他线在途改动（trajectory-meta-service.js、docs 删除）未触碰、未混入提交。
- 遗留移交：链B可继续向 合同→放款→贷后 深化（配方在合同/贷款 KB 卡）；SUT 缺陷清单又+3（DIGT_IDY_CL 列长/introduceGnrDialog 静默 false/抵押品牌种 i18n 崩溃），待统一提交厂商。

## 2026-09-05 14:12 · Zcode Lead — 收工回报：画面推流优化两批落地（回链 13:33 / 8ea6719）
- 完成：第一批 ack 定速产帧（createAckPacer 按转发节奏定速 ack，Chrome in-flight 满时跳过抓取+编码，产帧率钉 ~30fps）+ BIB_STREAM_QUALITY/MAX_W/MAX_H env 化，commit **`20903cd`**；第二批 观众计数下推（0 观众 stopScreencast、首位观众自动恢复、bib_ready 回显、末帧缓存秒开、binarySubscriptions WeakMap→Map+close 清理修泄漏），commit **`97da3ef`**；调研报告 bd6ecd0
- 范围延伸（超出开工声明，向本线备案）：为让 env 质量配置生效改了 `src/services/remote-session-service.js`（quality 按需下发一行）+ `src/services/trajectory/trajectory-attach-{runner,service}.js`（去硬编码 quality:65 两处）——这三文件开工时自禁入，实际无他线冲突
- 验收：characterize-screencast-timing PASS（timing 4 组 + stream config 3 组 + pacer 时序 3 组）；全量 `verify-all.sh` **ALL GREEN**；全部触及文件 eslint 0；ws-router/executor-ws/ws-server 模块级真实 import 通过
- 遗留移交：①湿测未做（需在线执行机+真实 Chrome：验证 60Hz 屏下产帧率钉 30、0 观众 CPU 归零、重订阅首帧秒开）②local 模式 remote:subscribe 不自动 startScreencast（沿用 remote:start 语义，若产品要"订阅即看"需前端配合）③前向观众计数按 uuid 精确匹配，`addBinarySubscription` 传 null 的旧客户端仍走全量广播不受影响

## 2026-09-05 13:33 · Zcode Lead — 开工声明：画面推流优化（ack 定速产帧 + 零观众停推）
- 开工：13:33。调研报告 research/2026-09-05-screencast-optimization.md（bd6ecd0）经用户批准，两批实施
- 范围：`src/cdp/screencast-timing.js`、`executor/bib-bridge.js`、`src/cdp/remote-bridge/{screencast.js,state.js,ws-router.js,index.js}`、`src/executor-ws.js`、`src/ws-server.js`、`scripts/characterization/characterize-screencast-timing.mjs`、`config/.env.example`、`tmp/screencast_probe.mjs`、本文件
- 禁入：`config/.env`（他线热区）、`scripts/controller/**`、`src/services/remote-session-service.js`、菜单/KB/引擎线 WIP、对公建档线 tmp/customer-mgmt
- 方式：主线程直接改（跨文件耦合紧），不改动作协议既有消息名
## 2026-09-05 13:25 · Cursor Lead — 收工回报：对公建档复录 #524（回链 13:11 / ba27580）
- 完成：traj **#524** recorded；stamp **KB测客户-20260905-1315** 列表 hit（cstNo=`26090513160716537`）；**stepCount=9**（P2：新增/选类型/填 stamp+USCC/保存）；卡 source 已挂 #524；`through-report.md` 更新；detach rs=1169；commit **`5b588cd`**
- 验收：`tmp/customer-mgmt/cdp-list-check-524.json` + `_tree524_full.json`；P3/P4 仍 0 步假完成（引擎门闩另案）
- 遗留移交：phase_done 证据门闩；引入深录；个人/OCR 旁路

## 2026-09-05 13:11 · Cursor Lead — 开工声明：对公建档复录沉淀步骤（回链客户 KB）
- 开工：13:11。#515 AI 假成功几乎无步骤；新建交易复录，任务文案强化成功门闩（列表 stamp / 禁止过早 done）；USCC 固定 18 位；OCR 仍禁入
- 范围：`tmp/customer-mgmt/**`（任务/证据）、可选回写 `data/kb/flows/customer_onboarding.json` source、`docs/superpowers/agent-log.md`、`docs/superpowers/todo-list.md`
- 禁入：引擎/prompts/`_kb.py`（证据门闩另案）、OCR/影像、用信授信、产品卡、`config/.env*`、安全 P0 已改文件
- 方式：主会话 API 建交易+录制；假成功则 CDP 补完并如实写报告

## 2026-09-05 · Zcode Lead — 收工回报：P0 修复完成（回链本会话开工条目）
- 完成：**P0-1/2/3/4/5 五项全部落地**，四提交——`de68582`（/ws+/api/browser 鉴权、RSCF 订阅过滤、HOST 默认 127.0.0.1）、`0323984`（账号密码出站掩码+写侧哨兵跳过）、`7c3374d`（移除两枚真实 JWT+验签密钥，合成 JWT 替换特征化）、`3a65fc7`（.env.example 占位还原+DASHBOARD_WS_TOKEN 示例）
- 方式：三路并行实施子智能体（文件集互不相交，不 commit）+ 主线程验收代提交；子智能体改动经 diff 范围核查无越界
- 验收：verify-all **ALL GREEN**（exit=0）；红线 grep（eyJ 真实 JWT/paas-application）本线文件零匹配；characterize-partner-platform/sso-auth(26/26)/system-node-accounts(10/10) 全绿
- ⚠ 部署侧人工项（不做会导致不可用/残留风险）：①47.101 pull 后 .env 须显式 `HOST=0.0.0.0` ②.env 需补 `PARTNER_ACCESS_TOKEN`（轮换后新值）并在账号中心作废旧 JWT ③MinIO 密码/EXECUTOR_TOKEN 轮换（P0-6，仍挂账）④建议设 `DASHBOARD_WS_TOKEN` ⑤SSO 开启时前端 WS/SSE 需带 `?token=`
- 遗留移交：①nine-rules 5/18 存量红（HEAD worktree 复现，不在 verify-all 闸内，归菜单线核对——疑似 12:09 intermediate 升格批次未同步该脚本）②v2/hierarchy.js+trajectory.js 仍有明文密码出站（回放链路需真实值，列入第二批）③工作区存在他线未提交删除（docs/superpowers 三文件）本线未触碰
- P0-6（凭据轮换）为服务器人工操作，不在本批

## 2026-09-05 · Zcode Lead — 开工声明：P0 修复（安全审查第一批）
- 开工：本会话。用户拍板「P0 先处理」，按 security-review-2026-09-05.md 修复路线实施
- 范围：A 子智能体=server.mjs/src/middleware/**/src/cdp/remote-bridge/**/src/executor-ws.js/config/config.js（/ws 鉴权+/api/browser 鉴权+RSCF 订阅过滤+HOST 默认）；B 子智能体=hierarchy-tree-query/hierarchy-service/system-account-dao+对应特征化（密码掩码）；C 子智能体=partner-platform.js+characterize-sso-auth.mjs+相关 pin（移除真实 JWT）；主线程=config/.env.example 占位还原+验收代提交
- 禁入：`config/.env`、data/kb/**、他线在途热区（Cursor 12:37→12:55 客户管理线已收工，其文件仍不碰）
- 方式：三路并行实施（文件集互不相交，子智能体不 commit）+ 主线程验收（verify-all+lint+node --check）后代提交

## 2026-09-05 12:55 · Cursor Lead — 收工回报：客户管理 KB 贯通（回链 12:37 / 3c3389a）
- 完成：执行代理 Tasks 1–5；卡挂 **functionId=7**；traj **#515 recorded**；stamp **KB测客户-20260905-1245** 列表可见（CDP 补完；AI record 曾假成功）；commit **`f6e6dba`**
- 验收：`tmp/customer-mgmt/through-report.md`；召回 score=100；OCR 未触
- 遗留：①引擎 phase_done 证据门闩 ②USCC 须 18 位 ③法定代表人引入浅过 ④可选复录沉淀步骤
- 注意：提交仅本线卡/计划/todo/agent-log；未带安全审查删除的 docs 或 `.env.example`

## 2026-09-05 12:37 · Cursor Lead — 开工声明：客户管理 KB 贯通（对公建档 A）
- 完成：报告 `docs/superpowers/security-review-2026-09-05.md`（**`45c1533`**）——四路只读 Explore 并行（API 面/executor-CDP-WS/Python/仓库卫生）+ 主线程抽验四项 P0 全部属实；**本轮只报告未修码**
- 核心结论：**P0×6**（/ws 无鉴权+0.0.0.0 可看屏可操控 SUT；/api/browser/* 裸奔可透传任意 cdp_action；tree 接口未鉴权回显明文密码；两枚真实 JWT+SSO 验签密钥入库；.env.example 工作区改动回真实值；MinIO/token 轮换仍挂账）+ **P1×6 + P2×10+**；基线 8-31 修复全部在位未回退；SQL/命令注入/JS 注入/反序列化等面确认无问题
- 遗留移交：修复分三批待用户拍板（见报告「修复路线建议」）；**特别注意 config/.env.example 的工作区未提交改动含真实 SSO_JWT_SECRET，属他线 WIP——任何会话提交该文件前必须还原占位符**

## 2026-09-05 · Zcode Lead — 开工声明：8 月集中开发安全/漏洞整体排查（只读审查）
- 开工：本会话。用户要求对 8 月集中开发的潜在漏洞做整体排查，带 agent team
- 范围：只读审查——A 路 `src/routes/**`+`src/services/**` API 面；B 路 `executor/**`+`src/cdp/**` WS/CDP 通道；C 路 `scripts/**` Python 面+migrations；D 路仓库卫生（secrets/gitignore/tmp/config）；产出 `docs/superpowers/security-review-2026-09-05.md`；基线=docs/superpowers/code-review-2026-08-31.md（已修 P0×7+P1×5+Python×3，不重报已修项）
- 禁入：一切写操作（代码/数据/配置）；`config/.env`（只许读 `.env.example`）；他线在途热区（Cursor 12:37 客户管理 KB 线文件不碰）
- 方式：四路只读 Explore 并行（范围互不相交），主线程交叉验证 + 分级（P0/P1/P2）后汇总报告；本轮只报告不修码，修复经用户拍板后另行立项

## 2026-09-05 12:37 · Cursor Lead — 开工声明：客户管理 KB 贯通（对公建档 A）
- 开工：12:37。用户确认方案 1 + 档位 A；落设计/计划后按计划回写 `customer_onboarding`（挂 **functionId=7**）并湿测
- 范围：`docs/superpowers/specs/2026-09-05-customer-mgmt-kb-design.md`、`docs/superpowers/plans/2026-09-05-customer-mgmt-kb.md`、`data/kb/flows/customer_onboarding.json`、`tmp/customer-mgmt/**`、`docs/superpowers/agent-log.md`、`docs/superpowers/todo-list.md`
- 禁入：OCR/影像、个人/集团等旁路、合同用信、`_kb.py`/promote/prompts（默认）、产品五卡、他线 WIP、`config/.env*`
- 注意：对公客户管理正式 id 为 **7**（1478 已合入）；勿再挂 1478
- 方式：主会话；录制可派子代理（代声明、不 commit）

## 2026-09-05 · Zcode Lead — 收工回报：withTrajectoryLock 超时核实与修复完成（回链本会话开工条目）
- 核实结论（只读 Explore）：无永久死锁（finally+吞错链异常安全），但 prepare 最坏持锁 ~540s（openSession 120s + bib 45s + 登录 180s×2+8s）且 server.mjs HTTP 层零超时——期间 detach/stream/detach 会无限排队挂死，**属实需修**
- 完成：`1dcb3d5` 排队等待超时——raw 锁加 waitTimeoutMs（默认 30s，`TRAJ_LOCK_WAIT_TIMEOUT_MS` 可配，0=禁用旧行为），超时 503 `traj_lock_wait_timeout`；关键设计=超时只拒绝等待者并跳过占位槽、**不提前 release**（否则后续等待者会与持锁者并发），串行语义严格保持；重入路径与持有时长不受限
- 验收：临时探针 8 项全 PASS（串行/503 快速失败 ~90ms/不与持锁者并发/占位槽 fn 永不执行/持锁者结果完整/禁用回落旧行为）；断言固化进 `scripts/smoke/accept-multi-traj-lifecycle.mjs`（+3）；characterize-session-lifecycle OK；**verify-all ALL GREEN**；eslint 0/0
- 遗留移交：①第二个并发 prepare 从「排队后幂等复用」变 503 快速失败——前端如遇 503 应重试/提示（批量线 pumpRecord 单条串行不触发）②分诊第 2/3 项已登记 todo 挂起表（login-retry-heuristic / stop-busy-race，均 P3）③临时探针 tmp/test_traj_lock.mjs 留档
- 注意：修复生效需重启 4097

## 2026-09-05 · Zcode Lead — 开工声明：withTrajectoryLock 超时核实与修复 + todo 挂起登记
- 开工：本会话。承接浏览器会话生命周期梳理的分诊结论，用户批准处理第 1 项（锁无超时核实/修复），第 2/3 项登记 todo 挂起表
- 范围：只读调研 `src/services/remote-session-service.js`（锁实现）及全部 withTrajectoryLock 调用方；如需修复则改动锁实现文件 + 新增/扩展特征化；`docs/superpowers/todo-list.md`（挂起表 2 行）
- 禁入：`config/.env*`、`data/kb/**`、engine/KB/产品线热区、他线未提交改动；Cursor 12:09 线已收工（12:30），menu-scan 系文件本线不碰
- 方式：一路只读 Explore 核实锁实现与全部调用点 → 主线程最小修复 → verify-all 关键子集 + lint 0/0 → 收工

## 2026-09-05 12:30 · Cursor Lead — 收工回报：SDD intermediate 同名升格合入（回链 12:09）
- 完成：Tasks 1–5——characterize 升格用例；`buildScanApplyPlan` promote；loadExistingModules 含 intermediate + phase2 跳过；apply 清 `intermediateFlag`；`merge-intermediate-ai-twins.mjs` 清理 systemId=1（86 对，含对公客户管理 `7`←`1478`，traj=21）
- 验收：characterize-menu-scan 20/20、uml-adopt 4/4；整支评审 Approved（`.superpowers/sdd/final-review.md`）
- 关键：`d0d63a3`…`c719094`；开工 `76187a4`
- 遗留：推送下周一；可选再扫确认无新孪生；评审 Important 非阻断（apply wiring pin / system_page 重挂等）

## 2026-09-05 · Zcode Lead — 收工回报：浏览器与会话生命周期梳理完成（回链本会话开工条目）
- 完成：报告 `docs/superpowers/research/2026-09-05-browser-session-lifecycle.md`（**`3fd3dad`**）——三路只读 Explore 并行（Node 会话层/轨迹链/Python 侧）+ 主线程交叉验证；零代码改动
- 裁决（纠正既有认知）：①CDP 产品端口段=EXECUTOR_CDP_PORT_BASE **19242**（executor/config.js:193，每槽 base+slot），9242 仅 Python 裸跑兜底默认；②remote_session 状态机=active|idle|closed|crashed（constants.js:33），「live/draft」是 trajectory.record_status 概念非 remote_session 状态；③record/stop 不释放槽、stream/detach 保留槽+15min grace、detach 硬关——三分语义与既有认知一致已实证
- 验收：三报告 file:line 互证 + 主线程抽验两处承重结论（grep constants/port base 逐字核对）；报告含 10 条实证坑位清单与未核实遗留三项
- 遗留移交：spawn 时点行号/rerun-replay 端点/WS 半开参数未逐行钉——见报告 §6

## 2026-09-05 · Zcode Lead — 开工声明：浏览器与会话生命周期/调用关系梳理（只读调研）
- 开工：本会话。用户指示梳理「浏览器与会话的生命周期和调用关系」，带领 agent team
- 范围：只读调研 `src/routes/**`、`src/services/**`、`scripts/{session_runner,agent,controller}/**`、`executor/**`；产出 `docs/superpowers/research/2026-09-05-browser-session-lifecycle.md` + 本文件；与 Cursor 12:09 SDD 线（menu-scan*/merge-intermediate）文件集零交集
- 禁入：一切代码/数据写操作、工作区未提交改动（config/.env.example）、在途线热区
- 方式：三路只读 Explore 并行（①Node 控制面浏览器会话与 executor 槽位 ②record/replay/stream/detach 轨迹链 ③Python agent/CDP 接线），主线程交叉验证后汇总成报告

## 2026-09-05 12:09 · Cursor Lead — 开工声明：SDD 实施 intermediate 同名升格合入
- 开工：12:09。用户「按计划实施」+ `/subagent-driven-development`
- 范围：`src/services/menu-scan-{service,apply,session}.js`、`scripts/characterization/characterize-menu-scan.mjs`、`scripts/maintenance/merge-intermediate-ai-twins.mjs`、api-docs overview、agent-log/todo；MySQL systemId=1 孪生清理
- 禁入：推送 POST、异名改名升格、改 source 枚举、信贷/KB、`config/.env*`、他线 WIP
- 方式：主会话 SDD（子智能体实施+评审；**子智能体不 commit**，主会话验收后提交）

## 2026-09-05 12:06 · Cursor Lead — 设计确认：同名 intermediate 升格合入（source=json_import）
- 完成：spec `2026-09-05-intermediate-promote-on-scan-design.md` + plan `2026-09-05-intermediate-promote-on-scan.md`；旧 intermediate spec §2/§5/§6 已修订
- 待：用户审阅 spec 后实施（characterize → plan 升格 → apply → 存量孪生清理）
- 禁入：推送、异名改名升格

## 2026-09-05 11:20 · Zcode Lead — 收工回报：菜单爬取 Xpath 真机验证（回链 10:57）
- 完成：410 条 Xpath 全量真机普查（test.creditv5p2，701994，独立 Playwright 无头实例，未碰共享有头浏览器）——**全部匹配 0 失效**；但二级 386 条 `li[data-id]` 为隐藏 DOM（可见 flyout 链接是 `li.submenu-item[data-url=…]`），可见性点击工具定位不到=同事反馈根因；引擎 `el.click()` 配方实测隐藏节点一次点击导航成功（RES000000101→对公客户管理页）
- 验收：报告 `tmp/menu_crawl/verify-report.md` + `_verify_stateA/BC/D.json` + 截图；同事样例 RES000000006（押品管理，一级）实测可定位且可见，已注明待同事提供其测试页面/工具细节
- 遗留移交：①给同事的替代=二级用 data-url 定位或 JS el.click ②可选改进=Excel 导出加 data-url 列（未实施，属产品决策）③DOM 有 19 个 data-id 未入 Excel（次要）
- 方式变更注记：开工声明原写 Playwright MCP，因该浏览器被占用且用户明确「别动别人的浏览器」，改为独立无头实例执行；本收工未改任何 src/scripts 代码
- commit 开工 `49d616e`

## 2026-09-05 12:10 · Zcode Lead — 收工回报：执行子集清单+导出方案（回链 11:54）
- 完成：核实 `replay_action_entries`（_replay.py:533）执行闭包并产出交付文档 `docs/superpowers/research/2026-09-05-replay-engine-handover-export.md`——回放核心 import 链（replay_*/_helpers/_js_snippets/js_snippets 34 文件/form_rules/models/feature_flags）+ 单源生成链（page-locator-helpers.js）+「随包不激活」的 autofill 链说明 + 版本化导出契约（MANIFEST+git hash+冒烟对拍）
- 验收：service.py/_helpers/replay_* 逐文件 import 实查；browser_context= browser_use 会话、registry 兜底必需、PYTHONUTF8=1 三条硬约束入文；autofill 链 _watcher_mode 抑制实证（_replay.py:544）
- 遗留移交：①导出脚本 `export_engine_subset.mjs` 未实施（§4 步骤 1，待用户确认后 0.5 天）②同步机制待同事确认是否需回放行为对齐（§3 前提）③menu 线同事侧 data-url 替代方案仍待其反馈

## 2026-09-05 12:20 · Zcode Lead — 收工回报：actions 契约文档（回链 11:58）
- 完成：`docs/superpowers/specs/2026-09-05-engine-actions-contract.md`——步骤 entry 结构、§2 动作词汇（直派 4+close 组 6+索引/表格+表单四件套+检查点+registry 开放集 26 名）、§3 别名归一 17 条、§4 结果协议（result 前缀判成败全表+stop_on_fail 语义）、§5 对齐冒烟三步、§6 变更流程（改词汇须同提交更新契约）
- 验收：词汇全部实查 `_DIRECT_REPLAY_ACTIONS`/`replay_names.py`/`_result_ok`/registry 注册名，非记忆凭写
- 注意：`docs/*` 默认 gitignore（仅白名单入库），契约放 specs/ 白名单；本契约与 `replay_names.py` 冲突时以代码为准
- commit `2222109`；遗留移交：导出脚本 `export_engine_subset.mjs` 仍未实施（待用户确认）；契约文档待转同事评审

## 2026-09-05 11:58 · Zcode Lead — 开工声明：actions 契约文档（两边引擎接口约定）
- 开工：11:58。用户指示「我们需要约定 actions」——把回放动作词汇（动作名/参数/语义/结果协议/别名）固化为跨团队契约文档
- 范围：新建 `docs/engine-actions-contract.md`；只读提取 `_replay.py` 直派表、`replay_names.py` 别名表、controller 注册动作；本文件开工/收工条目
- 禁入：`src/**`、`scripts/**` 不改；他线 WIP（config/.env*、untracked research）；不写导出脚本（上一条目 §4 待确认项不变）
- 方式：主会话读源码提取动作词汇 → 契约文档（英文动作名+参数表+结果协议），动作清单以代码为准不凭记忆

## 2026-09-05 11:54 · Zcode Lead — 开工声明：执行引擎执行子集清单 + 版本化导出方案
- 开工：11:54。同事（Python 技术栈）要接手执行引擎；用户拍板不做旧组装器复活，改「提供现行 actions 执行子集 + 版本化导出契约」
- 范围：新建 `docs/superpowers/research/2026-09-05-replay-engine-handover-export.md`（清单+方案）；只读盘点 `scripts/controller/**`、`src/cdp/page-locator-helpers.js`；本文件开工/收工条目
- 禁入：`src/**`、`scripts/**` 一律不改（characterization 文本 pin 热区）；`config/.env*`、untracked research 文档（他线）；不实施导出脚本（本条目只出方案，实施待用户确认）
- 方式：主会话读 9-01 回放管线调研底稿 + 逐文件核实现行树依赖（import 链）→ 产出清单与导出契约文档

## 2026-09-05 10:57 · Zcode Lead — 开工声明：菜单爬取 Xpath 真机验证（同事反馈「定位不到」）
- 开工：10:57。用户转达同事反馈「项目抓取的菜单路径无法使用/菜单 Xpath 定位不到」（截图示 `//li[@data-id='RES000…']`），附 `tmp/menu_crawl/menu_crawl_no_system.xlsx`，要求真机验证
- 范围：`tmp/menu_crawl/menu_crawl_no_system.xlsx`（只读）+ `tmp/menu_crawl/` 新增验证脚本与报告（本线 scratch）；SUT test.creditv5p2 只读导航验证（登录+菜单悬停/计数，不提交任何业务单据）；本文件开工/收工条目
- 禁入：`src/**`、`scripts/**`、`data/kb/**`、`config/.env*`（工作区他线 WIP）、`docs/superpowers/research/2026-09-01-replay-pipeline-handover.md`（untracked 他线）、MySQL、推送 POST、存量业务单据
- 方式：openpyxl 读 Excel 全量 Xpath → Playwright MCP 有头浏览器登录 SUT → document.evaluate 批量计数匹配/可见性（含 flyout 展开前后对照）→ 出结论报告；不改任何产品代码（验证任务）

## 2026-09-05 10:55 · Cursor Lead — 收工回报：正式 systemId=1 全量 scan（回链 10:39）
- 完成：scan `247e4ec8-…` completed——scanned=429 matched=257 created=172 pageIdFilled=168 umlAdoptedAfterPageId=79
- 验收：对公客户管理可导航孪生 `9000001478`（UML00005556+xpath+pageId）；产品管理五叶齐全（0811/0812/0740/0467/0468）；分组仍 intermediate；覆盖仅 SUT=0（相对本趟 unmatchedScanned）
- 证据：`tmp/product-mgmt/_assert_scan_1.json`、`_coverage_1.json`、`_scan_done_1.json`
- 遗留：推送下周一；产品要素库无 pageId 仍为预期

## 2026-09-05 · Zcode Lead — 收工回报：agent-log 收工条目梳理完成（回链本会话开工条目）
- 完成：主文件 112 条目梳理——**27 条保留**（未闭环开工/进行中、现行裁决、各工作线收官），**88 条归档**至 `docs/superpowers/agent-log-archive-2026-09-05.md`（历史不删只归档，原文未改写）；顺带清理旧文件头模板残留
- 验收：两路只读 Explore 盘点（112 条目闭环状态分组 + 82 个 commit hash 审计**全部有效无孤儿**）；归档文件头记录取代链（intermediate 三级回退等）与「未推送」状态勘误说明；主文件重排后人工通读核对
- 遗留移交：①主文件现存两条**在途开工未收工**（Cursor 10:39 systemId=1 全量扫描、Zcode 10:38 链B用信支线）——状态以各自会话后续收工条目为准 ②软著申请信息表 8 项仍待用户确认 ③KB Insights A1 回填 `--apply` 仍待 KB 线冷却 ④后续条目归档惯例：收工回链后如确认闭环且无未决遗留，可在下次梳理时移入归档
- commit 开工 `faa204b`；本收工 **`6976ff2`**

## 2026-09-05 · Zcode Lead — 开工声明：agent-log 收工条目梳理（归档分流）
- 开工：本会话。用户指示整理 agent-log 中与当前开发方向无关或冲突的条目
- 范围：`docs/superpowers/agent-log.md`（重组）+ 新建 `docs/superpowers/agent-log-archive-2026-09-05.md`（历史归档）；子智能体只读调研不写文件
- 禁入：工作区全部未提交改动（config/.env.example、根目录 png 等）、其他在途线文件
- 方式：主会话编辑（单文件写点）；两路只读 Explore 并行盘点条目闭环状态与 commit hash 有效性
- 原则：**历史不删只归档**；在途/未闭环条目与现行裁决（B 级缓行、CHANGELOG 废止等）必须保留在主文件

## 2026-09-05 10:40 · Cursor Lead — 收工回报：产品 KB 卡挂载收尾（回链 10:37）
- 完成：`product_stage`→**0811**、`product_core_mapping`→**0812**；`product_element`/`product_query` 注明 intermediate 父目录；through-report / todo ⑥ 更新
- 验收：API 五叶+0230/0231 intermediate；交易已在对应叶子（本收工不改 DB）
- 未改：`product_library.json`（Zcode 禁入）；要素 pageId 空保持预期
- commit 开工 `c15308c`；卡片回写 **`a56d133`**

## 2026-09-05 10:39 · Cursor Lead — 开工声明：正式 systemId=1 全量 scan-menu 修复
- 开工：10:39。用户「接下来修复正式 systemId=1」；scan 已启 `247e4ec8-a11b-4d57-b432-e744cf594025`
- 范围：MySQL `system`/`system_page`（仅 systemId=1 扫描写回）；本文件 + todo/plan 勾选；`tmp/product-mgmt/_scan_*_1*`
- 禁入：`src/**`、`data/kb/**`（他线 10:37 KB 挂载）、`9000000813`、推送 POST、`config/.env*`
- 注意：与 Zcode 10:38 链B用信同 SUT；本线占 executor LMY 槽，不碰 Playwright MCP 会话
- 方式：轮询 scan → 断言对公客户管理可导航+UML / 产品管理五叶

## 2026-09-05 10:38 · Zcode Lead — 开工声明：链B用信支线（授信批复项下对公用信申请全链）
- 开工：10:38。用户指示「继续补债，A7 影像上传搁置」——补 P3 遗留债：链B授信批复 DGSXPF20260905020004 项下发起对公用信申请（贯通验证企业190416）并走完 wf_usecredit_001 审批链至批复生效
- 范围：`tmp/e2e/`（脚本+截图+报告）、`docs/superpowers/agent-log.md`、`docs/superpowers/research/2026-09-05-engine-closure-phase2-plan.md`（§8 补记）、必要时 `data/kb/flows/credit_usage.json`；SUT test.creditv5p2 实机操作（701994/WN0001/135292 账号切换）
- 禁入：`config/.env*`（他线 WIP）、`data/kb/flows/product_library.json`、菜单/产品线文件、无关 png；不动存量盛达单据
- 方式：主会话 Playwright MCP 有头浏览器配方实操（r13/batch 报告配方），run 途中只读 CDP 实时监控；子智能体不派发

## 2026-09-05 10:37 · Cursor Lead — 开工声明：产品 KB 卡挂载收尾（0811/0812）
- 开工：10:37。菜单 intermediate 修复后，回写 `product_stage`/`product_core_mapping`（及要素卡目录说明）为正式 functionId **9000000811 / 9000000812**；更新 todo/through-report；不改交易数据（已迁）
- 范围：`data/kb/flows/product_stage.json`、`product_core_mapping.json`、`product_element.json`、`docs/superpowers/agent-log.md`、`docs/superpowers/todo-list.md`、`tmp/product-mgmt/through-report.md`
- 禁入：`product_library.json`（Zcode 10:38 声明禁入）、`src/**`、`scripts/**`、`config/.env*`、信贷/用信线、菜单扫描代码
- 方式：主会话只改正文挂载说明与 source；要素库 pageId 空属预期（见 10:31）不硬补

## 2026-09-05 10:31 · Cursor Lead — 澄清：要素库无 pageId 预期；systemId=1 需补扫；推送下周一
- 完成：产品要素库无 pageId 记为预期；推送改下周一；todo/plan 遗留已改
- 注意：正式 `1` **尚未正确**——误 import 后「对公客户管理」等仅剩 intermediate、无同名可导航叶；产品管理五叶尚可。需对 `1` 全量 scan 才齐

## 2026-09-05 09:50 · Cursor Lead — 收工：菜单 E2E（回链 09:24）
- 完成：隔离系统 **信贷系统-菜单导入测试** `9000000813`；import 232 intermediate；scan completed（429/417 created）；覆盖 **仅 SUT=0 PASS**；wire 推送过滤 intermediate OK
- 完成：修时序——`fillEmptyPageIds` 后再 `adoptModelingUmlEcdUnderSystem`；存量补 adopt 103；characterize menu-scan / uml-adopt OK
- 证据：`tmp/product-mgmt/e2e-menu-coverage-report.md`、`_push_wire_9000000813.json`；开工 commit `b5f4b7f`
- 遗留：产品要素库无 pageId；systemId=1 曾误 import 一次另议；服务需重启才带新 adopt 时序

## 2026-09-05 09:45 · Zcode Lead — P3 收官补记：链B授信批复生效（回链 05:30）
- 完成：WN0001 处理链B授信二次调查（wf_credit_001_007，授信链特有节点）——流程操作=「同意」→流程结束确认。终态：授信 DGSX20260905056032=通过，**批复 DGSXPF20260905020004（贯通验证企业/100万/12月）自动生成已生效**。
- 完成：**链B主链全通**（评级申请→二次调查→评级生效→授信申请→授信二次调查→授信批复生效）；节点谱系新知=授信审批链 001信贷调查→007二次调查(单节点终结)，与用信链 002/003/004 三节点不同——已补 phase2-plan §7。
- 注意：链B授信项下用信/额度管控支线配方在 KB（credit_usage/limit），按需续跑。

## 2026-09-05 09:24 · Cursor Lead — 开工声明：菜单 E2E（导入→扫描→覆盖 diff→推送）
- 开工：09:24。用户确认「JSON=初始草稿；真实页面扫描=导航地基」后启动 E2E
- 范围：`docs/superpowers/plans/2026-09-05-menu-intermediate-e2e.md`（勾选进度）、`docs/superpowers/agent-log.md`、`tmp/product-mgmt/e2e-menu-coverage-report.md`（gitignore 验收）；MySQL `system`/`system_page`/`menu_change_log`（systemId=1 导入+扫描写回）；控制面 API 调用（不改 `src/**` 除非扫出 blocker）
- 禁入：信贷/引擎/KB 线、`config/.env*`、无关 png、他线 WIP；不恢复 umlEcd 白名单、不按活动拆导航叶
- 方式：主会话湿跑 A→B→C→D；`import-json?autoScan=false` 再单独 `scan-menu`

## 2026-09-05 09:16 · Cursor Lead — 取消白名单：叶子一律 intermediate + 扫描回填 umlEcd
- 完成：去掉 `INTERMEDIATE_LEAF_UML_ECDS`；非顶层叶子一律 intermediate（跨系统）
- 完成：`menu-scan-uml-adopt` + applyScanPlan 同名/pageId 回填建模 umlEcd；E2E 计划改无白名单版
- 验收：characterize import / uml-adopt / menu-scan OK
- 真菜单录全仍靠扫描 + 覆盖 diff，不能事先保证

## 2026-09-05 05:30 · Zcode Lead — P3 链 B 打通：评级生效+链B授信提交进审批（回链 03:50 计划）
- 完成：**P3 全链达成**——①135292 评级二次调查 PJ20260901016003「同意」提交（评级链选项=同意/不同意/退回，单节点终结）→ 评级生效（通过/评级D/2027-08-19）；②**链B授信 DGSX20260905056032（贯通验证企业190416/100万/12月）提交进审批中**（选人黄亮）。
- 完成：**勘误**——交接文档「授信 DGSX20260901056031 解锁」有误：该单是盛达(链A)的授信且已审批中，与链B无关；链B正确路径=为贯通验证企业新建授信（双重硬前置=生效评级+无在途，均满足）。
- 完成：**分项额度明细 SUT 深坑破解**（最大收获）——分项名称=TsscMultiTree 体系树（getTree 接口），nodeClickFun 有 serchHandel NPE 缺陷致选中值不落 model→后端报「授信产品编码不能为空」；绕行=fetch getTree 拿叶子编码 → ElFormItem.form.model 直写 **crgPdNo(编码键,成功单实证)/crgPdNm/rvlInd/subCrgln/avlLmt** → $emit('input') 回显 → 移除 disableBtn → click。credit_application 卡 +3 规则（7→10）。
- 完成：附带实证「上一步重置表单」——向导上一步会清掉未保存的 UI 值，关键字段必须真实键盘 fill 或 Vue model 直写且先保存再翻步。
- 注意：本 P3 全程 Playwright MCP 有头浏览器人工配方（非引擎动作）；全程遇到 tsscMutilDialog 空壳拦登录（reload 解决）、会话超时踢登、run_code 30s 超时打断表单填写等环境坑，均已绕行。
- 验收：授信列表 DGSX20260905056032 行=审批中（截图+列表行文本实证）；KB 卡 JSON 校验通过；phase2-plan 文档已补 §5/§6 执行记录与深坑实录。

## 2026-09-05 04:58 · Zcode Lead — 收工回报：存量红校准 + trajRow 修复 + B 级审查（回链 04:28）


- 完成：`bfda8c9` trajRow 悬空引用修复——resolveRecordingSystemId 返回 {systemId,functionId} 双值；bug 自 5c70c68 拆分前即存在，AI 记忆事实包（AI_MEMORY_FACT_PACK）自开关引入起从未实际生效，本修复后恢复
- 完成：`a7c3a9a` 三存量红校准（逐断言语义判定，全部为 4145e23 合理演进或卡片实证修正，非行为回归）+ **意外挖出真 bug**：K6 三卡（合同/电子签/担保合同）rules(11)/field_deps(12) 自建卡为备忘字符串——kb_rule/kb_field/**flow_summary_text(KB 注入主链)** 对其必炸，被旧断言提前失败掩盖至今，已转对象形态
- 完成：`b3c37b3` B 级真伪审查——**四项全部判缓行**（B1 形态错配/B2 零消费者/B3 失败无长尾/B4 痛点=没人审），报告 `docs/superpowers/research/2026-09-05-b-tier-demand-review.md`（各留重新表述种子+触发条件）
- 验收：**verify-all 历史首次 ALL GREEN**（86 项，含新入闸 kb-insights 22 checks）；record-status-v2/batch-task-progress/kb-actions 全绿
- 移交：①K6 三卡 preconditions/exceptions 仍为备忘字符串（消费端 str() 安全，recall 摘要可读，暂不动）②卡 menu_path `→` 形态已判 unparsed（书写规范见 KB 交接文档 §6）③B 级若用户坚持推进某项，优先 B1 巡检种子/B4 `--list`（均半天级）

## 2026-09-05 04:28 · Zcode Lead — 开工声明：存量红校准 + trajRow bug 修复 + B 级真伪需求审查
- 开工：04:28。用户指令三项：①特征化预期校准（3 存量红：kb-actions / record-status-v2 ×2 断言 / batch-task-progress 崩溃）②trajRow 存量 bug 修复（recording-runner fact-pack 引用作用域外变量，AI 记忆事实包静默失效）③B1-B4 真伪需求批判审查（纯分析）
- 范围：`scripts/characterization/{characterize-kb-actions.py,characterize-record-status-v2.mjs,characterize-batch-task-progress.mjs}`、按语义判定结果可能触及 `src/services/trajectory/{trajectory-batch-service,trajectory-attach-runner,trajectory-recording-runner,recording-runner-step-context}.js`、`data/kb/flows/credit_usage.json`（若 kb-actions 校准需动卡——**先核查 KB 线在途**）、新建 `docs/superpowers/research/2026-09-05-b-tier-demand-review.md`、todo-list（如需）
- 原则：**校准≠改绿**——逐断言核对原始意图 vs 现行为：行为合理演进→更新预期；行为回归/产品缺陷→修产品不修测试
- 禁入：`data/kb/**` 其他文件、`scripts/kb/**`、他线 WIP；Cursor 线（04:12/04:20 收工，产品线挂载纠偏）范围不碰
- 方式：主线程直接实施（小改动+需逐处语义判定，派发性价比低）；审查项产出研究报告

## 2026-09-05 04:20 · Cursor Lead — 收工回报：产品管理扁平挂载纠偏（回链 04:12）
- 完成：数据——新建 `9000000811` 产品阶段管理（RES24008/ZJJK00095902）、`9000000812` 核心产品映射（RES04066/ZJJK00095454）；8 条 traj 迁离 0230；0230/0231 `removed_flag=1` 并清空错误 xpath/pageId
- 完成：扫描——`buildScanApplyPlan` xpath(data-id) 优先、错名改名、异 xpath 同名不覆盖；`applyScanPlan` 写回 name；characterize-menu-scan 新增 2 case 全绿
- 验收：`tmp/product-mgmt/_flat_mount_verify.json`；`node scripts/characterization/characterize-menu-scan.mjs` OK
- 开工 commit `565252c`；本收工另提交代码+todo

## 2026-09-05 04:12 · Cursor Lead — 开工声明：产品管理扁平挂载纠偏（方案 A）
- 开工：04:12。用户认可扁平方案——不建「产品信息管理」中间层；推送不带该层
- 范围：`docs/superpowers/specs/2026-09-05-product-mgmt-flat-mount-design.md`、`docs/superpowers/plans/2026-09-05-product-mgmt-flat-mount.md`、`docs/superpowers/research/2026-09-05-product-mgmt-menu-sut-vs-db.md`、`docs/superpowers/agent-log.md`、`docs/superpowers/todo-list.md`；MySQL `system`/`trajectory`（产品管理相关 id）；可选 `src/services/menu-scan-service.js` + characterize-menu-scan；`tmp/product-mgmt/` 验收（gitignore）
- 禁入：信贷/引擎 WIP、KB Insights、`config/.env*`、无关 png、他线未提交改动
- 方式：主会话数据纠偏（API/SQL）+ 扫描 xpath 优先小改；先 commit 本声明与 spec

## 2026-09-05 04:1x · Zcode Lead — KB Insights 实施收工回报（回链 02:32 开工声明，9 任务全闭环）
- 完成：**A1/A2/A3 全部落地，14 提交**（`794698a`→`b7715b6`）：matcher 三态解析/listFlowCards 只读器/两 dao 聚合/coverage-service/change-impact-service（含 detectStaleCards）/4 新端点（kb/cards、kb/stale-cards、hierarchy/coverage、nodes/:id/change-impact）/verify-all 接线/A1 回填脚本（只创建，`--apply` 后置）
- 验收：characterize-kb-insights **22 checks 入闸**；verify-all 唯一红=存量 kb-actions（基线一致无新增回归）；**真机冒烟全过**（4098 临时实例已停，4097 未动）——kb/cards 透传卡片、stale-cards **发现真实漂移**（「审批待办」卡缺「任务事项」段→possibly-stale）、coverage 出真实功能行、404/400 守卫精确
- 评审修复 2 轮：Task 3 批量成功字面量 `'success'`→`'recorded'`（ENUM 实证，计划笔误）；Task 6 补 ：id 404 守卫（spec §5 遗漏）；另计划勘误 3 处（matcher 首段 type 过滤、config import 路径、轨迹号正则 15+ 位+交易区间展开）
- 注意：①派发通道持续故障（captcha verify failed ×6），Task 4 起主线程实施+代评（纪律同 TDD+验证+ledger）②deferred minors 10 条全部分诊 keep-deferred（清单在 SDD ledger，工作区已按技能清理；关键一条：KB 卡 menu_path 存在 `→` 分隔形态，建议 KB 线统一 `/`）③**A1 回填执行待 KB 线冷却**（data/kb 无未提交改动时单独任务跑 `node migrations/backfill-kb-source-refs.mjs --apply`）

## 2026-09-05 03:50 · Zcode Lead — 阶段收尾：草稿清理定案 + 下阶段计划（回链 03:00）
- 完成：**用户授权清理后定案**——盛达 8 笔待发起草稿（12031/033-039）SUT deleteBefore 钩子静默拒绝（无 toast/无弹窗/reload 无效/编辑页仅行级删除无整单入口），前端不可清理，保留并记录。
- 完成：阶段收尾文档——`research/2026-09-05-engine-closure-phase2-plan.md`（成果盘点/8 条经验沉淀/P3-P6 下阶段排期）；`2026-09-04-engine-closure-handover.md` 顶部加收尾快照标记；todo-list ⑤ 工作线改版（P1/P2 达成转下阶段）。
- 下阶段排期：P3 链 B 打通（135292 评级→授信解锁）→ P4 KB 扩卡 24→28（run26 配方沉淀）→ P5 引擎环境缺口（已登录跳过/验证码/锁定轮询）→ 单会话全自主复跑终验。
- 注意：commit 仅含文档三件 + agent-log/todo-list；无代码改动。与 Cursor 03:32 SQL 线同文件不同段（我改⑤引擎线、其声明⑥产品线），顺带携带其条目快照。

## 2026-09-05 03:36 · Cursor Lead — 收工回报：遗留交易 function_id SQL 纠正（回链 03:32）
- 完成：13 条从 `9000000230` 改挂——0740×7（#41/42/43/44/52/55/68）、0467×2（#47/60）、0468×4（#51/54/61/66）；仅当原 fid=0230 才 UPDATE；事务提交
- 验收：`tmp/product-mgmt/_remount_sql_result.json`；0230 剩余 8 条均为映射/阶段（#46/48/50/56/58/59/511/513）
- 注意：本机 DB 隧道曾断（13306 ECONNREFUSED），已用 SSH `-L 13306` 拉起后执行；未改 PATCH API / src
- commit 开工 `cb4e1b3`；收工 docs **`459445e`**

## 2026-09-05 03:32 · Cursor Lead — 开工声明：SQL 纠正遗留交易 function_id（A/B/C）
- 开工：03:32。按调研清单批量 `UPDATE trajectory.function_id`：产品库→0740、查询→0467、要素→0468；**不改**映射/阶段（缺独立 function，仍寄 0230）
- 范围：MySQL `js_gen.trajectory`（仅下列 id）；`docs/superpowers/agent-log.md`、`docs/superpowers/todo-list.md`；可选 `tmp/product-mgmt` 验收快照（gitignore）
- 禁入：`src/**`、`scripts/**`、信贷/引擎 WIP、KB Insights 线、映射/阶段 traj（#46/48/50/56/58/59/511/513）、`config/.env*`
- 方式：主会话只读核对后 SQL UPDATE；改前 SELECT 快照；改后 API list 复核

## 2026-09-05 03:00 · Zcode Lead — 引擎自主闭环 P1 达成 + 批量自批第二波（P2）收工
- 声明补录：本会话接手 `2026-09-04-engine-closure-handover.md`（知识库会话移交），当时未按协议先发开工条目（疏漏），现以收工条目补录全过程。工作范围=`scripts/controller/actions/js_snippets/{xhr_log,guarantee_intro_snippet}.py`、`scripts/controller/actions/_table.py`、`scripts/prompts/agent-tools-table.md`、`scripts/characterization/characterize-{introduce-guarantor,xhr-log}.py`、`tmp/kb_i5_usage26*` 驱动脚本（不 commit）。禁入区=Cursor 产品线（product_library.json/product_element.json/.env.example）与 KB Insights 线（src/**、migrations/**）——未触碰。
- 完成 P1 引擎自主闭环：**YXPC20260905012040 纯引擎提交进审批（tid=505，run26→26j 六轮迭代）**；引擎侧两改动 ① `introduce_guarantor` VERIFY 收紧（dialog/drawer/message-box 内表 closest 一律排除 + 命中行「与借款人关系」单元格须含 relation——run24/25b 假阳性根治，实测 dup:false 首验 + dup:true 幂等复验均正确）② xhr_log hook 补 requestBody 捕获（prompts 早已承诺的「保存请求体核对」兑现，本轮凭它实锤 primWrntTp/aplyAmt/execYrIntrt/rpmd/rtlLoanDtlInf 全链持久化）。pin×2 更新+Node 语法验证全绿。
- 完成 run26 系列根因链（驱动层，全部有报告实证）：run26=残留 tsscMutilDialog 空壳+孤儿 .v-modal mask 拦截全部 CDP 坐标点击→run26b=担保三段闭环全绿（radio checked/保存体 primWrntTp=3/ig VERIFY 收紧版）；run26c=救援分支部分补填被表单校验拦；run26d=分区保存改 JS 合成 b.click()（el-button 响应合成，坐标 trusted click 不可靠）；run26e/f=利率 4 必填（档次 set_vue_model intrtLvl=L01/LPR disabled set_vue_model lprIntrt）+ 分区保存按 header 定位（v3 head-match）；run26g/h/i=有效期 Vue $emit('input',[s,e]) 直写（键盘/native 均不进 daterange 组件）+ 三许可证编号 native 补填 → **NextCheck reason=操作成功 全绿**；run26j=纯提交流程收尾（notify 实锤「流程提交成功！」）。
- 完成 P2 批量自批第二波（Playwright MCP 有头浏览器人工配方，交接 batch_appr.md 照抄）：12040 与 032 两笔四节点全走完（002 WN0001 二次调查是否上报=否 → 003 701994 审查选人黄亮 → 004 WN0001 审批意见结论=同意+流程结束确认）→ **批复 DGYXPF202609050016008（12040）/ DGYXPF202609050016009（032）自动生成且已生效**，累计 6 笔批复。
- 注意：run26 首跑 S8 gate 的 reason=「操作成功」未被 gate 判过闸（差一次下一步），已在 run26j 用独立提交脚本绕过——后续驱动脚本 gate 判定需把 reason=操作成功 当作过闸信号。
- 注意：本会话中途用户重启过 ZCode（MCP 浏览器会话清空重登过一次）；登录循环中 SUT 前端 5 类 console error（btnoNo undefined/addBefore false）为存量缺陷，不阻断审批流。
- 遗留移交：①盛达草稿堆积清理决策待用户（015-018/021-028/030-031/033 等）；②「引擎全自主闭环」严格判据（单会话内从登录到审批中零人工）本轮未满足——登录复用+选人节点账号切换仍需驱动层编排，配方已全部在 run26* 脚本；③P3 链 B（135292 评级）未动；④r26_monitor.py 只读监控脚本模式值得沉淀（实时 formErrors 诊断立功两次）。

## 2026-09-05 02:32 · Zcode Lead — 实施开工声明：KB Insights 计划执行（SDD 逐任务循环，9 任务）
- 开工：02:32。计划 `docs/superpowers/plans/2026-09-05-kb-insights.md`（已批准 spec 落地）；SDD 工作区 `.superpowers/sdd/2026-09-05-kb-insights/`（git-ignored，ledger 记进度）
- 范围：新建 `src/services/{menu-path-matcher,kb-flow-cards,coverage-service,change-impact-service}.js`、`src/routes/v2/kb.js`、`src/dashboard/api-docs/groups/kb.js`、`scripts/characterization/characterize-kb-insights.mjs`、`migrations/backfill-kb-source-refs.mjs`（只创建不执行）；修改 `src/routes/v2/{hierarchy,system-mgmt,__init__}.js`、`src/dao/{trajectory-dao,batch-recording-dao}.js`、`src/dashboard/api-docs/{catalog.js,groups/hierarchy.js}`；条件项 `scripts/refactor/verify-all.sh`（仅冷区时接线一行，接线前另行核查）
- 方式：逐任务派实施子智能体（不 commit，主线程验收后按任务代提交）+ 任务评审；特征化文件为共享串行点故严格顺序执行
- 禁入：`scripts/kb/**`、`data/kb/**`（Cursor I10 在途 product_core_mapping + KB 线热区；Task 8 dry-run 对 data/kb 仅只读）、工作区他线 WIP、`scripts/characterization/**` 既有文件（新建 characterize-kb-insights.mjs 除外）
- 与在途声明核查：Cursor 02:28 I10 范围（data/kb+tmp+docs）与本范围零交集 ✓

## 2026-09-04 · Zcode (uara_V1.2) — 引擎自主闭环冲刺收尾：038 复现 + 交接文档
- 完成：038 担保场景复现（用户参与：手动填七模块/引入保证人/触发异常通知）——**关键纠错**：NextCheck 拒绝非"完全静默"，实为 **3s el-notification（exception-message 类，不含 error 字样）**，超时消失后不可追溯；error_notify.py 据此修正（三特征判定）+ 新增 JS_NOTIFY_HOOK（MutationObserver 持久捕获 window.__notify_log），MCP 现场 hook 捕获验证通过（11:39:49 完整捕获「7 模块未保存」全文）
- 完成：收尾交接文档 `docs/superpowers/research/2026-09-04-engine-closure-handover.md`——当前位置（6 笔审批中+4 笔批量通过）/已定案结论（页面形态 9 条/SUT 缺陷 9 条/动作谱系 12 个/账号数据）/遗留问题（引入保证人 VERIFY 假阳性收紧/七模块完整性驱动 diff/环境缺口 3 条）/下批路线 P1-P6/快速上手命令
- 注意：run25b 发现 introduce_guarantor VERIFY 假阳性（038 引擎报 rows=1 但 MCP 核实列表空——误读含同表头表），收紧修法已写入交接文档 §3.1；引擎自主闭环 ~90%，剩 VERIFY 收紧+七模块 diff 两件事

## 2026-09-04 · Zcode Lead — AI 智能录制软著材料全套产出（agent team 并行）
- 完成：`docs/软著/AI智能录制/` 三件套——①源代码鉴别材料.docx（60 页恒 50 行/页，前 30 页 Python `scripts/controller/actions/_replay.py→replay_js.py`、后 30 页 Node `replay-batch-runner.js→page-locator-helpers.js`，页眉含软件名+PAGE 域）②软件说明书.docx（封面/目录/正文，已嵌入 11 张真实截图，图号按章节重编，无占位符残留）③申请信息表.md（程序量约 12.4 万行：JS 58%/Python 42%，300 字软件简介，8 项待确认清单）
- 申报信息（默认值，可改）：基于大模型的浏览器自动化录制系统 V1.0 / 天阳科技 / 完成日期 2026-08-31 / 未发表 / 独立开发
- 截图链路：本地 4097 + vue dev(3000) + 独立 Playwright 实例（共享有头浏览器被占用勿动）；**临时改过 vue-project vite.config.ts 代理指向 localhost:4097，已恢复**；localStorage 注入自制 JWT + 拦截 /api/v2/auth/me 返回"黄某某"过登录态；截图脚本存 tmp/ruzhu-screenshots*.mjs（可重跑）；软著目录被 .gitignore 不入 git
- 注意：vxe-table 勾选框选择器是 `.vxe-cell--checkbox`；批量推送弹窗需先勾选记录；假 token 会触发"登录认证失败"toast（等 4.5s 再截）
- 进行中：申请信息表内 8 项待用户确认（统一社会信用代码/简称/是否合作开发/代理机构等）后才可正式提交

## 2026-09-04 · Zcode (uara_V1.2) — CHANGELOG.md 移除（裁决：变更史以 git commit message 为准）
- 完成：删除 CHANGELOG.md（23eed6d，584 行历史以 git 为准）；修正引用——`characterize-phase-highlight-screenshot.mjs`/`characterize-sys-msg.mjs` 删 CHANGELOG 断言（后者在 verify-all，已实测转绿）、`orchestration/README.md`+`orchestrator-prompt.md` 从共享文件清单移除并注明裁决、AGENTS.md 收工区加「不维护 CHANGELOG」条
- 注意：isExport 改动曾打破 `characterize-sso-auth.mjs` 对 `countByRecordStatus` 调用串的 pin，已随本次更新 pin（verify-all 该项转绿）
- 注意：**本会话期间有并行会话活跃**（3f16901 KB 扩卡 / 7781fc4 read_error_notify 等提交，js_snippets 三文件未提交改动在工作区，本会话未触碰）
- 注意：一次 `git stash pop` 误弹了旧 stash@{0}（wip: before pulling trial-log branch），已全部退回，**stash@{0} 原样保留**，其 CHANGELOG/agent.mjs 的 WIP 仍在 stash 里
- 注意：`characterize-kb-actions.py` 在 HEAD 上即失败（断言「对公授信申请」allow 含「撤销」，实测只有 查看/流程轨迹/流程取回）——存量失败与本次无关，待 KB 卡内容与断言对齐

## 2026-09-04 · Cursor (uara_V1.2) — 菜单 JSON 九条规则回归 18/18（T5 收官）

- 完成：`characterize-menu-import-nine-rules.mjs` 真机覆盖 R1 快照 / R2·5.3 换父 / R3·5.4 交易跟随 / R4·5.5 改名 / R5 新增 / R6·5.7 收编 / R7–R8·5.8 删·留 / R9·5.9 下线 + 推送 menuVersion/removed/归属。全绿。todo-list ③ 菜单切换标收官。
- 注意：5.4 须「同 pageId 换到**另一** umlEcd 功能」才迁 `function_id`；同节点仅换父不改 traj 挂载（节点 id 不变）。

## 2026-09-01 — 推送菜单 D1+D2（partner stub）实现

- **完成:** POST/GET `.../nodes/:id/push-menu`；v1.2 组包；状态落库 + 5s auto-sync；`pushMenusToPartner` stub；CHANGELOG 清理至仅保留 ≥2026-08-15。commits: `e4c2b4a` `4892a08` `24cf70b` `9112955` `b8ed35d` `cd1c344`（设计 `bf5c929`）。
- **进行中:** 无。partner 真接收接口就绪后只填 stub 函数体。
- **注意事项:** 前端推送按钮未做；D3–D5 未做；多实例依赖 GET 纠偏。

## 2026-08-24 ~ 25 · Zcode (uara_V1.2)
- 完成：824 冲刺三项落地 + 湿测通过（partition-via-pid / v3-payload-size ②③ / V3.1 §8 七类型）；830 格式对齐落地（rect_norm 录制侧、collapse type、attr 字段）
- 完成：报文捞取 MVP（`dfb5c9e` 改名 92 文件、`8148f72` elk-msg-extract CLI、`1fcd1b9`/`b837d67` 契约对齐+回填验证 122/122；码值字典 `2fd2046` 挂起）

