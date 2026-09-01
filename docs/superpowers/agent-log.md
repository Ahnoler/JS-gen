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
