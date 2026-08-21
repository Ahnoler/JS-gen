# 视觉 Grounding 兜底方案（Spec）

> 状态：待评审
> 日期：2026-08-21
> 前置：调研报告 docs/superpowers/research/2026-08-21-batched-actions-grounding-research.md 第二节；**内网网关 image 透传连通性测试**（G1 决策依赖，见 §3.0，5 分钟可完成）
> 决策（用户已确认默认建议）：G1 先测内网网关，支持则优先；G2 一期仅 Type A heal 前置；G3 用 _result_ok 判定 + 成功回写 locator（可选增强）；G4 坐标型步骤一期不落库；G7 VISION 未配置则跳过直接原 heal

---

## 1. 背景（已调研核实）

- 当前全链路**无任何视觉通路**：Python agent `use_vision=False`（`scripts/agent/service.py:428`）、`src/llm-utils.js` 纯文本、网关模型为文本模型（`config/.env:13` LLM_MODEL=GLM-5）。
- heal 现状 = 12 步**文本 agent 盲试**：Node Type A 失败 → buildHealContract（`replay-batch-runner.js:291-298`）→ runHealStep（`replay-heal-shared.js:47-151`，只传 instruction 文本 + heal_contract，**无截图/候选/坐标**）→ Python heal agent 只看 DOM 文本（`service.py:425-434`）→ 常重蹈"xpath 打不中"覆辙。
- 痛点：同名弹窗歧义、rect 照推、canvas/shadow DOM/iframe 等 DOM 不可见场景——消歧全靠 DOM 启发式（`page-locator-helpers.js:1045-1054,1194-1200,1243-1265,1287-1298`）。
- 成本：单次 grounding ¥0.002–0.06（API 档位差），仅失败步触发（估 <5% 步），每轨迹 ≤¥0.3；自托管 MAI-UI-8B 4bit 需 6-8GB 显存、2-5s/次。

## 2. 目标 / 非目标

**目标（一期）**

- 回放 Type A 定位类失败时，先走**视觉 grounding pre-step**（一次 VL 调用：截图→坐标/候选），成功即完成该步，失败退回现有 heal 流（纯增量）；
- 配置化 VL 通道（内网网关优先，DashScope/自托管备选），未配置时行为与现状完全一致；
- 优先"坐标→DOM 元素反查"执行（可回写 locator），纯坐标点击仅兜底 canvas/shadow DOM。

**非目标（一期）**

- 录制期歧义消解（方案 B：buildLocatorSnap 多命中时 Node 侧 VL 消歧）→ 二期；
- 坐标型步骤落库（`click_at_coordinate` 新步骤类型）→ 二期（G4 记录，涉及 schema/回放/CTRL parity 三处评估）；
- 新增公开 CTRL 动作（`characterize-ctrl.mjs` parity 硬约束）——pre-step 内部用 Playwright `page.mouse`/内部 helper；
- 不改 executor 协议、session.step 消息白名单、MinIO 链路（截图 Python 内自产自消）。

## 3. 方案

### 3.0 前置验证（G1 决策，先做，约 5 分钟）

用网关 `http://218.77.58.156:3000/v1` 发一条含 `image_url`（data URL 1x1 PNG）+ 文本的 /chat/completions 请求，确认：

1. 网关是否透传 image content 到后端模型（返回有效回答 vs 报错/忽略）；
2. 若支持：记下可用视觉模型名（VISION_LLM_MODEL 取值）；
3. 若不支持：评估备选——自托管 MAI-UI-8B vLLM（需 GPU 机器，6-8GB 显存 4bit）或 DashScope qwen-vl API（需评估数据出境，截图含业务数据）。

> 结论写入本 spec 备注；若三选一不可行（无 GPU + 数据出境不可接受 + 网关不支持），项目进入"配置空 = 关闭"状态，功能不启用，spec 不阻塞其它交付。

### 3.1 配置（照 FORM_LLM_* 先例）

```
config/.env:
  VISION_LLM_BASE_URL=http://218.77.58.156:3000/v1   # 空 = 关闭 grounding
  VISION_LLM_API_KEY=...
  VISION_LLM_MODEL=...                                # 连通性测试确认的模型名
config/config.js:58-65 旁（照 FORM_LLM_* 模式）:
  export const VISION_LLM_BASE_URL = _resolve('VISION_LLM_BASE_URL', '');
  export const VISION_LLM_API_KEY = _resolve('VISION_LLM_API_KEY', '');
  export const VISION_LLM_MODEL = _resolve('VISION_LLM_MODEL', '');
scripts/controller/actions/_llm_values.py（照 _get_form_llm :201-219 模式）:
  def _get_vision_llm() -> ChatOpenAI | None   # 三配置任一为空 → None
```

### 3.2 触发面（仅 Type A 定位类失败，G2）

插入点：`scripts/controller/actions/_replay.py` 逐条目回放循环（`:313-526`）内，`_result_ok`（`:111-137`）判定失败**且**失败串命中定位类集合时：

```
NOT_VISIBLE_FAILURES = {'xpath-not-found', 'option-not-found', 'no-items', 'click-failed', 'label-not-found'}
# 注意：label-not-found 的 ok-skip 变体（absent-skip）仍按现状吞掉不进 heal（_helpers.py:199-213）
```

触发条件（全部满足）：① 上述失败串；② `VISION_LLM_MODEL` 已配置；③ 该步 entry 有可用的 action 意图（fill/select/click 类）；④ 未在 heal 重试中（防递归：grounding 只跑一次，失败即交回原 heal 流）。

### 3.3 grounding pre-step 数据流

```
输入:
  1) live 视口截图  page.screenshot(full_page=False)   # Python 持有 page，自产自消
  2) 候选: entry.element 的 text/formLabel/placeholder/candidates/page_bbox（_replay.py:183-248 已解析）
  3) 目标描述: 由 entry action+params 组装中文意图（如 填写"客户名称"="张三" / 点击"保存" / 选择"状态"="启用"）
调用: _get_vision_llm() 多模态消息（image_url=data:image/png;base64,...）
      或 MAI-UI 格式: <grounding_think>...</grounding_think><answer>{"coordinate":[x,y]}</answer>（SCALE_FACTOR=999 归一化，参照 github.com/Tongyi-MAI/MAI-UI MAI-UI/src/mai_grounding_agent.py）
输出: 归一化坐标 → CSS 坐标（norm/999 × 图宽高；DPR 按 imageWidth:innerWidth 比例，参照 phase-screenshot-capture.js:100-102 pxPerCss）
执行（两段式）:
  优先: document.elementsFromPoint(css_x, css_y) → normalizeHost → buildLocatorSnap 反查元素（DOM 场景，参照 inspect-payload-script.js:281）
        → 用该元素执行原动作（_JS_CLICK_DURABLE / fill / select，replay_click.py:97-116）
  兜底: page.mouse.click(css_x, css_y)（canvas/shadow DOM 等无 DOM 场景，内部 helper _click_at_coordinate，不公开 CTRL）
验证: 复用 _result_ok（_replay.py:111-137）
回写（可选增强，G3 建议做）: 反查成功时 update trajectory_step.element_json 的 xpath_smart/occurrence，修复下次回放
失败: 原样交回现有 Type A heal 流程（replay-batch-runner.js 不变）
```

### 3.4 观测

- stderr：`[grounding] trigger action=fill_form_field step=N fail=xpath-not-found → VL ok/坐标(123,456)/elementsFromPoint→xpath_smart | fallback-to-heal`；
- replay_step 事件 payload 增加 `grounding: {used: bool, via: 'element'|'coordinate', ok: bool}`（事件结构只增字段，兼容现有消费方）。

## 4. 验收

1. **纯函数层 characterization**：
   - 失败串命中判定（NOT_VISIBLE_FAILURES 集合、ok-skip 豁免）；
   - 坐标换算函数（norm/999 → CSS → 视口，DPR 边界 1/1.25/1.5/2）；
   - `_get_vision_llm` 配置空 → None（跳过路径）。
2. **连通性记录**：§3.0 测试结论存档（支持/不支持/模型名）。
3. **湿测场景**：构造 xpath-not-found 回放（录制后改元素文案）——① grounding 成功路径：VL 点到目标、`_result_ok` ok、该步记成功、可回写 locator；② 回退路径：VL 输出无效框/点击后仍失败 → 进入原 heal agent；③ 关闭路径：VISION 未配置 → 行为与现状一致。
4. **verify-all.sh** ALL GREEN；`characterize-ctrl.mjs` 不动（无新 CTRL 方法）。

## 5. 备选方案（否决记录）

| 方案 | 否决原因 |
|------|----------|
| A. 录制期 buildLocatorSnap 多命中消歧（Node 侧 VL） | 需要 Node 视觉封装 + 事件面扩展；录制期歧义未必出现；定位失败仍靠回放兜底 → 二期（方案 B） |
| B. 新增公开 CTRL 坐标动作 | characterize-ctrl.mjs parity 硬约束 + 坐标不可重放（页面布局变化即废）→ 内部 helper 取代 |
| C. 坐标型步骤落库（click_at_coordinate 新类型） | 涉及 schema/回放动作表/CTRL parity 三处评估；canvas/shadow 场景一期少 → 二期（G4） |
| D. 换更强文本模型重试 heal | 文本模型看不到页面，无法利用屏幕信号；成本与收益不成比例 |
| E. 直接用阶段长图喂 VL | 长图 >12MB 重采样、token 翻倍；视口图足够完成单元素定位 → 长图仅用于候选 rect 匹配 |

## 6. 风险与对策

- **数据出境**（截图含业务数据送外部 API）：优先内网网关；DashScope 需用户批准后才启用（配置即开关）；
- **DPR/缩放漂移**：两段式"坐标→DOM 元素"优先，纯坐标仅兜底；强制 `deviceScaleFactor` 归一（G5 记录，实施时确认截图参数）；
- **误点**（表格多行同名按钮）：点击后 `_result_ok` 验证 + 失败回退 heal；
- **heal 语义污染**：grounding 只重做失败步原意图（`agent-tools-heal.md:10-13` 纪律延续）；
- **VL 端点不确定性**：§3.0 前置测试先行；失败时配置空=关闭，不影响主链路；
- **递归**：grounding 单次触发、失败即交回 heal，无循环；
- **兼容性**：改 `src/`（config.js）按 AGENTS.md 同步约定写 CHANGELOG；`scripts/` 改动涉及回放语义，建议同步写 CHANGELOG。

## 7. 关联

- 调研：docs/superpowers/research/2026-08-21-batched-actions-grounding-research.md 第二节
- 相关既有链路：heal-locate（回放自愈定位效率，todo-list.md 已开发完成待湿测）、Heal-Locate Optimization.md
- 后续（二期候选）：录制期消歧（方案 B）、坐标型步骤语义（G4）、MAI-UI 专用 grounding 模型接入（<grounding_think> 格式 + 999 归一化，G6）
