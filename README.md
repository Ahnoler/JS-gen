# OpenCode Agent API

基于 [OpenCode AI SDK](https://opencode.ai) 的 Agent HTTP 服务，专注于 **Element UI / Vue 应用的浏览器自动化测试**。提供 AI 驱动的 UI 操控、Playwright 脚本生成与执行、案例数据管理、人工介入等能力，附带 Web Dashboard。

## 功能

- **AI 浏览器操控** — 自然语言驱动的浏览器自动化，支持 Workflow（一次性）和 Session（多轮对话）两种模式
- **Element UI 深度集成** — CTRL 辅助函数（`fillFormField`、`selectOption`、`selectDate` 等）原生支持 el-form、el-select、el-date-picker 等组件
- **案例数据管理** — 跨阶段数据持久化（`save_case_data` / `read_case_data`），支持 CRUD API 和 Dashboard 管理
- **Playwright 脚本生成** — 根据自然语言描述生成脚本，轨迹自动转译，可人工介入修复
- **Agent 对话** — REST API + SSE 流式响应，支持多会话管理
- **自定义 Action 系统** — click_table_row_action、close_dialog、expand_all_el_tree 等 Element UI 专用操作
- **Web Dashboard** — 单页面仪表盘，集成 API 调试、脚本生成、执行历史、轨迹管理、案例数据
- **OpenAI 兼容代理** — `/v1/chat/completions` 代理转发，支持多种 LLM 后端

## 环境要求

- **Node.js** 18+
- **Python 3.10+**（Browser Use 自动化需要，推荐 conda 环境）
- **AI 模型服务** — 兼容 OpenAI API 的推理后端（DeepSeek、GLM 等）
- **Chromium**（可选，执行 Playwright 测试脚本时需要）

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 AI 模型

编辑 `agent-api.config.json` 指定默认模型：

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

## 部署指南

### 有网环境（开发/测试）

```powershell
git clone <仓库地址>
cd opencode-skill-use
npm install
# 编辑 opencode.json 和 agent-api.config.json 填入 API Key
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
| `python-3.12.10-amd64.exe` | Python 3.12 安装包 |
| `VC_redist.x64.exe` | VC++ Redistributable（解决 DLL 加载失败） |
| `node_modules.zip` | npm 依赖（`npm ci` 打包） |
| `pip-cache\` | Python pip 离线包 |
| `ms-playwright-node.zip` | Node.js Playwright 浏览器驱动 |
| `ms-playwright-python.zip` | Python Playwright 浏览器驱动 |
| `project-source.zip` | 项目源码（排除 node_modules/.git 等） |
| `deploy-offline.ps1` | 内网部署脚本 |

> **注意**：Node.js 和 Python 的 Playwright 浏览器驱动版本可能不同（如 chromium-1217 vs chromium-1223），两者独立管理、互不干扰，分别打包为独立的 zip 文件。

#### 步骤二：拷贝到内网机器

将整个 `D:\offline-deploy\` 目录通过 U 盘等介质拷贝到目标机器。

#### 步骤三：安装基础环境

1. 双击安装 `node-v22.msi`（**勾选** Add to PATH）
2. 双击安装 `python-3.12.10-amd64.exe`（**勾选** Add to PATH）
3. 双击安装 `VC_redist.x64.exe`（解决 DLL 加载失败问题，安装后**重启电脑**）

#### 步骤四：运行部署脚本

在 `offline-deploy` 目录下执行：

```powershell
.\deploy-offline.ps1 -ProjectRoot "C:\atp-gen"
```

脚本自动完成：
- 解压项目源码到 `C:\atp-gen`
- 解压 `node_modules`
- 解压 Node.js Playwright 浏览器到 `%USERPROFILE%\AppData\Local\ms-playwright`
- 解压 Python Playwright 浏览器到同一目录（不同版本文件夹名不同，互不冲突）
- pip 离线安装 Python 依赖（跳过浏览器下载）

#### 步骤五：配置与启动

```powershell
cd C:\atp-gen
# 编辑 start.ps1 中的 LLM_API_KEY 和 PYTHON_EXE
.\start.ps1
```

或手动启动：

```powershell
$env:STANDALONE_LLM = "true"
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

## 项目结构

```
├── server.mjs                    # 主入口，组装各模块启动 HTTP 服务
├── src/
│   ├── config.js                 # 配置常量（端口、路径、Python 路径等）
│   ├── state.js                  # 全局运行时状态
│   ├── opencode.js               # opencode 服务初始化（可跳过）
│   ├── ctrl-actions.js           # Element UI CTRL 辅助函数（JS 端唯一来源）
│   ├── case-data-store.js        # 案例数据持久化（JSON index + CRUD）
│   ├── llm-utils.js              # 独立 LLM 调用工具
│   ├── script-utils.js           # 脚本生成/解析工具函数
│   ├── trajectory-store.js       # 轨迹存储（JSON index + CRUD）
│   ├── dashboard/                # Web Dashboard 前端逻辑（11 ESM 模块）
│   │   ├── index.js, case-data.js, execution-records.js, explore.js
│   │   ├── history.js, particles.js, script-pipeline.js
│   │   ├── session-mode.js, swagger-api.js, trajectory.js, utils.js
│   └── routes/                   # 13 个路由模块
│       ├── health.js, agent.js, test-gen.js, test-history.js
│       ├── test-run.js, sse.js, llm-proxy.js, trajectory.js
│       ├── case-data.js, explore-route.js, explore-utils.js
│       ├── browser-session.js, browser-use-explore.js
├── scripts/                      # Python 工具脚本
│   ├── main.py                   # Python Agent 主入口（--task/--workflow/--session）
│   ├── controller.py             # Playwright controller（build_controller）
│   ├── session_runner.py         # 多轮会话运行器
│   ├── workflow_runner.py        # 工作流执行器
│   ├── playwright_gen.py         # Playwright 脚本生成
│   ├── form_rules.py             # 表单规则处理
│   ├── recorder.py               # 轨迹记录
│   ├── agent_utils.py            # 工具函数（LLM 创建、知识库注入）
│   ├── agent-prompt.md           # Agent 提示词（Element UI 操作规则）
│   ├── browser-use-agent.py      # 后向兼容入口
│   ├── generated/                # AI 生成的脚本
│   ├── trajectories/             # 轨迹文件
│   ├── case_data/                # 案例数据
│   ├── data/                     # 数据文件
│   └── trace/                    # 跟踪文件
├── .opencode/                    # OpenCode 技能配置
│   └── skills/
│       ├── playwright-skill/     # 重写的 Playwright 自动化技能（自定义 action）
│       ├── atp-ui/               # Element UI Playwright 脚本生成知识库
│       ├── atp-rule/             # 表单字段值生成规则
│       ├── cdp-agent/            # CDP 浏览器自动化（银行柜面）
│       ├── clarification-protocol/ # 需求澄清协议
│       └── atp-step-gen/         # 测试执行案例生成
├── test-dashboard.html / .css    # Dashboard 页面
├── opencode.json                 # AI 模型与 Skill 权限配置
├── opencode.example.json         # 配置模板
├── agent-api.config.json         # 默认模型配置
├── start.ps1                     # 一键启动脚本（独立模式）
├── build-offline.ps1             # 离线部署包制作脚本（有网机器使用）
├── deploy-offline.ps1            # 内网部署脚本（离线机器使用）
├── dictList/                     # 词典数据
├── docs/                         # 开发文档
├── scripts/trajectories/         # 轨迹文件
├── scripts/case_data/            # 案例数据存储
└── snapshots/                    # 测试截图
```

## 浏览器自动化

本服务集成了 [Browser Use](https://github.com/browser-use/browser-use) 框架，通过 LLM 实现自然语言驱动的浏览器操控，专为 Element UI / Vue 应用优化。

### 架构

```
用户请求 → POST /api/browser-use/explore 或 /api/browser/session
  ↓
Node.js 服务 (port 4097) → 调用 Python Agent (main.py)
  ↓
Python Agent → LLM 决策 → CDP/Playwright 操控浏览器
  ↓
轨迹记录 / 案例数据持久化 / 脚本生成
```

### 工作模式

**1. Workflow 模式（一次性执行）**

`POST /api/browser-use/explore` — 提交多阶段任务，Python Agent 按顺序执行所有阶段后退出，每阶段保存轨迹。

**2. Session 模式（多轮对话）**

- `POST /api/browser/session` — 创建浏览器会话
- `POST /api/browser/session/:id/step` — 发送子任务，SSE 推送结果
- `DELETE /api/browser/session/:id` — 关闭会话

浏览器跨步骤保持打开，每阶段 `max_steps=40`。

**3. 人工介入**

Session 模式下支持人工介入：当 agent 卡住时可通过 dashboard 发送指令修正，agent 恢复执行。

### Element UI 自定义操作

| 操作 | 说明 |
|------|------|
| `fillFormField(label, value)` | 填充 el-input/textarea（原生 setter，触发 Vue 响应式） |
| `selectOption(label, option)` | el-select 下拉选择，`option='first'` 选第一项 |
| `selectDate(label, dateStr)` | 设置 el-date-editor（格式 YYYY-MM-DD） |
| `clickRadio(label, option)` | 点击 el-radio |
| `clickMenuItem(text)` | 点击 el-menu-item（自动展开子菜单） |
| `clickTableRowAction(rowText, btnText)` | el-table 行内操作按钮 |
| `closeDialog()` | 关闭通知/弹窗/抽屉（优先级：notification > dialog > drawer） |
| `waitForLoading()` | 等待 el-loading-mask 消失 |
| `switchTab(name)` | 切换 el-tabs |
| `checkFieldValue(label)` | 读取表单字段当前值 |
| `clickAdjacentButton(label)` | 点击字段旁的"选择"/"引入"按钮 |
| `expandAllTreeNodes()` | 展开全部 el-tree 节点 |

### OpenCode Skills

项目包含 7 个自定义 skill，注入 Agent 提示词增强 Element UI 操控能力：

| Skill | 用途 |
|-------|------|
| `playwright-skill` | Playwright 脚本生成（已重写，注册自定义 action） |
| `atp-ui` | Element UI 组件交互最佳实践 |
| `atp-rule` | 表单字段随机值生成规则（身份证、手机号、邮箱等） |
| `cdp-agent` | CDP 连接旧版 Chrome/CEF（银行柜面系统） |
| `clarification-protocol` | 需求澄清问题生成 |
| `atp-step-gen` | 测试执行案例生成（根据需求文档生成分阶段测试案例） |

### 案例数据管理

Agent 可通过 `save_case_data(key, value)` / `read_case_data(key)` 跨阶段共享数据，数据持久化至 `scripts/case_data/` 目录。对应 REST API：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/case-data` | 案例数据列表 |
| GET | `/api/case-data/:id` | 案例数据详情（支持 `?full=1` 返回完整 JSON） |
| DELETE | `/api/case-data/:id` | 删除案例数据 |

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/agents` | Agent 列表 |
| GET | `/api/skills` | Skill 列表 |
| GET | `/api/models` | 可用模型列表 |
| POST | `/api/agent/execute` | Agent 对话（JSON 同步） |
| POST | `/api/agent/execute-async` | Agent 对话（异步提交） |
| SSE | `/api/agent/execute-stream` | Agent 对话（SSE 流式） |
| POST | `/api/agent/session` | 创建 Session |
| POST | `/api/agent/session/:id/message` | 发送消息到 Session |
| GET | `/api/agent/session/:id/messages` | 获取 Session 消息历史 |
| DELETE | `/api/agent/session/:id` | 删除 Session |
| POST | `/api/test/generate` | 生成 Playwright 脚本 |
| POST | `/api/test/refine` | 优化已生成脚本 |
| POST | `/api/test/run` | 运行脚本（SSE 流式） |
| POST | `/api/test/run-sync` | 运行脚本（JSON 同步） |
| GET | `/api/test/history` | 已生成脚本列表 |
| GET | `/api/test/history/:id` | 获取单个脚本详情 |
| DELETE | `/api/test/history/:id` | 删除已生成脚本 |
| POST | `/api/browser-use/explore` | 浏览器自动化探索（workflow 模式） |
| POST | `/api/browser/session` | 创建多轮会话 |
| POST | `/api/browser/session/:id/step` | 向会话发送子任务（SSE） |
| DELETE | `/api/browser/session/:id` | 关闭会话 |
| GET | `/api/browser/session/:id/trajectories` | 获取会话轨迹列表 |
| GET | `/api/trajectory` | 轨迹列表 |
| GET | `/api/trajectory/:id` | 轨迹详情 |
| DELETE | `/api/trajectory/:id` | 删除轨迹 |
| GET | `/api/trajectory/:id/script` | 轨迹转脚本 |
| GET | `/api/case-data` | 案例数据列表 |
| GET | `/api/case-data/:id` | 案例数据详情 |
| DELETE | `/api/case-data/:id` | 删除案例数据 |
| GET | `/v1/models` | OpenAI 兼容模型列表 |
| POST | `/v1/chat/completions` | OpenAI 兼容对话 |
| GET | `/api/test/screenshots/*` | 测试截图（静态文件） |
| GET | `/api/test` | Web Dashboard |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4097` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PROJECT_DIR` | 项目根目录 | 脚本生成目录基准路径 |
| `STANDALONE_LLM` | `false` | 设为 `true` 跳过 opencode SDK，直连 LLM API |
| `LLM_BASE_URL` | - | 独立模式下 LLM API 地址 |
| `LLM_API_KEY` | - | 独立模式下 LLM API Key |
| `PYTHON_EXE` | `D:\anaconda3\envs\browser_use\python.exe` | Python 可执行文件路径 |
| `OPENCODE_API_KEY` | - | 覆盖 `opencode.json` 中的 API Key |

## 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `opencode server not ready` | opencode CLI 未安装或未登录 | 设置 `STANDALONE_LLM=true` 跳过 |
| `ReferenceError: Headers is not defined` | Node.js < 18 | 使用 Node.js 18+ |
| Python 报 `ModuleNotFoundError` | Python 依赖未安装 | `pip install -r requirements.txt`（在 browser_use 环境） |
| Agent 重复尝试同一动作 | 上下文溢出或 Vue DOM 同步延迟 | 使用 session 模式分步执行 |
| el-select 下拉框无法选择 | readonly 属性误判 | 已修复：select_option 不再检查 readonly |
| select_option 成功仍重试 | Vue 未同步 `<input>.value` | 已修复：成功后强制设 `trigger.value` 同步 DOM |
| `dropdown.querySelectorAll is not a function` | 箭头函数非 IIFE | 已修复：改为 IIFE |

## License

MIT
