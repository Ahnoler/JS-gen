# 报文捞取 MVP Spec

> 状态：待评审
> 日期：2026-08-25
> 关联：PR-DATA 数据捞取（todo-list 任务④，原搁置 ~15%）；[[830-v3-batch-push-gap-analysis]]；[[qwen-ui-agent-borrowing]]

---

## 1. 背景与问题

### 1.1 PR-DATA 原始定义

PR-DATA（产品需求 `2026-08-12-product-requirements-miaoyi-brief.md`）定义数据捞取：录制时抓取目标系统的非消费型字段值，目录来源 `{name, prop, url}`，流程为「页面 URL → 页面元素 → 接口元数据 → AI 分析 → 捞历史报文」。原计划走 case-data 软文本路径。

### 1.2 搁置原因

830 冲刺时 PR-DATA 搁置于 ~15%：case-data 软文本底座已存在（用户需求 KV 存储），但缺少系统侧的报文抓取与持久化能力——不知道哪些接口值得捞、捞到后存在哪、何时触发持久化。

### 1.3 现有基础设施

- `case_data` / `case_data_entry`：用户需求 KV 存储（业务数据），通过 `prepareCaseDataInjection` 注入 agent prompt 作为【业务数据】块
- `system_ref_data` / `system_ref_entry`：已设计的系统参考值表（`migrations/20260805220000_system_ref_data.js`），有完整 CRUD（`src/routes/v2/system-ref-data.js` 6 个端点），但从未被录制流程写入
- `replay_wait.py`：已有 Playwright XHR/fetch 监听先例（`page.on('request'/'requestfinished'/'requestfailed')`，`_is_trackable_request` 过滤 resource_type）
- `factory.py:222`：已有 CDP session 先例（`new_cdp_session`）

### 1.4 术语混乱

`_case_data.py` 顶部注释区分了「业务数据（用户需求）」vs「案例数据（系统回写）」两个概念，但两者都挂在 case_data 存储上，代码中 `case_data`/`业务数据`/`案例数据` 三个词混用，造成认知负担。本次改名消除「案例数据」一词，统一为「业务数据」，系统侧报文捞取走 `system_ref_data` 独立表。

---

## 2. 目标 / 非目标

### 目标

1. **改名**：`case_data` → `business_data` 全量深度改名（DB 表/列、文件名、函数名、路由、Python 模块、characterization 测试 pin），消除「案例数据」术语
2. **E2E 抓取工具**：独立 Playwright 脚本，用户手动操作触发真实接口，脚本捕获请求/响应完整格式，输出 JSON 样本供调研
3. **报文持久化逻辑**：录制时被动监听表单相关接口，按 `normalized_url + method` 去重，全新接口写入 `system_ref_data` / `system_ref_entry`

### 非目标

- 不实现 AI 字段映射（system_ref_entry 字段级分析后置）
- 不改前端 Vue 仓库（前端 API 调用路径由后端 301 重定向兼容，前端改动后续迭代）
- 不改 V3 导出 payload 格式（本 spec 与导出无关）
- 不实现用户手动勾选持久化（方案 A 为自动监听+去重+写入）

---

## 3. 第一部分：case_data → business_data 全量改名

### 3.1 DB 迁移

新增 `migrations/20260825220000_rename_case_data_to_business_data.js`：

```js
export async function up(knex) {
  // 表重命名
  await knex.schema.renameTable('case_data', 'business_data');
  await knex.schema.renameTable('case_data_entry', 'business_data_entry');
  // form_snapshot 表名不改，仅改其外键列名

  // 列重命名（case_data_id → business_data_id）
  await knex.schema.alterTable('business_data_entry', (t) => {
    t.renameColumn('case_data_id', 'business_data_id');
  });
  await knex.schema.alterTable('form_snapshot', (t) => {
    t.renameColumn('case_data_id', 'business_data_id');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('form_snapshot', (t) => {
    t.renameColumn('business_data_id', 'case_data_id');
  });
  await knex.schema.alterTable('business_data_entry', (t) => {
    t.renameColumn('business_data_id', 'case_data_id');
  });
  await knex.schema.renameTable('business_data_entry', 'case_data_entry');
  await knex.schema.renameTable('business_data', 'case_data');
}
```

- 不改原始建表迁移（`20260713..._create_all_tables.js`），用 RENAME 迁移叠加，保持迁移历史可重放
- 外键引用自动跟随列重命名（MySQL/MariaDB 行为）
- 索引名不改（`idx_case_data_id` 等保留，不影响功能）

### 3.2 JS 文件重命名

| 旧路径 | 新路径 |
|--------|--------|
| `src/dao/case-data-dao.js` | `src/dao/business-data-dao.js` |
| `src/services/case-data-service.js` | `src/services/business-data-service.js` |
| `src/routes/v2/case-data.js` | `src/routes/v2/business-data.js` |
| `src/case-data-store.js` | `src/business-data-store.js` |

### 3.3 JS 符号重命名

| 旧符号 | 新符号 |
|--------|--------|
| `prepareCaseDataInjection` | `prepareBusinessDataInjection` |
| `CASE_DATA_SECTION_RE` | `BUSINESS_DATA_SECTION_RE` |
| `extractCaseDataBlock` | `extractBusinessDataBlock` |
| `caseDataFile` / `caseData` / `caseDataBlock` | `businessDataFile` / `businessData` / `businessDataBlock` |
| `caseDataDao` / `caseDataService` | `businessDataDao` / `businessDataService` |
| `saveCaseData` / `persistSessionCaseData` | `saveBusinessData` / `persistSessionBusinessData` |

- `CASE_BLOCK_MARK_LEGACY`（`【业务场景案例数据`）**保留不动**——向后兼容旧录制数据中可能出现的旧标记
- `CASE_BLOCK_MARK`（`【业务数据`）已是新名称，不改

### 3.4 路由变更

- `/api/v2/case-data` → `/api/v2/business-data`
- 旧路径保留 301 重定向（参照 legacy `/api/trajectory` → 410 的先例，但此处用 301 而非 410，因为是改名非删除）
- 重定向在 `server.mjs` 路由注册层处理

### 3.5 Python 层重命名

| 旧 | 新 |
|----|----|
| `scripts/controller/actions/_case_data.py` | `scripts/controller/actions/_business_data.py` |
| `scripts/models/entity/case_data_entity.py` | `scripts/models/entity/business_data_entity.py` |
| `lookup_case_value` | `lookup_business_value` |
| `format_case_data_hint` | `format_business_data_hint` |
| `save_case_data` / `read_case_data` | `save_business_data` / `read_business_data` |
| `_RESERVED_CASE_KEYS` | `_RESERVED_BUSINESS_KEYS` |
| `_register_case_data_actions` | `_register_business_data_actions` |
| `case_data_store`（参数/变量名） | `business_data_store` |
| `_case_scenario_text`（内部 key） | `_business_scenario_text` |

术语注释段（`_case_data.py:1-27`）重写：消除「业务数据 vs 案例数据」双重定义，统一为「业务数据」单一概念。

**内部 key 向后兼容**：`_case_scenario_text` → `_business_scenario_text` 改名后，存量 case_data_store 字典中可能仍含旧 key。`format_business_data_hint` 读取时需**双 key 回退**：优先取 `_business_scenario_text`，fallback 取 `_case_scenario_text`。`_RESERVED_BUSINESS_KEYS` 集合需同时包含新旧两个 key。

### 3.6 涉及文件统计

- JS/MJS：约 189 处引用，34 个文件
- Python：约 851 处引用，35+ 个文件
- characterization 测试：`characterize-analyze-case-data.mjs`、`characterize-case-data.py` 等需同步更新 pin 的子串

### 3.7 改名策略

由于涉及面广（1000+ 处引用），采用**并行子智能体**按文件集不相交拆分：
- 子智能体 A：JS DAO/service/routes/store 层（4 个核心文件 + 调用方）
- 子智能体 B：JS trajectory/memory/routes 其他层
- 子智能体 C：Python `_case_data.py` + entity + 直接调用方
- 子智能体 D：Python 其他引用文件
- 子智能体 E：characterization 测试文件

主线程负责：DB 迁移、路由重定向、最终 verify-all。

---

## 4. 第二部分：E2E 接口格式抓取工具

### 4.1 工具定位

`scripts/tools/api-capture.mjs`——独立 Node Playwright 脚本，不接入录制基础设施，纯调研工具。

### 4.2 用法

```bash
node scripts/tools/api-capture.mjs --url https://target-app.com --filter "/api/" --out ./samples/
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `--url` | 必填 | 目标应用入口 URL |
| `--filter` | `"/api/"` | URL 正则过滤，只捕获匹配的请求 |
| `--out` | `./samples/` | 样本输出目录 |
| `--headed` | true | 有头模式（默认开启，用户需手动操作浏览器） |
| `--timeout` | 300000 | 总采集时长（ms），到时自动退出 |

### 4.3 流程

1. 启动 Chromium（headed 模式，复用 `src/runtime/script-runner.js` 的 Playwright 配置）
2. 导航到 `--url`
3. 挂载 `page.on('response')` 监听器
4. 用户在浏览器中手动操作（填表、保存、查询），触发真实接口
5. 每个匹配 `--filter` 的 XHR/fetch 响应：
   - 捕获请求：URL、method、request headers、request body（POST/PUT 解析 JSON）
   - 捕获响应：status、response headers、response body（JSON 自动解析，非 JSON 截断 4KB）
6. 输出到 `--out` 目录，文件名 `{method}_{normalizedUrl}_{timestamp}.json`
7. `--timeout` 到时或用户 Ctrl+C，脚本汇总打印捕获接口列表后退出

### 4.4 输出格式

每个接口一个 JSON 文件：

```json
{
  "url": "/api/form/save",
  "normalizedUrl": "/api/form/save",
  "method": "POST",
  "request": {
    "headers": { "Content-Type": "application/json", "Authorization": "Bearer ..." },
    "body": { "formId": "cstBase", "data": { "name": "张三", "idNo": "..." } }
  },
  "response": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "body": { "code": 0, "data": { "id": 12345 }, "msg": "success" }
  },
  "resourceType": "xhr",
  "capturedAt": "2026-08-25T14:30:00.000Z"
}
```

`normalizedUrl`：剥 query string，尾部纯数字 ID 替换为 `{id}`（`/api/form/123` → `/api/form/{id}`），与持久化层去重键一致。

### 4.5 复用

- Playwright 配置复用 `src/runtime/script-runner.js` 的 launch options（headless、args、userDataDir）
- 不依赖 server.mjs 运行，可独立执行

---

## 5. 第三部分：报文持久化逻辑

### 5.1 监听层（Python agent 侧）

新增 `scripts/controller/actions/network_capture.py`：

```python
"""Form-related XHR/fetch capture during recording → system_ref_data persistence."""

import re, json, time

# 表单相关 URL 关键词
_FORM_KEYWORDS = re.compile(r'/(form|save|load|query|submit|detail|create|update|delete|edit|add)', re.I)
# 排除的心跳/轮询
_EXCLUDE_PATTERN = re.compile(r'(heartbeat|poll|keepalive|status|ping|health|metrics|log)', re.I)


def _is_form_related(request, response) -> bool:
    """过滤表单相关接口。"""
    if request.resource_type not in ('xhr', 'fetch'):
        return False
    url = request.url
    method = request.method
    # 排除心跳/轮询
    if _EXCLUDE_PATTERN.search(url):
        return False
    # POST/PUT/DELETE 写操作纳入
    if method in ('POST', 'PUT', 'DELETE', 'PATCH'):
        return True
    # GET 且响应 JSON 且 URL 含表单关键词
    if method == 'GET':
        ctype = (response.headers or {}).get('content-type', '')
        if 'json' in ctype.lower() and _FORM_KEYWORDS.search(url):
            return True
    return False


def _normalize_url(url: str) -> str:
    """剥 query、尾部纯数字 ID → {id}。"""
    # 去 query string
    base = url.split('?')[0].split('#')[0]
    # 尾部纯数字 → {id}
    base = re.sub(r'/\d+(?=/|$)', '/{id}', base)
    return base
```

### 5.2 监听挂载

在录制会话启动时（`session_runner.py` 或 `recorder.py` 浏览器初始化后），挂载监听器：

```python
captured = []  # 本次录制捕获的接口

async def _on_response(response):
    request = response.request
    if not _is_form_related(request, response):
        return
    # response.body() 是异步的，必须 await
    try:
        resp_body = await response.body()
    except Exception:
        resp_body = b''
    entry = {
        'url': request.url,
        'normalizedUrl': _normalize_url(request.url),
        'method': request.method,
        'requestBody': _safe_body(request.post_data),
        'responseStatus': response.status,
        'responseBody': _safe_body(resp_body),
        'capturedAt': time.time(),
    }
    captured.append(entry)
    emit_memory_event('network_captured', entry)

# page.on 回调是同步的，需用 asyncio.create_task 包装 async handler
def _response_handler(response):
    asyncio.create_task(_on_response(response))

page.on('response', _response_handler)
```

> `page.on('response', cb)` 的 `cb` 是同步回调，不能直接传 async 函数。用 `asyncio.create_task` 包装 async handler 是 Playwright async API 的标准模式。

### 5.3 事件通道

复用现有 memory event 通道（`emit_memory_event`），事件类型 `network_captured`，payload 携带接口元数据。

JS 控制面已有 memory event 接收链路（`src/memory/memory-service.js` → `src/memory/protocol.js`），新增 `network_captured` 事件类型处理。

### 5.4 持久化流程（JS 控制面侧）

`src/memory/memory-service.js` 新增 `network_captured` 事件处理：

```
1. 收到 network_captured 事件
2. 提取 normalizedUrl + method 作为去重键
3. 查询 system_ref_data 是否已有相同 url_pattern + method
4. 全新接口：
   a. 解析 system_id（从当前 trajectory 的 functionId → resolveAncestorSystemId）
   b. 写入 system_ref_data：
      - record_id: sref_{timestamp}_{random}
      - source: 'system_capture'
      - description: "{method} {normalizedUrl}"
      - raw_json: 完整请求/响应 JSON
      - trajectory_id: 当前录制 trajectory id
      - key_count: response body 顶层字段数
   c. 写入 system_ref_entry：
      - 从 request body + response body 提取顶层 key
      - 每个 key 一行：field_key、field_value（样本截断 500 字符）、source（request/response）
5. 已存在：跳过
```

### 5.5 system_ref_data 写入字段映射

| system_ref_data 列 | 值 |
|---------------------|-----|
| `trajectory_id` | 当前录制 trajectory id |
| `session_id` | 当前 agent session id |
| `record_id` | `sref_{timestamp}_{random}` |
| `source` | `'system_capture'` |
| `verification_status` | `'raw'` |
| `description` | `"{method} {normalizedUrl}"` |
| `key_count` | response body 顶层字段数 |
| `raw_json` | 完整 {request, response} JSON |

### 5.6 system_ref_entry 写入字段映射

| system_ref_entry 列 | 值 |
|----------------------|-----|
| `system_ref_data_id` | 上一步写入的 system_ref_data.id |
| `trajectory_id` | 当前录制 trajectory id |
| `field_key` | 请求/响应 body 顶层 key |
| `field_value` | 样本值（截断 500 字符） |
| `source` | `'system_capture'` |
| `verification_status` | `'raw'` |

### 5.7 去重查询

新增 `src/dao/system-ref-dao.js` 方法：

```js
export async function findByUrlPattern(urlPattern, method) {
  // 查询 raw_json->'$.url' 或 description 匹配
  // 用 description LIKE '{method} {urlPattern}%' 快速匹配
}
```

或新增 `url_pattern` + `method` 索引列（需迁移加列）。MVP 阶段用 `description` 字段前缀匹配，避免加列。

---

## 6. 执行顺序

1. **改名**（机械执行，并行子智能体拆文件集）
   - DB 迁移先行
   - JS 层（4 核心文件 + 调用方）
   - Python 屄（`_case_data.py` + entity + 调用方）
   - characterization 测试
   - verify-all ALL GREEN
2. **E2E 抓取工具**（独立，与改名无依赖，可并行）
   - `scripts/tools/api-capture.mjs`
3. **持久化逻辑**
   - Python 监听层 `network_capture.py`
   - JS 事件处理 `memory-service.js` + DAO 去重 + 写入
   - 集成测试：录制一个表单保存流程，确认 system_ref_data 新增条目

---

## 7. 验收

### 7.1 改名

- `bash scripts/refactor/verify-all.sh` ALL GREEN
- DB 迁移 `knex migrate:latest` 成功，`business_data` / `business_data_entry` 表存在，`form_snapshot.business_data_id` 列存在
- `curl http://localhost:4097/api/v2/business-data` 返回 200
- `curl http://localhost:4097/api/v2/case-data` 返回 301 → `/api/v2/business-data`
- `grep -rn "case_data\|案例数据" src/ scripts/controller/ scripts/models/` 零结果（legacy 注释和 `CASE_BLOCK_MARK_LEGACY` 除外）

### 7.2 E2E 抓取工具

- `node scripts/tools/api-capture.mjs --url <test-app> --filter "/api/" --headed` 启动浏览器
- 手动触发一次表单保存 → `./samples/` 下生成对应 JSON 样本
- 样本含完整 request/response body、normalizedUrl

### 7.3 持久化

- 录制一个含表单保存的 trajectory
- 录制结束后 `SELECT * FROM system_ref_data WHERE trajectory_id = <tid>` 有 1 行（保存接口）
- `SELECT * FROM system_ref_entry WHERE system_ref_data_id = <id>` 有 N 行（request/response 顶层字段）
- 再次录制相同接口的 trajectory → system_ref_data 不新增（去重命中）

### 7.4 CHANGELOG

按 AGENTS.md 同步约定，追加：
- [Unreleased] Changed：case_data → business_data 改名（DB 表/列/路由/符号），含 Python 同步提示
- [Unreleased] Added：报文捞取 MVP（network_capture + system_ref_data 自动持久化），含 Python 同步提示
- [Unreleased] Added：api-capture.mjs E2E 抓取工具（仅 scripts/，可不写 CHANGELOG）

---

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| 改名涉及 1000+ 处引用，遗漏导致运行时错误 | 并行子智能体按文件集拆分 + verify-all 全绿门禁 + grep 残留检查 |
| Python characterization 测试 pin 子串（`_case_data.py` 被 ~30 脚本 pin） | 改名后同步更新所有 pin 子串；`_case_data.py` → `_business_data.py` 文件名变更需更新 import 路径 |
| `response.body()` 异步在 `page.on('response')` 回调中处理复杂 | 用 `asyncio.create_task` 包装，或改用 `response.finished` 事件 + `response.body()` await |
| 表单相关接口过滤误判（漏抓或噪音） | E2E 抓取工具先采集样本，根据样本调优 `_FORM_KEYWORDS` / `_EXCLUDE_PATTERN` 正则 |
| system_ref_data 去重用 description 前缀匹配不够精确 | MVP 可接受；后续可加 `url_pattern` + `method` 索引列 |
| 前端 Vue 仓库仍调 `/api/v2/case-data` | 后端 301 重定向兼容；前端改动后续迭代 |

---

## 9. 涉及文件清单

### 改名（第一部分）

| 文件 | 改动 |
|------|------|
| `migrations/20260825220000_rename_case_data_to_business_data.js` | 新增：RENAME 表/列 |
| `src/dao/case-data-dao.js` → `business-data-dao.js` | 文件重命名 + 符号改名 |
| `src/services/case-data-service.js` → `business-data-service.js` | 文件重命名 + 符号改名 |
| `src/routes/v2/case-data.js` → `business-data.js` | 文件重命名 + 路由路径 + 符号改名 |
| `src/case-data-store.js` → `business-data-store.js` | 文件重命名 + 符号改名 |
| `src/services/trajectory/trajectory-recording-runner.js` | `prepareCaseDataInjection` → `prepareBusinessDataInjection` |
| `src/services/trajectory/trajectory-text-extract.js` | `CASE_DATA_SECTION_RE` → `BUSINESS_DATA_SECTION_RE` 等 |
| `src/services/trajectory/trajectory-meta-service.js` | 符号改名 |
| `src/services/trajectory/*.js`（其他） | caseData 引用改名 |
| `src/memory/*.js` | case_data 引用改名 |
| `src/routes/v2/trajectory.js` | case_data 引用改名 |
| `src/models/*.js` | case_data 引用改名 |
| `server.mjs` | 路由注册路径 + 301 重定向 |
| `config/config.js` | case_data 引用改名 |
| `scripts/controller/actions/_case_data.py` → `_business_data.py` | 文件重命名 + 符号改名 + 术语注释重写 |
| `scripts/models/entity/case_data_entity.py` → `business_data_entity.py` | 文件重命名 + 符号改名 |
| `scripts/controller/actions/form_autofill.py` | `lookup_case_value` → `lookup_business_value` |
| `scripts/controller/actions/*.py`（其他引用方） | case_data 引用改名 |
| `scripts/state.py` / `scripts/recorder.py` / `scripts/session_runner.py` | case_data 引用改名 |
| `scripts/characterization/*.py` / `*.mjs`（pin 子串） | 同步更新 pin |
| `src/dashboard/api-docs/groups/*.js` | api-docs 中 case-data 引用改名 |
| `CHANGELOG.md` | [Unreleased] 改名条目 |

### E2E 抓取工具（第二部分）

| 文件 | 改动 |
|------|------|
| `scripts/tools/api-capture.mjs` | 新增：独立 Playwright 抓取脚本 |

### 持久化逻辑（第三部分）

| 文件 | 改动 |
|------|------|
| `scripts/controller/actions/network_capture.py` | 新增：表单相关接口监听 + 过滤 + 规范化 |
| `scripts/session_runner.py` 或 `scripts/recorder.py` | 挂载 network_capture 监听器 |
| `src/memory/memory-service.js` | 新增 `network_captured` 事件处理 |
| `src/memory/protocol.js` | 新增事件类型常量 |
| `src/dao/system-ref-dao.js` | 新增 `findByUrlPattern` 去重查询 |
| `src/services/system-ref-service.js` | 新增 `persistCapturedInterface` 写入方法 |
| `CHANGELOG.md` | [Unreleased] Added 条目 |
