# JS-gen 浏览器自动化控制面

JS-gen 是面向 Element UI / Vue 类业务系统的浏览器自动化后端。它负责接收产品前端请求，调用 LLM 分析业务任务，启动本地或远程浏览器会话，驱动 Python `browser-use` Agent 完成录制，并将系统层级、交易（轨迹）、阶段、步骤、截图和业务数据持久化到 MySQL。

本仓库是 **Node.js 控制面**，不是完整的产品前端。产品 SPA 位于独立的 Vue 仓库；本项目提供后端 API、WebSocket、Python Agent 运行时、可选的 Executor Agent，以及前端对接用的 `/api/docs`。

> 当前产品主接口是 `/api/v2/*`，基于 MySQL。旧 `/api/trajectory`、旧 `/api/case-data` 等接口已下线或返回 `410 Gone`，不要根据旧文档接入。

## 目录

- [功能范围](#功能范围)
- [运行架构](#运行架构)
- [环境要求](#环境要求)
- [安装与初始化](#安装与初始化)
- [配置说明](#配置说明)
- [启动方式](#启动方式)
- [核心业务流程](#核心业务流程)
- [模块说明](#模块说明)
- [接口入口](#接口入口)
- [数据库](#数据库)
- [开发与验证](#开发与验证)
- [常见问题](#常见问题)

## 功能范围

| 能力 | 说明 |
| --- | --- |
| 系统层级管理 | 维护系统、模块、功能和测试账号，交易挂在功能节点下。 |
| AI 录制 | 将需求分析为阶段，启动 Agent 操作真实浏览器，实时接收动作并保存为轨迹步骤。 |
| 人工录制 | 通过浏览器会话和 CDP 监听人工操作，转换为可回放步骤。 |
| 轨迹回放 | 产品主路径是附着会话内的 live `replay_actions`，按步骤重新操作浏览器并回传进度、结果和截图。 |
| 批量录制 | 导入 Excel 任务，分析、排队、分配执行资源并按任务保存交易。 |
| 业务数据 | 管理填表所需的业务数据、表单快照、特殊元素和操作组件。 |
| 截图与对象存储 | 截图可上传 MinIO；上传失败时写入本地暂存目录并由后台重试。 |
| 执行机集群 | 控制面通过 `/ws/executor` 管理一个或多个 Executor Agent，每个节点按槽位限制并发浏览器。 |
| LLM 代理 | `/v1/models`、`/v1/chat/completions` 提供给 Python Agent 的 OpenAI 兼容转发入口。 |

旧的 Playwright 脚本组装、工程调试 HTML 页面和 `window.CTRL` 注入库已移除。产品前端应使用 live 回放接口和 `/api/docs` 中的当前契约。

## 运行架构

```text
产品 Vue SPA（独立仓库）
          │ HTTP / WebSocket
          ▼
Node.js Express 控制面（server.mjs，默认 :4097）
  ├── /api/v2/*       产品 API、SSO、MySQL 持久化
  ├── /api/browser/*  浏览器 Session 调试接口
  ├── /v1/*           LLM 兼容代理
  ├── /ws             前端状态、进度、截图和画面推送
  └── /ws/executor    Executor 注册、心跳、Session 指令和事件
          │
          ├── 本地模式 USE_EXECUTOR=false
          │     └── Node 直接启动 Python Agent
          │           └── Playwright / Chromium
          │
          └── 执行机模式 USE_EXECUTOR=true
                └── Executor Agent（另一进程/机器）
                      └── Python Agent + Chrome，按 slot 分配 CDP 端口

MySQL：系统树、账号、remote_session、trajectory、phase、step、截图、批任务等
MinIO：可选的截图对象存储
LLM 网关：任务分析、阶段审查、场景摘要、表单规划和 Agent 决策
```

### 两种浏览器运行模式

- **本地模式**：控制面所在机器必须安装 Python Agent 依赖和 Chromium。适合单机开发；`USE_EXECUTOR=false`。
- **Executor 模式**：控制面只负责调度，Executor 机器运行 `npm run executor`，通过 WebSocket 反向连接控制面。适合生产或多节点；控制面和 Executor 的 `EXECUTOR_TOKEN` 必须一致。

## 环境要求

### 必需软件

- Node.js，建议使用当前 LTS 版本。
- npm。
- MySQL 8.0 或兼容版本，字符集使用 `utf8mb4`。
- Python 3.10+，用于本地或 Executor 侧 Agent。
- Chromium，由 Playwright 安装并管理。

### 可选软件

- MinIO：保存截图对象。不配置时，截图上传能力不可用，但失败截图会先暂存到本地。
- Xvfb：Linux 非无头运行时需要。设置 `CHROME_HEADLESS=true` 后不需要 Xvfb。
- 账号中心/SSO：启用 `SSO_AUTH_REQUIRED=true` 时需要可访问配置的 SSO 服务。
- 独立产品前端：`start-all.sh` 可尝试同时启动外部 Vue 项目，但该前端不在本仓库内。

### Node 依赖

`npm install` 会安装以下运行依赖：

- `express`：HTTP 控制面。
- `ws`：Dashboard 和 Executor WebSocket。
- `knex`、`mysql2`：MySQL 连接池、迁移和 DAO。
- `playwright`：本地浏览器及 CDP 操作。
- `exceljs`、`multer`：Excel 导入导出和上传。
- `minio`：截图对象存储。
- `undici`：HTTP/LLM/伙伴平台请求。
- `pngjs`：PNG 截图处理。

开发依赖包括 `eslint` 和 `eslint-plugin-jsdoc`。

### Python 依赖

安装 `scripts/requirements.txt`：

```bash
python -m venv .venv
# Linux/macOS
source .venv/bin/activate
# Windows PowerShell
.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
python -m pip install -r scripts/requirements.txt
```

当前直接依赖为 `browser-use==0.1.48`、`langchain-openai`、`langchain-core`、`playwright==1.58.0` 和 `pyperclip`。Node 与 Python 的 Playwright 版本应保持 `1.58.0`，之后安装同一版本的 Chromium。

## 安装与初始化

### 1. 安装 Node 依赖

```bash
npm install
```

`npm install` 还会通过 `prepare` 配置项目的 Git hooks 路径。若不需要开发 hooks，可忽略其提示，但不要把生成的密钥提交到仓库。

### 2. 创建 MySQL 数据库

先创建数据库和账号，推荐数据库名与配置保持一致：

```sql
CREATE DATABASE js_gen CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

然后复制并编辑配置：

```bash
cp config/.env.example config/.env
```

Windows PowerShell：

```powershell
Copy-Item config\.env.example config\.env
```

运行迁移：

```bash
npx knex migrate:latest --knexfile config/knexfile.js
npx knex seed:run --knexfile config/knexfile.js
```

`migrations/` 是增量 schema 的真实来源；`schemas/init.sql` 是全量初始化参考脚本，使用它时应确认其中的数据库名与 `DB_NAME` 一致，并在导入后仍执行未包含的迁移。生产环境优先使用 Knex migration，不要反复执行全量 SQL 覆盖现有数据。

### 3. 安装 Chromium

默认情况下 Playwright 使用自己的缓存目录：

```bash
npx playwright install chromium
python -m playwright install chromium
```

控制面配置会把本地模式的浏览器目录指向项目下的 `browser/`；Executor 默认使用 Playwright 标准缓存目录，也可以通过 `PLAYWRIGHT_BROWSERS_PATH` 固定目录。两侧必须能找到同一 Chromium revision。

### 4. 配置 LLM

至少配置 `LLM_BASE_URL`、`LLM_MODEL` 和可用的 `LLM_API_KEY`。如果暂时没有手工创建 `config/.env`，启动后可访问 `/api/setup` 写入主 LLM 配置。

## 配置说明

配置加载优先级为：`process.env` > `config/.env` > 代码默认值。Executor 还会读取 `executor/.env`，其配置覆盖 `config/.env`。

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

### 配置项分类

| 分类 | 关键变量 | 用途 |
| --- | --- | --- |
| 服务 | `PORT`、`HOST` | HTTP 监听端口和地址，默认 `4097`、`0.0.0.0`。 |
| LLM | `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_TIMEOUT_MS` | 主 Agent 模型、网关、密钥和超时。默认超时 120 秒。 |
| 角色模型 | `FORM_LLM_*`、`REVIEWER_LLM_*`、`SCENARIO_LLM_*`、`L1C_LLM_MODEL` | 表单、阶段审查、场景摘要、低置信区域分类；未配置时回落主 LLM。 |
| Python | `PYTHON_EXE`、`PROJECT_DIR` | Python 解释器和项目根目录；解释器依次查显式配置、项目内 `python/python.exe`、系统 PATH。 |
| MySQL | `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASS`、`DB_NAME`、`DB_POOL_MIN/MAX` | Knex 连接池，默认池大小 `2` 到 `10`。 |
| 执行机 | `USE_EXECUTOR`、`EXECUTOR_TOKEN`、`EXECUTOR_HEARTBEAT_TIMEOUT_MS`、`EXECUTOR_DISCONNECT_TIMEOUT_MS` | 是否走远程 Executor、鉴权和断线处理。未配置 token 时拒绝 Executor 连接。 |
| 截图 | `MINIO_ENDPOINT/PORT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`、`MINIO_PUBLIC_URL` | MinIO 连接和截图桶；失败暂存由 `SCREENSHOT_*` 控制。 |
| SSO | `SSO_APP_KEY`、`SSO_BASE_URL`、`SSO_AUTH_REQUIRED`、`SSO_JWT_SECRET` | 产品用户身份和数据隔离。默认不强制鉴权。 |
| 批任务 | `BATCH_IMPORT_MAX_ROWS`、`BATCH_ANALYZE_CONCURRENCY`、`BATCH_ANALYZE_MAX_ATTEMPTS`、`BATCH_ITEM_LEASE_MS` | Excel 行数、分析并发、重试和租约。 |
| Agent 行为 | `MAX_ACTIONS_PER_STEP`、`PHASE_MAX_STEPS`、`AI_*`、`RELATIVE_XPATH_PRIMARY`、`XPATH_SMART_FILL_ONLY` | Agent 动作预算、阶段上限、记忆、审查、定位策略等灰度开关。 |

完整变量及默认值以 [`config/.env.example`](./config/.env.example) 为准。执行机专属示例见 [`executor/.env.example`](./executor/.env.example)。

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

也可直接设置 `EXECUTOR_WS_URL=ws://host:4097/ws/executor`。节点首次启动会生成 `executor/.node-uuid`，该文件用于保持节点身份，不应在多个节点之间复制。

## 启动方式

### 仅启动控制面

```bash
npm start
```

开发时使用文件监视：

```bash
npm run dev
```

启动后：

- API 文档：<http://localhost:4097/api/docs>
- 健康检查：<http://localhost:4097/api/health>
- 首次配置：<http://localhost:4097/api/setup>
- Dashboard WebSocket：`ws://localhost:4097/ws`
- Executor WebSocket：`ws://localhost:4097/ws/executor`

根路径 `/` 在已配置时跳转到 `/api/docs`，未配置时跳转到 `/api/setup`。

### 启动独立 Executor

在控制面已启动且 Executor 配置完成的终端执行：

```bash
npm run executor
```

开发监视模式：

```bash
npm run executor:dev
```

Executor 启动时会校验 token，连接控制面，注册节点容量，之后按槽位接收 `session.*` 指令。每个槽位使用 `EXECUTOR_CDP_PORT_BASE + slotIndex`，避免多个 Chrome 的 CDP 端口冲突。

### 一键启动 Linux 环境

`start-all.sh` 会尝试启动控制面、Executor 和外部 Vue 前端，默认端口分别为 `4097`、Executor 由配置决定、前端 `3000`：

```bash
./start-all.sh
SKIP_EXECUTOR=1 ./start-all.sh
SKIP_FRONTEND=1 ./start-all.sh
```

常用环境变量：`JS_GEN_DIR`、`FRONTEND_DIR`、`CONTROL_PORT`、`FRONTEND_PORT`、`CHROME_HEADLESS=true`、`DISPLAY_NUM=99`。非无头模式要求安装 Xvfb。停止服务：

```bash
./stop-all.sh
STOP_XVFB=1 ./stop-all.sh
```

该脚本是 Linux/Bash 脚本，Windows 建议分别打开终端执行 `npm start` 和 `npm run executor`。

## 核心业务流程

### AI 录制

1. 前端调用 `POST /api/v2/trajectories/analyze`，把需求拆成阶段；分析结果此时不落库。
2. 前端调用 `POST /api/v2/trajectories` 创建交易，关联系统功能、测试账号、URL 等上下文。
3. 调用 `POST /api/v2/trajectories/:id/attach` 分配本地浏览器或 Executor slot，创建 `remote_session` 绑定。
4. 调用 `record/prepare` 初始化阶段和运行时，再调用 `record/start` 启动 Python Agent；Agent 通过 stdout/WS 上报步骤、阶段、状态、截图和日志。
5. 控制面在每个动作前重新查询 DOM，按 Element UI 规则执行填表、下拉、按钮、树和弹窗操作，动作结果写入 `trajectory_step`。
6. `record/stop` 停止本次录制并保存结果，但 **不会释放执行机槽位**。
7. 前端可以调用 `stream/detach` 停止画面推流，浏览器进入 idle 宽限状态；需要彻底关闭浏览器、Python 会话并释放槽位时调用 `detach`。

### 人工录制

人工录制复用浏览器 Session 和 CDP 事件监听器。用户在浏览器中操作，控制面将监听到的导航、输入、选择、点击等事件映射为统一动作，经过去重和元素定位处理后持久化为步骤。人工录制也必须在结束后调用真正的 `detach` 回收资源。

### 回放

1. 先创建或附着一个可用的交易/浏览器会话。
2. 调用 `POST /api/v2/trajectories/:id/steps/replay`，控制面将已保存步骤交给 live `replay_actions` 执行。
3. 回放优先使用 `xpath_smart`，然后尝试 label/语义定位（包括 placeholder），最后才使用 `xpath_full`；同时限定可见 dialog/drawer 范围并剥离易变树文本。
4. 通过 `/ws` 和接口响应接收动作进度、成功/失败、截图和修复信息。产品不会返回组装后的 JS 文件。

### 批量录制

Excel 上传后，系统创建 batch job 和 batch item；分析阶段按 `BATCH_ANALYZE_CONCURRENCY` 调用 LLM，随后等待可用 Executor slot，逐项创建交易并执行录制。控制面重启时会恢复可恢复任务，调度器继续处理等待中的项目；单项失败按 `BATCH_ANALYZE_MAX_ATTEMPTS` 重试。

### 执行机连接与断线

1. Executor 用 token 连接 `/ws/executor` 并发送节点注册信息。
2. 控制面记录节点和容量，交易 attach 时租用一个 slot。
3. 控制面发送 `session.open`、动作或录制指令；Executor 启动 Python Agent/Chrome 并回传 `session.ready`、动作事件和二进制画面。
4. 心跳超时会清理失效节点。Executor 断线超过 `EXECUTOR_DISCONNECT_TIMEOUT_MS` 后会关闭其 Python 会话，防止浏览器继续执行但动作事件静默丢失。
5. Executor 重连后会补拉 action log，控制面按 `action_id` 幂等补写断线期间缺失的步骤。

## 模块说明

| 模块 | 目录/入口 | 职责 |
| --- | --- | --- |
| 控制面启动 | [`server.mjs`](./server.mjs) | 创建 Express/HTTP 服务，注册路由和两个 WebSocket，启动后台清理、批任务恢复和状态对账。 |
| 配置与数据库 | [`config/`](./config) | 读取 `.env`、解析运行参数、创建 Knex MySQL 连接池、提供 migration 配置。 |
| 产品 API | [`src/routes/v2/`](./src/routes/v2) | `/api/v2` 主路由，覆盖认证、层级、交易、录制、步骤、批任务、截图、执行机、业务数据、记忆和导出。所有响应使用 `{ code, message, data }` 信封。 |
| Session 调试 API | [`src/routes/browser-session/`](./src/routes/browser-session) | 本地/远程浏览器会话注册、动作执行、Agent 消息、CDP 监听和调试生命周期。 |
| 运行时 | [`src/runtime/`](./src/runtime) | 管理全局浏览器、Python Agent 子进程、脚本执行、SSE/事件通道和模型解析。 |
| 轨迹服务 | [`src/services/trajectory/`](./src/services/trajectory) | 交易查询、阶段、步骤、录制 attach、持久化、回放、批处理、截图和状态恢复。`index.js` 对外重新导出公共能力。 |
| Executor 控制面 | [`src/executor-*.js`](./src) | 节点注册、心跳、WebSocket 消息、slot lease、Session 调度和二进制画面转发。 |
| Executor Agent | [`executor/`](./executor) | 运行在独立节点，维护 slot、CDP 端口、Python 子进程、BiB 画面桥接和 WS 自动重连。 |
| Python Agent | [`scripts/`](./scripts) | `browser-use` Agent、Session Runner、表单动作、CDP 监听、人工录制、模型和记忆逻辑。入口为 `scripts/browser-use-agent.py` / `scripts/main.py`。 |
| 浏览器 JS 片段 | [`scripts/controller/actions/js_snippets/`](./scripts/controller/actions/js_snippets) | Agent 侧控件操作片段。定位辅助 JS 源在 `src/cdp/page-locator-helpers.js`，Python 文件由生成脚本产生，禁止手改生成物。 |
| 数据访问层 | [`src/dao/`](./src/dao) | MySQL 表的查询、创建、更新和事务封装。 |
| 前端文档 | [`api-docs.html`](./api-docs.html)、`src/dashboard/api-docs/` | `/api/docs` 的接口目录和交互式文档，是前端对接的唯一契约。 |
| 数据库结构 | [`migrations/`](./migrations)、[`schemas/`](./schemas) | 增量迁移、全量初始化参考 SQL 和 memory 表结构。 |

## 接口入口

完整参数、响应和 WebSocket 消息以运行中的 `/api/docs` 为准。常用入口如下：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 存活检查和默认模型。 |
| `GET` | `/api/docs` | 产品 API 文档。 |
| `POST` | `/api/v2/trajectories/analyze` | 需求分析为阶段。 |
| `GET/POST/PATCH/DELETE` | `/api/v2/trajectories*` | 交易查询、创建和管理。 |
| `POST` | `/api/v2/trajectories/:id/record/prepare\|start\|stop` | AI 录制生命周期。 |
| `POST` | `/api/v2/trajectories/:id/manual-record` | 人工录制。 |
| `POST` | `/api/v2/trajectories/:id/attach` | 分配/绑定浏览器资源。 |
| `POST` | `/api/v2/trajectories/:id/stream/detach` | 只停止画面推流，保留 idle 浏览器。 |
| `POST` | `/api/v2/trajectories/:id/detach` | 关闭资源并释放 slot。 |
| `POST` | `/api/v2/trajectories/:id/steps/replay` | 产品 live 回放。 |
| `GET/POST` | `/api/v2/executors*` | 节点、slot 和异常 Session 管理。 |
| `GET/POST` | `/api/v2/business-data*` | 业务数据。旧 `/api/v2/case-data` 仅 301 到此路径。 |
| `GET/POST` | `/api/v2/system-mgmt*` | 系统树、模块、功能和账号。 |
| `GET/POST` | `/v1/models`、`/v1/chat/completions` | LLM 兼容代理。 |
| `WS` | `/ws` | 前端状态、事件、回放进度和画面。 |
| `WS` | `/ws/executor?token=...` | Executor 节点连接。 |

## 数据库

核心实体关系如下：

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

重要状态语义：

- `trajectory.record_status`：`draft`、`recording`、`failed`、`recorded`、`completed`。
- `remote_session.status`：`active`、`idle`、`closed`、`crashed`。
- `record/stop` 结束录制；`stream/detach` 停止推流并可能进入宽限期；`detach` 才是资源回收动作。
- 多交易推流通过 `trajectory.id` 与 `remote_session.id` 一一绑定，释放一个交易不会影响其他交易。
- 步骤的 `action_id` 用于控制面重启后的幂等补写；不要把连续去重误认为全局去重，`src/dedup.js` 只删除相邻且 `(action, params)` 相同的动作。

## 开发与验证

代码检查：

```bash
npm run lint
npm run lint:fix
```

特征化和轻量冒烟：

```bash
node scripts/characterization/characterize-dedup.mjs
node scripts/smoke/accept-replay-apis.mjs
python scripts/characterization/characterize-form-rules.py
node scripts/characterization/characterize-trajectory.mjs
```

重构后完整门禁：

```bash
bash scripts/refactor/verify-all.sh
```

这些脚本是当前仓库的 characterization/import smoke，不等同于完整业务集成测试。涉及 MySQL、LLM、Chrome、MinIO 或 Executor 的功能，应在对应依赖可用后再做端到端验证。

## 关键实现约定

- Element UI 表单填充使用原生 setter 和事件触发，不能只依赖 Playwright `page.fill()`。
- `el-select` 使用语义选项选择逻辑，不能依赖 option span 的固定下标。
- 每个动作前重新查询 DOM，因为 Vue 可能重建弹窗、抽屉和表单节点。
- 定位优先级是 `xpath_smart`、label/语义定位、`xpath_full`；业务页面 DOM 发生变化时先检查元素快照和候选定位。
- Python Agent 的浏览器 JS 片段只有 `scripts/controller/actions/js_snippets/` 这一份；`_locator_helpers_js.py` 是生成文件，使用 `node scripts/_gen_locator_helpers_py.mjs` 从 JS 源重新生成。
- 提示词位于 `scripts/prompts/`，不是 OpenCode skill 包；仓库没有交付用的 `.opencode/skills/`。

## 常见问题

| 现象 | 排查 |
| --- | --- |
| `/api/trajectory` 返回 410 | 改用 `/api/v2/trajectories`。 |
| 根路径打开配置页 | 检查 `LLM_API_KEY` 是否存在；也可访问 `/api/setup` 配置。修改 `.env` 后建议重启控制面。 |
| 启动时报 MySQL 错误 | 检查 MySQL 是否可连接、`DB_*` 是否正确，并执行 `npx knex migrate:latest --knexfile config/knexfile.js`。 |
| Agent `ModuleNotFoundError` | 激活正确 Python 环境并执行 `python -m pip install -r scripts/requirements.txt`，确认 `PYTHON_EXE` 指向该环境。 |
| 找不到 Chromium | 在实际运行 Agent 的机器执行 `npx playwright install chromium` 和 `python -m playwright install chromium`，检查 `PLAYWRIGHT_BROWSERS_PATH`。 |
| Executor 无法连接 | 控制面配置 `EXECUTOR_TOKEN`，Executor 的 token 必须一致；检查 `CONTROL_PLANE_URL`、防火墙和 `/ws/executor`。 |
| Executor 槽位满 | 查看 `GET /api/v2/executors`，对残留会话执行 detach 或关闭会话，必要时提高 `EXECUTOR_CAPACITY`。 |
| Linux 启动浏览器失败 | 非无头模式安装并启动 Xvfb，或设置 `CHROME_HEADLESS=true`。 |
| 截图没有 URL | 检查 MinIO endpoint、密钥和 bucket；上传失败文件会落到 `tmp/pending-screenshots`，查看服务日志和重试配置。 |
| 找不到旧的 dashboard/skills/assemble | 这些资产已经移除。使用独立产品前端、`/api/docs`、`scripts/prompts/` 和当前 live replay API。 |

## 日志与运行目录

- 控制面和执行机日志：`logs/server.log`、`logs/executor.log`（一键脚本启动时）。
- Agent stderr：默认 `logs/agent-stderr/`。
- 截图上传失败暂存：默认 `tmp/pending-screenshots/`。
- Playwright 浏览器目录：控制面默认项目下 `browser/`；Executor 未显式配置时使用系统默认缓存。
- Executor 节点身份：`executor/.node-uuid`。

这些目录可能包含账号、页面数据、截图和任务信息，应按生产数据处理并加入备份/访问控制策略。

## License

MIT
