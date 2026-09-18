# 阶段合约冲突普查与 LLM 置信评估（2026-09-18）

工作线：`fix/phase-contract-20260918`（worktree `D:\dev\JS-gen-contract`）。缘起 = 2026-09-17 评级重置阶段 done 死循环（`classify.py` 误判已修 `c14d1c1f`/`2c94434b`）；本文为该案的同族普查结论 + LLM 置信路线评估，供后续合约演进引用。

## 1. 死循环统一机理

阶段开始时 `compile_boundary`（`scripts/controller/actions/phase/boundary_contract.py:106`）**一次性**签出合同（role + success_when 证据令牌）→ 若签出「该阶段流程中产不出的令牌」，则每次 done 都被 `_guard_done_reject_missing_token`（`scripts/agent/recorder_emitters.py:696`）拒绝并改写全部历史结果（`r.is_done=False` + recovery 指引），agent 被指引带着绕圈 → 步数耗尽进 budget-extend（≤2 轮，`reviewer.py:521`）→ 继续被拒 → 阶段终局失败。

关键不对称：判定错在**阶段开始的一次编译**，之后每次 done 拒绝都在放大同一错误；done 门禁只读 `_phase_boundary`（`boundary_gates.py:62`），done 被拒不会重跑 classify。

## 2. 冲突普查表

| # | 文本形态 | 命中路径 | 编译结果 | 令牌可产出性 | 后果 |
|---|---|---|---|---|---|
| C1 | 重置文本含名词「查询条件」（已修） | `is_query_task` L182-210 | 旧：query→`['query_clicked']` | 重置永不点查询 | **已修**（四分类矩阵 + pin） |
| S1 | 「新增/录入 + 查询条件」无 CRUD 排除词 | 条件路径 classify.py:200 **先于** `_QUERY_EXCLUDE_RE` 生效；`_QUERY_CONDITION_HARD_EXCLUDE_RE`（L33）缺 新增/录入/维护 | query→query_clicked | 视流程 | 疑似死循环 |
| S2 | 「点击【更多】按钮。预期结果：查询条件字段展开。」（`src/services/trajectory/trajectory-meta-service.js:242` **真实 few-shot 文本**） | 含 查询+查询条件 → query | query→query_clicked | 只点「更多」，无查询钮页面永不满足 | 疑似死循环（必复发） |
| S2b | 导航文本含查询词：「打开查询中心页面。预期结果：抵达查询中心页面」 | query 分支先于 open_page（boundary_contract.py:131/139） | query→query_clicked | 菜单导航不点查询 | 死循环 |
| S3 | 「维护客户信息：查询定位后修改」 | `_QUERY_EXCLUDE_RE`（L29）缺 维护/更新/变更；`is_modify_task` 被 `is_query_task` 先否决（L226） | query→query_clicked | 从菜单直进详情的维护不点查询 | 死循环 |
| S4 | 「点击【上一步】…」 | `_WIZARD_NAV_RE`（L38）含上一步 → navigate(click_next) | `['nav_next_clicked','url_change','page_opened']` | `_NEXT_BTN_RE`（boundary_gates.py:207）只认 下一步/继续/下一步骤；无 URL/新 overlay 变化 | 死循环 |
| S5 | 经 `click_button`（非 index）点「查询」 | — | query→query_clicked | `maybe_record_click_completion_evidence` 仅挂 index 路径（click_action_engine.py:640），click_button 不记 boundary 证据 | 软死循环（耗步数后经 index 补点解除） |
| R1-R5 | 保存后进列表页 / 纯「筛选」无查询词 / 提交审批 / open-page 入口兜底 / 别名膨胀 | — | other 免令牌 / 令牌放宽 | — | **假绿窗口**（放松方向，非死循环，本批不修，留档） |

放松向 R 清单（后续专项候选）：R1 保存后进列表页落 other（pin cold:266 故意如此）；R2 纯筛选无 查询/搜索/查找 词（prompts.py:179 只加提示不进门禁）；R3 提交审批落 other；R4 open-page 入口点击兜底记 page_opened（recorder_emitters.py:310）；R5 `dialog_close`/`confirm_click` 别名膨胀 + `_last_save_ok` 镜像膨胀。

## 3. LLM 置信评估：伪需求 vs 真需求

**结论：新增独立 LLM 置信通道 = 伪需求；补全既有 LLM 判定的仲裁接线 = 真需求。**

事实基础：
1. **LLM 判定已在同点同频存在**——Phase Reviewer 每阶段判定一次（`reviewer.py:479`，20s 上限）。重置事故日志铁证：LLM 判对（`mode=other, success.kinds=[]`），门禁听信规则编译器（`success_when=['query_clicked']`）。
2. **仲裁盲区的确切位置**——`intent_contract.py:324` 的「信 LLM」分支只覆盖 mode∈{navigate,query} 与规则不一致；mode='other'（sanitize 后 kinds=[]）是盲区，boundary 原样保留规则误判产物。这正是事故形态。
3. **LLM 自身有双向错例史**——曾发明不可产出令牌（sid 4460cf2a，`sanitize_contract_for_mode` 为此设防）、曾误判保存类文本为 navigate/query（d3943e89，`promote_contract_for_save_cues` 为此设反向护栏）。置信分数不消除错误只转移错误；两个方向护栏已存在，缺的只是「LLM 对、规则错」的 query/other 降级方向。
4. **网关不稳**——8.6% 会话走 fallback（agent-stderr 统计），挂起形态多样；done 门禁点串行加 LLM 调用直接消耗 10 分钟 idle 看门狗预算（LLM 调用期间无 action_log_sync 事件）。
5. **频率对比**——编译点纠正一次（1 次 LLM，复用 reviewer 通道零新增）vs 门禁点纠正（≥拒绝次数次 LLM）。事故全部发生在「合同已编译错」，编译点是对的干预点。

**LLM 判对时如何被压制的历史理由**（`service.py:263-275` 注释）：LLM 曾漏给 nav 证据 kinds（sid 64c9044b）且偶发自造 token，故规则编译器被定为 canonical shape。本批不改 canonical 地位，只补一个窄口仲裁：**mode='other' 且规则签出严格合同时信 LLM 降级 + 留痕**。

未来可选（留档不实施）：DOM 感知的「令牌可产出性」判定——当熔断日志大量出现「LLM 判对但页面真无查询钮」形态时再立项（对照 memory 优先 JS-gen 侧逻辑原则：先穷尽 DOM 运行时证据，不提 SUT 增强）。

## 4. 本批实施（已批准）

- 批A：classify.py S1/S2/S2b/S3 + 动作子句轴（按「预期结果」切分，名词性查询词不再充分）+ RED→GREEN pin 扩充。
- 批B：boundary_gates.py `_NEXT_BTN_RE` 扩上一步；click_button 接取证；新 pin。
- 批C：intent_contract.py 仲裁补全（mode='other' 降级方向 + stderr 留痕 `source='llm+arbitrated'`）；done 熔断（同 missing 集≥3 次 → `contract_suspect` 放行 + 审计，其余守卫不动）；boundary_contract.py:276 `or ['query_clicked']` 兜底收敛。

## 5. 验收口径

worktree 干净基线（3 红：step-highlight / layer-tree / confirm-notification）→ 三批改后全量 verify-all 3 红零新增 → 合并回 uara_V1.2 合并态重跑（AGENTS.md 硬约定）→ 控制面重启生效 → 真机复跑对公客户评级三阶段批次验证阶段 3 done 一次放行。
