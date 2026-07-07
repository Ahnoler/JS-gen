# OpenCode Agent API

基于 [OpenCode AI SDK](https://opencode.ai) 的 Agent HTTP 服务，专注于 **Element UI / Vue 应用的浏览器自动化测试**。提供 AI 驱动的 UI 操控、Playwright 脚本生成与执行、案例数据管理、人工介入等能力，附带 Web Dashboard。

## 功能概览

| 功能 | 说明 |
|------|------|
| **AI 浏览器操控** | 自然语言驱动的浏览器自动化，支持 Workflow（一次性）和 Session（多轮对话）两种模式 |
| **Element UI 深度集成** | CTRL 辅助函数原生支持 el-form、el-select、el-date-picker、el-table、el-tree、el-dialog 等 15+ 组件 |
| **Playwright 脚本生成** | 从 AI 探索轨迹自动转录为可重放的 Playwright JS 脚本，支持人工修复 |
| **轨迹录制与存储** | 每步 agent 决策与 DOM 状态完整记录，可回放、删除，支持转脚本 |
| **案例数据管理** | 跨阶段数据持久化（`save_case_data` / `read_case_data`），支持 CRUD API 和 Dashboard |
| **Agent 对话** | REST API + SSE 流式响应，多会话管理，Skill 注入 |
| **Web Dashboard** | SPA 仪表盘，集成脚本组装、执行历史、轨迹查看、案例数据、浏览器会话控制 |
| **OpenAI 兼容代理** | `/v1/chat/completions` 代理转发，支持多种 LLM 后端切换 |
| **离线部署** | 完整的离线包构建与内网部署流程，支持 Playwright 浏览器驱动打包 |
| **会话人工介入** | Agent 卡住时可发送指令人工干预，agent 恢复执行 |
| **脚本执行与诊断** | 执行 Playwright 脚本时自动捕获截图、结构化错误报告、支持自我修复提示 |

---

## 目录

- [项目架构](#项目架构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [配置指南](#配置指南)
- [部署指南](#部署指南)
  - [有网环境](#有网环境开发测试)
  - [内网离线部署](#内网环境离线部署)
- [服务架构详解](#服务架构详解)
  - [Node.js 服务端](#1-nodejs-服务端)
  - [Python Agent 脚本](#2-python-agent-脚本)
  - [双语言同步模式](#3-双语言同步模式python--javascript)
  - [Web Dashboard](#4-web-dashboard)
- [浏览器自动化](#浏览器自动化)
  - [工作模式](#工作模式)
  - [Element UI 自定义操作](#element-ui-自定义操作)
  - [Agent 提示词系统](#agent-提示词系统)
- [Script 组装管线](#script-组装管线)
- [OpenCode Skills](#opencode-skills)
- [案例数据管理](#案例数据管理)
- [API 参考](#api-参考)
- [环境变量](#环境变量)
- [常见问题](#常见问题)
- [License](#license)

---

## 项目架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User / Client                               │
│           (Dashboard / curl / Postman / Third-party system)         │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ HTTP / SSE
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Node.js Express Server                         │
│                     (port 4097, server.mjs)                         │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │   Route Modules │  │   Store Modules │  │  Dashboard (SPA)    │  │
│  │   (13 routes)   │  │  (trajectory,   │  │  (13 ESM modules)   │  │
│  │                 │  │   case-data,    │  │                     │  │
│  │ agent.js        │  │   script-utils) │  │  Script Assemble    │  │
│  │ browser-session │  └─────────────────┘  │  AI Explore         │  │
│  │ browser-explore │                       │  Trajectories       │  │
│  │ test-run        │  ┌─────────────────┐  │  Case Data          │  │
│  │ test-assemble   │  │   LLM Utils     │  │  Session Mode       │  │
│  │ llm-proxy       │  │  (callLLM)      │  │  Execution History  │  │
│  │  ...            │  └─────────────────┘  └─────────────────────┘  │
│  └─────────────────┘                       └────────────────────────┘
│                       │
│             spawn(StdIn/StdOut JSON Lines)
│                       ▼
│  ┌──────────────────────────────────────────────────────────────────┐
│  │                   Python Agent (browser_use)                     │
│  │                                                                  │
│  │  main.py ──→ controller.py (20+ custom actions)                  │
│  │  │             agent_utils.py (LLM, prompt)                      │
│  │  ├──workflow  workflow_runner.py (multi-phase)                   │
│  │  └──session   session_runner.py (stdin interactive)              │
│  │                                                                  │
│  │  recorder.py (hooks, goal dedup, human intervention)             │
│  │  form_rules.py (ID card, phone, email generators)                │
│  │  prompts/agent-prompt.md (system prompt)                         │
│  └──────────────────────────────────────────────────────────────────┘
│                       │
│                       ▼
│  ┌──────────────────────────────────────────────────────────────────┐
│  │              Script Assembly Pipeline                            │
│  │                                                                  │
│  │  1. Agent records → action_xxx.json (with {action,params})       │
│  │  2. dedup.js → removes consecutive duplicates                    │
│  │  3. script_assembler.py → generates Playwright JS script         │
│  │  4. playwrite-skill/run.js → executes script in Chromium         │
│  └──────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────┘
```

---

## 环境要求

| 组件 | 要求 | 备注 |
|------|------|------|
| **Node.js** | 18+ | `node --version` 检查 |
| **Python** | 3.10+ | 推荐嵌入式 Python 3.12（自动检测 `.\python\python.exe` 或系统 PATH） |
| **AI 模型** | 兼容 OpenAI API | DeepSeek、GLM、Ollama 本地模型等 |
| **Chromium** | 可选 | 执行 Playwright 测试脚本时需要 |
| **npm** | 9+ | 随 Node.js 安装 |

---

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 AI 模型

编辑 `agent-api.config.json`（如不存在则创建）：

```json
{
  "models": [{ "provider": "deepseek", "model": "deepseek-v4-flash" }],
  "defaultModel": "deepseek/deepseek-v4-flash"
}
```

`opencode.json` 中包含完整的 provider 配置（API key、baseURL 等）。

### 3. 启动服务

**独立模式（推荐，无需 opencode SDK）：**

```powershell
.\start.ps1
```

**或手动启动：**

```powershell
$env:STANDALONE_LLM = "true"
$env:LLM_BASE_URL = "https://api.deepseek.com"
$env:LLM_API_KEY = "your-api-key"
npm start
```

服务默认监听 `http://0.0.0.0:4097`。

### 4. 访问 Dashboard

浏览器打开 `http://localhost:4097/api/test`

---

## 配置指南

### AI 模型配置

系统支持两种运行模式：

**模式 A — 独立 LLM 模式（`STANDALONE_LLM=true`，推荐）**

服务直接通过 HTTP 调用 OpenAI 兼容 API，不依赖 OpenCode SDK。通过环境变量或配置设置：
- `LLM_BASE_URL` — API 端点地址（如 `https://api.deepseek.com`）
- `LLM_API_KEY` — API Key
- `agent-api.config.json` — 默认模型选择

**模式 B — OpenCode SDK 模式**

利用 OpenCode CLI 的 provider 管理能力，从 `opencode.json` 读取模型配置。

```json
{
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://api.deepseek.com",
        "apiKey": "sk-xxx"
      },
      "models": {
        "deepseek-v4-flash": { "_launch": true }
      }
    }
  }
}
```

### Python 环境配置

确认 Python 环境中安装了 `browser_use` 及其依赖。在 `start.ps1` 或环境变量 `PYTHON_EXE` 中指定 Python 解释器路径：

```powershell
$env:PYTHON_EXE = "C:\Program Files\Python312\python.exe"
```

---

## 部署指南

### 有网环境（开发/测试）

```powershell
git clone <仓库地址>
cd opencode-skill-use
npm install
# 编辑 opencode.json 和 agent-api.config.json 填入 API Key
cd web-ui
pip install -r requirements.txt
.\start.ps1
```

### 内网环境（离线部署）

需要一台有网的机器制作离线包，将产物拷贝到内网机器部署。

#### 步骤一：制作离线包（有网机器）

```powershell
# 中国内地用户建议加 -UseMirror 使用国内镜像（解决下载超时/断连问题）
.\build-offline.ps1 -OutputDir "D:\offline-deploy" -UseMirror
```

脚本自动下载以下内容到 `D:\offline-deploy\`：

| 文件 | 说明 |
|------|------|
| `node-v22.msi` | Node.js 22 安装包 |
| `python-3.12.10-embed-amd64.zip` | Python 3.12 嵌入式（便携版） |
| `get-pip.py` | pip 引导安装脚本 |
| `VC_redist.x64.exe` | VC++ Redistributable（解决 DLL 加载失败） |
| `node_modules.zip` | npm 依赖（`npm ci` 打包） |
| `pip-cache\` | Python pip 离线包 |
| `ms-playwright-node.zip` | Node.js Playwright 浏览器驱动 |
| `ms-playwright-python.zip` | Python Playwright 浏览器驱动 |
| `project-source.zip` | 项目源码（排除 node_modules/.git/web-ui 等） |

> **注意**：Node.js 和 Python 的 Playwright 浏览器驱动版本可能不同（如 chromium-1217 vs chromium-1223），两者独立管理、互不干扰，分别打包为独立的 zip 文件。

#### 步骤二：拷贝到内网机器

将整个 `D:\offline-deploy\` 目录通过 U 盘等介质拷贝到目标机器。

#### 步骤三：安装基础环境

1. 双击安装 `node-v22.msi`（**勾选** Add to PATH）
2. 双击安装 `VC_redist.x64.exe`（解决 DLL 加载失败问题，安装后**重启电脑**）
3. Python 无需安装 — 项目使用嵌入式 Python 3.12，部署时自动解压到 `.\python\`

#### 步骤四：解压依赖（或等待 NSIS 安装包一键完成）

若使用 NSIS 安装包（`.exe`），安装向导会自动完成以下步骤。手动部署时：

```powershell
# 解压项目源码
Expand-Archive project-source.zip -DestinationPath C:\atp-gen -Force

# 解压 node_modules
Expand-Archive node_modules.zip -DestinationPath C:\atp-gen -Force

# 解压嵌入式 Python
Expand-Archive python-3.12.10-embed-amd64.zip -DestinationPath C:\atp-gen\python -Force
# 编辑 python\python312._pth，取消注释 "import site"（启用 pip 包）

# 引导 pip
C:\atp-gen\python\python.exe get-pip.py

# 离线安装 Python 依赖
C:\atp-gen\python\python.exe -m pip install --no-index --find-links pip-cache -r scripts\requirements.txt

# 解压 Playwright 浏览器
Expand-Archive ms-playwright-node.zip -DestinationPath $env:LOCALAPPDATA -Force
Expand-Archive ms-playwright-python.zip -DestinationPath $env:LOCALAPPDATA -Force
```

#### 步骤五：配置与启动

```powershell
cd C:\atp-gen
.\start.ps1
```

首次启动时，系统检测到未配置 API Key，会自动打开配置页面 `http://localhost:4097/api/setup`。
填写 API Key 后自动写入 `config\.env`，后续启动直接进入 Dashboard。

或手动启动：

```powershell
$env:LLM_BASE_URL = "https://api.deepseek.com"
$env:LLM_API_KEY = "sk-your-key"
npm start
```

#### 常见部署问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `DLL load failed` | VC++ Redistributable 未安装 | 安装 `VC_redist.x64.exe` 并重启 |
| `Executable doesn't exist at ...\chromium-xxx` | 浏览器驱动缺失或版本不匹配 | 运行 `playwright install` 或重新打包离线包 |
| `read ECONNRESET` / 下载极慢 | 网络访问外网超时 | 打包时加 `-UseMirror` 使用国内镜像 |
| `npx playwright install` 警告项目依赖未安装 | 未先执行 `npm install` | 打包脚本已自动处理，无需干预 |
| `Event loop is closed` / `page is not defined` | 连锁报错，浏览器驱动问题 | 先确保浏览器驱动安装正确，底层报错会自动消失 |

---

## 服务架构详解

### 1. Node.js 服务端

#### 入口文件 — `server.mjs`

使用 Express 框架搭建，组装所有路由模块，启动 HTTP 服务。关键流程：
1. 加载默认模型配置
2. 根据 `STANDALONE_LLM` 决定是否初始化 OpenCode SDK
3. 注册所有路由模块
4. 提供静态文件服务和 Dashboard
5. 全局错误处理

#### 配置模块 — `src/config.js`

导出所有可配置常量，包括端口、路径、环境变量等。

#### 状态管理 — `src/state.js`

全局单例状态对象，管理：
- `ocServer` / `client` — OpenCode SDK 连接
- `cachedAgents / cachedSkills / cachedModels` — 缓存的 Agent/Skill/Model 列表
- `defaultModel` — 默认 AI 模型
- `globalBrowser` — 共享浏览器进程（供 Session 模式复用）
- `sessions` — 活跃会话 Map
- `executionRecords` — 已归档的执行记录

#### 路由模块（13 个）

| 路由文件 | 说明 |
|----------|------|
| `routes/health.js` | 健康检查、Agent/Skill/Model 列表查询 |
| `routes/agent.js` | Agent 对话（同步/异步/SSE/多Session管理） |
| `routes/sse.js` | SSE 流式 Agent 对话端点 |
| `routes/llm-proxy.js` | OpenAI 兼容代理（`/v1/chat/completions`、`/v1/models`） |
| `routes/browser-use-explore.js` | 浏览器自动化探索（Workflow + Session 模式），含多阶段任务解析 |
| `routes/browser-session.js` | 别名路由（代理到 browser-use-explore 的 Session 端点） |
| `routes/explore-route.js` | 探索路由（整合 browser-use-explore 的入口） |
| `routes/explore-utils.js` | 浏览器自动化工具函数（spawn/kill/SSE 共享逻辑） |
| `routes/test-assemble.js` | Action 文件 → 去重 → 组装 → Playwright 脚本管线 |
| `routes/test-run.js` | 执行 Playwright 脚本（SSE 流式 + JSON 同步），截图捕获 |
| `routes/test-history.js` | 已生成脚本的历史管理 |
| `routes/trajectory.js` | 轨迹 CRUD |
| `routes/case-data.js` | 案例数据 CRUD |

#### 存储模块

| 模块 | 用途 | 存储方式 |
|------|------|----------|
| `trajectory-store.js` | 轨迹文件管理 | `scripts/trajectories/` 目录，`index.json` 元数据 + 独立 JSON 文件 |
| `case-data-store.js` | 案例数据管理 | `scripts/case_data/` 目录，同上 |
| `script-utils.js` | 脚本生成/索引管理 | `scripts/generated/` 目录，同模式 |
| `ctrl-actions.js` | Element UI CTRL 辅助函数（JS 端唯一来源） | 内联代码，注入生成的 Playwright 脚本 |
| `dedup.js` | 动作去重（仅去除连续重复） | 纯函数 |
| `llm-utils.js` | 独立 LLM 调用 | HTTP 直接调用 OpenAI 兼容 API |

---

### 2. Python Agent 脚本

| 脚本 | 说明 |
|------|------|
| `main.py` | **主入口**。CLI 模式：`--task`（单次）、`--workflow`（多阶段）、`--session`（交互式）。输出 JSON Lines 到 stdout |
| `controller.py` | **核心 — Playwright Controller**。注册 ~20 个自定义 Element UI 操作。通过 `_record_action()` 记录每次操作到 `_ACTION_LOG` |
| `session_runner.py` | **交互式会话**。从 stdin 读取 JSON 指令，执行 agent 步骤，输出 JSON 事件。支持人工介入 |
| `workflow_runner.py` | **工作流执行**。按阶段（phase）顺序执行，保存每阶段轨迹 |
| `recorder.py` | **录制钩子**。`on_step_start` / `on_step_end` 回调，目标去重检测、取消信号、人工介入注入 |
| `agent_utils.py` | **工具函数**。LLM 创建（ChatOpenAI）、参数解析、消息上下文裁剪（保留最后 12 条）、提示词加载 |
| `form_rules.py` | **表单规则**。`match_rule(label_text)` → 有效随机值。包括身份证（校验和）、手机号、信用代码、银行卡号等 |
| `script_assembler.py` | **脚本组装器**。读取 action JSON → 生成完整 Playwright JS 脚本，含多级降级选择器（CTRL → Playwright → XPath） |
| `prompts/agent-prompt.md` | Agent 系统提示词（Element UI 操作规则、字段扫描、任务清单管理） |
| `prompts/agent-field-rules.md` | 表单字段规则补充提示词 |
| `prompts/agent-special-prompt.md` | 特殊场景提示词 |
| `browser-use-agent.py` | 后向兼容入口 |

---

### 3. 双语言同步模式（Python ↔ JavaScript）

代码库中存在两套**必须保持同步**的 Element UI 交互实现：

| 语言 | 文件 | 用途 |
|------|------|------|
| Python | `scripts/controller.py`（~1690 行） | Browser Use agent 运行时的 CDP 操作 |
| JavaScript | `src/ctrl-actions.js`（~324 行） | 注入到生成的 Playwright JS 脚本中 |

两者实现同一组 CTRL 帮助函数。修改 controller.py 时必须同步更新 ctrl-actions.js。关键设计决策：

- **原生 setter 模式**：Element UI 表单使用 `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, val)` 触发 Vue 响应式
- **不要使用 `page.fill()`**：它不会触发 Vue 的 v-model 更新
- **事件序列**：input（inputType）→ change → blur（必须冒泡）
- **el-select 特殊处理**：下拉项是 `<li>` 元素，需要特定的点击目标
- **DOM 引用必须重新查询**：Vue 可能异步销毁/重建组件（尤其在 el-dialog 内）

---

### 4. Web Dashboard

**入口**：`test-dashboard.html` + `test-dashboard.css`

**前端模块**（`src/dashboard/`，13 个 ESM 模块）：

| 模块 | 功能 |
|------|------|
| `index.js` | 主入口，初始化所有面板 |
| `script-pipeline.js` | **脚本组装管线**：列出 action/log 文件 → 去重 → 预览 → 组装 → 运行 |
| `explore.js` | **AI 探索面板**：提交任务 → 实时 SSE 流显示 → 轨迹保存 |
| `history.js` | **已生成脚本列表**：查看、复制、下载、删除 |
| `trajectory.js` | **轨迹浏览器**：列示/查看/删除轨迹 |
| `trajectory-actions.js` | 轨迹操作日志查看 |
| `trajectory-log-view.js` | 轨迹日志视图 |
| `case-data.js` | **案例数据管理器**：CRUD |
| `session-mode.js` | **会话模式面板**：创建/管理浏览器会话，分步骤提交任务 |
| `execution-records.js` | **执行记录**：历史会话归档查看 |
| `swagger-api.js` | API 参考文档展示 |
| `particles.js` | 背景粒子动画 |
| `utils.js` | 工具函数 |

Dashboard 面板标签页：
1. **Script Assemble** — 动作文件管理 + 组装脚本 + 运行
2. **AI Explore** — 提交探索任务，实时查看 SSE 进度
3. **Playwright Scripts** — 已完成成的脚本历史
4. **Trajectories** — 轨迹查看/删除
5. **Case Data** — 案例数据管理
6. **Execution Records** — 已归档会话记录

---

## 浏览器自动化

本服务集成了 [Browser Use](https://github.com/browser-use/browser-use) 框架，通过 LLM 实现自然语言驱动的浏览器操控，专为 Element UI / Vue 应用优化。

### 技术栈

- **CDP (Chrome DevTools Protocol)** — Python Agent 通过 CDP 操控浏览器
- **Playwright** — JS 侧执行生成的自动化脚本
- **Browser Use** — LLM 驱动的浏览器代理框架
- **LangChain ChatOpenAI** — Python 侧 LLM 调用

### 工作模式

**1. Workflow 模式（一次性执行）**

`POST /api/browser-use/explore`

提交多阶段任务文本，Python Agent 按顺序执行所有阶段后退出。任务阶段格式：

```
// 任务文本中的阶段定义
【目标URL】
http://example.com

【阶段1：登录系统】
1. 输入用户名 admin
2. 输入密码 123456
3. 点击登录按钮

【阶段2：新增客户】
1. 点击菜单"客户管理"
2. 点击"新增"按钮
3. 填写客户名称 → [具体值: "测试公司"]
```

每个阶段保存独立的轨迹文件。导航类阶段（含"登录""导航"关键字）max_steps=50，其他阶段 max_steps=40。

**2. Session 模式（多轮对话）**

浏览器跨步骤保持打开，适合需要人工分批确认的复杂流程：

```
POST /api/browser/session           → 创建会话（复用全局浏览器进程）
POST /api/browser/session/:id/step  → 发送子任务（SSE 实时推送）  
DELETE /api/browser/session/:id     → 关闭/归档会话
DELETE /api/browser/browser         → 关闭浏览器
```

核心特性：
- **共享浏览器**：`state.globalBrowser` 管理一个长期运行的 CDP 浏览器进程
- **并行控制**：`gb.busy` 锁防止多步骤冲突
- **取消机制**：通过取消文件标志和 stdin 发送 `cancel_step` 信号
- **会话隔离**：轨道独立，删除会话仅归档不会关闭浏览器
- **人工介入队列**：Agent 卡住时通过 Dashboard 发送指令，下个 on_step_start 自动注入

**3. Chrome 孤儿进程清理**

每次启动前执行 `killOrphans()`，通过 PowerShell 查找并终止匹配 `playwright|browser_use|openclaw|xbrowser` 的 chrome.exe 进程。

### Element UI 自定义操作

| 操作 | 说明 |
|------|------|
| `fill_form_field(label, value)` | 填充 el-input/textarea（原生 setter，触发 Vue 响应式） |
| `select_option(label, option)` | el-select 下拉选择，`option='first'` 选第一项 |
| `fill_date_field(label, dateStr)` | 设置 el-date-picker / tsscdatepicker（格式 YYYY-MM-DD） |
| `click_radio(label, option)` | 点击 el-radio 组中的选项 |
| `click_menu_item(text)` | 点击 el-menu 菜单项（自动展开子菜单） |
| `click_table_row_button(rowText, btnText)` | el-table 行内操作按钮 |
| `click_table_row_radio(rowText)` | el-table 行内单选按钮 |
| `click_adjacent_button(label)` | 点击字段旁的"选择"/"引入"按钮（仅空字段时执行） |
| `close_dialog()` | 关闭通知/弹窗/抽屉（优先级：notification > dialog > drawer） |
| `close_notification()` | 关闭 el-notification 并读取其文本内容 |
| `wait_for_loading()` | 等待 el-loading-mask 消失（最多 15 秒） |
| `switch_tab(name)` | 切换 el-tabs 标签页 |
| `check_field_value(label)` | 读取表单字段当前值（返回 label/kind/value/disabled 等） |
| `verify_field_value(label, expected)` | 验证字段值是否符合预期 |
| `expand_all_el_tree()` | 展开全部 el-tree 节点 |
| `save_case_data(key, value)` | 跨步骤/阶段持久化键值对 |
| `read_case_data(key)` | 读取已持久化的数据 |
| `scan_form_fields()` | 全面扫描所有表单字段（开始时使用一次） |
| `scan_visible_fields()` | 仅扫描当前可见字段（后续检查用） |
| `init_task_list(scan_json)` | 从扫描结果创建待办清单 |
| `fill_pending_batch()` | ❌ 已移除。批量填写已内建在 `scan_form_fields()` 末尾自动执行 |
| `get_page_state()` | 页面诊断信息 |

### Agent 提示词系统

Agent 提示词位于 `scripts/prompts/agent-prompt.md`，包含：

1. **主提示词**：Element UI 操作规则、可用动作列表、响应格式约束
2. **任务列表系统**：`scan_form_fields` 自动扫描 + 批量填写的批处理工作流
3. **字段验证**：`check_field_value`、`verify_field_value` 的验证规则
4. **分隔标记 `---` 和 `# PLANNER SYSTEM PROMPT`**：用于区分主提示词和规划器提示词

---

## Script 组装管线

从 AI 探索到可执行 Playwright 脚本的完整流程：

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Step 1      │    │  Step 2      │    │  Step 3      │    │  Step 4      │
│  AI Agent    │───→│  Action JSON │───→│  Dedup       │───→│  Assembler   │
│Explore/excute│    │  record      │    │(deduplicate) │    │  (Python)    │
└──────────────┘    └──────────────┘    └──────────────┘    └──────┬───────┘
                                                                   │
┌──────────────┐    ┌──────────────┐    ┌──────────────┐           │
│  Step 6      │    │  Step 5      │    │  Preview     │           │
│  Execute     │←───│  CTRL Helper │←───│(selectable)  │←──────────┘
│  (Playwright)│    │  code insert │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
```

**步骤详解：**

1. **AI Agent 探索执行**：在目标浏览器中执行任务，`controller.py` 的 `_record_action()` 记录每个操作
2. **Action JSON 录制**：生成 `scripts/action/action_{timestamp}.json`，包含 `{action, params, element, command, target}` 等字段
3. **去重**：`src/dedup.js` — `deduplicateActionFile()` 仅移除**连续重复**的 (action + params) 对，非连续重复保留（代表不同的语义步骤）
4. **组装**：`scripts/script_assembler.py` — 读取去重后的 action JSON，生成 Playwright JS 脚本
5. **CTRL 代码注入**：注入 `ctrl-actions.js` 中的辅助函数代码
6. **脚本生成**：输出完整 Playwright 脚本到 `scripts/generated/script_{ts}.js`

### 脚本组装 API

```
POST /api/test/assemble
Body: { actionFile: "scripts/action/action_20260619_183411.json" }
Response: { success, testId, scriptFile, script, stats: { original, deduped, removed } }

GET  /api/test/assemble/files
Response: { actionFiles: [...], logFiles: [...] }

POST /api/test/assemble/save
Body: { path: "...", data: {...} }

DELETE /api/test/assemble/file
Body: { path: "scripts/action/action_xxx.json" }

POST /api/test/assemble/apply-fix
Body: { newPath: "..." }
```

### 脚本执行

```
POST /api/test/run       → SSE 流式（实时日志 + 截图 + 错误报告）
POST /api/test/run-sync  → JSON 同步

脚本通过 playwright-skill/run.js 执行，自动：
- 捕获屏幕截图
- 生成结构化错误报告 script-errors.json
- 检测 Element UI 操作失败并提供诊断
```

---

## OpenCode Skills

项目包含 7 个自定义 skill，注入 Agent 提示词增强 Element UI 操控能力：

| Skill | 文件位置 | 用途 |
|-------|----------|------|
| **playwright-skill** | `.opencode/skills/playwright-skill/` | Playwright 脚本生成（已重写，注册自定义 action），包含 `run.js` 执行器 |
| **atp-ui** | `.opencode/skills/atp-ui/` | Element UI 组件交互最佳实践知识库（~900 行），覆盖 el-form、el-table、el-dialog、el-tree、el-select、el-date-picker、el-cascader、el-tabs、el-upload |
| **atp-rule** | `.opencode/skills/atp-rule/` | 表单字段值生成规则（`matchSpecialRule(label)`），身份证（校验和）、手机号、邮箱、信用代码、银行卡号等 |
| **cdp-agent** | `.opencode/skills/cdp-agent/` | CDP 连接旧版 Chrome/CEF（银行柜面系统、锁定环境） |
| **clarification-protocol** | `.opencode/skills/clarification-protocol/` | 需求澄清问题生成模板 |
| **atp-step-gen** | `.opencode/skills/atp-step-gen/` | 测试执行案例生成（根据需求文档生成分阶段测试案例） |

Skill 的注入方式有两种：
1. **Agent 对话**：在请求中指定 `skill` 参数，系统自动加载 Skill 内容拼接至 system prompt
2. **Browser Use Agent**：在 Python 端通过 `agent_utils.py` 的 `load_knowledge_base()` 加载

---

## 案例数据管理

Agent 可通过 `save_case_data(key, value)` / `read_case_data(key)` 跨阶段共享数据，数据持久化至 `scripts/case_data/` 目录。

### 数据流

```
Agent → {save,read}_case_data(key, value)
                ↓
    Python in-memory dict + JSON file
                ↓
    orchestrate.js → persist to disk
                ↓
    scripts/case_data/{recordId}.json
```

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/case-data` | 案例数据列表（recordId、description、keyCount、createdAt） |
| `GET` | `/api/case-data/:id` | 案例数据详情（`?full=1` 返回完整 JSON） |
| `GET` | `/api/case-data/:id/file` | 返回文件路径 |
| `DELETE` | `/api/case-data/:id` | 删除案例数据 |

---

## API 参考

### Agent 对话

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/agent/execute` | Agent 对话（JSON 同步） |
| `POST` | `/api/agent/execute-async` | Agent 对话（异步提交，立即返回 sessionId） |
| `GET` | `/api/agent/execute-stream` | SSE 流式 Agent 对话 |
| `POST` | `/api/agent/session` | 创建 Session |
| `POST` | `/api/agent/session/:id/message` | 发送消息到 Session |
| `GET` | `/api/agent/session/:id/messages` | 获取 Session 消息历史 |
| `DELETE` | `/api/agent/session/:id` | 删除 Session |

### 脚本生成与执行

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/test/assemble` | Action JSON → 去重 → 组装 → Playwright 脚本 |
| `GET` | `/api/test/assemble/files` | 查看可用 action/log 文件列表 |
| `POST` | `/api/test/assemble/save` | 保存修改后的 action 文件 |
| `DELETE` | `/api/test/assemble/file` | 删除 action/log 文件 |
| `POST` | `/api/test/assemble/apply-fix` | 应用修复后的 action 文件 |
| `POST` | `/api/test/run` | 运行脚本（SSE 流式） |
| `POST` | `/api/test/run-sync` | 运行脚本（JSON 同步） |
| `GET` | `/api/test/history` | 已生成脚本列表 |
| `GET` | `/api/test/history/:id` | 脚本详情 |
| `DELETE` | `/api/test/history/:id` | 删除脚本 |

### 浏览器自动化

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/browser-use/explore` | 浏览器自动化探索（workflow 模式，SSE） |
| `POST` | `/api/browser/session` | 创建多轮会话 |
| `POST` | `/api/browser/session/:id/step` | 发送子任务（SSE） |
| `DELETE` | `/api/browser/session/:id` | 关闭/归档会话 |
| `DELETE` | `/api/browser/browser` | 关闭浏览器进程 |
| `GET` | `/api/browser/session/:id/trajectories` | 获取会话轨迹列表 |
| `POST` | `/api/browser/session/:id/reset-trajectory` | 重置轨迹 |
| `POST` | `/api/browser/session/:id/trajectory` | 保存当前轨迹 |
| `GET` | `/api/browser/sessions` | 列出所有活跃会话 |
| `GET` | `/api/browser/session/execution-records` | 已归档执行记录 |
| `GET` | `/api/browser/session/execution-record/:sessionId` | 执行记录详情 |
| `DELETE` | `/api/browser/session/execution-record/:sessionId` | 删除执行记录 |

### 轨迹与案例数据

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/trajectory` | 轨迹列表 |
| `GET` | `/api/trajectory/:id` | 轨迹详情（`?full=1` 含完整 JSON） |
| `DELETE` | `/api/trajectory/:id` | 删除轨迹 |
| `GET` | `/api/case-data` | 案例数据列表 |
| `GET` | `/api/case-data/:id` | 案例数据详情 |
| `GET` | `/api/case-data/:id/file` | 案例数据文件路径 |
| `DELETE` | `/api/case-data/:id` | 删除案例数据 |

### 系统管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 健康检查（含 agent/skill/model 状态） |
| `GET` | `/api/agents` | Agent 列表 |
| `GET` | `/api/skills` | Skill 列表 |
| `GET` | `/api/models` | 可用模型列表 |
| `GET` | `/v1/models` | OpenAI 兼容模型列表 |
| `POST` | `/v1/chat/completions` | OpenAI 兼容对话 |
| `GET` | `/api/test/screenshots/*` | 测试截图静态文件 |
| `GET` | `/api/test` | Web Dashboard |
| `GET` | `/` | 重定向到 Dashboard |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4097` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PROJECT_DIR` | 项目根目录 | 脚本生成目录基准路径 |
| `STANDALONE_LLM` | `false` | 设为 `true` 跳过 opencode SDK，直连 LLM API |
| `LLM_BASE_URL` | — | 独立模式下 LLM API 地址 |
| `LLM_API_KEY` | — | 独立模式下 LLM API Key |
| `PYTHON_EXE` | 自动检测（`.\python\python.exe` → 系统 PATH） | Python 可执行文件路径（嵌入式或系统安装） |
| `OPENCODE_API_KEY` | — | 覆盖 `opencode.json` 中的 API Key |

---

## 常见问题

### Agent 相关

| 现象 | 原因 | 解决 |
|------|------|------|
| `opencode server not ready` | OpenCode CLI 未安装或未登录 | 设置 `STANDALONE_LLM=true` 跳过 |
| `ReferenceError: Headers is not defined` | Node.js < 18 | 使用 Node.js 18+ |
| Python 报 `ModuleNotFoundError` | Python 依赖未安装 | `pip install -r requirements.txt`（在 browser_use 环境） |
| Agent 重复尝试同一动作 | 上下文溢出或 Vue DOM 同步延迟 | 使用 session 模式分步执行 |

### Element UI 交互

| 现象 | 原因 | 解决 |
|------|------|------|
| el-select 下拉框无法选择 | readonly 属性误判 | 已修复：select_option 不再检查 readonly |
| select_option 成功仍重试 | Vue 未同步 `<input>.value` | 已修复：成功后强制设 `trigger.value` 同步 DOM |
| `dropdown.querySelectorAll is not a function` | 箭头函数非 IIFE | 已修复：改为 IIFE |
| 表单填写后无变化 | 未使用原生 setter | 确保使用 `fill_form_field` 而非 `page.fill()` |
| el-date-picker 日期设置失败 | Vue 响应式未触发 | 使用 `fill_date_field` 中完整的 picker 事件序列 |

### 脚本生成

| 现象 | 原因 | 解决 |
|------|------|------|
| 生成的脚本步骤重复 | 连续重复未去重 | 检查 `dedup.js` 的 dedupKey 逻辑 |
| 生成的脚本找不到元素 | Vue 组件异步渲染 | 添加 `waitForLoading` 和 `page.waitForSelector` |
| 脚本执行报 `Cannot find module 'playwright'` | Playwright 未安装 | `npx playwright install chromium` |

### 部署

| 现象 | 原因 | 解决 |
|------|------|------|
| `DLL load failed` | VC++ Redistributable 未安装 | 安装 `VC_redist.x64.exe` 并重启 |
| `Executable doesn't exist at ...\chromium-xxx` | 浏览器驱动缺失 | 运行 `playwright install` 或重新打包 |
| `read ECONNRESET` / 下载极慢 | 网络超时 | 打包时加 `-UseMirror` 使用国内镜像 |
| `Event loop is closed` | 连锁报错、浏览器驱动问题 | 确保浏览器驱动安装正确 |

### 双语言同步提醒

修改 `scripts/controller.py` 中的 Element UI 交互逻辑时，**务必同步更新** `src/ctrl-actions.js`，反之亦然。两套代码分别服务于：
- `controller.py` — Browser Use Agent 运行时 CDP 操控
- `ctrl-actions.js` — 生成的 Playwright 脚本中注入的辅助函数

---

## License

MIT
