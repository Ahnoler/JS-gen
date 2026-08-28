# JS-gen — 浏览器自动化录制与回放平台

面向 **Element UI / Vue** 被测系统的 LLM 驱动浏览器自动化服务：AI / 人工录制、Playwright 脚本生成与执行、MySQL 交易（轨迹）持久化、回放校验、可选远程执行机，以及与伙伴平台的交易推送集成。产品前端在独立 Vue 仓库；本仓库提供控制面 API 与 `/api/docs`。

## 技术栈

| 组件 | 版本 / 说明 |
|------|-------------|
| Node.js | ≥ 18（Express 控制面，端口 4097） |
| Web 框架 | Express + WebSocket（`/ws`、`/ws/executor`） |
| 数据库 | MySQL 5.7+（`utf8mb4_general_ci`） |
| ORM | Knex.js（53 个迁移） |
| 浏览器自动化 | Playwright（Node 侧共享 Chromium） |
| Python Agent | browser_use 0.1.48 + langchain-openai + Playwright 1.58.0 |
| 对象存储 | MinIO（截图存储） |
| 认证 | SSO / JWT（PaaS 集成） |
| 导出 | ExcelJS |
| 子路径别名 | `#config/*` → `./config/*`、`#src/*` → `./src/*` |

## 项目结构

```
JS-gen/
├── src/                                     # Node.js 控制面
│   ├── routes/v2/                           #   产品 API（23 个路由模块）
│   │   ├── trajectory.js                    #     交易 CRUD / 树
│   │   ├── trajectory-record.js             #     录制生命周期（prepare/start/stop）
│   │   ├── trajectory-batch.js              #     批量录制
│   │   ├── trajectory-steps.js              #     步骤编辑 / 回放
│   │   ├── trajectory-shared.js             #     共享步骤
│   │   ├── system-mgmt.js                   #     系统树管理
│   │   ├── hierarchy.js                     #     层级管理
│   │   ├── executor.js                      #     执行机节点
│   │   ├── remote-session.js                #     远程会话
│   │   ├── screenshot.js                    #     截图
│   │   ├── business-data.js                 #     业务数据
│   │   ├── operation-component.js           #     操作组件
│   │   ├── special-element.js               #     特殊元素
│   │   ├── regions.js                       #     区域分类
│   │   ├── export-mgmt.js                   #     导出管理
│   │   ├── auth.js                          #     SSO 认证
│   │   ├── memory.js                        #     AI 记忆
│   │   ├── sys-dict.js                      #     字典
│   │   ├── system-ref-data.js              #     系统引用数据
│   │   ├── messages.js                      #     消息
│   │   ├── api-override.js                  #     API 覆盖
│   │   └── agent-stderr.js                  #     Agent 日志
│   ├── services/                            # 业务服务层（32 个服务）
│   │   ├── trajectory-service.js            #   交易核心服务
│   │   ├── remote-session-service.js        #   远程会话管理
│   │   ├── executor-node-service.js         #   执行机节点
│   │   ├── partner-platform.js              #   伙伴平台推送
│   │   ├── transaction-export-v3.js         #   V3 交易导出
│   │   ├── screenshot-service.js            #   截图服务
│   │   ├── minio-service.js                 #   MinIO 存储
│   │   ├── hierarchy-service.js             #   层级服务
│   │   ├── system-account-service.js        #   系统账号
│   │   ├── region-classify.js               #   区域分类
│   │   ├── region-tree.js                   #   区域树
│   │   └── ...                              #   其余 21 个服务
│   ├── dao/                                 # 数据访问层（20 个 DAO）
│   │   ├── trajectory-dao.js                #   交易
│   │   ├── trajectory-phase-dao.js          #   阶段
│   │   ├── trajectory-step-dao.js           #   步骤
│   │   ├── system-dao.js                    #   系统
│   │   ├── system-account-dao.js            #   系统账号
│   │   ├── system-ref-dao.js               #   系统引用
│   │   ├── remote-session-dao.js            #   远程会话
│   │   ├── executor-node-dao.js             #   执行机节点
│   │   ├── screenshot-dao.js                #   截图
│   │   ├── operation-component-dao.js       #   操作组件
│   │   └── ...                              #   其余 10 个 DAO
│   ├── cdp/                                 # CDP 页面定位辅助
│   │   └── page-locator-helpers.js          #   XPath 生成源（→ 生成 Python）
│   ├── dashboard/api-docs/                  # 产品 API 文档
│   │   └── catalog.js                       #   前端契约（唯一事实源）
│   ├── runtime/                             # 运行时
│   │   └── script-runner.js                 #   Playwright 执行
│   ├── memory/                              # AI 记忆模块
│   ├── dedup.js                             # 连续去重
│   ├── llm-utils.js                         # LLM 独立模式调用
│   └── ctrl-actions.js                      # CTRL 桩（已清理）
├── scripts/                                 # Python Agent（browser_use 框架）
│   ├── main.py                              #   Agent 入口
│   ├── session_runner.py                    #   会话运行器
│   ├── controller/                          #   控制器
│   │   └── actions/                         #     动作集
│   │       ├── js_snippets/                 #       浏览器 JS 片段（单一语言面）
│   │       │   ├── _locator_helpers_js.py   #         [生成物] 禁止手改
│   │       │   ├── base.py                  #         基础
│   │       │   ├── container.py             #         容器探测
│   │       │   ├── fill_core.py             #         填表核心
│   │       │   ├── fill_date.py             #         日期填充
│   │       │   ├── scan_form.py             #         表单扫描
│   │       │   ├── select_option.py         #         下拉选择
│   │       │   ├── select_tree.py           #         树选择
│   │       │   ├── select_trigger.py        #         选择触发
│   │       │   └── ...                      #         其余片段
│   │       └── form_rules.py                #       可执行填表规则
│   ├── agent/                               #   Agent 服务
│   ├── prompts/                             #   提示词（非 OpenCode skills）
│   │   └── agent-prompt.md                  #     Agent / Planner / 字段 / 修复
│   ├── models/                              #   数据模型
│   └── requirements.txt                     #   Python 依赖
├── executor/                                # 远程执行机
│   └── .env.example                         #   执行机配置示例
├── config/                                  # 配置
│   ├── config.js                            #   配置解析（process.env → .env → 默认）
│   ├── database.js                          #   Knex MySQL 单例
│   ├── knexfile.js                          #   迁移配置
│   ├── .env                                 #   环境变量（gitignore）
│   └── .env.example                         #   环境变量示例
├── migrations/                              # 数据库迁移（53 个）
├── server.mjs                               # Express 入口
├── package.json                             # npm 依赖与脚本
├── AGENTS.md                                # Agent 工作约定（唯一事实源）
└── README.md                                # 本文档
```

## 数据模型

系统使用 MySQL 关系型数据库，通过 Knex.js 管理 53 个迁移。核心表如下：

### 交易录制模型

| 表名 | 说明 | 核心字段 |
|------|------|----------|
| `trajectory` | 交易（轨迹）主表 | `id`、`name`、`system_id`、`status`、`page_id` |
| `trajectory_phase` | 阶段（Phase） | `id`、`trajectory_id`、`phase_type`、`order` |
| `trajectory_step` | 步骤（Step） | `id`、`phase_id`、`action`、`params`、`xpath`、`order` |
| `trajectory_shared_step` | 共享步骤 | `id`、`name`、`action`、`params` |

### 系统管理模型

| 表名 | 说明 | 核心字段 |
|------|------|----------|
| `system` | 系统节点 | `id`、`name`、`menu_xpath`、`pd_cmpt_ecd` |
| `system_page` | 系统页面 | `id`、`system_id`、`page_name`、`page_url` |
| `system_account` | 系统账号 | `id`、`system_id`、`username`、`password` |
| `system_ref_data` | 系统引用数据 | `id`、`system_id`、`ref_type`、`ref_value` |

### 执行机与会话模型

| 表名 | 说明 | 核心字段 |
|------|------|----------|
| `executor_node` | 执行机节点 | `id`、`name`、`url`、`capacity`、`in_use` |
| `remote_session` | 远程会话 | `id`、`trajectory_id`、`executor_node_id`、`state` |

### 辅助模型

| 表名 | 说明 | 核心字段 |
|------|------|----------|
| `screenshot` | 截图 | `id`、`trajectory_id`、`step_id`、`minio_key` |
| `operation_component` | 操作组件 | `id`、`name`、`signature`、`xpath` |
| `special_element` | 特殊元素 | `id`、`trajectory_id`、`element_type` |
| `business_data` | 业务数据 | `id`、`trajectory_id`、`data_key`、`data_value` |
| `form_snapshot` | 表单快照 | `id`、`trajectory_id`、`snapshot_json` |
| `ai_memory` | AI 记忆 | `id`、`session_id`、`memory_type`、`content` |

## API 接口

产品主路径是 `/api/v2/*`。旧 `/api/trajectory`、`/api/case-data` 已返回 **410 Gone**。完整契约见 `http://localhost:4097/api/docs`。

### 系统管理 `/api/v2/system-mgmt`

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/tree` | 系统树（`children[]` 嵌套；`name`/`type` 可筛选） |
| `GET/POST/...` | `/nodes` | 节点 CRUD |

### 交易录制 `/api/v2/trajectories`

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/analyze` | 需求 → 阶段列表（不落库） |
| `POST` | `` | 创建交易 |
| `POST` | `/:id/attach` | 绑定执行资源（占槽） |
| `POST` | `/:id/record/prepare\|start\|stop` | 录制生命周期 |
| `POST` | `/:id/manual-record` | 人工录制 |
| `POST` | `/:id/detach` | **释放槽位**（`stop` 不会释放） |
| `GET` | `/:id/tree` | 阶段 / 步骤树 |
| `POST` | `/:id/batch-record` | 批量录制 |

### 步骤与回放 `/api/v2/trajectory-steps`、`/api/v2/trajectories/:id/steps`

| 方法 | 路径 | 说明 |
|------|------|------|
| `PATCH` | `/api/v2/trajectory-steps/:id` | 步骤参数编辑 |
| `POST` | `/api/v2/trajectories/:id/steps/replay` | **产品支持**：附着会话内 live `replay_actions`（`_replay.py`） |
| `POST` | `/api/v2/trajectories/:id/replay/prepare` | **已弃用** 组装 Playwright |
| `POST` | `/api/v2/trajectories/:id/replay/start\|stop` | **已弃用** 启动 / 停止全量组装回放 |

### 执行机 `/api/v2/executors`

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `` | 节点列表（含 `slots` / `inUse`） |

### 其他产品 API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v2/case-data` | 案例数据（MySQL） |
| `GET` | `/api/v2/business-data` | 业务数据 |
| `GET/POST` | `/api/v2/screenshot` | 截图管理 |
| `GET/POST` | `/api/v2/operation-component` | 操作组件 |
| `GET/POST` | `/api/v2/special-element` | 特殊元素 |
| `GET/POST` | `/api/v2/regions` | 区域分类 |
| `GET/POST` | `/api/v2/export-mgmt` | 导出管理 |
| `GET/POST` | `/api/v2/hierarchy` | 层级管理 |
| `GET/POST` | `/api/v2/sys-dict` | 字典管理 |
| `GET/POST` | `/api/v2/memory` | AI 记忆 |
| `POST` | `/api/v2/auth/sso` | SSO 登录 |

### 工程 / 调试（非产品主路径）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/browser/session` | Session 调试 |
| `GET` | `/api/docs` | 产品 API 文档（根路径 `/` 亦跳转至此） |
| `GET` | `/api/health` | 健康检查 |
| WS | `/ws` | Dashboard WebSocket |
| WS | `/ws/executor` | 执行机 WebSocket |

## 业务流程

### 1. AI 录制流程

```
客户端提交需求文本
        │
        ▼
┌─────────────────────────────────────────────────┐
│ ① 需求分析阶段                                   │
│   POST /api/v2/trajectories/analyze             │
│   → LLM 将需求拆解为阶段列表（不落库）             │
└─────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────┐
│ ② 创建交易 + 绑定执行资源                         │
│   POST /api/v2/trajectories                     │
│   POST /api/v2/trajectories/:id/attach          │
│   → 占用执行机槽位，启动浏览器会话                  │
└─────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────┐
│ ③ 录制阶段                                       │
│   POST /api/v2/trajectories/:id/record/prepare  │
│   POST /api/v2/trajectories/:id/record/start    │
│   → Python Agent（browser_use）驱动浏览器         │
│   → LLM 逐步决策，JS snippets 执行控件操作         │
│   → 每步截图存 MinIO，步骤落库 trajectory_step    │
│   → Phase Reviewer 审核阶段质量                   │
└─────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────┐
│ ④ 录制结束                                       │
│   POST /api/v2/trajectories/:id/record/stop     │
│   → 停止录制（但不释放槽位）                       │
│   POST /api/v2/trajectories/:id/detach          │
│   → 关闭浏览器 + 释放执行机槽位                    │
└─────────────────────────────────────────────────┘
```

### 2. 回放校验流程

```
客户端请求回放
        │
        ▼
┌─────────────────────────────────────────────────┐
│ POST /api/v2/trajectories/:id/steps/replay      │
│ → 附着到活跃会话内，live replay_actions           │
│ → _replay.py 逐步执行                            │
│ → 定位器优先级：xpath_smart → label/semantic     │
│   → xpath_full                                  │
│ → 每步回读校验（fill_form_field 回读比对）         │
│ → 失败时 stop_on_fail，按批次 [N/M] 报告          │
└─────────────────────────────────────────────────┘
        │
        ▼
返回回放结果（每步成功/失败 + 截图）
```

### 3. 批量录制流程

```
客户端提交多条交易需求
        │
        ▼
┌─────────────────────────────────────────────────┐
│ POST /api/v2/trajectories/:id/batch-record      │
│ → 按阶段依次录制多条交易                          │
│ → 每条交易独立 trajectory + remote_session       │
│ → 1:1 隔离（trajectoryId ↔ remote_session）      │
│ → 推流身份按 remote_session.id 区分               │
└─────────────────────────────────────────────────┘
        │
        ▼
逐条录制 → 逐条 detach → 统一导出
```

### 4. 伙伴平台推送流程

```
交易录制完成
        │
        ▼
┌─────────────────────────────────────────────────┐
│ ① V3 格式组装                                    │
│   transaction-export-v3.js                      │
│   → flat type 7 种（page/popup/tab/section/     │
│     wizard/card/object）                         │
│   → 归一化 rect_norm + 显式中间节点               │
└─────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────┐
│ ② 推送到伙伴平台                                 │
│   partner-platform.js                           │
│   → POST 伙伴平台 V3 push API                    │
│   → SSO JWT 出站鉴权                             │
│   → 页面级截图 + 统一坐标 + 同构 schema           │
└─────────────────────────────────────────────────┘
        │
        ▼
返回推送结果（200 = 成功）
```

## 快速开始

1. 复制环境配置文件并填写实际参数：

```bash
cp config/.env.example config/.env
```

关键字段：

```env
PORT=4097
HOST=0.0.0.0

# LLM
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=your-api-key

# MySQL（v2 必需）
DB_HOST=47.101.58.49
DB_PORT=3306
DB_USER=root
DB_PASS=your-password
DB_NAME=js_gen

# Python Agent
PYTHON_EXE=D:\anaconda3\envs\browser_use\python.exe

# MinIO
MINIO_ENDPOINT=127.0.0.1:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# 可选：远程执行机
# USE_EXECUTOR=true
# EXECUTOR_TOKEN=change-me
```

2. 安装依赖：

```bash
npm install
```

Python Agent 需可用的 `browser_use` 环境（见 `scripts/requirements.txt`）：

```bash
pip install -r scripts/requirements.txt
```

3. 初始化数据库（运行迁移）：

```bash
npx knex migrate:latest --knexfile config/knexfile.js
```

4. 启动服务：

```bash
npm start          # 控制面（端口 4097）
npm run executor   # 可选：远程执行机（另开终端）
npm run dev        # 控制面文件监视模式
```

5. 访问 API 文档：`http://localhost:4097/api/docs`

## 环境变量

| 变量 | 默认 / 说明 |
|------|-------------|
| `PORT` / `HOST` | `4097` / `0.0.0.0` |
| `LLM_BASE_URL` / `LLM_API_KEY` | 独立 LLM 网关 |
| `FORM_LLM_*` | 可选更便宜的填表模型 |
| `REVIEWER_LLM_*` | 可选 Phase Reviewer 模型 |
| `PYTHON_EXE` | Python 解释器路径（须含 browser_use） |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASS` / `DB_NAME` | MySQL 连接（v2 必需） |
| `MINIO_*` | MinIO 对象存储（截图） |
| `USE_EXECUTOR` | `true` 时 Session / 录制走在线执行机 |
| `EXECUTOR_TOKEN` | 执行机鉴权；未配置则拒绝连接 |
| `EXECUTOR_CAPACITY` | 执行机侧每节点槽位数（默认 16） |
| `SSO_*` | SSO / PaaS 集成（JWT 验签） |

## 关键设计约定

- **连续去重**：`src/dedup.js` 只去掉相邻相同 `(action, params)`，非连续重复保留。
- **原生 setter**：Element UI 表单输入不只用 `page.fill()`，须用 native setter 触发 Vue 响应。
- **`el-select`**：用 `selectOption`，不靠点 option span 下标。
- **操作前重查 DOM**：Vue 可能重建弹窗 / 组件，每次操作前须重新查询。
- **`record/stop` ≠ `stream/detach` ≠ `detach`**：停录制不释放槽；断开画面只停推流（浏览器 idle）；`detach` 才关浏览器并释放槽。
- **多交易推流**：按 `trajectoryId` ↔ `remote_session` 1:1 隔离，释放 / 断开只影响本交易。
- **JS snippets 单一语言面**：浏览器 JS 片段仅定义在 `scripts/controller/actions/js_snippets/*`，无跨语言同步负担。`_locator_helpers_js.py` 是生成物，禁止手改。

## 常见问题

| 现象 | 处理 |
|------|------|
| `/api/trajectory` 410 | 改用 `/api/v2/trajectories` |
| 找不到 skills / atp-ui | 改看 `scripts/prompts/` 与 `js_snippets` / `form_rules` |
| `opencode server not ready` | 本项目默认不依赖 OpenCode；检查 LLM 环境变量即可 |
| 执行机连不上 | 配置 `EXECUTOR_TOKEN`，执行机侧 `CONTROL_PLANE_URL` |
| 槽位满 409 | 对占用方 `detach`，或扩 `EXECUTOR_CAPACITY` |
| Python `ModuleNotFoundError` | 在 Agent 环境安装 `scripts/requirements.txt` |
| MySQL `utf8mb4_0900_ai_ci` 报错 | 服务器为 MySQL 5.7，使用 `utf8mb4_general_ci` |

## License

MIT
