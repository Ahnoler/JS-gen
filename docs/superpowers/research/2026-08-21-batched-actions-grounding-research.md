# 调研报告：批量动作与视觉 Grounding 兜底（2026-08-21）

> 目标：评估 ①「批量动作」（一个 LLM 轮次输出并执行多个 GUI 动作）与 ②「视觉 grounding 兜底」（DOM 定位失败时用视觉模型从截图定位元素）接入当前 AI 录制/回放链路（JS-gen，browser-use 0.1.48 + playwright 1.58 + MySQL trajectory + script_assembler）的可行性、改造点、成本与风险。调研只读，未修改任何文件。
> 方法：两个只读子代理分头调研（A=批量动作链路，B=grounding 兜底）+ 主线程核对 Node 侧事件契约与 DB schema。

---

## 一、批量动作（子代理 A + 主线程）

### 结论先行
当前链路**从执行、持久化到回放全部按"动作"粒度工作，批量动作事实上已"半接入"**：browser_use 原生支持（`max_actions_per_step` 默认 10 已生效但不可配），项目 prompt 已允许批量（`scripts/prompts/agent-core.md:15`），DB schema 与 Node 侧读取/回放路径全部按 `(step_number, action_index)` 双列工作、零单动作假设。**无需架构改造**，最小方案 = 显式化配置 + 少量纪律调整。

### 关键 findings（file:line）
- F1/F2：`AgentOutput.action` 是列表（browser_use `agent/views.py:150-154`），`parsed.action[:max_actions_per_step]` 裁剪（`agent/service.py:765-767`）；默认 **10**（`agent/service.py:144`），项目构造 Agent 时**未传**该参数（`scripts/agent/service.py:425-434`，全仓 grep 零命中）→ 实际生效但不可控。
- F3：`multi_act`（`agent/service.py:1001-1069`）顺序执行，前置条件"页面不变"由 browser_use 强制：任一动作 error/done（:1055）、index 动作元素 hash 变化（:1016-1030）、出现新元素（:1032-1038）→ break。
- F4：action_results 按**位置**对应（无 key，:1052）；项目侧不消费它（recorder 用 `agent.state.last_result` 列表 + `_ACTION_LOG`，`recorder.py:138-163`）。
- F5：controller 一动作一 tool（`controller/service.py:818-823`），LLM 一次可发多个 tool calls（function_calling，`agent/service.py:404-405`）。
- F6：prompt 已允许批量：`agent-core.md:15`「一次输出 MULTIPLE 个动作，前提是页面不变化时全部成功」；限制：每步最多 1 个 `select_option`（`agent-tools-form.md:56`）。项目用 override_system_message → browser_use 内置 {max_actions} 模板不生效，批量指导完全由项目 prompt 控制。
- F7/F8/F9：录制粒度=**每个动作一条 entry**（`_record_action`，`scripts/state.py:554-647`）→ 每次变更发全量 `action_log_sync`（state.py:495-507）→ Node `appendRecordedStep`（`form-snapshot-append.js:22-113`）逐条写 `trajectory_step`，`action_id` 唯一键幂等（`migrations/20260806130000_trajectory_step_action_id.js`）。批量轮 = N 条 action_log_sync，persist 按 entry.id 去重（`trajectory-recording-runner.js:233-244`）——已兼容。
- F10：`_accumulate_trajectory` 已弃用（`session_runner.py:324-325` 注释禁用）；产物 truth = MySQL + `action_*.json`（`trajectory_store.py:16-141`）。
- F11：dedup 两层、均在动作条目层、不感知轮次：① Python 实时同元素连续合并（state.py:624-637，pop + removedIds → Node 删行 trajectory-recording-runner.js:203-230）；② Node 装配期 `deduplicateActionFile`（`src/dedup.js:56-89`，连续相同 (action, params) 保留后者），唯一调用方 `assemble-service.js:39`。
- F12/F13/F14：`script_assembler.py:181-293` 按**条目**扁平生成，step 按动作递增，无"一步一动作"假设；Python "step" 事件=**每 LLM 轮一次** + actions 名字列表（`agent_utils.py:341-355`），Node 侧 `session-message.js:28-31` 不假设一步一动作；产品录制路径（trajectory-recording-runner）只订阅 action_log_sync/screenshot/phase_*，不消费 "step"。DB `step_number`=动作序号，UI 阶段树天然连续。
- F15：**CTRL parity 零影响**（不新增/不改方法面）。
- F16：`_replay.py:313-526` 逐条目顺序回放（stop_on_fail 按条目断）→ 多动作轮天然兼容。
- 主线程补充：`trajectory_step` schema 有 `(step_number, action_index)` 双列（`migrations/20260713190555_create_all_tables.js:97-99`）；Node 所有读取/回放路径按 `(step_number, action_index)` 排序（`trajectory-dao.js:463`、`trajectory-step-dao.js:50/134`、`trajectory-session-replay.js:178/201/210`），回放把行扁平化为有序动作列表；`trajectoryStepToActionEntry`（`src/models/element.js:342-379`）映射 row→组装条目。

### 推荐接入点（最小改动方案）
**硬性改造：无。** 可选增强（按价值排序）：
1. **显式化 max_actions_per_step（约 10-20 行）**：`scripts/agent/service.py:425` Agent 构造传参；取值从 instruction 透传（参照 `max_steps` 模式，service.py:83）；Node 侧 stepData 加字段；`src/config/config.js` 加默认值（建议表单阶段 5、导航阶段 3）。
2. **prompt 纪律（可选）**：agent-tools-common.md 加"批内不得包含改变 DOM 结构的动作（点击/导航/select 展开下拉）"（select 限制已有）。
3. **无需改动**：migrations / schema / script_assembler / _replay.py / ctrl-actions / dedup.js / recorder 钩子。

### 风险
- R1：批内任一 error/done → break 丢批尾，整轮浪费，模型下轮补救；批量越大概率越高。
- R2：批内 DOM 变化后后续动作基于过期 DOM 执行 → 静默 false-ok 风险（项目动作大多内部 re-query DOM，风险低但需实测）。
- R3：截图每动作一对 before/after + dialog（`scripts/controller/service.py:51-116`）→ 事件量线性增长（persist-live FK 容错已有）。
- R4：premature-done 闸门已遍历 last_result 列表（`recorder_emitters.py:179-188`），兼容。
- R5：一轮 10 个 tool calls → 单轮 token 与整轮重试（max_failures=5 按轮重试，service.py:557-560）成本放大。

---

## 二、视觉 Grounding 兜底（子代理 B）

### 结论先行
当前全链路**无任何视觉通路**（`use_vision=False`，`scripts/agent/service.py:428`；`llm-utils.js` 纯文本；网关 Qwen3.5-35B-A3B 为文本 MoE）。但坐标基础设施已相当齐全（page_bbox 全链路落库、阶段长图带全部 L2 控件 rect 元数据、elementsFromPoint 有 inspect 先例、FORM/SCENARIO_LLM_* 多模型配置先例）——缺的只有"视觉模型→坐标/候选"一段。**接入可行、成本可忽略（单次 ¥0.002–0.06，仅失败步触发）、性价比高**：现状 heal 是 12 步文本 agent 盲试（看不到页面），视觉 pre-step 是纯增量净节省。

### 关键 findings（file:line）
- F1：定位链 = 注入页面的 `PAGE_LOCATOR_HELPERS` 字符串（`src/cdp/page-locator-helpers.js:5-1643`）；**无置信度数值**，只有三态 `locator_verified / locator_strategy('xpath_smart'|'xpath_full') / locator_fallback_reason('smart_missed_host'|'no_smart_predicate'|'empty_anchor_text')`（1627-1631）；智能定位失败退回 xpath_full（1589-1590）。同名多命中消歧全靠 DOM 启发式（regionAnchorXPath 1194-1200、titleboxAnchorXPath 1045-1054、pageStateAnchorXPath 1243-1265、pinOccurrence 1287-1298）——**正是"同名弹窗歧义/rect 照推"痛点**，视觉消歧可兜底这一层。
- F2：回放失败判定 `_result_ok`（`_replay.py:111-137`），失败串 xpath-not-found/option-not-found/no-items/click-failed/false_ok:* 等；回放 xpath 选取 `_resolve_replay_xpath`=xpath_smart→xpath_full（232-248）；点击 `_replay_click_by_index`（replay_click.py:18-123）。Node Type A heal：失败 → buildHealContract（replay-batch-runner.js:291-298）→ runHealStep（replay-heal-shared.js:47-151）——**只传 instruction 文本 + heal_contract，无截图/候选/坐标**；heal agent 同样 use_vision=False，全程只看 DOM 文本。
- F3：截图管线：录制期 Python `capture_page_png_b64`（state.py:99-123，full_page 长图）→ emit_step_screenshot（controller/service.py:43-121，每动作 before/after/dialog）→ Node 存 **MinIO**（不可用落 tmp/pending）。**回放路径不截图**（失败时无现成帧）。阶段长图：capturePhaseScreenshot（phase-highlight-screenshot.js:58-111）→ phase-screenshot-capture.js:58-150 滚动分片 + buildPhaseScreenshotCollectExpression（phase-screenshot-page.js:58-92，收集**全部可见 L2 控件 kind/text/rect/layers/region**）→ stitch（>12MB 半高降采样）→ 元数据 elements[内容坐标]+regionTree。坐标参考系：stepBBoxOf=滚动根内容坐标（600-612）、documentBBoxOf=document 坐标（613-625）；stitch DPR 换算 pxPerCss（phase-screenshot-capture.js:100-102）。
- F4：网关：llm-utils.js:12-37 OpenAI 兼容 /chat/completions，**content 纯字符串、无 image_url 支持**；多模型先例 FORM_LLM_*/SCENARIO_LLM_*（config/config.js:63-65；_scenario_describer.py:57-70）→ 加 VISION_LLM_* 配置组有先例；langchain ChatOpenAI 原生支持多模态消息，改造成本低。
- F5：**无任何"按坐标点击"动作**（ctrl-actions 与 _js_snippets.py 全为 DOM/文本语义动作）；CDP Input.dispatchMouseEvent 仅 BiB 远程输入桥用（cdp-input.js:164/207）；Playwright page.mouse 可用未用。
- F6 半成品：① element→document bbox 全链路：JS_ENRICH_CLICK_LOCATOR 返回 bbox+page_bbox（enrich.py:73-74）、fill_core.py:370 stamp、element_json.page_bbox 落库（models/action.py:132）；② 阶段长图 elements 元数据 = 现成"截图+候选列表"合体；③ elementsFromPoint 反查有 inspect 先例（inspect-payload-script.js:281）；④ 无任何 vision 调用；⑤ 录制期 before/after 整页截图已存 MinIO（页面未变时可复用）。

### 推荐接入方案
**方案 A（一期，推荐）——Python 侧 heal 前置 grounding pre-step**：
1. 配置：`config/.env` 加 VISION_LLM_BASE_URL/API_KEY/MODEL（默认 DashScope qwen-vl 或内网 vLLM 端点）；Node config.js 照 FORM_LLM_* 导出；Python `_llm_values.py` 加 get_vision_llm()。
2. 插入点：`_replay.py` 回放分发处——失败串命中 not_visible 类（xpath-not-found/option-not-found/no-items/click-failed）时，先走 grounding：输入=live 视口截图（page.screenshot full_page=False，Python 内自产自消，不进 session.step 消息、不动 executor 协议）+ entry.element 候选（text/formLabel/placeholder/candidates/page_bbox）+ describeActionIntent 目标文本（heal-instruction.js:116-152 现成）。
3. 输出处理：归一化坐标（MAI-UI SCALE_FACTOR=999）→ CSS 坐标（DPR/比例换算，参照 stitch pxPerCss）→ **优先** elementsFromPoint→normalizeHost→buildLocatorSnap 反查元素（DOM 场景零漂移），用 `_JS_CLICK_DURABLE` 或 form 动作执行；**兜底** page.mouse.click（canvas/shadow DOM）。
4. 验证：复用 `_result_ok`；成功可回写 locator（update trajectory_step.element_json）；失败 → 走现有 Type A heal（流程不变，纯增量）。

**方案 B（二期）——录制期歧义消解（Node 侧）**：buildLocatorSnap 多命中/已知痛点场景时，复用阶段长图 elements 元数据 + callLLMVision → VL 从候选选目标 → 钉 occurrence。
**方案 C（可选）**：Python 内部 `_click_at_coordinate` helper（**不公开为 CTRL 动作**，避免 parity 硬约束）。

### 成本与性价比
| 项 | 值 |
|---|---|
| 单次 grounding（qwen-vl-plus 档） | ~¥0.002–0.01 |
| 单次 grounding（qwen-vl-max 全价档） | ~¥0.03–0.06 |
| 自托管 MAI-UI-8B（4bit，Apache-2.0） | 6–8GB 显存，2–5s/次，无调用费 |
| 触发频率 | 仅定位类失败步（估 <5% 步） |
| 每轨迹成本 | ≤¥0.3 |
| 对比 | 文本 heal agent 12 步盲试（12 次 LLM 调用）→ 前置 grounding 净节省；"换更强文本模型"不成立（看不到页面） |

### 风险
1. **数据出境**：截图含业务数据送外部 DashScope 需评估；优先内网 VL 网关/自托管。
2. DPR/缩放漂移：截图与 CSS 坐标换算（多屏/缩放易偏）；两段式"文本→元素"优先可规避大部分。
3. canvas/shadow DOM 场景无 locator 可回写 → 后续回放仍依赖坐标，需"坐标型步骤"存储语义（方案 C 完整版）。
4. 内网网关 218.77.58.156 是否透传 image 消息**未验证**（需一次连通性测试）。
5. 误点风险（表格多行同名按钮）：点击后验证 + 失败回退原 heal 流。
6. heal 语义污染：保持"只重做失败步原意图"（agent-tools-heal.md:10-13）。
7. 长图喂 VL 会重采样翻 token → grounding 输入用视口图，长图只用于候选 rect 匹配。

---

## 三、spec 前需决策的开放问题

### 批量动作
- O1：max_actions_per_step 默认值？按 phase 区分（表单 5 / 导航 3）？是否 feature flag？
- O2：批量轮截图策略：每动作一对（现状）vs 每轮首尾各一对？
- O3：是否记录 LLM 轮次归属（batch_turn_id/step_group，支撑 UI"一步含 N 个动作"展示）？← 唯一可能需要 schema 变更的点
- O4：批内失败语义：browser_use 直接 break 丢批尾，是否注入更细恢复提示？
- O5：批量与 run_form_assistant 内部批量、pending 写闸门的交互测试用例。
- O6：产物是否显式标记批量轮（meta/source）。

### grounding 兜底
- G1：VL 通道选型：DashScope 公网（免运维/数据出境）vs 内网网关扩展（需验证 image 支持）vs 自托管 MAI-UI-8B（需 GPU）？是否三选一可配置？
- G2：触发面：仅 Type A heal 前置（一期）还是含录制期消歧（二期）？
- G3：成功判定与回写：`_result_ok` 即可还是需 VL 置信度阈值？是否回写 DB 修复 locator？
- G4：坐标型步骤存储语义：是否允许新步骤类型（click_at_coordinate + x/y + 截图引用）？涉及 schema/回放/CTRL parity 三处评估。
- G5：截图规格：视口 vs full_page；是否强制 deviceScaleFactor=1 简化换算？
- G6：MAI-UI 适配：<grounding_think>/<answer> 格式与 999 归一化换算放 Python 还是 Node；多目标取哪个框。
- G7：VISION_* 未配置时行为（跳过 grounding 直接原 heal）。

## 四、建议执行顺序
1. **批量动作（一期）**：显式化 max_actions_per_step + prompt 纪律 + 实测批量轮截图/回放行为。改动小（10-20 行 + prompt），收益直接（减少 LLM 往返、降低 Vue 重建窗口期）。
2. **grounding 兜底（一期）**：VISION_LLM_* 配置 + heal 前置 pre-step（Python ~100-200 行）。先做内网网关 image 连通性测试（5 分钟），再定通道。
3. **二期**：录制期歧义消解（方案 B）、坐标型步骤语义（方案 C 完整版）、批量轮 UI 分组（O3）。
