# 总 TODO（2026-08-13 基线 · 2026-09-06 重整）

> **跨会话共享清单。** Cursor 会话内 TodoWrite 不跨聊天；以本文件为准。  
> 本文件只跟踪**未闭环**项；已交付/已闭环条目不再保留，历史以 git log 为准（`CHANGELOG.md` 已于 2026-09-04 删除）。  
> 缺陷已全部修复关闭（2026-08-20 确认，含 1448052）。

> **2026-09-06 重整（用户定调）**：被测系统开发中，部分流程卡内容只适用当前 SUT 版本、部分模块功能跑不通——不追全量。主线聚焦=**引擎线跑通真实业务主链**（客户新增→对公评级→授信申请→审批→批复→用信→合同）；KB 从全量补测晋升转向**主链流程卡供给**；blocked 回收/T1-2批降级为按需顺路。

## 当前工作线（2026-09-06 起）

### ⑧ 需求切片 → 原子草稿交易（2026-09-07 · 已落地；SPA 向导已交付）

- **已合入**：两段式 API `draft-traj/propose|commit`；provenance 四字段迁移；propose cache；characterize **OK 25**（质量修复后）。
- 规格/计划：[`specs/2026-09-07-req-to-draft-traj-design.md`](specs/2026-09-07-req-to-draft-traj-design.md) / [`plans/2026-09-07-req-to-draft-traj.md`](plans/2026-09-07-req-to-draft-traj.md)
- **湿测通路 PASS（2026-09-08 凌晨）**：traj 681/682；报告 `tmp/req-draft-traj/through-report-wet.md`；FK guard `3b03e231`
- **质量审 + 修复（2026-09-08 Cursor Reviewer）**：章节挂错（概述/复用章）+ task 占位未替换 → 已修 `provenance.js`/`propose.js`；离线 chain-a 10 步 resolve 均指向 `03-配置产品信息`
- **质量复测 PASS（2026-09-08 Zcode，`b0c7118c` LLM 路径）**：重启控制面后 propose 9 atoms/0 rejected——概述挂载 0、占位残留 0、fnId 全 null；force commit 排序/公共要素/个性化 → traj **687/688/689** GET 验证过；报告 `tmp/req-draft-traj/through-report-quality-rerun.md`
- **Lead 裁定（2026-09-08）**：681/682 已清理；余 6 atoms 不批量 commit——由 SPA 勾选门闩承接
- **SPA 向导已交付（2026-09-08 SDD Task 1–9）**：规格 [`specs/2026-09-08-req-draft-wizard-ui-design.md`](specs/2026-09-08-req-draft-wizard-ui-design.md) / 计划 [`plans/2026-09-08-req-draft-wizard-ui.md`](plans/2026-09-08-req-draft-wizard-ui.md)；JS-gen `aa4ca8a8`（`hasThroughChains`）；vue-project `37b5219`→`6346e1c`（四步向导 + 录制列表「需求生成草稿」）；Task 9 冒烟 `tmp/req-draft-traj/through-report-wizard-ui.md`（API PASS + 静态无 prepare/record；UI 浏览器湿测未跑）
- **余（可选 polish）**：前端 dev 下手工/Playwright 四步湿测 + DevTools 确认无录制 API；`npm run build`（vue-tsc）例行门闩
- **现状（2026-09-08 用户）**：SPA 已过完，**⑧ 整线进入 bug 测试期**——测试发现的 bug 随测随派修复单；各会话接到 ⑧ 相关 bug 单先看本节与两份报告（wet/quality-rerun）再动手
- **流程卡召回 prepare 注入已合入（2026-09-08 SDD）**：`1ad954fe`→`5cca1e8d`；spec [`specs/2026-09-08-atom-record-flow-card-recall-design.md`](specs/2026-09-08-atom-record-flow-card-recall-design.md) / plan [`plans/2026-09-08-atom-record-flow-card-recall.md`](plans/2026-09-08-atom-record-flow-card-recall.md)；⑧ 测试缺 `【流程卡模板】`→查 migrate + traj `kbFlowRef` + 卡文件
- **KB 链路加固已落地（2026-09-08 加固线，13 任务 ALL GREEN，`fb9f3a5b..9caadef9`）**：atomKey 稳定化+回填、幂等全状态+`req_atom_seq` 唯一索引、propose 缓存 cacheVersion/sourceHash 失效、4xx 错误语义、出处锚点 `req_source_hash`/`req_chunk_id`+commit 回查、召回 idf 重写（800 字 654ms→2ms）+跨语言金样例契约、validate 端点、paasUserId、functionIdCandidates、reference_step 守卫+truncated、观测 JSONL、source 上传、promotedAt；spec [`specs/2026-09-08-kb-remediation-design.md`](specs/2026-09-08-kb-remediation-design.md)
- **reviewer 验收 + 修复收尾（2026-09-09 DSH reviewer）**：结论 **PASS**（初次 DONE_WITH_CONCERNS → 修复后复验全绿，门禁 ALL GREEN / 五条基线 OK 53·15·11·11·24+5div / lint 68→65 无 error）；修复 F-A 新增 lint warning、F-B 观测落盘隔离（`KB_STAGING_DIR`）+清污（保留 4 条真实 py 召回）、F-C `matchFlowForAtom` 返回 `score`、F-D 金样例 note 事实更正、R-3 py 绊线改「不得有已收敛却仍登记的分歧」、R-4 出处列入 api-docs；报告 [`reports/2026-09-09-kb-remediation-reviewer-verdict.md`](reports/2026-09-09-kb-remediation-reviewer-verdict.md)
- **§6.4 前端派单已落地（2026-09-09 SDD）**：Vue `a1ac7d1`→`587f30c`（per-atom 功能下拉 + `functionIdOverrides` 按行提交）；spec [`2026-09-09-req-draft-wizard-function-candidates-design.md`](specs/2026-09-09-req-draft-wizard-function-candidates-design.md)；待 4097 重启 + product-mgmt 湿测（多行不同功能 overrides）
- **待办：服务器部署**跑三笔新迁移 `20260908231500_req_atom_key_stable` / `20260908233000_req_atom_seq_unique`（遇历史重复会显式报错，人工合并后重跑）/ `20260908235000_req_source_anchor`
- **through-chains 全量 proposeable（2026-09-08 Zcode 连续执行）**：29/29 模块 `canProposeAtoms=true`（P0 customer-corp+rating → P1 两波 25 模块子智能体编队 → credit-retail 补漏 + product-mgmt B-G 链表格化）；每模块机械核对原文 ZJJK 码/「」短语零缺失；接口型/无码模块（limit-ctrl-api/portal/system-mgmt/meeting-mgmt 等）ZJJK 列如实 `—`；业务口径零删减。commit `3c9b5d39`/`17b1cd6d`/`c35f2983`+补漏。规范=[`guides/through-chains-proposeable-format.md`](guides/through-chains-proposeable-format.md)
- **KB 召回评测常态化（2026-09-09 Zcode，方向 3，T0–T3/T5/T6 完成）**：130 条独立标注评测集冻结（62 卡覆盖/盲态复核 0% 分歧）+ `rankFlowCards` 真实排序（`matchFlowForAtom` 语义不变）+ `scripts/kb/recall-eval.mjs` 指标运行器 + PY 一致性 62%；**v1 基线 Acc@1 0.65**（B 层改写 0.23 / D 层短码 0.33 = 算法缺口另立项）；报告 [`reports/2026-09-09-kb-recall-eval-baseline.md`](reports/2026-09-09-kb-recall-eval-baseline.md)。**待办：G1 reviewer 抽检 → G2 Lead 批阈值 → T4 门禁写入 + verify-all 注册**

### ⑧′ 未来方向（下版评审提出 · 下下版开发）

- 已确认交易扫描 → 沉淀原子化操作组件（伙伴可组合）。
- 批量推送改造：改为可直接推送原子化组件（非仅整笔交易）。
- **不纳入本版实现**；需求评审时立项。
- **F-15 湿测证据面错位（2026-09-08 KB 加固线登记，需 Lead 批准另开任务）**：湿测协议禁写操作，而草稿交易原子全是写操作 → blocked 686（35%）、草稿卡晋升率 63/177。拟议：湿测新增判定词 `readonly-partial`（走到最终确认前一步并记录字段/按钮/校验提示），涉及 `scripts/prompts/skills/req-doc-to-kb/SKILL.md`、`scripts/kb/wet-test-check.mjs`、草稿卡 gate 计算与 30 模块语料重跑；spec=`specs/2026-09-08-kb-remediation-design.md` §11 R4。

### ⑤ 引擎主链贯通（最高优先 · 2026-09-06 定调；2026-09-07 更新：R1-R5 PASS，R6/R7 挂起等 SUT 账号支持）

**主链**：客户新增 → 对公评级 → 授信申请 → 审批 → 批复 → 用信 → 合同（对公线）。涉及影像/OCR/文件上传的环节一律绕行（产品裁定 09-05：上传场景搁置，合同止于已保存态待产品排期）。

**能力验收口径（三条，不涉影像/OCR 前提）**：

1. **自主录制**：引擎按 KB 流程卡自主走通环节并经产品管线录制（analyze→create→prepare→record/start→steps 落库）。假成功模式已修（异步终局化门闩）——验收认 `stepCount>0` + 业务 stamp，不认「全 phase_done」。
2. **成功回放**：录制产物经 `replay_actions` 回放通过（R1 已验证 11/12 confirmed）。
3. **LLM 脚本容错**：小页面变化（文案漂移/结构微调）下回放不受影响。

**已完成（2026-09-07 主链跑车，全轨迹 recorded + 业务 stamp 双证；子代理编队 G1-G6，Lead 编排）**：

| 环节 | 轨迹 | 业务证据 |
|------|------|----------|
| R1 客户新增 | 595 | KB主链R1-20260907-0545 落库（26090701521085645），回放 11/12 confirmed |
| R2 对公评级 | 604+607 | PJ20260907016009 重评提交→二次调查（WN0001）→**通过（评级生效）** |
| R3 对公授信 | 605+608 | DGSX20260907056033（100 万/12 月/流动资金贷款分项）→二次调查（WN0001）→**通过** |
| R4 审批 | 606/607/608 | WN0001 账号补建（systemAccountId=26，SUT 统一密码） |
| R5 批复查看 | 613 | DGSXPF20260907020005 要素核对（生效/100 万/关联额度 EDBH20260905080002） |
| R6 用信 | 616+续棒 | **YXPC20260907012045 已生成（待发起）**，98+57 步落库；利率/担保/行政区划三深坑全修（credit_usage 卡 +4 规则 71612302） |

**R6/R7 挂起（2026-09-07 用户拍板暂时搁置）**：

- **阻塞点**：R6 流程提交被服务端拒「下一节点没有可处理的用户，请配置[客户经理]角色的用户！」——`wf_usecredit_001_002` 节点 `nextCandidateRoles=[X0018]`、`nodeSelMode=byLastTask`，测试环境 X0018（客户经理）角色当前无绑定用户（P3-B 时代 YXPC20260905012041 可通，人员配置漂移）。3 种 payload 变体均拒，非客户端可修。**用户已确认：被测系统暂时无法提供账号支持。**
- **恢复条件**：SUT 管理员给 X0018 角色配置用户（建议绑 WN0001/黄亮）。
- **恢复后续接（一棒收尾）**：YXPC20260907012045 待发起单【修改】续做——利率/担保/行政区划已全部维护保存（traj 616 续棒实证，配方 `tmp/kb-mainchain/R6-usage-apply/rate-field-recipe.md`，精华已入 credit_usage 卡 4 条规则 71612302）——只差末步流程提交→选人黄亮→用信审批段（701994/WN0001 交替，配方同 R4）→用信批复核验 → R7 合同签订（批复生效后主合同自动创建，止于已保存态）。
- 附带：R1 建的信贷预客户需完整建档转正才能进评级/授信可选范围（主链前置缺口，见 customer_onboarding 卡 pendingSteps）；T3.1 heal live 验收/P6-4 终验随主链解锁一并做。
- **引擎管线对抗 review 修复（2026-09-10 凌晨，本周收尾）**：09-09 三路对抗 review（[`reports/2026-09-09-engine-pipeline-adversarial-review.md`](reports/2026-09-09-engine-pipeline-adversarial-review.md)）的 **P0-1 runId 桥接 / P0-2 stop 级联 / P0-3 90s 门闩 / P1-4 Python 事件归属**已离线修复+表征（`583ddeb0`/`9eb94716`/`239711cf`，新门禁 `characterize-runid-bridge` 入 verify-all）；P1-5 batch 409 已重归类（`1eecf87`）。**真机湿测未做**——验收三件套见挂起表 `engine-wet-trio`。

### ⑦ KB 流程卡供给（2026-09-06 转向：服务主链，不追全量）

**战役收官底座（2026-09-06）**：30 模块切片 + 湿测 1958 叶（checker 0 FAIL）→ 174 草稿卡 → 63 卡晋升 flows 29→82 → 53 张 pass 卡贯通验证 → SKILL v1→v7 六段协议成文（`scripts/prompts/skills/req-doc-to-kb/`）。

- **落实产物用户面**：需求文档导入/切片 → KB 真实业务流程卡 → 业务/测试人员用本项目功能管理/录制交易（产品契约 `/api/docs`；UI 录制操作手册 [`guides/ui-record-through-line-agent-prompt.md`](guides/ui-record-through-line-agent-prompt.md)）。
- **主链卡最高保真**：主链七环节涉及的卡漂移即修（卡面回写带 traj 证据）；SUT 升级致失效按湿测协议 drift 流程处理（湿测铁证 > 需求原文 > 卡面）。
- **主链外模块卡**：作为资产保留，不追全量补测。
- **按需项（降级，不再单独立期）**：T2 blocked 686+nf148 回收、T1-2批 partial 121 卡晋升——随引擎线跑主链造数据**顺路回收**（台账 [`data/kb/req/_blocked-backlog.md`](../data/kb/req/_blocked-backlog.md) A-D 分类）；主链环节卡优先处理。

### ⑥ 产品管理 KB（挂载收尾完成）

- 五叶子齐：0740 / 0467 / 0468 / **0811 阶段** / **0812 映射**；0230/0231 为 intermediate 目录。
- KB 卡已回写 0811/0812；要素 pageId 空属预期；`product_library` 未动（他线）。
- 菜单线：正式 `systemId=1` 全量 scan 已完成；对公客户管理孪生已合入 json_import（`7`←`1478`）；产品五叶 OK；**activity umlEcd adopt 已落地**（表征 OK；湿测 §4.2 四叶 = 部署迁移 → 再导入 → adopt）；**待办仅剩下周一推送**。

### ① 830 任务收尾：自测 + bug 修复

任务①（截图+坐标）、②（元素分级分区）、③（V3 推送）已全部交付并湿测通过；任务④（报文捞取）已重启，见 ②。剩余：

- 真机自测 + 消费方反馈驱动的 bug 修复。
- **同名弹窗 title 回退歧义**：popupKey（含 anchor）对齐正常；仅控件缺 `popup_level_key` 回退 title 查找时可能挂错实例——**待湿测证据**再定改法。
- **rect 非法值照推**：rect 已改 JSON 字符串并新增 `rect_norm` 归一化（0~1）；`noRectControls` 仅统计可见，是否升级为构建失败待消费方反馈。

### ② 报文捞取 MVP（**已搁置** · 2026-09-08 用户定盘：SUT 无法提供三接口）

- **状态：搁置**。阻塞=被测系统开发人员无法提供三接口（页面元素定义/接口结构定义/日志文件获取）。**可行性已验证**：拿到接口信息即可捞取对应数据——ELK 实测 3 天 2186 条解析 0 失败、saveCustCorporat 命中、有效回填潜力 92%、`el-form-item[prop]` 122/122 全覆盖；字段映射结构化方法与回填评估结论均成立。
- **已落地资产（保留，复活零改造）**：click_button 统一改名（`dfb5c9e`）、elk-msg-extract CLI（`8148f72`/`1fcd1b9`/`b837d67`）、被动捕获框架 Tasks 7-9（`2e359ef6`/`314be568`/`f2cbc9f3`/`7bb59b8c`：api-capture.mjs + network_capture.py 录制时被动监听——**不依赖 SUT 三接口**——+ network_captured→system_ref_data 持久化 + characterize OK 6 入 verify-all）；核验器 `tmp/capture-live-smoke/check-capture.mjs`。
- 触发条件：SUT 排期提供接口后重启此线；届时剩余=非消费型过滤/四边界场景兜底（设计决策）。
- 设计：[报文日志捞取接口设计.md](../报文日志捞取接口设计.md)、[docs/sut-api-request.md](../sut-api-request.md)（可直接发 SUT 团队的三接口请求文档）。

### ③ 菜单切换：推送链路（已收官 · 2026-09-04）

- 已落地：JSON 导入 / 菜单扫描 / 删除拦截 / 执行期导航 / pageId 绑定 / 5.3–5.4 迁移 / removed_flag / 伙伴 `getSystemNodeLevel`+`importData` 真推送 / D1–D5 本仓实现。
- **Q1 推送数据**：同事已确认报文无误——**已完成**。
- **Q2 完成回调**：产品拍板不需平台回调；`importData` 200 即完成——**已完成**。
- **T5 九条规则回归**：`node scripts/characterization/characterize-menu-import-nine-rules.mjs` **18/18 OK**（快照/5.3 迁移/5.4 交易跟随/5.5 改名/新增/5.7 收编/5.8 删保留/5.9 下线 + 推送 menuVersion/归属）。菜单切换本仓联调可交付。
- 可选：P3 名称映射表「扫描自动沉淀」（约 0.5 天）。

### ④ 服务器/运维（O7 · 安全最高优先）

- 阿里云安全组关 3306/6380 对公网（8-31 已备 SSH 隧道脚本 `config/open-db-tunnel.cmd`，启用须改 .env DB_HOST/DB_PORT）；iptables 持久化；删除 recover_your_data 勒索库；排查 crontab/authorized_keys；mysqldump 定时备份 + 异机存储；数据泄露评估。
- 已完成底座（8-28/8-31）：DB 迁移 47.101.58.49 全量覆盖零差异、docker mysql restart=always、root@% 补 GRANT ALL、DB_POOL_MAX=20 + compress 热修。

### ⑤ KB-I5 引擎自主闭环（P1/P2 已达成 · 2026-09-05，转下阶段）——本线已于 2026-09-06 并入上方「⑤ 引擎主链贯通」，历史配方与 P3 明细见 [`research/2026-09-05-engine-closure-phase2-plan.md`](research/2026-09-05-engine-closure-phase2-plan.md)

## 挂起 / 按需（湿测 + 工程债 + 产品残留）

| ID | 优先级 | 项 |
|----|--------|-----|
| **L1-picker-wet** | 挂起 | 多「新增」Vue 选择器冒烟；等执行机 / BiB 重载 |
| **page-state-wet** | 挂起 | dialog/drawer 内/外同文案按钮碰撞湿测 |
| **L1c-wet** | P1 挂起 | `L1C_LLM=1` BiB 湿测低置信区域 |
| **L1c-scan-py** | P1 挂起 | Python scan 接入 `classify` / regions classify（与 L1c-wet 可同刀） |
| **AG-fullpage-wet** | 按需 | 无 label inventory BiB/UI 冒烟 |
| **session-lifecycle-wet** | 挂起 | A attach → streamDetach → B 同 Chrome 409 `grace_owned`；需在线执行机 + 已加载新控制面 |
| **T1r** | 穿插 | tree / replay label 兜底残余 |
| **T3r** | P2 | 活录 CDP 对拍残余 |
| **T4-P4** | P2 | Playwright MCP a11y ⟷ L2 对拍（灰度，非写路径） |
| **L1-vision** | P2+ | 争议容器裁图辅助定角色 |
| **T5** | 暂缓 | 非 `el-table` 自定义网格；需另页证据 · [gap](specs/2026-08-10-t5-credit-scan-gap-design.md) |
| **T9** | 部分 | 产品 `steps/replay` 常态验收（运维） |
| **PR-SSO-ADMIN** | 挂起 | 管理员映射/权限闸等会议结论；阻塞 messages/case-data/screenshots 用户隔离、单条归属校验、「只看我的」UI |
| **PR-EXEC** | 挂起 | 脚本执行（引擎/执行机）；本侧只提供浏览器操作与 actions 设计，暂不排调度产品 |
| **PR-BATCH 小缺口** | P3 | 列表页 batchTaskName 筛选入口、顶栏徽标文案（后端参数已支持） |
| **screenshot-quality** | 前置 | 优化截图功能（用户 2026-09-09：截图仍有问题）；**是 PR-LOC-HL 步骤级高亮的前置** |
| **PR-LOC-HL** | 前端主力 | 步骤级高亮（bbox 画框）本体由前端开发；前置=screenshot-quality 截图优化完成后做；后端待前端推送结构要求后改数据结构（G 阶段内状态组截图已落 `0e1bee0`） |
| **login-retry-heuristic** | P3 | prepare 登录冷启动失败固定等 8s 重试一次（attach-runner.js:197）是启发式非事件驱动，慢环境会误判失败；改事件驱动/指数退避（来源：2026-09-05 会话生命周期梳理 §5.8） |
| **stop-busy-race** | P3 | record/stop 不等 busy（可能 stale）直接发 cancel_step（record-lifecycle.js:321 注释自认）；**2026-09-10 更新：finally 补发已按 runId 归属守卫无害化（9eb94716），独立改造不再另立** |
| **engine-wet-trio** | P1 | 对抗 review 修复真机湿测三件套（代码已备 583ddeb0/9eb94716，验收必须湿测）：①stop→立即重录压测（P0-2 守卫）②detach→重附后 90s 门闩（P0-3 CAS）③双击/批+手并发 start（P1-5 per-tid 内存互斥未做，现仅 batch 409 归类） |
| **p1-6-replayid** | P2 | replay_done 等待无关联：replayId 全链回带过滤 + 超时发 cancel_step（replay-actions.js:47 / rerun-replay-service.js:73），防旧 replay done 误满足新登录等待 |
| **p2-batch-lease** | P3 | BATCH_ITEM_LEASE_MS=600000 恰 10 分钟且录制期无续租；长登录+多阶段可超租→item 被二次 claim 双跑，是否实际发生需湿测 |
| **p2-toast-cursor** | P3 | step_notice toast 游标跨导航不回卷（scripts/agent/step_notice.py:117，`log_len<cursor` 应重置游标+清 `_step_notice_seen`）；**js_snippets 同名副本在 fill/select 热区，同步待他线冷却** |
| **dedup-deletion** | 待裁 | src/dedup.js 生产零引用（唯一 importer=characterize-dedup.mjs 门禁），删除需产品侧湿测确认无去重需求，且 AGENTS.md「Consecutive-only dedup」条目与门禁行须同删 |
| **p2-async-actionlog** | P3 | action_log_sync 每动作全量重发（O(n²)）+ emit_json 同步 stdout，大轨迹管道背压拉长 cancel 窗口（性能项，需真机量测后改增量/限频） |

## 更新记录

> 逐日工作流水已移交 [agent-log.md](agent-log.md)（跨工具共享日志；「开场三件事 / 收工写日志」约定见 AGENTS.md）。本文件只维护工作线与挂起项。
>
> - 2026-09-07 主链跑车 R1-R5 PASS（客户/评级生效/授信通过/批复生效+WN0001 账号解锁，子代理编队 G1-G6，⑤改写为完成矩阵+R6/R7 挂起）；R6 用信三深坑全修后流程提交 BLOCKED@SUT X0018 角色配置——用户拍板暂时搁置，恢复条件与续接步骤已写入 ⑤；DB 直连方案替代 SSH 隧道（隧道不稳=落库延迟真凶）
> - 2026-09-06 晚 重整：用户定调引擎主链贯通为最高优先（⑤改写：主链七环节+三能力验收口径+能力差盘点三待办）；KB 线转向主链流程卡供给（⑦改写），blocked 回收/T1-2批降级按需顺路；控制面+执行端已重启（LMY online）
> - 2026-09-04 菜单切换：Q1 推送数据已确认；Q2 产品拍板不需平台回调，200 成功即完成；联调剩 T5 九条规则测试
> - 2026-08-31 大重整：清出已闭环区段（当前聚焦 830 / 挂起待优化表 / 产品排期区 / 8-17~8-19 排期框架 / 工程债收尾项），新增「当前工作线」四条 + 挂起/按需合并表；CHANGELOG 强制约定废止并从 AGENTS.md 移除
> - 2026-08-13 ~ 08-24 历史逐日记录：`git log -p -- docs/superpowers/todo-list.md`
