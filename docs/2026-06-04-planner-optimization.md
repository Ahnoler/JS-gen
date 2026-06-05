# 2026-06-04 Browser Use Agent 优化工作记录

## 问题背景

在运行信贷系统对公客户管理自动化测试时，Browser Use agent 出现三类核心问题：

1. **字段重复填充循环**：agent 对法人机构下拉框重复执行 `select_option` 操作（Step 102-107 均尝试同一字段），产生无效循环
2. **阶段过早终止**：agent 在执行 1 个 action（如下拉选择）后立即调用 `done()` 结束阶段，未完成剩余表单字段的填写
3. **内置 action 优先级高于自定义 action**：agent 优先选择 `click_element_by_index` / `input_text`（内置）而非 `select_option` / `fill_form_field`（自定义）

## 根因分析

### 问题 1：重复填充

`select_option` 和 `fill_form_field` 两个 custom action 没有**预检当前值**的逻辑。agent 在 step N 成功填写字段后，step N+1 的 LLM 规划中可能再次包含同一字段。action 执行后返回 `ok`/`ok-first`，agent 未感知到"此字段已完成"。

### 问题 2：过早 done()

**表层原因**：LLM 在一个 step 中**将 action 与 `done()` 打包输出**（`max_actions_per_step=5` 允许同一响应包含多个动作）。执行完一条 `select_option` 后，同批次的 `done()` 也随之触发。

**上层原因**：`test-dashboard.js` 在指令末尾追加了"完成后调用 done()"的约束文本，agent 做完第一个字段就认为自己"完成"了。

**深层原因**：browser_use 0.1.48 内置的 **Planner 机制未启用**。Planner 是一个独立 LLM，在每步前分析进度、输出剩余步骤并注入 agent 上下文，天然防止 done() 过早调用。

### 问题 3：内置 action 优先级问题

**浏览器操作的 LLM 架构固有缺陷**：browser_use 将 26 个内置 action + 自定义 action 以扁平列表呈现给 LLM。LLM 没有机制知道"el-select 应该用 `select_option` 而非 `click_element_by_index`"。它看到两个描述：

| Action | 描述 | LLM 倾向 |
|--------|------|----------|
| `click_element_by_index` | "Click element by index" | **优先选择**（简单、熟悉） |
| `select_option` | "Select an option in an el-select dropdown..." | 低优先级（领域特定、描述长） |

更严重的是，browser_use 的**内置 system prompt** 在 "Common action sequences" 中教 LLM 使用 `input_text` 填充表单：
```
Common action sequences:
- Form filling: [{"input_text": {"index": 1, "text": "username"}}, ...]
```

这直接引导 LLM 使用 `input_text`（对 Element UI 无效的 action）而非我们的 `fill_form_field`。

## 修复措施

### 第一轮：action 层防御

| 文件 | 修改 |
|------|------|
| `scripts/browser-use-agent.py` | `fill_form_field` 和 `select_option` 内部增加 `OK-SKIP:[value]` 预检逻辑（原名 `ALREADY-FILLED`/`ALREADY-SELECTED`，后发现名称误导 LLM 认为"已完成"而改名），字段已有值时跳过填充并返回明确提示 |

### 第二轮：Planner 启用（核心修复）

| 参数 | 原值 | 新值 | 说明 |
|------|------|------|------|
| `planner_llm` | 未设置 | `llm` | 启用 browser_use 内置进度跟踪 |
| `max_actions_per_step` | 5 | 1 | 每步仅一个 action，物理阻止 done() 与 action 打包 |
| `enable_memory` | False | True | 恢复跨步骤记忆 |
| `extend_planner_system_message` | 无 | 6 条规则 | 指示 Planner：进度 <100% 时禁止建议 done() |
| `planner_interval` | 默认 | 1 | 每步运行 Planner |

### 第三轮：架构重构

**`browser-use-agent.py`**：
- 提取 `PLANNER_SYSTEM_PROMPT` 为模块级常量，消除 session 模式和 workflow 模式中的重复定义（-108 行）
- 移除 `login()` 场景特定 action（Planner + `max_actions_per_step=1` 已通用解决多步问题）
- 简化 `fill_form_field` / `select_option` 的 action 描述（移除 done() 警告，Planner 负责进度控制）
- 移除 Playwright generator 中对应的 `login` handler
- 从 1384 行精简至 1275 行（后继续精简至 1322 行）

**`element-ui-knowledge.md`**：
- 移除 `## CRITICAL: done() Usage Rule` 整个章节（Planner 接管）
- 移除 `Multi-Field Form Progression` 章节（Planner 接管）
- 移除 `login()` 原子操作文档
- 移除所有重复的 `ALREADY-*` / 防重复详细说明
- 重写为纯粹的 **Element UI 组件交互技术指南** + **应用参考数据**
- 从 686 行精简至 225 行

### 第四轮：override_system_message 替代内置 prompt

发现 browser_use 内置 system prompt 第 2 条写的是：
```
Common action sequences:
- Form filling: [{"input_text": {"index": 1, "text": "username"}}, ...]
```

**browser_use 自己教 LLM 用 `input_text` 填充表单。** 这是导致 LLM 优先选择错误 action 的根因。

修复：使用 `override_system_message` 完全替换内置 system prompt，写入显式 action 路由表：

| Element Type | Use THIS action | NEVER use |
|-------------|----------------|-----------|
| el-select dropdown | `select_option()` | `click_element_by_index` |
| el-input text/password | `fill_form_field()` | `input_text` |
| el-radio | `click_radio()` | `click_element_by_index` |
| el-dialog/drawer close | `close_dialog()` | `click_element_by_index` |
| Regular buttons/menus | `click_element_by_index` | - |

同时在 override prompt 中加入 `Login page rule`：

```
Login page rule: If URL contains "login" and page has form fields,
you MUST fill ALL visible fields AND click the login button before done().
Login is complete only when URL CHANGES away from the login page.
```

### 第五轮：排除冲突内置 action

利用 Controller 的 `exclude_actions` 参数，从 built-in 列表中移除冲突的 action：

```python
exclude_actions = ['input_text', 'select_dropdown_option']
```

LLM 看不到这些内置 action，只能使用我们的自定义版本。

### 第六轮：修复指令构造

`test-dashboard.js` 在指令中追加"完成后调用 done()"的约束是致命错误：

| 位置 | 原值 | 新值 |
|------|------|------|
| `parseExplorePhases()` L1651 | `完成后调用 done()` | **删除** |
| `executeSessionStep()` L1721 | `完成后立即 done()` | **删除** |
| `maxSteps` for nav | `20` | `50` |

### 第七轮：UI 优化

- Save Trajectory 按钮加入 `confirm()` 确认对话框
- 轨迹文件路径改为 full path，显示在按钮组下方专属行（而非行内小字）

## 最终架构

```
Task 指令 (干净，无约束文本)
  │
  ├─→ Controller (exclude_actions=['input_text', 'select_dropdown_option'])
  │     排除内置冲突 action，LLM 只能使用自定义 Element UI action
  │
  ├─→ Planner LLM (PLANNER_SYSTEM_PROMPT)
  │     每步前分析: 「已完成 2/5 步，下一步填写密码」
  │     进度 <100% 时禁止建议 done()
  │
  └─→ Agent LLM (OVERRIDE_SYSTEM_MESSAGE + element-ui-knowledge.md)
     override_system_message 替换内置 prompt，写入 action 路由表和 login page rule
     extend_system_message 追加 Element UI 技术细节
     max_actions_per_step=1，每步只执行 1 个 action
```

## 关键文件

| 文件 | 行数 | 角色 |
|------|------|------|
| `scripts/browser-use-agent.py` | 1322 | Agent 入口，Controller 定义，Planner 配置，Override prompt |
| `scripts/element-ui-knowledge.md` | 225 | Element UI 组件交互技术指南 + 应用参考数据 |
| `test-dashboard.js` | 2302 | 前端仪表盘，指令解析，Phase 卡片管理，Trajectory CRUD |
| `test-dashboard.html` | 413 | UI 结构，按钮组，路径显示 |
| `src/routes/browser-use-explore.js` | 854 | 后端 SSE 路由，Python agent 标准输入桥接 |

## 关键发现总结

| # | 发现 | 影响 |
|---|------|------|
| 1 | browser_use 内置 system prompt 教 LLM 用 `input_text` 填表单 | 必须用 `override_system_message` 完全替换 |
| 2 | Controller 支持 `exclude_actions` | 可以排除冲突内置 action，LLM 无法选错 |
| 3 | test-dashboard.js 追加"完成后 done()"约束 | 鼓励过早终止，应删除 |
| 4 | `max_steps=20` for nav phases | 不够，应设为 50 |
| 5 | `ALREADY-SELECTED` 返回值误导 LLM | 改名 `OK-SKIP` 消除语义歧义 |
| 6 | Planner 机制默认未启用 | 必须显式启用，是防止过早 done() 的最通用方案 |

## 通用性说明

本轮修复**不依赖任何页面特定逻辑**。`override_system_message` + `exclude_actions` + Planner 对所有 Element UI 应用均适用。不同应用的差异只需在 `element-ui-knowledge.md` 的应用参考数据段补充即可。

## 修改的行范围参考

`scripts/browser-use-agent.py`:
- L54: `PLANNER_SYSTEM_PROMPT` 常量
- L57: `OVERRIDE_SYSTEM_MESSAGE` 常量（替换内置 prompt）
- L234: `fill_form_field` action 描述 + OK-SKIP 预检
- L327: `select_option` action 描述 + OK-SKIP 预检
- L282: `build_controller` 增加 `exclude_actions`
- L1095: 三种模式 Agent 配置（override + extend + planner + max_actions_per_step=1）

`scripts/element-ui-knowledge.md`:
- 全文重写，职责从前两级（交互指南 + done() 管控）精简为纯交互指南

`test-dashboard.js`:
- L1651: 移除 `完成后调用 done()` 约束
- L1717: 移除 `完成后立即 done()` 约束
- L1659: `maxSteps: 20 → 50`
- L1941: Save Trajectory 加入 `confirm()`
- L1743,1818,1969: 路径显示改为 `sessTrajPath` full path

`test-dashboard.html`:
- L238: 按钮组 UI 调整，移除行内 `sessCumFilePath`，增加 `sessTrajPath` div

`src/routes/browser-use-explore.js`:
- L105: `maxSteps: 20 → 50`

---

## 第八轮：Session 执行卡死排查与修复（2026-06-04 下午）

### 问题现象

Session 模式下 Agent 执行 Step 后无任何后续动作，浏览器到达登录页后完全静止。

### 排查过程

#### 问题 8.1：Cancel 文件残留导致 Agent 立即退出

**现象**：日志显示 `[session] Step 1: ...` 后无任何 step 输出，Agent 直接完成。

**根因**：`C:\Users\water\AppData\Local\Temp\browser_use_cancel_global` 文件在上次取消操作时写入但未被清理。新 Step 执行时，`build_recording_hooks` 的 `on_step_end` 在第一步就检测到 cancel 文件存在，立即设置 `agent.state.stopped = True`，导致 Agent 在第一步直接退出循环。

**修复**：

| 文件 | 位置 | 修改 |
|------|------|------|
| `scripts/browser-use-agent.py` | L1121 | Step 执行前清理残留 cancel 文件：`if cancel_flag_path.exists(): cancel_flag_path.unlink()` |
| `src/routes/browser-use-explore.js` | L567 | Node.js 端发送 step 命令前也清理 cancel 文件 |

#### 问题 8.2：`enable_memory=True` 导致 Agent 初始化卡死

**现象**：Cancel 文件问题修复后，Agent 仍然卡住，Python 进程 CPU 接近零，网络连接到 `localhost:4097` 处于 ESTABLISHED 状态但无数据传输。

**根因**：`browser_use` 的 `Agent(enable_memory=True)` 会初始化 `Mem0Memory`，其内部创建 OpenAI embedding client。该 client 使用 `OPENAI_API_KEY=sk-opencode`（占位 key）连接默认的 `api.openai.com`，而非我们的 `localhost:4097` 代理。用假 key 连真实 OpenAI API 导致认证失败/超时卡死。

而 `Agent.__init__` 的异常处理只捕获 `ImportError`，不捕获 `Mem0Memory` 抛出的 `OpenAIError`，所以异常未被优雅处理。

**修复**：所有三种模式（session / workflow / single task）的 `enable_memory=True` 改为 `enable_memory=False`。

| 文件 | 位置 | 修改 |
|------|------|------|
| `scripts/browser-use-agent.py` | L1156 (session) | `enable_memory=True → False` |
| `scripts/browser-use-agent.py` | L1314 (workflow) | `enable_memory=True → False` |
| `scripts/browser-use-agent.py` | L1331 (single) | `enable_memory=True → False` |

> 如需恢复 memory 功能，需为 Mem0 的 OpenAI embedding client 配置可用的 `OPENAI_BASE_URL` 或改用本地 embedding 服务。

#### 问题 8.3：默认模型 `opencode-go/mimo-v2.5` 额度耗尽

**现象**：`opencode-go` 提供商额度用完，LLM 调用失败。

**修复**：默认模型改为 `deepseek/deepseek-chat`。

| 文件 | 位置 | 修改 |
|------|------|------|
| `src/routes/browser-use-explore.js` | L135 (explore) | `opencode-go/mimo-v2.5 → deepseek/deepseek-chat` |
| `src/routes/browser-use-explore.js` | L501 (session) | `opencode-go/mimo-v2.5 → deepseek/deepseek-chat` |

#### 问题 8.4：JS 立即执行箭头函数语法错误

**现象**：`select_option` action 执行时报 `SyntaxError: Unexpected token '('`。Agent 连续 2 次 LLM 调用失败后退出（`max_failures=2`）。

**根因**：JS 中 `const x = () => {...}()` 写法有歧义。JS 引擎（或 Playwright 内部 eval 上下文）将 `{...}` 解析为对象字面量而非函数体，后续 `()` 变成非法 token。正确写法为 `const x = (() => {...})()`，外层括号消除歧义。

**验证**：在目标页面直接测试：
- `([label]) => { const _topOvl = () => {...}(); ... }` → `SyntaxError: Unexpected token '('`
- `([label]) => { const _topOvl = (() => {...})(); ... }` → 正常返回

**修复**：4 处 IIFE 箭头函数添加外层括号。

| 文件 | 行号 | 变量名 | 修改 |
|------|------|--------|------|
| `scripts/browser-use-agent.py` | L382 | `_topOvl` (select_option already_check) | `() => {...}() → (() => {...})()` |
| `scripts/browser-use-agent.py` | L433 | `_topOvl` (select_option trigger) | `() => {...}() → (() => {...})()` |
| `scripts/browser-use-agent.py` | L658 | `_topOvl` (click_radio) | `() => {...}() → (() => {...})()` |
| `scripts/browser-use-agent.py` | L290 | `topOverlay` (fill_form_field) | `() => {...}() → (() => {...})()` |

#### 附加：调试日志增强

为 `on_step_start` / `on_step_end` hooks 添加详细日志，输出 `n_steps`、`is_done`、`stopped`、`next_goal`、`actions`、`last_result`，便于后续排查。

### 问题链路图

```
用户发起 Step
  │
  ├─ [8.1] Cancel 文件残留 → Agent 立即 stopped → 无操作
  │     修复：Step 前清理 cancel 文件
  │
  ├─ [8.2] Mem0 连接 api.openai.com 卡死 → Agent 创建失败/卡住
  │     修复：禁用 enable_memory
  │
  ├─ [8.3] opencode-go 额度用完 → LLM 调用失败
  │     修复：换 deepseek provider
  │
  └─ [8.4] JS IIFE 语法错误 → select_option 报 SyntaxError
        → 连续 2 次失败 → Agent 退出
        修复：() => {...}() → (() => {...})()
```

### 关键发现

| # | 发现 | 影响 |
|---|------|------|
| 7 | Cancel flag 文件跨 Step 残留 | 新 Step 在第一步就被停止 |
| 8 | `Mem0Memory` 不走 `base_url` 代理，直连 `api.openai.com` | 占位 key 导致初始化卡死 |
| 9 | `Agent.__init__` 只捕获 `ImportError` | Mem0 的其他异常未被处理 |
| 10 | JS `() => {...}()` 在 Playwright eval 中有歧义 | 必须写 `(() => {...})()` |
