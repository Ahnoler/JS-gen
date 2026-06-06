# opencode-skill-use 项目规范

这是一个前后端混合的浏览器自动化测试项目。代码质量规则基于 `code-analyzer` Skill 对该项目的最新扫描结果设定。

---

## 代码规范

### 通用
- **编码**: UTF-8
- **缩进**: 2 空格（JS/HTML/CSS/JSON），4 空格（Python）
- **行尾**: LF
- **单行最大长度**: 120 字符
- **嵌套深度**: 不超过 4 层

### Node.js / JavaScript (`src/`, `*.mjs`, `*.js`)
- **语法**: ES Modules (`import`/`export`，`type: "module"`)
- **函数体**: 不超过 25 行
- **圈复杂度**: 不超过 8
- **路由模块**: 每个 route 文件 `export default function(app)`，放在 `src/routes/` 下
- **错误处理**: 所有异步路由必须用 try-catch，返回 `{ error: message }`
- **配置**: 从 `src/config.js` 导入路径常量，不要硬编码路径
- **状态管理**: 全局状态放在 `src/state.js` 的 `export const state = {}` 中
- **SSE 端点**: 使用 `text/event-stream`，带 `send(event, data)` helper；5 秒心跳保活
- **HTTP**: 使用 `express`；请求体限制 `10mb`

### Python (`web-ui/`, `scripts/`)
- **语法**: Python 3.12+
- **函数体**: 不超过 25 行
- **圈复杂度**: 不超过 8
- **导入顺序**: 标准库 → 第三方 → 本地模块（用空行分隔）
- **类型注解**: 函数参数和返回值推荐类型注解
- **路径处理**: 使用 `pathlib.Path` 或 `os.path`
- **字符串**: 优先用单引号

### HTML / CSS
- **HTML**: 语义化标签，`data-*` 属性用于 JS 挂载点
- **CSS**: 类名语义化，不使用 `!important` 除非必要

### 敏感信息
- API Key、token、密码绝对不能出现在源码中
- 开发调试用的 `***` 占位符也能暴露服务地址，应通过 `.env` 或环境变量注入
- 示例值应放在 `opencode.example.json` 中，`opencode.json` 已 gitignore

---

## 项目结构

```
opencode-skill-use/
├── src/                     # 后端 Node.js
│   ├── config.js            # 路径 + port + PYTHON_EXE + LLM 常量
│   ├── opencode.js          # OpenCode SDK 启动 + 模型加载
│   ├── state.js             # 全局状态（server、client、models、sessions）
│   ├── script-utils.js      # 脚本生成工具（prompt builder、parser、sanitizer）
│   ├── trajectory-store.js  # 轨迹存储（JSON index + CRUD）
│   ├── server.mjs           # Express 入口
│   ├── dashboard/           # 前端仪表盘模块（ES modules）
│   │   ├── index.js         # 入口文件，bootstrap 所有模块
│   │   ├── utils.js         # 通用工具函数（ts, formatTime）
│   │   ├── swagger-api.js   # Swagger 风格 API 参考数据 + render
│   │   ├── script-pipeline.js # 脚本生成/精炼/执行流水线
│   │   ├── history.js       # 测试历史管理（CRUD）
│   │   ├── trajectory.js    # 轨迹记录历史（CRUD + send to gen）
│   │   ├── execution-records.js # 浏览器会话执行记录
│   │   ├── explore.js       # AI Explore（Browser Use + SSE）
│   │   ├── session-mode.js  # Multi-Turn Session 模式
│   │   └── particles.js     # 粒子背景动画
│   └── routes/              # 路由模块
│       ├── agent.js         # /api/agent/* 会话管理
│       ├── sse.js           # /api/agent/execute-stream SSE
│       ├── test-gen.js      # /api/test/generate 脚本生成
│       ├── test-run.js      # /api/test/run 脚本执行
│       ├── test-history.js  # /api/test/history CRUD
│       ├── health.js        # /api/health
│       ├── llm-proxy.js     # /v1/chat/completions OpenAI 兼容代理
│       ├── trajectory.js    # /api/trajectory CRUD
│       ├── explore-utils.js # 共享工具（kill、SSE、spawn、parse等）
│       ├── explore-route.js # /api/browser-use/explore SSE
│       ├── browser-session.js # /api/browser/session/* 会话模式
│       └── browser-use-explore.js  # [旧版备份] 原 905 行单体文件
├── web-ui/                  # 前端 Python（Gradio）
│   └── src/
│       ├── agent/           # agent 实现（browser_use_agent, deep_research）
│       ├── browser/         # 浏览器实例管理
│       ├── controller/      # Playwright controller
│       ├── utils/           # 工具（config, llm_provider, mcp_client）
│       └── webui/           # Gradio UI（interface, components, webui_manager）
├── scripts/                 # Python 工具脚本（ESM 化完成）
│   ├── __init__.py
│   ├── main.py              # 精简主入口（37 行，仅路由到对应模式）
│   ├── agent_utils.py       # 共享工具：args, LLM, prompts, 通用回调
│   ├── form_rules.py        # 表单字段数据生成器和规则匹配
│   ├── controller.py        # Element UI 自定义 Controller actions（15个）
│   ├── recorder.py          # 步骤录制钩子（目标去重检测 + cancel）
│   ├── session_runner.py    # 交互式会话模式（stdin/stdout）
│   ├── workflow_runner.py   # 工作流模式 + 单任务模式
│   ├── playwright_gen.py    # Playwright 脚本生成器补丁
│   ├── browser-use-agent.py # 兼容入口，委托给 main.py
│   ├── browser-use-agent.py.bak # 原始单体文件备份
│   ├── element-ui-knowledge.md
│   └── generated/           # 自动生成的 Playwright 脚本（gitignored）
├── .opencode/skills/        # OpenCode skill 定义
├── test-dashboard.js        # 旧版单体仪表盘（已拆分保留参考）
├── test-dashboard.html      # 仪表盘 HTML（引用 src/dashboard/index.js）
├── test-dashboard.css
├── opencode.json            # OpenCode 配置（gitignored，含真实 API key）
├── opencode.example.json    # 示例配置
└── start.ps1                # 启动脚本
```

---

## 重构优先级（基于 `code-analyzer` 分析）

### 已完成
- **`test-dashboard.js`**（2074 行）→ 已拆分为 `src/dashboard/` 下的 9 个 ES modules（2026-06-04）
- **`browser-use-agent.py`**（1267 行）→ 拆分为 `scripts/` 下的 8 个 Python 模块（2026-06-04）
  - 去除了 main.py 和 session_runner.py 之间的重复回调定义
  - 提取了 workflow_runner.py（workflow + single-task 模式）
  - main.py 从 157 行精简到 37 行入口路由

### 下一级优化空间 — 已完成
- ~~**`session_runner.py`**（217 行）中的 stdin event 处理可以提取独立函数~~ → 已提取 `_stdin_reader` + `_dispatch_event` 函数（2026-06-06）
- **`controller.py`**（467 行）中的每个 action 可以单独拆文件（但当前 15 个 action 高度关联，暂时保持合理）

### 二级（函数级重构）— 已完成
3. ~~**`build_controller`**（复杂度 129）→ 已分解为多个 builder~~
4. ~~**`renderSwaggerUI`**（复杂度 30，215 行）→ 已复用组件~~
5. ~~**`executeSessionStep`**（复杂度 22）→ 已拆分状态机~~

### 三级（深层嵌套问题）— 已完成
6. ~~**`controller.py`** 嵌套 4+ 层 → 提取 `JS_GET_CONTAINER` / `JS_FIND_VISIBLE_DROPDOWN` / `JS_CHECK_SELECTS` / `JS_TRIGGER_SELECT` / `JS_CONFIRM_SELECT` 公共 helper，早返回减少嵌套（2026-06-06）~~

### 四级（架构优化）— 已完成
7. ~~**`browser-use-explore.js`**（905 行，限制 300）→ 已拆分为 explore-utils.js + explore-route.js + browser-session.js（2026-06-06）~~
8. ~~**硬编码路径 `D:\anaconda3\...`** → 已移入 `config.js` 的 `PYTHON_EXE` 环境变量（2026-06-06）~~
9. ~~**`select_option`** 156 行 + 5× 重复 overlay 检测 → 提取 `JS_GET_CONTAINER` / `JS_FIND_VISIBLE_DROPDOWN` 公共 DOM helper（2026-06-06）~~
10. ~~**`agent_utils.py`** fallback 默认值 `sk-opencode` / `localhost:4097` → 已改为 `create_llm()` 中 base_url/api_key 必填校验（2026-06-06）~~
11. ~~**`renderPhasePlan`** 87 行 → 已拆分为 `buildPhaseCarouselHtml` + `bindPhaseCarouselEvents`（2026-06-06）~~

### 五级（独立运行模式）— 已完成
12. ~~**Standalone LLM 模式** — 绕过 `opencode serve` 的认证问题，直接启动 browser-use agent 并使用自己的 LLM（`STANDALONE_LLM=true`），不依赖 OpenCode SDK（2026-06-06）~~

---

## 使用提示

- 运行服务: `.\start.ps1` 或 `node server.mjs`
- 对特定路径运行检查: `python code-analyzer/analyze.py <target_dir> <output_dir>`
- 每个路由模块不要超过 300 行
- 新 route 文件在 `server.mjs` 中注册 `registerXxxRoutes(app)` 模式
