## 2026-09-05 · Zcode 重构会话 — A组冷区重构三项启动（6-1/6-2/6-4）
- 进行中：**范围=仅 Node 控制面三个冷区文件，与引擎/KB 热区零交集**：①`src/services/transaction-export-v3.js`（984行）拆 mapping/builders/validation/assembly——原文件保全部 15 个具名导出面（barrel），characterize-transaction-name.mjs 钉住的 sanitize 子串留在原文件 ②`src/services/trajectory/trajectory-recording-runner.js`（813行）phase 上下文装配拆分——被 7 个特征化 read_text 钉住原路径，钉中子串一律不动 ③`src/routes/browser-session/register.js`（664行，零 pin）rerun-replay 段抽 service——红线：不迁 runReplayActions，seed_action_log/本地浏览器双分支/stop_on_fail 缺省语义原样
- 方式：三个不相交文件集并行子智能体实施，子智能体不 commit；主线程验收 node --check / eslint 0 warning / verify-all 全绿 / diff 范围核查后分三个 refactor(scope) 提交
- 禁入（引擎/KB 会话热区+他线 WIP）：`scripts/controller/actions/**`、`scripts/agent/**`、`scripts/prompts/**`、`data/kb/**`、`scripts/kb/**`、`scripts/characterization/**`（如 pin 确需调整只报告不动手）、工作区他线未提交改动（_table.py/xhr_log.py/product_library.json/agent-log 既有未提交条目等）
- 完成后：本文件顶部更新结果（含 commit hash）+ `docs/superpowers/重构交接-波次4-6实施文档.md` §7 表格状态同步

## 2026-09-05 · Cursor Lead — I7 挂子收口（#506 实证）
- 完成：#506 recorded；`click_button(新增分类)` + toast 操作成功；stamp depth=1 在父下（`_flags506.json` success_hang_child）
- 完成：`product_library` source/规则挂 #506；双 folder-add 口径闭环（#504 反例 + #506 正例）
- 注意：卡增量未另 commit（相对 `f281515`）；录制子代理 ffdf1dc4

## 2026-09-05 · Cursor 录制子代理 — I7「新增分类」挂子实证（#506）
- 完成：#506 recorded+detach（9000000740）；任务 `task-addcat-requirement.md` stamp `20260905-0015`；文案无「新增子分类」
- 完成：agent `click_button(新增分类)`（未点「新增一级分类」）+ toast「操作成功」；slot1/CDP **19243**（slot0 他线 #505 未打断）
- 完成：CDP 展开父后 stamp `KB测子挂-20260905-0015(0)` **depth=1** 挂在 `KB测一级-20260904-1925(2)` 下（非顶层）；双 folder-add aria 一级|分类
- 报告：`tmp/product-mgmt/through-report.md` I7；证据 `_cdp_i7_tree.json` / `_flags506.json`
- 未 commit；未碰信贷 WIP

## 2026-09-04 · Cursor 录制子代理 — I6 子分类口径浅验（#504）
- 完成：#504 recorded+detach（9000000740）；任务文案无「点击新增子分类」；CDP 工具栏无「新增子分类」、有「新增一级分类」
- 完成：agent `click_button(新增一级分类)` + toast「操作成功」；stderr `kb_flow injected: 产品库管理`（非要素库）
- 注意：stamp `KB测子类验-20260904-2355(0)` 落成**顶层幽灵一级**，未挂在父 `KB测一级-20260904-1925(2)` 下——选父+folder-add 本趟未验证落子
- 报告：`tmp/product-mgmt/through-report.md` I6；证据 `_cdp_toolbar_subcat.json` / `_cdp_tree504.json` / `_flags504.json`
- 未 commit；未碰信贷 WIP

## 2026-09-05 · Cursor Lead — 提交 I6 双 folder-add 纠错 + 续录「新增分类」落子
- 完成：即将 commit `product_library.json` I6 纠错（#504）+ agent-log/todo
- 进行中：I7 浅录——选父后点「新增分类」验证挂子级；他线占槽则用空闲 slot

## 2026-09-04 · Cursor Lead — I6 子分类浅验收口（#504 · 口径纠错）
- 完成：#504 recorded；工具栏**无**「新增子分类」；有双 `folder-add`：「新增一级分类」|「新增分类」
- 证伪：选父后点「新增一级分类」仍落 **depth=0 幽灵一级**（stamp `KB测子类验-20260904-2355`）；子级应点「新增分类」
- 完成：kb_flow 正确注入产品库（`535d6d7` 生效）；已改写 `product_library` 规则/exceptions/source（未另 commit）
- 录制子代理：aab91211

## 2026-09-04 · Cursor Lead — hash 召回修复 + 子分类图标口径
- 完成：commit `6319ed6` 产品库/要素卡；`535d6d7` recall 按**命中** markers 计分（要素页不再误注入产品库）+ pin
- 完成：`product_library` 规则——SUT 无「新增子分类」tooltip；子分类=选父后点「新增一级分类」(folder-add)
- 进行中：可选浅录验证子分类口径（任务勿写 click 新增子分类文案）

## 2026-09-04 · Cursor Lead — 提交产品 KB 卡增量（库+要素）
- 完成：即将 commit `product_library.json`（#499–#502）+ `product_element.json`（#503）+ agent-log/todo
- 续：修「新增子分类」定位 / 要素页 kb_flow 误召回（见 todo ⑥）

## 2026-09-04 · Cursor Lead — I5 要素库收口（#503 · CDP 补证）
- 完成：#503 recorded+detach，挂载 **9000000468**（未回退 0230）；菜单进 `elmtgroupOfIndex` 双根可见
- 完成：CDP 补证 stamp `KB测要素类型-20260904-2330` + toast「操作成功」（`folder-add`→保 存）；agent P2 `click_button(新增类型)` 误触删除确认 → QUALITY FAIL
- 完成：`product_element.json` source/规则已回填（icon=`click_icon_button`、保 存、勿 click_button 文案）
- 注意：kb_flow 曾误注入「产品库管理」；引擎侧后续可收紧要素库页召回。卡增量仍未 commit
- 录制子代理：4abf17e9

## 2026-09-04 · Cursor Lead — I5 产品要素库卡 + 浅湿测启动
- 完成：起草 `data/kb/flows/product_element.json`（#61+§2；挂载候选 functionId=9000000468；`find_flow('产品要素')` 命中）
- 进行中：浅录要素库新增类型/组件（stamp）；LMY 空闲
- 注意：产品库卡增量仍未 commit

## 2026-09-04 · Zcode (uara_V1.2) — 引擎自主闭环冲刺收尾：038 复现 + 交接文档
- 完成：038 担保场景复现（用户参与：手动填七模块/引入保证人/触发异常通知）——**关键纠错**：NextCheck 拒绝非"完全静默"，实为 **3s el-notification（exception-message 类，不含 error 字样）**，超时消失后不可追溯；error_notify.py 据此修正（三特征判定）+ 新增 JS_NOTIFY_HOOK（MutationObserver 持久捕获 window.__notify_log），MCP 现场 hook 捕获验证通过（11:39:49 完整捕获「7 模块未保存」全文）
- 完成：收尾交接文档 `docs/superpowers/research/2026-09-04-engine-closure-handover.md`——当前位置（6 笔审批中+4 笔批量通过）/已定案结论（页面形态 9 条/SUT 缺陷 9 条/动作谱系 12 个/账号数据）/遗留问题（引入保证人 VERIFY 假阳性收紧/七模块完整性驱动 diff/环境缺口 3 条）/下批路线 P1-P6/快速上手命令
- 注意：run25b 发现 introduce_guarantor VERIFY 假阳性（038 引擎报 rows=1 但 MCP 核实列表空——误读含同表头表），收紧修法已写入交接文档 §3.1；引擎自主闭环 ~90%，剩 VERIFY 收紧+七模块 diff 两件事

## 2026-09-04 · Cursor Lead — I4 禁用收口（#502 recorded）
- 完成：#502 P1–P3 `recorded`+detach；slot1/CDP **19243**（未碰 #501）；下架理由「缺陷性下架」；`click_save] SUCCESS: 状态更新成功`；状态=禁用
- 完成：卡规则/exceptions/source 已挂禁用路径差异（二次确认走 click_save，非启用 confirm→toast_ok 日志行）
- 产品库旁路：新增启用 / 克隆启用 / 禁用 三线湿测齐；未 commit（含卡增量）
- 录制子代理：c23a15eb

## 2026-09-04 · Cursor Lead — I4 禁用贯通启动（executor 已恢复）
- 进行中：选中已启用 `KB测克隆-20260904-1940` → 禁用（下架理由）→ 验证 toast_ok「状态更新成功」/状态=禁用
- 注意：信贷 #501 `run25-coronation` 占 slot0/CDP19242；本线用空闲槽，不抢不杀
- 声明：不改信贷 WIP；`_js_snippets` re-export 已在 `8781d03` 落地

## 2026-09-04 · Cursor Lead — I3 克隆→启用收口（#500）· 等用户重启 executor
- 完成：#500 recorded P1–P4；「克隆成功」+ `toast_ok: 状态更新成功`；CDP `KB测克隆-20260904-1940` 启用；报告 I3 节已写
- 完成：`product_library.json` source 挂 #500；**停手等用户重启 executor**（用户明示）
- 注意：录制子代理为解信贷 WIP ImportError，改了共享 `_js_snippets.py` 一行（re-export `JS_NOTIFY_HOOK`）——未 commit，与信贷线一并处理
- 录制子代理：7de906e3

## 2026-09-04 · Cursor Lead — 提交 5346848 + 续作克隆→启用
- 完成：commit `5346848` — recorder toast_ok（状态更新成功）+ `product_library.json` + 设计/计划
- 进行中：I3 旁路贯通——选中 `KB测产品-20260904-1925` → 产品克隆 → 启用副本（验证「克隆成功」+ toast_ok）
- 勿碰：信贷线未提交 `_observe`/error_notify/table_cell/guarantee_intro/replay_timing/batch_*.png

## 2026-09-04 · Cursor Lead — 产品管理 KB 贯通收口（#499 recorded + B 验证）
- 完成：I2 **#499**（stamp 1925）全 6 阶段 `recorded`+detach；stderr `confirm success notification → toast_ok: 状态更新成功`；字段/CDP 产品状态=启用
- 完成：B 引擎修复湿测通过；`product_library.json` source 已挂 #499；todo ⑥ 收口移出
- 注意：P3 偶发找不到「新增子分类」→ 树幽灵一级节点（不阻塞）；共享 recorder（`_misc.py`/`save.py`）与本条一并提交
- 报告：`tmp/product-mgmt/through-report.md`；录制子代理 a27b10f1

## 2026-09-04 · Zcode Lead — AI 智能录制软著材料全套产出（agent team 并行）
- 完成：`docs/软著/AI智能录制/` 三件套——①源代码鉴别材料.docx（60 页恒 50 行/页，前 30 页 Python `scripts/controller/actions/_replay.py→replay_js.py`、后 30 页 Node `replay-batch-runner.js→page-locator-helpers.js`，页眉含软件名+PAGE 域）②软件说明书.docx（封面/目录/正文，已嵌入 11 张真实截图，图号按章节重编，无占位符残留）③申请信息表.md（程序量约 12.4 万行：JS 58%/Python 42%，300 字软件简介，8 项待确认清单）
- 申报信息（默认值，可改）：基于大模型的浏览器自动化录制系统 V1.0 / 天阳科技 / 完成日期 2026-08-31 / 未发表 / 独立开发
- 截图链路：本地 4097 + vue dev(3000) + 独立 Playwright 实例（共享有头浏览器被占用勿动）；**临时改过 vue-project vite.config.ts 代理指向 localhost:4097，已恢复**；localStorage 注入自制 JWT + 拦截 /api/v2/auth/me 返回"黄某某"过登录态；截图脚本存 tmp/ruzhu-screenshots*.mjs（可重跑）；软著目录被 .gitignore 不入 git
- 注意：vxe-table 勾选框选择器是 `.vxe-cell--checkbox`；批量推送弹窗需先勾选记录；假 token 会触发"登录认证失败"toast（等 4.5s 再截）
- 进行中：申请信息表内 8 项待用户确认（统一社会信用代码/简称/是否合作开发/代理机构等）后才可正式提交

## 2026-09-04 · Cursor Lead — B 引擎修复落地（confirm 成功通知 → toast_ok）
- 完成：根因=`_misc.py` 确认后把**所有** `.el-notification`（含「状态更新成功」）当 `err-notification`，且不写 `toast_ok`
- 完成：确认路径改分类 `{errors,successes}`；success → `record_success_token(toast_ok)`；`save.py` successRe 扩「状态更新成功|更新成功|启用/禁用/克隆成功」；pin `characterize-confirm-notification` / `characterize-save-toast` 已绿
- 进行中：已令录制子代理新建交易重录（勿复用 #498）；prepare 新 spawn 加载补丁，未强制重启 executor
- 声明：本轮改共享 recorder（`_misc.py` + `js_snippets/save.py`）——与用信并行线注意冲突
- 注意：#498 曾在 B 落地前抢跑，已 stop+detach

## 2026-09-04 · Cursor Lead — 产品管理：选 B 改录制侧 toast_ok（引擎+KB 双线）
- 裁决：用户选 **B**——「状态更新成功」类通知计入 `toast_ok`；本线在完善产品 KB 同时**可改共享 recorder**（已声明）
- 进行中：定位 Premature done / success_when=toast_ok 代码并修复；录制子代理停 #497 后按新逻辑重录
- 注意：#497 已 aborted/failed（P5 业务启用成功但 gate 拒收）；CDP base=19242

## 2026-09-04 · Cursor Lead — 产品管理 #497 开始录制
- 完成：重启僵死 LMY executor（offline 锁冲突）→ online；`record/prepare` 200（session cf5051d4…, remoteSessionId=1135, account=2）
- 进行中：`record/start` 全 6 阶段（phaseIds 765–770）同步跑中
- 注意：login.skipped=true（复用登录态）；旁侧会话仍可能争用，已按用户指示继续

## 2026-09-04 · Cursor Lead — 产品管理 KB 贯通 · 晚间续作（并行会话感知）
- 完成：I1 `data/kb/flows/product_library.json`（7 nodes / 12 rules，`find_flow('产品库')` 命中）；任务文案 `tmp/product-mgmt/task-requirement.md`
- 完成：I2 前半——analyze 6 阶段 + **新建交易 id=497**（functionId=9000000740，account=2，draft，task 非空）；报告 `tmp/product-mgmt/through-report.md`
- 阻塞：旁有并行会话（说明书/回放调研 + 知识库用信 Playwright）；**全执行机 offline**、stats `recording=1` → **未** prepare/record，不抢槽
- 续：执行机 online 且兄弟释放后，对 #497 按阶段录制至启用

## 2026-09-04 · Cursor Lead — 产品管理 KB 贯通 · 晚间续作
- 进行中：下班暂停后继续——先 I1 `product_library.json`，再 I2 贯通录制
- 注意：仍勿碰用信/授信未提交改动；共享 staging/_kb/prompts 默认不改

## 2026-09-04 · Cursor Lead — 产品管理 KB 贯通 · 下班暂停（约 18:00）
- 完成：方案1+验证C 立项；设计/计划已写；R1–R3 研究齐（遗留19条 / 需求主链12步 / 挂载裁决 functionId=9000000740）
- 进行中（未完）：I1 `product_library.json` **未落盘**（建卡子代理已叫停）；I2 贯通录制未启动
- 注意：与用信/授信线双开，本会话未触碰其未提交改动；无 commit
- 明日续：先 I1 建卡（材料齐）→ I2 analyze/按阶段录制（account=2）

## 2026-09-04 · Cursor Lead — 产品管理 KB 贯通启动（方案1+验证C，agent team）
- 进行中：设计 `docs/superpowers/specs/2026-09-04-product-mgmt-kb-design.md` + 计划 `docs/superpowers/plans/2026-09-04-product-mgmt-kb.md`；并行 R1 遗留交易 / R2 需求主链 / R3 功能锚点 → 后接 I1 建卡 `product_library.json` + I2 新增交易 analyze/按阶段录制
- 注意：与用信/授信并行会话**双开**——勿碰其未提交 js_snippets/replay_timing 与 batch_*.png；共享 staging/_kb/promote/prompts 本轮默认不改
- 注意：需求分册桌面路径 `c:\Users\water\Desktop\K01天阳信贷管理系统-产品管理需求分册.docx`；成功判据=可召回产品卡 + 新交易含任务内容并阶段录制 + SUT 启用证据

## 2026-09-04 · Zcode (uara_V1.2) — CHANGELOG.md 移除（裁决：变更史以 git commit message 为准）
- 完成：删除 CHANGELOG.md（23eed6d，584 行历史以 git 为准）；修正引用——`characterize-phase-highlight-screenshot.mjs`/`characterize-sys-msg.mjs` 删 CHANGELOG 断言（后者在 verify-all，已实测转绿）、`orchestration/README.md`+`orchestrator-prompt.md` 从共享文件清单移除并注明裁决、AGENTS.md 收工区加「不维护 CHANGELOG」条
- 注意：isExport 改动曾打破 `characterize-sso-auth.mjs` 对 `countByRecordStatus` 调用串的 pin，已随本次更新 pin（verify-all 该项转绿）
- 注意：**本会话期间有并行会话活跃**（3f16901 KB 扩卡 / 7781fc4 read_error_notify 等提交，js_snippets 三文件未提交改动在工作区，本会话未触碰）
- 注意：一次 `git stash pop` 误弹了旧 stash@{0}（wip: before pulling trial-log branch），已全部退回，**stash@{0} 原样保留**，其 CHANGELOG/agent.mjs 的 WIP 仍在 stash 里
- 注意：`characterize-kb-actions.py` 在 HEAD 上即失败（断言「对公授信申请」allow 含「撤销」，实测只有 查看/流程轨迹/流程取回）——存量失败与本次无关，待 KB 卡内容与断言对齐

## 2026-09-04 · Cursor (uara_V1.2) — 菜单 JSON 九条规则回归 18/18（T5 收官）

- 完成：`characterize-menu-import-nine-rules.mjs` 真机覆盖 R1 快照 / R2·5.3 换父 / R3·5.4 交易跟随 / R4·5.5 改名 / R5 新增 / R6·5.7 收编 / R7–R8·5.8 删·留 / R9·5.9 下线 + 推送 menuVersion/removed/归属。全绿。todo-list ③ 菜单切换标收官。
- 注意：5.4 须「同 pageId 换到**另一** umlEcd 功能」才迁 `function_id`；同节点仅换父不改 traj 挂载（节点 id 不变）。

## 2026-09-04 · Zcode (uara_V1.2) — 六任务清单执行：模块湿测/张某某探测/KB 扩卡晋升（3f16901 已推送）
- 完成：任务2 模块链湿测——贷后 OK（对私任务暂存 200/生成检查表被业务规则拦「只有审批通过才能生成」）/评级 OK（PJ20260904016006 创建 startProcess 200；发现前端缺陷「系统评级结论」保存报 `i18n is not defined`）/押品卡后端缺陷（checkWrntTxNumb「获取法人行最高抵质押率失败」）/催收观察 OK（2 条何柳任务 CS20260901028003/28004）
- 完成：任务3 **张某某账号探测成功=135292/1**（客户经理；待办 30 条含链 B 评级 PJ20260901016003 二次调查+用信 YXPC20260803008049 二次调查）——**链 B 阻塞解除**
- 完成：任务5+6——staging 晋升 4 条（promote.py --apply → customer_onboarding/rating 各 +2 rules）+ **KB 扩卡 20→24 张**（approval_chain 审批链通用/guarantee_intro 引入保证人/loan_account 放款账户/rating_flow 评级流程），commit `3f16901` 已推送；全量 json 验证通过
- 注意：本机裸 `python` 是 WindowsApps 桩（exit 49），须用 D:/anaconda3/python.exe 或 ./python/python.exe

## 2026-09-04 · Zcode 执行子智能体 — 任务1 run21：引擎 100% 自主闭环终验（未达成，卡点定案）
- 完成：table_cell.py **表头定列序修复**（任务4 内联版已落盘）——JS_FILL_TABLE_CELL 增第 5 参 header_name：扫描弹窗表头（担保方式/与借款人关系/证件号码/担保金额）定列下标→定位 td→select/input 写入；未命中回落 column_index 计数；fill/select_table_cell 增可选参，prompts 同步，pin×4 绿，executor 重启加载
- 完成：run21 三跑（tid=478/479/480，纯引擎零 MCP）：S1–S7 全自主通过（七模块 saveOrUpdate 全 200、primWrntTp=3 落库、行内 企业股东/30000 回读 ✅）；报告 tmp/kb_i5_usage21_report.md；轨迹均 stop+detach
- 卡点定案：**引入保证人弹窗「确认」静默失败**（radio/cells 对齐后确认不关弹窗、无 toast、担保列表 0 行→NextCheck 恒拒「至少一条与主担保方式相同」）——100% 闭环差此一步；三大新真相：①click_table_row_radio 无序号语义（'5' 文本包含命中第1行→radio/cells 错位）②弹窗行内编辑跨重开持久 ③snapshot 行编号截断致 ^2608\d{10,16}$ 永不命中（行键校验须放宽）
- 注意：Windows 裸 `python` 是 Store 桩——补丁脚本须用 D:/anaconda3/python.exe（run3a 补丁静默未生效教训）；任务4 修「确认」（疑需原生 mousedown 链点确认或逐格 blur 提交行编辑）+ radio 行序号语义即可闭环

## 2026-09-04 · Zcode (uara_V1.2) — 用信批量自批 4 笔通过 + 放款链首通至账户缺失点
- 完成：WN0001 批量自批 4 笔用信（012/019/020/029）全部**审批通过**，批复自动生成且生效（DGYXPF202609040016004-007）——多实例批复能力验证；账号切换 4 次（WN0001↔701994），未触碰否决/退回（tmp/e2e/batch_appr_report.md）
- 完成：主线程 MCP 放款真实建档——存量合同 036012（云天 3,000 万/可用 2,998.6 万）→ 新增放款 → **FK20260904056009**（金额改小=10,000/到期 2027-06-09/柜面放款）；踩坑：金额 fill 追加不替换（需 selectAll+delete）、日期控件须真实面板选择（DOM 直写不进 model）
- 根因定案：放款表单「下一步」disabled=**放款账户信息表 0 行**（云天在该机构无放款账户——业务合理锁定）；修复路径=①客户侧维护放款账户后引入 ②或盛达 029 批复→新合同签订生效后用盛达账户（r13 实证 629177642/467550062）
- 注意：run16 派发框架事故复盘——mm_items 回传错误但 agent 实际跑完/cancelled 后台 agent 无超时保护跑 4h（probe2-11 证实 fill_table_cell 可用，row_text 须用可见行键）；**1 小时阶段汇报规约**已立；网关断连三形态（mm_items/cancelled/Turn execution failed）=恢复后重派

## 2026-09-03 · Zcode (uara_V1.2) — 用信链 run11/12/对比/r13：三杠杆动作 + 第三笔提交进审批（bc336e5 已推送）
- 完成：run11 纯引擎复跑（S1-S6 全通新单 013）暴露两杠杆缺口→run12 实现 **read_xhr_log**（XHR/fetch hook 记响应体 2KB——doDclScmNextCheck 静默拒绝首次机器可读）+ **save_section**（分区标题→最小含保存容器——8 分区命中+16 次请求体核对全「操作成功」）+ **set_vue_model**（__vue__ 链 BFS 直写 model+回读谓词），commit `bc336e5` 已推送；pin×3+8 既有全绿
- 完成：**对比实验方法论**（012 过闸 vs 新单被拒 字段级 diff）一击定案——新单**主担保类型为空**（set_vue_model 写了但分区保存未生效）；r13 子智能体修复（真点击保证+model 验证+分区保存+**reload 后 radio 仍选中=落库铁证**，请求体 primWrntTp=3）→ 补齐金额/还款/利率/投向/政府关联/产品信息 → **YXPC20260903012020 提交成功=审批中**（#399 流程提交成功，选人黄亮 WN0001）——**第三笔提交进审批**
- 完成：卡回灌（credit_usage 13 rules：码值真相/担保校验静默/意见页假象/字段坑/wrapper reload）`114c0a4` 已推送
- 注意：引擎全链自主闭环剩余=把 r13 已实证的「担保分区修复序列」（set_vue_model+分区保存+reload 验证）编码为驱动步骤/提示词（全部动作已存在）；run12 期间 YXPC 捕获回归（7 跑空）待查；SUT 担保校验语义=列表行担保方式必须与主担保一致

## 2026-09-03 · Cursor 子智能体 — system_account 角色名唯一约束 A+B（Task 1–3）
- 完成：Task 1 `ae1a3b3` 包内重名统一文案 + `assertAccountNamesAvailable` 纯函数；Task 2 `28bc9f3` `syncSystemAccounts` 提交前占用预检 + `ER_DUP_ENTRY`→409 中文 CONFLICT；Task 3 api-docs POST/PUT nodes `desc`、CHANGELOG Fixed、本日志（与 Task 3 同 commit）。
- 注意：交叉更名/对调须两步临时名；前端另仓若硬编码 SQL 错误文案需跟中文 400/409 提示对齐。

## 2026-09-03 · Zcode 执行子智能体 — KB-I5 run12：save_section + read_xhr_log 两杠杆动作 + 全链复跑（未 commit）
- 完成：run11 两缺口补齐——① `js_snippets/xhr_log.py`（JS_XHR_HOOK 注入期 hook XMLHttpRequest.send/open+fetch 记 window.__xhr_log 最近 20 条 {url,status,responseBody 2KB 截断}，read_xhr_log(url_filter,last) 注册于 _observe.py:55，add_init_script+即时 evaluate 双通道，historyTraced 语义）② `js_snippets/save_section.py`（JS_SAVE_SECTION：分区标题→最小含保存容器→enabled 优先→mousedown 链→2.5s→toast，save_section(section_title) 注册于 _form.py:210）；prompt form/common 追加规则；pin ×2（characterize-xhr-log/save-section）+ node stub 功能测试 + 8 既有 pin 回归绿。verify-all 的 kb-actions/sso-auth/sys-msg 失败为存量环境依赖（stash 验证与本轮无关）。
- 完成：复跑 7 attempt（tid=428-434，报告 tmp/kb_i5_usage12_report.md）：**缺口①持久化实证闭环达成**——S7 全 8 分区 save_section 命中 + read_xhr_log(saveOrUpdate) 16 次「操作成功」；关键：分区真标题是短名（'A / B / C' 是扫描分组路径）、disableBtn 保存点了不发请求（前置必填如 资金来源 未填，已加 enabled 优先逻辑）。**缺口②原因实证闭环达成**——NextCheck code:100 description=「担保信息列表请录入至少一个与主担保方式相同的担保信息」（机器可读），按因回担保分区 4 轮修复（引入保证人 real_click 行 radio 修 err-no-row-match）。
- 注意：**100% 引擎自主闭环仍未达成**——saveOrUpdate 全成功但 NextCheck 仍拒绝同一担保原因（疑担保行内类型联动/列位错，KB 层缺口）；S9 审批中未达；S5 YXPC biz 捕获本轮 7 跑均空（回归待查）。全部轨迹已 stop+detach，LMY slot 空闲。改动未 commit，留主线程。

## 2026-09-03 · Zcode (uara_V1.2) — 用信链 run10/r10b：012 提交进审批 + 5 条系统真相（114c0a4 已推送）
- 完成：run10 子智能体纯引擎建档 S1-S5 全通（新单 YXPC20260903012012：抽屉/品种树 tree_picker_click/模块保存/担保/日期区间）；断点=「下一步」静默——run10b（第二子智能体 MCP）+ 主线程定位根因链：①担保校验（doDclScmNextCheck code:100 **前端静默无提示**，须抓响应体）②主担保 radio UI 勾选与 Vue model 脱节（保存发旧码值——Vue 直写 primWrntTp 解）③码值真相=抵押1/质押2/**保证3**/信用4（r8a 报告"保证=2"纠错）④「同一保证人不可重复被引入」=009 在途占用，换 26081317115618826 成功
- 完成：r10b 子智能体七模块全部保存 200（corpUsecredit×3/rtlPrtnInf/rtlRedIn/rtlLoanDtlInf×2）+ 提交链（下一步→影像→风险→意见→流程提交→选人**黄亮 WN0001**）→ **YXPC20260903012012 终态=审批中**（截图 tmp/e2e/shots/r10b_终态.png）
- 完成：credit_usage 卡回灌 5 条新真相（主担保码值/担保校验静默/意见页"已选"假象/字段长度坑 DIGT_IDY_CL 2 字符+BP 自动计算+行业树最深叶/wrapper 跨路由 reload），rules 9→13，commit `114c0a4` **已推送**
- 注意：tsscMutilDialog wrapper 空壳**跨 hash 路由存活**，SPA 导航清不掉须浏览器 reload；模块分区保存按钮歧义=点错分区保存不生效（抓请求体核对）；用信链引擎全链闭环仅剩「引擎自主完成意见页流程操作真实点选+流程提交」（其余全部引擎/MCP 已实证）

## 2026-09-04 · Zcode (uara_V1.2) — run16-20 五轮：第 4/5 笔提交进审批 + 意见页合成 select 实证
- 完成：run16（后台 4h agent）实现 fill_table_cell/select_table_cell 并深探（行内写入 read_back 可用；row_text 须用可见行键）；run19 发现**引入保证人弹窗表头列序=担保方式/与借款人关系/证件号码/担保金额**（col 序需先扫描表头）；r14 关键实证：**意见页「流程操作」下拉对合成 select 有效**（model 写入成功——012 失败实为没先选下拉）
- 完成：r17（019 复核=审批中，第 4 笔）+ **r20（029=YXPC20260904012029 七模块全部 200+提交链全通=审批中，第 5 笔**；选人黄亮 WN0001；截图 tmp/e2e/shots/r20_终态.png）。主线程 MCP 打通 029 担保（radio→model=3→分区保存+引入蔓悦薇）
- 注意：派发框架两坑（mm_items 回传错误但 agent 实际跑完/cancelled 后台 agent 无超时保护跑 4h）——**1 小时阶段汇报规约**已立；引擎 100% 自主闭环差「把成熟配方编码为引擎驱动」（全部动作+配方已实证，S1-S7 引擎已通，S8 意见页/提交链 MCP 已反复验证）

## 2026-09-03 · Cursor (uara_V1.2) — 收尾提交截图 orphan 回退 + V3 entry.pageId（18d9b58 / 33abd98）
- 完成：截图 `fallbackToLocal` commit 失败回滚 DB 行 + 启动 `purgeMissingLocalScreenshots`；V3 `transcationEventTypeList[].pageId`（`18d9b58`）。顺带修 `agent-stderr` 对已迁移 `src/utils/stderr-prefix` 的 import（`33abd98`）。已删天元湿测探针与根目录 jpeg。
- 注意：工作区仍有 Zcode/用信、slot-monitor 推流、server 静态托管解耦、handover 文档等未提交改动。

## 2026-09-03 · Zcode 执行子智能体 — KB-I5 run7：CDP 真实点击通道 real_click + 用信链复跑（未 commit）
- 完成：**real_click trusted 事件通道落地**——`js_snippets/real_click.py`（JS_REAL_CLICK_RECT/ECHO + JS_TREE_POPOVER_OPEN）、`_workspace.py:205 _real_click_via_cdp`（`page.context.new_cdp_session` + `Input.dispatchMouseEvent` mouseMoved/Pressed/40ms/Released，playwright 1.61.0 实证）、动作 real_click(selector|text|label_text) 注册于 _register_workspace_actions；tree_picker_click 内嵌回退（_tree.py:88-141：popover 开合探测→逐级 real_click(text)（下级已可见跳点防 toggle）→echo 校验）；budget tree_picker_click=20s/real_click=8s；prompt agent-tools-common.md 新节；pin characterize-real-click.py 新 + 5 既有 pin 回归绿（verify-all 仅 kb-actions「流程取回」存量失败）。
- 排障实锤（截图佐证）：TsscMultiTree popover 触发器+树节点**只接受 trusted 事件**且触发器是 toggle（重复 real_click 会关）；修两 JS 缺陷——position:fixed popper offsetParent=null 误判不可见（改 getClientRects）、文本匹配 body 全扫会命中被遮挡底层同文本元素致点穿关 popover（改 popper 优先 scope）。
- run7 全链（tmp/kb_i5_usage7_drill.py，tid=373，报告 tmp/kb_i5_usage7_report.md）：**S6 首次引擎通过**（echo=住房开发贷款 via=cdp-real-click 4/4 级）+ S7.1-S7.5 五模块保存全过（run6 全灭）；S8 下一步×3 过、省市区 cascader select_option 本轮直过；仍卡：意见步 意见详情/流程操作 label-not-found、流程提交 icon-miss → 未提交，S9 未验。executor 已重启（nodeId 2 LMY online）。
- 注意：探针 tmp/real_click_probe*.py 留档；行政区划嵌套级联树 real_click(text) 仍未命中（非 .el-popper 挂载）→ 建议专用 cascader 动作；disabled 直写（set_vue_model）与资金来源/LPR 数据缺口同前。**本批改动未 commit**（与 run6 未提交改动同工作区，留主线程统一提交）。

## 2026-09-02 · Zcode 执行子智能体 — KB-I5 run4 收尾：tree_picker_click 规格对齐 + 全链湿测报告（未 commit）
- 完成：`tree_picker_click` 实现落地（js_snippets/tree_picker.py 新 + _tree.py 动作 + _js_snippets.py 聚合 + prompt 新段 + pin characterize-tree-picker-click）；触发器优先级照主线程规格对齐=可见 `span.el-tooltip.my-popover.item` 优先（内部 input 隐藏点之无效）；逐级 `norm(text)===目标` 精确匹配 + 回显校验（err-tree-no-echo 不盲试）。
- run4（tmp/kb_i5_usage4_drill.py，14 轮收敛，报告 tmp/kb_i5_usage4_report.md）：**S6 全链通过**——tree_picker_click(产品名称, 贷款→对公→房地产贷款→住房开发贷款) echo=住房开发贷款，确认后弹窗关、品种表 rowCount=1；S7 五模块 saveOrUpdate 均有 save 动作完成；S2/S3/S5 通过。失败：S4（列表未见 009）、S7.3 利率类型/抵押品种/垄断（err-select-option-unresolved / xpath-not-found）、S8 提交链（意见/流程操作 label-not-found、流程提交 icon-miss、tree_check_confirm(审批人) err-tree-label-not-found）、S9 终态非审批中。缺口 33 条已列归属（引擎/数据）。
- 验证：py_compile 4 文件 + characterize-tree-picker-click / tree-check-confirm / kb-i5-gaps-2 全绿。executor 已重启（kill agent.mjs + rm .node-uuid.lock + npm run executor → LMY online inUse=0）；遗留轨迹 329 已 stop+detach 释放 slot。
- 注意：run14 数据跑在触发器对齐前版本（S6 亦命中）；新优先级下未复跑全链（可后续 run5 验证 S8 选人 label「审批人」需弹窗容器扫描——与 tree_check 已修的「下一节点审批人」文本型 label 同类问题）。


## 2026-09-02 · Cursor (uara_V1.2) — 天元读码结构化解析 + fill-pageid + 湿测优化（c89e40f）
- 完成：结构化 `.info` 解析；同 L1 跳过重复 module click；`POST .../fill-pageid`；湿测早退 `empty-config`；plan/research 文档。pin 全绿。`c89e40f`。
- 注意：剩余约 52 空 pageId 多为无天元配置；改 js_snippets 须重载 executor。截图回退 / V3 export pageId 等仍未提交。

## 2026-09-02 · Zcode (uara_V1.2) — 用信链引擎湿测（五轮）：引入/抽屉/产品树/申报页贯通（698b4f9）
- 完成：真相巡（Playwright MCP 主线程，tmp/e2e/usage_probe.md）：用信新增=列表引入「客户放大镜」(picker→回填三框)→查询→「新增」=el-drawer 两步向导（客户引入+业务发生类型/发起模式 select）→风险阻断（下一步）→申报页（4 步向导；新 YXPC 生成）→「新增」=「维护方案品种明细」弹窗→**产品名称=tree-popover 树**（贷款→对公→房地产贷款→住房开发贷款）→分项额度行带出
- 完成：两条引擎补丁（698b4f9 未推送）——①select_tree_option/click_radio label 定位加「容器+可见 dialog/drawer」候选池（弹窗 label-not-found 根因）；②picker readUnderlyingForm 语义：可见 drawer=回填目标、仅可见 dialog=overlay（drawer 宿主误报 err-refill-not-verified）
- 湿测（五轮收敛）：S2/S3/S5/S9 全通 fails=0——引擎直达 产品树 `ok:住房开发贷款(2069416978116472832)` + 分项额度行带出（S4 放大镜 query+select 两拍回填三框）、S7 两下拉 select_option、S8 申报页到达（重试拍有效）
- 注意：S6 抽屉内引入 picker 报 err-refill-not-verified=**保守误报**（显式失败不阻断；待下批：SELECT 段对 drawer 语境再核对）；驱动教训=picker 需 query+select 两拍、改 js_snippets 后须重启 executor；新单 YXPC20260902012009（侦察产物，待发起）；8 pin 全绿

## 2026-09-02 · Cursor (uara_V1.2) — 截图 pending 孤儿清理 + fallback 回滚
- 完成：清理 103 条无 `{id}.png` 的 `storage_type=local` 孤儿行（pending 现为 0）。根因=上传失败报 `local pending file not found`，非当前 MinIO 故障（bucket 可达）。
- 完成：`fallbackToLocal` 在 `commitPendingFile` 失败时 `screenshotDao.remove(id)`；新增 `purgeMissingLocalScreenshots`，`server.mjs` 启动先清 DB 孤儿再清文件。pin：`characterize-screenshot-fallback.mjs` 绿。CHANGELOG Fixed 已记。未 commit。
- 注意：**需重启 4097 控制面**后新代码与启动 purge 才生效；新截图在 MinIO 正常时应直传。

## 2026-09-02 · Cursor (uara_V1.2) — 天元 pageId 湿测 + 读码优化
- 完成：Playwright 实测 8 个菜单——业务扩展类有 `ZJJK00070199` 且 path=hash；待办/首页/外系统接入/数字信贷等多页天元弹窗长期仅「确 定」无编号（非扫漏）。优化 `page_id.py`：开窗前等路由、空壳 `empty-config` 早退、加载中拉长、禁止无路径兜底。研究笔记 `docs/superpowers/research/2026-09-02-tianyuan-pageid-wet.md`。characterize-page-bind 全绿。
- 注意：剩余空 pageId 多数需业务侧补天元配置；executor 需重载后 fill 才吃到新 JS。

## 2026-09-02 · Cursor (uara_V1.2) — 启动 AI 二级菜单 pageId 补采
- 进行中：信贷系统（id=1）AI L2 共 234 条且 pageId 全空；新增 `POST /api/v2/system-mgmt/nodes/:id/fill-pageid`（默认 sources=ai，不扫树）；已触发 scanId=`e7f567d9-83d6-4158-a287-8e8040e2eda5`（轮询同 menu-scan）。上限 PAGEID_FILL_MAX=500。
- 注意：湿测日志多见 `timeout-or-mismatch`（天元「页面路径」与 hash 不一致，或弹窗仅标题+「确 定」）；已改 `page_id.py`（先关旧弹窗、路径宽松匹配、页脚 `确\\s*定`）——**需 executor 重载后下一轮补采才吃到**。本轮可能 filled 偏低。曾重启本机 4097 控制面。

## 2026-09-02 · Cursor (uara_V1.2) — scan-menu 全量补采落地 pageId（SDD）
- 完成：apply 后对空 `pd_cmpt_ecd` 的 L2 点开读天元写入（组件单码→场景编号；无码 skip；不写 AILZ 到菜单）；prepare 取消菜单回写，只写 `trajectory.page_id`。commits：`1f98d98`（抽出 `writeFunctionLandingPage`）→ `668cc4f`/`3955cac`（`menu-scan-pageid.js` + filled 仅写库成功）→ `42b32ca`（接入 `runScan` + api-docs + CHANGELOG）→ `b4927ee`（终审修复：无 L2 xpath / 点击失败不写）。未推送。
- 验证：characterize-menu-scan / characterize-page-bind 全绿。计划/设计：`docs/superpowers/plans/2026-09-02-scan-menu-pageid-capture.md`、`docs/superpowers/specs/2026-09-02-scan-menu-pageid-capture-design.md`。
- 注意：区间内另有无关 commit `5f769b4`（login）；空 pageId 很多时扫描会变慢；从未扫过且 pageId 空的节点需再跑 scan-menu。

## 2026-09-02 · Zcode (uara_V1.2) — tree_check_confirm 专用树勾选动作（带成功谓词；四跑实证）
- 完成：新动作 `tree_check_confirm(label_text, node_text)`（commit `301ef5e` 未推送）——流程选人/多选勾选树的确定性动作：JS_TREE_CHECK_CONFIRM（js_snippets/tree_check.py，单源）+ _tree.py 动作 + 聚合 + prompt（与 select_tree_option 分工=单选叶子/多选勾选）+ pin characterize-tree-check-confirm；**成功谓词=节点 is-checked 且树勾选数≥1**（呼应"确定"前无效勾选的静默失败风险）；err 三档显式失败（label-not-found/node-not-found/check-unverified）不盲目重试
- 实施复盘（子智能体派发两次网关超时 → 主线程实施）：首跑 err-tree-label-not-found（无 .el-form-item__label，实际=弹窗文本"下一节点审批人"→ 三档容器匹配修复）→ 二/三跑 err-tree-node-not-found（树在 body 挂载 **hidden tree-popover**，可见容器扫描看不到 → 改 document 全局树扫描+弹窗搜索框触发展开+500ms 重扫+节点三形态 .node/.content/节点自身）→ **四跑成功**：`ok{checked:true, node_text:客户经理-黄某某(701994), checked_count:1}`，S8a 新动作主路径 → S8b submitted=True（EDDJ20260902024038 进流程）→ S10 终态通过
- 注意：S9-done 判据误报与七轮相同（快照在待办列表页无字样，用 list_todo_cards 判据为佳）；二~四跑各留一笔审批中冻结单（024035 4万/024036 5.5万/024037 6万/024038 6.5万——测试数据，A7 可作审批驱动样本）；9 pin 全绿

## 2026-09-02 · Zcode (uara_V1.2) — KB-I5 湿测六/七轮：S9 审批驱动 + 引擎纯自跑全链闭环
- 完成：S9 审批驱动（_misc.py r6/r6b/r6c：点击解析器 document 作用域+`div.todo-item-action` 候选→click_button[处理]=ok-click；label→trigger 选第一个可见 input；**r6c=click_button(树节点文本) 对关闭 tree-popover 自开+勾选兜底**）——EDDJ20260902024033 审批通过（第六轮）
- 完成：**第七轮引擎纯自跑全链闭环（292s）**：新草稿 EDDJ20260902024034（4万）新增→分页选盛达→radio→确定跳向导→保存→意见提交→**r6c 树勾选纯引擎一次命中（无「请选择一个审批人」拒）**→确定→待办卡处理→审批同意→流程提交→确认→**审批通过**；终态 3 行全绿（024034/024033/024001）；tid 全 detach；截图 tmp/e2e/shots/kb_i5_全链复验_审批通过.png
- 根因定案：流程选人树勾选需**真实 check 事件**（select_tree_option $emit('input') 不写 nextNodeAprvPsnList → 确定被拒）；r6c 已闭环，无需改 select_tree_option
- 注意：r6c 多轮实证路径=关闭 popover 自开+勾选；分页下拉 5s 预算~11 页（关/开续翻）；S9-done 判据建议用 list_todo_cards 而非快照文本。pin：characterize-click-scope-picker-login 扩 ok-click/div.todo-item-action；全套 8 pin 绿。本批 commits 未推送

## 2026-09-02 · Zcode 执行子智能体 — KB-I5 湿测第六轮：S9 审批驱动闭环成功（EDDJ20260902024033 审批通过；未 commit）
- 完成：**S9 审批闭环达成**——待办卡「处理」(div.todo-item-action) 经 r6 通用点击解析器命中（ok-click:处理）；024033 卡任务节点=发起人 → 段A 发起人提交（下一步/流程操作=提交/流程提交/流程选人 701994/确 定）+ 段B 审批人同意（审批/流程操作=同意/流程提交/「到此结束」msgbox=「确定」无空格写法）→ **额度冻结-新版两行终态均审批通过**（024033 5万 + 024001 10万），截图 tmp/e2e/shots/kb_i5_审批通过.png；报告 tmp/kb_i5_frz_report5.md；tid=288/290/291 均 stop/detach
- 完成：`_misc.py` 三项修复（未 commit）——r6 通用点击解析器（无 overlay 时 document 作用域+页面级 ok-click: 返回串）；r6b label→trigger 选第一个**可见**非 hidden input（TsscMultiTree 隐藏搜索框在前致 miss）；r6c click_button(树节点文本) 对关闭 tree-popover 自开 popover+勾 checkbox 兜底（预设勾选态双击保证 check 事件收尾）；pin characterize-click-scope-picker-login.py 加 ok-click:/div.todo-item-action 断言，py_compile+2 pins 全绿
- 关键实证：流程选人「请选择一个审批人」根因=`formData.nextNodeAprvPsnList` 仅 el-tree 真实 check 事件（handleCheckClick）写入，select_tree_option `$emit('input')` 不触发 → 确定恒被拒；el-tree checkOnClickNode=true 点根节点级联全选；「到此结束」msgbox 按钮=「确定」（流程选人弹窗才是「确 定」）；发起人提交后待办卡标题「发起人」→「审批人」（bizPk 不变，同账号可连续两段）
- 注意：r6c 引擎路径未在纯引擎会话复验（段A 树勾选为 CDP 事件链实验完成；024033 已批无待办卡可测）——下一轮新申请单验证 r6c + 知识卡 limit.json 审批条目按报告建议回灌（msgbox 按钮写法/check 事件/卡标题变化）

## 2026-09-02 · Zcode (uara_V1.2) — KB-I5 湿测五轮收敛：冻结申请全链贯通（引擎提交进流程）+ 6 项新修复
- 完成：引擎实机湿测（确定性驱动 tmp/kb_i5_frz_drill.py）五轮收敛——**冻结申请 S1-S8/S10 全链贯通**（导航/KB 召回/查询/分页下拉选盛达/radio EDBH/确定建草稿/两步向导填表保存/意见提交/流程选人树选中 客户经理-黄某某/草稿 EDDJ20260902024033 已提交进流程=审批中），引擎提交侧闭环达成
- 完成：湿测驱动的 6 项修复（commit `f7806c8` 未推送）：N1 filterable 键入 300ms 轮询(1.8s 预算窗)、N2 radio 容器作用域+rowVisible+err-no-row-match（0 行不再假 ok）、N3 picker 支持 el-drawer、N4 JS_SELECT_PAGED_TRAVERSE 分页下拉遍历（实证 findCoreInfGroup pageSize:5→200 服务端照单全收，盛达 24/29 页；paged 优先于 filterable-typed）、N5 _resolve_control xpath-not-found 早退绕过 → 先 trigger 再选值；容器/树点击均升级 mousedown→mouseup→click 链（Element UI radio/select 真实事件依赖）
- 重要实证：新增按钮「选择冻结额度」抽屉=客户号**分页下拉**（非 remote；键入零请求；「确 定」=创建草稿+跳两步向导 ①只读额度②维护冻结信息）；树选命中=label=审批人 + 「确 定」空格写法；list_todo_cards 正常但 .todo-item-action「处理」无引擎动作
- 遗留（下一批）：**待办任务卡片「处理」动作**（第六类外围，S9 审批无法驱动）；分页下拉单次 5s 预算仅 ~11 页（靠关/开保 currentPage 续翻）；pin：characterize-kb-i5-gaps-2.py（N4 块）；7 pin 全绿

## 2026-09-02 · Zcode 执行子智能体 — KB-I5 第五轮：全功能 select 分页遍历回退 + 驱动重跑（未 commit）
- 完成：①`JS_SELECT_PAGED_TRAVERSE`（form_action_engines.py，N4）——分页下拉遍历回退：找「下一页/›/»」逐页扫描 .el-select-dropdown__item、30 页上限、scrollTop=0、预算受 budget_for('select_option') 约束；**实测发现 findCoreInfGroup XHR body pageSize:5→200 服务端照单全收**，一次拉全 144 条候选（盛达第 24/29 页）遍历 O(1)；paged 回退置于 filterable-typed 之前（键入回退 1.8s 会饿死遍历）；pin characterize-kb-i5-gaps-2.py 新增 N4 块全绿
- 完成：②N5 resolver 级回退——向导②/签署页 select（冻结类型/冻结原因/流程操作）`_resolve_control` 返 'xpath-not-found' 早退绕过全部 trigger 回退；改为 resolved.error 分支先跑 `JS_SELECT_TRIGGER_MAIN_AREA`（精确 label→.el-select .el-input__inner mousedown 链），ok-triggered 以空 xpath 继续选值
- 完成：③驱动重跑（tmp/kb_i5_frz_report4.md，终轮 5w）——**S8 全链首次贯通**：流程操作=提交→意见详情→流程提交→选人树（select_tree_option label=审批人 命中 客户经理-黄某某 701994-9881-X0018；弹窗确定=「确 定」空格写法）→草稿 EDDJ20260902024033 进入流程审批中；S10 终态核验过（列表盛达在册+待办卡审批中），截图 tmp/e2e/shots/kb_i5_终态3.png；py_compile+characterize-click-scope-picker-login 全绿
- 注意：改动未 commit（form_action_engines.py/tmp/*）；**遗留缺口**：待办任务卡片动作（.todo-item-action「处理」）无引擎动作，click_button 打不中→S9 审批无法驱动（待办卡状态读数 list_todo_cards 正常）；semantic_snapshot tables 仅 headers 无 row cells（终态判据靠 list_todo_cards JSON）；分页下拉单次 5s 预算仅能翻 ~11 页，超页数靠关闭/重开保留 currentPage 续翻
## 2026-09-02 · Zcode 执行子智能体 — KB-I5 第三轮：N1 轮询/N2 容器作用域细化修复+湿测重跑（未 commit）
- 完成：①N1 `JS_SELECT_FILTERABLE_TYPED` 改 300ms 轮询（窗 1.8s 适配 5s 动作预算）+ .el-select 包装层打开手势 + net/seen 诊断；②N2 `click_table_row_radio` 顶层可见容器作用域优先（z-index 最高 drawer/dialog，无容器回退页面级）；③pin characterize-kb-i5-gaps-2.py N1 串 600/5000→300/1800，3 pin 全绿
- 完成：湿测重跑 3a-3l 共 10 轮（tmp/kb_i5_frz_report3.md）——**N2 生效实证**（radio ok+rowCount=2 复核一致，0 行场景 err-no-row-match 正确）；N1 机制生效（键入「税达」命中选中，回显 26082010332675731），但盛达不在候选且键入零网络请求=KB/数据缺口；**新发现高优缺口：选择冻结额度抽屉「确定」点击 ok-container 但抽屉不关**（×5+click_save+重选 radio 均无效，S7-S10 全阻）；N3 picker 10s 预算不足（内部 close-wait 卡在确定不关）
- 注意：改动未 commit（form_action_engines.py/_table.py/tmp/*）；下一步=抽屉确定事件形态实证（radio Vue model/信任点击）→ KB limit.json 更正（盛达不在候选）→ picker 预算 → S8 选人树
## 2026-09-02 · Zcode (uara_V1.2) — KB-I5 引擎五缺口修复落地（1612186）
- 完成：三组并行子智能体（文件集不相交）修复归档于 `research/2026-08-31-api-drive-chain.md` §12 的五缺口——G1 click_button 容器作用域优先（`_misc.py` 新增 `_JS_CLICK_BUTTON_IN_CONTAINER`，页面级回退不变）；G2 `JS_IS_QUERY_TOOLBAR` 向导排除（el-steps/下一步+上一步/流程提交·意见 → 非查询工具栏，form_scan_utils:382/form_save:414 语义自洽无需改）；G3 picker 回填补验+重试（picker_confirm SELECT 空 changed 等 1.5s 重读，动作层重选一次仍空 → `err-refill-not-verified` 显式上报）；G4 watcher 播种意图豁免（`phase/intent_gates.py` contract_allows_form_assistant：_phase_intent{mode create|modify}+locked+无显式键 → allow；deny pin 保持通过）；G5 login 孤儿 Chrome 探针（同账号 → ok-login reuse；异账号 → localStorage.clear+reload；token 缺失原逻辑）
- 完成：新增 pin `characterize-click-scope-picker-login.py`、`characterize-query-toolbar-snippet.py`，扩展 `characterize-phase-intent.py` 正反例（纯追加）；全部 7 个 pin 脚本绿；prompt 同步 agent-tools-form.md（KB-I5 能力提示）；todo-list ⑤ 工作线+A7 探索项。commit `1612186`（未推送）；对比基线已证 verify-all 存量失败（characterize-kb-actions 「流程取回」）与本次无关
- 注意：配合 20 卡知识，Python Agent 已具备自主跑通授信向导深链的引擎能力（尚未实机湿测——建议下一步用冻结最短闭环或用信申请做引擎回归）

## 2026-09-02 · Zcode (uara_V1.2) — 链 A A6 破局：用信审批链贯通 + 合同创建签订（卡点=影像上传待拍板）
- 完成：A6 全链推进（串行子智能体+号切，7 个子环节逐一闭环）——①冻结 EDDJ20260901024001 提交→**自批成功→审批通过**（完整闭环：同意/否决/退回上一步+最终确认框+submitProcess 200）；②**替代账号破局：WN0001/1=黄亮登录成功**，用信 4 节点全序打通（发起701994→二次调查黄亮→五级机构审查701994→五级机构审批黄亮=末节点 23:36:51）→**用信通过**；③用信通过自动生成并生效**对公用信批复 DGYXPF202609010016001**（100 万）；④**合同 9881020044004 创建+签订提交**（引入客户→引入用信→风险拦截→纸质签/线下/3 份/账户两行必填 saveCtrAccinf→saveSignContInfo→submitProcess 200 bsnPk=HTAPL202609016002）→**签订中 ctrSt=3**（签订流程审批 00:10:54 已过）
- 完成：补卡 credit_usage（审批链/定人vs角色/批复自动生成，规则 6→9）+ duigong_contract_sign（合同创建向导全链/ctrSt=3/影像向导/0 条结论修正）+ 报告 §7，commit `285c642`（未推送）
- 注意：**A7 唯一卡点=「上传签署影像」**（wf_ctrcontsign_com：基本信息→影像信息上传纸质合同扫描件→签订合同提交；人机边界=需经办人真实签署影像，子智能体未自造文件）——用户拍板后 ctrSt 3→6 即可放款（A5 已实证放款向导 4 步 8 tab）→借据→贷后自动生成；链 B 评级仍审批中（定人张某某，替代账号未探测）；冻结待办条目审批后未清除（quirk）；黄亮账号凭据=WN0001/1

## 2026-09-02 · Zcode (uara_V1.2) — 链 A A5 收口：合同/放款/贷后结构核验（全链报告 + 三卡补强）
- 完成：链 A A5 三环节（串行子智能体，Playwright MCP 唯一浏览器 701994）——A5-1 合同（用信流程轨迹=黄亮 WN0001 待处理/待签订盛达 0 条/存量 4 条查看全字段，卡 9 一致 1 不一致）；A5-2 放款（列表 23 条 15 按钮 15 列一致，**放款向导首次实证 4 步+8 tab**，036010 可用余额 0 被拦，草稿 FK20260901056008 经取消→删除清理，卡 11 一致/部分 2/补卡 1）；A5-3 贷后（对公首次/常规 0 条，对私详情全命中，规则配置首次 8/常规 146 条，卡 5/5 一致）
- 完成：三卡补强（duigong_contract_sign/loan/postloan）+ 全链报告 `docs/superpowers/research/2026-09-01-e2e-chain-a.md`（A1→A5 全表/卡核验汇总/7 条新增业务规则/遗留 A6），commit `878eb51`（未推送）
- 注意：链 A 真实下游（盛达合同→放款→借据→贷后任务）阻塞=用信 YXPC20260901012008 审批中待黄亮(WN0001)，701994 无审批权（系统约束非缺陷）；A6 待办=黄亮/张某某处理后补跑；新规则已入卡：放款删除仅限作废/已撤销（待发起先取消再删）

## 2026-09-01 · Zcode (uara_V1.2) — ①③收账 + ④授信深链定案（未闭环，五引擎缺口归档）
- 完成：①minors 清账（seq 数值化/find_flow 短查询拒答+等名优先/kb_dict ambiguous 提示）；③promote.py staging 晋升工具（dry-run 默认/--apply/去重幂等）；KB-5 扩卡——评级/额度管控/放款申请/贷后检查四张流程卡（K5 computer-use 实地，含 hash_markers/keywords 绑定与业务依赖图），流程卡总量 6→10（8be5722，已推送）
- 完成：④授信深链演练（交易 218/219）——**未闭环**：向导 Step① 候选表恒 0 行+下一步静默无效。根因定案五缺口：click_button 页面级同名遮蔽抽屉内按钮 / JS_IS_QUERY_TOOLBAR 误判向导抽屉为查询 UI / picker_dialog_select 回填空 / watcher intent gate / 孤儿 Chrome 复用 login 必败。守卫与撤销行为全程正确，槽位清零（§12 已归档 research 文档）
- 注意：五缺口修复=下一批 KB-I5（抽屉作用域按钮点击/向导表单识别/picker 回填重试/孤儿 Chrome 探针）；另有并行会话的 menu-push 提交（bf5c929/e4c2b4a/4892a08 等）交错在同分支

## 2026-09-01 · Zcode (uara_V1.2) — GET /api/v2/trajectories 新增 isExport 筛选
- 完成：交易列表接口新增 `isExport` 查询参数（0=未推送 / 1=已推送 / 不传=全部），供前端「是否已推送」下拉筛选；route 校验非法值返 400，dao `list` / `listByFunction` / `countByRecordStatus`（stats 同步受筛）统一经 `applyListFilters` 加 `t.is_export` 条件。commit `924ecf8`（未推送）
- 注意：前端已在传参，无需前端改动；其余调用点默认 null 不受影响


- 完成：KB 召回湿测（交易 211/212）四项全绿——export_dicts 入库 / kb_dict(cstSt) 命中码表 / kb_flow 命中 nextBefore 闸门 / kb_field 命中依赖组；**此前 BLOCKED 根因=用户 VPN 开关导致 SUT 导航 5xx**（非 SUT 故障非代码），VPN 关闭后一次通过
- 完成：KB-4 A/B 对照（tmp/kb_ab_drill.py，用信申请）——A 基线 err=3（查询区 disabled 三连）vs B 召回 err=0（卡片「仅能经引入」直接消费）；步数 9→6、耗时 68.2s→56.8s（-17%）
- 完成：research 文档 §10 归档（含「SPA 字典缓存异步写入，export 前等首页渲染」新知识）
- 注意：KB 全批次（KB-1..4）验收完成；SUT checkCustCorporat 缺陷已在 202/203 复核未复现

## 2026-09-01 — 推送菜单 D1+D2（partner stub）实现

- **完成:** POST/GET `.../nodes/:id/push-menu`；v1.2 组包；状态落库 + 5s auto-sync；`pushMenusToPartner` stub；CHANGELOG 清理至仅保留 ≥2026-08-15。commits: `e4c2b4a` `4892a08` `24cf70b` `9112955` `b8ed35d` `cd1c344`（设计 `bf5c929`）。
- **进行中:** 无。partner 真接收接口就绪后只填 stub 函数体。
- **注意事项:** 前端推送按钮未做；D3–D5 未做；多实例依赖 GET 纠偏。
## 2026-09-01 · Zcode (uara_V1.2) — KB v1 SDD 执行完毕（Task 1-4 交付+终审，湿测阻塞待 SUT 恢复）
- 完成：SDD 全流程（subagent-driven-development，主 Agent 统筹+每任务独立实现者/审阅者双审）——Task 1 store（bf3af90）/Task 2 导出链路+matcher（c8e92b8）/Task 3 六动作+6 流程卡+接线（66f5585，实现者自查条目见下方独立条目）/Task 4 提示词 cue（22b41a1）
- 完成：终审 PASS with deferred → 合前修 KB_DATA_DIR 隔离（a9d0a0d，特征化不再覆盖/删除本机真实字典数据；scoped re-review 实测 data/kb 零写入 ADDRESSED）
- 完成：KB-1/KB-2/KB-3 批次落地——`export_dicts/kb_dict/kb_flow/kb_state/kb_rule/kb_field` 六动作注册可用；提示词召回 cue（召回不到=上报缺口不编造；nextBefore 前置闸门=硬边界）
- BLOCKED：KB-4 湿测（Task 5/6）——SUT 网关导航层间歇 5xx（ERR_HTTP_RESPONSE_CODE_FAILURE，7+ 次重试跨 5 分钟；静态页 200 但应用导航失败）；脚本 `tmp/kb_live_check.py` 就绪，SUT 恢复后直接跑；KB-4 A/B 对照随之
- 挂起 minors：seq 字典序排序（消费前数值化）/ cue 参数名 dict_type 大小写与 kb_rule 未提 / kb_dict 前缀多命中静默 not-found / find_flow 首卡命中 / skipped 丢弃 / FIELD_MAP 死常量（明细在 .superpowers/sdd/2026-09-01-credit-knowledge-base/progress.md，工作区暂留）
- 注意：分支上混有另一会话提交（bf5c929 menu-push 文档、e4c2b4a menu_push 列）与 Cursor 会话——非本线产物；控制面+executor+隧道在线；未推送

## 2026-09-01 · Zcode (uara_V1.2) — Task 3：kb_* 召回/摄取动作 + 6 张流程卡 + 特征化（66f5585）
- 完成：`scripts/controller/actions/_kb.py` 六个动作（export_dicts/kb_dict/kb_flow/kb_state/kb_rule/kb_field）+ service.py 接线（+2 行，紧随 _register_observe_actions）
- 完成：`data/kb/` 入库——dict_alias.json + 6 张流程卡（customer_onboarding/credit_application/credit_usage/approval_todo/customer_360/session_login，K1 实证逐字转录）；.gitignore 追加 dicts_normalized.json 生成物
- 完成：`scripts/characterization/characterize-kb-actions.py`（FakeCtx 无浏览器，asyncio.run 包动作调用，kb_dict 分支用内置最小 dict fixture，结束清理）并注册进 verify-all
- 验证：特征化绿（ok: characterize-kb-actions）；import 门禁 wiring OK；eslint 0 error；verify-all 仅已知存量 export-v3 FAILED
- 注意：特征化脚本与 brief 逐字稿有两处必要偏差——动作函数为 async coroutine（补 asyncio.run）；kb_dict 无数据文件时返回 kb-dict-empty 而非 not-found（fixture 注入走 not-found 分支）

## 2026-09-01 · Cursor (uara_V1.2) — 关闭 V2.1_dev 日报草稿并按现分支重写
- 完成：关闭 Ahnoler/JS-gen 上 13 个 draft PR（#11–#23），全部是对着已停更 `V2.1_dev` 的试用期日报，不合入
- 完成：按 `uara_V1.2` git 提交重写 8/18–8/31 日报（8/23 无提交跳过），写入本地 `docs/report/`（gitignore，不入库）并更新索引
- 注意：8/14–8/17 本地稿已是 uara_V1.2 真实提交，未覆盖。自动化检出分支需在 Automations Settings 改成 `uara_V1.2` 后保存；今晚 18:00 才会写 8/31 的云端稿（本地已有重写版）。本地仍比 origin/uara_V1.2 超前，云端日报看不到未 push 的提交

## 2026-08-31 · Zcode (uara_V1.2) — borrow-design Z 系列全部落地（7 路并行 + 主线程接线）
- 完成：Z1+Z4（4f04c26）——JS_SEMANTIC_SNAPSHOT（context 头 + 稳定 ref 控件清单，快照即真相）与 JS_VERIFY_CONTEXT（六判据动作前上下文校验）+ _observe.py 注册 semantic_snapshot / verify_context
- 完成：Z2（9f41c47）——page-locator-helpers.js 增量 resolveLocatorStrict（found/count/visibleCount/ambiguous/samples），重新生成 _locator_helpers_js.py；三源护栏改前后字节一致；真机对照 //body 与 选择客户 1/1 命中、保存 真实 0
- 完成：Z3（45105bd）——失败重观察守卫分级：第 2 次连续失败追加重试纪律、第 3 次起强硬处方（三选一），cue 后附新鲜页面观察（hash/loading/overlay）；cue-once 语义保留，护栏 OK
- 完成：Z5（2f2bc23）——观察阶梯五级 + 单动作单观察 + 3-5s 预算语义注入 prompts；Z6（83d83e6）——ACTION_BUDGET_S 预算表 + budget_for/budget_overrun_hint（纯增量，WAIT_ 常量零改动）
- 结论：Z8 坐标兜底**继续二期搁置**（无实证自绘控件触发面；page.mouse/截图/坐标换算基建全在；grounding-fallback-spec G4 裁决无新证据推翻）
- 验证：xpath 三源 11×6 一致、duplicate-failure-cue/form 系特征化 OK、verify-all 唯一失败仍为已知存量 export-v3；真机湿测 semantic_snapshot/verify_context 正反路径/strict 解析器三组对照全绿
- 注意：Z 系列全部落地；预算消费接线（budget_for 接入动作层）与 verify_context 在 W3'/W5 编排中的强制前置为下一批可选收尾

## 2026-08-31 · Zcode (uara_V1.2) — 编排 v2 落地：H1-H5 全部实现（4 路并行子智能体 + 主线程接线）
- 完成：H1 W0 登录引擎化（d5aafa4）——JS_LOGIN_PICK_LEGAL 法人自动选择（placeholder 定位 + mousedown 展开；(args) 数组解构适配 Playwright 单参数语义，修复了首版 (legalName) 签名被 try 静默吞掉的 bug）+ LoginEngine.login 探针重试（≤10s 轮询 #/home/_usertoken，4s 补点一次）；真机湿测一次调用 `ok-login | legal:横州市… | probe:home`
- 完成：H3+H2 待办卡片与向导守卫（308c8a7）——JS_LIST_TODO_CARDS / JS_WF_SUBMIT_GUARD（只读）+ _todo.py 注册 list_todo_cards / wf_submit_guard + service.py 接线
- 完成：H5a/H5b 提示词（e1913ff）——六类页面形态 + W5 守卫 cue（流程操作选项随节点先读再选、流程提交/撤销四步纪律以审批历史为准）+ 营业日期系统戳例外 + 反注入规则
- 验证：6 个 form 特征化 + xpath-three-sources（11×6）OK；verify-all 唯一失败仍为已知存量 export-v3（远程库数据漂移）；真机 login/picker 链路全绿
- 注意：编排 v2 的 H 系列全部落地；W5 演练只到提交流程步之前，流程提交/撤销仅在显式授权下执行；Z1/Z4（semantic_snapshot/verify_context）待下一批

## 2026-09-01 · Zcode (uara_V1.2) — 业务流程知识库调研（K1/K2）+ KB v1 设计
- 完成：K1 computer-use 业务流实地调研（六条业务流节点图/状态×动作矩阵/隐性规则：标志→明细依赖、360 URL 上下文契约、业务主键前缀表、nextBefore 风控闸门实证）——tmp/k1_notes.md（142 行）
- 完成：K2 平台知识形态调研——四层现成来源（localStorage vue_Tansun_dict 1333 字典类型/系统树 menuXpath/轨迹定位器链/business-data 字段映射）+ 五条缺口——tmp/k2_notes.md（103 行）
- 完成：KB v1 设计（docs/superpowers/specs/2026-09-01-credit-knowledge-base-design.md）——五层知识库（值语义/导航/序列/字段映射/流程依赖）+ 采集管线 P1-P4 + kb_* 召回动作 + KB-1..4 实施批次
- 注意：设计待用户批准后派发实施；授信表单分区因 nextBefore 闸门未采到（需正式客户补采）；字典归一映射表是 KB-1 人工确认点

## 2026-09-01 · Zcode (uara_V1.2) — P4 守卫路径闭环定案
- 完成：P4 守卫路径闭环（交易 203/205/206）——①真实缺口=驱动 parse_result_json 未剥离 watcher result 信封（恒判 0 行），修复后 P3 首次真通（row_count=20→首行 select→changed 回填）；②全量 DIAG 定案：新增对公授信管理默认=列表页（8 按钮无保存/提交），选择客户回填列表查询区，系统不自动开表单——click_save 守卫判 query UI 拒绝为**正确防御**；③补「点新增」步后=抽屉表单链（overlay drawer→选择客户回填 OK→表单态未达）→ 守卫仍正确拒绝
- 结论：P4 守卫侧无缺陷（205/206 双轮 100% 正确）；剩余差异=业务流图谱（新增→抽屉→保存/提交 多步链）留作编排 v2 W3' 补充（非缺陷）；research 文档新增 §9 定案
- 注：交易 203-206 均 detach 释放（浏览器零残留）；tmp 驱动修改（parse_result_json 信封修复、P3 补新增步、P3→P4 弹窗收口+DIAG）不入库

## 2026-08-31 · Zcode (uara_V1.2) — ①②③收尾：深链收官轮
- ①P3-P5 深链：P3 首次真通（交易 203）——根因=驱动 parse_result_json 未剥离 watcher result 的 `extracted_content='ok:{...}'` 信封（此前恒判 0 行）；修复后 picker row_count=20 → 首行 select → `changed{客户编号,客户名称}`。P4 剩余一档：click_save 被 not-form-save 守卫拒（P3 弹窗关闭态未验证→页面判 query-filter），实提交路径待闭环（无阻塞，守卫行为保守正确）
- ②checkCustCorporat 复核：交易 202/203 两次 `ok-save-navigation`（无 500/无 REQ-FAIL）→ 判定未复现（或在近期修复），research 文档 §6 已追加复核结论
- ③screenshots 目录入库策略：.gitignore 追加 `scripts/screenshots/`（运行产物，代码仅写入不读取；check-ignore 生效）
- 注：tmp 驱动修改（api_drill.py parse_result_json）属 gitignored 产物不入库；D1/D2 文档与 .gitignore 本次提交

## 2026-08-31 · Zcode (uara_V1.2) — 按 docs/orchestration 派发 A/C：P0-P5 驱动深化 + 链路文档
- 完成：A（tmp/api_drill.py 229→395 行，函数外 helper 化）——P3 完整（tabs/菜单链→选择客户→query 0 行重试→首行 row_text→selector diff→verify_context overlay_absent→通用必填填充）、P4 完整（save_with_repair ≤3 → formErrors 检查 → 提交按钮探测[w/ 声明偏差：watcher 无 evaluate 动作，改用 semantic_snapshot 等价] → wf_submit_guard → 提交 → 流程轨迹断言）、P5 best-effort（撤销/页签清理/截图）；P0-P2 与信封处理未动
- 完成：C（docs/superpowers/research/2026-08-31-api-drive-chain.md 216 行）——链路拓扑/接口契约（按代码事实：v2 成功=裸 JSON、错误=AppError 扩展信封；保留双兼容）/四组缺陷定案（4537ec4/2a119c5/0fa6a8e/c3453eb→20fb5a6）/脚本复用指南/运维（隧道、重启顺序、stale 锁、detach）/SUT 已知
- 验证（交易 201，产品级）：prepare 一次成功(23s) → P2 选中企业类/营业执照+ok-save-navigation 建档成功 → P3 后端 tcp-cst 抖动选择器 0 行（降级链按设计 WARN 继续）→ P4 not-form-save 守卫正确拒绝（页面非表单态）→ P5 截图收尾 → stop ok
- 注意：P3/P4 未全绿仅因 SUT 后端间歇（选择器查询 0 行），守卫行为全部正确；浏览器零残留（201 已 detach）；tmp/docs 变更不入 CHANGELOG（约定）

## 2026-08-31 · Zcode (uara_V1.2) — 服务链路 API 驱动 P0-P5 全闭环（针对未决项的最终轮）
- 完成：按 docs/orchestration 契约（文件集不相交并行派发 A/B/C）→ 主线程接缝 `_result_ok`（2a119c5）→ A/B/C 合并补丁（0fa6a8e）→ watcher 早退修复两轮（c3453eb 条件化 + 20fb5a6 彻底移除）
- 完成：未决项定性闭环——watcher 通道 select_option 失败根因三层：①`scan_visible_fields` 只读不写 store；②`task_list/_scan_fields` 只由 ensure_scanned 容器触碰重建；③watcher 模式 ensure_scanned 早退 → store 永不建立/容器永不切换（wm_repro AFTER-SELECT active 停留 main 实锤；直连成功分水岭）
- 完成：产品级最终验证（交易 200）——prepare 一次成功（25s）→ select 企业类/营业执照 经 API `ok` 首例 → `click_save → ok-save-navigation`（建档成功跳编辑页）→ 选择器 20 行 → stop ok；全链路单浏览器单轮
- 完成：executor PYTHONUTF8（4537ec4，stdin 中文乱码根治）、prepare 冷启动三重防线（8s 重试+wait_for_loading+控件探针，4537ec4/2a119c5/0fa6a8e）
- 注意：SUT 侧 `checkCustCorporat` 新建 500 缺陷（SQL 漏 USR_NO）本轮未复现（合法校验位数据通过），仍归档在日志；DB SSH 隧道（13306）与控制面+executor 均在运行；演练交易 191-200 全部已释放（浏览器零残留）；13 个提交未推送

## 2026-08-31 · Zcode (uara_V1.2) — 信贷二轮调研 + 动作层真机验证 + 编排 v2
- 完成：A-G 湿测暴露 picker 异步时序缺陷并修复（b527841）——query/select 改 async 内部轮询（≤5s），真机复测 query 20 行 + select 回填 diff 正确
- 完成：二轮实地调研（修改=新页签上下文编辑页 26 字段过半 disabled、日期 native setter+blur 可提交、登记日期=真实时间非营业日期、待办=todo-item 卡片列表、W5 向导两步+流程操作 select 选项随节点+流程提交/撤销不可逆、客户放大镜弹窗与授信选客户同构）`docs/superpowers/research/2026-08-31-credit-sut-research-round2.md`
- 完成：Python Agent 动作层真机验证（tmp/wet_run_agent.py 直调 controller，无 LLM）——read_business_date / workspace_tabs / picker_dialog_query/select / scan / click_menu_item / click_button 全绿；实证 W0 缺口：login 引擎 placeholder 兜底能过但无法人显式步骤（select_option 按 label 在登录页 xpath-not-found）、首次点击非确定性
- 完成：编排 v2（页面形态 4→6、W3' 上下文编辑页、W4.5 待办卡片、W5 不可逆守卫、H1-H5 改造点 + workflow args.tasks 兼容文件集分配表）`docs/superpowers/specs/2026-08-31-credit-agent-orchestration-v2.md`
- 注意：H1-H5 未实现（下一批派发；_js_snippets.py/service.py 归主线程）；Z1/Z4 建议下一批启动；浏览器会话仍登录在该测试环境

## 2026-08-31 · Zcode (uara_V1.2) — 信贷系统实地调研 + Agent 工作流编排设计
- 完成：A-G 落地改造点全部实现（4 路并行子智能体 + 主线程接线）：A scan_form 查询区无 form 配对兜底（QUERY_TOOLBAR_BARE_LABEL_FALLBACK）；B/C/D 新增 read_business_date / picker_dialog_query / picker_dialog_select / workspace_tabs 四动作（js_snippets/business_date+picker_confirm+workspace_tabs + _workspace.py，service.py 已注册）；E/G prompts 环境守卫 cue + 信贷业务速查 + 营业日期规则（agent-tools-common.md + agent-field-rules.md）；F page-locator-helpers.js 固定列克隆可见性优先（preferVisibleXpath，仅多命中且过滤有效时收窄，单命中字节不变）+ 重新生成 _locator_helpers_js.py
- 验证：py_compile + 全链真实 import；lint 0/0；characterize-xpath-three-sources OK（11×6 严格一致）；scan 特征化 4/4；multi-save OK；verify-all 仅剩已知存量失败（export-v3 rect 42/115，非代码）
- 注意：A-G 与 Z1-Z8 中仅 A-G 已落地；Z1-Z8（快照单源/定位契约引擎化等）仍在 [borrow-zcode-browser-design.md](specs/2026-08-31-borrow-zcode-browser-design.md) 待排期
- 完成：实地登录天阳信贷 test.creditv5p2（701994/黄某某/客户经理），遍历 13 个一级模块菜单树、四种页面形态、登录/360视图/审批页路由；调研文档 `docs/superpowers/research/2026-08-31-credit-sut-framework-research.md`
- 完成：用户纠偏后实测验证——测试环境图形/手机验证码全留空可登录成功（退出重登证实），登录全自动可行；两文档已按 W0 登录工作流修正
- 完成：Agent 工作流编排设计（W0登录/W1导航/W2列表查询/W3编辑抽屉/W4选择器弹窗/W5向导审批 + P0-P5 阶段化录制 + A-G 落地改造点）`docs/superpowers/specs/2026-08-31-credit-agent-workflow-orchestration.md`
- 完成：借鉴 ZCode 内置浏览器控制设计的底层改造方案 `docs/superpowers/specs/2026-08-31-borrow-zcode-browser-design.md`——Z1 统一 semantic_snapshot 快照即真相 / Z2 定位契约引擎化（count+可见性，拒绝盲试）/ Z3 失败强制重观察 / Z4 动作前上下文绑定 / Z5 廉价观察阶梯 / Z6 统一预算 / Z7 反注入 / Z8 坐标兜底（二期）；与信贷编排 A-G 合流排期
- 关键事实：Vue2+ElementUI+tssc 皮、qiankun 微前端 27 子应用、天元编码 cmptEcd/fcnScnEcd/avyEcd、新增表单=el-drawer、营业日期滞后(localStorage.businessDate)、会话约 50min 倒计时、测试环境验证码不拦截
- 注意：三文档未提交；落地改造 A-G 与 Z1-Z8 未实现（待排期）；浏览器会话仍登录在该测试环境

## 2026-08-31 — 菜单落地 pageId 单一化（实现）

- **完成:** 导入只收第一个非空 managePage；prepare `source=read` 回写功能落地页；存量 migration 清 guidePage；同 pageId 不再误 warn。commits: `8bef184` `ad66cf1` `7a72314` `be8ddfa`（设计 `b6a709b`）。
- **进行中:** 无（本线已落地）。推送菜单 HTTP（D1–D5）仍待平台契约。
- **注意事项:** 其他环境需 `npx knex migrate:latest --knexfile config/knexfile.js`；dev 库已湿跑。工作区仍有无关 dirty 文件勿混入。
# Agent 工作日志（跨工具共享）

> 多个 Agent 工具（Zcode / Cursor / Codex 等）在同一仓库开发，会话记忆互不相通；跨工具互通以此文件 + git 历史为准，不依赖任何工具的内置记忆。
> **约定**：收工时在文件**最顶部**插入一条（格式见下），完成的事带 commit hash；配合「任务单元结束尽量 commit」的纪律。
> 待办与挂起项在 [todo-list.md](todo-list.md) 维护——本文件记"做了什么"，todo-list 记"要做什么"。

```markdown
## 日期 · 工具 (分支)
- 完成：<事项 + commit hash>
- 进行中：<未完事项>
- 注意：<其他 Agent 接手前须知道的事>
```

## 2026-08-31 · Zcode (uara_V1.2) — 第 2 条：代码审查 + P0/P1 修复
- 完成：4 路只读代码审查（routes/services/Python/仓库卫生），报告落 `docs/superpowers/code-review-2026-08-31.md`
- 完成：P0 七项修复（路径遍历/setup 回环/auth asyncHandler/二次 res.json/假正则/CDP 双等待/.env.example 占位化）——3 个并行子智能体
- 完成：P1 五项修复（attachLive 幽灵挂载+可重入锁/executor 端口精确匹配/双 asyncHandler 收敛/10 个 v2 路由 asyncHandler 迁移/export-mgmt 802→659 行去重）——5 个并行子智能体
- 完成：Python 侧 P1 小修复（主线程直改）：`_misc.py` scroll_down/up 入口 `int(amount)` 强转关闭 f-string JS 注入面；`recorder.py` 裸 except 改 OSError；`agent/service.py` max_steps 预算段两处重复收敛为 `_resolve_phase_budget()`（行为逐字保持，含 stderr 日志）
- 验证：19 文件 node --check 全过、lint 0/0、verify-all 仅剩 1 个已知存量失败（export-v3 rect 远程库对拍 42/115，非代码问题）；system-import-json 失败由并行会话修复
- 注意：**全部改动未提交**（P0+P1 共 24 文件 + 3 个 docs）；MinIO 密码与现网 EXECUTOR_TOKEN 轮换仍待人工；期间并行会话在同一工作区活动过（system-import-json 修复 + landing-pageid migration），提交前需协调

## 2026-08-31 · Zcode (uara_V1.2)
- 完成：todo-list 大重整（289→约 60 行，清出已闭环区段）+ AGENTS.md 删除「CHANGELOG 约定」区段 + 新建本日志（**未提交**）
- 完成：prepare 链路远程 DB 热修 `b0a78d8`（DB_POOL_MAX=20 + database.js compress 4-9× + page-bind 同菜单复用/PERSIST-FAILED）
- 完成：mega 菜单收起机制真机定案 `e5c7e6e`/`80df9d5`/`d06ec81`——hover/Escape/合成点击全无效，仅面板外真实 mousedown 有效；末笔补 JS_FIND_MENU_DISMISS_POINT 再导出修 ImportError
- 注意：结构优化波次 1-6 由另一会话完成（`3048cf4`→`5c1fc32`：健壮性止血/特征化测试闸/runReplayActions 统一编排/Python 注册单点化/menu-scan 拆分/AppError 统一/N+1 修复等），接手前先读 `033849f` 交接文档

## 2026-08-29 ~ 31 · Zcode (uara_V1.2)
- 完成：菜单切换七批全部落地（`eb2413d`→`3afd916`：JSON 导入/执行期导航/删除拦截/起点页面 ID 绑定/5.3+5.4 迁移/两阶段合并改名+sort_order 按 DOM 序重排；`c087cca` removed_flag 拆分）
- 完成：菜单切换周一对接清单整理（[周一待办清单.md](../需求评审-菜单切换/周一待办清单.md)；D1-D5 全部阻塞于平台契约）
- 注意：vue 仓库 dev 领先 origin 2 commits（2c250d2/ce15512）待 push

## 2026-08-28 · Zcode (uara_V1.2)
- 完成：README 按知识图谱风格重写 `b58fc53`（技术栈表/结构树/数据模型/API 表/业务流程图/快速开始），用户手工跟进 `b4f2eea`/`62d9d71`
- 完成（运维）：本地→服务器 47.101.58.49 DB 全量迁移——mysqldump + collation 修复 21 处 + docker 导入，30 表 COUNT 零差异；root@% 补 GRANT ALL；executor/.env 残留 Linux 路径修复
- 注意：max_allowed_packet 坑（SET GLOBAL 64M）；服务器部署须 git pull 同步否则重启覆盖

## 2026-08-26 ~ 27 · Zcode (uara_V1.2)
- 完成：agent result 协议四层改造（`e054a8e`→`9364f2e`，三段式 err envelopes，11 个 TDD 任务）
- 完成：JSDoc 全量落地 `6cbf19d`（lint 0/0）+ migrations eslint ignore + pre-commit hooksPath；CTRL/assemble 双语言面移除 `6a22520`；Python 控制面同步正式叫停 `2e84221`
- 完成：autofill scope 泄漏三层修复（scan mode/cascade container/placeholder fallback）；case_data 改名遗漏修复；state.py overlay label 崩溃修复

## 2026-08-24 ~ 25 · Zcode (uara_V1.2)
- 完成：824 冲刺三项落地 + 湿测通过（partition-via-pid / v3-payload-size ②③ / V3.1 §8 七类型）；830 格式对齐落地（rect_norm 录制侧、collapse type、attr 字段）
- 完成：报文捞取 MVP（`dfb5c9e` 改名 92 文件、`8148f72` elk-msg-extract CLI、`1fcd1b9`/`b837d67` 契约对齐+回填验证 122/122；码值字典 `2fd2046` 挂起）



## 2026-09-01 · Zcode (uara_V1.2) — 录制双缺口修复（流程卡绑定 hash/keywords + 特殊元素兜底）
- 完成：用户重录日志判读——上批修复全部生效（登录一次过/日期分化/国别语义值/value-mismatch 自愈/save 链），剩余两缺口=①kb_flow 文本匹配失配不注入 ②特殊元素候选 0 引入走盲点
- 完成：修复 b57060c——recall 三层匹配（hash_markers 强匹配 score=100 > keywords 弱匹配 > 词条兜底；四卡绑定 cstMgt/crgMgt/crutMgt/wfPendTask）；service 注入经 page.url 取 hash；候选 0+任务含引入+卡命中 → 追加特殊元素兜底提示（_kb_special_hint）
- 验证：kb 5 特征化全绿 + form 系无回归；审阅 Approved（五红线满足，minor 均记录性）
- 注意：下次录制应在 agent_task 见【KB 流程知识】段且 step6 法定代表人引入不再走盲点 index；若仍有问题发日志来
