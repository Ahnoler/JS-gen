# Agent 协作日志

## 2026-09-17 10:15 · OpenCode — 收工：开放页 navigate 门闩对「页内向导」不可满足，改以入口点击为证据

- 完成：**`ad817a95`**（2 文件 / +71 -13）。重启复测（sid 591434fa）仍 `observed=[]`、阶段1 判失败中止——**非部署未生效的必然证据**，而是门闩本身对该 SUT 形态不可满足：对公客户评级申请向导**页内渲染**（URL 不变，且不被 `_guard_done_capture_page_block` 的 `.el-dialog`/`.el-drawer` 探针识别，overlay 标题前后相同/为空）→ `url_change`/`page_opened` 永不可观测 → 每步 done 被拒。
- 修复：`_guard_done_record_open_page_evidence` 增**第二证据源**——overlay 不可见且本阶段已有**业务点击**（`_count_phase_business_actions>0`）时，以该入口点击作为 `page_opened` 证据（detail `open-page entry click`）。零业务动作守卫仍拦无点击假 done；错误门闩不豁免。
- **可观测性**：该 helper 对 open_page navigate 阶段**每次 done 必打** `[recorder] open-page evidence check: overlay=... actions=... observed=... needed=...` —— 若下次日志**没有**这行，即说明执行机仍在跑旧代码（未拉取/未重启到本提交）。
- 验收：`characterize-phase-runtime` pin 增两断言（页内 open_page + 有入口点击→打证据；仅 meta 动作→不打）；`characterize-g3-done-gate-live` 11/11、`characterize-recorder-phase-reset` 39、phase-reviewer/flow 全绿；**verify-all = 既有基线同 4 红**，无新增红。
- 遗留移交：①请再重启执行机并复测；若日志出现 `open-page evidence check:` 行则应一次过（若仍失败，请把该行回传以便定位 overlay/actions 实际值）；②回退点=本提交；③不维护 CHANGELOG。

## 2026-09-17 09:50 · OpenCode — 收工：复核远程拉取（ZCode G3 湿测 pin）对本线修复的影响

- 完成：**`2dd46f0b`**（1 文件 / +9）。远程新增 `53dec0e9`（ZCode G3 湿测：`characterize-g3-done-gate-live.py` 11 checks 真 Chromium + `characterize-g3-runner-seam.mjs` 9 checks，均注册 verify-all）并 merge 到本线 `07569560`。
- 影响复核：①`git diff c84f10c8 HEAD -- scripts/agent/recorder_emitters.py scripts/controller/actions/phase/** scripts/prompts/phase-reviewer-prompt.md scripts/characterization/characterize-phase-runtime.py characterize-phase-reviewer.py` **为空**——合并没有改动本线任何修复文件；②新品 pin 与本线改动**共用被合并的 `_guard_done_on_step_end` 本体**，实测 `characterize-g3-done-gate-live` **11/11 OK**、`characterize-g3-runner-seam` **9/9 passed** —— 本线两处修复（other→无 token、navigate open-page overlay 证据）与新品 pin 不冲突。
- 修复：新品 pin 在 Windows GBK 控制台 / verify-all 重定向下打印 `✓/✗/—` 抛 `UnicodeEncodeError`（本机 verify-all 因**编码**而非逻辑报红）→ 在该文件顶部把 stdout/stderr `reconfigure(encoding='utf-8', errors='replace')`（**不改任何断言/逻辑**）。
- 验收：`characterize-g3-done-gate-live` 默认环境下 **OK (11 checks)**；**verify-all 全跑 = 既有基线同 4 红**（step-highlight / layer-tree / confirm-notification / network-capture），无新增红。
- 遗留移交：①生产须重启执行机侧 Python agent 进程生效（本线两处修复 `6367f55`/`c84f10c8`）；②`53dec0e9` 自述「未覆盖完整 record/prepare→start 周期（需重启控制面，且有他线在途录制 1908/832）」；③不维护 CHANGELOG。

## 2026-09-16 22:24 · ZCode 引擎线 — 收工：G3 证据门闩湿测 + 护栏固化（回链 22:16 开工）

- 完成：`53dec0e9`（2 支新门禁 + verify-all 注册）。**湿测做了两半**：①**引擎侧活体** `characterize-g3-done-gate-live.py`（11 checks）——真 Chromium + 真 `compile_boundary`/`apply_phase_intent` 产出的 phase boundary + 真合并后 `_guard_done_on_step_end` 本体（仅 agent 用忠实 shim：守卫只读 browser_context/_message_manager/state，grep 实证）；②**runner 接缝** `characterize-g3-runner-seam.mjs`（9 checks）——把我合并时改写的那两处表达式（整轨聚合 + per-run 零步过滤）**从合并后源码逐字抽取后 eval**，不另抄一份，避免镜像漂移
- 关键验证点：A 类「0 业务步（仅 meta）却自报成功」→ 必须被拒，**且返回值 identity 为 True**（这正是 `abea7695` 修的那一行：PR 原版裸 `return` 返 None，调用方 `recorder.py` 按 truthy 判定 → 静默放行）；B 类「真机点过查询并经 `maybe_record_click_completion_evidence` 写入 `query_clicked`」→ 放行（**无过度拒绝**）；C 类无 boundary → G3 不介入；D 类 0 步但 `done(success=false)` 诚实失败 → 放行。接缝侧另钉**键空间契约**（`phaseStepCounts` 写侧 `trajectoryPhaseId`/`phaseIdHint`、读侧 `phase.id`/`p.id`，同源数字键）与**迟到步不误杀**（本轮计数已 >0 的阶段不得降级）——后者正是刻意不采纳 PR 同步 DB 计数判定的理由
- 证伪（门禁必须能红）：把该分支还原成 PR 原版裸 `return` → 活体门禁红（`2/11`，`return=None`）；源码 md5 逐位还原后复绿（`11 checks`）
- verify-all 全量：3 红 = step-highlight / layer-tree / confirm-notification（既有基线，与合入前逐项同），两支新门禁均绿 → 无新增红
- **未做（阻塞，非跳过）**：全链 `record/prepare → record/start` 湿测。三条硬前置：①合并后的控制面 JS（`trajectory-recording-runner.js`）要重启 4097 才生效，而**此刻他线有活跃录制**（remote-session 1908 / traj 832 / slot 0 / node 7 HZX），重启会掐断它——不越界；②`prepare` 自带默认登录，需 SUT 账号与凭据授权（凭据不经我手）；③执行机槽位会被抢占。条件具备即可补跑
- **观测（不作因果声称）**：他线 traj 832 在**合并后的引擎代码**上跑过（22:14–22:16），phase 1 有 **1 步** `click_element_by_index` 后判 `failed`、phase 2/3 pending、`isSuccessful=0`、`hasStderrLog=false`。因 phase 1 **非 0 步**，零步门禁不可能对它生效；但 stderr 未留存，我无法判定其失败是否与 G3 证据门闩（`submit.required` OR boundary 的双条件 `needs_token`）有关——**已在此留痕供该线自查**，我不下结论
- 顺带：本单元 `git pull` 并入他线 `6367f551`（非提交类阶段收口不再被指示点 click_save/确定），与 G3 互补，合并无冲突
- 遗留移交：①条件具备时补跑全链（上面三条前置）；②`characterize-g3-runner-seam.mjs` 依赖从源码抽取表达式，若 runner 那两处被改写需同步更新抽取锚点；③临时脚本 `tmp/wet-g3/`（gitignore，含证伪用例）不入库
- 注：不维护 CHANGELOG

## 2026-09-16 22:16 · ZCode 引擎线 — 开工：G3 证据门闩湿测取证 + 护栏固化

- 进行中：对 PR #45 合并产物（`c0cfa03e`+`abea7695`）做湿测，并把可复用的活体验证固化为门禁。已跑：①引擎侧真机守卫（真 Chromium + 真 boundary 状态 + 真 `_guard_done_on_step_end`，含证伪）12/12 过；②runner 接缝（逐字抽取合并后源码里我改写的那两处表达式）9/9 过
- 范围（可写集）：新 `scripts/characterization/characterize-g3-done-gate-live.py`、新 `scripts/characterization/characterize-g3-runner-seam.mjs`、`scripts/refactor/verify-all.sh`、本协作日志。**不改产品代码**
- 禁入区：**此刻有他线活跃录制**（remote-session 1908 / traj 832 `recording`，22:14:48 创建）——故**不重启 4097、不动该会话、不抢执行机槽位**；`origin/master` 不动；他线 `replay-*`/`req-draft-traj`/`form-structure-heal` WIP
- 方式：主会话 Inline；临时脚本在 `tmp/wet-g3/`（gitignore），只把可确定复现、不依赖 SUT/MySQL 的两支固化为门禁（证伪用的"临时改写源码再还原"不入门禁——硬杀可能留下已改文件；该形状已由 `characterize-recorder-phase-reset` 的"每个拒绝分支必须 return True"钉住）
- 遗留：全链 `record/prepare → record/start` 湿测**待具备条件**（需 4097 重启加载合并 JS + 他线录制结束 + SUT 登录授权）

## 2026-09-16 22:27 · OpenCode — 收工：修复 navigate 开放页证据门闩卡死录制（回链本会话 21:35 线；附排查结论）

- 完成：**`c84f10c8`**（2 文件 / +142 -1）。用户报「录制在第二步报错中断」，并问是否上次改动所致。**结论：非上次改动（`6367f55`）所致**——该 run（sid 3718d161）阶段1 被 LLM 评审判为 `mode=navigate success.kinds=['url_change','page_opened']`（来自 ZCode 21:03 合入的 PR #45 G3 门闩，`navigate` 以前 `success_when=[]` 不受门闩约束）。点击【评级申请】(index 48) 打开的向导是**抽屉**：URL 不变、且 click 埋点的 overlay 标题在抽屉异步渲染前就采样 → `observed=[]` → `done(success=true)` 每步都被拒（step 3/5/6）→ `chosen=5` 步耗尽、录制中断。
- 两处修复（`scripts/agent/recorder_emitters.py`）：①新增 `_guard_done_record_open_page_evidence`——navigate 且 `goals` 含 `open_page` 时，done() 时**可见的目标 overlay 本身即 `page_opened` 证据**（click 埋点漏采的兜底；零业务动作守卫仍要求本阶段确有真实点击）；②新增 `_guard_done_nav_evidence_ok`——navigate 阶段自身 `success_when` 已满足时，可见 overlay 就是目标页/下一步，`_guard_done_reject_overlay` 不再误拒（保留 introduce_ok/save_ok/navigated_ok 豁免；错误门闩 `_guard_done_reject_errors` 未动，可见错误通知仍拦）。
- 验收证据：pin 追加到**已注册**的 `characterize-phase-runtime`（新 `test_open_page_overlay_evidence_and_overlay_gate`：open_page 无证据→门关；打 overlay→`page_opened` 记录→门开；overlay 门从拒到放行；wizard `click_next` 无 open_page 不吃 stray overlay）；**verify-all 全跑 = 与既有基线同 4 红**（step-highlight / layer-tree / confirm-notification / network-capture），无新增红。期间 `characterize-recorder-phase-reset` 曾因 pin 正则 `_guard_done_reject_\w+\([^)]*\)` 不容嵌套括号而红——改为先把 `nav_evidence_ok` 落变量再传参（**未改 pin**），复跑 39 checks OK。
- 遗留移交：①**真机复测**建议：对公客户评级「点击评级申请→向导抽屉」应一次 done 通过；②生产须重启执行机侧 Python agent 进程生效；③回退点=本提交；④不维护 CHANGELOG。


## 2026-09-16 21:59 · OpenCode — 收工：修复 AI 录制阶段收口被强行注入「点击确定」虚拟步骤（回链 21:35 开工）

- 完成：**`6367f55`**（5 文件 / +114 -10）。根因：对公客户评级申请阶段3（任务=点击【下一步】→进入风险阻断）的 LLM 评审合约 `mode=other` 自造了**不可录制**的成功 token `success.kinds=['step_change']`；PR #45 的 G3 证据门闩要求边界 `success_when` 被观测，`step_change` 永不满足 → `done(success=true)` 反复被拒 → 恢复处方兜底写死 `click_save()` → agent 去点「确定」，点到整个向导的提交确定并触发服务端业务异常「该客户已发起评级流程…」——即用户反馈的「阶段3 页面没有确定按钮却跑出一个点击确定步骤」。
- 四处修复：①`phase/reviewer.py` `_NO_SUBMIT_TOKEN_MODES` 加入 `other`——兜底态强制 `submit.required=false` / `success.kinds=[]`，与规则编译 `compile_boundary` 的 `role=other → success_when=[]` 对齐；②`phase/intent_gates.py` 恢复处方改 **mode-aware**：仅 `create/modify` 才 `click_save`，`introduce_pick`→「选行后点确认」，`navigate/query/login/other` 各给正确动作；非提交阶段同时撤下「确认 allowed」的暗示。口径遵循用户裁决「**不强行加，不是不能试**」——只撤下注入的处方，不加硬闸阻止 agent 自行尝试（`click_save` 引擎不再新增拦截，避免误伤 picker 确认 / introduce）；③`phase/intent_contract.py` 规则编译路径 `recovery.next_action` 同样改 mode-aware（此前 `other/login/query` 也写死 `click_save(保存)`）；④`scripts/prompts/phase-reviewer-prompt.md` 明确 `navigate/query/other` **必须** `submit.required=false` / `success.kinds=[]`、禁自造 token，并推荐向导「下一步」用 `navigate`（「下一步」本身就是该阶段的提交式收口）。
- 关键判据（离线复现修复前/后）：`boundary success_when ['step_change']→[]`；`phase_done_ok after nav_next_clicked False→True`；恢复处方 `click_save() → done(success=true) ... (this phase requires no save/confirm step)`。即点完【下一步】`done()` 直接通过，不再产生恢复处方与额外确定步。
- 验收证据：回归 pin 落在**已注册**的 `characterize-phase-reviewer`（`other` 无证据门 + 恢复处方不点 click_save + `create` 仍点 + 规则编译器 mode-aware）→ PASS；定向门禁全绿（phase-reviewer / reviewer-flow / runtime / boundary / introduce-dialog-close / save-cue-promote / done-accept-reason / ai-phase-element-guard / refill-contract / form-assistant / assistant-mission-context / phase-intent / phase-done-evidence-gate）；**verify-all 全跑 = 与既有基线同 4 红**（step-highlight / layer-tree / confirm-notification / network-capture），无新增红；三模块 `ast.parse` + import 通过。
- 未改（防误伤）：`click_save` 引擎不加「非提交阶段一律拒点」硬闸——无匹配按钮时引擎本就 `save-button-not-found` 且不落步，故**消除「被指示去点确定」的处方即消除虚拟步**。
- 遗留移交：①生产须重启执行机侧 Python agent 进程生效（LLM 评审器下次会话生效）；②若后续发现导航/查询阶段因 `other` 无证据门而过度宽松（过早 done），回退点=本提交；③不维护 CHANGELOG。

## 2026-09-16 21:35 · OpenCode — 开工：修复 AI 录制阶段收口被强行注入「点击确定」虚拟步骤（sid 4460cf2a 阶段3）

- 进行中：真机日志显示阶段3 点击【下一步】后 `done(success=true)` 被反复拒绝（`success_when=['step_change'] observed=['nav_next_clicked']`），随后 agent 被引去 `click_save(button_text='确定')` 并触发服务端业务异常；用户要求查清并修好「当前页面区域没有确定按钮时不应强行加入点击确定步骤」。已离线定位：唯一注入源是 done 被拒后的 `recovery_prescription_message`（LLM 合约无 `recovery` 键 → 兜底 `'click_save()'`）。
- 范围（可写集）：`scripts/controller/actions/phase/reviewer.py`、`scripts/controller/actions/phase/intent_contract.py`、`scripts/controller/actions/phase/intent_gates.py`、`scripts/prompts/phase-reviewer-prompt.md`、`scripts/characterization/characterize-phase-reviewer.py`、本协作日志
- 禁入区：`scripts/refactor/verify-all.sh`（他线在途 WIP，不新增注册项）、生成链 `_locator_helpers_js.py` / `src/cdp/page-locator-helpers.js`、SPA 仓、`config/`（含会话前既有 `config/.db-whitelist-seen` 运行态改动，未纳入本次提交）、线上数据库/执行机运行态
- 方式：主会话 Inline；先离线复现（构造 `mode=other + success.kinds=['step_change']` 合约）确认 `phase_done_ok=False` 且恢复处方为 `click_save()`，再最小实现；pin 落已注册文件、不新增 verify-all 注册项；跑 verify-all 与既有基线比对；不维护 CHANGELOG

## 2026-09-16 21:03 · ZCode 引擎线 — 收工：本地合入 PR #45（G3 phase_done 证据门闩，回链 20:49 开工）

- 完成：`c0cfa03e`（合并提交，17 文件）+ `abea7695`（集成修复）。PR 原提 master（分叉点 `5dddf2ea` 落后 uara_V1.2 **1034 提交**），按用户要求合到本地主线 `uara_V1.2`，未动 master。PR 作者分支 `cursor/g3-phase-done-evidence-gate-3b92`（7 提交 `539c8e76`→`9391f09c`，Cursor Cloud，12:22–12:41）
- 五处冲突处置：①`agent-log.md`——两侧无公共顶部区（我方已裁成近期窗口、协议在 `AGENTS.md`、旧档在 `archive/logs/`），**取我方 + 只插入 PR 作者两条新条目（12:22 开工 / 13:10 收工），未回灌 master 陈旧历史**；②`_misc.py` 取我方委派版（PR 对该文件是纯增量 70+/0-），其三段 G3 增量**手工移植进抽离后的 `click_action_engine.py`**（`overlay_title_before`/`url_changed`/`maybe_record_click_completion_evidence`，grep 计数 4/3/2 校验）；③`trajectory-recording-runner.js` 三块——imports 只取本文件尚未有的符号（PR 的 `countBusinessSteps`/`META_STEP_ACTIONS` 与本文件 31/32 行重名，照抄即 SyntaxError）；phase outcome 取我方（见下"未采纳"）；整轨收尾取我方并接线 PR 的 `aggregateTrajectorySuccessful` 作整轨判定单一来源、per-run 零步过滤改用 `applyZeroStepFakeSuccessGate(...).rejectedZeroStep`（两处均在 drain 之后调用，计数可信）；④`verify-all.sh` 双方新增并存，**并修正 PR 的注册路径**——`scripts/characterization/characterize-phase-boundary.py` 在我方已归档，git 改名检测把 PR 那份折进 `cold/`，故改注册 `cold/` 路径（否则门禁"文件不存在"假红）；⑤`reviewer.py` 冲突仅 docstring（`_MAINTAIN_ONLY`/`_NAV_OK` 代码 hunk 干净落地），两段文案合并保留
- **集成修复（PR 自身缺陷，我方门禁抓到）**：PR 新增的 `_guard_done_reject_zero_business_actions` 拒绝分支写成裸 `return` → 返回 None → 而唯一调用方 `recorder.py:271` 按 truthy 判定 → **被当成"未拒绝"而放行 done，零步守卫形同虚设**。改 `return True`（`abea7695`）；注释放 `if` 之前而非 `):` 与 `return True` 之间，因 `characterize-recorder-phase-reset` 钉的就是那个形状（我第一版把注释插中间，门禁如实报红）
- 未采纳（**须用户知悉**）：PR 的 phase 级同步判定是在**累积 DB 计数**（`trajectoryStepDao.listByPhase`）上算出 `success:false`；我方 v2/v3 刻意返回 `null` 交给 drain 后异步门闩，理由是录制同步延迟实测可达分钟级（588-593）会**误杀**，且累积口径在重录时被旧 run 步骤掩护（#612/#614）——这正是 per-run `phaseStepCounts` 存在的原因。故保留我方时序，**PR 的"0 步成功不得成立"意图仍端到端成立**（终态必为 failed），但判定时机是异步而非同步
- 验收：PR 自带三门禁全绿（`characterize-phase-done-evidence-gate` OK / `cold/characterize-phase-boundary` OK / `characterize-phase-runtime` PASS）；受守卫影响的 7 个门禁全绿（done-accept-reason / click-navigation-cue / kb-staging / phase-runtime / recorder-phase-reset 39 checks / cold phase-boundary / cold step-notice-scan）；合并产物 11 个 Python 模块 import 通过 + 两个 JS `node --check`；**verify-all 3 红 = step-highlight / layer-tree / confirm-notification（既有基线，与合入前逐项同）→ 无新增红**（首次合并后跑出 4 红，多出的 `characterize-recorder-phase-reset` 即上述 PR 缺陷，已修并复跑归零）
- 提示词一致性已核：`phase/prompts.py` 与 `prompts/agent-core.md` 的查询/导航收口改为"先取得证据再 done、禁 0 步假完成"，与新门闩口径一致（提示词与门闩不对齐会导致录制反复被拒）
- 遗留移交：①**湿测未跑**（PR 作者云环境无 MySQL，其条目自述"湿测未跑"）——建议对公建档/查询多阶段真机跑一遍，确认 0 步假成功确被拒且正常查询/导航不被误拒；②生产须重启控制面 + 执行机进程生效；③`release` 前若发现查询/导航阶段被过度拒绝，回退点是 `abea7695`（仅一行）与 `c0cfa03e`（整体）；④el-select 下拉栅栏等 PR 未涉及的能力未动
- 注：不维护 CHANGELOG

## 2026-09-16 21:00 · OpenCode — 收工：修复 RSCF frameId 恒定导致的画面反复附着/自动重连死循环（回链 20:45 开工）

- 完成：**`5b7c751b`**（3 文件 / +103 -2）。①`executor/bib-bridge.js` 新增进程级单调序号 `nextRscfFrameId()`：RSCF 头 `frameId` 不再写 Chrome 的 `screencastFrame.sessionId`（该值在**单个 screencast 会话内恒定**），改写入递增序号；`ack()` 改为始终回真实 CDP sessionId（避免把进度序号当 CDP id 回 ack）。②`src/executor-ws.js` 新增 `clearLastRscfPacket(uuid)`，在 `session.bib_ready`（执行机重建 BiB）时清该 uuid 的缓存帧，防止重挂后缓存基线序号高于新推流序号、新帧被误判为陈旧重绘。
- 根因链（实证）：前端 `useRemoteCanvas.ts` 以「收到**新** frameId」判定 streaming（`isFresh = parsed.frameId !== lastFrameId` → `streaming.value = true`，行 1004/1012），并在 `waitForFreshFrame`（行 453，baseline=subscribe 时的 `cachedFrameId`）超时后走自动重连，`recording:stream_detached` → `resetStreamOnly('画面已断开，正在自动重连…')`（行 1030）。而旧后端把 CDP `sessionId` 当 frameId（**恒定**），`isFresh` 永假 → 8s 超时 → detach+重新 prepare → 每轮生成新 remote_session（DB 实测 1894→1895→1896→1897 链，839 被反复重置回 draft），即用户看到的「正在附着画面… / 画面已断开，系统正在自动重连…」死循环；用户手动调 `detach` 也无法恢复（同一契约缺口）。
- 关键实证：自建 headless Chrome + 原始 CDP 直连实测 298 帧 `Page.screencastFrame.sessionId` **全为 1**（`b64len` 各异 ＝ 确为不同帧）→ 证明该字段是推流会话 id 而非逐帧序号；活网控制面 WS 订阅探针（`tmp/ws-frame-probe.mjs`）修复前 frameId 恒定（12 / 35），修复后为 108…135 严格递增且 `unique` 全不同。
- 验收证据：①pin 追加到**已注册**的 `scripts/characterization/cold/characterize-bib-navigate-input.mjs`（未碰他线 WIP `scripts/refactor/verify-all.sh`）——断言逐帧唯一/严格递增、跨 BibBridge 实例仍单调、ack 用 CDP id 而非 RSCF 序号；**RED→GREEN 已留档**（`git stash push -- executor/bib-bridge.js` 跑红 `1 !== 5`，pop 后 OK）。②`characterize-bib-navigate-input` / `characterize-executor-orphan-reconcile` / `characterize-session-lifecycle` / `characterize-screencast-timing` / `characterize-executor-only-bib` / `characterize-trajectory` 全绿；`node --check` + `npx eslint executor/bib-bridge.js src/executor-ws.js` = 0。③真机复验（经用户批准重启执行机 + 控制面加载新代码）：`POST /trajectories/839/record/prepare` → 新 session **1898**，WS 探针 frameId **108→135 严格递增**、`cachedFrameId=108`；DB 连续监控 60s **无新 remote_session**、1898 保持 `active`、`record_status=recording`（修复前每 2–4 分钟新建一个 session）。
- 部署：原执行机 PID 33548 / 控制面 PID 12924 已停止，新进程执行机 **25860**、控制面 **32668**（日志 `logs/executor.*.log`、`logs/server.*.log`）。启动对账日志 `[executor-ws] reconciled … { kept: 0, crashed: 2, bibReattached: 0 }`——执行机重启令 834 的 1893 与 839 的 1897 Python 进程消失，按新对账逻辑正确判 crashed（符合预期，二者需重新 prepare）。
- 遗留移交：①SPA 仍以「frameId 变化」判定 streaming（既有契约），本次令后端满足之，未改 SPA 仓；②执行机进程内序号在进程重启后从 0 重来，已由 `session.bib_ready` 清缓存兜住基线倒挂；③控制面本地 `src/cdp/remote-bridge/screencast.js` 的同名写 `sessionId` 路径为已移除的本地 BiB 挂载（dead code），未改；④不维护 CHANGELOG。

## 2026-09-16 20:49 · ZCode 引擎线 — 开工：本地合入 PR #45（G3 phase_done 证据门闩）

- 进行中：把 `origin/cursor/g3-phase-done-evidence-gate-3b92`（7 提交 `539c8e76`→`9391f09c`，作者 Cursor Cloud，12:22–12:41）合入**本地主线 `uara_V1.2`**（该 PR 原提 master，用户明确不动 master）。内容=query/navigate `success_when` 证据 + click 证据埋点 + recorder `needs_token` 双条件 + 控制面 0 步 `phase_done` 拒收 + verify-all 接入 2 pin + prompts 对齐
- 冲突面（分叉点=`origin/master` HEAD `5dddf2ea`，落后 uara_V1.2 **1034 提交**）：17 文件中 12 个双方都改过——`agent-log.md`(我方 483 次)、`refactor/verify-all.sh`(54)、`trajectory-recording-runner.js`(24)、`agent/recorder_emitters.py`(6)、`phase/intent_contract.py`(6)、`actions/_misc.py`(4)、`phase/reviewer.py`(4)、`phase/prompts.py`(3)、`phase/boundary_gates.py`(2)、`prompts/agent-core.md`(1)；3 个是 PR 新增（`characterize-phase-boundary.py`、`characterize-phase-done-evidence-gate.mjs`、`src/services/trajectory/phase-done-evidence-gate.js`）
- 范围（可写集）：仅合并产物——上述 12 个冲突文件的解冲突、`uara_V1.2` 上的合并提交、本协作日志
- 禁入区：`origin/master`（用户明示不动）；不 rebase/改写 PR 分支既成提交；冲突解法定为**保留双方**（他线条目/配置/常量一律不删，语义冲突逐处按"两边都要"合并）；不改 PR 意图（如把 0 步拒收改软）
- 方式：主会话 Inline；`git merge --no-ff` + 逐处解冲突 + 复跑 PR 自带 3 个 pin 与 verify-all 基线比对；子智能体仅用于只读定位（如需）
- 声明修正：本条为**新工作单元**（前序「字段 label 解析同族收敛」已于 19:20 收工，见下方条目）

## 2026-09-16 20:45 · OpenCode — 开工：修复 RSCF frameId 恒定导致的画面反复附着/自动重连死循环

- 现场实证：CDP `Page.screencastFrame.sessionId` **在单个 screencast 会话内恒定**（自建 headless Chrome 实测 298 帧全为 `sessionId=1`，`b64len` 各异＝确为不同帧），而 `executor/bib-bridge.js` 直接把它写进 RSCF 头 `frameId`（`_onScreencastFrame`）。前端（SPA 仓 63d6a53）以「收到**新**帧序号」判定 streaming、8s 无新帧即自动重连 → 序号永不变 → 无限「正在附着画面… / 画面已断开，系统正在自动重连…」，并每轮 `detach`+重新 prepare 生成新 remote_session（实测 1894→1895→1896→1897 链，839 被反复重置为 draft）。
- 范围（可写集）：`executor/bib-bridge.js`（RSCF 序号改进程内单调递增；`ack` 仍回真实 CDP sessionId）、`src/executor-ws.js`（`session.bib_ready` 时清该 uuid 的 RSCF 帧缓存，避免重挂后基线倒挂）、`scripts/characterization/cold/characterize-bib-navigate-input.mjs`（追加已注册的行为 pin）、本协作日志；`tmp/` 下诊断脚本。
- 禁入区：`scripts/refactor/verify-all.sh`（他线在途 WIP，不新增注册项）、`scripts/controller/actions/**`、`scripts/prompts/**`、生成链 `_locator_helpers_js.py`/`src/cdp/page-locator-helpers.js`、SPA 仓、`config/`、线上数据库/执行机运行态、`config/.db-whitelist-seen`。
- 方式：先落 pin（复用已注册的 bib navigate 冷 pin 文件）再最小实现；`node --check` + 定向 characterization + 真机 WS 订阅探针（`tmp/ws-frame-probe.mjs`）复验序号递增；不改 SPA 契约（令后端满足既有「递增 frameId」契约）。

## 2026-09-16 20:10 · ZCode 引擎线 — 开工：actions 层改动盘点 → 同事引擎同步清单 → agent team 移植

- 进行中：2026-09-16 20:10；验收=①产出「JS-gen actions 层改动 vs tansun_ui_engine 现状」同步清单（逐项：语义/来源 commit/引擎是否已有/是否需要同步）②清单中确认需同步且引擎侧适用的条目移植完成并提交
- 范围：只读调研=JS-gen `docs/superpowers/agent-log.md`（991 行）+ engine 仓 `ui_execute/engine/actions/**` 现状盘点；实现=engine 仓 `ui_execute/engine/actions/**`（具体文件集待清单确定后在本条目追加）+ 本地测试件（不提交）+ 本文件
- 禁入区：JS-gen 源码（只读）、engine 仓 config.py、push、SUT 真实数据变更；他线 WIP（`scripts/refactor/verify-all.sh` 等在途件不碰）
- 方式：lead 设计；调研双子智能体并行（R1=挖 log、R2=引擎盘点，均只读不 commit）；实现子智能体按清单文件集不相交派发；主会话复核+验证后代提交
## 2026-09-17 09:40 · Cursor — 收工：湿测 haystack 假绿（回链 09:10 开工）

- 完成：分类 haystack 改为整组正文（步骤描述 + 操作块，仍剥编号/`操作：`/来源/关键数据）。湿测「排序 + 维护…操作：【保存】」现拒 `multi_capability_task_draft`。`新增…主页` 页名不当 create（同 `编辑页` 复合词口径），open-drawer fold 仍内聚。`PROPOSE_CACHE_VERSION` 5→6。开工 `b0451600`。
- 提交：`57f57627` wet/cache-v6 RED pins → `2c1456be` full-body haystack + cache v6 + spec §4.1 → `8eb0a873` open-drawer page-title RED pins → `e522f1a8` 新增…主页 非 create。本条收工。
- 验收（本机）：
  - RED：wet group2 haystack=`【保存】`；`assertCapabilityCohesion` `ok:true`；cache pin `5 !== 6`；open-drawer `role=other/create`
  - GREEN：`characterize-capability-cohesion.mjs` **all passed**（含 C2/C6 + wet reject + 新增…主页 persist）
  - `characterize-req-draft-traj.mjs` **OK 63**（`PROPOSE_CACHE_VERSION is 6` + open-drawer fold）
  - `characterize-persist-boundary.mjs` **11 passed**
  - `characterize-atom-depend.mjs` **16 passed**
  - `npx eslint` capability-cohesion.js / propose-cache.js **0**
- 遗留移交：湿测 product-mgmt 须 cache v6 后重新 propose，勿复用 v5。Follow-up PR #47 → #46 分支。不 merge。无场景黑名单。

## 2026-09-17 09:10 · Cursor — 开工：湿测 haystack 假绿（操作：后丢失维护）

- 进行中：修 PR #46 湿测假 PASS——`extractHaystack` 只取 `操作：` 之后，导致「排序 + 维护…操作：【保存】」被当成 other→closer-only persist。TDD：先加 wet pin RED，再改分类 haystack 为**整组正文**（步骤描述 + 操作块），`PROPOSE_CACHE_VERSION` 5→6。
- 范围（可写集）：`src/services/req-draft-traj/capability-cohesion.js`、`src/services/req-draft-traj/propose-cache.js`、`scripts/characterization/characterize-capability-cohesion.mjs`、`scripts/characterization/characterize-req-draft-traj.mjs`（version pin 5→6）、本协作日志；必要时规格 §4.1 haystack 一句（防再次按旧口径回退）
- 禁入区：`propose.js` 接线、`atom-depend.js`、`flow-card-guide.js`、prompt/samples/api-docs、场景黑名单、他线 WIP、不 merge
- 方式：主会话 Inline TDD；C2/C6 必须保持绿；不跑 product-mgmt 湿测 propose

## 2026-09-16 21:25 · Cursor — 收工：能力内聚结构硬闸 Task 6 unit/falsify（回链 21:19 开工）

- 完成：Task 6 冷测自检 + C1 证伪 + `src/` 无 `missing_locate_prep` + 计划 Tasks 1–5 勾选 + PR #46 ready-for-review。**未跑** product-mgmt 湿测 propose。开工声明 `274188c8`。
- 验收：
  - `characterize-capability-cohesion.mjs` **31 passed**（C1–C6 + 编辑页 pins + prompt pin）
  - `characterize-persist-boundary.mjs` **11 passed**
  - `characterize-atom-depend.mjs` **16 passed**
  - `characterize-req-draft-traj.mjs` **OK 63**（含 `PROPOSE_CACHE_VERSION is 5`）
  - `npx eslint` 四文件 **0 warning**
  - C1 证伪：clean tree 上 `git stash push` 对已提交 helper 无效果；等价隐藏 `git rm capability-cohesion.js` → `ERR_MODULE_NOT_FOUND` exit 1（C1 无法绿）；`git checkout HEAD --` 恢复 → **31 passed**
  - grep `missing_locate_prep`：`src/` **0 hits**（仅 spec/plan/agent-log 文档出现）
- 遗留移交：湿测 W1–W4 只在本地 LMY（控制面须 cache v5 + 重新 propose，勿复用 v4 缓存）。不 merge。不维护 CHANGELOG

## 2026-09-16 21:19 · Cursor — 开工：能力内聚结构硬闸 Task 6（unit/falsify，不跑湿测）

- 进行中：仅执行 `docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md` **Task 6** 的 unit/falsify（表征全绿、stash C1 证伪、grep `missing_locate_prep` 不得出现在 `src/`、PR #46 ready-for-review + W1–W4 未勾清单）。**不跑** product-mgmt 湿测 propose。
- 范围（可写集）：`docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md`（Tasks 1–5 勾选；Task 6 仅勾 unit/falsify 步，W1–W4 保持未勾）、本协作日志、PR #46 描述
- 禁入区：`src/services/req-draft-traj/**` 产品逻辑；`scripts/prompts/**`；`src/dashboard/api-docs/**`；规格正文；他线 OpenCode 20:03（`trajectory-meta-service.js` / `trajectory-text-extract.js`）；湿测 W1–W4 / product-mgmt wet propose
- 方式：主会话 Inline 自检+证伪；不 merge

## 2026-09-16 21:50 · Cursor — 收工：能力内聚结构硬闸 Task 5（回链 21:35 开工）

- 完成：atomize prompt item-9 准备步骤改为「仅限定位类（查询/搜索/过滤/选中/点行或节点/打开或进入目标/展开/切换页签）」；`atom-depend-split-samples.md` B1 交叉引用结构闸 `multi_capability_task_draft`（多次【确定】仍 `multi_persist_task_draft`）；`kb.js` propose `notes[]` 一行列出两新 reason。pin `atomize prompt locates prep to locate-class only`。开工声明 `15e5422d`。本提交即 Task 5 产品提交。
- 前序：helper+pins `da1ed8f1`；C4+fallback `d2c6bfbb`；materialize 接线 `2f223e6b`；cache v5 `433f0b2c`；编辑页假阳性 `8a599873` / `a6d5e02e`。
- 验收：RED=`atomize prompt locates prep to locate-class only` `仅限定位类` missing。GREEN：`node scripts/characterization/characterize-capability-cohesion.mjs` **all passed**（含 C1–C6 + prompt pin）；`npx eslint src/dashboard/api-docs/groups/kb.js` 0 warning。未改 helper 逻辑、无场景黑名单、无 `不得出现上移`、未跑湿测。
- 遗留移交：Task 6 湿测 W1–W4 只在本地 LMY。不维护 CHANGELOG

## 2026-09-16 21:35 · Cursor — 开工：能力内聚结构硬闸 Task 5（prompt 一句 + samples + api-docs）

- 进行中：仅执行 `docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md` **Task 5**（TDD：pin `atomize prompt locates prep to locate-class only` RED → item-9 准备步骤仅限定位类 GREEN → samples 交叉引用 + api-docs notes）。不跑 Task 6 湿测 W1–W4。
- 范围（可写集）：`scripts/characterization/characterize-capability-cohesion.mjs`（追加 prompt pin）、`scripts/prompts/req-draft-traj-atomize-prompt.md`（item-9 一句）、`docs/superpowers/prompt-engineering/atom-depend-split-samples.md`（B1 交叉引用）、`src/dashboard/api-docs/groups/kb.js`（propose notes 一行）、本协作日志
- 禁入区：`capability-cohesion.js` / `propose.js` / `propose-cache.js` 逻辑；`atom-depend.js`；`flow-card-guide.js`；规格正文；他线 OpenCode 20:03（`trajectory-meta-service.js` / `trajectory-text-extract.js`）；Task 6 湿测
- 方式：主会话 Inline TDD；子智能体不写本文件、不 commit

## 2026-09-16 21:25 · Cursor — 收工：BLOCKER 编辑页误判 maintain（回链 21:06 开工）

- 完成：maintain `编辑` 不匹配导航复合 `编辑页/编辑页面/编辑界面`；真维护（`编辑字段`/`编辑基本信息`）仍计。闭环尾允许 other 后夹 locate/neutral。fill-step `保存概况` 不当 closer（对齐 `countPersistConfirms`）。未 bump cache，未改 Task 5 prompt。
- 提交：`8a599873` 编辑页 maintain 假阳性 + pins；`8588f04d` 曾改 haystack（回退）；`a6d5e02e` 恢复 spec haystack + `保存(?!概况)` closer。开工 `8e203550`。
- 验收：`characterize-capability-cohesion.mjs` **all passed**；`characterize-req-draft-traj.mjs` **OK 63**（含 `propose merges same-loop steps when LLM returns flowRef` 与 card-guided fallback）；`characterize-persist-boundary.mjs` **all passed**；`characterize-atom-depend.mjs` **all passed**；eslint `capability-cohesion.js` 0 warning。
- 遗留移交：Task 5+ prompt 一句 / samples / api-docs / 湿测 W1–W4。不维护 CHANGELOG

## 2026-09-16 21:06 · Cursor — 开工：BLOCKER 编辑页误判 maintain

- 进行中：`capability-cohesion.js` `detectOtherFamilies` / maintain 匹配不把导航复合「编辑页 / 编辑页面 / 编辑界面」计为 maintain（真维护如「编辑字段」仍计）；`characterize-capability-cohesion.mjs` 加 pin；`propose merges same-loop steps when LLM returns flowRef` 转绿。不 bump cache，不做 Task 5 prompt。
- 范围：`src/services/req-draft-traj/capability-cohesion.js`、`scripts/characterization/characterize-capability-cohesion.mjs`、本协作日志
- 禁入：`propose-cache.js`；`scripts/prompts/**`；`src/dashboard/api-docs/**`；规格正文；他线 OpenCode（`trajectory-meta-service.js` / `trajectory-text-extract.js`）；Task 5+
- 方式：主会话 Inline TDD；子智能体不写本文件、不 commit

## 2026-09-16 22:25 · Cursor — 收工：能力内聚结构硬闸 Task 4（回链 22:10 开工）

- 完成：`characterize-req-draft-traj.mjs` pin 改为 `PROPOSE_CACHE_VERSION === 5`；`propose-cache.js` 4→5（注释 v5 = capability-cohesion + title-as-key reject）；`verify-all.sh` 在 `characterize-persist-boundary` 后注册 `characterize-capability-cohesion`。chore **`433f0b2c`**。开工声明 `3926a134`。
- 验收：RED=`PROPOSE_CACHE_VERSION is 5` actual `4 !== 5`（未 bump 时）。GREEN：version pin ✓；`characterize-capability-cohesion.mjs` **all passed**（25 pins）；`characterize-persist-boundary.mjs` **all passed**；`characterize-atom-depend.mjs` **all passed**；eslint 三 src 文件 0 warning。
- **未全绿**：`characterize-req-draft-traj.mjs` 在 version pin 通过后于 `propose merges same-loop steps when LLM returns flowRef` 失败（`atoms.length` `0 !== 1`）。诊断：`进入编辑页` 因 maintain 族子串 `编辑` 被标 `other`，与 `维护概况` 构成两个 `other` → `multi_capability_task_draft`；fallback 同稿同样被拒。未改 `capability-cohesion.js` / `propose.js`（Task 4 禁入）。未改 prompt / samples / api-docs。
- 遗留移交：Task 5+（prompt 一句 / samples / api-docs）前需处理该既有 flowRef 闭环节 pin 与 `编辑页` 假阳性；湿测 W1–W4 仍只在本地 LMY。不维护 CHANGELOG

## 2026-09-16 22:10 · Cursor — 开工：能力内聚结构硬闸 Task 4（cache v5 + verify-all）

- 进行中：仅执行 `docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md` **Task 4**（TDD：先改 `characterize-req-draft-traj.mjs` pin `PROPOSE_CACHE_VERSION === 5` RED actual 4 → bump `propose-cache.js` 4→5 GREEN → `verify-all.sh` 注册 `characterize-capability-cohesion`）。不改 prompt / samples / api-docs（Task 5+）。
- 范围（可写集）：`scripts/characterization/characterize-req-draft-traj.mjs`（version pin 4→5）、`src/services/req-draft-traj/propose-cache.js`（`PROPOSE_CACHE_VERSION` + 注释）、`scripts/refactor/verify-all.sh`（persist-boundary 后注册 cohesion pin）、本协作日志
- 禁入区：`capability-cohesion.js` / `propose.js` 逻辑；`atom-depend.js`；`flow-card-guide.js`；`scripts/prompts/**`；`src/dashboard/api-docs/**`；规格正文；他线 OpenCode 20:03（`trajectory-meta-service.js` / `trajectory-text-extract.js`）；Task 5+ prompt / samples / api-docs / 湿测 W1–W4
- 方式：主会话 Inline TDD；子智能体不写本文件、不 commit

## 2026-09-16 21:55 · Cursor — 收工：能力内聚结构硬闸 Task 3（回链 21:40 开工）

- 完成：`materializeLlmAtom` 在 `normalizeProduces`/`normalizeDataDependsOn` 之后、`assertAtomProvenance` 之前调用 `assertCapabilityCohesion`；`!ok` → `rejected: { atomKey, reason: cohesion.reason }`。`countPersistConfirms(cleanedDraft) > 1` 仍为 sanitize 后第一拒绝。未改 `validateAtomDependGraph`。feat **`2f223e6b`**。开工声明 `cdd5b8ce`。
- 验收：RED=`C1 propose` atoms length `1 !== 0`（merged 仍入 atoms）+ `C4 propose` `1 !== 0`（title-as-key 仍入 atoms）；helper 全 ok；`C3 propose` 已 ok（`multi_persist_task_draft`）。GREEN：`characterize-capability-cohesion.mjs` **all passed**（25 pins：helper 21 + C1/C3/C4/C2 propose）；`characterize-persist-boundary.mjs` **all passed**；`characterize-atom-depend.mjs` **all passed**。`npx eslint src/services/req-draft-traj/propose.js` 0 warning。未 bump cache、未改 prompt。
- 遗留移交：Task 4+（cache 4→5 + verify-all / prompt 一句 / api-docs / 湿测 W1–W4）。不维护 CHANGELOG

## 2026-09-16 21:40 · Cursor — 开工：能力内聚结构硬闸 Task 3（materializeLlmAtom 接线 + C3）

- 进行中：仅执行 `docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md` **Task 3**（TDD：propose-level C1/C3/C4/C2 pins RED → `materializeLlmAtom` 在 `normalizeProduces` 之后、`assertAtomProvenance` 之前调用 `assertCapabilityCohesion` GREEN）。`countPersistConfirms > 1` 保持 sanitize 后第一拒绝；不把 cohesion 放进 `validateAtomDependGraph`。
- 范围（可写集）：`scripts/characterization/characterize-capability-cohesion.mjs`（追加 propose-level pins）、`src/services/req-draft-traj/propose.js`（import `assertCapabilityCohesion` + `materializeLlmAtom` 接线）、本协作日志
- 禁入区：`propose-cache.js`（Task 4 cache 4→5）；`atom-depend.js`；`flow-card-guide.js`；`scripts/prompts/**`；`verify-all.sh`；`src/dashboard/api-docs/**`；规格正文；他线 OpenCode 20:03（`trajectory-meta-service.js` / `trajectory-text-extract.js`）；Task 4+ prompt / api-docs / samples
- 方式：主会话 Inline TDD；子智能体不写本文件、不 commit

## 2026-09-16 21:25 · Cursor — 收工：能力内聚结构硬闸 Task 2（回链 21:15 开工）

- 完成：`synthesizeFallbackProduceKey`（空/`'  '`→`atom_output`，否则 `` `${trim}产物` ``）+ `assertCapabilityCohesion` 序列通过后 title-as-key（`length===1` 且 `produces[0]===trim(title)` → `produces_eq_title`；空 produces / title+另一 key 仍 ok）+ `propose.js` `fallbackDependFields` 改 `produces: [synthesizeFallbackProduceKey(title)]`（未豁免 fallback、未保留 `produces:[title]`）。feat **`d2c6bfbb`**。开工声明 `2dce38a0`。
- 验收：RED=`C4 helper: produces exact title` `true !== false` + `synthesizeFallbackProduceKey` `undefined`≠`function`；C1/C2/C5/C6 仍 ok。GREEN：`characterize-capability-cohesion.mjs` **all passed**（21 pins）；`characterize-persist-boundary.mjs` **all passed**（含 fallback 三分写 + `multi_persist_task_draft`）；`characterize-atom-depend.mjs` **all passed**。`npx eslint` 两 src 文件 0 warning。未接线 `materializeLlmAtom`、未 bump cache、未改 prompt。
- 遗留移交：Task 3+（`materializeLlmAtom` 顺序+C3 / cache 4→5 / prompt 一句 / verify-all / 湿测 W1–W4）。不维护 CHANGELOG

## 2026-09-16 21:15 · Cursor — 开工：能力内聚结构硬闸 Task 2（C4 produces_eq_title + fallback synthesizer）

- 进行中：仅执行 `docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md` **Task 2**（TDD：C4/synthesizer pins RED → `synthesizeFallbackProduceKey` + title-as-key 闸 GREEN → `fallbackDependFields` 改 `produces: [synthesizeFallbackProduceKey(title)]`）。不接线 `materializeLlmAtom` 硬闸、不 bump cache、不改 prompt。
- 范围（可写集）：`scripts/characterization/characterize-capability-cohesion.mjs`（追加 C4+synthesizer pins）、`src/services/req-draft-traj/capability-cohesion.js`（synthesizer + `assertCapabilityCohesion` title-as-key）、`src/services/req-draft-traj/propose.js`（import + `fallbackDependFields` 仅改 produce key）、本协作日志
- 禁入区：`propose-cache.js`；`atom-depend.js`；`flow-card-guide.js`；`materializeLlmAtom` 闸接线（Task 3）；`scripts/prompts/**`；`verify-all.sh`；规格正文；他线 OpenCode 20:03（`trajectory-meta-service.js` / `trajectory-text-extract.js`）；Task 3+ cache bump / prompt / api-docs
- 方式：主会话 Inline TDD；子智能体不写本文件、不 commit

## 2026-09-16 21:05 · Cursor — 收工：能力内聚结构硬闸 Task 1（回链 20:55 开工）

- 完成：helper `src/services/req-draft-traj/capability-cohesion.js`（parse / inspect / classify / sequence-only `assertCapabilityCohesion`）+ pins `scripts/characterization/characterize-capability-cohesion.mjs`。feat **`da1ed8f1`**。开工声明 `ff456d8b`。
- 验收：`node scripts/characterization/characterize-capability-cohesion.mjs` **all passed**（17 pins：parse×3、C5 classify、classify×4、C1/C5 reject、C2/C6 pass、sequence×4、no scene literals）。RED 先为 `ERR_MODULE_NOT_FOUND`。`npx eslint src/services/req-draft-traj/capability-cohesion.js` 0 warning。reason 仅 `multi_capability_task_draft`；无 `synthesizeFallbackProduceKey`；无场景黑名单字面量。
- 遗留移交：Task 2+（`produces_eq_title` / fallback `${title}产物` / propose 接线 / cache 4→5 / prompt / verify-all）。湿测 W1–W4 仍只在本地 LMY。不维护 CHANGELOG

## 2026-09-16 20:55 · Cursor — 开工：能力内聚结构硬闸 Task 1（helper + C1/C5/C2/C6 pins）

- 进行中：仅执行 `docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md` **Task 1**（TDD：characterization RED → helper GREEN）。`assertCapabilityCohesion` 本任务只做序列闸；`produces_eq_title` / `synthesizeFallbackProduceKey` 留给 Task 2。
- 范围（可写集）：`scripts/characterization/characterize-capability-cohesion.mjs`（新建）、`src/services/req-draft-traj/capability-cohesion.js`（新建）、本协作日志
- 禁入区：`propose.js` / `propose-cache.js` / `atom-depend.js` / `flow-card-guide.js`（只 import `isPersistBoundaryAction`）；`scripts/prompts/**`；`verify-all.sh`；规格正文；他线 OpenCode 20:03（`trajectory-meta-service.js` / `trajectory-text-extract.js`）；Task 2+ 接线与 cache bump
- 方式：主会话 Inline TDD；子智能体不写本文件、不 commit

## 2026-09-16 20:48 · Cursor — 收工：能力内聚结构硬闸实现计划（回链 20:40 开工）

- 完成：计划 `docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md`（T1 helper+C1/C5/C2/C6 → T2 C4+fallback `${title}产物` → T3 `materializeLlmAtom` 顺序+C3 → T4 cache 4→5 + verify-all → T5 prompt 一句/samples/api-docs → T6 自检+C1 证伪+湿测 W1–W4 清单）。**未实现闸、未 bump cache、未改 src/prompt。**
- 验收证据：计划覆盖 spec §4.1–§4.5 / §5 / §6 / §7.2–§7.4 / §8 C1–C6；reason 锁死 `multi_capability_task_draft` / `produces_eq_title`；`multi_persist_task_draft` 保持第一；无场景黑名单；无 TBD。开工声明 `9ac7c1fb`。
- 遗留移交：下一会话按该计划 Subagent-Driven 或 Inline 实现；湿测 W1–W4 只在本地 LMY；勿与 OpenCode 20:03 轨迹提示词线文件集相交。不维护 CHANGELOG

## 2026-09-16 20:40 · Cursor — 开工：能力内聚结构硬闸实现计划（writing-plans）

- 进行中：只写实现计划，**不实现**硬闸 / 不 bump cache / 不改 `src/**` 与 prompt。产物=`docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md` + 本日志短开/收；PR 合入 `uara_V1.2`。规格源=`docs/superpowers/specs/2026-09-16-capability-cohesion-structural-gate-design.md`（PR #43 仍 OPEN，本分支自 `cursor/capability-cohesion-structural-gate-design-bb60` 起）。
- 范围（可写集）：`docs/superpowers/plans/2026-09-16-capability-cohesion-structural-gate.md`、本协作日志
- 禁入区：`src/**`（含 `req-draft-traj/**` / `propose.js` / `propose-cache.js` / `flow-card-guide.js` / `atom-depend.js`）；`scripts/prompts/**`；characterization；`scripts/refactor/verify-all.sh`；规格正文（不回改 reason 字符串）；他线 OpenCode 20:03（`trajectory-meta-service.js` / `trajectory-text-extract.js`）；生成链；SPA；`config/`
- 方式：主会话 writing-plans；TDD/接线顺序/C1–C6/W1–W4 写进计划，本轮零产品代码

## 2026-09-16 20:28 · Cursor — 收工：能力内聚结构硬闸设计规格（回链 20:21 开工）

- 完成：**`55138813`** 规格 `docs/superpowers/specs/2026-09-16-capability-cohesion-structural-gate-design.md`（开工声明 `10849cd9`）。**未实现闸、未 bump cache、未改 prompt/src。**
- 验收证据：文档钉死算法（步骤组解析 → locate/persist/other 族分类 → 序列规则）、新 reason `multi_capability_task_draft` / `produces_eq_title`、与既有 `multi_persist_task_draft` 分工、PR #41 已合入依赖、实现时 cache 4→5、湿测 W1–W4、characterization C1–C6。本轮交付=规格 + 本日志；实现另开任务。
- 遗留移交：实现 plan 按 spec §7–§8 接线 `capability-cohesion.js`（或 flow-card-guide 旁）+ `propose.js` + fallback 去 title 化 + prompt 一句；勿与 OpenCode 20:03 轨迹提示词线文件集相交。不维护 CHANGELOG

## 2026-09-16 20:21 · Cursor — 开工：能力内聚结构硬闸设计规格（propose 同页多能力）

- 进行中：只写已批准设计规格，**不实现**硬闸。产物=`docs/superpowers/specs/2026-09-16-capability-cohesion-structural-gate-design.md` + 本日志短开/收；PR 合入 `uara_V1.2`。依赖 PR #41（空 produces 硬拒 + cache v4 + XML prompt）**已合入**本线。
- 范围（可写集）：`docs/superpowers/specs/2026-09-16-capability-cohesion-structural-gate-design.md`、本协作日志
- 禁入区：`src/**`（含 `req-draft-traj/**` / `flow-card-guide.js` / `propose.js` / `atom-depend.js` / `propose-cache.js`）；`scripts/prompts/**`；characterization；`scripts/refactor/verify-all.sh`；他线 OpenCode 20:03 在途（`trajectory-meta-service.js` / `trajectory-text-extract.js` / analyze-case-data pin）；生成链；SPA；`config/`
- 方式：主会话 Inline；分支 `cursor/capability-cohesion-structural-gate-design-bb60` 从 `uara_V1.2` 起；不 bump cache、不改代码

## 2026-09-16 20:03 · OpenCode — 开工：阶段拆分提示词加固 + JS 侧业务数据判定对齐（承接 18:59/19:27 线）

- 进行中：用户手动调整的提示词示例经核查**已丢失**（工作区 hash 与 HEAD 一致，VS Code 本地历史仅 `undoRedo` 条目）→ 由本次统一补做。六项：
  ① `trajectory-meta-service.js` 加 **示例6**（删除→确认弹窗的 3.1 few-shot：开窗动作全留本阶段、【确定】归下一阶段）；
  ② 规则 3 补「确认/提示弹窗按 3.1 处理」优先级指针（消除规则 3「不同弹窗分阶段」与 3.1(a) 打架）；
  ③ 3.1(c) 收窄为**仅在触发依赖不稳定中间态时**才合并「触发→确认」，并强制合并阶段预期结果写最终态；
  ④ 6.1(b) 补例外：后续要操作的**筛选字段名/字段值**（如「审批状态=待发起」）不得当无关说明删除（消除 6.1 与 7/8 冲突）；
  ⑤ 规则 8 补「唯一标识必须原样写入；未给出标识则必须写明筛选条件 + 选中首条匹配记录」；
  ⑥ `trajectory-text-extract.js` `phaseNeedsBusinessData`：`openPage` early-return 纳入 locate 判定并把 `删除|移除|作废|撤销|停用|启用|重置` 补进 `actionHasWrite`——该函数把本次真机那条「筛选审批状态=待发起→选中→删除。预期结果：打开确认弹窗」判成 false，而 Python `needs_business_data_context`（`phase/classify.py`，mode=form_modify/query）判 true，两个分类器结论相反。附 JSDoc 清理（死注释块 + 过期 `@returns`）。
- 范围（可写集）：`src/services/trajectory/trajectory-meta-service.js`、`src/services/trajectory/trajectory-text-extract.js`、`scripts/characterization/cold/characterize-analyze-case-data.mjs`、本协作日志
- 禁入区：`scripts/controller/actions/**`（含他线已收工的 `phase/classify.py`，本轮只读不改）、生成链 `_locator_helpers_js.py`/`src/cdp/page-locator-helpers.js`、`scripts/prompts/**`、`scripts/refactor/verify-all.sh`（本轮不新增注册项，pin 落已有 cold 文件）、SPA 仓、`config/`
- 方式：主会话 Inline；先补 RED pin 再最小实现；pin 覆盖必须保留的既有子串（`先搜索/查询再点击`、`不要为了凑数量而拆分`、`必须原样保留`、`禁止把具体名抹成`、`状态边界原则`、`禁止让下一阶段承担上一阶段未完成的动作`）；跑 verify-all 比对基线；不维护 CHANGELOG

## 2026-09-16 19:27 · OpenCode — 收工：录制两病灶修复（回链 18:59 开工）

- 完成：**`953c4be4`**（4 文件 / +106 -22）——①`click_action_engine.click_element_by_index` 新增 `select_trigger_click`：dd_gate 对 `.el-select` 触发框返回 `kind:'trigger'`（排除 `.el-select-dropdown`/`.el-tree`/`.el-tree-node`/`.tree-popover`/`.el-tree-select__popper`/`.el-cascader__dropdown`/`.el-popover` 内的 popper 内容），并补 `target_kind=='form_select'` 兜底；命中即**点击照做但不录制、不 `remember_phase_operation_aliases`、不 `remember_trigger_button`**，返回 `transient-select-open` 提示；option/table-row/dropdown 仍原样硬拒 `use-select-option`。②索引点击「查询」时按 `re.sub(r'\s+','',btn_label)=='查询'` 调 `mark_query_clicked`（与 `click_button` 及回放侧 `mark_stc_flags_on_replay_ok` 对齐，消除录放不对称）。③`trajectory-meta-service.js` 阶段拆分提示词新增硬规则 `3.1 状态边界原则`（预期结果为「打开确认弹窗」的阶段必须含全部开窗动作；弹窗内按钮只归下一阶段；禁止下一阶段承担上一阶段未完成动作；不确定可达时「触发→确认」合并）。
- 验收证据：① `characterize-search-then-click-guard`（**已在 verify-all 注册**）扩 pin：索引点击「查询」标记（含 `btn_label` 归一化字面量）+ 触发框分类/跳过录制/跳过记忆/`transient-select-open`/popper 排除 + dropdown 三 kind 仍拦；② `characterize-analyze-case-data.mjs` 加 `状态边界原则` + `禁止让下一阶段承担上一阶段未完成的动作` 两条 pin；**两者均 RED→GREEN**（`git stash push` 还原源码跑红、pop 后跑绿，实测输出已留档）；③ `verify-all` 全跑 = **4 红，与既有基线一致**（step-highlight / layer-tree / confirm-notification / network-capture；四者均不读本次改动文件——confirm-notification 读 `_misc.py`（HEAD 即红），network-capture 为便携 python 环境缺失）；④ `npx eslint src/services/trajectory/trajectory-meta-service.js` 0；pre-commit hook eslint 通过。
- 遗留移交：①**`already-operated-this-phase` 仍会拦「填完筛选字段后再点查询」**（本次真机日志 step 11）——未放宽：放宽会引入重复「点击元素-查询」步，取舍留待 Lead；本次该 run 首行即目标行，且死锁解除后阶段 1 可自行走完。②**索引点击按表行选中仍不受 STC 守卫约束**（`click_element_by_index` 只在 tree node 上过守卫，`click_table_row_radio` 才无条件过）——语义路径被绕过时仍可记 `click_table_row_radio`，本次未改（避免误伤既有流）。③**pin 落位偏差**：新 characterization 按 cold/README 政策应放上级目录并注册 verify-all，但 `scripts/refactor/verify-all.sh` 属他线在途 WIP，故把 pin 并入**已注册**的 `cold/characterize-search-then-click-guard.py` 与既有 `cold/characterize-analyze-case-data.mjs`，未新增注册项。④生产须重启执行机侧 Python agent 进程生效（控制面 `trajectory-meta-service.js` 仅下次 analyze 生效）。⑤**合并处置**：push 被拒（远端已有 ZCode 06b758af 等 5 提交）→ 按 AGENTS.md 先 park 工作区他线 WIP 再合并（见下行），本条目与代码提交随合并提交一并推送。⑥不维护 CHANGELOG。

## 2026-09-16 19:34 · OpenCode — 合并处置声明：park 他线 ZCode 陈旧工作区 WIP 以解阻塞

- 背景：`git push` 被拒（non-fast-forward）→ `git pull`/`git merge origin/uara_V1.2` 前发现工作区存在他线 ZCode 的**未提交**改动：一整份 `13cc5404`（字段 label 解析同族收敛）的**回滚**（含 `_js_snippets.py`、`fill_engine.py`、`js_snippets/{base,fill_core,scan_form,select_tree,misc}.py`、`select_dispatch.py`、`scripts/refactor/verify-all.sh`、删除 `characterize-field-label-resolution.py`）+ `config/.db-whitelist-seen` 运行态改动。
- 判定：该回滚为**陈旧态**——origin 上 ZCode 自己的 5 个提交（`3c1fc8ff`→`06b758af`，18:53–19:01）建立在 `13cc5404` **未回滚**的基础上并继续扩展它（`b72e1150` 用 `JS_FIELD_ITEM_PICK` 替换旧探针、`characterize-field-label-resolution.py` +130 行），即工作区回滚从未进入任何提交且已被其推送态覆盖。
- 处置：`git stash push -m "ZCode stale WIP: working-tree revert of 13cc5404 ..."` **完整保存**（`stash@{0}`，可 `git stash show -p` 查看/`git stash branch` 恢复），未删除、未 force；随后合并 origin，仅 `agent-log.md` 冲突，按「保留双方条目并排」解决（本条与 OpenCode 19:27/18:59 两条 + ZCode 20:05/18:45 及更早条目全部保留）。他线已提交代码文件一律以 origin 为准（`--theirs` 语义），未手改其内容。
- 请 ZCode/Lead 复核：若该工作区回滚**并非**陈旧（另有意图），请从 `stash@{0}` 取回后再行合并。

## 2026-09-16 18:59 · OpenCode — 开工：录制两病灶（el-select 触发点击落垃圾步 / 查询按钮未标记致 STC 死锁跨阶段串步）

- 进行中：用户真机录制（对公客户评级列表删除记录）两病灶：
  ①**垃圾步**：阶段步骤出现「点击元素 - 待发起审批中已撤销退回通过投决」——agent 用 `click_element_by_index` 点查询工具栏 el-select 触发框（「审批状态」）时，`_enrich_click_element` 的 `normalizeHost` 上浮到 `.el-select`，`cleanVisibleText` 对游离 clone 取 `innerText` 为空 → 回退 `textContent`，把**隐藏下拉的全部选项文案**拼进 text；该开框点击是瞬态 UI 动作（业务步是随后的 `select_option`），本就不该录制。
  ②**跨阶段串步**：阶段1（选中行→点删除）失败，其「选中表格行 + 点删除」被阶段2（点【确定】）重新执行并记到阶段2。根因=`click_action_engine.click_element_by_index` 点「查询」不标记 `_stc_query_clicked`（只有 `click_button` 标记；回放侧 `mark_stc_flags_on_replay_ok` 却已对 index 点击标记 → 录放不对称）→ STC 守卫在 `err-search-first:need-fill-and-query` 上死锁（`click_table_row_radio` 重试 3 次全拦）→ 阶段1 `done(success=false)` → 阶段2 补做前阶段动作。
- 范围（可写集）：`scripts/controller/actions/click_action_engine.py`、`scripts/characterization/cold/characterize-search-then-click-guard.py`、`scripts/characterization/cold/characterize-analyze-case-data.mjs`、`src/services/trajectory/trajectory-meta-service.js`（阶段拆分提示词加固）、本协作日志
- 禁入区：他线 ZCode 在途 WIP（`scripts/controller/actions/_js_snippets.py`、`fill_engine.py`、`js_snippets/{base,fill_core,scan_form,select_tree,misc}.py`、`select_dispatch.py`、`scripts/refactor/verify-all.sh`、`scripts/characterization/characterize-field-label-resolution.py`、`config/`）；生成链 `_locator_helpers_js.py` / `src/cdp/page-locator-helpers.js`；`scripts/prompts/**`；SPA 仓
- 方式：主会话 Inline；先补 RED cold pin 再最小实现；跑 verify-all 与既有基线比对；**不新增 verify-all 注册项**（把 pin 落在已注册的 cold 文件里，避免与他线 `verify-all.sh` WIP 相交）

## 2026-09-16 20:05 · ZCode 引擎线 — 收工：真机失败日志复盘四病灶最小修复（回链 18:45 开工）

- 完成（4 commits，全为「先 RED pin 再最小实现」）：
  - **D1** `3c1fc8ff`：`autofill_round.py` tssc 分支内嵌 `select_option` 结果过 `_unwrap_action_result`——根治 `run_form_assistant` 报 `Object of type ActionResult is not JSON serializable`（真机 4 次），顺带根治同因的级联不收敛（`_is_ok_result` 不认成功 → 已填 tssc 字段留 `still_empty` 反复重选 work=10/10、7/7）
  - **D2** `711f9065`：`boundary_gates.maybe_record_picker_closed` 补 `clear_phase_section`——弹窗关闭即清被 stale 重试固化的弹窗瞬态区域（`客户放大镜选择器`），根治后续裸调 `click_save` 「from memory」在死区域找保存 → `err-save-button-not-found`；覆盖 4 个关闭出口，4 处 cue 消费者泄漏面一次收净
  - **D3** `b00ec873`：`agent/service.py` 收尾门禁首次不过时按 ghost-prune 范式 DOM 实读纠正 task_list 后重跑 gate（新 helper `phase/pending_refresh.py`，只认「currentValue 非空」硬判据，空值/查无不动）+ 粘滞 `pending_fields:*` reason 按刷新后集合重生成（先于任何输出）——根治引入回填已生效仍被判过期 pending 的误判；`missing_success_token`/gate 本体一字未动（宁误拒不假绿不放宽）
  - **D4** `b72e1150`：`base.py` 新增 `JS_FIELD_ITEM_PICK`（可见精确→隐藏精确→唯一包含→歧义标记，作用域 JS_GET_CONTAINER+可见 dialog/drawer 补扫，与动作体 `findFieldItem` 同源），`fill_engine.py` 两处探针与 `select_dispatch._JS_LIVE_TSSC` 换用——根治同一字段 fill 判「是 tssc」/select 判「不是」双判矛盾（探针 `[0]` 盲取落隐藏同名 tssc 节点的假阳性）；`tssc_multi_select.py` 未动
- 验收：四个新/修订 pin 全部 RED 实证（D4 旧代码下 26 条断言失败）后 GREEN；复跑关联 pin 13 个（cascade/form-assistant/select-option-verify/phase-runtime/save-retry-scope/introduce-dialog-close/dual-save-section/ghost-pending-prune/budget-extend/fill-dispatch/fill-replay-engine/tssc-multi-select/form-engine-wiring）全绿；**全量 verify-all = 3 红（step-highlight/layer-tree/confirm-notification）与 19:20 条目基线完全一致，零新增红**；3 个新门禁已注册 verify-all。改动文件 py_compile 全过；D4 探针 JS 经 node --check 验语法（临时文件已删）
- 方式与偏差声明：D3/D4 由 2 个子智能体并行实施（文件集互不相交、不 commit），主会话回收审查 diff/复跑 pin 后代提交；D4 偏差自报：`_js_snippets.py` 追加 1 行 barrel re-export（模块自述 re-exports every constant，沿 13cc5404 先例）
- 遗留移交：①`select_tree.py` 尚有 3 处 `candidatesOf(...)[0]`（radio/tree 路径，本轮范围外；若同类假阳性复现可直接复用 `JS_FIELD_ITEM_PICK`）②budget extend（`service.py`）同用过期 pending 计步，本轮未动（`refresh_pending_from_dom` 可直接复用）③premature done 警告（`recorder_emitters.py`）仍按打开弹窗时的快照写——警告本身合理保留，粘滞由收尾 regen 清除 ④真机复验未做（四修均为离线修复+门禁；对公客户转正重跑需测试环境与数据，建议下次真机回归覆盖该流程）⑤不维护 CHANGELOG

## 2026-09-16 18:45 · ZCode 引擎线 — 开工：真机失败日志复盘四病灶最小修复（序列化炸/作用域污染/过期pending/tssc探针矛盾）

- 进行中：真机失败日志（对公客户转正，桌面 log.txt 574 行）四路根因已定位，按最小修复实施：**D1** `autofill_round.py` tssc 分支内嵌 `select_option` 成功返回 `ActionResult` 未 unwrap → `autofill_pending.py` `json.dumps` 炸（4 次）+ `_is_ok_result` 不认成功致级联同批 tssc 反复重选不收敛；修=结果过 `_unwrap_action_result`（2 行）。**D2** `phase/boundary_gates.py` `maybe_record_picker_closed` 弹窗关闭不清 `_phase_section` 粘性记忆，stale 重试（`form_save.py:233`）把弹窗瞬态区域固化 → 弹窗关后裸调 `click_save` 在死区域找「保存」not-found；修=关闭钩子补 `clear_phase_section`（1 行）。**D4** `base.py`/`fill_engine.py` ×2/`select_dispatch.py` 三处 kind 探针 `candidatesOf(...)[0]` 盲取（无可见性偏好）与动作侧 `tssc_multi_select.findFieldItem` 可见分桶解析不一致 → 同一字段 fill 判「是 tssc」/select 判「不是」互相矛盾；修=抽共享可见分桶 pick 替换三处 `[0]`（解析失败/歧义=未知走正常流程），`characterize-field-label-resolution.py` 的 `[0]` 字面量 pin 同 commit 修订。**D3** `agent/service.py` 收尾门禁纯内存读 task_list、引入回填只记 evidence 不 `mark_done`、quality reason 粘滞只增 → 过期 pending 误判 QUALITY FAIL；修=门禁不过时按 `JS_CHECK_SINGLE_FIELD` DOM 实读纠正 task_list 再重跑 gate（复用已 pin 的 ghost-prune 范式）+ 粘滞 `pending_fields:` reason 按刷新后集合重生成；`missing_success_token` 判定不动（宁误拒不假绿不放宽）
- 范围（可写集）：`scripts/controller/actions/autofill_round.py`、`scripts/controller/actions/phase/boundary_gates.py`、`scripts/controller/actions/fill_engine.py`、`scripts/controller/actions/select_dispatch.py`、`scripts/controller/actions/js_snippets/base.py`、`scripts/agent/service.py`、新 `scripts/controller/actions/phase/pending_refresh.py`、`scripts/characterization/characterize-field-label-resolution.py`（修订）、新 pin `characterize-autofill-engine-result-unwrap.py`/`characterize-picker-close-clears-section.py`/`characterize-phase-end-pending-refresh.py`、`scripts/refactor/verify-all.sh`（仅主线程注册）、本协作日志
- 禁入区：`js_snippets/tssc_multi_select.py`（b3339e2a 已验动作语义，D4 不改它）；`phase/intent_gates.py`/`section_scope.py`/`form_save.py`/`models/task.py`/`fill_dispatch.py`/`select_engine.py`（只 import 不改）；未跟踪他线 WIP `scripts/characterization/characterize-phase-done-validate.py`；生成链 `_locator_helpers_js.py`/`src/cdp/page-locator-helpers.js`；`scripts/prompts/**`；`src/**`；SPA 仓；`config/`
- 方式：主线程内联 D1/D2（先 RED pin 再最小实现）；D4/D3 派 2 个子智能体并行（文件集互不相交，子智能体不 commit 不写 log，主会话代声明、回收核验语法/pin/越界后代提交）；新 pin 由主线程注册 verify-all；终验全量 verify-all 与基线比对（基线=HEAD 3 红：step-highlight/layer-tree/confirm-notification，见 19:20 收工条目）

## 2026-09-16 19:20 · ZCode 引擎线 — 收工：字段 label 解析同族收敛（回链 18:03 开工）

- 完成：`13cc5404`（10 文件，+95/-71 级）。**单一来源** `js_snippets/base.py` 新增 `JS_FIELD_LABEL_NORM`（折叠空白/剥尾 `：:*`/剥首 `*`）与 `JS_FIELD_ITEM_CANDIDATES`（`(root,label,allowReverse) => el[]`，按 精确→包含→反向包含 排序返回）。**接线 7 个消费方**：`base.JS_LOCATOR`/`JS_SMART_LOCATOR`（录制 xpath 与 locator snap；可见性退化为对有序候选的过滤）、`select_tree.JS_CLICK_RADIO` 与 `JS_SELECT_TREE_OPTION`（两处循环）、`fill_core` Pass1/Pass2/scope 归一化 + `JS_CLEAR_FIELD_VALUE`（Pass2 仍跳精确项，只放宽不重试）、`scan_form.JS_CHECK_SINGLE_FIELD` 两遍、`misc.JS_CLICK_VERIFY_BUTTON`、`select_dispatch._JS_LIVE_TSSC` 与 `fill_engine` 两处 kind probe（精确优先使判定描述"真正会被操作的字段"，消除前缀兄弟无控件即短路的假阴性→select 走错分发）。**刻意不动**：按文案匹配选项/按钮/菜单/单元格（`replay_js` 菜单项、`fill_date` 面板项、`table_cell`、`icons`、`_misc`）；`scripts/prompts/**` 未改（本轮为行为对齐，非新语义）
- 验收（四层）：①**生成物真机**——7 个 snippet `node --check` 全过；Playwright 活页面证 5 层级（候选序、`JS_LOCATOR`/`JS_SMART_LOCATOR` 落在 `*要素名称` 而非前缀兄弟、正向包含兜底、反向包含仅 opt-in、radio 点中精确组、验证按钮点中精确项）②**新门禁** `characterize-field-label-resolution.py`（源码 pin 全消费方 + 禁旧式字面量 + 活页面 5 断言），**双向证伪**：还原旧 `includes` 首中文面量→红、只变异标签取值来源（源码 pin 不覆盖）→活页面断言红，还原即绿 ③**verify-all**：3 红 = step-highlight / layer-tree / confirm-notification，**已用"源码还原到 HEAD + md5 守卫还原"对跑复现同形**（`FAILED (3)` / `1 FAILURE(S)` / `all markers present`）→ 非回归；network-capture 本轮由红转绿（环境）④同时把此前**未注册**的两个 cold 门禁 `characterize-prefix-label-{select,xpath}` 拉回门禁（verify-all 141 项）
- 偏差声明（超出 18:03 开工声明文件集，事后自报）：①`_js_snippets.py` 仅补 barrel re-export（该模块自述"re-exports every constant"）②`js_snippets/misc.py` 的 `JS_CLICK_VERIFY_BUTTON` 亦属同族（按 label 定位字段→点按钮），在回收阶段发现并一并收敛
- 遗留移交：①`characterization/cold/characterize-live-xpath-e2e.mjs` 内嵌 **JS_SMART_LOCATOR 手抄镜像**（未注册门禁，且其 pickControl 清单早已与实现漂移）——本轮未动，若复活该 fixture 须同步镜像 ②`scripts/smoke/result-protocol-live.py:89` 自带内联 kind 探测副本（smoke 豁免区）同样未同步 ③`base.py:157` placeholder 兜底仍为 `ph.includes(label) || normalizeFormLabel(ph) === want` 单次判断（末级兜底，未纳入本轮）④eslint 存量 25 warning 全在 .js（本次零 .js 改动，非本线引入）
- 注：不维护 CHANGELOG

## 2026-09-16 17:59 · OpenCode — 收工：回放汇总步数把自动注入的 meta 检查点也计入（回链 17:52 开工）

- 根因：`prepareReplayBatch` 会把选中步区间内的 `META_STEP_ACTIONS`（本次= `save_form_snapshot`）补进 `actions`/`orderedStepIds`；`runReplayBatch` 的 `if (typeB.ok) successCount += 1` 与 `buildPayload` 的 `count: allResults.length` 把它当业务步，FE 用 WS `replay:finished.successCount` 显示「回放完成 N 步」（`useRecordingStudio.ts:726-741`）→ 勾选 4 步却提示 5 步
- 完成：`4a812814`——`replay-batch-runner.js` 引入 `isMetaStepAction`，Type B 成功分支/普通成功分支/retry-ok 三处 successCount 均跳过 meta；`buildPayload` 的 `okCount`/`count` 只算业务步，`failCount` 保留 meta 失败（按用户拍板「成功不计；失败仍计入失败数」）；`/api/docs` 补 note（stepIds 含补入 meta；count/successCount 只计业务步）
- 验收：`characterize-replay-batch` 新增 2 pin（meta 成功不计 / save_form_snapshot 无快照跳过不计）+ 1 结构 pin（meta 失败仍入 failedStepIds）——**先 RED**（还原旧实现跑出 2 处断言失败）**后 GREEN**；verify-all 复跑=既有 4 红不变（step-highlight/layer-tree/confirm-notification/network-capture 均他线数据/环境），本烟绿；eslint 改动文件 0
- 用户口径确认：前端「失败步保持勾选 / 成功步取消勾选」为预期形态——本改纯后端计数，不动 `replay:step`，勾选逻辑不受影响；meta 检查点成功后不再让提示多 1 步，失败时仍会「成功4，失败1」提示（用户已确认接受）
- 遗留移交：本地后端（交易 830 所属）重启后生效；未改 SPA 仓；未改 Type B 安全性策略；不维护 CHANGELOG

## 2026-09-16 18:03 · ZCode 引擎线 — 开工：字段 label 解析同族收敛（归一化 + 精确优先）

- 进行中：接 10:52 收工的 tssc 病灶（`b3339e2a`），把**同族**的「按 label 定位字段」一并对齐到仓库既有规范——`select_trigger._tryItems` 与 `characterize-prefix-label-select`/`characterize-prefix-label-xpath` 已确立的「归一化（折叠空白/剥尾 `：:*`/剥首 `*`）→ 精确优先 → 首个 `includes` 兜底」。现存不合规点：`select_tree.py`（radio 与 tree select 仍用 `l === label || l.includes(label)` 首中即返）、`base.py`（`JS_LOCATOR` 首个 includes 且未归一化；`JS_SMART_LOCATOR` 部分匹配 last-wins）、`fill_core.py`（Pass1/Pass2/scope/clear 未归一化）、`scan_form.py`（pass1 裸等值）、`select_dispatch.py`（`_JS_LIVE_TSSC` 首中即返 → 同族字段非 tssc 时假阴性）、`fill_engine.py`（两处重复 kind probe 同形，假阴性致 select 走错分发）。**只治「按 label 定位字段」；不动按文案匹配选项/按钮/菜单/单元格的路径**
- 范围（可写集）：`scripts/controller/actions/js_snippets/{base,select_tree,fill_core,scan_form}.py`、`scripts/controller/actions/{select_dispatch,fill_engine}.py`、新 `scripts/characterization/characterize-field-label-resolution.py`、`scripts/refactor/verify-all.sh`、本协作日志
- 禁入区：`scripts/controller/actions/js_snippets/_locator_helpers_js.py` 与 `src/cdp/page-locator-helpers.js`（生成链，勿手改）；`js_snippets/tssc_multi_select.py`（已收工）；`scripts/prompts/**`（本轮纯对齐，不改提示词）；他线 `replay-batch-runner.js`/`trajectory-session-replay.js`（OpenCode 17:52 在途）、`src/services/req-draft-traj/**`、`src/services/trajectory/form-structure-heal.js`、`product_library.json`、`config/` WIP、SPA 仓
- 方式：主会话先落共享片段 `JS_FIELD_ITEM_PICK`（单一写者，避免并行冲突）→ 3 个子智能体并行改**互不相交**文件集（子智能体不 commit、不写 agent-log，主会话代声明代提交）→ 主会话回收核对语法/lint/越界 + 新增 characterization + verify-all 基线比对
- 说明：本轮为**行为对齐**（精确命中即调用方本意），不引入新的报错语义

## 2026-09-16 17:52 · OpenCode — 开工：回放汇总步数把自动注入的 meta 检查点也计入

- 进行中：只勾选 4 步却提示「回放完成 5 步」——根因=`prepareReplayBatch` 自动补入选中区间内的 meta 检查点（`save_form_snapshot`）进 `actions`/`orderedStepIds`，`runReplayBatch` 的 `if (typeB.ok) successCount += 1` 与 `buildPayload` 的 `count/ok/failed` 把它算作业务步；FE 用 WS `replay:finished.successCount` 显示「回放完成 N 步」（`useRecordingStudio.ts:726-741`）。修向=汇总只计业务步（与 `trajectory.js` 文档「stepCount 亦只计业务步骤」一致），meta 检查点的成功/失败不计入用户面计数
- 范围：`src/services/trajectory/replay-batch-runner.js`、`src/services/trajectory/trajectory-session-replay.js`（如 202 步清单需对齐）、characterization pin、本协作日志
- 禁入区：SPA 仓（`ui-auto-recording-agent-vue`）；他线 atom-depend/propose、cdp locator text、tree-node-dirty-suffix；`config/` WIP；不改 Type B 安全性策略与 `assessFormStructureDiffSafety`
- 方式：主会话 Inline（先 RED pin 再最小实现）；跑 verify-all；分支 `uara_V1.2`

## 2026-09-16 18:20 · Cursor — 收工：产品树脏后缀 SDD Task 1–5（回链 17:12 开工）

- 完成：`55f3a622` 清洗函数保留 `[V-…]`、剥 `(N)`/尾部装饰 `-` + DOM 内层 span；`550a643b` 录制 snap/manual/AI/CDP 落库净文本；`7c13b820` 回放 `stripVolatile` + select_tree/tree_picker 双侧 strip；`a1e00c22`+`1ced5870` 推送 `buildBusinessObjectName` 门控清洗 + JSDoc
- 验收：`characterize-tree-node-text` / `characterize-tree-text-export` / `characterize-replay-click-fuzzy-nav` OK；Tasks 1–4 子审均 Approved；Task 5 真机湿测 deferred（Playwright 仅 about:blank），冷 fixture 覆盖 Spec §5
- 遗留移交：有登录态产品树页时做一次最小 evaluate 湿测（勿整包注入 helpers）；不 migrate 历史 DB；不维护 CHANGELOG

## 2026-09-16 17:45 · Cursor — 收工：atomize XML 合同 + missing_depend_fields 硬拒（回链 17:29 开工）

- 完成：`d390a3ad` 线上 atomize prompt 改为 XML 分区（`<role>` / `<output_contract>` / `<split_rules>` / `<examples>` 含 3 good + 4 bad / `<anti_patterns>` / `<checklist>`）；样例对齐；物化后空 `produces` 硬拒 `missing_depend_fields`；fallback 用标题合成 produce 键；`PROPOSE_CACHE_VERSION` 3→4
- 验收：`characterize-atom-depend` all passed（16 pins，含 propose 空字段硬拒 + XML few-shot pin）；`characterize-req-draft-traj` **OK 63**；`characterize-persist-boundary` all passed（11）；eslint 改动文件 0 error
- 遗留移交：湿测须**重新 propose**（v3 缓存对 commit 已 STALE；仅重启控制面不够，prompt 只在下次 LLM propose 生效）。检查 product-mgmt：不再合写维护+排序、不再空 `produces`/`dataDependsOn`。不维护 CHANGELOG

## 2026-09-16 17:29 · Cursor — 开工：atomize XML 合同 + missing_depend_fields 硬拒

- 进行中：湿测 `/draft-traj/propose`（product-mgmt）仍把无关能力合写且 `produces`/`dataDependsOn` 为空仅软警告。改线上 atomize prompt 为 XML 分区；样例补正/反例；`missing_depend_fields` 升硬拒；`PROPOSE_CACHE_VERSION` 3→4
- 范围：`scripts/prompts/req-draft-traj-atomize-prompt.md`、`docs/superpowers/prompt-engineering/atom-depend-split-samples.md`、`src/services/req-draft-traj/atom-depend.js`、`src/services/req-draft-traj/propose.js`、`src/services/req-draft-traj/propose-cache.js`、characterization（atom-depend / req-draft-traj / persist-boundary 若受影响）、本协作日志；轻量同步 spec §5 软→硬
- 禁入区：产品树层/按钮文案黑名单硬闸；`product_library.json` / `prod_add_dlg` 拆卡；他线 tree-node-dirty-suffix（`src/cdp/locator-builders/text.js` / `page-locator-helpers.js`）、Type B form snapshot、`config/` WIP、SPA
- 方式：主会话 Inline TDD（先 RED pin 再最小实现）；分支 `cursor/atomize-xml-depend-hard-reject-897d` 从 `uara_V1.2` 起；PR 合入 `uara_V1.2`

## 2026-09-16 17:19 · OpenCode — 收工：Type B 容器解析失败致回放误报失败（回链 17:11 开工）

- 根因：多步回放中 `save_form_snapshot`（Type B 检查点）按 `dialog:<trigger>|unnamed` 找根，`JS_VERIFY_FORM_STRUCTURE.matchTitle` 的 unnamed 分支要求 `aria-label` 为空；但 Element UI 的 `.el-dialog` 恒有 `aria-label="dialog"`（`:aria-label="title || 'dialog'"`），而录制侧 `JS_IDENTIFY_CONTAINER` 判定 unnamed 只看 `.el-dialog__title` 文本为空 → 两侧语义不对称 → unnamed 容器永远 `container_not_found` → Node 按 unsafe 把该检查点计入 `failedStepIds`，用户看到「步骤都执行了却失败 1 条」
- 完成：`96869ade` 修 `matchTitle`——`.el-dialog` 的 unnamed 分支改用录制侧同源信号（`.el-dialog__title` 文本为空，覆盖默认无标题与 custom title slot 两种）；drawer 维持 `aria+header` 不变；新烟 `characterize-form-structure-container.mjs`（Playwright 8 例：untitled/titled/custom-slot/legacy/缺容器/drawer/main 作用域），入 verify-all
- 验收：新烟先 RED（`container_not_found`）后 GREEN 8/8；verify-all 复跑=既有 4 红（step-highlight/layer-tree/confirm-notification/network-capture，均他线数据/环境）不变，本线新烟绿；`characterize-container-naming` / `characterize-dialog-screenshot` / `characterize-form-snapshot-trigger` 等相邻烟全绿
- 遗留移交：生产须重启执行机进程生效；本次仅修容器解析（回放时容器确实存在却匹配失败），未改 Type B `container_not_found`→fail 的策略（设计定调 unsafe 不 mutate）；顺带清除 agent-log 他线遗留的合并冲突标记（保留双方条目）
- 注意：push 时遇 GitHub 不可达（TCP 443 连接失败），本条与代码提交待网络恢复后 pull+push；不维护 CHANGELOG

## 2026-09-16 17:12 · Cursor — 开工：产品树脏后缀 SDD Task 1–5

- 进行中：执行 `docs/superpowers/plans/2026-09-16-tree-node-dirty-suffix.md`（清洗函数 → 录制 → 回放 → 推送 → 湿测）
- 范围：`src/cdp/locator-builders/text.js`、`src/cdp/page-locator-helpers.js`（+ gen）、`scripts/manual_recorder/js_parts/b.py`、AI click/enrich、`src/services/transaction-export.js`、characterization cold pins、`scripts/refactor/verify-all.sh`、本协作日志
- 禁入区：SPA 仓；历史 DB migrate；他线 atomize/req-draft-traj / Type B form snapshot；不手改 `_locator_helpers_js.py`（走 gen）；`config/` WIP
- 方式：subagent-driven-development；子智能体不 commit，主会话验收后代提交 + push

## 2026-09-16 17:11 · OpenCode — 开工：Type B 表单结构检查点容器解析失败致回放误报失败

- 进行中：多步回放（含选中行）浏览器全执行，但汇总报「失败 1 条」——根因=回放的 `save_form_snapshot`（Type B）按 `dialog:<trigger>|unnamed` 找容器，`JS_VERIFY_FORM_STRUCTURE.matchTitle` 对 unnamed 哨兵要求 `aria-label` 为空，而 Element UI 的 `.el-dialog` 恒有 `aria-label="dialog"`（`title || 'dialog'`）→ 永远匹配不上 → `container_not_found` → Node 按 unsafe 记该步失败。修复=unnamed 分支把 Element UI 通用回退值 `dialog` 视为「无标签」（与录制侧只看 `.el-dialog__title` 文本对齐）
- 范围：`scripts/controller/actions/js_snippets/misc.py`（matchTitle）、新 characterization、`scripts/refactor/verify-all.sh`、本协作日志（顺带清除他线遗留的合并冲突标记）
- 禁入区：SPA 仓、`tmp/cmds`、`config/` WIP；他线 req-draft-traj / tree-node-dirty-suffix / select_option 字段解析；`page-locator-helpers.js` 及生成物
- 方式：主会话 Inline（先 RED pin 再最小实现）；Playwright 固定 fixture 验 `JS_VERIFY_FORM_STRUCTURE`；完成后跑 verify-all；分支 `uara_V1.2`

## 2026-09-16 17:05 · ZCode 引擎线 — 补记：select_option 字段解析错位修复**真机复验通过**（回链 10:28 开工 / 10:52 收工）

- 用户复验：重放原失败轨迹 **回放成功，无问题**——BUG 闭环。
- 结论：`b3339e2a`（tssc_multi_select findFieldItem 精确优先+唯一兜底+歧义报错）为有效修复；此前 10:52 收工条目登记的「19242 活页面单点验证」至此升级为**整链真机复验通过**。
- 本条为状态收口，无新代码改动。

## 2026-09-16 16:58 · Cursor — 收工：产品树脏后缀 design + plan（回链 16:50 开工）

- 完成：spec `2026-09-16-tree-node-dirty-suffix-design.md`（用户批准）；plan `2026-09-16-tree-node-dirty-suffix.md`（Tasks 1–5）
- 验收：用户确认「可以」；裁决写入 Global Constraints（保留 `[V-…]`，剥 `(N)`/拼接 `-`）
- 遗留移交：待选执行方式（subagent-driven-development / executing-plans）

## 2026-09-16 16:58 · Cursor — 收工：atomize 能力内聚（回链 16:50 开工）

- 完成：通用「能力内聚」写入线上 atomize prompt（一笔一项能力 / 准备步骤从属 / 禁止夹带另一项可独立验证能力）；样例正例定位→填→一次落库 + 反例「同页多能力合写」；spec §3.7 记为 prompt 层、无关键词硬闸
- 提交：`1aa133bf`（prompt + samples + spec）；开工声明 `82cfa41b`
- 验收：prompt 三条为通用中文，无上移/下移/维护基本信息/产品树层硬禁；未改 `src/services/req-draft-traj/**`，未 bump `PROPOSE_CACHE_VERSION`（仍为 3）；prompt/docs only，未跑 JS characterization / verify-all
- 遗留移交：湿测须**重新 propose**（缓存仍 v3 合法，新 prompt 只在下次 LLM propose 生效）；PR #39 场景硬拆路线放弃，由本 PR 取代
- 注意：不维护 CHANGELOG

## 2026-09-16 16:50 · Cursor — 开工：atomize 能力内聚（通用规则，非场景禁令）

- 进行中：在拆分边界下增加通用「能力内聚」；样例补正例（定位→填→一次落库）与反例「同页多能力合写」。不写上移/下移/产品树层/维护基本信息硬禁，不复活 PR #39
- 范围：`scripts/prompts/req-draft-traj-atomize-prompt.md`、`docs/superpowers/prompt-engineering/atom-depend-split-samples.md`、`docs/superpowers/specs/2026-09-15-atomic-draft-tx-split-boundary-design.md`（轻量补记）、本协作日志
- 禁入区：`src/services/req-draft-traj/**`（不新增关键词硬闸、不拆 flow-card JSON）；`product_library.json` / `prod_add_dlg`；他线 replay/field_slot；`config/` WIP；分支 `cursor/atomize-basic-info-quality-aae4`
- 方式：主会话 Inline；新分支 `cursor/atomize-capability-cohesion-4c8c` 从 `uara_V1.2` 起；PR 合入 `uara_V1.2`；PR #39 标为已被能力内聚取代

## 2026-09-16 16:50 · Cursor — 开工：产品树脏后缀 design spec

- 进行中：写入并提交 `docs/superpowers/specs/2026-09-16-tree-node-dirty-suffix-design.md`（用户裁决：剥 `(N)`/拼接 `-`，保留 `[V-…]`；DOM 优先取内层 span）
- 范围：该 spec + 本协作日志；暂不改代码
- 禁入区：`src/cdp/**` 实现、`stripVolatileTreeText` 行为变更（待 spec 批准后）、他线 search-then-click、`config/` WIP
- 方式：主会话 brainstorming → 用户审阅 spec 后再 writing-plans

## 2026-09-16 16:43 · OpenCode — 收工：回放 err-search-first 误拦截（回链 16:37 开工）

- 完成：根因（回放引擎绕过录制态 STC flag 标记 → 守卫误拦 → 语意路径退化）修复 `c820ac76`：新增 `mark_stc_flags_on_replay_ok`（fill→search_filled / 查询点击→query_clicked，候选含 params 与 element/attrs placeholder）；`replay_action_entries` 成功分支接线；`FillEngine`/`ClickEngine` 录制路径行为不变
- 验收：`characterize-search-then-click-guard` OK（先 RED import 失败、后 GREEN）；`characterize-search-then-click-prompts` OK；verify-all 其余烟均为已登记他线红（step-highlight/layer-tree/confirm-notification/network-capture 环境）——本线两烟绿；replay/heal 相关烟（heal-locate 39 / heal-decision 9 / replay-batch）复验全绿
- 遗留移交：本修复仅保证守卫提示真实，若查询后表格确实无该行，语义路径将报 `err-no-row-match`（比误报的 `err-search-first` 更可诊断）；生产须重启执行机进程生效；不维护 CHANGELOG

## 2026-09-16 16:37 · OpenCode — 开工：回放 err-search-first 误拦截（STC flags 回写共享 store）

- 进行中：多步一起回放时 `click_table_row_radio` 失败根因——回放循环成功分支从不把 search_then_click 的 STC flags 写入共享 `business_data_store`（`fill` 走新 `{}` store、`click_button('查询')` 走 classmethod 无 store）→ 语意路径被守卫误拦 `err-search-first`，回退 durable 又找不到行；修复=回放循环成功后标记 fill/查询 标记位
- 范围：`scripts/controller/actions/search_then_click_guard.py`（新 helper）、`scripts/controller/actions/_replay.py`(接线）、`scripts/characterization/cold/characterize-search-then-click-guard.py`（pin）、本协作日志
- 禁入区：SPA 仓、`tmp/cmds`、`config/` WIP；`scripts/cdp/page-locator-helpers.js` 及生成物；其他会话 field_slot/req-draft-traj/persist-boundary 热区
- 方式：主会话 Inline（先 RED pin 再最小实现）；完成后跑 verify-all 门禁；本分支 `uara_V1.2`

## 2026-09-16 16:25 · Cursor — 收工：product-mgmt wet propose 多【确定】误合并（回链 16:05 开工）

- 完成：`b8416216` RED pin；`bc9c1d82` persist 边界 + `multi_persist_task_draft` 闸；review follow-up：fallback 亦看 buttons、`countPersistConfirms` 不把裸「确定」当二次保存、`PROPOSE_CACHE_VERSION` 2→3
- 验收：`characterize-persist-boundary` all passed（11 pins）；`characterize-req-draft-traj` **OK 63**；`characterize-atom-depend` **8/8**；eslint 改动文件 0 error
- 遗留移交：不拆 `prod_add_dlg` 流程卡；`missing_depend_fields` 仍为警告；湿缓存须重新 propose（v3）；不维护 CHANGELOG

## 2026-09-16 16:05 · Cursor — 开工：product-mgmt wet propose 多【确定】误合并（persist boundary + taskDraft 闸）

- 进行中：TDD 修 confirmed 根因——`stepsShareClosedLoop`/`isPersistBoundaryAction` 只看 action 不看 buttons；`启用` 误匹配 `未启用`；flowGuided 下 `boundaries<=1` 放行多写合并；taskDraft 多【确定】无闸
- 范围：`src/services/req-draft-traj/flow-card-guide.js`、`src/services/req-draft-traj/propose.js`、`scripts/characterization/characterize-persist-boundary.mjs`（新）、`scripts/refactor/verify-all.sh`、本协作日志
- 禁入区：`product_library.json` / `prod_add_dlg` 拆卡；`missing_depend_fields` 升硬拒；runtime recording scheduler；他线 field_slot xpath；SPA；`tmp/cmds` / `config/` WIP
- 方式：主会话 Inline TDD（先 RED pin 再最小实现）；分支 `cursor/persist-boundary-confirm-8f78`；PR 合入 `uara_V1.2`

## 2026-09-16 15:05 · Cursor — 收工：field_slot 终审 Important 修复（回链 14:50 开工）

- 完成：`7ed9b6bd` persist AI/CDP `field_slot`/`display_label`；`ccdb68e1` offline input tight leaf；湿测 JSON `.superpowers/sdd/task-4-wet-result.json`；SPA `19130bf`/`041a1ef`（独立仓）
- 验收：characterize-form-field-intra-slot / capture-element-xpath / locator-candidates / locator-parity OK；终审 Ready to merge
- 遗留移交：Minors 不挡合并（occurrence=0 混排 leaf 近似、`_element_identity` 同 label coalesce、SPA 未 push）；不维护 CHANGELOG

## 2026-09-16 14:50 · Cursor — 开工：field_slot 终审 Important 修复（AI/CDP persist + offline leaf）

- 进行中：终审 Important#1（inspect / resolve-by-label / JS_CAPTURE_FROM_XPATH / `_capture_element` 透传 `field_slot`/`display_label`）+ Important#2（`controls.js` input 紧 leaf 对齐 live）
- 范围：`src/cdp/inspect-payload-script.js`、`src/cdp/resolve-by-label.js`、`src/cdp/locator-builders/controls.js`、`scripts/controller/actions/js_snippets/fill_core.py`、`scripts/controller/actions/_helpers.py`、characterization pin（若需）、本协作日志
- 禁入区：SPA 仓；他线 atom-depend / rect_norm；不手改 `_locator_helpers_js.py`（若改 helpers 源则走 gen）；`config/` WIP
- 方式：SDD 终审 fix 子代理；主会话验收后 commit + push

## 2026-09-16 12:32 · Cursor — 收工：Task 4 spec 交叉引用；原子拆分边界计划 T1–T4 完成（回链 12:31 开工）

- 完成：2026-09-07 §3 与 2026-09-09 单卡闭环交叉引用；2026-09-15 状态 → `已审阅；实现按 2026-09-16 plan（PR #37）`
- 验收：`characterize-atom-depend` **8/8 all passed**；`characterize-atom-keydata` **all passed**
- 计划：`2026-09-16-atomic-draft-tx-split-boundary.md` Task 1–4 均已落地（helper / propose 接线 / prompt+样例 / spec 交叉引用），PR #37
- 遗留移交：无本计划内项；不维护 CHANGELOG

## 2026-09-16 12:31 · Cursor — 开工：Task 4 spec 交叉引用 + 计划收口

- 进行中：执行 `docs/superpowers/plans/2026-09-16-atomic-draft-tx-split-boundary.md` **Task 4**（2026-09-07 §3 / 2026-09-09 单卡闭环交叉引用；2026-09-15 状态翻为已审阅/实现中；characterize 复核）
- 范围：`docs/superpowers/specs/2026-09-07-req-to-draft-traj-design.md`、`docs/superpowers/specs/2026-09-09-flow-card-guided-propose-design.md`、`docs/superpowers/specs/2026-09-15-atomic-draft-tx-split-boundary-design.md`、本协作日志
- 禁入区：`src/**`、atomize prompt、产品树强制拆、one-confirm-per-atom 硬闸、他线 field_slot xpath、`config/` WIP
- 方式：主会话；同一分支 `cursor/atom-depend-graph-b1f2` 更新 PR #37；本任务为计划末项

## 2026-09-16 12:29 · Cursor — 收工：Task 3 atomize prompt 拆分边界 + 样例（回链 12:28 开工）

- 完成：commit **`a334499a`** `docs(prompt): atomize split by produces/dataDependsOn bounds`
- 范围：`scripts/prompts/req-draft-traj-atomize-prompt.md`、`docs/superpowers/prompt-engineering/atom-depend-split-samples.md`
- 验收：JSON 例含 `produces`/`dataDependsOn`；「拆分边界」十条入 prompt；flowCards 改为参考且依赖规则优先；禁止 #504 造上游与场景清单；样例写明依赖图≠树层教条。原 prompt 无「产品树每层必拆」专项，无需删除。
- 遗留移交：Task 4 spec 交叉引用未做

## 2026-09-16 12:28 · Cursor — 开工：Task 3 atomize prompt 拆分边界 + 样例

- 进行中：执行 `docs/superpowers/plans/2026-09-16-atomic-draft-tx-split-boundary.md` **Task 3 only**（prompt 加 `produces`/`dataDependsOn` +「拆分边界」十条；样例抽象 #675/#676/#678 与 #504 反例）
- 范围：`scripts/prompts/req-draft-traj-atomize-prompt.md`、`docs/superpowers/prompt-engineering/atom-depend-split-samples.md`、本协作日志
- 禁入区：Task 4 spec 交叉引用；`propose.js` / `atom-depend.js`；产品树关键词强制拆；one-confirm-per-atom 硬闸；他线 field_slot xpath；白名单/发版 `tmp/cmds`；`config/` WIP
- 方式：主会话；同一分支 `cursor/atom-depend-graph-b1f2` 更新 PR #37

## 2026-09-16 12:30 · Cursor — 收工：Task 2 propose.js 接线 produces/dataDependsOn（回链 12:26 开工）

- 完成：commit **`fd18fc6a`** `feat(propose): attach produces/dataDependsOn and hard-gate depend graph`
- 范围：`src/services/req-draft-traj/propose.js`、`src/services/req-draft-traj/propose-cache.js`（cache 写入 `warnings`）、`scripts/characterization/characterize-atom-depend.mjs` 源码 pin
- 验收：characterize-atom-depend **8/8 ok / all passed**（pin 先 RED 缺 import，后 GREEN）；characterize-atom-keydata all passed；characterize-req-draft-traj **OK 63**（含 `multi_write_atom`）；eslint 三文件 0
- 遗留移交：Task 3–4（atomize prompt、samples、spec 交叉引用）未做

## 2026-09-16 12:26 · Cursor — 开工：Task 2 propose.js 接线 produces/dataDependsOn

- 进行中：执行 `docs/superpowers/plans/2026-09-16-atomic-draft-tx-split-boundary.md` **Task 2 only**（TDD：characterize 源码 pin → `propose.js` 接线 → cache/return `warnings`）
- 范围：`src/services/req-draft-traj/propose.js`、`src/services/req-draft-traj/propose-cache.js`（warnings 写入 cache 所需）、`scripts/characterization/characterize-atom-depend.mjs`、本协作日志
- 禁入区：atomize prompt / Task 3–4 / spec 交叉引用；产品树关键词强制拆；one-confirm-per-atom 硬闸；不改 `multi_write_atom` / flow-card 闭环；他线 field_slot xpath；白名单/发版 `tmp/cmds`；`config/` WIP
- 方式：主会话 Inline TDD；同一分支 `cursor/atom-depend-graph-b1f2` 更新 PR #37

## 2026-09-16 12:25 · Cursor — 收工：Task 1 atom-depend 图校验（回链 12:20 开工）

- 完成：commit **`4b782ff6`** `feat(req-draft-traj): validate atom produces/dataDependsOn graph`
- 范围：`src/services/req-draft-traj/atom-depend.js`、`scripts/characterization/characterize-atom-depend.mjs`、`scripts/refactor/verify-all.sh`（紧随 `characterize-atom-keydata`）
- 验收：characterize-atom-depend **7/7 ok / all passed**（先 RED `ERR_MODULE_NOT_FOUND`，后 GREEN）；硬拒 `self_produce_depend` / `dangling_data_depend`；警告 `missing_depend_fields`；被拒 atom 不贡献 produces
- 遗留移交：Task 2–4（`propose.js` 接线、atomize prompt、spec 交叉引用）未做，按计划下一切

## 2026-09-16 12:20 · Cursor — 开工：Task 1 atom-depend 图校验（纯 helper）

- 进行中：执行 `docs/superpowers/plans/2026-09-16-atomic-draft-tx-split-boundary.md` **Task 1 only**（TDD：characterize → `atom-depend.js` → 接入 verify-all）
- 范围：`scripts/characterization/characterize-atom-depend.mjs`、`src/services/req-draft-traj/atom-depend.js`、`scripts/refactor/verify-all.sh`、本协作日志
- 禁入区：`propose.js` / atomize prompt / Task 2–4；产品树关键词强制拆；one-confirm-per-atom 硬闸；他线 field_slot xpath（`src/cdp/page-locator-helpers.js` / locator-builders / `scripts/manual_recorder/**`）；白名单/发版 `tmp/cmds`；`config/` WIP
- 方式：主会话 Inline TDD；子智能体不 commit

> **归档指引**：2026-09-11（含）及更早条目已归档至 `archive/logs/agent-log-archive-2026-09-11.md`；更早批次见同目录 `agent-log-archive-2026-09-06.md` / `agent-log-archive-2026-09-05.md`。本文件只保留最近数日条目。

## 2026-09-16 14:xx · OpenCode — 收工：修复 tmp/cmds 后端发版 CMD 闪退（回链本次开工）

- 根因：CMD 的 Git Bash 缺失提示放在括号块内，文本中的未转义 `1)`/`2)` 会被 CMD 预解析为语法错误；即使当前 `D:\Software\Git\bin\bash.exe` 存在且路径已解析，脚本仍在上传前闪退。
- 完成：本机 `tmp/cmds/release-backend.cmd` 改为从 `git --exec-path` 推导非标准 Git for Windows 安装根目录，并用跳转式错误提示规避括号块预解析；启动时显示仓库根目录与实际 Bash 路径。
- 验收：真实 `release-backend.cmd check` 已通过 Git Bash 探测，打印 `D:\Software\Git\bin\bash.exe`，以 `20260916-140054` 成功完成打包并生成 `dist/JS-gen-control-plane-20260916-140054.tar.gz`（370 项）；`check` 模式按设计跳过 SCP/SSH，未改服务器。
- 使用：双击 `tmp/cmds/release-backend.cmd` 即执行完整发版；仅需本地验证时从 CMD 运行 `tmp\cmds\release-backend.cmd check`。本机忽略工具不入库；既有 `config/.db-whitelist-seen` 未触碰。

## 2026-09-16 11:xx · OpenCode — 开工：修复 tmp/cmds 后端发版 CMD 闪退

- 进行中：排查 `tmp/cmds/release-backend.cmd` 双击后窗口闪退且未上传部署的问题，复现 CMD 执行并修复新位置的启动/路径/依赖检测。
- 范围：仅本机忽略文件 `tmp/cmds/release-backend.cmd`、本协作日志；只读参考仓库根目录共享 `pack-control-plane.sh` 与 `release-backend-remote.sh`。
- 禁入区：共享发布 shell 脚本、`src/`、`config/`、`migrations/`、线上发布目录和其他会话 WIP；不执行真实上传、迁移、重启或回滚。
- 方式：以 CMD 包装运行捕获错误，验证根目录与 Git Bash 发现逻辑；修复后运行到安全的打包前确认边界，确保失败窗口保留并输出可诊断错误。

## 2026-09-16 14:21 · ZCode — 收工：推送坐标归一化修复三件套落地（回链 14:11 开工）

- 完成：**修复 1**（录制侧根治，`7f49d186`）state.py 加 `_CURRENT_PAGE_DIMS` 直通 + service.py wrapper 动作前注入 before_dims + `_stamp_rect_norm` 页面路径先读直通再回落注册表 + after-action 注册 meta 补 contentWidth/Height——三路径行为证明（直通/注册表/跳过）全过。**修复 2+3**（导出侧补救存量，`fba8084f`）截图条目带 `_shotW/_shotH`（page=meta contentWidth/Height、popup=meta 或 rect 宽高、旧链路弹窗=rect 宽高）+ properties 像素回退除以分母归一化（计 normalizedRects）+ 内部字段 dry-run/wire 双剥除 + 两 pin 期望更新
- 验收：**verify-all 基线 4 红→3 红**（export-v3 存量红真因=traj 33 已从库删除 rows=0，pin 加 SKIP 守卫转绿；余 3 红均他线数据漂移已登记）；**真数据审计**（`tmp/rect-audit-post.mjs`，30 条可推轨迹全量走路由等价数据流）：337 ele props 归一化 156 / 空 113 / **仍像素 68——全部落在 823/824/829/835 这批无任何 screenshot 行的轨迹**（legacy 兜底链无分母，按守卫设计保留像素，除法会造假数据）；828（有截图）实证 normalizedRects=4 全绿
- 事故与处置：中途 `git stash pop "stash@{1}"` 误弹他线 sovereignty WIP——**因冲突 pop 未消费、stash 条目保留无损**；已将误入工作区的 15 个他线文件精确还原 HEAD（内容仍在 stash@{0}，未丢未改），自己 7 文件按名弹回。教训再证：stash 必须带 message、pop 必须指名核对条目归属
- 遗留移交：68 步像素=「轨迹无截图行」历史数据（录于 page_level 事件链上线前），要归一化需重录或回填截图行——建议不做（像素语义正确）；**生产 4097 重启后生效**（录制侧+导出侧都要）；伙伴侧无需改（收到的坐标将统一为 0~1）
- 提交本文件顺带携带他线条目：无（14:30/14:33 归档条目为并行会话独立提交）

## 2026-09-16 14:33 · ZCode — 收工：同目录旧归档移除完成（回链 14:30 开工）

- 完成：`docs/superpowers/` 下 09-05/09-06 两份归档原件已 `git rm`，`archive/logs/` 副本入库——git 识别为 100% 纯改名（`3d89dc67`，零内容改动），历史保留；同目录现无散置归档文件，三批归档（05/06/11）全部集中于 `docs/superpowers/archive/logs/`
- 验收：删除前 blob 哈希比对原件=副本完全一致（2cb87df9 / 98ffbd59）；`git diff --cached -M` 2 renames 0 insertions/deletions；推送成功
- 遵守：系收口并行会话在途复制搬迁（commit message 已注明）；他线 WIP 零触碰
- 遗留：无

## 2026-09-16 14:30 · ZCode — 开工：移除 agent-log 同目录旧归档（09-05/09-06 → 收口进 archive/logs/）

- 进行中：2026-09-16 14:30；用户指令：移除与 agent-log.md 同目录（`docs/superpowers/`）的归档文件。现状=并行会话已复制 09-05/09-06 两份进 `archive/logs/`（blob 哈希与已提交原件一致，已核验），但原件仍在——本单元删除原件 git rm + 追踪 archive/logs/ 副本，完成整体搬迁
- 范围：`docs/superpowers/agent-log-archive-2026-09-05.md`（删）、`agent-log-archive-2026-09-06.md`（删）、`archive/logs/` 下两份副本（add 入库）、本文件
- 禁入区：他线 WIP（plans/2026-09-09-flow-card-guided-propose.md、reports/2026-09-10-benchmark-leaderboard-scan.md、src/ 等）；本文件他线在途条目原样保留
- 方式：开工/收工各一 commit + push；移动 commit 注明系收口并行会话在途搬迁

## 2026-09-16 14:22 · ZCode — 收工：agent-log 归档完成（回链 14:15 开工）

- 完成：归档 `archive/logs/agent-log-archive-2026-09-11.md`（09-11 及更早 272 条目，头部含批次指引）+ 主文件截留 09-12 起 103 条目 + 顶部归档指引行；commit **`caaa8346`** 已推送（开工 `28535be4`）
- 事件说明（并行会话请知悉）：14:16 我提交开工声明后、执行切分前，工作区 agent-log.md 被某并行会话写入**带 git 冲突标记的中间态**（裸 `=======`、合约主权 Task 1-7 块重复、2 条目被顶掉）；我的首次 sed 提取受其污染。已从干净基准 `28535be4` 确定性重建两个文件（脏提取物整份丢弃，未采用其任何内容），核验=条目守恒 103+272=375、日期分布边界正确（主 09-12~16 / 档 ≤09-11）、冲突标记 0、被顶掉的「15:25 开工 remove local BiB mount」「Subagent 收工 挂载功能列」两条已找回。**若他线仍持有该中间态未保存的编辑，请丢弃勿再写回**；如系他线有意合并结果，请以收工条目声明并基于 `caaa8346` 重做
- 核验：六项检查全绿（条目守恒/日期边界/标记清零/丢失找回/尾部一致/重复头唯一）；主文件 705 行、归档 1864 行
- 遗留：无（本任务单元）；归档区中部剔除了一处历史遗留重复文件头（`# Agent 协作日志`，09-10 条目区），内容零改动

## 2026-09-16 14:15 · ZCode — 开工：agent-log 归档（09-11 及更早 → archive/logs/）

- 进行中：2026-09-16 14:15；用户指令：5 天前（2026-09-11 及更早）条目归档至 `docs/superpowers/archive/logs/`
- 范围：本文件（顶部插入本条目 + 截留 09-12 起条目 + 归档指引行）、`docs/superpowers/archive/logs/agent-log-archive-2026-09-11.md`（新建）
- 禁入区：他线工作区 WIP（`src/services/partner-platform.js`、`transaction-export-v3-*.js`、`plans/2026-09-09-flow-card-guided-propose.md`、`reports/2026-09-10-benchmark-leaderboard-scan.md`、`scripts/maintenance/prune-same-xpath-menu-twins.mjs`、`.cursor/`、`config/`）；本文件他线在途条目原样保留不删
- 方式：按既有归档规范（archive-09-06 头部格式）原样分流不改写；开工/收工各一 commit + push

## 2026-09-16 14:11 · ZCode — 开工：推送坐标归一化修复（录制侧直通尺寸 + 导出侧双兜底）

- 进行中：14:11；承接 14:00 排查条目，用户批准三处修复。修复 1（录制侧）：state.py 加 `_CURRENT_PAGE_DIMS` 直通 + service.py wrapper 每动作前注入已采 before_dims + `_stamp_rect_norm` 页面路径先读直通再回落注册表 + after-action 注册 meta 补 contentWidth/Height；修复 2（导出侧）：弹窗像素回退减法后再除弹窗 rect 宽高（15 步存量立即转正）；修复 3（导出侧）：页面级像素回退从截图 metadataJson 收集 contentWidth/Height 作分母（46 步存量）
- 范围：`scripts/state.py`、`scripts/controller/service.py`、`src/services/transaction-export-v3-properties.js`、`src/services/transaction-export-v3.js`（如需传截图 meta）、`scripts/characterization/characterize-export-v3.mjs`（pin 期望同 commit 更新）、verify-all 注册行（如加门禁）、本文件、tmp/rect-*.mjs（审计脚本）
- 禁入区：Cursor 线热区（locator-candidates/parity/form-field-intra-slot 及其 fixture、`formFieldXpathSmartOf` 相关）、click 族（click_action_engine/_misc/replay_form_action）、`.cursor/`、`data/kb/**` 只读、他线 5 红（step-highlight/layer-tree/export-v3/confirm-notification/network-capture）不修——**但 characterize-export-v3 的 pin 期望更新属本修复必要配套，触碰时只在 rect 相关断言内动**
- 方式：三修复分 commit（录制侧一个、导出侧一个、pin/门禁一个）→ 每步 verify-all 比对基线红 → 重录小轨迹湿测 → 30 轨迹审计脚本复跑确认像素回退清零

## 2026-09-16 14:00 · ZCode — 排查：批量推送坐标非归一化（根因=录制侧 rect_norm 时序缺口，非历史遗留）

- 结论：**不是历史遗留数据**（最新 09-15 的 traj 835/829 同样命中），**也不是导出侧没用归一化算法**（30 条可推轨迹 224 步中 163 步 rect_norm 正常直出）。真因=录制侧 `_stamp_rect_norm`（state.py:293）依赖 `_PAGE_LEVEL_SHOTS` 注册表 meta 作分母，两条时序断点致跳过不写：**A**（主导）`register_page_screenshot_if_changed` 的 after-action 注册 meta 只有 phaseNumber/capturedAt **缺 contentWidth/Height**（state.py:510），页面首动作起整个 phase 内全部跳过，直到 phase-end `register_current_page_screenshot` 才补尺寸——traj 823 phase1 全 5 步 P、phase2 步 8 N 实证；**B**（弹窗）弹窗 shot 在动作后注册（service.py:138-147），弹窗内首动作查不到 → 跳过（traj 823 ph3 st9 / 835 st23131）
- 证据：`tmp/rect-audit2.mjs`（30 轨迹覆盖审计 163N/61P）、`tmp/rect-seq.mjs`（823 逐步 N/P 序列 vs 页面/弹窗/phase 时序）、offender 全有 page_bbox 排除 bbox 缺失
- 未修代码（用户未拍板）；修复方向：A=after-action meta 带 before_dims（service.py wrapper 已现成采集）+ 动作前 dims 直通兜底每页首步；B=弹窗首步留缺（导出侧像素回退+弹窗减法仍正确，仅格式非 0-1）
- 提交本文件顺带携带他线条目：无

## 2026-09-16 13:50 · Cursor — 收工：表单字段内同族控件 xpath 消歧（回链 12:15 开工）

- 完成：方案 A 落地。`formFieldXpathSmartOf` 改 class-token leaf + 同族 `(item//leaf)[n]`；snap 写 `field_slot`/`display_label`；人工/AI 透传；SPA `pickParamText` 拼 `保证金比例-A`。计划 `docs/superpowers/plans/2026-09-16-form-field-intra-slot-xpath.md`。
- 验收：`characterize-locator-candidates` / `characterize-locator-parity` / **`characterize-form-field-intra-slot` OK**（双 select/双 input 唯一 + 单字段无 slot）。SUT 浏览器会话已关，保证金比例真机湿测未复跑（离线 fixture 复现同构）。
- 遗留移交：前端仓 `ui-auto-recording-agent-vue-master/vue-project` 同步改了 trajectory-tree / step-detail / ElementJson（勿提交该仓 `vite.config.ts` WIP）；产品库页人工/AI 录一笔「保证金比例」确认列表标题与回放。

## 2026-09-16 11:xx · OpenCode — 开工：修复 tmp/cmds 后端发版 CMD 闪退

- 进行中：排查 `tmp/cmds/release-backend.cmd` 双击后窗口闪退且未上传部署的问题，复现 CMD 执行并修复新位置的启动/路径/依赖检测。
- 范围：仅本机忽略文件 `tmp/cmds/release-backend.cmd`、本协作日志；只读参考仓库根目录共享 `pack-control-plane.sh` 与 `release-backend-remote.sh`。
- 禁入区：共享发布 shell 脚本、`src/`、`config/`、`migrations/`、线上发布目录和其他会话 WIP；不执行真实上传、迁移、重启或回滚。
- 方式：以 CMD 包装运行捕获错误，验证根目录与 Git Bash 发现逻辑；修复后运行到安全的打包前确认边界，确保失败窗口保留并输出可诊断错误。

## 2026-09-16 · OpenCode — 收工：修复控制面重启后的录制推流会话恢复（回链本次开工）

- 完成：commit **5fd439fb**。控制面不再在启动后按 executor 节点暂时 offline 状态批量 crash `remote_session`；执行机注册后以 `session.list` 的 `agent_session_id` 为会话存活真源，只有权威查询缺失才 crash 并清交易所有权。
- 恢复：命中的 active/idle 行恢复 `liveByRemoteSessionId`；有交易归属的行恢复 control-plane session、trajectory runtime、手工录制持久化订阅和 slot lease；active 行幂等下发 `session.attach_bib`，由执行机重建 BiB 并回传 `session.bib_ready` 以恢复画面推流。
- 验收：`node --check`（`executor-node-service.js` / `executor-ws.js` / `server.mjs`）PASS；`characterize-executor-orphan-reconcile.mjs` PASS（新增 session.list/仅缺失才 crash/runtime+lease/BiB attach/禁启动批量 crash 断言）；`characterize-session-lifecycle.mjs` 与 `characterize-trajectory.mjs` PASS；`git diff --check` PASS；commit hook eslint 0 error。完整 `bash scripts/refactor/verify-all.sh` 未运行：本机没有 `bash`。独立 `npm run lint -- --no-warn-ignored` 0 error、154 条既有 `.venv`/存量 warning。
- 遗留移交：控制面重启期间正在运行的 AI run 仍无法安全续接其未持久化的 phase/run 上下文；本修复保留会话、恢复画面和手工录制持久化，不伪造 AI run 终局。需另立 AI run checkpoint/recovery 协议后才可支持 AI 录制无缝继续。
- 协作：本轮开工前 `git pull` 及两次 `git push` 均因 GitHub 连接重置/443 连接失败未成功；本地分支含声明 commit **0b0d0823** 与代码 commit **5fd439fb**，待网络恢复后推送。既有未跟踪 `config/.db-whitelist-seen` 未触碰。

## 2026-09-16 · OpenCode — 开工：修复控制面重启后的录制推流会话恢复

- 进行中：以执行机 `session.list` 为会话存活真源，修复控制面异常重启后 `remote_session` 的误 crash、BiB 绑定/推流重附、交易 runtime 和槽位租约恢复。
- 范围：`server.mjs`、`src/executor-ws.js`、`src/services/executor-node-service.js`、相关 characterization 与本协作日志；只读参考 remote-session/trajectory/executor 生命周期代码。
- 禁入区：前端仓、线上数据库/执行机运行态、既有未跟踪 `config/.db-whitelist-seen`、Cursor 的 field_slot 热区和其他会话 WIP；不回填历史交易数据。
- 方式：已先尝试 `git pull`（GitHub 连接重置失败）；执行机注册后先对账再决定 crash，命中会话重建控制面 routing/runtime/lease 并幂等发送 BiB attach；以离线 characterization、语法检查和核心门禁验证。

## 2026-09-16 · OpenCode — 收工：排查控制面异常关闭导致录制画面推流中断（回链本次开工）

- 完成：只读梳理 `trajectory.remote_session_id` → `remote_session` → `agent_session_id`/`executor_node_id` → 执行机 `BibBridge` → RSCF 推流链路；未修改业务代码、数据库或线上运行态。
- 结论：控制面重启会丢失 `state.sessions`、trajectory runtime、`liveByRemoteSessionId` 和控制面 WS 的帧缓存；执行机/Python/Chrome 可继续存活。注册重连时仅按 `remote_session.status=active` 恢复 BiB 绑定，未恢复控制面 session/runtime，也未主动重新发送 `session.attach_bib`；因此交易若仍为 `recording`，前端按 DB 的 `remote_session_id` 订阅却可能收不到新帧。更严重的是 `server.mjs` 延迟 15s 执行 `crashOccupiedOnOfflineNodes()`，执行机若超过窗口才重连会把仍存活的 active/idle row 标记 `crashed` 并清 `trajectory_id`，永久切断原交易身份。
- 关键证据：`schemas/init.sql:67-73,103-120` 定义状态与交易 FK；`server.mjs:185-227` 先等待重连窗口后批量 crash；`src/executor-ws.js:81-147` 仅恢复 active row 的 live binding并随后处理孤儿；`src/services/remote-session-state.js:304-318` 恢复还依赖 `row.status=active`；`src/services/executor-node-service.js:119-127,182-189` 断连 grace 到期会 crash 全节点会话；`executor/session-manager.js:346-391` 的 `bib_ready` 只在收到新的 `session.attach_bib` 时产生；`executor/ws-client.js:129-137` 重连只 flush 事件，不触发已存活会话的 BiB 重附。
- 次要风险：控制面收到执行机重连后，`handleRegister` 的恢复查询和 `reconcileOrphanSessions` 不是事务；`remote_session` 的多行/状态变化可能在两步之间漂移。`remoteSessionId` 与 `remoteSessionUuid` 是两层身份，单靠交易表数字 ID 无法在控制面内存清空后恢复执行机端 BiB 对象。
- 建议移交：①重连恢复应以 `remote_session` 为真源，保留 `active` 行并按 node+agent session 发起幂等 `session.attach_bib`，由 `bib_ready` 重建控制面 binding/runtime 或显式要求前端走 reattach；②将启动批量 crash 改为带执行机 `session.list` 的逐会话对账，确认 executor 不存在后再 crash，避免固定 15s 时间窗误杀；③控制面启动后为 `record_status=recording` 且 remote_session 仍 active 的交易补建 runtime/录制事件订阅，或将其明确标为 `degraded` 并提供按 `remote_session_id` 的恢复接口；④补充“控制面 kill → 执行机保持在线 → 重连在 15s 内/外 → 前端重新订阅”的真机验收。
- 验收：完成静态代码与历史提交审计；`git status` 仅保留既有 `config/.db-whitelist-seen` 未跟踪文件及本次日志提交；未执行线上连接。`git pull`/`git push` 均因 GitHub 连接被重置失败。
- 遗留移交：本轮没有实现修复；根因与修复边界已明确，下一任务应先确定“保留原 remote_session 并重附 BiB”还是“将 recording 置 degraded 后人工恢复”的产品语义。

## 2026-09-16 · OpenCode — 开工：排查控制面异常关闭导致录制画面推流中断

- 进行中：从交易关联的 `remote_session_id` 出发，排查数据库记录、控制面恢复/清理逻辑、执行机 WebSocket 与 BiB/画面推流生命周期；本轮先做只读根因分析，不直接修改业务代码。
- 范围：`src/` 控制面路由与 session/recording/stream 服务、`scripts/` 执行机生命周期与推流相关代码、数据库迁移/查询定义、相关文档与 characterization；本协作日志。
- 禁入区：前端仓、线上数据库/执行机运行态、既有未提交 `config/.db-whitelist-seen`、其他会话工作区 WIP；不改变任何线上交易或会话状态。
- 方式：先完成 `git pull` 尝试（因 GitHub 连接重置未成功），再以静态代码、迁移和测试证据追踪异常关闭后的 orphan session、重连和推流恢复路径，最后给出带文件/行号的根因与修复建议。
## 2026-09-16 12:15 · Cursor — 开工：表单字段内同族控件 xpath 消歧（field_slot）

- 进行中：真机调研「保证金比例」复合字段 → 方案 A 已定；写 design spec，待用户审阅后写 plan 再改代码。
- 范围：`src/cdp/page-locator-helpers.js`（及 `_gen_locator_helpers_py` 生成物）、`src/models/element.js`、`src/cdp/locator-builders/controls.js`（若需对齐）、`scripts/manual_recorder/**`、characterization、本仓 `docs/superpowers/specs|plans`、本协作日志；前端仓 `D:\dev\ui-auto-recording-agent-vue-master\vue-project`（`trajectory-tree.ts` / step 标题路径）。
- 禁入区：他线 WIP（白名单/发版 tmp/cmds、atomic-draft 计划线）；不改 `label_text` 语义；不回填历史轨迹；agent-log 他人条目只读。
- 方式：主线程；先 spec→plan→实现；验证=characterization + 本页湿测。

## 2026-09-16 · Zcode Lead — AI 录制管线讲解材料产出（培训交接用）
- 完成：`docs/superpowers/research/2026-09-16-ai-recording-pipeline-handover.md`——三路并行调研（Node 生命周期 / Python 引擎 / 数据落库）汇总成文，与回放材料（2026-09-01）配套；含 prepare 四阶段、phase 循环+假成功门闩、四 LLM 角色、cue 纠偏体系、一个点击的落库旅程、9 条易混淆点；全部带 file:line
- 声明：本轮只新增该 research 文档 + 本条目，未动任何代码

## 2026-09-16 · Grok Bot · 原子草稿拆分边界实现计划

- 计划：`docs/superpowers/plans/2026-09-16-atomic-draft-tx-split-boundary.md`
- Spec：`2026-09-15-atomic-draft-tx-split-boundary-design.md` 已审阅；待选执行方式

## 2026-09-16 11:xx · OpenCode — 收工：迁移本机数据库白名单同步工具至 tmp/cmds（回链本次开工）

- 完成：删除仓库共享 `config/update-db-whitelist.cmd` 与 `config/update-db-whitelist.ps1`；本机工具已迁至 gitignore 的 `tmp/cmds/`，两文件保持同目录调用关系。
- 兼容：PowerShell 引擎按自身新位置回溯仓库根目录，继续读取/写入 `config/.db-whitelist-seen` 和 `config/.db-whitelist-sync.log`；CMD 的双击循环和 `once` 单次同步参数不变。
- 验收：CMD、PS1、新位置回溯的仓库根目录及 `config/` 状态目录均存在；PowerShell AST 语法解析通过；同目录 PS1 引用和 `StateDir=config` 断言通过；`git diff --check` 通过。未执行 SSH、TCP 探测或服务器白名单变更。
- 遗留移交：从 `tmp/cmds/update-db-whitelist.cmd` 启动即可；未触碰既有 `config/.db-whitelist-seen` 运行状态。

## 2026-09-16 11:xx · OpenCode — 开工：迁移本机数据库白名单同步工具至 tmp/cmds

- 进行中：迁移 `config/update-db-whitelist.cmd` 及其同目录本机 PowerShell 引擎 `update-db-whitelist.ps1` 至 `tmp/cmds/`，保持双击循环同步与 `once` 单次同步用法。
- 范围：`config/update-db-whitelist.cmd`→`tmp/cmds/update-db-whitelist.cmd`、`config/update-db-whitelist.ps1`→`tmp/cmds/update-db-whitelist.ps1`、本协作日志；运行时状态/日志仍留在忽略的 `config/.db-whitelist-*`。
- 禁入区：`src/`、`migrations/`、其余 `config/` 文件、线上 iptables/数据库、既有 `config/.db-whitelist-seen` 运行状态和其他会话 WIP。
- 方式：CMD 保持与 PS1 同目录；PS1 从自身位置回溯仓库根目录，再将 state/log 写入 `config/`；仅做本地路径与 PowerShell 语法验证，不连接服务器或更改白名单。

## 2026-09-16 11:xx · OpenCode — 收工：迁移本机后端发版 CMD 至 tmp/cmds（回链本次开工）

- 完成：删除仓库根目录 `release-backend.cmd`；本机发版命令迁至被 gitignore 的 `tmp/cmds/release-backend.cmd`，不保留根目录兼容入口。
- 保留：`pack-control-plane.sh`（README 公开的 Git Bash 打包入口）和 `release-backend-remote.sh`（上传后在服务器运行的部署逻辑）继续置于仓库根目录，供共用发布流程调用。
- 兼容：新 CMD 由自身位置回溯到仓库根目录，并以绝对路径调用上述共享脚本；远端上传名固定为 `release-backend-remote.sh`，与服务器清理和 SSH 执行路径一致。
- 验收：新 CMD 路径解析为仓库根目录且两个共享脚本均存在；实际运行到 Git Bash 前置检测（本机未安装 Git Bash，按原有保护逻辑在上传前退出，未连接服务器）；`git diff --check` 通过。
- 遗留移交：本机安装 Git Bash 后可从 `tmp/cmds/release-backend.cmd` 双击直接发版；未触碰 `config/.db-whitelist-seen` 和其他忽略的本地运行文件。

## 2026-09-16 11:xx · OpenCode — 开工：迁移本机后端发版 CMD 至 tmp/cmds

- 进行中：将仅供本机 Windows 双击发版的 `release-backend.cmd` 移到 `tmp/cmds/`，并使其按自身位置回溯仓库根目录后继续调用共用的打包与远端部署脚本。
- 范围：`release-backend.cmd`→`tmp/cmds/release-backend.cmd`、本协作日志；`pack-control-plane.sh` 与 `release-backend-remote.sh` 保留根目录，因 README/非 Windows 发版流程可直接共用。
- 禁入区：`src/`、`config/`、`migrations/`、`scripts/`、线上服务器、`config/.db-whitelist-seen` 未跟踪运行文件及其他会话 WIP。
- 方式：移动后由 CMD 先解析仓库根目录，再以绝对路径定位 Bash 打包脚本和远端 shell 脚本；验证路径解析、打包命令和 Shell 语法，不执行上传或服务器重启。

## 2026-09-16 11:xx · OpenCode — 收工：修复后端一键发布脚本跨秒误拒绝（回链本次开工）

- 完成：commit **ebd26411**；`release-backend.cmd` 将启动时生成的发布时间戳传给 `pack-control-plane.sh`，从而使压缩包名与上传前的同一时间戳校验一致，跨秒打包不再误报 stale pack。
- 兼容：`pack-control-plane.sh` 保留无参行为，供同事直接执行时仍自行按当前时间命名；发布远端协议、包内容、SSH/SCP 和重启逻辑均未修改。
- 验收：Git Bash `bash -n pack-control-plane.sh` 通过；固定时间戳 `20991231-235959` 打包、产物存在和 `tar -tzf` 校验通过；无参打包与产物完整性校验通过；`git diff --check` 通过。
- 遗留移交：无；本次未连接或变更线上服务器，首次点击发布可直接按现有流程执行。

## 2026-09-16 10:55 · ZCode — 开工：协作协议补条（push 冲突处理规则）

- 用户指令：push 遇到冲突时须处理冲突、合并后再 push。补进 AGENTS.md「跨 Agent 协作」区段
- 范围：仅 `AGENTS.md`（协作区段）+ 本日志条目；仓库外记忆文件同步
- 禁入区：其余文件不动；agent-log 他人条目只读
- 方式：主线程；纯文档改动。现场注记：pull 时 SSH 22 端口间歇被 reset，改走 ssh.github.com:443 通道完成（认证正常）

## 2026-09-16 11:xx · OpenCode — 开工：修复后端一键发布脚本跨秒误拒绝

- 进行中：修复 `release-backend.cmd` 先生成秒级时间戳、`pack-control-plane.sh` 稍后重新取时间导致跨秒时成功打包仍被拒绝上传的问题。
- 范围：`release-backend.cmd`、`pack-control-plane.sh`、本协作日志；保持双击发布、无参独立打包及远端部署协议兼容。
- 禁入区：`src/`、`config/`、`migrations/`、`scripts/`、线上服务器及其他会话工作区 WIP。
- 方式：CMD 将已生成时间戳显式传给打包脚本；Bash 脚本可选接收该时间戳，无参调用仍自行生成；本地验证产物命名、Shell/批处理语法与差异。

## 2026-09-16 10:52 · ZCode — 开工：协作协议再升级固化（开工前 pull / log 条目 commit+push）

- 用户指令：开工声明之前先 `git pull`；写完 agent log 后一律 commit 并 push（原约定只 commit）。今日将其固化进 AGENTS.md「跨 Agent 协作」区段
- 范围：仅 `AGENTS.md`（协作区段）+ 本日志条目；仓库外记忆文件同步
- 禁入区：其余文件不动；agent-log 他人条目只读
- 方式：主线程；纯文档改动，pull 已先行完成

## 2026-09-16 10:52 · ZCode 引擎线 — 收工：select_option 字段解析错位修复湿测 PASS（回链 10:28 开工）

- 完成：commit **b3339e2a**（4 文件 +105/-8）：tssc_multi_select 字段查找改 findFieldItem（精确优先→包含唯一兜底→多命中 ambiguous-label）、prompts 同步歧义错误码、新增 characterize-tssc-field-resolution.py 入 verify-all。
- 验收（19242 活页面，选择要素弹窗）：修复版 finder 逐 label 实测——要素名称→DOM9 本体✓（修复前命中组件要素名称 DOM7）、要素编码→DOM10✓（修复前命中组件要素编码 DOM6）、所属列表要素编码→DOM11✓、组件要素编码→DOM6✓（精确查自身名仍正常）；模糊「要素」→正确返回 6 候选歧义。离线=py_compile+SYNTAX+新 pin+finder 假 DOM 单测（精确优先/唯一包含/歧义）+verify-all 基线 4 红零新增。
- 遗留移交：①**同族 finder 排查**——`l === label || l.includes(label)` 模式还在 select_tree.py 等处、`_resolve_control`（Python 侧）同形风险，建议单独一批改精确优先（本次按批准范围只治 tssc 病灶）；②所属列表要素编码 下拉「暂无数据」是 SUT 侧级联/数据现状（真无数据，非引擎 bug），该新增可选字段在自愈里「填不了即跳过」的策略改进仍待裁决（见 09-16 早前分析）。

## 2026-09-16 10:28 · ZCode 引擎线 — 开工：select_option 字段解析错位修复（要素名称→组件要素名称，includes 包含匹配错位）

- 现场实证（19242 活页面 + 引擎原版匹配逻辑）：选择要素弹窗 DOM 序含「组件要素编码(6)/组件要素名称(7)」前缀查询字段，`l === label || l.includes(label)` 首个命中被它们抢占——找「要素名称」命中「组件要素名称」、找「要素编码」命中「组件要素编码」（均为错字段）。回放 err-no-options 是对错字段弹层（所属列表要素编码，暂无数据）做出的误判。
- 范围：仅 `scripts/controller/actions/js_snippets/tssc_multi_select.py` 字段查找两处（L27-29 主循环、L35-37 dialog 兜底）改「精确优先 → 包含唯一才用 → 多命中报 ambiguous-label」；同族 finder（select_tree.py、_resolve_control 等）本次不动、只列清单
- 禁入区：`config/`、他线 WIP、agent-log 他人条目只读
- 方式：主线程；验证=py_compile+模块级 import+新行为 pin（source 钉精确优先/唯一/歧义）+相关旧 pin+verify-all 对照基线 4 红+19242 活页面用更新后 snippet 实测解析落点

## 2026-09-16 · Grok Bot · 原子草稿拆分边界设计 spec

- 方案 B：`produces` / `dataDependsOn`；对照 #675/#676/#678/#504
- 路径：`docs/superpowers/specs/2026-09-15-atomic-draft-tx-split-boundary-design.md`
- 待用户审阅 spec 后再写实现计划

## 2026-09-15 22:40 · OpenCode — 收工：统一 AI click_element/click_button 同按钮去重（回链 22:25 开工）

- 完成：提交 **23f58d0d**；`click_element_by_index` 与 `click_button` 共用阶段级按钮 identity，优先使用点击前解析出的稳定 xpath，缺少 xpath 时才使用按钮文本兜底；同阶段第二次命中返回 `already-operated-this-phase`，不再执行浏览器点击或写入第二条步骤。
- 保留：人工录制 mapper/CDP 行为未修改；`click_save` 未改；表格 radio 仍走 `click_table_row_radio`；日期面板日格点击仍允许重复（同日区间需要两次点击）。
- 验收：`characterize-ai-phase-element-guard.py`、picker 原子录制、manual table radio、tree picker、date range、click replay engine、Python 编译、`git diff --check` 全通过。
- 遗留移交：部署/重启执行机后复测“客户名称引入”阶段，确认先后调用 `click_element_by_index(40)` 与 `click_button("选择客户")` 时只保留一条按钮步骤；`memory_writer` timeout 仍为独立基础设施告警。

## 2026-09-15 22:25 · OpenCode — 开工：统一 AI click_element/click_button 同按钮去重

- 进行中：修复同一 AI 阶段内同一按钮先后被 `click_element_by_index` 与 `click_button` 各录制一条的问题；共享稳定元素身份，第二次调用不再执行/落库。
- 范围：`scripts/controller/actions/click_action_engine.py`、`scripts/controller/actions/phase/element_guard.py`、相关 characterization、本协作日志；只读参考 `scripts/state.py` 的动作落库 coalesce 与现有 picker/date 点击例外。
- 禁入区：人工录制 mapper/CDP 采集、前端仓、`src/services/trajectory/trajectory-meta-service.js`、线上数据及其他会话 WIP；不改变 `click_save`、表格 radio、日期面板重复选日语义。
- 方式：先在当前无未提交改动状态写入并提交声明，再补 click_button 与 click_element 的跨动作 identity 共享，验证 picker/按钮/日期相关 characterization、编译与 diff 后提交。

## 2026-09-15 22:15 · OpenCode — 收工：修复第四阶段重复执行与日期范围异常（回链 21:55 开工）

- 完成：提交 **022f65a2**；“填写查询/筛选条件”规则回退归类为 query，运行时 query toolbar 可纠偏误判的 create/modify pending/success 门禁；AI 同阶段成功字段写入/选择及普通索引点击再次命中时直接返回 `already-operated-this-phase`，失败动作可重试、日期面板日格点击豁免、新阶段自动清空，人工录制不经过该保护。
- 日期修复：日期范围字段必须一次传入完整起止值；label 与 xpath 填充路径均对两个 input 写值并向 Vue model 提交数组，单日期写入范围控件返回 `err-date-range-value-required`，不再产生字符串 model 后继续查询。
- 验收：新增 `characterize-ai-phase-element-guard.py` 并注册 verify-all；日期范围、phase intent/boundary/runtime/reviewer、form assistant、xpath fill/select、picker 原子录制、table radio、tree picker、action-log sync 等 13 项定向 characterization、Python 编译、`git diff --check` 全通过；`npm run lint` 0 error（154 warning 均为 `.venv`/既有文件）。完整 `verify-all.sh` 因本机无 `bash` 未能启动。
- 遗留移交：部署/重启执行机后用同一五阶段场景湿测；第四阶段预期首次 `done(success=true)` 直接结束，不再重填或提前点击第五阶段【查询】；日期步骤应落库完整 `开始日期 - 结束日期`。`memory_writer` timeout 属独立基础设施告警，未修改。

## 2026-09-15 21:55 · OpenCode — 开工：修复第四阶段重复执行与日期范围异常

- 进行中：修复查询条件填写阶段被误套维护表单完成门禁，导致 `done()` 被 pending fields 拒绝、同阶段字段重复执行并越界点击下一阶段【查询】；同时修复 AI 通过 `fill_form_field` 写日期范围时退化为单日期字符串的问题。
- 范围：`scripts/agent/recorder_emitters.py`、`scripts/controller/actions/phase/intent_gates.py`、AI 控制器动作分发/去重辅助、`scripts/controller/actions/js_snippets/fill_core.py`、`fill_date.py`、对应 characterization、本协作日志；不修改人工录制 mapper/CDP 采集语义和线上轨迹数据。
- 禁入区：前端仓、`src/services/trajectory/trajectory-meta-service.js`、其他会话 WIP；不改变日期范围录制产物格式，沿用完整起止日期契约。
- 方式：以 sid `58d8036c` 第四阶段日志为表征，先修运行时 query UI 完成门禁，再补日期范围单值拒绝/区间提交，最后仅在 AI 动作执行入口阻止同阶段同元素成功写操作重复执行；运行定向 characterization、Python 编译和综合门禁后提交。

## 2026-09-15 · OpenCode — 收工：恢复 picker 表格选行录制语义（回链本次开工条目）

- 完成：AI `click_element_by_index` 在点击前识别位于 el-table 行内的 radio/checkbox，提取行文本并记录为 `click_table_row_radio`，不再退化为普通点击；已完成的搜索输入、查询点击、确认点击原子记录逻辑未修改。
- 验收：`characterize-manual-table-radio.py`、`characterize-picker-atomic-recording.py`、`characterize-manual-dialog-scope.py`、`characterize-manual-radio-fill.py`、Python 编译和 `git diff --check` 通过。
- 遗留移交：需真实执行机湿测不同表格（普通 radio、fixed column、checkbox）确认行文本提取和回放语义；未触碰直属 Python 中文注释任务的工作区 WIP。

## 2026-09-15 · OpenCode — 开工：恢复 picker 表格选行录制语义

- 进行中：修复选择器表格 radio/选行被映射成普通 `click_element_by_index` 的回退问题；保持已完成的搜索输入、查询点击、确认点击原子步骤不变。
- 范围：`scripts/manual_recorder/mapper.py`、必要的手工录制 characterization、本协作日志；只读参考 `scripts/manual_recorder/js_parts/` 与 `scripts/controller/actions/js_snippets/picker_confirm.py`。
- 禁入区：直属 Python 注释任务当前未提交文件、`src/services/trajectory/trajectory-meta-service.js`、前端仓、`config/`、线上数据；不修改搜索/确认拆分实现。
- 方式：先定位 DOM payload 到 action 的优先级回退，再以最小 mapper 修复恢复 `click_table_row_radio`，补离线 pin，运行定向 characterization、Python 编译和 `git diff --check` 后提交。

## 2026-09-15 · OpenCode — 开工：scripts 直属 Python 文件添加中文注释

- 进行中：为 `scripts/` 下直属 Python 文件（非子目录）添加中文注释，包括模块级总体注释和每个函数/方法的注释，方便开发人员 review。
- 范围：`scripts/__init__.py`、`scripts/trajectory_store.py`、`scripts/state.py`、`scripts/session_runner.py`、`scripts/run_traj56_cdp_replay.py`、`scripts/recorder.py`、`scripts/dev-cdp-browser.py`、`scripts/context_compiler.py`、`scripts/main.py`、`scripts/feature_flags.py`、`scripts/event_dispatch.py`、`scripts/cdp_ports.py`、`scripts/browser-use-agent.py`、`scripts/agent_utils.py`。
- 禁入区：不修改任何代码逻辑，只添加/替换注释；不涉及子目录文件；不涉及其他会话 WIP。
- 方式：逐文件编辑，替换英文模块 docstring 为中文，为每个函数添加中文 docstring；编辑完成后运行 Python 编译检查语法正确性。

## 2026-09-15 · OpenCode — 收工：scripts 直属 Python 文件添加中文注释（回链本次开工条目）

- 完成：14 个 Python 文件全部添加中文注释（模块 docstring + 函数/方法 docstring），保留原有英文注释；所有文件 Python 编译通过。
- 验收：`python -m py_compile scripts/*.py` 全部通过，无语法错误。
- 遗留移交：无。

## 2026-09-15 · OpenCode — 收工续：修正 picker 提示为按实际动作拆分

- 完成：移除普通 picker 固定“四步”要求，改为按具体场景实际发生的有效 DOM 操作逐步执行和记录；允许搜索、查询、选行、确认等动作按场景增减，禁止为凑步骤补操作；日期/下拉/树形搜索等明确专用控件继续允许组合封装。
- 验收：`characterize-picker-atomic-recording.py`、Python 编译、`git diff --check` 通过。提交包含提示词与 characterization 修正。
- 遗留移交：真实湿测时以 SUT 实际操作序列为准核对录制步骤，不以固定步骤数量作为验收条件。

## 2026-09-15 · OpenCode — 开工续：修正 picker 提示为按实际动作拆分

- 进行中：撤销普通 picker 固定“四步”表述，改为要求按具体场景真实发生的有效操作逐步记录；仅明确需要原子化的日期、下拉、树形搜索等控件继续使用组合动作。
- 范围：`scripts/prompts/agent-tools-common.md`、`scripts/prompts/agent-tools-form.md`、相关 characterization、本协作日志；不改变已完成的原子步骤采集实现和历史组合动作兼容。
- 禁入区：`src/services/trajectory/trajectory-meta-service.js`、前端仓、`config/`、线上数据、其他会话 WIP；保留日志中他会话未提交修改。
- 方式：最小修改提示词和契约断言，运行定向 characterization、编译与 diff 检查后提交。

## 2026-09-15 · OpenCode — 收工：修复 AI 录制选择客户弹窗步骤缺失（回链本次开工条目）

- 完成：提交待写入；`picker_dialog_query` 返回并落库查询字段 `fill_form_field` 与查询按钮原子步骤，`picker_dialog_select` 返回并落库选行 `click_table_row_radio` 与确认按钮原子步骤；保留旧返回格式下的组合动作兜底，阶段完成证据与回放协议不变。
- 验收：`characterize-picker-atomic-recording.py`、`characterize-introduce-dialog-close.py`、`characterize-phase-boundary.py`、`characterize-select-option-stamp.py`、`characterize-tree-picker-click.py`、`characterize-action-log-sync-delta.py` 均通过；Python 编译、Node 语法检查、`git diff --check` 通过。完整 `verify-all.sh` 因环境无 `bash` 未执行。
- 遗留移交：需部署 control plane/executor，在真实选择客户流程确认步骤列表出现“查询字段填充、查询、选中客户、确认”四类原子动作，并用原子步骤回放验证；组合 picker 工具仍可作为 AI 执行内部实现。

## 2026-09-15 · OpenCode — 开工：修复 AI 录制选择客户弹窗步骤缺失

- 进行中：分析并修复选择客户弹窗内搜索输入、目标选择、确认按钮在 AI 录制步骤中丢失，但回放依赖隐式组合动作仍可成功的问题。
- 范围：`src/cdp/` 录制事件/动作采集链、`src/services/trajectory/` 录制步骤落库链、`scripts/controller/` 执行机录制动作与相关 characterization、本协作日志；仅在证据确认需要时扩展到对应 API 契约。
- 禁入区：`src/services/trajectory/trajectory-meta-service.js` 用户改动、前端仓及 `config/`、线上轨迹与 SUT 数据、其他会话已声明工作区；不改变回放动作协议或无关录制基础设施。
- 方式：先以现有 characterization 和代码路径定位“动作未采集”与“组合动作隐式完成”的边界，再补录制证据/步骤持久化的最小修复，运行定向 characterization、语法检查、`git diff --check` 与必要综合门禁后提交。

## 2026-09-15 · OpenCode — 收工续：普通 picker 改为独立动作链（回链本次开工条目）

- 完成：普通选择器流程提示词改为 `fill_form_field` → `click_button("查询")` → `click_table_row_radio` → `click_button("确认")`；`picker_dialog_query` / `picker_dialog_select` 标记为 legacy specialized，仅供明确特殊组合场景和历史轨迹兼容。前序组合工具原子步骤落库修复一并保留。
- 验收：`characterize-picker-atomic-recording.py`、`characterize-introduce-dialog-close.py`、`characterize-phase-boundary.py` 均通过；Python 编译和 `git diff --check` 通过。完整 `verify-all.sh` 仍因当前环境没有 `bash` 未执行。
- 遗留移交：部署重启 control plane/executor 后，用真实“客户名称 → 选择客户”流程确认四个独立步骤均落库并按步骤回放；日期/下拉/树形等专用组合动作保持原路径。

## 2026-09-15 · OpenCode — 收工：修复关闭浏览器后重新准备无法恢复推流（回链本次开工条目）

- 完成：前端仓提交 **57bea6d**、**099f918**；prepare 完成和 `preparing` 收尾均能确定性触发 `ensureStream`，重新 prepare 前清除旧 `userDetached` 门闩；按 `sessionId` 忽略同轨迹旧会话延迟状态和 `recording:detached`，避免旧事件把新会话重置为“浏览器已关闭”。
- 验收：前端 `npx vue-tsc --noEmit` 通过；`git diff --check` 通过；主仓相关 JS `node --check` 通过；前端既有 `vite.config.ts`（localhost 配置）未纳入提交；主仓声明提交 **2ff33e30**。
- 遗留移交：需部署前端并重启/部署已提交的主仓 73b72e02 后，用轨迹 834 或新轨迹实测关闭浏览器→重新准备；观察 `/ws`、`attach-live`、RSCF 首帧及请求频率。当前无法连接线上执行机，未完成湿测。

## 2026-09-15 · OpenCode — 开工：修复录制界面关闭浏览器后重新准备无法恢复推流

- 进行中：处理轨迹 834 在关闭浏览器后重新准备时，前端持续显示“浏览器已关闭/正在附着”并重复轮询的问题；确保 prepare 完成后必定触发一次附着，并隔离旧会话的异步状态。
- 范围：前端仓 `src/views/ui-recording/detail/components/RemoteBrowser.vue`、`src/composables/useRemoteCanvas.ts`；主仓仅更新本协作日志；不修改 `vite.config.ts` 既有 WIP、线上数据及其他会话文件。
- 方式：先补充 prepare 完成触发附着与 session/trajectory 路由校验，再运行前端 TypeScript 检查、diff 检查并提交。

## 2026-09-15 · OpenCode — 收工：修复 AI 录制推流重连风暴（回链本次开工条目）

- 完成：前端仓提交 **2d385f2**；修复 `ensureStream` 每次入口重置自动重连计数的问题，重连失败恢复指数退避；当 `live/status` 已返回 `attached:true` 时只重建 WS 订阅/推流，不重复调用 `attach-live`，避免轨迹 835 类型的请求风暴和状态来回跳转。
- 验收：前端相关文件 `vue-tsc --noEmit` 错误筛选无新增错误，`git diff --check` 通过；前端既有 `vite.config.ts` 未触碰。主仓本任务未修改业务代码。
- 遗留移交：需部署前端后观察相同轨迹，预期 `live/status` 不再每秒循环、`attach-live` 仅在后端明确未附着时调用；若仍无首帧，需提供 `/ws` 的 `remote:status`、RSCF 帧序号和后端 `[remote-bridge] viewer notification failed` 日志。

## 2026-09-15 · OpenCode — 开工：修复 AI 录制推流重连风暴

- 进行中：修复前端自动重连计数被每次 `ensureStream` 清零、导致持续高频请求 `live/status` 与 `attach-live`，并完善 BiB 重挂载冷却及新帧状态判断。
- 范围：前端仓 `src/composables/useRemoteCanvas.ts`、必要的远程状态类型；主仓仅更新本协作日志，参考上一轮 BiB 修复但不改其他后端业务文件。
- 禁入区：前端仓 `vite.config.ts` 既有未提交改动及无关文件；主仓 `src/services/trajectory/trajectory-meta-service.js` 用户改动、线上轨迹/数据库及其他会话 WIP；不修改部署配置。
- 方式：以轨迹 835 的请求频率和状态跳转为表征，最小化修复自动重连状态机，运行前端定向类型检查/构建并提交。

## 2026-09-15 · OpenCode — 收工：AI 录制推流可靠性前四项优化（回链本次开工条目）

- 完成：主仓提交 **73b72e02**；修正 `notifyStreamViewers` DAO 导入并保留错误日志；prepare 对已有 `bibError` 允许重试；已有 runtime 且 BiB 未附着时 `/trajectories/:id/attach` 重新挂载 BiB。前端仓提交 **63d6a53**；RSCF 订阅记录缓存帧基线，仅收到新的帧序号后才将画布判为 streaming，8 秒无新帧则进入现有自动重连，并补充 `cachedFrameId` 类型。
- 验收：主仓 `node --check` 4 个相关 JS、定向 ESLint、`git diff --check` 通过；前端针对本次文件的 `vue-tsc` 错误筛选无新增错误。前端完整 `npm run build` 仍被仓库既有 `useRecordingStudio.ts`、系统字典、录制列表/草稿向导等类型错误阻断；未发现本次新增代码对应的构建错误。
- 遗留移交：需部署并重启 control plane/executor 与前端后，用新轨迹核对 `prepare`、`live/status`、`/executors`、`/active` 及 `/ws` 的 `remote:subscribe`/RSCF 首帧；前端仓工作区原有 `vite.config.ts` 未触碰未提交。

## 2026-09-15 · OpenCode — 开工：AI 录制推流可靠性前四项优化

- 进行中：修复 BiB 观看人数通知失败、BiB 首次失败后不重试、已有 runtime 的 attach 不重挂流，以及前端将 HTTP/attached/缓存帧误判为可用推流的问题。
- 范围：主仓 `src/cdp/remote-bridge/ws-router.js`、`src/services/trajectory/trajectory-attach-runner.js`、`src/services/trajectory/trajectory-attach-service.js`、相关 characterization 与本日志；前端仓 `D:\DevWorkspace\github\ui-auto-recording-agent-vue\vue-project\src\views\ui-recording\detail\components\RemoteBrowser.vue`、`src\composables\useRemoteCanvas.ts` 及相关类型/测试。
- 禁入区：主仓 `src/services/trajectory/trajectory-meta-service.js` 用户改动、线上轨迹/数据库、其他会话 WIP；前端仓 `vite.config.ts` 既有未提交改动及未明确相关文件；不修改部署配置和线上数据。
- 方式：先修复确定性路由/生命周期问题，再增加首帧新鲜度门控；运行主仓定向 characterization/语法检查与前端 `npm run build`，分别提交并回报部署复测要求。

## 2026-09-15 · OpenCode — 开工：AI 录制 fill_form_field 作用域异常修复

- 进行中：修复执行机 `fill_form_field` 因函数内条件 import 遮蔽模块级 `err_with`，导致 `UnboundLocalError`、AI 录制中断并将轨迹置为 `failed` 的问题。
- 范围：`scripts/controller/actions/fill_engine.py`、对应 characterization、本协作日志；只读参考远程 trajectory 829 的 control-plane/agent 日志。
- 禁入区：`src/services/trajectory/trajectory-meta-service.js`、线上轨迹/数据库、其他会话 WIP；不放宽失败轨迹的人工确认状态机。
- 方式：移除函数体内重复 import，补充静态/行为回归断言，运行定向 Python characterization、编译检查与 diff 检查后提交。

## 2026-09-15 15:00 · OpenCode — 开工：AI 录制阶段续跑与日期查询可靠性优化

- 进行中：修复阶段 `done()` 已接受后仍因后续阶段引入字段触发预算续跑；增强日期范围逗号格式、双端输入与回读；修复网络捕获异步响应头未 await 告警。
- 范围：`scripts/agent/service.py`、`scripts/controller/actions/network_capture.py`、`scripts/controller/actions/js_snippets/fill_date.py`、`fill_core.py`、日期字段回读相关 snippet、对应 characterization、`scripts/refactor/verify-all.sh`、本协作日志。
- 禁入区：线上轨迹与 SUT 数据、`src/services/trajectory/trajectory-meta-service.js`、CDP/手工录制日期范围已提交链及其他会话 WIP；不猜测或修改 SUT 接口契约。
- 方式：以用户执行日志为表征，先锁定 done 后不续跑，再统一范围值解析/双 input 写入及回读，最后异步化 network capture 过滤；运行定向 characterization、编译/语法检查、lint 与综合门禁后分步提交。

## 2026-09-15 · OpenCode — 收工：日期范围字段录制优化（回链本次开工条目）

- 完成：日期编辑器快照与手工录制 blur/change 均读取全部 input，日期范围最终写成完整 `开始日期 - 结束日期` 的 `fill_date`；CDP 日期点击确认按范围值归属；日期回放解析范围并向 Vue model/两个 input 提交数组与双值。
- 验收：`characterize-date-range-recording.py`、`characterize-manual-radio-fill.py`、`characterize-manual-dialog-scope.py`、`characterize-manual-table-radio.py`、`characterize-xpath-fill-select.py`、`characterize-trajectory.mjs`、Node/Python syntax check、定向 ESLint、`git diff --check` 均通过；新日期范围冷测已注册 `verify-all`。
- 遗留移交：尚未使用远程执行机在真实 SUT 上湿测；需要部署 control plane/executor 后验证 Element UI daterange 与 Tssc 日期组件的实际 DOM/model 回填。

## 2026-09-15 · OpenCode — 开工：日期范围字段录制优化

- 进行中：修复日期范围控件录制只读取第一个 input、结束日期丢失的问题；让 CDP/BiB 与手工录制在范围提交后产出完整双日期 `fill_date`。
- 范围：`src/cdp/inspect.js`、`src/cdp/inspect-payload-script.js`、`src/cdp/remote-bridge/cdp-input.js`、`scripts/manual_recorder/js_parts/a.py`、`scripts/manual_recorder/js_parts/b.py`、相关 characterization、本协作日志；不修改回放动作名及线上轨迹数据。
- 禁入区：`src/services/trajectory/trajectory-meta-service.js` 用户改动、其他会话 WIP、引擎仓；不处理日期面板关闭之外的基础设施告警。
- 方式：沿日期点击确认链路扩展 editor 双 input 快照与范围值归并，保留单日期行为，补充离线 pin/语法检查后提交。

## 2026-09-15 15:26 · Cursor Lead — 收工：人工确认去掉状态闸（回链 15:13 / 14:49）

- 完成：`confirmTrajectory` 用户确认路径不再校验状态，`setPersistentRecordStatus(completed)` 双字段直写；取消确认闸保留；pin + api-docs 同步
- 验收：`node scripts/characterization/characterize-record-status.mjs` OK
- 遗留：控制面需部署重启后 829 湿测；本提交不含菜单扫描 WIP

## 2026-09-15 15:13 · Cursor Lead — 开工续：人工确认去掉状态闸（用户触发直接 completed）

- 进行中：15:13；用户改要求——confirm 不再校验状态，直接置已确认（已由 15:26 收工闭环）
- 范围：同 14:49（`trajectory-meta-service.js` / `characterize-record-status.mjs` / api-docs recording.js）
- 禁入区：菜单扫描未提交改动、`config/`、`.cursor/`、取消确认路径语义不扩
- 方式：红 pin（无确认闸 + want 无条件 setPersistentRecordStatus completed）→ 最小实现

## 2026-09-15 14:49 · Cursor Lead — 开工：人工确认双字段闸（record_status OR persistent_record_status）

- 进行中：14:49；已被 15:13 续条覆盖（不再做双字段闸，改为去闸直写 completed）

## 2026-09-15 14:00 · Cursor Lead — 收工：菜单同 xpath 孪生清理（回链 13:44 开工）

- 完成：`buildScanApplyPlan` 同 pass 按 parent+data-id / parent+xpath 去重 create；pin 2 条绿；`prune-same-xpath-menu-twins.mjs` 已对 systemId=1 `--apply`（drop 0362/0363/0461）；复跑 dry-run 无孪生
- 验收：`node scripts/characterization/characterize-menu-scan.mjs` OK；合同管理现余异 RES 同名对（1540↔0360、1541↔0361）属 B，未动
- 遗留：B 讨论（同名不同 data-id 是否合并/展示）；代码与本条目待用户确认后 commit

## 2026-09-15 13:44 · Cursor Lead — 开工：菜单同 xpath 孪生清理（合同管理 A）

- 进行中：13:44；用户选 A（清同 xpath 孪生 + 堵住 plan 内重复 create）；B 同名不同 RES 另议
- 范围：`src/services/menu-scan-service.js`（`buildScanApplyPlan`）、`scripts/characterization/characterize-menu-scan.mjs`、`scripts/maintenance/prune-same-xpath-menu-twins.mjs`、本文件；MySQL systemId=1 孪生消重（--apply）
- 禁入区：同名不同 data-id 合并策略（B）；radio/search-then-click/KB 他线；`.cursor/`
- 方式：红 pin → 修 plan 去重 → 维护脚本 dry-run/apply；不自动合并异 RES 同名叶

## 2026-09-15 · OpenCode — 收工：AI 录制 picker 阶段完成判定修复（回链本次开工条目）

- 完成：提交 **223c970f**；`picker_dialog_select` 成功完成“选行 + 确认 + 回填”后写入 `picker_closed`、`dialog_confirmed`，并在存在变更字段时写入 `introduced_backfilled`，`done()` 不再因 success token 为空而拒绝。
- 根因：该组合式 workspace action 只返回/落库 action，未共享通用点击/保存路径的 `record_evidence`；日志中的 step 5 与 step 14 因此出现 `missing_any_of`，模型被错误引导为重新打开弹窗。
- 验收：`python scripts/characterization/cold/characterize-introduce-dialog-close.py`、`python -m py_compile scripts/controller/actions/_workspace.py scripts/controller/service.py`、`git diff --check` 通过。
- 遗留移交：需部署 control plane/executor 后用新轨迹湿测，确认阶段 2 后直接进入阶段 3；`network_capture.py` 的 `Response.header_value` 未 await 与 `memory_writer` 超时仍是独立基础设施告警，本次未修改。

## 2026-09-15 · OpenCode — 开工：AI 录制 picker 阶段完成判定修复

- 进行中：排查阶段 2 `introduce_pick` 已完成后因 success token 缺失而反复重试、影响阶段 3 的问题；为组合式 `picker_dialog_select` 动作补齐阶段完成证据并回归验证。
- 范围：`scripts/controller/actions/_workspace.py`、`scripts/controller/service.py`、`scripts/characterization/cold/characterize-introduce-dialog-close.py`、本协作日志；不修改线上轨迹数据。
- 禁入区：`src/services/trajectory/trajectory-meta-service.js` 用户改动及其他会话 WIP；不处理日志中的 `network_capture`/`memory_writer` 基础设施告警。
- 方式：沿 `picker_dialog_select → phase_done_ok` 链路做最小修复，运行定向 characterization、Python 编译和 diff 检查后提交。
## 2026-09-15 00:55 · ZCode 引擎线 — 收工：tooltip 泡泡框误采修复湿测 PASS 全链闭环（回链 00:23 开工）

- 完成：commit **67cb3286**（`src/cdp/page-locator-helpers.js` normalizeHost 头部 popper→触发器重映射 + 生成链再生成 `_locator_helpers_js.py`）。
- 验收（MCP 接管浏览器、产品阶段管理活页面、真实悬停触发 tooltip）：把**活的 popper**（`el-tooltip-6393`，注意 id 与昨日 `4652` 不同——动态 id 实锤）喂给 `buildLocatorSnap` → 产出 `//a[contains(@class,'el-icon-folder-add')]`，strategy=xpath_smart、**verified=true**，解析回真实图标 `<a>`（`inTooltipPopper:false`）；图标本体 snap 行为不变；库存按泡泡框文案过滤 0 命中（证明泡泡框从未入库，缺陷入口在事件/文本采集层，normalizeHost 公共入口重映射即全覆盖）；三源 pin PASS；verify-all 基线 4 红零新增。
- 工程坑（已留痕）：helpers 文本住在模板字面量里——注释中**反引号与插值序列**都会终止模板（本次两次 SyntaxError 来源），已在修复处注释告警。
- 遗留：无。MCP 浏览器 window.__H 残留 80KB 文本（测试浏览器，无需清理）；`tmp/mcp-chunk-*.js`/`tmp/mcp-wet-tooltip.js` 留档。

## 2026-09-15 00:23 · ZCode 引擎线 — 开工：AI 录制图标点击采到 tooltip 泡泡框的修复（JS-gen 侧定位链）

- 现场实证（MCP 接管浏览器 + 注入录制侧同款 PAGE_LOCATOR_HELPERS 普查）：产品阶段管理图标（`a.el-tooltip.el-icon-folder-add`）无文本，唯一可见文本是 tooltip popper（`div.el-tooltip__popper.is-dark`，动态 id `el-tooltip-4652`）；文本/事件目标采到 popper 时 `buildLocatorSnap(popper)` 产出 `//div[@id='el-tooltip-4652']`（动态 id 入 xpath）→ 回放即失效。popper **不带 `.el-popper` 类**，现有枚举黑名单拦不住。
- 范围：`src/cdp/page-locator-helpers.js`（normalizeHost 头部加 popper→触发器重映射，经 aria-describedby 反查）+ `node scripts/_gen_locator_helpers_py.mjs` 再生成 `scripts/controller/actions/js_snippets/_locator_helpers_js.py`（禁手改，走生成链）
- 禁入区：`config/`、他线未提交改动、`scripts/controller/actions/fill_engine.py`（我刚提交的守卫，本次不动）、agent-log 他人条目只读
- 方式：主线程实施；验证=三源一致 pin（characterize-xpath-three-sources 等）+verify-all 对照基线 4 红+MCP 活页面复测（popper→图标 xpath verified）

## 2026-09-14 22:25 · ZCode 引擎线 — 收工：图标按钮点击可靠性修复（他仓 commit 41992f0，回链 22:05 开工）

- 完成：tansun_ui_engine（TUE_1.0.1_LMY）**41992f0**，单文件 click.py +57/−4——① `JS_CLICK_ICON_BUTTON` 图标段由「DOM 顺序首个即点」改为「收集全部命中 → 排除页头（.headerbox/.navbar/.header__action-item，滤空回退全量）→ 恰剩一个才点（`ok-icon:<label>`）→ 多个显式 `err-icon-label-ambiguous:<candidates JSON>`」；② 新增 `icon_button` 子路由接线 `_DATA_NAME_SUBROUTES`（「图标：X」专属路径，歧义=该步最终 error 不落回，miss 才回通用链；函数放 click.py 因复用本模块 JS 避免循环导入）；③ `_click_by_button_text` 歧义短路（容器级判歧义后不再让页面级图标 JS 兜底）。lead 设计、双子智能体并行实现（文件集不相交，均未 commit），主会话复核 diff+传播路径后代提交
- 验收：ruff 全过；JS node --check 过；本地测试 **46 passed**（40 旧全绿 + 6 新 pin：接线/JS 消歧契约/ok 路径/歧义不落回/miss/空 hint）；`err-icon-label-ambiguous` 传播路径人工复核（→ status=error，无误点兜底）。**真机 dry-run 未完成**：MCP 会话在探测时过期跳登录页（凭据不过 ZCode）；结论不受影响——上轮真机已实采该页「上移」双候选现场（页头 span 在前/工具栏 a 在后），新逻辑输出确定为「滤页头 → 恰剩工具栏一个 → 点它」；登录后跑一次 `图标：上移` 预期日志 `图标按钮点击完成 … result=ok-icon:上移` 即终验
- 同批在库（TUE_1.0.1_LMY，均未 push）：0db22e0（合并上游 a6617f6：date 闸门去重取 pkgutil 版+树节点点击加强）、1cd1533（select:tree 叶模式）、f4c1345（date 三闸门+菜单导航）

## 2026-09-14 22:05 · ZCode 引擎线 — 开工：引擎图标按钮点击可靠性修复（lead + 2 子智能体）

- 进行中：2026-09-14 22:05；验收=「上移」类歧义名称不再静默点错（多候选优先非页头、仍歧义显式 err-icon-label-ambiguous）+ `图标：` 前缀接线可按图标标签点击
- 范围：tansun_ui_engine（TUE_1.0.1_LMY，已含合并 0db22e0）`ui_execute/engine/actions/click.py`（JS_CLICK_ICON_BUTTON 歧义守卫 + icon_button 子路由 + 路由表接线）与 `tests/test_click_subroutes.py`（**本地件不提交**，pin 更新）；JS-gen 侧仅本文件
- 禁入区：引擎仓其余文件（含 tests/test_date_action.py、config.py）、JS-gen 源码、push、SUT 真实数据变更（真机只做 dry-run 解析验证不点击）
- 方式：主会话设计并代子智能体声明；子智能体 A=click.py 实现、B=本地测试 pin（文件集不相交），均不 commit；主会话复核 + node --check + ruff + pytest + 真机 dry-run 后代提交

## 2026-09-14 21:52 · ZCode 引擎线 — 收工：pull 引入的 2 个 characterization 红项已修（回链 21:44 开工）

- 完成：commit **0f3f2f55**（2 文件 +23/-6，只改判据、不动同事源码）。
  ① `cold/characterize-search-then-click-prompts.py`：needle「不要为此增删 phase 条数」随 78c89d77 提示词重写被删，纪律由规则 9 承接 → 更新为「不要为了凑数量而拆分」，并存沿革注释；其余 3 针保留。
  ② `characterize-select-option-stamp.py`：400 字字符窗口判据改为**同一缩进分支块**内断言（3763893d 的纯新增行把距离 365→454 即误红）。
- 验收：两 pin 单跑 PASS；**变异测试证明强度未降**（删该分支打点行→红、分支内改名→红）；verify-all 回到基线 4 红，零新增。
- 遗留：无（活页面湿测那条仍属上一条 21:41 条目的待补项，非本条范围）。

## 2026-09-14 21:44 · ZCode 引擎线 — 开工：修复 pull 引入的 2 个 characterization 红项

- 范围：`scripts/characterization/cold/characterize-search-then-click-prompts.py`（needle 按新提示词更新）、`scripts/characterization/characterize-select-option-stamp.py`（400 字窗口判据改结构化）
- 判据前提（已核）：两红均非本次改动引入，且**源码属性仍成立**——① 提示词规则 9「不要为了凑数量而拆分本应合并的操作」承接原「不要为此增删 phase 条数」的数量纪律（措辞变、意图在）；② select_engine no-items 分支仍 `stamped = resolve_recorded_option_text(...)` → `params['option_text'] = stamped`，只是被 3763893d 新增一行把距离从 365 推到 454 越窗。
- 禁入区：不动 `src/services/trajectory/trajectory-meta-service.js` 与 `select_engine.py` 源码（同事线，只改判据）；agent-log 他人条目只读
- 方式：主线程；验证=两 pin 单跑 PASS + verify-all 回到基线 4 红

## 2026-09-14 21:41 · ZCode 引擎线 — 收工：fill_form_field 同值重填守卫（回链 21:34 开工；活页面湿测待补）

- 完成：commit **63209340**（4 文件 +99/-1）：`fill_engine.py` 录制态同值跳过守卫、`agent-tools-form.md` 终检纪律（先比对再重填）、新增 `characterize-fill-already-filled.py` 入 verify-all。
- 验收（离线）：py_compile+模块级 import PASS；**行为单测三路径 PASS**（同值→`already-filled` 且不执行真实填充；异值→放行；探测异常→fail-open）；form-engine-scope-audit PASS；verify-all 经逐项比对确认本次改动零新增红。
- 坑（值得记）：函数体后段一处同名**局部 import** 使 `field_values_equivalent` 在整函数作用域退化为局部名，守卫在其之前引用即 UnboundLocalError —— **AST 未解析名守卫查不出「已解析但晚绑定」，行为测试才抓到**；已固定（局部别名 `_fve`）并入 pin。
- 遗留移交（**非本次改动引入，属同事入站提交**，已用 8e1403c9 vs HEAD 逐项量化证实，建议转告）：
  ① `characterize-search-then-click-prompts` 红 —— `src/services/trajectory/trajectory-meta-service.js` 因提示词重写（78c89d77）丢失旧针 `不要为此增删 phase 条数`，需同 commit 更新 pin；
  ② `characterize-select-option-stamp` 红 —— 3763893d 在 helper 调用与 `no-items-skip` 之间插入 `_mark_picker_selection_success(...)`，把距离从 365 推到 454，越出该 pin 的 400 字窗口（判据本身过脆，建议同时放宽或改为结构化断言）。
- 待补：19242 活页面双场景湿测（同值→跳过不记录；异值→覆盖并记录）。当前测试浏览器（19242）与控制面（4097）均未运行，无法执行；`tmp/fill-guard-behavior-test.py` 已就绪可复用。

## 2026-09-14 21:34 · ZCode 引擎线 — 开工：fill_form_field 同值重填守卫（助手填完主 Agent 再填=重复步骤）

- 范围：`scripts/controller/actions/fill_engine.py`（录制态同值跳过，约 +25 行）、`scripts/prompts/agent-tools-form.md`（终检纪律改为先比对再重填）、新增 `scripts/characterization/characterize-fill-already-filled.py` + `scripts/refactor/verify-all.sh` 注册一行
- 禁入区：`config/`（他线未提交 update-db-whitelist.ps1）、`src/services/trajectory/trajectory-recording-runner.js` 与 `src/routes/browser-session/executor-events.js`（同事刚修完的重复落库链，只读不碰）、agent-log 他人条目只读不删
- 方式：主线程实施；只插入代码不改既有行（AGENTS.md 硬约束）；验证=py_compile+模块级 import+form-engine-scope-audit（AST 未解析名守卫）+新 pin+verify-all 对照已知 4 存量红；19242 活页面双场景湿测（同值→不记录；异值→覆盖并记录）

## 2026-09-14 · OpenCode — 收工：trajectory 828/remoteSession 1660 阶段弹窗误关闭修复（回链本次开工条目）

- 完成：提交 **3763893d**；`select_option` 各成功路径记录 `picker_closed` 选择器完成证据，但不关闭父级业务 drawer；阶段 done 守卫据此不再因父 drawer 可见而注入多余 `close_dialog`，下一阶段可继续点击同一 drawer 内的【下一步】。
- 根因：日志中的 `Premature done() — visible overlay drawer:对公客户评级申请` 后紧跟强制 `close_dialog`，阶段 2 虽已成功但父级向导被关闭；阶段 3 只能重新点击【评级申请】，造成重复操作和后续步骤错乱。
- 验收：Python `py_compile`、`characterize-phase-boundary.py`、`characterize-introduce-dialog-close.py`、`git diff --check` 全部通过；新增 characterization 检查主 select 成功路径均调用 picker 完成标记。
- 遗留移交：需部署 control plane/executor 后用新轨迹湿测；预期阶段 2 结束后日志不再出现 `forcing continue`/自动 `close_dialog`，阶段 3 应直接在原 drawer 点击【下一步】。若仍关闭，请提供阶段 2 `action_log_sync` 与 `[recorder]` 完整片段。

## 2026-09-14 · OpenCode — 开工：trajectory 828/remoteSession 1660 阶段弹窗误关闭与重复步骤修复

- 进行中：依据执行机日志排查阶段 2 `done()` 后误触发 `close_dialog`、导致阶段 3 无法继续并重走阶段 1/2 的问题，修复阶段边界守卫与回归测试。
- 范围：`scripts/agent/recorder_emitters.py`、相关 phase contract/characterization、`docs/superpowers/agent-log.md`；只读检查 `scripts/controller/actions/phase/`、录制 runner。
- 禁入区：`src/services/trajectory/trajectory-meta-service.js` 用户改动及其他会话 WIP；不修改线上 trajectory 828/remoteSession 1660 数据。
- 方式：复现日志对应的 done 守卫决策，确认弹窗生命周期契约后做最小修复，运行 Python characterization/编译检查并提交。

## 2026-09-14 · OpenCode — 收工：trajectory 827/remoteSession 1656 AI 录制重复步骤修复（回链本次开工条目）

- 完成：提交 **1dcb6e39**；`executor-events.js` 在 `session.aiRecording=true` 时不再由通用 `autoPersist` listener 落库 `action_log_sync`，AI 录制仅由 `trajectory-recording-runner.js` 的 run-scoped listener 持久化，避免同一 action 被两条异步链重复追加。
- 验收：`node --check`（业务文件与冷测试）、`node scripts/characterization/cold/characterize-ai-recording-boundaries.mjs`（OK）、定向 ESLint（0 errors）、`git diff --check` 通过；新增冷 pin 锁定 `autoPersist && !session.aiRecording` 边界。
- 日志结论：仓库内没有找到 trajectory 827/remoteSession 1656 的原始线上日志或明细文件；现有代码结构已确认双 listener 是重复落库风险/根因。需部署控制面与执行机后用新轨迹复测确认线上数据。
- 遗留移交：部署后复测请提供 `trajectoryId`、`remoteSessionId`、`sessionId` 及含 `actionId` 的 `action_log_sync`/`action_persisted` 日志；若仍重复，再按相同 `actionId` 是否生成多条 `trajectory_step` 继续定位。

## 2026-09-14 · OpenCode — 开工：trajectory 827/remoteSession 1656 AI 录制重复步骤修复

- 进行中：根据 trajectoryId=827、remoteSessionId=1656 排查 AI 录制重复步骤，修复 action_log_sync 重复消费/持久化，并补回归验证。
- 范围：`src/routes/browser-session/executor-events.js`、相关 characterization、`docs/superpowers/agent-log.md`；只读检查 `scripts/state.py`、`src/services/trajectory/trajectory-recording-runner.js`。
- 禁入区：`src/services/trajectory/trajectory-meta-service.js` 用户既有改动及其他会话 WIP；不修改线上 trajectory 827/remoteSession 1656 数据。
- 方式：先确认日志与录制/落库链路，再做最小 listener 边界修复，运行定向 Node 检查/characterization，提交后回报部署与复测要求。

## 2026-09-14 18:05 · Cursor Automation — 收工：2026-09-13 北京时间工作日报归档

- 完成：`docs/report/2026-09-13.md` + `docs/report/README.md` 索引行；统计窗口 09-13 00:00–24:00，4 条提交（叶模式 DFS 兜底 + 他仓 select:tree 对齐）
- 验收：git log 四笔与 agent-log 09-13 三条收工/开工条目交叉核对；前日 09-12 无独立日报，遗留对照 09-11 + 09-12 agent-log
- 遗留移交：09-12 日报仍缺归档；引擎 select:tree 真机复验、主链 R6/R7 等见日报遗留表

## 2026-09-14 18:03 · Cursor Automation — 开工：2026-09-13 北京时间 cron 日报生成

- 范围：仅 `docs/report/2026-09-13.md`、`docs/report/README.md`、`docs/superpowers/agent-log.md`（本条目）
- 禁入区：`src/`、`scripts/` 业务代码、他线 WIP；不做 Hermes/memory 大扫除
- 方式：git log + agent-log + 09-12 湿测报告归纳；cron 触发 2026-09-14T10:03Z（北京 18:03）
## 2026-09-14 · OpenCode — 收工：trajectory 785 日志复核与截图采集时序修复（回链本次开工条目）

- 完成：提交 **577d322a**；状态组截图改为“先捕获浏览器画面，再异步进入上传/落库队列”，MinIO 超时不再阻塞后续状态捕获；保留步骤与截图的 entryId 绑定。
- 日志结论：785 期间 MinIO `172.19.87.169:9001` 持续 ETIMEDOUT，且日志出现 823/298 与 785 交错 attach，必须在服务器重启后观察实际 `agentSessionId/sessionId → trajectoryId` 映射；现有日志不足以证明同一 Python session 已错误写入 785，但风险真实存在。
- 验收：Node `--check`、定向 ESLint、新增 AI recording boundary pin 均通过；用户原有 `trajectory-meta-service.js` 未纳入提交。
- 遗留移交：远程服务器需部署本提交并重启 control plane/executor；复测时提供新的 `trajectoryId`、完整 sessionId/remoteSessionId 关联日志，确认是否仍有跨轨迹复用。

## 2026-09-14 · OpenCode — 开工：trajectory 785 远程日志复核与截图延迟/会话串线修复

- 进行中：基于用户提供的 trajectory 785 服务器日志，修复 MinIO 超时导致状态组截图晚于动作落地的问题，并核查同一执行机会话被多轨迹复用时的事件归属。
- 范围：`src/services/trajectory/trajectory-recording-runner.js`、`src/services/trajectory/run-event-ownership.js`、`src/routes/browser-session/persist-live.js`、相关 characterization 与协作日志。
- 禁入区：`src/services/trajectory/trajectory-meta-service.js` 的用户未提交改动；不修改远程服务器数据，不清理用户现有日志/截图。
- 方式：先做最小事件/截图链路改造，再用 Node 语法、事件归属和截图持久化相关 characterization 验证，最后提交并给出远程部署复测步骤。

## 2026-09-14 · OpenCode — 收工：AI 录制边界与营业日期观察动作修复（回链本次开工条目）

- 完成：提交 **57a7487b** + **e4c20118**；`phase_state_key` 按嵌套 payload 的 `runId + phase` 做归属过滤，旧 run/旧阶段状态不会再创建或重绑当前阶段组图；`read_business_date` 统一列入 Python 跳过截图/脚本步骤、Node engineering action，保留读取能力但不再落入产品步骤。
- 验收：`node --check`、新增 `characterize-ai-recording-boundaries.mjs`、`characterize-action-log-sync-delta.py`、Python `py_compile`、定向 ESLint 均通过；新增 pin 已注册 `verify-all`。
- 结论：阶段内重复的现有明确契约仍是“同一页面元素的连续操作只保留后一次，非连续重复保留”；未做全局去重，避免误删真实业务重复操作。实际 AI 录制仍需用户提供异常轨迹 ID/执行机日志做线上证据核对。
- 遗留移交：工作区仍保留用户已有未提交改动 `src/services/trajectory/trajectory-meta-service.js`，本线未触碰。

## 2026-09-14 · OpenCode — 开工：AI 录制画面/步骤错位、阶段内重复及 read_business_date 排查

- 进行中：排查 AI 录制事件、阶段状态组截图、步骤落库/去重及业务日期动作的来源与串线风险；必要时实施最小修复并补充离线验证。
- 范围：`src/services/trajectory/trajectory-recording-runner.js`、`src/services/trajectory/recording-runner-step-context.js`、`src/services/trajectory/recording-page-bind.js`、相关 trajectory/screenshot DAO 与 routes、`scripts/recorder.py`、`scripts/agent/recorder_emitters.py`、`scripts/controller/actions` 中 `read_business_date` 相关实现/提示词、针对性 characterization。
- 禁入区：当前工作区已有 `src/services/trajectory/trajectory-meta-service.js` 改动；其他会话在途文件及未明确相关的引擎/KB 线。
- 方式：先用 git 历史和静态链路确认根因，再按现有事件归属/去重契约做最小改动；验证以 characterization、Python/Node 静态检查及必要的录制接口冒烟为准。

## 2026-09-13 01:10 · ZCode 引擎线 — 收工：tansun 引擎 select:tree 对齐叶模式策略（他仓 commit 1cd1533，回链 00:40 线）

- 触发：同事（经用户转达）建议引擎仓 select:tree 同步 JS-gen 叶模式三级策略（协议不动，只改内部实现）
- 完成：tansun_ui_engine（TUE_1.0.1_LMY）**1cd1533**，单文件 `ui_execute/engine/actions/select_tree.py` +235/−4——复用本仓移植过去的 `_real_click`/`JS_REAL_CLICK_ECHO`/`_popover_has`/`_click_path`，新增 `JS_TREE_SEARCH_FILL/SEARCH_MATCHES/DFS_PATH`（逐字移植）+ `_real_click_at`（坐标 CDP 真点）+ `_tree_search_clear` + `_tree_click_leaf_search` 编排；接线 `select:tree` 与 `tree_picker_click` 支持单叶子名（路径数组模式不变）
- 设计取舍（已提请用户与同事确认）：叶子名直达失败仅**结构性**错误（弹层没开/触发器找不到/树数据不可达）才回落合成 JS；**歧义与数据无此叶不回退**——合成注入在该 SUT 会假成功，宁明确失败不假 ok
- 验收：ruff 全过、3 个 JS 片段 node --check 过、引擎仓本地测试 40 passed；**真机复验未做**（MCP 会话过期被踢到登录页），验收用例照抄 00:40 条目两条即可（对公流贷=直达 / KB测子类-…=DFS），预期日志 `ok:via=search-real-click` / `ok:via=data-dfs-path`
- 同批在库：f4c1345（date 三闸门+菜单按名点击/直达路由+导航与页面就绪门闩），均已 commit 未 push

## 2026-09-13 00:40 · ZCode 引擎线 — 收工：叶模式兜底二段湿测 PASS，全链闭环（回链 00:14 开工）

- 完成：兜底实施 commit **c60309e4**（JS_TREE_PICKER_DFS_PATH + 导出 + 叶模式无果分支 + _tree_picker_walk_path + prompt 同步）。
- 验收（19242 活页面，产品目录字段，未保存零净变更）：带连字符叶子 `KB测子类-20260907-1835` 搜索必败 → 自动兜底 DFS 解析路径 `[KB测一级-20260907-1835, KB测子类-20260907-1835]` → 逐级 CDP 真点 → 回显校验 `ok, via=data-dfs-path`，8.1s，弹层自关，字段值=叶子；DFS 抽检 `对公流贷`→恰好 1 条 `[贷款,对公,对公流贷]`；离线=compile+import+pin+verify-all（同 4 存量红）+DFS Node 逻辑测试（唯一/同父同名去重/跨父歧义/不存在）+Python 去重单测全过。
- 至此叶模式三级递进全链实测闭环：搜索直达（昨夜 PASS）→ DFS 寻路真点（本次 PASS）→ 歧义交还 path。遗留：SUT 搜索剥特殊字符属门户自身行为（已绕过不必修）；湿测脚本 tmp/wet-tree-dfs-fallback.py、tmp/dfs-path.test.cjs 留档。

## 2026-09-13 00:14 · ZCode 引擎线 — 开工：tree_picker_click 叶模式兜底二段（搜索无果→数据侧 DFS 寻路真点）

- 范围：`scripts/controller/actions/js_snippets/tree_picker.py`（+JS_TREE_PICKER_DFS_PATH）、`_js_snippets.py`（导出）、`_tree.py`（叶模式无果分支+`_tree_picker_walk_path`）、`scripts/prompts/agent-tools-tree.md`（兜底说明）
- 禁入区：`config/`、`scripts/session_runner.py` 等他线 WIP；agent-log 他人条目只读不删
- 方式：主线程实施；验证=compile+import+pin+verify-all 对照已知 4 存量红+19242 活页面湿测（带连字符叶子搜索必败→兜底路径真点，字段现值即该叶子=同值重选零风险）

## 2026-09-12 22:40 · ZCode 引擎线 — 收工：tree_picker_click 叶子名直达双模式湿测闭环（回链 21:42 开工）

- 完成：实施 commit **6fd303a9**（7 文件：搜索直达片段×2、签名可选化+叶子分支、_normalize_params 别名、event_dispatch 白名单、prompt 双模式、cold pin 针同步）+ 守卫补丁 **5e6d51fc**（弹层已开不重复开）。
- 验收（19242 活页面，产品目录字段，全程未保存、零净变更）：①叶子名模式真选「对公流贷」→ `ok, echo=对公流贷, via=search-real-click`，1.5s，弹层自关；②path 模式真点 KB测一级→KB测子类 把值还原 → echo=KB测子类-20260907-1835；③对照实验实证 SUT 树搜索自身剥连字符（`KB测子类-…`→0 结果、`对公流贷`→精确 3 节点），带 `-` 等特殊字符的叶子名搜索直达不可用、path 模式不受影响；④离线=compile+import+单测+6 pin+verify-all（同 4 存量红，无新增）。
- 遗留移交：①SUT 树搜索剥特殊字符是门户自身行为，如需支持带 `-` 叶子名可在叶模式加「搜索无果→按前缀逐级展开」兜底（未做，待裁决）；②分类目录（新增分类弹窗）字段第一次探测报 popover-not-open，未二查（用户改指产品目录）；③/tmp 湿测脚本 wet-tree-leaf-search*.py 留档。

## 2026-09-12 21:42 · ZCode 引擎线 — 开工：tree_picker_click 叶子名直达（path 可选化）+ 老参数兼容

- 范围：`scripts/controller/actions/js_snippets/tree_picker.py`（新增搜索直达片段）、`_js_snippets.py`（re-export）、`_tree.py`（签名可选化+叶子分支）、`_replay.py`（_normalize_params 别名）、`scripts/event_dispatch.py`（签名白名单补登）、`scripts/prompts/`（若提及该动作则同步）
- 禁入区：`config/`、`scripts/session_runner.py` 等他线 WIP；agent-log 他人条目只读不删
- 方式：主线程实施；验证=py_compile+模块级 import+characterization pin（含更新若钉住签名）+verify-all 对照已知 4 存量红；19242 活页面 replay API 单步湿测（真选叶子「对公流贷」，用户已批准）

## 2026-09-12 17:40 · ZCode 引擎线 — 收工：回放误触发表单结构自愈修复（回链 17:24 开工）

- 完成：`scripts/controller/actions/js_snippets/misc.py` JS_VERIFY_FORM_STRUCTURE 的 expectedLabels 表达式一处（`f.label || f` → `(f&&typeof f==='object')?(f.label??''):f`），commit **48c99419**。根因=空 label 布尔坑把 tssc 按钮行 form-item（label=''）误判为新增可选字段，恒产 `added_optional:['']` 误入 Phase2 结构自愈。
- 验收：py_compile+模块级真实 import PASS；渲染后片段 Node 行为测试双对照 PASS（修复=零差异；旧式=精确复现线上 `added_optional:['']`，tmp/verify-form-structure-empty-label.test.cjs）；verify-all 4 红经 HEAD 基线复跑比对确认为存量/环境（step-highlight、export-v3=无 VPN 断库取不到真数据；layer-tree=traj33 数据漂移；confirm-notification=读 `_misc.py` 通知 marker 漂移），**与本改动无关，零新增红**。
- 遗留移交：①录制侧快照口径排除无输入控件的按钮 form-item（动静大，待裁决）；②上述 4 项存量红归各自线（库依赖项 VPN 恢复后自愈、_misc.py marker 漂移归引擎线复核）；③`memory_writer flush timed out`（无 VPN 机器网络层现象，未深查）。

## 2026-09-12 17:24 · ZCode 引擎线 — 开工：回放误触发表单结构自愈修复（misc.py 一行）

- 范围：仅 `scripts/controller/actions/js_snippets/misc.py`（回放比对 expectedLabels 表达式一处，约 304 行）
- 禁入区：`scripts/session_runner.py`、`config/`（他线有未提交改动：update-db-whitelist.ps1 / start-tansun-engine.ps1）、agent-log 他人条目只读不删
- 方式：主线程单点 Edit；验证=py_compile+模块级真实 import+Node 端行为测试（空 label 期望对象复现 added_optional 消失）+verify-all；不派子智能体

## 2026-09-12 · OpenCode — 收工：本地启动 MySQL 连接超时修复（回链本条开工）

- 完成：`config/database.js` 改为数据库连接按需创建，新增 `DB_CONNECT_TIMEOUT_MS`/`DB_ACQUIRE_TIMEOUT_MS`，健康探测使用一次性 mysql2 连接；`server.mjs` 将数据库维护异步化并增加单线程恢复探测，MySQL 不可达时暂停截图清理、截图重试、executor sweep 与启动 reconcile。
- 验收：备用端口 `4198` 启动成功，远程 MySQL 不可达时服务仍监听且仅输出一条暂停告警；`npx eslint config/database.js server.mjs`、`node --check server.mjs`、`node --check config/database.js`、`git diff --check` 通过。
- 提交：`35f36d79`。
- 遗留：当前 `4097` 已被已有进程占用；远程 `47.101.58.49:3306` 仍不可达，恢复数据库网络后后台维护会自动恢复。

## 2026-09-12 · OpenCode — 开工：本地启动 MySQL 连接超时修复

- 进行中：修复 `npm start` 启动期间远程 MySQL 不可达导致的连接池超时与后台维护任务噪声。
- 范围：`config/database.js`、`server.mjs`、`config/.env.example`、本文件；验证启动行为与相关静态检查。
- 禁入区：`src/` 业务 DAO/service、其他会话未提交改动及引擎线文件；不修改用户已有配置中的凭据。
- 方式：按需连接池 + 数据库连接超时 + 启动维护任务数据库可用性门控，随后运行 lint/启动冒烟并提交。

## 2026-09-12 · OpenCode — 收工：src/services JSDoc 中文化（回链 `41864d19`）

- 完成：将 `5614cd8a` 新增或扩展的 `src/services/**/*.js` 文件级与具名函数级 JSDoc 翻译为中文，JSDoc 标签、类型和实现逻辑均未改；提交：`a19f1cc1`。
- 合并：已先解决拉取后的 `agent-log.md` 冲突，采用远端协作日志内容并保留本线追溯；合并提交：`41864d19`。
- 验收：服务 JSDoc 定向 ESLint 与 `git diff --check` 通过；提交钩子 ESLint 通过。
- 遗留：`src/services/trajectory/trajectory-recording-runner.js` 保留工作区既有的事件过滤实现改动，未纳入本次注释提交。

## 2026-09-12 · OpenCode — 开工：src/services JSDoc 中文化

- 进行中：将 `5614cd8a` 新增或扩展的 `src/services/**/*.js` 文件级与具名函数级 JSDoc 翻译为中文；JSDoc 标签、类型、实现代码与导出契约保持不变。
- 范围：`src/services/**`、`docs/superpowers/agent-log.md`；已先解决本文件的拉取合并冲突，采用远端协作日志内容并补写本任务条目。
- 禁入区：服务模块的在途实现逻辑、`src/services/` 外所有文件及当前工作区的其他改动；提交时只暂存本次注释与本文件。
- 方式：按互不重叠目录翻译并进行静态检查，复核仅注释差异和 lint 后提交。

## 2026-09-12 11:35 · ZCode 引擎线 — 开工+收工：同事引擎 mega 菜单不收起修复（他仓 commit 8356af4）

- 触发：用户报告引擎执行实际任务时子菜单无法关闭（截图：产品管理面板残留盖住页面）
- 根因（真机实证）：本 SUT mega 菜单只认面板外 **trusted mousedown**；引擎 `菜单：` 只发合成 `el.click()`，通用链 mousedown 也是 `dispatchEvent`（isTrusted=false）、Escape 亦无效 → 面板残留。用户失败链的菜单步是 `[click] 菜单切换-1/2`（走通用链，非 `菜单：` 子路由）
- 修复（**他仓** `D:/dev/tansun_ui_engine` compat/js-gen-operations，commit **8356af4**，3 文件）：移植 JS-gen `page_id.py:190` 选点 + `_replay.py:204` 真实鼠标 down/up → `dismiss_mega_menu()`；`menu_item()` 与「菜单切换」前缀两条成功路径挂钩；5 条 pin（含禁止简化成合成 click 的防再犯断言）
- 验收：冷测 28 passed；**真机同调用对照** 开面板 8 项 → 合成 mousedown 仍 8 项 → 真实 move/down/up 后 **0** 项，800ms 复查仍 0；证据 `tmp/tansun-wet/22-menu-panel-dismiss.json`
- 遗留：① 引擎进程级整合复跑待用户执行（运行中实例 PID 30472 早于修复、不热加载；且该链含凭据）；② **合并波及备案**：用户 11:02 合入上游（b67a605）带来 `.gitignore tests/` 并删 20 个测试文件（281→70 用例），`test_select_click_rowselect.py` import 断裂致全量唯一 1 failed，与本修复无关；③ 「菜单切换」父级分支未挂载问题（WET-2026-0912-MENUBRANCH）仍未修

## 2026-09-12 10:55 · Cursor Lead — 收工：合约主权收口（回链 10:50）

- 完成：① `todo-list` `contract-sovereignty-wet` → **P3 已闭**（754/758/762）；② `_DONE_AS_INSTRUCTION_RE` 收紧 `(?<![A-Za-z_])done\s*\(` + pin（`task_done` 不误伤）；`planner_advice_discarded` 转发已在 `session-message.js` / recording-runner（r4 events=0 系 start 中断非缺接线）；④ CP `339435`/executor `339431` 已停
- 验收：`characterize-planner-advisory-filter: OK`；报告注记已更
- 遗留：Premature vs gate 文档、out_of_scope 触碰丢弃、push/PR 仍待用户授权

## 2026-09-12 10:50 · Cursor Lead — 开工：合约主权收口（台账 + done 正则 + 停服务）

- 进行中：2026-09-12 10:50；验收=todo-list 闭线、`task_done` 不误 discard、CP/executor 已停
- 范围：`docs/superpowers/todo-list.md`、`scripts/agent_utils.py`、`characterize-planner-advisory-filter.py`、报告注记、本文件；停 4097/LMY
- 禁入区：他线 WIP、classify.py、合约门闩语义大改、push/PR（未授权）
- 方式：收紧 `_DONE_AS_INSTRUCTION_RE` + pin；核对 `planner_advice_discarded` 转发；停服务

## 2026-09-12 11:00 · ZCode 引擎线 — 补记：WET-2026-0912-DATEPANEL 缺陷双侧修复（回链 09:12 / 10:45）

- 触发：用户复看第 20 项截图追问「daterange 不会自动关闭日期弹框吗」——属实，面板残留盖住表格
- 根因（实证）：`closePanels()` 只改 DOM 样式，组件 `vm.pickerVisible` 仍 true，Element popper 按自身状态重绘把压制覆盖回去；样式压制对 Vue 重渲染无效。单日期路径同病根（第 05 项 `knownCosmetic` 已记录同一残留）
- 修复：`closePickerVm()` 状态级关闭（=`pickerVisible=false`，回落 `handleClose()`），两分支 blur 后调用，样式压制留作兜底
  - 引擎 `ui_execute/engine/actions/date_action.py` + pin test — commit **013a67d**（pytest 281 passed）
  - JS-gen 源头 `scripts/controller/actions/js_snippets/fill_date.py` — commit **b9694d1b**（**禁入区第二次解禁说明**：用户追问即授权修此缺陷；同目录同病根，已单独 commit 可审计）
- 真机复验：修复后集成 JS 返回 `ok-date-range`，t0/500ms/2000ms 面板均关闭不被重新拉起，三层值一致；证据 `tmp/tansun-wet/20b-daterange-panel-closed-fix.png`
- 边界：JS-gen 单日期路径的独立真机复验待做（当页无单日期控件；逻辑与引擎修复同源，关闭机制已同 SUT 真机证明）——下次落到带单日期页面顺手复验
- 报告已同步：`docs/superpowers/reports/2026-09-12-tansun-engine-wettest-94.md` §三·补

## 2026-09-12 10:45 · ZCode 引擎线 — 收工：§9.4 人机分工湿测 20/20 全 PASS（回链 09:12）

- 完成：**20 项全 PASS**（六 type 全覆盖+click 八子路径全命中：radio表格/input×2/date单日期/select:click字典/select:tree/页签/邻钮/弹窗查询/行选/确认回填/关闭弹窗/tssc两形态/表格行按钮/表单radio/展开树/菜单：/daterange）；收官报告 `docs/superpowers/reports/2026-09-12-tansun-engine-wettest-94.md`；证据 JSON+截图 `tmp/tansun-wet/`（gitignore 本地，Temp 同步副本）
- 湿测产出修复（均用户授权/指令）：① WET-2026-0912-CLOSEBTN 带空格按钮「取 消」匹配失败落「确 定」变保存——双侧修复 engine `873d534`（含 pin test，280 passed）+ JS-gen 源头 `b4b832e0`；② expand_all_el_tree 移出 META_STEP_ACTIONS 前端可见 `4adcf94e`（三消费点语义核验+verify-all 3 红经 stash 对照=存量红）
- **禁入区解禁说明**：开工条目声明「不改 src/ 与 scripts/ 代码」，会话中经用户两条明确指令（「JS-gen 源头的缺陷，你也修复吧」「既然是推送步骤的话，请你还是在前端展示吧」）解禁，仅动 `scripts/controller/actions/js_snippets/close_dialog.py` 与 `src/models/meta-step-actions.js` 两文件，均单独 commit 可审计
- 验收：逐项业务证据回读（含 SUT 业务校验拦截/隐私保护两处用户判读）；pytest 280 passed；eslint pre-commit 全过
- 遗留移交：expand_all_el_tree 录制步骤 locator=null 推送侧硬校验拒（payload.py:333-334）→推送链元素抓取随引擎联调窗口排期；L2 端到端全链湿测 L1 收官后安排；两分支待用户+同事评审后推送/合并

## 2026-09-12 10:25 · Cursor Lead — 收工：planner discard 湿测 r4（回链 10:15）

- 完成：traj **762** session `72a4e367`；字面 `[planner] discard reason=next_steps_instruct_done`（stderr）；多次 kept 后命中；证据 `tmp/.../planner-discard-r4/`；报告已记
- 验收：live filter 湿 discard ✅；触发串含 `task_done(`（regex `done\s*\(`）；`events[]` 因 start 请求中断为 0
- 遗留：可选收紧 `_DONE_AS_INSTRUCTION_RE` 避免误伤 `task_done`；`planner_advice_discarded` 事件面未在本跑收到

## 2026-09-12 10:15 · Cursor Lead — 开工：planner discard 湿测 r4（中途 done(true) 拒后再拖延）

- 进行中：2026-09-12 10:15；验收=stderr `[planner] discard` 或 `events[]` 含 `planner_advice_discarded`
- 范围：录制 API、`tmp/.../planner-discard-r4/`、报告增补、本文件；不改运行时代码
- 禁入区：他线 WIP、合约门闩回改、classify.py
- 方式：填名后 ≥8 次观察 → 强制一次 done(success=true) 吃 gate 拒 → 再 ≥6 次观察 → done(false)；诱导 next_steps done 口气

## 2026-09-12 10:00 · Cursor Lead — 收工：planner discard 湿测 r3（回链 09:50）

- 完成：traj **761** session `29f68d19`；≥3 次 `[planner] kept compatible_with_contract=true`；**无** `[planner] discard`；证据 `tmp/.../planner-discard-r3/`；报告已记
- 验收：live filter 解析 JSON 并放行合约内建议（modify+toast 路径）✅；字面 discard 湿样本仍缺（LLM 未出 false/done 口气）
- 遗留：若要坚持字面 discard 湿钉，需 out_of_scope 冲突探针或扩展 filter 对 out_of_scope 触碰的丢弃（规格已写、实现未全）

## 2026-09-12 09:50 · Cursor Lead — 开工：planner discard 湿测 r3（加长拖延诱导 done 口气）

- 进行中：2026-09-12 09:50；验收=stderr `[planner] discard`（优先 `next_steps_instruct_done`）或 `events[]` 含 `planner_advice_discarded`
- 范围：录制 API、`tmp/.../planner-discard-r3/`、报告增补、本文件；不改运行时代码
- 禁入区：他线 WIP、合约门闩回改
- 方式：阶段2 填名后 ≥12 次 get_page_state 再 done(success=false)

## 2026-09-12 · Grok Bot · 开场+收工：落地 atomize prompt 修订（Opencode 对齐）

- 范围：覆盖 scripts/prompts/req-draft-traj-atomize-prompt.md；样板保留 docs/superpowers/prompt-engineering/product-element-taskdraft-samples.md；**不改** propose.js（可选字段 preconditions/dataDependsOn 暂写在 taskDraft 文首亦可）
- 增量：一功能一交易；禁止菜单导航步；taskDraft 可执行性规范；可选 layoutHints/preconditions/dataDependsOn；保留 JSON-only / 出处占位 / flowCards
- 方式：用户审过 REVISION 后覆盖线上；他线 WIP 未携带
- 验证：Cursor 侧测试接管；本刀仅 prompt 文本

## 2026-09-12 09:45 · Cursor Lead — 收工：planner advisory discard 接线 + 湿测（回链 09:20）

- 完成：`patch_planner_advice_filter` 挂入 `Agent._run_planner`；stderr `[planner] run|kept|discard` + 事件 `planner_advice_discarded`；pin 扩 fence/kept/接线钉；湿测 traj 759/760；报告增补；提交 `49f18c0f`
- 验收：冷 pin OK；湿测 **接线** `[planner] run`（760 / `547c35ee`）；字面 discard 湿样本未拿到（LLM 未出 incompatible）— filter 行为以冷测为准
- 遗留：可选更长探针再诱导 `compatible_with_contract=false`；服务仍运行

## 2026-09-12 09:20 · Cursor Lead — 开工：planner advisory discard 接线 + 湿测

- 进行中：2026-09-12 09:20；验收=`Agent._run_planner` 经 `filter_planner_advice`；丢弃时 stderr `[planner] discard`；湿测至少一条 discard 证据
- 范围：`scripts/agent_utils.py`、`scripts/session_runner.py`、`scripts/agent/service.py`、`characterize-planner-advisory-filter.py`、湿测 tmp/报告、本文件
- 禁入区：改 validate_done、tansun 他线、整改 browser_use 上游包
- 方式：猴子补丁接线 → 冷 pin → 诱导冲突的 planner 湿测

## 2026-09-12 09:12 · ZCode 引擎线 — 开工：报文转换链路文档 + §9.4 人机分工湿测（续）

- 进行中：09:12；湿测已 PASS 1 项（radio 表格单选，证据 tmp/tansun-wet/01-radio-table-row.json）；本任务单元=新增报文转换链路参考文档 + 继续 §9.4 清单（下一项=修改按钮点击）
- 范围：docs/superpowers/reports/2026-09-12-payload-conversion-chain.md（新建）、docs/superpowers/agent-log.md、tmp/tansun-wet/（gitignore 本地证据）
- 禁入区：Cursor done_rejected 湿复验线（其录制/服务启停轨迹、classify.py、合约门闩语义）、一切 src/ 与 scripts/ 代码改动、tansun_ui_engine 仓（湿测只读抽 JS 不改）、他线 WIP
- 方式：主会话亲自写文档（file:line 带证，事实均已本会话复核）；湿测=Playwright MCP 有头浏览器 snapshot→派发同事 handler JS 原样（或等价协议级 click）→业务判据验证，用户导航，副作用操作先授权

## 2026-09-12 09:10 · Cursor Lead — 收工：done_rejected 默认可观测湿复验（回链 09:05）

- 完成：重启 CP+LMY executor；traj **758** session `35bee0ee-…`；stderr `[phase_done] done_rejected authority=gate … missing_evidence=['toast_ok','url_change']`；`record/start` events[] 含 `type=done_rejected`；报告 r4 节；证据 `tmp/.../done-rejected-r4/`
- 验收：harness `PASS=true`（stderr_obs + events_obs）；无 sniff
- 遗留：planner advisory discard 湿测样本仍缺（非本复验范围）；服务保持运行

## 2026-09-12 09:05 · Cursor Lead — 开工：done_rejected 默认可观测湿复验

- 进行中：2026-09-12 09:05；验收=重启服务后专项录制；agent-stderr / executor 出现 `[phase_done] done_rejected authority=gate`；可选 `events[]` 含 `done_rejected`（无临时 sniff）
- 范围：启停服务、录制 API、`tmp/contract-sovereignty-wet/done-rejected-r4/`、报告增补、本文件；**不改**运行时代码
- 禁入区：他线 WIP（tansun）、`classify.py`、合约门闩语义回改
- 方式：重启 CP+executor → 对公客户管理探针 → 盯 stderr / 终态 events

## 2026-09-12 02:40 · ZCode 引擎线 — 收工：tansun 兼容实装五批落地（回链 02:05 开工）

- 完成（tansun_ui_engine 分支 compat/js-gen-operations，4 笔 commit）：**cb30ef8** 批1=data_name 前缀解析 helper+input 值 objectValue 优先+radio/select_tree/replay_adapter 三路 hint 剥前缀；**e0e87a9** 批2=click 七前缀子路径（关闭弹窗/展开树/页签/表格行按钮/树选/邻钮/菜单，click_subroutes.py 前置路由，miss 落回同事兜底链，裸路由 miss=skip，按钮文本剥前缀）；**eb564e3** 批4a=date event 六处清单（单日期移植 fill_date.py+daterange 双 input $emit('input',[s,e])，JS-gen 无 daterange 参考实现为按规格新写）；**75bd130** 批4b=select_click「弹窗选择」表格行选+tssc 远程表格分支（16×250ms 静置轮询防残留首行误点，字典路径 10s→3s 短等不变行为）
- 验收：全量 pytest **279 passed**（基线 216+新增 63 用例，test_agent_e2e 4 errors=本机缺 %ComSpec% 存量环境问题）；diff 审查 10 改+8 新文件全在允许清单；**批 5 离线打样 ALL PASS**——14 步真实形态 V3 payloadJson 全链转换，断言全中（select:tree 别名归一→select_tree_option/date 过白名单单+区间/tree path JSON 数组保真/objectValue 与 val 双写无损/前缀 dataName 透传）；打样脚本=AppData\Local\Temp\tansun-wet\offline-payload-check.py
- 子智能体四路并行（A 批1/B 批2/C1 批4a/C2 批4b）文件集互不相交，由本会话代声明代提交，无越界改动；有价值偏离已复核接受（close_dialog 补 ESC 兜底层、tree_picker 去 form-label 谓词、菜单 textContent 匹配隐藏项、daterange 新写）
- 遗留移交：①§9.4 人机分工湿测待用户参与（chromium 后台安装中，用户导航+本会话验证 18 操作）；②SUT 待用户定（test.creditv5p2 或同事系统）；③分支未推送，用户/同事验收后合并；④V3 空元素步骤整单拒已实证（样例空 xpath 步骤被 primaryLocator 校验拦下）——推送侧 P3/P4 硬前提再确认
- 注意：JS-gen 本单元只提交 agent-log 一文件；他线 WIP（Cursor done_rejected 线）未触碰未携带

## 2026-09-12 02:05 · ZCode 引擎线 — 开工：tansun 兼容实装周末连续执行（回链 09-11 §8.3 计划+§9.4 湿测契约，用户发令）

- 工作范围：D:\dev\tansun_ui_engine 分支 compat/js-gen-operations（自 TY_UI_ENGINE_1.0.0=5e12ff1 建）——ui_execute/engine/data_name.py(新)/actions/{input_action.py,radio.py,select_tree.py,replay_adapter.py,click.py,click_subroutes.py(新),date_action.py(新),select_click.py}/action_registry.py、ui_execute/models/{enums.py,payload.py}、docs/EXECUTION_PAYLOAD_MIGRATION.md、tests/{test_data_name.py,test_input_prefix.py,test_click_subroutes.py,test_date_action.py,test_select_click_rowselect.py}(新)；JS-gen 仓仅 agent-log；tmp/tansun-wet/（湿测产物）
- 禁入区：tansun 仓其余全部（scheduler/executor/locator/config.py——5e12ff1 同事环境配置勿动）、tests 存量 16 件（只跑不改）；JS-gen 主仓 src/scripts（他线 WIP）
- 执行方式：主会话批 0（分支+216 passed 基线+chromium 后台装）→ 写 data_name 前缀 helper → 4 并行子智能体（A=input/radio/select_tree 前缀接线+replay_adapter hint 归一+input 值字段；B=click 前缀剥离+七子路径 click_subroutes.py 前置路由；C1=date event 六处清单；C2=select_click 弹窗行选+tssc 表格分支）——子智能体不 commit 不写本文件，主会话全量 pytest+diff 审查后分批代提交；收尾 §9.4 人机分工湿测（用户导航）
- 计划依据：报告 2026-09-10-tansun-engine-18-action-mapping-audit.md §7/§7.1/§8/§9 为唯一蓝图

## 2026-09-12 02:05 · Cursor Lead — 收工：done_rejected 默认可观测（回链 01:58）

- 完成：`evaluate_phase_done` 拒答 stderr `[phase_done] done_rejected authority=gate …`；`session-message` 转发 `done_rejected`；recording runner `events[]` 收录；api-docs recording 备注；pin `characterize-phase-done-validate` 扩 stderr + 源码钉
- 验收：`characterize-phase-done-validate` OK；`characterize-contract-sovereignty` Task1/2/3/6 OK
- 遗留：未改 recorder Premature 与 gate 双层语义合并；planner advisory 湿测样本仍缺

## 2026-09-12 01:58 · Cursor Lead — 开工：done_rejected 默认可观测

- 进行中：2026-09-12 01:58；验收=拒答时 stderr 含 `done_rejected authority=gate`；`session-message` 转发 `done_rejected`；录制 `events[]` 可含该类型；冷 pin 绿
- 范围：`scripts/controller/actions/phase/intent_gates.py`、`src/routes/browser-session/session-message.js`、`src/services/trajectory/trajectory-recording-runner.js`、相关 characterization / api-docs 备注、本文件
- 禁入区：改 validate_done 门闩语义、合并 recorder Premature、他线 WIP
- 方式：TDD 扩 pin → stderr echo + WS/录制观测转发 → 跑 pin

## 2026-09-12 01:35 · Cursor Lead — 收工：done_rejected 事件嗅探 r3（回链 01:25）

- 完成：traj **757** session `9c17ae3f-…`；临时 relay tee 落盘 `tmp/contract-sovereignty-wet/done-rejected-r3/events.jsonl`；报告专项节已更新；嗅探补丁已 `git checkout` 回滚
- 验收：字面事件 `done_rejected` · `authority=gate` · `reasons=[submit_required,success_unmet]` · `missing_evidence=[toast_ok,url_change]` · `contract_version=1`
- 遗留：可选重启 executor 清掉内存中 tee；产品路径仍不写 stderr（仅 sniff 捕获）

## 2026-09-12 01:25 · Cursor Lead — 开工：done_rejected 事件嗅探湿测 r3

- 进行中：2026-09-12 01:25；验收=`events.jsonl` / executor 日志出现字面 `{"event":"done_rejected"...}` 且含 `missing_evidence`（期望 `toast_ok`）
- 范围：临时嗅探 `executor/session-handler.js`（relay tee）、`tmp/contract-sovereignty-wet/done-rejected-r3/`、报告增补、本文件；跑完后**回滚嗅探补丁**
- 禁入区：合约主权实现回改、`classify.py`、他线 WIP
- 方式：重启 executor 加载嗅探 → 对公客户管理手写 2 阶段；探针 `done(success=false)` 不保存 → 收盘 events.jsonl

## 2026-09-16 13:10 · Cursor Cloud — 收工：G3 phase_done 证据门闩（回链 12:22 开工）
- 完成：Tasks 0–7 — query/navigate `success_when` + click 证据埋点 + recorder `needs_token` 双条件 + 控制面 0 步拒收 + verify-all 接入 pin + prompts 对齐
- 提交链：`539c8e76` → `1d1afc3f` → `bb16b5e7` → `dd8d2f58` → `8c07eff9` → `0b65742a`（+本收工）
- PR：https://github.com/Ahnoler/JS-gen/pull/45 （draft → master）
- 验收：`characterize-phase-boundary` OK；`characterize-phase-runtime` PASS；`characterize-phase-done-evidence-gate` OK；eslint 触及 JS 0 warning；`verify-all` 中 G3 相关全绿
- 注意：本云环境无 MySQL（3306 ECONNREFUSED）→ `characterize-step-highlight` / `layer-tree` / `export-v3` 仍红（与本刀无关）；湿测未跑
- 遗留移交：对公建档/查询多阶段湿测确认 P3/P4 不再 0 步假成功；有 DB 的环境再跑全量 `verify-all`

## 2026-09-16 12:22 · Cursor Cloud — 开工声明：G3 phase_done 证据门闩
- 开工：12:22 UTC。执行 Project store `docs/g3-phase-done-plan.md` Tasks 0–7
- 范围：`scripts/controller/actions/phase/boundary_contract.py`、`boundary_gates.py`、`intent_contract.py`、`intent_gates.py`、`prompts.py`、`scripts/agent/recorder_emitters.py`、点击/导航证据埋点相关（`_misc` / form click 路径按需）、`scripts/characterization/characterize-phase-boundary.py`、`characterize-phase-runtime.py`（若触 needs_token）、`scripts/refactor/verify-all.sh`、`src/services/trajectory/trajectory-recording-runner.js`（及本阶段业务步数小 helper）、本文件
- 禁入：G1 报文捞取、G2 运维、G4 真上传 / KB 湿测主责、文件上传·SUT、`save_section.py`（禁止恢复）、他线 WIP（`scripts/agent/service.py` 未声明改动、`data/kb/flows/**` 湿测主链、req-upload）
- 方式：主会话按 plan 顺序执行；默认 login 空 success_when / 整轨 fail→isSuccessful:false / 双闸 / kind=`query_clicked`
- 分支：`cursor/g3-phase-done-evidence-gate-3b92`

