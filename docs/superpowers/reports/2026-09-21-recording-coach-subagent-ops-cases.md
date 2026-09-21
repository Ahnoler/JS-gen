# Recording-coach 操作员执行经验案例卡（合约湿测线抽取，v1）

> 依据：Cursor / recording-coach skill 线委托（skill 已定位为「跑湿测的操作员 subagent」，本卡只抽**执行面**经验——主会话怎么派、操作员怎么跑、哪类失败该停/该改 task/该移交引擎）
> 抽取方：ZCode 合约湿测线　|　抽取日：2026-09-21
> 数据源：`docs/superpowers/agent-log.md` 全部 wet 条目原文（git 历史逐条核验）+ `tmp/contract-wet*-*` 证据目录 + 蒸馏稿 `guides/2026-09-19-recording-coach-skill-draft.md`（65d1dc5e）
> 姊妹篇：analyze 粒度标准另案交付——`reports/2026-09-20-analyze-phase-granularity-cases.md`（12 卡），`accept_phases` 前粒度速查直接回链该文，本文不重复
> 卡片数：13（诚实拒绝 3 / task 改写重试 2 / 假报告识破 2 / 管线坑 3 / 收尾契约 1 / 顺利 keep 2；其中 engine-side 2 张）

---

## 0. 文首总结：操作员反复踩的坑 / 主会话派发最小必备项

1. **前置数据没核就开单是最贵的失败**（wet8 一晚三单全被 SUT 硬前置拒）。派发前主会话必须派**只读核查员**查证业务前置（评级生效态、在途授信、客户池），不信记忆、不信上单结论——上单的"已生效"判断可能把别人的评级记到自己客户头上（#892 实证）。
2. **任务文本的可执行性比粒度更常成为卡点**：agent 违反预埋门闩的形态是「惯性替代」——点「确 定」而真实按钮是「保存」（#904 二连）、用 real_click 绕过 fill_form_field（#904 对照在册）。对策不是加提醒，是**点名确切按钮文本 + 每阶段落库核验判据**（#909 起生效，#924 全过）。
3. **操作员对业务规则无裁决权**：前置不满足/关联未成功时，结论只能是 REJECTED_/NOT-ADJUDICATED+证据，不得自判「另有其他条件」或「已排除」（#910 P7 越权自判被主线程纠正）。
4. **操作员单方观察不可作定谳**：「弹窗无 footer 提交按钮」被 Playwright 人工调研证伪（按钮一直在，是采集链遮挡漏采，pdiag 定谳 B）——结论前必须有选择器级证据或双路复核。
5. **服务端拒绝是合法终局不是重试信号**：REJECTED_ 后循环重试只会堆流水号（#895/#896 各 6+ 次硬拒）；任务书须写明「拒绝 N 次即如实收口」+「禁删除类探针」（#896 红线教训）。
6. **外部故障要能认出来并移交**：SUT 503 页面上 agent 会空转 30min+（落重复步、phase done_logs 空）——值守看到「重复步循环 + 判据永不可满足」应停手报 `BLOCKED_外部故障`，止损归引擎（D2 守卫 0cbcbd35 已落地，默认 off）。
7. **管线坑集中在契约与留痕**：phaseIds 传 UUID 必 400（必须数据库数字 id）；record/start 是同步长连（curl 超时 ≠ 失败，先查状态勿重复 POST——#971 实证）；detach 后 agent-stderr API 即清空，executor 日志要事后直读文件（引擎 worktree `tmp/executor-main.log`，重启即轮转）。
8. **主会话派发最小必备项**（缺一即返工）：自包含任务书五段式（固定参数含**阶段数字 id**/业务目标/风险预告+诚实失败纪律/管线步骤/结论枚举）+ 每阶段一个落库判据 + 禁区清单（禁提交/禁删除探针/fill 尝试上限）+ 证据目录约定 + 「主线程独立复核、不采信操作员单方回报」。
9. **顺利单的共同点**：任务模板沿用已验证的（#971 直接复用 #970 同款 7 阶段 + 门闩原文），操作员零纠偏跑通；首次成功轨迹 #924 靠的是三道预埋门闩全部按设计生效。
10. **engine-workaround 不得沉淀为 coach 铁律**（沿用粒度报告纪律）：已修复缺陷的规避手法标 `engine-side`，skill 里最多留一行「该规避已不需要」。

---

## 1. 案例卡

### 卡 1 `wet8-892-preflight-miss` — 前置摸底错误 → REJECTED 诚实收口 + 只读核查员纠错

| 字段 | 内容 |
|---|---|
| `scene` | 授信申请链湿测第一单（瑞云智联），开工前置摸底判断「评级已生效」 |
| `trajId` / 证据 | 892 / `tmp/contract-wet8-20260919/` + agent-log 2026-09-19（commit d04f6b34） |
| `dispatchShape` | 主会话带 reference.md 前置摸底结论开单（用户已授权「前置缺则自行开单补录」）；摸底本身**错了**——PJ20260907016009 是贯通验证企业的评级，不是瑞云的 |
| `opType` | `诚实拒绝收口` |
| `whatWorked` | 操作员遇服务端硬拒「查询不到客户有效评级，客户编号：26081714051504629」照实 REJECTED_ 收口，拒绝原文+流水号完整落库——正是这个诚实终局暴露了摸底错误 |
| `whatFailed` | 主会话前置摸底采信了错误归属的评级记录，未先派只读核查员验证；一单白跑 |
| `skillHint` | 操作员遇「前置不满足」类服务端拒绝：①照抄拒绝原文+全局流水号 ②结论 `REJECTED_<原因>` ③**不得据此改写业务判断**——「摸底说生效但服务端说没有」是主会话的问题，操作员只交证据。主会话侧：开单前派只读核查员（零录制，只查 DB/API）核前置，不采信记忆 |
| `skillWorthy` | `yes` |

### 卡 2 `wet8-895-896-reject-loop` — 服务端 6+ 次硬拒仍循环重试 → 流水号堆栈（浪费型诚实失败）

| 字段 | 内容 |
|---|---|
| `scene` | MBP/银嘉两单授信申请，客户存在在途授信（DGSX20260817056014 / DGSX20260813056010） |
| `trajId` / 证据 | 895、896 / `tmp/contract-wet8-20260919/` + agent-log 2026-09-19 |
| `dispatchShape` | 任务书有 KB 卡预警（在途授信校验）+ 诚实失败纪律，但**没写「拒绝几次后停止重试」**——agent 在同一提交点被拒 6+ 次仍按阶段流程走，各堆 6/9 个全局流水号 |
| `opType` | `诚实拒绝收口`（含浪费） |
| `whatWorked` | 拒绝原文逐次落库（doneLogs 完整保留）、无伪造成功、无脏数据——证据面无可挑剔 |
| `whatFailed` | 同一拒绝重复撞 6 次：拒绝语义在任务书里是「记录」，agent 却当成「可重试的暂时失败」；多耗几分钟且流水号噪音干扰复核 |
| `skillHint` | 任务书模板补一条：**确定性业务拒绝（文案含「已存在/在途/无有效评级」类）最多重试 1 次**（排除偶发），第 2 次即 blocked 收口并引用两次原文；操作员遇同文案重复拒绝应主动提前收口，不等阶段跑完 |
| `skillWorthy` | `yes` |

### 卡 3 `wet8-896-delete-probe-redline` — 代理顺手做 deleteApply 前端探针 → 贴红线（禁区清单增补的由来）

| 字段 | 内容 |
|---|---|
| `scene` | 银嘉单录制中，agent 自行对既有在途授信记录做 deleteApply 前端探针 |
| `trajId` / 证据 | 896 / agent-log 2026-09-19（commit d04f6b34 节录） |
| `dispatchShape` | 禁区清单当时只列「禁影像上传/禁用信合同模块/禁撤销修改既有记录」，**未列删除类探针** |
| `opType` | `preflight拦`（事后形态——主会话复核识破并增补禁区） |
| `whatWorked` | 探针返回 false、无网络请求、既有记录未动——无实害；主线程复核发现后即刻定性「合规但贴红线」 |
| `whatFailed` | 操作员在诚实失败后自行「多做一步验证」，超出了任务书授权面——录制单不是探索单 |
| `skillHint` | 禁区清单固定含**「禁删除类探针（含前端预检类）」**：录制单的验证面=任务书写明的判据，未写的一律不做；操作员发现可疑路径想验证 → 写进回报，不执行 |
| `skillWorthy` | `yes` |

### 卡 4 `wet9-904-latch-violation` — agent 违反预埋门闩（点「确 定」/real_click 绕 fill）→ 点名按钮 + 落库核验判据后根治

| 字段 | 内容 |
|---|---|
| `scene` | B3 解锁裁决重试单：分类/产品表单提交与序号填写 |
| `trajId` / 证据 | 904（#903 同款二连）/ `tmp/contract-wet9-20260919/wet9b3r/` + agent-log 2026-09-19 19:45 |
| `dispatchShape` | 任务文本写「保存/确定兼容」——agent 误读为任选，惯性点「确 定」（真实按钮=保存[47]）静默未提交；序号用 real_click×3 绕过 fill_form_field（同单对分类同名字段 fill 成功=对照在册） |
| `opType` | `task改写重试` |
| `whatWorked` | 主线程复盘定位为**任务文本可执行性缺陷**（非引擎/非 agent 品质）：下一单（#909）taskText 改为**点名每表单确切按钮「保存」+ 每阶段落库核验判据（doneLog 必须区分已落库/未落库）**——首次生效，分类落库成功（PD00044278） |
| `whatFailed` | 「兼容措辞」给了 agent 选择权=给了犯错的自由；静默失败（无 toast）+ 落库核验缺失使错误跨阶段存活 |
| `skillHint` | 任务书两铁律：①提交类操作**点名页面真实按钮文本**（调研过就写确切名），禁止「保存/确定任一」式兼容措辞；②每阶段预期结果写**落库级判据**（「复查编号 X 出现/共 0 条」），不写「操作成功」这类页面级模糊判据 |
| `skillWorthy` | `yes` |

### 卡 5 `wet9-909-910-phase-split-dodge` — fill 去重缺陷的拆阶段规避（缺陷期 workaround，已修复）

| 字段 | 内容 |
|---|---|
| `scene` | 同阶段两个弹窗出现同 label 字段（分类/产品各有「序号」），第二个 fill 被去重吞（`err-pending-fields:['序号']`） |
| `trajId` / 证据 | 909→910（#917 第三例收口）/ agent-log 2026-09-19~20 |
| `dispatchShape` | 主会话把分类 P4 / 产品 P5 拆成独立阶段规避 |
| `opType` | `task改写重试`（workaround） |
| `whatWorked` | 规避有效（#910 P4/P5 序号 fill 均有步、err-pending-fields 0 次），为裁决推进买到窗口 |
| `whatFailed` | ——（作为 workaround 无失败；失败在「它差点被写成模板」） |
| `skillHint` | **无**——该缺陷已由 cee623e1 根修（搜索族豁免 + persist 串行化 + 快照占用回退），#924 三项验收全过，**拆阶段规避已不需要，勿再写进任务模板** |
| `skillWorthy` | `no-oneoff`（engine-side：缺陷已修，规避纪律作废；教训=「规避手法要跟缺陷生命周期走，修复落地后主动退役」） |

### 卡 6 `wet9-910-overreach-adjudication` — agent 越权自判业务规则 → 主线程纠正 NOT-ADJUDICATED

| 字段 | 内容 |
|---|---|
| `scene` | B3 第四试：关联未提交成功，agent 在 P7 自行下结论「前置另有其他条件」 |
| `trajId` / 证据 | 910 / `tmp/contract-wet9-20260919/wet9b3t/` + agent-log 2026-09-20 10:40 |
| `dispatchShape` | 任务书有裁决前置声明，但未覆盖「观察不到前置成立时怎么下结论」 |
| `opType` | `假成功识破`（反向：假结论识破） |
| `whatWorked` | 主线程复核落库证据后纠正：关联未成功、关联后状态从未被观察 → 裁决 NOT-ADJUDICATED（非「另有条件」）；后经 pdiag 人工辅助定谳，实际前置=「已关联产品阶段」成立 |
| `whatFailed` | 操作员把「我方未观察到」升格成「SUT 规则如此」——从证据直接跳到裁决，超出操作员权限 |
| `skillHint` | 结论枚举补一条：**凡任务书要求「裁决/验证 X」而 X 未被观察到，结论只能是 `NOT-ADJUDICATED_<断点>`**，禁止反推「X 不成立/另有条件」；操作员职责止于断点取证（拿到了什么、缺什么、断在哪一步） |
| `skillWorthy` | `yes` |

### 卡 7 `wet9-pdiag-footer-miss` — 操作员「无 footer 按钮」报告被证伪（采集链遮挡）→ 双路调研定谳

| 字段 | 内容 |
|---|---|
| `scene` | #910 断点「选择阶段弹窗无 footer 提交按钮」——需定谳 SUT 结构 vs 引擎枚举受限 |
| `trajId` / 证据 | 910 + pdiag / `tmp/contract-wet9-20260920-pdiag/pdiag-report.md` + agent-log 2026-09-20 12:10 |
| `dispatchShape` | 主会话派双子智能体并行页面调研（Playwright 直连，非录制 agent），选择器级取证 |
| `opType` | `假成功识破`（假断点识破） |
| `whatWorked` | 定谳 B：footer「取 消/确 定」自始至终存在可见（选择器在案），#910 报告不成立——机理=采集链 browser_use 0.1.48 的 isTopElement 被 tree-popover 遮挡误判，不分配 index；**agent 侧逃生门实证**：click_save("确 定") 文本直查不吃 index 遮挡亏 |
| `whatFailed` | 录制 agent 的单方观察（「无按钮」）被当成了事实进入移交——若直接按该结论去改引擎/SUT 就白干 |
| `skillHint` | 操作员对「页面缺某控件」类断言必须降级措辞：写「**枚举未见**（index 未分配）」而非「不存在」，并附当步 inventory 快照；涉及断点定谳 → 升级 Playwright 页面调研（取证员变体），不靠录制链自证 |
| `skillWorthy` | `yes` |

### 卡 8 `wet9-925-sut-503-spin` — SUT 503 页面 agent 空转 31 分钟 → 外部故障识别与移交

| 字段 | 内容 |
|---|---|
| `scene` | OpenCode 线录制中 SUT 返回 503 错误页，agent 在「选客户」循环空转（phase3 步 6=9、7=10 参数级重复两轮） |
| `trajId` / 证据 | 925 / 系统线验证报告（agent-log 2026-09-21 10:00，c01f7952）+ `docs/superpowers/specs/2026-09-20-d2-sut-503-spin-guard-design.md` |
| `dispatchShape` | 值守轮询当时只看 recordStatus/steps 计数——步数在涨，无人识别「重复步 + 判据永不可满足」 |
| `opType` | `移交引擎` |
| `whatWorked` | 事后 DB 只读取证三层实锤（空转跨度/重复步/页面级 503 原文落 done_logs）；归属裁决引擎线；D2 守卫已落地（`_guard_spin_on_step_end` 双条件：不可达信号 × 6 步无进展，0cbcbd35，默认 off） |
| `whatFailed` | 503 错误页上 DOM 点击仍返回 `ok-clicked` 落库 → idle watchdog 被持续喂饱 → 10min 门永不触发；值守无「业务进展」判据，浪费 31 分钟 |
| `skillHint` | 值守判据加一条（守卫 off 时仍适用）：**同一 action 参数级重复出现 ≥2 轮且当前阶段 done_logs 空 → 视为疑似外部故障，立即 detach 止损**，结论 `BLOCKED_外部故障_SUT`，证据（页面文本/重复步对照）交主会话移交引擎；不要等 max_steps 自然兜底 |
| `skillWorthy` | `engine-side`（止损语义引擎 D2 守卫已实现；coach 只需保留「识别+移交」提示，勿复制守卫逻辑） |

### 卡 9 `wet7-891-phaseids-uuid-400` — record/start phaseIds 传 UUID 必 400 + 同步长连超时 ≠ 失败

| 字段 | 内容 |
|---|---|
| `scene` | wet7 首单启动录制：phaseIds 契约踩坑（子智能体首试 400）；后续 #971 又踩同端点超时误判 |
| `trajId` / 证据 | 891 / `tmp/contract-wet7-20260919/`（engine 缺口移交③）+ 971 `tmp/contract-wet9-20260919/wet-unboundlocal/traj-now.json` |
| `dispatchShape` | 任务书写了「阶段数字 id 数组（不是 UUID）」，操作员首试仍传了 UUID |
| `opType` | `槽位/CDP坑` |
| `whatWorked` | 纠正为 DB 数字 id（trajectory_phase.id）后 200；#971 复核补充：record/start curl -m 30 超时但录制实际已触发，GET 轨迹状态确认 recording 中——**超时≠失败，勿重复 POST**（重复 start 会撞 busy） |
| `whatFailed` | 两处都是 API 契约靠踩坑习得：UUID/数字 id、同步长连阻塞（#970 时 340s） |
| `skillHint` | 管线写死三条：①phaseIds=`GET /trajectories/:id` 返回的 phases[].id（**数字**）②record/prepare 与 record/start 超时都设 ≥600s，curl 超时后**先 GET 轨迹状态**再决定是否重发 ③建单端点=`POST /api/v2/trajectories`（无 /create 后缀） |
| `skillWorthy` | `yes` |

### 卡 10 `wet-970-971-stderr-after-detach` — detach 后 stderr API 清空 + executor 日志轮转 → 证据要在对的时间抓

| 字段 | 内容 |
|---|---|
| `scene` | #970 收尾 executor 日志取证成功（行号锚定）；#971 同法复用时 agent-stderr API 返回空 |
| `trajId` / 证据 | 970/971 / `wet-tssc/executor-log-tssc-signatures.txt` vs `wet-unboundlocal/stderr-971.json`（空）+ `executor-log-signatures.txt`（直读文件 286 行） |
| `dispatchShape` | 收尾契约只写「executor 日志取证」，未写**从哪取、什么时点取** |
| `opType` | `收尾契约` |
| `whatWorked` | #970：detach 前留活跃目标，经 `/api/v2/recording/agent-stderr?trajectoryId=` 拿到全量再签名扫描；#971：发现 API 空（session 已清）后果断改直读引擎 worktree `tmp/executor-main.log` 全文（重启后日志轮转，全文即本单新增段） |
| `whatFailed` | 同一取证动作两种可达路径，任务书没写清时操作员要走弯路；日志轮转使「行号相对 #970 基线」的锚定失效，须换「全文即新增段」口径 |
| `skillHint` | 收尾契约写死取证顺序：①**detach 前**抓 `GET /recording/agent-stderr?trajectoryId=<id>`（活跃期可达）②detach 后 fallback=直读 `D:\dev\JS-gen-engine\tmp\executor-main.log`，以 sid 过滤本会话行；③扫描输出必须带行号+时间界标记，供他线复核 |
| `skillWorthy` | `yes` |

### 卡 11 `wet9-902-903-tree-blind-misjudge` — 树搜索失灵当轮误判「未落库」→ 树恢复后复验翻案

| 字段 | 内容 |
|---|---|
| `scene` | wet9B2/B3 两单树搜索不过滤生效，操作员判断「产品未落库」并自领清理 |
| `trajId` / 证据 | 902/903/904 + 清理单 / `tmp/contract-wet9-20260920-cleanup/` + agent-log 2026-09-20 17:50 |
| `dispatchShape` | 收尾判据依赖树内重搜核验——核验工具本身坏的时候结论跟着坏 |
| `opType` | `假成功识破`（假失败识破） |
| `whatWorked` | 清理单以登录态复刻请求逐节点核验，发现 **PD00044274/76 实为已建**（当轮误判「未落库」）；教训即时沉淀：「树失灵当轮结论须在树恢复后复验」 |
| `whatFailed` | 当轮「清理成立 SUT 零残留」结论错误；若残留族没被后续清理单兜住，会成为幽灵数据 |
| `skillHint` | 核验手段与结论解耦：**当某核验通道（树搜索/列表筛选）当轮已知失灵，基于它的「未发生/已删净」结论一律降级为 `UNVERIFIED_<原因>`**，登记待复验；唯一可信核验=DB 直查或绕开故障面的第二通道 |
| `skillWorthy` | `yes` |

### 卡 12 `wet9-924-latch-trio-keep` — 三道预埋门闩全生效 → wet9 首条成功轨迹（正例）

| 字段 | 内容 |
|---|---|
| `scene` | 第六单：残留清理 + 三项引擎修复验收（gaps 归零/无双行/搜索族重填） |
| `trajId` / 证据 | 924 / `tmp/contract-wet9-20260919/wet9sixth/` + agent-log 2026-09-20 16:10 |
| `dispatchShape` | 主会话 brief：卡 4 教训全吸收（点名「保存」+ 落库核验判据）+ 同阶段重搜三连按粒度卡合段 + 残留清单逐项列名（W/U/T/V）+ 无提交动作门闩 |
| `opType` | `keep顺利` |
| `whatWorked` | 操作员零纠偏跑通：51 步 1..51 连续、三项验收全过、**wet9 系列首条 record_status=recorded / is_successful=1**；自造对象自清（wet9B3W/阶段W 删净） |
| `whatFailed` | —（小瑕疵：step_count=47 vs 51 行系计数器滞后一拍，属引擎口径非操作员问题） |
| `skillHint` | 这是卡 4 skillHint 的正例锚点：**「点名确切按钮 + 落库级判据 + 显式残留清单 + 无提交门闩」四件套齐备的单，操作员无需临场判断**——brief 写得好的标志是操作员没有自由发挥的空间 |
| `skillWorthy` | `yes` |

### 卡 13 `wet9-971-template-reuse-keep` — 沿用已验证任务模板 → 零纠偏一次跑通（复用纪律正例）

| 字段 | 内容 |
|---|---|
| `scene` | unboundlocal-retest：#970 P2 弹窗【查询】点击路径复测（验收单） |
| `trajId` / 证据 | 971 / `tmp/contract-wet9-20260919/through-report-unboundlocal.md` + agent-log 2026-09-21 11:55 |
| `dispatchShape` | 主会话**逐字沿用 #970 同款 7 阶段任务模板**（fid/账号/门闩三件套不变），仅加一条本单特化门闩「各查询环节必须实际点击【查询】不得绕过」；单变量改动=任务名，保证与 #970 可比 |
| `opType` | `keep顺利` |
| `whatWorked` | prepare 28s、预检两拍 0 弹窗、录制 4.5min、终态 recorded/is_successful=1（优于 #970 的 failed）——从建单到 detach 全程无一处临场改任务 |
| `whatFailed` | —（经验面零失败；顺带产出：天元弹窗两单一现一不现=间歇性，反哺 OpenCode 假设） |
| `skillHint` | **验收复测类任务优先复用原单模板**（只加特化门闩、改名单变量）：模板已被上一单验证过，操作员行为可比对、结论可信度更高；新写任务书的返工率显著高于复用（wet8 三单 vs #924/#971） |
| `skillWorthy` | `yes` |

---

## 2. skillWorthy 分栏汇总（供 Cursor 直取）

| 分栏 | 卡 |
|---|---|
| `yes`（进 skill） | 卡 1（只读核查员前置）、卡 2（确定性拒绝限重试）、卡 3（禁删除探针）、卡 4（点名按钮+落库判据）、卡 6（NOT-ADJUDICATED 结论纪律）、卡 7（断言降级措辞+取证员升级）、卡 9（API 契约三条）、卡 10（取证时点顺序）、卡 11（核验解耦 UNVERIFIED）、卡 12（四件套正例）、卡 13（模板复用纪律） |
| `no-oneoff` | 卡 5（拆阶段规避——缺陷已修，规避作废，只留「跟生命周期退役」教训） |
| `engine-side` | 卡 8（503 止损=D2 守卫 0cbcbd35 已落地，coach 保留识别+移交提示即可） |

## 3. 与既有资产的关系

- **粒度面**（accept_phases 前速查、合/拆规则、`no-workaround` 纪律）：见 `reports/2026-09-20-analyze-phase-granularity-cases.md`，本文不重复；本文卡 5 是该纪律在执行面的对应物。
- **管线七步/五段式/变体**：蒸馏稿 `guides/2026-09-19-recording-coach-skill-draft.md`（65d1dc5e）仍是骨架底稿；本文卡 9/10 对其 §3 表格补了三处坑位（phaseIds 契约细节、record/start 超时语义、stderr 取证时点），可直接并表。
- **经验二律背反提醒**：本报告与粒度报告同为「案例卡」，卡面是**当时为真**的操作事实；引擎修复持续落地（tssc 收口 8d131f72、UnboundLocal 热修 251c461b、D2 守卫 0cbcbd35），凡标注 `engine-side`/`no-oneoff` 的条目在引用前先核对缺陷是否仍处未修态。
