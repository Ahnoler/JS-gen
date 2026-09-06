# 主链贯通 P6 计划（能力差盘点 → 分阶段执行）

> 日期：2026-09-06。依据用户定调（todo-list 2026-09-06 重整）：
> **被测系统开发中，主线=引擎跑通真实业务主链**（客户新增→对公评级→授信申请→审批→批复→用信→合同，绕行影像/OCR/文件上传）。
> **能力验收口径（三能力）**：①自主录制（引擎按 KB 卡经产品管线录制，认 stepCount>0+业务 stamp）②成功回放（replay_actions 全链通过）③LLM 脚本容错（小页面变化回放不受影响）。
> 本文=三路只读盘点（KB 资产 / 录制回放链路 / heal-locate 容错层）的汇总与执行计划。**经用户批准后进连续执行。**

---

## 1. 现状矩阵：七环节 × 资产/贯通

| 环节 | 正式卡 | 产品管线贯通（T4 traj） | 引擎存量实证（P3 链B，引擎直驱） | 主要缺口 |
|------|--------|------------------------|--------------------------------|----------|
| 1 客户新增 | ✅ customer_onboarding（traj 515/524）+ customer_query（traj 530） | ✅ 唯一有专属贯通报告的环节 | ✅ KB测客户-20260905-1315（cstNo 26090513160716537） | 基本无 |
| 2 对公评级 | ✅ rating / rating_flow / rating-query-view | ❌ 无 traj | ✅ PJ20260901016003 评级生效（二次调查节点单节点终结） | 叶16「流程提交」wording 未回卡；评级申请卡缺引擎配方 |
| 3 授信申请 | ✅ credit_application（巨奥全链实证） | ❌ 无 traj | ✅ DGSX20260905056032 审批中→通过 | 分项额度 TsscMultiTree 深坑配方已沉淀卡内 3 规则 |
| 4 审批 | ⚠️ 仅通用卡 approval_chain/approval_todo | ❌ 无 traj | ✅ 多节点审批+账号切换配方（701994/WN0001 定人链） | 缺授信链专用卡；湿测 #21-25 blocked（无在途）——引擎跑链即解锁 |
| 5 批复 | ❌ **无专属卡（82 卡中最大空洞）** | ❌ 无 traj | ✅ DGSXPF20260905020004 / DGYXPF202609050016010 自动生成已生效 | 湿测 #38-45 全 match 可直接出卡；作废链 #46-48 blocked 不在主链 |
| 6 用信 | ✅ credit_usage（A6 实证）+ loan-corp 三卡 | ❌ 无 traj（disburse 报告不含 loan.json） | ✅ YXPC20260905012041 通过→用信批复生效 | 叶24-26/30 blocked；引擎配方（利率 set_vue_model/担保三段/$emit 直写）已 +4 规则入卡 |
| 7 合同 | ✅ duigong_contract_sign（A6 ctrSt=3 实证） | ❌ 无 traj | ⚠️ 止于已保存态（担保合同期限缺失；上传封死=产品裁定） | 合同无 wet-test 模块（无逐叶验证）；终态受产品上传排期约束 |

**总评**：卡资产七环节基本齐（唯批复缺卡、审批缺专用卡）；**产品管线贯通只打穿了客户新增一环**，其余六环节卡的背书是引擎直驱实证（tmp 驱动脚本）而非 record/start 轨迹。主链跑通的本质=把引擎配方转成产品管线可录制的任务文案+卡，再逐环节拿三证。

## 2. 三能力现状与能力差

### 能力①自主录制

录制链路已实证可用（53 卡贯通），但有三个产品级缺陷（根因已定位到行）：

| # | 缺陷 | 根因（file:line） | 影响 |
|---|------|------------------|------|
| D1 | **record/start 假成功**：phase 秒级 done、stepCount=0 仍 recorded | Python done 门禁无 contract 时零拒收+自报 success（recorder_emitters.py:757,644）；Node `recordPhaseResult` :673 与收尾 :783 无条件置成功、无 stepCount 门闩 | 长链录制假绿；已建议产品 stepCount 硬校验 |
| D2 | **落库静默丢步**：部分永不落库 | appendRecordedStep `.catch(()=>null)`（trajectory-recording-runner.js:511）+ suppress 窗口丢弃 :574 | 步骤缺失难追责 |
| D3 | **填充校验不对称**：录制 fill 常 `false_ok actual=空` 弱通过 | 录制回读与回放口径不一（replay_form_action.py:84-92 严格） | 金额/日期等表单值落库不可靠→回放必翻车 |

### 能力②成功回放

回放链路可用但脆：

| # | 缺陷 | 现状（file:line） |
|---|------|------------------|
| D4 | **回放内无就地重定位**：定位链穷尽（xpath_smart→xpath_full）即失败 | _replay.py:317；修复完全外包给 Node Type A heal（LLM 单步 agent，重/慢） |
| D5 | **首败即停**：stop_on_fail 恒 true | replay-batch-runner.js:191；七环节长链一断全断（failedStepIds 精确重放已有基础） |
| D6 | heal 成功不回写 locator（confirmed=0） | replay-batch-runner.js:465-475；同址下次回放同失败，容错不累积 |
| D7 | 回放不注入业务数据/门闩，只消费落库 params | 跨环节单据号依赖 prior_outcome 软文本 |

### 能力③LLM 脚本容错

heal-locate 管线**代码+单测全绿**（characterize-heal-locate.mjs 39 断言 + heal-decision 9 断言已入 verify-all 门禁），但：

| # | 缺陷 | 现状 |
|---|------|------|
| D8 | **live 冒烟从未跑**（heal-locate-wet 挂起至今） | 真实浏览器+后端+executor 全链未验收；HEAL_LOCATE_DECISION_ENABLED=1 路由从未线上验证；「Phase 7」五场景（级联隐藏/折叠/Tab/Dialog/缺字段）无 fixture 无 harness |
| D9 | 无「便宜重找→贵的 heal」分级 | 元素找不到直接进 LLM heal，缺先 candidates 重试/semantic_snapshot 重观察的就地层 |
| D10 | 失败分类=纯正则 7 类，无 LLM fallback（P2 预留未做） | missing-reason-analyzer.js:97；新错误串落 unknown→开路由后直接 fail 终结批 |

## 3. P6 分阶段计划

> 原则：**先修路（P6-0）再跑车（P6-2）**；KB 补卡（P6-1）与修路并行；容错（P6-3）在第一轮回放后按真实失败模式接入；终验（P6-4）收官。每环节验收三证=录制 recorded（stepCount>0）+ 回放通过 + 业务 stamp。

### P6-0 产品管线缺陷修复（修路，先做；涉及他线热文件需协调）

| 任务 | 内容 | 验收 |
|------|------|------|
| T0.1 假成功硬门闩（D1） | Node：`recordPhaseResult` 与收尾 finish 前校验该阶段 `_persistDrain` 步数>0（无步数不得 completed/recorded，显式标 `completed-empty` 供前端呈现）；Python：`_guard_done_on_step_end` 无 contract 阶段也校验 `_ACTION_LOG` 增量 | 湿测复现路径回归：空跑阶段不再 recorded；53 卡已有轨迹不受影响；verify-all 绿（注意 characterization pin：改动前查 pin 覆盖） |
| T0.2 落库丢失治理（D2） | `.catch(()=>null)` 改为重试×2+失败计数告警（broadcast 事件）；suppress 窗口改缓冲 | 人为注入 persist 失败：重试生效且日志可见 |
| T0.3 填充校验对称化（D3） | 录制侧 fill 回读对齐回放口径（replay_form_action.py:84-92 双读兜底逻辑移植）；弱通过不再静默落库 | 录制一笔含 fill 的交易：无 `false_ok actual=空` 假绿；回放同值通过 |

⚠️ 协调点：trajectory-record-lifecycle.js / recording-runner-business-data.js 刚被他线 gates 提交（b5399d63）动过——T0.x 开工前与他线确认文件集，或错峰。

### P6-1 主链卡补齐（KB 侧，与 P6-0 并行；走既有湿测/晋升协议）

| 任务 | 内容 | 验收 |
|------|------|------|
| T1.1 批复卡新建 | 从 credit-corp wet-test #38-45（批复查看链全 match）出卡：批复列表→批复查看→分项核对；source 引链B实证单号（DGSXPF20260905020004） | 卡出→晋升 flows；recall 抽样命中 |
| T1.2 审批专用卡 | 授信审批任务页通用流程卡（任务页结构/流程操作选项/意见/流程提交），配方来自 phase2-plan §5-7（评级二次调查=「同意」单节点终结、授信链 001→007、用信链 002/003/004）+ 账号切换（701994/WN0001） | 同上 |
| T1.3 评级卡补配方 | rating.json 补：评级申请→提交→二次调查全链配方（P3.1 实证）；叶16「流程提交」wording 回填 | 卡更新；recall 命中 |
| T1.4 跨环节业务数据结构化（D7 配套） | 每环节卡定义「产出单据号」字段（评级编号/授信号/批复号/用信号），录制时经 businessEntries 结构化传递给下环节任务文案 | 下一环节录制任务文案引用上一环节真实单号成功 |

### P6-2 主链逐环节录制贯通（跑车，P6-0 完成后；每环节一棒）

按链序逐环节走「任务文案（卡步骤+引擎配方+硬性门闩）→ analyze → create → prepare → record/start → stepCount>0 → 回放通过 → 业务 stamp」：

| 棒 | 环节 | 关键配方（已实证） | 预期难点 |
|----|------|--------------------|----------|
| R1 | 客户新增（复验） | traj 515/524 配方 | 低（已贯通，仅复验三证） |
| R2 | 对公评级 | 二次调查「同意」终结配方 | 评级申请表单字段多（或按 rating 卡 6 步） |
| R3 | 授信申请 | 分项额度 crgPdNo 直写+`$emit` 回显+解锁保存；担保=保证+引入保证人 | TsscMultiTree 深坑；向导翻步重置 |
| R4 | 审批 | 账号切换（WN0001↔701994）；懒渲染 8-10s 重进 | 定人链跨账号——record 绑定单账号，需分段录制或多账号衔接方案（开放问题 §5） |
| R5 | 批复 | 批复自动生成；查看链只读 | 无（等 R4 通过即生成） |
| R6 | 用信 | 方案品种命中分项（validLmtSubExist）+四字段回填=正向信号；利率 set_vue_model；有效期 $emit 直写 | 担保持久化三段 |
| R7 | 合同（止于已保存态） | 合同账户双账户 saveCtrAccinf；header 关键词定位分区保存 | 担保合同期限缺失=上传封死前最后一个可推进点 |

编排骨：沿用 T4 手册（guides/ui-record-through-line-agent-prompt.md）：每棒一交易 `KB主链-{环节}-{时刻}`、CDP 19242+slot 补证、证据落 tmp/kb-mainchain/<环节>/、一棒一 commit。

### P6-3 回放容错分级（能力③主线；P6-2 首轮回放后按真实失败模式接入）

| 任务 | 内容 | 验收 |
|------|------|------|
| T3.1 heal-locate live 验收（D8） | 真实浏览器+后端+executor 全链冒烟：主链任一环节人为制造失败（改 xpath 指向失效节点）→ Type A heal 自愈成功；再开 HEAL_LOCATE_DECISION_ENABLED=1 验证 skip/retry/fail 路由 | heal-locate-wet 挂起项关闭；单测+live 双绿 |
| T3.2 就地重定位分级（D9） | 失败步先走「便宜层」：candidates 重试（element.candidates 逐个试）→ semantic_snapshot 重观察+文本锚点重找；都失败才进 LLM heal | 失败步修复耗时/agent 会话数下降；回放通过率不降 |
| T3.3 locator 回写（D6） | heal/重定位成功后更新 step 的 element_json（版本化保留旧值+confirmed 回升） | 同址二次回放不再进 heal |
| T3.4 断点续跑（D5） | stop_on_fail 可配；失败批经 failedStepIds 精确续跑 | 长链中途注入失败→续跑至完成 |
| T3.5（按需）失败分类 LLM fallback（D10） | unknown 类错误串由 LLM 分类补齐（P2 预留实现） | 开路由后 unknown 不再直接终结批 |

### P6-4 全链终验

- 单会话连续主链：R1→R7 全录制 + 全回放 + 三证齐（stamp 链：客户→评级编号→授信号→批复号→用信号→合同 ctrSt）。
- 容错终验：取回放全链，对 1-2 步模拟小页面变化（利用 SUT 开发中的真实漂移或失效 locator 注入），验证 T3 分级容错下回放仍通。
- 产物：主链七环节卡全部带 traj 三证 source；P6 报告+能力差关闭清单。

## 4. 顺序与依赖

```
P6-0 (修路) ──┐
              ├─→ P6-2 R1..R7 (逐环节跑车，串行) ──→ P6-4 终验
P6-1 (补卡) ──┘            ↑
P6-3 T3.1 (heal live) ─────┘ (首轮回放失败后 T3.2-T3.5 按需插棒)
```

粗估：P6-0/P6-1 各 0.5-1d；P6-2 每棒 0.5d（R3/R4 风险棒各 +0.5d 余量）；P6-3 T3.1 0.5d、T3.2-T3.4 各 0.5-1d；P6-4 0.5d。全程约 6-9 个工作日，容错项按真实失败率裁剪。

## 5. 风险与开放问题（需用户拍板/知悉）

1. **R4 审批跨账号**：record 会话绑定单账号，定人链（701994↔WN0001）需「分段录制」或「prepare 换绑账号续录」——建议方案：每账号一段轨迹、用 businessEntries 传单号衔接；是否接受主链轨迹非单条？
2. **他线并行**：T0.x 涉及他线刚提交的热文件（b5399d63 gates 链）；开工前协调文件集或错峰。
3. **合同终点**：止于已保存态（担保合同期限缺失+上传封死=产品裁定）；ctrSt 3→6 待产品排期上传能力。
4. **C 类多角色账号**：若 R4 需要更多角色账号（调查/信审会），需用户提供或确认 WN0001/黄亮可覆盖主链。
5. **SUT 开发中**：页面漂移是常态——这正好是能力③的真实试炼场；漂移导致的卡面失效按 SKILL v7 drift 流程即时回修。
6. **record/start 假成功**：T0.1 本仓修复与「上报产品组」并行推进，口径=本仓先修（等不起产品排期），修复方案同步产品组。

## 6. 盘点信息源

- A 路（KB 资产）：data/kb/flows/*.json（82 卡）、tmp/kb-through/*/through-report.md、data/kb/req/<module>/wet-test.md、data/kb/req/_blocked-backlog.md
- B 路（录制回放链路）：src/routes/v2/trajectory-record.js、src/services/trajectory/trajectory-recording-runner.js（:266 起主循环/:459 action_sync/:654,783 假成功点）、form-snapshot-append.js:28、scripts/session_runner.py:398、scripts/agent/recorder_emitters.py:757、src/services/trajectory/replay-batch-runner.js、scripts/controller/actions/_replay.py、specs/2026-09-05-engine-actions-contract.md
- C 路（heal-locate）：src/services/trajectory/missing-reason-analyzer.js、heal-contract.js、heal-decision.js、replay-heal-shared.js、form-structure-heal.js、scripts/prompts/agent-tools-heal.md、characterize-heal-locate.mjs（39 断言）、docs/superpowers/archive/plans/2026-08-15-heal-locate-handoff-plan.md
- 引擎存量实证：research/2026-09-05-engine-closure-phase2-plan.md（链B 全通：客户→评级→授信→批复→用信→用信批复；合同已保存态）
