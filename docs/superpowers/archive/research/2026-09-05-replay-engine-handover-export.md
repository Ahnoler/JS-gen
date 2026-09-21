# 执行引擎接手：执行子集清单 + 版本化导出方案

> 2026-09-05 · Zcode Lead。背景：同事（Python 技术栈）要接手执行引擎；经排查其定位方式差异（data-id vs data-url/可见性）源于旧组装器与现行引擎两代定位链不同。用户拍板：**不复活 8-27 废弃的组装器（`4c1896b` 快照在案），改为提供现行 live 引擎的执行子集 + 版本化导出契约**。
> 基底材料：[2026-09-01-replay-pipeline-handover.md](2026-09-01-replay-pipeline-handover.md)（四路调研，含端到端链路与坑史）；本文在其上核实现行树（2026-09-05 实查 import 链）并圈定交付边界。

## 0. 一句话总纲

同事要的执行引擎 = **`replay_action_entries()` 纯 Python 确定性执行层**（不走 LLM），闭包 = `scripts/controller/` 动作包 + `scripts/models/` + `scripts/feature_flags.py` + browser_use 框架；定位链 JS 单源直供 `src/cdp/page-locator-helpers.js`。

## 1. 执行入口与契约（同事最先读的三个点）

```python
# scripts/event_dispatch.py:211 "replay_actions" 分支（参考接线方式）
from .controller.service import build_controller
from .controller.actions._replay import replay_action_entries

controller = build_controller(browser_context, business_data_store=store)
summary = await replay_action_entries(
    browser_context,            # browser_use BrowserSession（须支持 await get_current_page()）
    entries,                    # [{action, params}]——trajectory_step.element_json 派生
    controller_actions=controller.registry.registry.actions,  # 注册表兜底（必需）
    business_data_store=store,
    emit=emit_json,             # 进度回调（replay_step / replay_done）
    stop_on_fail=True,          # 产品语义=首败即停
)
# 返回 {count, ok, failed, error, results, stoppedAt?}（_replay.py:533）
```

三条硬约束：
1. **browser_context 是 browser_use 会话**——`_replay.py` 每步 `await browser_context.get_current_page()`（tab 切换后 page 失效重取）。同事引擎要么套 browser_use 框架，要么自己实现等价的 page 重取。
2. **registry 必须带**——直派表未命中的动作回落 `controller.registry.registry.actions`（菜单导航/树/待办卡等都在注册表里）。
3. **`PYTHONUTF8=1`**（executor stdin 中文乱码教训）。

## 2. 执行子集文件清单（2026-09-05 实查）

### A. 回放核心闭包（import 链核实）

| 文件 | 职责 |
|---|---|
| `scripts/controller/actions/_replay.py` | 主循环 `replay_action_entries` + 直派分派表 + 每步重取 page / `_wait_if_loading` |
| `scripts/controller/actions/_helpers.py` | 公共 helper（依赖 `browser_use.agent.views.ActionResult`、`scripts.models.ScannedField`） |
| `scripts/controller/actions/_js_snippets.py` | JS 片段聚合 re-export |
| `scripts/controller/actions/replay_js.py` | `_JS_CLICK_DURABLE` 点击阶梯（616 行，弹层重写/图标 tooltip/文本兜底）+ `_JS_LOCATE_BY_XPATH`/`_JS_READ_VALUE_BY_XPATH` |
| `scripts/controller/actions/replay_form_action.py` | 表单动作（fill/select/tree/radio，native setter + 回读校验） |
| `scripts/controller/actions/replay_click.py` / `replay_table.py` | 持久化点击 / 表格行 radio |
| `scripts/controller/actions/replay_wait.py` / `replay_timing.py` | 保存后 idle 等待 / `ACTION_BUDGET_S` 预算表 + WAIT 常量 |
| `scripts/controller/actions/replay_names.py` | 动作名归一化别名 |
| `scripts/controller/actions/js_snippets/**`（34 个 .py） | 按 widget 域拆分的浏览器 JS 片段：`fill_core`（native setter）、`select_trigger`/`select_option`（el-select 真实 mousedown）、`_locator_helpers_js.py`（**生成物**）、`real_click`、`close_dialog`/`strip_dialogs`、`save_section`、`picker_confirm`、`select_tree`、`tree_check`、`todo_cards`、`semantic_snapshot`、`verify_context`、`xhr_log`、`vue_model` 等 |
| `scripts/controller/actions/form_rules.py` + `form_rules_data.py` | Element UI 表单规则（fill 分支依赖） |
| `scripts/controller/actions/select_match.py` / `result_protocol.py` | 选项匹配 / 结果协议 |
| `scripts/feature_flags.py` | `relative_xpath_primary_enabled` 等开关 |
| `scripts/models/`（action/field/task/form_snapshot/step_entry/entity） | `ScannedField`/`TaskList` 等数据类型 |
| `scripts/controller/service.py` | `build_controller`——注册全部动作进 registry（**导入闭包会拉全 actions 包**） |

### B. 单源生成链（零同步成本的关键）

```
src/cdp/page-locator-helpers.js   ← 定位链 JS 真源（PAGE_LOCATOR_HELPERS / buildLocatorSnap / resolveLocatorStrict）
node scripts/_gen_locator_helpers_py.mjs
  → scripts/controller/actions/js_snippets/_locator_helpers_js.py（生成物，禁止手改）
```

导出包把 **JS 真源**一并交付并注明：同事改定位行为必须改 JS 再生成，两文件同版本。

### C. 随包携带但回放不激活（说明，非裁剪对象）

`_form.py`/`form_autofill.py`/`autofill_*.py`/`cascade_fill.py`/`_llm_values.py`/`form_scan_actions.py` 等自动填表链在 `build_controller` 导入闭包内，会被一起带走，但 `_replay.py` 入口即置 `store['_watcher_mode']=True` 抑制 auto-fill，回放路径不调用、不触网、不依赖 LLM 网关。**不建议人工裁剪**——import 闭包纠缠 + 本仓 characterization 文本 pin 依赖这些文件的组织方式，裁剪收益小、断裂风险大。

### D. 明确不交付

`scripts/prompts/**`、LLM 网关配置（`src/llm-utils.js`/.env 五角色）、录制链（dispatcher/attach/batch）、控制面 HTTP 层（`src/routes/**`、executor WS）——属 JS-gen 产品本体，同事只消费执行子集。

## 3. 同步问题：需要，但用「版本化导出」不用「文件拷贝」

回答用户的问题「我们需要同步 actions？」——**要，前提是同事的引擎要回放我们录制的轨迹（两边行为必须一致）**；若他只是借代码自建，给一次快照即可。同步机制不建议逐文件手工拷（动作库持续演进，一周即漂移），方案如下：

### 导出契约

1. **新增 `scripts/export_engine_subset.mjs`（或 .py）**：把 §2.A+B 清单打成一个目录/压缩包 `engine-subset/<version>/`，附 `MANIFEST.json`：
   ```json
   { "version": "uara_V1.2@<git-hash>", "date": "...", "files": ["path + sha256 ..."],
     "entry": "scripts/controller/actions/_replay.py#replay_action_entries",
     "singleSource": ["src/cdp/page-locator-helpers.js"],
     "regen": "node scripts/_gen_locator_helpers_py.mjs" }
   ```
2. **版本规则**：`js_snippets/**`、`replay_*.py`、`form_rules*`、专用动作有实质变更 → bump 版本 + MANIFEST 变更行；只读参考文件（models、feature_flags）不变不 bump。
3. **同事侧升级**：整目录替换 + 对照 MANIFEST diff，不挑文件合并。
4. **对拍护栏**：每次 bump 附一条最小回放冒烟（1 条 fill + 1 条 el-select + 1 条 click 步骤在 test.creditv5p2 跑绿），同事侧同条冒烟必须同结果。

### 两边行为一致性的三个锚点（写进交接说明）

- 动作名与 params 契约以 `replay_names.py`（别名归一）+ `event_dispatch.py:230` 的签名过滤为准；
- 定位选取以 `_resolve_replay_xpath`（element_json.xpath_smart → xpath_full，**忽略 params.xpath_smart**）+ `_JS_CLICK_DURABLE` 阶梯为准——同事的 data-id XPath 属于他自建链，接手后建议改走本链（本次菜单验证实证：data-id 是隐藏树，data-url/语义锚才是可见面）；
- Element UI 铁律三条随包：native setter 绝不裸 page.fill；el-select 用 select_trigger/select_option 不用 selectOption；每步前重查 DOM。

## 4. 落地步骤（待用户确认后实施）

1. 写导出脚本 + 首版 MANIFEST（0.5 天内；机械活，脚本可入 `scripts/` 但**不碰 characterization pin 区**）。
2. 交付说明 = 本文 §1/§3 + 9-01 材料一并给同事。
3. 升级触发挂在收工习惯上：改执行子集的会话在 agent-log 收工条目注明「engine-subset 待 bump」，由主线跑导出脚本。

## 5. 恢复锚点备忘（本方案之外的历史线索）

旧组装器若需考古：`4c1896b`（2026-08-27 移除 `6a22520` 的父提交，script_assembler/codegen/ctrl-actions 完整）；早期回放栈 `f3181fc`（`replay-service.js`/`registry.py`）。两者均不推荐作为接手基座。
