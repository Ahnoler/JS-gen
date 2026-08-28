# JS-gen 浏览器自动化录制与回放平台

JS-gen 是面向 Element UI / Vue 类业务系统的浏览器自动化后端。它接收产品前端请求，调用 LLM 分析业务任务，启动本地或远程浏览器会话，驱动 Python `browser-use` Agent 完成 AI/人工录制，并将系统层级、交易（轨迹）、阶段、步骤、截图和业务数据持久化到 MySQL。

本仓库是 Node.js 控制面，不包含完整的产品 Vue SPA。项目提供 HTTP API、前端状态 WebSocket、Executor WebSocket、Python Agent 运行时、可选远程执行机，以及前端对接用的 `/api/docs`。

> 产品主接口是 `/api/v2/*`。旧 `/api/trajectory`、旧 `/api/case-data` 等接口已下线或返回 `410 Gone`，请以运行中的 `/api/docs` 为准。

## 目录

- [功能范围](#功能范围)
- [技术架构](#技术架构)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [安装与初始化](#安装与初始化)
- [配置说明](#配置说明)
- [启动方式](#启动方式)
- [核心流程](#核心流程)
- [数据库模型](#数据库模型)
- [接口入口](#接口入口)
- [开发与验证](#开发与验证)
- [常见问题](#常见问题)

## 功能范围

| 能力 | 说明 |
| --- | --- |
| 系统层级管理 | 管理系统、模块、功能和测试账号，交易挂在功能节点下。 |
| AI 录制 | 将自然语言需求拆成阶段，启动 Agent 操作真实浏览器并保存轨迹步骤。 |
| 人工录制 | 通过 CDP 监听人工操作，转换为统一动作步骤。 |
| 轨迹回放 | 通过 live `replay_actions` 在浏览器会话中逐步回放，返回进度、结果和截图。 |
| 批量录制 | 导入 Excel 任务，分析、排队、分配执行资源并逐项录制。 |
| 业务数据和表单快照 | 保存填表数据、表单结构、特殊元素和操作组件。 |
| 截图存储 | 可使用 MinIO；上传失败的截图会写入本地暂存目录并后台重试。 |
| 执行机集群 | 通过 `/ws/executor` 管理多个执行节点和并发 slot。 |
| 伙伴平台推送 | 将完成的交易转换为伙伴平台 V3 数据并推送，具体开关和地址见 `PARTNER_*` 配置。 |
| LLM 代理 | 提供 `/v1/models` 和 `/v1/chat/completions` 兼容接口给 Python Agent。 |

旧的 Playwright 脚本组装管线、工程调试 HTML 页面和 `window.CTRL` 注入库已移除。产品前端应使用 live 回放接口和 `/api/docs`。

## 技术架构

```text
独立产品 Vue SPA
       │ HTTP / WebSocket
       ▼
Node.js Express 控制面（server.mjs，默认 :4097）
  ├── /api/v2/*       产品 API、SSO、MySQL 持久化
  ├── /api/browser/*  Session 调试接口
  ├── /v1/*           LLM 兼容代理
  ├── /ws             前端状态、进度、截图和画面
  └── /ws/executor    Executor 注册、心跳、Session 指令和事件
       │
       ├── USE_EXECUTOR=false
       │     └── Node 直接启动 Python Agent + Playwright + Chromium
       │
       └── USE_EXECUTOR=true
             └── Executor Agent + Python Agent + Chrome

MySQL：系统树、账号、交易、阶段、步骤、批任务和配置数据
MinIO：可选截图对象存储
LLM 网关：需求分析、阶段审查、场景摘要、表单规划和 Agent 决策
```

本地模式适合开发，控制面所在机器必须具备 Python 环境和 Chromium。Executor 模式适合生产或多节点部署，控制面负责调度，Executor 节点负责启动 Python/Chrome 并按 slot 隔离 CDP 端口。

## 项目结构

```text
JS-gen/
├── server.mjs                         # Node 控制面入口
├── package.json                       # npm 依赖和启动脚本
├── config/
│   ├── config.js                      # 配置读取：process.env > .env > 默认值
│   ├── database.js                    # Knex + mysql2 连接池
│   ├── knexfile.js                    # migration/seed 配置
│   ├── .env.example                   # 控制面配置示例
│   └── setup.html                     # 首次 LLM 配置页面
├── src/
│   ├── routes/v2/                     # 产品主 API，按领域拆分
│   ├── routes/browser-session/        # Session 调试、Agent 消息和 CDP 监听
│   ├── services/                      # 业务服务；trajectory/ 为轨迹子模块
│   ├── dao/                           # MySQL 数据访问层
│   ├── runtime/                       # 浏览器、Python 子进程和运行时通道
│   ├── cdp/                           # CDP 连接和页面定位辅助
│   ├── dashboard/api-docs/             # API 文档目录和前端契约
│   ├── executor-*.js                  # Executor 节点、租约和 WS 协议
│   ├── ws-server.js                   # Dashboard WebSocket
│   ├── llm-utils.js                   # 独立 LLM 调用
│   └── dedup.js                       # 连续动作去重
├── executor/
│   ├── agent.mjs                      # 远程执行机入口
│   ├── session-manager.js             # slot 和 Session 生命周期
│   ├── session-slot.js                # 单 slot 的 Python/Chrome 管理
│   ├── ws-client.js                   # 连接控制面的 WS 客户端
│   ├── bib-bridge.js                  # 浏览器画面桥接
│   └── .env.example                   # Executor 配置示例
├── scripts/
│   ├── browser-use-agent.py           # Python Agent 入口
│   ├── main.py / session_runner.py    # Agent 和会话运行逻辑
│   ├── controller/actions/             # 表单、点击、选择、导航等动作
│   ├── controller/actions/js_snippets/ # Agent 使用的浏览器 JS 片段
│   ├── manual_recorder/                # 人工录制和动作映射
│   ├── models/                         # Python 数据模型
│   ├── prompts/                        # Agent/Planner/Reviewer 提示词
│   ├── memory/                         # AI 记忆读写
│   └── requirements.txt                # Python 依赖
├── migrations/                         # Knex 增量数据库迁移
├── schemas/                            # 全量初始化 SQL 参考
├── seeds/                              # 初始层级数据
├── start-all.sh / stop-all.sh          # Linux 一键启停脚本
└── api-docs.html                       # /api/docs 页面入口
```

## 环境要求

- Node.js 18+，建议使用当前 LTS 版本。
- npm。
- MySQL 8.0+，使用 `utf8mb4`。数据库版本和排序规则应以当前 schema/migration 能支持的版本为准。
- Python 3.10+，用于本地或 Executor 侧 Agent。
- Chromium，由 Playwright 安装管理。
- 可选 MinIO，用于截图对象存储。
- Linux 非无头运行可选 Xvfb；设置 `CHROME_HEADLESS=true` 后不需要 Xvfb。
- 启用 `SSO_AUTH_REQUIRED=true` 时，需要能访问配置的 SSO/账号中心。

Node 运行依赖包括 Express、`ws`、Knex、`mysql2`、Playwright、ExcelJS、Multer、MinIO、Undici 和 PNGJS。开发依赖包括 ESLint 和 `eslint-plugin-jsdoc`，完整版本以 `package.json`/`package-lock.json` 为准。

Python 直接依赖为 `browser-use==0.1.48`、`langchain-openai`、`langchain-core`、`playwright==1.58.0` 和 `pyperclip`。Node 与 Python 的 Playwright 建议保持同为 `1.58.0`。

## 安装与初始化

### 1. 安装依赖

```bash
npm install

python -m venv .venv
# Linux/macOS
source .venv/bin/activate
# Windows PowerShell
.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
python -m pip install -r scripts/requirements.txt
```

### 2. 安装 Chromium

在实际运行 Agent 的机器执行：

```bash
npx playwright install chromium
python -m playwright install chromium
```

控制面本地模式默认将 Playwright 浏览器目录指向项目下的 `browser/`；Executor 未配置 `PLAYWRIGHT_BROWSERS_PATH` 时使用 Playwright 默认缓存目录。两侧必须能找到对应的 Chromium revision。

### 3. 配置 MySQL

先创建数据库，数据库名需与 `DB_NAME` 一致：

```sql
CREATE DATABASE js_gen CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

复制配置并填写连接信息：

```bash
cp config/.env.example config/.env
```

Windows PowerShell：

```powershell
Copy-Item config\.env.example config\.env
```

执行迁移和初始数据：

```bash
npx knex migrate:latest --knexfile config/knexfile.js
npx knex seed:run --knexfile config/knexfile.js
```

`migrations/` 是增量 schema 的真实来源；`schemas/init.sql` 是全量初始化参考。生产环境优先使用 Knex migration，不要反复执行全量 SQL 覆盖已有数据。

## 配置说明

配置加载优先级为 `process.env` > `config/.env` > 代码默认值。Executor 会读取 `config/.env` 和 `executor/.env`，Executor 配置可覆盖公共配置。

### 最小控制面配置

```env
PORT=4097
HOST=0.0.0.0

LLM_BASE_URL=https://your-llm-gateway.example.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=Qwen/Qwen3.5-35B-A3B

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASS=your-password
DB_NAME=js_gen
```

### 配置分类

| 分类 | 关键变量 | 作用 |
| --- | --- | --- |
| 服务 | `PORT`、`HOST` | HTTP 监听地址，默认 `4097`、`0.0.0.0`。 |
| 主 LLM | `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_TIMEOUT_MS` | Agent 主模型和请求超时，默认超时 120 秒。 |
| 角色 LLM | `FORM_LLM_*`、`REVIEWER_LLM_*`、`SCENARIO_LLM_*`、`L1C_LLM_MODEL` | 表单、阶段审查、场景摘要和低置信区域分类；未设置时回落主 LLM。 |
| Python | `PYTHON_EXE`、`PROJECT_DIR` | Python 解释器和项目根目录。解释器依次查显式配置、项目内 `python/python.exe`、系统 PATH。 |
| MySQL | `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASS`、`DB_NAME`、`DB_POOL_MIN/MAX` | 数据库和连接池配置。 |
| Executor | `USE_EXECUTOR`、`EXECUTOR_TOKEN`、`EXECUTOR_CAPACITY`、`EXECUTOR_CDP_PORT_BASE` | 是否使用远程执行机、鉴权、并发容量和 CDP 端口基数。 |
| Executor 心跳 | `EXECUTOR_HEARTBEAT_TIMEOUT_MS`、`EXECUTOR_DISCONNECT_TIMEOUT_MS` | 节点过期和断线后会话处理。 |
| MinIO | `MINIO_ENDPOINT`、`MINIO_PORT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`、`MINIO_PUBLIC_URL` | 截图对象存储。 |
| 截图重试 | `SCREENSHOT_PENDING_DIR`、`SCREENSHOT_RETRY_INTERVAL_MS`、`SCREENSHOT_MAX_RETRY`、`SCREENSHOT_PENDING_TTL_MS` | MinIO 不可用时的本地暂存和补传。 |
| SSO | `SSO_APP_KEY`、`SSO_BASE_URL`、`SSO_AUTH_REQUIRED`、`SSO_JWT_SECRET` | 产品登录和用户数据隔离，默认不强制鉴权。 |
| 批任务 | `BATCH_IMPORT_MAX_ROWS`、`BATCH_ANALYZE_CONCURRENCY`、`BATCH_ANALYZE_MAX_ATTEMPTS`、`BATCH_ITEM_LEASE_MS` | Excel 行数、分析并发、重试和任务租约。 |
| Agent 行为 | `MAX_ACTIONS_PER_STEP`、`PHASE_MAX_STEPS`、`AI_*`、`RELATIVE_XPATH_PRIMARY`、`XPATH_SMART_FILL_ONLY` | 动作预算、阶段上限、记忆、审查和定位策略。 |
| 伙伴平台 | `PARTNER_API_BASE`、`PARTNER_SYSTEM_BASE_URL`、`PARTNER_IMPORT_DEMAND_URL`、`PARTNER_SECTION_TYPE` | 交易/系统/需求的外部推送配置。 |

完整变量、默认值和开关语义以 [`config/.env.example`](./config/.env.example) 为准。

### Executor 配置

在 Executor 节点创建 `executor/.env`：

```env
CONTROL_PLANE_URL=http://127.0.0.1:4097
EXECUTOR_TOKEN=与控制面相同的随机长字符串
EXECUTOR_NAME=dev-worker
EXECUTOR_CAPACITY=16
EXECUTOR_CDP_PORT_BASE=19242
PYTHON_EXE=C:\path\to\python.exe
```

也可以直接设置 `EXECUTOR_WS_URL=ws://host:4097/ws/executor`。节点首次启动会生成 `executor/.node-uuid`，该文件用于保持节点身份，不要在多个节点之间复制。

## 启动方式

### 控制面

```bash
npm start
```

开发监视模式：

```bash
npm run dev
```

启动后访问：

- API 文档：<http://localhost:4097/api/docs>
- 健康检查：<http://localhost:4097/api/health>
- 首次配置：<http://localhost:4097/api/setup>
- Dashboard WebSocket：`ws://localhost:4097/ws`
- Executor WebSocket：`ws://localhost:4097/ws/executor`

根路径 `/` 在已配置时跳转到 `/api/docs`，未配置时跳转到 `/api/setup`。

### Executor

控制面启动后，在 Executor 节点执行：

```bash
npm run executor
```

开发监视模式：

```bash
npm run executor:dev
```

Executor 会校验 token、连接控制面、注册节点容量，并按 slot 接收 `session.*` 指令。slot `i` 使用 `EXECUTOR_CDP_PORT_BASE + i`，避免多浏览器 CDP 端口冲突。

### Linux 一键启动

`start-all.sh` 会尝试启动控制面、Executor 和外部 Vue 前端：

```bash
./start-all.sh
SKIP_EXECUTOR=1 ./start-all.sh
SKIP_FRONTEND=1 ./start-all.sh
```

常用变量有 `JS_GEN_DIR`、`FRONTEND_DIR`、`CONTROL_PORT`、`FRONTEND_PORT`、`CHROME_HEADLESS=true` 和 `DISPLAY_NUM=99`。非无头模式需要 Xvfb。停止服务：

```bash
./stop-all.sh
STOP_XVFB=1 ./stop-all.sh
```

脚本是 Linux/Bash 脚本；Windows 建议分别打开终端执行控制面和 Executor 命令。

## 核心流程

### AI 录制

1. `POST /api/v2/trajectories/analyze`：将需求分析为阶段，结果不落库。
2. `POST /api/v2/trajectories`：创建交易，关联功能、账号和目标 URL。
3. `POST /api/v2/trajectories/:id/attach`：分配本地浏览器或 Executor slot，建立 `remote_session` 绑定。
4. `record/prepare` 初始化阶段和运行时，`record/start` 启动 Python Agent。
5. Agent 通过 stdout/WS 上报动作、阶段、状态、截图和日志；控制面将步骤写入 `trajectory_step`。
6. `record/stop` 结束录制，但不释放执行机槽位。
7. `stream/detach` 只停止画面推流，浏览器可进入 idle 宽限状态；`detach` 才会关闭浏览器、Python 会话并释放 slot。

### 人工录制

人工录制复用浏览器 Session 和 CDP 监听器。用户操作页面时，控制面把导航、输入、选择、点击等事件映射为统一动作，经定位和连续去重后保存为步骤。

### 回放

1. 准备或附着可用浏览器会话。
2. 调用 `POST /api/v2/trajectories/:id/steps/replay`。
3. 控制面把步骤交给 live `replay_actions`，定位优先级为 `xpath_smart`、label/语义定位（含 placeholder）、`xpath_full`。
4. 通过接口和 `/ws` 获取每步结果、失败信息、修复信息和截图。产品不返回组装后的 JS 文件。

### 批量录制与伙伴推送

Excel 上传后创建 batch job 和 batch item；系统按配置调用 LLM 分析，等待 Executor slot，逐项创建交易并录制。完成后可由导出服务转换为伙伴平台 V3 数据，再通过 `PARTNER_*` 配置的接口推送。控制面重启会尝试恢复可恢复批任务。

### Executor 连接与断线

Executor 使用 token 连接 `/ws/executor` 并注册节点；控制面在 attach 时租用 slot，发送 `session.open` 和动作指令。心跳超时会清理失效节点，断线超过配置时长后关闭 Python 会话；重连后会通过 action log 和 `action_id` 幂等补写断线期间的步骤。

## 数据库模型

```text
system（根/系统/模块/功能）
  └── system_account
  └── trajectory
        ├── trajectory_phase
        ├── trajectory_step
        ├── screenshot
        └── remote_session ── executor_node

trajectory_batch_job ── trajectory
business_data / business_data_entry
operation_component / operation_component_occurrence
form_snapshot / snapshot_field
api_override / memory_* / sys_dict_* / sys_msg_*
```

核心状态：

- `trajectory.record_status`：`draft`、`recording`、`failed`、`recorded`、`completed`。
- `remote_session.status`：`active`、`idle`、`closed`、`crashed`。
- 步骤 `action_id` 用于控制面重启后的幂等补写。
- `src/dedup.js` 只去掉相邻且 `(action, params)` 相同的动作，非连续重复会保留。

## 接口入口

完整参数、响应和 WebSocket 消息以 `/api/docs` 为准。常用入口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 存活检查和默认模型。 |
| `GET` | `/api/docs` | 产品 API 文档。 |
| `POST` | `/api/v2/trajectories/analyze` | 需求分析为阶段。 |
| `GET/POST/PATCH/DELETE` | `/api/v2/trajectories*` | 交易管理。 |
| `POST` | `/api/v2/trajectories/:id/record/prepare\|start\|stop` | AI 录制生命周期。 |
| `POST` | `/api/v2/trajectories/:id/manual-record` | 人工录制。 |
| `POST` | `/api/v2/trajectories/:id/attach` | 绑定浏览器资源。 |
| `POST` | `/api/v2/trajectories/:id/stream/detach` | 停止推流，保留 idle 浏览器。 |
| `POST` | `/api/v2/trajectories/:id/detach` | 关闭资源并释放 slot。 |
| `POST` | `/api/v2/trajectories/:id/steps/replay` | 产品 live 回放。 |
| `GET/POST` | `/api/v2/executors*` | 执行机和会话管理。 |
| `GET/POST` | `/api/v2/business-data*` | 业务数据；旧 `/api/v2/case-data` 301 到此路径。 |
| `GET/POST` | `/api/v2/system-mgmt*` | 系统、模块、功能和账号。 |
| `GET/POST` | `/v1/models`、`/v1/chat/completions` | LLM 兼容代理。 |
| `WS` | `/ws` | 前端状态、进度、截图和画面。 |
| `WS` | `/ws/executor?token=...` | Executor 节点连接。 |

所有 `/api/v2` JSON 响应使用 `{ code, message, data }` 信封，并由 SSO 中间件统一处理用户隔离；`SSO_AUTH_REQUIRED=false` 时默认不强制鉴权。

## 开发与验证

```bash
npm run lint
npm run lint:fix

node scripts/characterization/characterize-dedup.mjs
node scripts/smoke/accept-replay-apis.mjs
python scripts/characterization/characterize-form-rules.py
node scripts/characterization/characterize-trajectory.mjs

bash scripts/refactor/verify-all.sh
```

这些是代码检查、characterization 和轻量 smoke，不等同于完整业务集成测试。涉及 MySQL、LLM、Chrome、MinIO 或 Executor 的功能，需要在对应依赖可用时进行端到端验证。

## 关键实现约定

- Element UI 表单使用原生 setter 和事件触发，不能只依赖 Playwright `page.fill()`。
- `el-select` 使用语义选项选择，不依赖 option span 固定下标。
- 每个动作前重新查询 DOM，因为 Vue 可能重建弹窗、抽屉和表单节点。
- 定位辅助 JS 的源文件是 `src/cdp/page-locator-helpers.js`，生成的 `scripts/controller/actions/js_snippets/_locator_helpers_js.py` 禁止手改，使用 `node scripts/_gen_locator_helpers_py.mjs` 重新生成。
- Agent 提示词位于 `scripts/prompts/`，仓库没有交付用的 `.opencode/skills/`。

## 常见问题

| 现象 | 排查 |
| --- | --- |
| `/api/trajectory` 返回 410 | 改用 `/api/v2/trajectories`。 |
| 根路径打开配置页 | 检查 `LLM_API_KEY`；也可访问 `/api/setup`。修改 `.env` 后重启控制面。 |
| MySQL 连接或迁移失败 | 检查 `DB_*`、数据库字符集和权限，执行 `npx knex migrate:latest --knexfile config/knexfile.js`。 |
| Python `ModuleNotFoundError` | 安装 `scripts/requirements.txt`，并确认 `PYTHON_EXE` 指向正确环境。 |
| 找不到 Chromium | 在运行 Agent 的机器执行两条 Playwright install 命令，检查 `PLAYWRIGHT_BROWSERS_PATH`。 |
| Executor 无法连接 | 检查 `EXECUTOR_TOKEN` 是否一致、`CONTROL_PLANE_URL`/WS 地址和防火墙。 |
| Executor 槽位满 | 查询 `GET /api/v2/executors`，关闭残留 Session 或提高 `EXECUTOR_CAPACITY`。 |
| Linux 浏览器启动失败 | 安装 Xvfb，或设置 `CHROME_HEADLESS=true`。 |
| 截图没有 URL | 检查 MinIO endpoint、密钥和 bucket，并查看 `tmp/pending-screenshots` 与日志。 |
| 找不到旧 dashboard、skills 或 assemble | 相关资产已移除，请使用独立产品前端、`/api/docs`、`scripts/prompts/` 和 live replay API。 |

## 日志与运行目录

- 一键脚本日志：`logs/server.log`、`logs/executor.log`。
- Agent stderr：默认 `logs/agent-stderr/`。
- 截图失败暂存：默认 `tmp/pending-screenshots/`。
- Executor 节点身份：`executor/.node-uuid`。
- 控制面本地 Playwright 浏览器：项目下 `browser/`。

这些目录可能包含账号、页面数据、截图和任务信息，应按生产数据进行访问控制和备份。

## License

MIT
