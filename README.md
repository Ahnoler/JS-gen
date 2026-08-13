# JS-gen — 浏览器自动化控制面

面向 **Element UI / Vue** 被测系统的浏览器自动化服务：AI / 人工录制、Playwright 脚本组装与执行、MySQL 交易（轨迹）持久化、可选远程执行机。产品前端在独立 Vue 仓库；本仓库提供控制面 API 与 `/api/docs`。

> **产品主路径是 `/api/v2/*`（MySQL）**，不是旧的 `/api/trajectory` / `/api/case-data`（已返回 **410 Gone**）。  
> **LLM 默认走独立模式**（经 `src/llm-utils.js`），不依赖 OpenCode SDK。
> **没有活跃的 `.opencode/skills/`**；知识在 `scripts/prompts/*.md` + CTRL / `form_rules` 代码中。

更细的 Agent 工作约定见 [`AGENTS.md`](./AGENTS.md)（唯一事实源；[`CLAUDE.md`](./CLAUDE.md) 仅作指向）。前端契约以 `/api/docs` 为准（`src/dashboard/api-docs/catalog.js`），不再维护单独产品 API markdown。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| **产品录制** | `/api/v2/trajectories/*`：`record/prepare\|start\|stop`、`manual-record`、`attach` / `detach` |
| **产品回放** | `/api/v2/trajectories/:id/steps/replay`：附着会话内 live `replay_actions`（`_replay.py`；优先 `xpath_smart`：语义锚点 + 可见 dialog scope + 树文案剥离 + 图标 class/tooltip）。`/replay/*` 组装 Playwright 全量回放已**弃用**（工程资产，仍可跑） |
| **系统树** | `/api/v2/system-mgmt/*`：系统 → 模块 → 功能（+ 账号）；交易挂在功能下 |
| **执行机** | `npm run executor` → WS `/ws/executor`；槽位租约至 `detach`（`EXECUTOR_CAPACITY`） |
| **Session 调试** | `/api/browser/session` — 工程调试路径，非整条产品录制主线 |
| **组装 / 运行** | `/api/test/assemble`、`/api/test/run` — 工程管线；内核已抽到 `assemble-service` / `script-runner` |
| **产品 API 文档** | `http://localhost:4097/api/docs` — 前端对接唯一契约（旧工程 HTML 页已移除，入口 301 到此处） |

---

## 快速开始

### 1. 安装

```bash
npm install
```

Python Agent 需可用的 `browser_use` 环境（见 `scripts/requirements.txt`）。可用 `PYTHON_EXE` 指定解释器。

### 2. 配置

复制并编辑 `config/.env`（参考 `config/.env.example`）：

```env
PORT=4097
HOST=0.0.0.0
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=your-api-key

# MySQL（v2 必需）
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASS=
DB_NAME=js_gen

# 可选：执行机
# EXECUTOR_TOKEN=change-me
# USE_EXECUTOR=true
```

也可使用：

```powershell
.\start.ps1
```

未配置 API Key 时，打开 `http://localhost:4097/api/setup` 引导写入 `config/.env`。

### 3. 启动

```bash
npm start          # 控制面
npm run executor   # 可选：远程执行机（另开终端）
npm run dev        # 控制面文件监视
```

- **产品 API 文档（给前端）**：`http://localhost:4097/api/docs`（根路径 `/` 亦跳转至此）
- 健康检查：`GET /api/health`
- Dashboard WS：`ws://localhost:4097/ws`
- 执行机 WS：`ws://localhost:4097/ws/executor`

轻量冒烟（非完整测试套件）：

```bash
node scripts/characterization/characterize-dedup.mjs
node scripts/smoke/accept-replay-apis.mjs
```

---

## 架构

```
Node.js Express (server.mjs, :4097)
 ├─ 产品录制（首选）
 │     /api/v2/trajectories/*  record/*, manual-record, attach|detach
 │     → USE_EXECUTOR ? 执行机会话 : 本地 browser session
 ├─ 产品回放
 │     /api/v2/trajectories/:id/steps/replay → live replay_actions (_replay.py)
 │     /api/v2/trajectories/:id/replay/* → DEPRECATED assemble → script-runner
 ├─ Session 调试（工程次要）
 │     /api/browser/session (+ /step, …)
 └─ 工程组装 / 运行
       /api/test/assemble → assemble-service → script_assembler.py
       /api/test/run      → script-runner → playwright-runner/run.cjs
```

一次性 Explore/Workflow、以及旧工程 Dashboard / 录制联调 HTML 页已移除（产品 SPA 在独立 Vue 仓库）。产品 AI 录制用 v2 `record/start`（可选 `phaseIds`）。

### 双语言 CTRL（必须同步）

JS canonical（`src/ctrl-actions/`）↔ Python JS 字符串（`scripts/controller/actions/_js_snippets.py`）↔ Python（`scripts/controller/actions/`）三处同一表面：`fillFormField`、`selectOption`、`selectDate`、`clickMenuItem`、`clickTableRowButton`、`closeDialog` 等，改一处必须同步其余。同步规则、文件明细与生成文件约束见 [AGENTS.md](./AGENTS.md)，勿两处重复维护。

### 关键模块

| 区域 | 路径 | 说明 |
|------|------|------|
| 产品 API | `src/routes/v2/` | system-mgmt、trajectories、replay、executors、case-data、… |
| Session | `src/routes/browser-session/` | 调试会话 |
| 组装 / 运行 | `src/routes/test-assemble.js` / `test-run.js` | 薄 HTTP；内核在 services/runtime |
| 遗留 | `legacy-gone.js` | `/api/trajectory`、`/api/case-data` → 410 |
| 运行时 | `src/runtime/script-runner.js` | 共享 Playwright 执行 |
| 服务 | `assemble-service` / `replay-service` / `executor-slot-lease` | 组装、回放、槽位租约 |
| Agent | `scripts/` | `main.py`、`session_runner.py`、`script_assembler.py`、`form_rules.py` |
| 提示词 | `scripts/prompts/*.md` | **不是** OpenCode skills |

> 模块 / 服务 / 路由明细以 [AGENTS.md](./AGENTS.md) 为准，这里只是速览。

---

### 产品前端

产品 SPA 在独立仓库（Vue）；本仓库只提供控制面与 [`/api/docs`](http://localhost:4097/api/docs)。旧 `test-dashboard.html` / `record-console.html` / `record-studio.html` 已删除，对应 `GET /api/test*` 入口 **301 → `/api/docs`**。`/api/test/assemble`、`/api/test/run` 等工程 API 仍保留。

执行机与控制面操作说明：`docs/执行机解耦与操作总结.md`（本地 docs，gitignore）。

---

## 提示词（非 OpenCode Skills）

仓库内 **没有** 交付用的 `.opencode/skills/`（`.opencode/` 被 gitignore）。原 skill 知识已收拢为：

| 位置 | 角色 |
|------|------|
| `scripts/prompts/agent-prompt.md` 等 | Agent / Planner / 字段 / 修复提示词 |
| `scripts/controller/actions/form_rules.py` | 可执行填表规则（身份证、手机号等） |
| `src/ctrl-actions/*` + Python CTRL | 控件怎么点 / 怎么填 |

不要再按旧文档去找 `atp-ui` / `atp-rule` skill 包。

---

## 产品 API 速查（v2）

契约与示例以交付文档为准。常用端点：

### 系统管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v2/system-mgmt/tree` | 系统树（`children[]` 嵌套；`name`/`type` 可筛选；`{ code, message, data }`） |
| `GET/POST/...` | `/api/v2/system-mgmt/nodes` | 节点 CRUD |

### 交易录制

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v2/trajectories/analyze` | 需求 → 阶段列表（不落库） |
| `POST` | `/api/v2/trajectories` | 创建交易 |
| `POST` | `/api/v2/trajectories/:id/attach` | 绑定执行资源（占槽） |
| `POST` | `/api/v2/trajectories/:id/record/prepare\|start\|stop` | 录制生命周期 |
| `POST` | `/api/v2/trajectories/:id/manual-record` | 人工录制 |
| `POST` | `/api/v2/trajectories/:id/detach` | **释放槽位**（`stop` 不会释放） |
| `GET` | `/api/v2/trajectories/:id/tree` | 阶段 / 步骤树 |
| `PATCH` | `/api/v2/trajectory-steps/:id` | 步骤参数编辑 |

### 回放

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v2/trajectories/:id/steps/replay` | **产品支持**：附着会话内 live `replay_actions`（`_replay.py`） |
| `POST` | `/api/v2/trajectories/:id/replay/prepare` | **已弃用** 组装 Playwright；返回 `replayPlanId`，**不含脚本正文** |
| `POST` | `/api/v2/trajectories/:id/replay/start\|stop` | **已弃用** 启动 / 停止全量组装回放 |
| `GET` | `/api/v2/trajectories/:id/replay/latest` | **已弃用** 最近一次组装回放状态 |
| WS | `/ws` | 组装回放事件前缀 `replay:*`（工程资产） |

### 执行机 / 案例

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v2/executors` | 节点列表（含 `slots` / `inUse`） |
| `GET` | `/api/v2/case-data` | 案例数据（MySQL） |

### 工程 / 调试（非产品主路径）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/browser/session` … | Session 调试 |
| `POST` | `/api/test/assemble` | Action JSON → Playwright |
| `POST` | `/api/test/run` | 执行脚本（`execution:*`） |
| `GET` | `/api/docs` | 产品 API 文档（Swagger 风格，给前端；根路径亦跳转至此） |
| `GET` | `/api/test`、`/record-console`、`/record-studio` | 旧工程 HTML 已移除 → **301** `/api/docs` |

遗留：`GET /api/trajectory`、`GET /api/case-data` → **410**，请改用 v2。

---

## 环境变量

| 变量 | 默认 / 说明 |
|------|-------------|
| `PORT` / `HOST` | `4097` / `0.0.0.0` |
| `LLM_BASE_URL` / `LLM_API_KEY` | 独立 LLM |
| `FORM_LLM_*` | 可选更便宜的填表模型 |
| `PYTHON_EXE` | 嵌入式 `.\python\python.exe` → PATH |
| `DB_*` | MySQL（v2） |
| `USE_EXECUTOR` | `true` 时 Session/录制走在线执行机 |
| `EXECUTOR_TOKEN` | 执行机鉴权；未配置则拒绝连接 |
| `EXECUTOR_CAPACITY` | 执行机侧每节点槽位数（默认 16，见 `executor/.env.example`） |
| `EXECUTOR_HEARTBEAT_TIMEOUT_MS` | 心跳超时扫除 |

---

## 关键设计约定

- **连续去重**：`src/dedup.js` 只去掉相邻相同 `(action, params)`。
- **原生 setter**：Element 表单不要只用 `page.fill()`。
- **`el-select`**：用 `selectOption`，不要靠点 option span 下标。
- **操作前重查 DOM**：Vue 可能重建弹窗/组件。
- **`record/stop` ≠ `stream/detach` ≠ `detach`**：停录制不释放槽；断开画面只停推流（浏览器 idle）；`detach` 才关浏览器并释放槽。
- **多交易推流**：按 `trajectoryId` ↔ `remote_session` 1:1 隔离，释放/断开只影响本交易。
- **回放**：客户端拿进度与截图，不拿组装后的 JS。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| `/api/trajectory` 410 | 改用 `/api/v2/trajectories` |
| 找不到 skills / atp-ui | 改看 `scripts/prompts/` 与 CTRL / `form_rules` |
| `opencode server not ready` | 本项目默认不依赖 OpenCode；检查 LLM 环境变量即可 |
| 执行机连不上 | 配置 `EXECUTOR_TOKEN`，执行机侧 `CONTROL_PLANE_URL` |
| 槽位满 409 | 对占用方 `detach`，或扩 `EXECUTOR_CAPACITY` |
| Python `ModuleNotFoundError` | 在 Agent 环境安装 `scripts/requirements.txt` |

---

## License

MIT
