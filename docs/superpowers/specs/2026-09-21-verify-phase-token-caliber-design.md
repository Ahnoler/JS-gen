# 核验型阶段 token 口径设计（verify-phase-token，P2 候选）

- 状态：**草案（待评审，纯设计零代码）** · 2026-09-21 · 引擎线
- 来源：合约线移交（2026-09-21 回执，校准对 #973 阳性 / #924 对照）+ 本单元 Explore 调研（契约生成链全链 file:line 见 §3）
- 红线：**判定式冻结并经评审前，禁止盘点历史轨迹集反推措辞**（防反向拟合，todo 行既有纪律）；v3 假成功防线（宁误拒不假绿）不可开后门

## 1. 问题定义

核验型阶段（重搜确认已删对象不存在、无保存动作、doneLog 完整）被误杀：合约带 `submit.required=true`（或 boundary `success_when` 非空）→ 收尾门 `service.py:724-729` 判 `missing_success_token` → `quality_failed`。该类阶段不可能产出 toast/url_change 令牌——要求即误杀。

对照 #924：同配方但阶段含删除动作 → 有真实契约终态（recorded），不误杀。**差异变量 = 阶段是否包含写动作/保存意图**。

## 2. 机械判定式（草案 v1）

**判「核验型」= 同时满足以下四条（全为机械可判，输入=阶段 task_text + 合约 mode + boundary role）：**

1. **无保存/提交线索**：task_text 不命中保存线索正则（复用 `_SAVE_CUE_RE`（`reviewer.py:38`）同族词表：保存/提交/确定（按钮语境）/下一步 等）；且合约 `submit.via` 为空。
2. **意图词命中核验语义**：task_text 含核验词根（核验/验证/确认/检查/复核/确认已/是否存在/不存在）**且**与「已删除/不存在/无数据/是否生效」类宾语共现（近邻窗口内，避免「确认修改后保存」假阳）。
3. **无写动作计划**：合约 `brief_plan`（LLM 路径）/ task_text 动词面不含 写动词（填写/输入/勾选/上传/新增/编辑/修改/删除/启用/停用/导入）——**#924 排除条件**（含「删除」即不判核验型）。
4. **mode/role 侧证**：合约 `mode ∈ {query, other, navigate}` 或 boundary `role ∈ {query, other, navigate}`（create/modify/introduce_pick 硬排除——护栏对称 `promote_contract_for_save_cues` 的白名单思路）。

**判定结果动作（治本）**：判定为核验型 → 在唯一收口点清空 token 要求（见 §3），等价于把该阶段编码为 `mode='other'` 语义（**不新增 mode='verify' 字面值**——`_VALID_MODES` 不含 verify，LLM 侧会被 `normalize_reviewer_payload` 静默拒收、契约整体跌落规则兜底，且 `_MODE_TO_TASK`/`_MODE_TO_ROLE`/prompt 表/`needs_business_data_context` 需全链锁步，爆炸半径不成比例；「verify」在 Literal 中已预留但全库死值，维持不动）。

**校准对应用（冻结判据，不是反推素材）**：
- 阳性 #973 阶段2（「重搜确认三个已删节点不存在」）：①无保存线索 ✓ ②「确认」+「已删除/不存在」共现 ✓ ③brief_plan 无写动词 ✓ ④mode/role 非 maintain ✓ → 判核验型 → 不产 submit.required/kinds → 不得再被 missing_success_token 误杀。
- 对照 #924 阶段2（核验+删除混合）：③命中「删除」写动词 → **不判核验型** → 现行判定不变（该阶段 token 要求保留是正确的——删除动作需真实终态证据）。
- 反例防线（防给真该失败的开后门）：真该失败的核验型空转（如搜不到本应存在的数据却报成功）不受本判定豁免——done 仍需 success=true 的**显式自报**，零步门禁/G3/终局门闩全部照常；本判定只移除「向保存令牌看齐」这一不适用的要求，不放松任何假成功防线。

## 3. 收口点与生效面（Explore 调研结论）

**主收口：`apply_phase_contract`（`scripts/controller/actions/phase/intent_contract.py:269-405`）**——LLM 路径（`service.py:273`）与规则路径（`service.py:286`→`apply_phase_intent:408-449`）唯一汇合写点；`sanitize_contract_for_mode` 既有降级仲裁（:280-283、:344-354、:385-395）为其结构同类。判定输入取 `boundary_override['task_text_excerpt']`（LLM 路径）或 `contract['task_text_excerpt']`（规则路径）；**须穿透完整 task_text**（excerpt 仅 200 字，核验线索可能被截断——先例 `promote_contract_for_save_cues` 已示范 task_text 伴传）。

**同写边界（关键，单改合约不完整）**：`has_contract_success` 在 boundary 激活时优先读 `phase_done_ok`（`intent_gates.py:245-250`）——判定命中时须同笔清 `boundary.success_when` 并把 `boundary.role` 降 'other'，否则门侧仍索令牌。

**门侧保守兜底（备选，不单独交付）**：`service.py:724-729` 增核验型豁免（镜像 `introduce_pick` 例外）——成本最低，但 done 时拒绝门（`recorder_emitters.py:1198-1210` needs_token）、overlay 门（`intent_gates.py:100-122`）、+8 步预算（`reviewer.py:85-93`）、save 提示抑制（`section_scope.py:363-381`）四族消费方仍误发；仅当判定式置信不足时作为落地方案降级。

**消费方清单（blast radius， suppressing 后全部自然静默）**：收尾质量门（service.py:724-729）/ done 拒绝门（recorder_emitters.py:1198-1210, 818-909 含 3 次熔断）/ overlay+错误门（intent_gates.py:100-122）/ 预算 floor+8（reviewer.py:85-93）/ save-cue 抑制（section_scope.py:363-381、boundary_gates.py:269-287、task_completion.py:100-114）/ 合约摘要注入（intent_gates.py:71-74）。

## 4. 校准纪律与验证计划

1. **判定式先行冻结**：v1 四条件定稿（用户评审）后**才**盘点历史集——从 doneLogs+steps 全量捞核验型阶段，逐条跑判定式，只记录 TP/FP/FN，**禁止按错分样本回改词表**（词表修订须换一个独立校准批再验）。
2. 校准批拆分：盘点集二八开——70% 校准 / 30% 留出验证；留出集上 FN（真核验型未豁免）可容忍（保守方向），FP（真保存阶段被豁免）零容忍。
3. 上线顺序：先门侧兜底（service.py 一处 + 判定式纯函数 + pin）观察一个湿测窗口 → 无 FP 再升主收口（apply_phase_contract + boundary 同笔清理）。两步各自 RED pin 先行 + verify-all 全量零已知红。
4. 与本线刚交付的 `phase_blocked`（38637409）的关系：正交——`phase_blocked` 修的是「终局裁决对诚实受阻的标注」，本单元修「合约生成对核验型阶段的 token 要求」；#973 若先吃本判定式（不产 submit.required）则根本不会触发 missing_success_token，两修不冲突不重复。

## 5. 待用户裁定项

1. 判定式 v1 四条是否成立（尤其③写动词黑名单的取舍：黑名单缺词→漏豁免（保守安全），多词→误豁免（危险）——默认从严配置）；
2. 落地节奏：一次到位（主收口） vs 先兜底后收口（默认推荐后者，风险面小一个量级）；
3. 新 mode='verify' 不启用（死值维持）——如需台账级可辨识核验型阶段，另议 store 侧标记键而非 mode 字面值。

## 6. 刀 2 后落点重推导（2026-09-22 补，方案 D 刀 2 = 79b4b8ba 合并后）

§3/§5 写作时合约生成链还是录制时单路（review → apply_phase_contract 汇合）。方案 D 刀 2（`79b4b8ba`，分析落库合约 `trajectory_phase.contract_json`）改变了主路径，本节为主收口（第二步）的现行设计依据：

**刀 2 后合约三路（`service.py:206-320` 现状）**：
1. **持久化快照路径（新主路径）**：分析 LLM 在 analyze 时直接产出 `{v,mode,refill,submitRequired,successWhen}`，Node `normalizePhaseContract` 校验落库 `trajectory_phase.contract_json`，录制下发 → Python `apply_persisted_phase_contract`（`phase_contract_snapshot.py`）直接写 intent+boundary，**跳过 compile/review/apply_phase_contract 全链**；
2. review 路径（快照缺失/非法/heal 外的回退）：原链路不变；
3. rules 兜底（review 也失败）：原链路不变。

**三个改变主收口设计的事实**：
- **① mode 侧证（判定式条件④）在持久化路径失效**：门侧豁免（已交付，c55cc849）对 `mode ∈ veto` 直接 False——而持久化路径的 mode 恰是分析 LLM 的输出（phase-reviewer-prompt.md 对纯核验阶段零指引，误标 create/modify 风险真实）。对持久化误标形态，第一步豁免是死代码。
- **② submit.required 的运行中危害升级**：分析侧误标 `submitRequired=true` 后，recovery 处方强推 click_save（prompt 第 61 条证据）、步数下限 8（prompt 第 36 条）、done 拒绝门/overlay 门四族消费方全部误发——不再只是收尾误杀，是行为腐化。
- **③ 持久化路径的判定文本仍在**：阶段描述（phase_core）随下发流程可得，文本判定输入不缺。

**主收口（第二步）落点 = 持久化消费点的文本降级**（非 §3 原定的 `apply_phase_contract`）：
- 纯函数 `downgrade_contract_for_verification(contract, boundary, task_text)`（放 `phase_contract_snapshot.py`，**不碰** `normalize_phase_contract`——保持其纯校验语义，Cursor pin 零扰动）：输入 task_text 过**纯文本三条件**（①保存线索零命中 ②核验根+宾语 ±16 共现 ③写动词黑名单零命中（宾语掩蔽）——即冻结词表 v1 的条件①②③，**弃条件④**：持久化 mode 是被怀疑对象不能作侧证）；三条件全中 → `submit.required=False`、`success.kinds=[]`、`boundary.success_when=[]`（boundary role 不动——'other' 降级牵动 section scope 面爆炸半径不成比例，且 success_when 清空后 role 已无 token 语义）。
- 接线：`service.py` persisted 分支成功后 3-5 行调用 + stderr 留痕 `phase_contract=verify_downgraded`；fallback 两路径不动（已有门侧豁免兜底，第一步交付）。
- **FP 成本不对称再评估**：降级误判的代价=agent 不被要求保存证据但阶段文本仍指示做什么（且 #924 对照钉住核验+写混合形态）；收益=#973 型不再误杀且 recovery 不再腐化行为。词表冻结 v1 不动，词表修订仍须独立校准批。
- 反例防线不变（§2 末段）：只移除「向保存令牌看齐」，零步门禁/G3/终局门闩/显式 success 自报全部照常。

**实施顺序微调（对 §4.3 的修订）**：门侧兜底（第一步，c55cc849 已交付）观察窗证据=湿测零 FP 命中记录；主收口（第二步，本节）不再要求等待——因为落点从 apply_phase_contract（影响全部 fallback）收窄为 persisted 消费点（只影响分析侧误标形态），爆炸半径更小。历史盘点（§4.1）仍待判定式最终定稿后进行。
