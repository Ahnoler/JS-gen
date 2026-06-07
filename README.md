# OpenCode Agent API

基于 [OpenCode AI SDK](https://opencode.ai) 的 Agent HTTP 服务，提供 AI 对话、Playwright 测试脚本生成与执行能力，附带 Web Dashboard。

## 功能

- **Agent 对话** — 通过 REST API 与 AI Agent 交互，支持 SSE 流式响应
- **脚本生成** — 根据自然语言描述生成 Playwright 测试脚本，支持上传参考脚本
- **脚本执行** — 自动运行生成的脚本，实时查看日志和截图
- **Swagger API 文档** — 内置交互式 API 文档
- **Web Dashboard** — 单页面仪表盘，集成 API 调试、脚本生成、手动执行

## 环境要求

- **Node.js** 18+
- **AI 模型服务** — 兼容 OpenAI API 的推理后端（如 Ollama、vLLM 等）
- **Chromium**（可选，执行 Playwright 测试脚本时需要）

  ```bash
  npx playwright install chromium
  ```

## 快速开始

### 1. 安装依赖

```bash
npm install
  ```

### 2. 配置 AI 模型

编辑 `opencode.json`，修改 `baseURL` 和 `apiKey` 指向你的 AI 服务：

```json
{
  "provider": {
    "myprovider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": {
        "baseURL": "http://your-ai-host:port/v1",
        "apiKey": "your-api-key"
      },
      "models": {
        "GLM-5": { "_launch": true, "name": "GLM-5" }
      }
    }
  }
}
```

`agent-api.config.json` 指定使用的模型：

```json
{
  "models": [{ "provider": "myprovider", "model": "GLM-5" }],
  "defaultModel": "myprovider/GLM-5"
}
```

### 3. 启动服务

```bash
npm start
```

服务默认监听 `http://0.0.0.0:4097`，可通过环境变量覆盖：

```bash
PORT=8080 HOST=127.0.0.1 npm start
```

### 4. 访问 Dashboard

浏览器打开 `http://localhost:4097`

## 项目结构

```
├── server.mjs                 # 主入口，组装各模块启动 HTTP 服务
├── src/
│   ├── config.js              # 配置常量（端口、路径等）
│   ├── state.js               # 全局运行时状态（client、cache 等）
│   ├── opencode.js            # opencode 服务初始化
│   ├── script-utils.js        # 脚本生成/解析工具函数
│   ├── trajectory-store.js    # 轨迹存储（JSON index + CRUD）
│   ├── dashboard/             # Web Dashboard 前端逻辑（ESM 模块）
│   │   ├── index.js           # 入口：DOM 事件绑定、Tab 切换、健康检查
│   │   ├── swagger-api.js     # Swagger API 文档渲染
│   │   ├── script-pipeline.js # 脚本生成/精炼/运行流水线
│   │   ├── history.js         # 执行历史管理
│   │   ├── trajectory.js      # 轨迹记录管理
│   │   ├── execution-records.js # 执行记录
│   │   ├── explore.js         # AI Explore (Browser Use)
│   │   ├── session-mode.js    # Multi-Turn Session 模式
│   │   ├── particles.js       # 粒子背景动画
│   │   └── utils.js           # 工具函数
│   └── routes/
│       ├── health.js          # GET /api/health, /api/models, /api/agents, /api/skills
│       ├── agent.js           # Agent 会话 CRUD + execute
│       ├── test-gen.js        # POST /api/test/generate, /api/test/refine
│       ├── test-history.js    # GET/DELETE /api/test/history
│       ├── test-run.js        # POST /api/test/run, /api/test/run-sync
│       ├── sse.js             # GET /api/agent/execute-stream (SSE)
│       ├── llm-proxy.js       # /v1/chat/completions OpenAI 兼容代理
│       ├── trajectory.js      # /api/trajectory CRUD
│       └── browser-use-explore.js # 浏览器自动化探索路由
├── scripts/                   # Python 工具脚本
│   ├── main.py                # Browser Use Agent 入口（支持 --task/--workflow/--session）
│   ├── browser-use-agent.py   # 后向兼容入口，委托给 main.py
│   ├── agent_utils.py         # Agent 工具函数（参数解析、LLM 创建、知识库注入）
│   ├── controller.py          # Playwright controller（含 build_controller）
│   ├── session_runner.py      # 多轮会话运行器
│   ├── workflow_runner.py     # 工作流执行器
│   ├── playlist_gen.py        # Playwright 脚本生成
│   ├── form_rules.py          # 表单规则处理
│   ├── recorder.py            # 轨迹记录
│   ├── __init__.py            # 包初始化
│   ├── generated/             # AI 生成的脚本存放目录
│   └── element-ui-knowledge.md # Element UI 知识库
├── test-dashboard.html        # Web Dashboard 页面结构
├── test-dashboard.css         # Dashboard 样式
├── test-dashboard.js          # Dashboard 交互逻辑（旧入口，逻辑已拆分至 src/dashboard/）
├── opencode.json              # AI 模型与 Skill 权限配置
├── opencode.example.json      # 模型配置模版（不含真实凭据）
├── agent-api.config.json      # 默认模型配置
├── CLAUDE.md                  # 项目编码规范
├── package.json               # 依赖声明
├── start.ps1                  # 一键启动脚本
├── dictList/                  # 词典数据
├── docs/                      # 文档
├── report/                    # 测试报告
└── snapshots/                 # 测试截图
```

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| GET | `/api/agents` | Agent 列表 |
| GET | `/api/skills` | Skill 列表 |
| GET | `/api/models` | 可用模型列表 |
| POST | `/api/agent/execute` | Agent 对话（JSON 同步） |
| POST | `/api/agent/execute-async` | Agent 对话（异步提交） |
| GET | `/api/agent/execute-stream` | Agent 对话（SSE 流式） |
| POST | `/api/agent/session` | 创建 Session |
| POST | `/api/agent/session/:id/message` | 发送消息到 Session |
| GET | `/api/agent/session/:id/messages` | 获取 Session 消息历史 |
| DELETE | `/api/agent/session/:id` | 删除 Session |
| POST | `/api/test/generate` | 生成 Playwright 脚本 |
| POST | `/api/test/refine` | 优化已生成脚本 |
| GET | `/api/test/history` | 已生成脚本列表 |
| GET | `/api/test/history/:id` | 获取单个脚本详情 |
| DELETE | `/api/test/history/:id` | 删除已生成脚本 |
| POST | `/api/browser-use/explore` | 浏览器自动化探索任务（workflow 模式） |
| POST | `/api/browser/session` | 创建多轮会话（session 模式） |
| POST | `/api/browser/session/:id/step` | 向会话发送子任务指令 |
| DELETE | `/api/browser/session/:id` | 关闭会话 |
| GET | `/api/browser/session/:id/trajectories` | 获取会话轨迹列表 |
| POST | `/api/trajectory/save` | 保存轨迹记录 |
| GET | `/api/test/screenshots/*` | 测试截图（静态文件） |
| GET | `/api/test` | Web Dashboard |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `4097` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PROJECT_DIR` | 项目根目录 | 脚本生成目录基准路径 |
| `OPENCODE_API_KEY` | - | 覆盖 `opencode.json` 中的 API Key（避免硬编码） |

## Browser Use / 浏览器自动化集成

本服务集成了 [Browser Use](https://github.com/browser-use/browser-use) 浏览器自动化框架，通过 opencode LLM 代理实现自然语言驱动的浏览器操控。

### 架构

```
Browser Use Web UI (Gradio, port 7788)
  ↓ 自然语言任务 → LLM 决策 → CDP 操控浏览器
opencode LLM Proxy (Node.js, port 4097)
  ↓ POST /v1/chat/completions
opencode Go 云服务 (opencode-go/mimo-v2.5, kimi-k2.5, deepseek-v4-pro 等)
```

### 组件路径

| 组件 | 路径 |
|------|------|
| opencode Agent API | `/` (当前项目) |
| Browser Use SDK | `D:\dev\browser-use-main` |
| Python 环境 | `D:\anaconda3\envs\browser_use` |

### 工作模式

**1. Workflow 模式（一次性执行）**

通过 `POST /api/browser-use/explore` 提交包含多个阶段的完整任务，Python Agent 按顺序执行所有阶段后退出。适用于全自动运行场景。

**2. Session 模式（多轮对话，新增）**

通过多个 API 调用实现分步交互：
- `POST /api/browser/session` — 创建浏览器会话
- `POST /api/browser/session/:id/step` — 发送子任务指令，SSE 实时推送结果
- `DELETE /api/browser/session/:id` — 关闭会话

浏览器跨步骤保持打开，每阶段 `max_steps=40`，每个 step 独立保存轨迹文件到 `/tmp/browser_use_session_*`。

### 关键文件

| 文件 | 说明 |
|------|------|
| `scripts/main.py` | Python Agent 主入口，支持 `--task`/`--workflow`/`--session` 三种模式 |
| `scripts/browser-use-agent.py` | 后向兼容入口，委托给 `main.py` |
| `scripts/controller.py` | Playwright controller（含 build_controller） |
| `scripts/session_runner.py` | 多轮会话运行器 |
| `scripts/workflow_runner.py` | 工作流执行器 |
| `scripts/playwright_gen.py` | Playwright 脚本生成 |
| `scripts/form_rules.py` | 表单规则处理 |
| `scripts/recorder.py` | 轨迹记录 |
| `scripts/agent_utils.py` | 工具函数（参数解析、LLM 创建、知识库注入） |
| `scripts/element-ui-knowledge.md` | Element UI 知识库，作为系统提示注入 Agent |
| `src/routes/browser-use-explore.js` | Workflow 探索路由 |
| `src/routes/llm-proxy.js` | OpenAI 兼容代理 (`/v1/models`, `/v1/chat/completions`) |
| `src/routes/trajectory.js` | 轨迹保存与回放 |
| `src/script-utils.js` | 脚本生成工具 |

### 可用 LLM 模型 (通过 opencode Go 服务)

```
opencode-go/mimo-v2.5      opencode-go/mimo-v2.5-pro
opencode-go/kimi-k2.5      opencode-go/kimi-k2.6
opencode-go/deepseek-v4-flash  opencode-go/deepseek-v4-pro
opencode-go/glm-5          opencode-go/glm-5.1
opencode-go/qwen3.6-plus   opencode-go/qwen3.5-plus
opencode-go/minimax-m2.5   opencode-go/minimax-m2.7
```

### 轨迹与脚本生成

Browser Use 执行结束后会生成轨迹 JSON 文件（`AgentHistoryList`），包含每一步的模型输出、DOM 状态、截图等完整信息。轨迹文件可通过以下途径使用：
- `GET /api/trajectory/:id` — 查看轨迹详情
- 轨迹可转换为 Playwright 脚本，用于后续回放或人工修改
- Session 模式下每阶段独立保存轨迹

### 常见问题

| 现象 | 原因 | 解决 |
|------|------|------|
| `opencode server not ready` | opencode CLI 未安装或未登录 | `opencode --version` 检查 |
| `ReferenceError: Headers is not defined` | Node.js < 18 | `nvm use 24.14.1` |
| 模型列表为空 | Go 服务未连接 | 检查 opencode 登录状态 |
| Agent 重复尝试同一动作 | 上下文溢出或 el-select readonly 误判 | 使用 session 模式分步执行 |
| el-select 下拉框无法选择 | readonly 属性被误判为不可交互 | 已修复：select_option 不再检查 readonly |
| select_option 返回成功但 LLM 仍重试下拉框 | Vue 未同步 DOM 的 `<input>.value`，LLM 读取到空值判定"未选中" | 已修复：select_option 成功后强制设 `trigger.value` 同步 DOM 状态，LLM 下次读到非空即判定已选中 |
| `TypeError: dropdown.querySelectorAll is not a function` | `JS_FIND_VISIBLE_DROPDOWN` 为普通箭头函数而非 IIFE，被字符串拼接后成为函数引用而非执行结果 | 已修复：改为 `(() => { ... })()` IIFE |

## License

MIT
