# 被测系统三个接口定义（报文捞取 MVP 契约）

> 日期：2026-08-25
> 关联：PR-DATA 数据捞取；[[packet-capture-mvp-design]]；`2026-08-12-product-requirements-miaoyi-brief.md` §PR-DATA
> 状态：契约草案——需被测系统开发人员确认后实现

---

## 1. 背景与流程

PR-DATA 数据捞取流程：

```
页面路由（hash URL）
  │
  ▼
接口一：页面元素定义 ──→ 返回该页面所有元素的 {name, prop, url}
  │                        name = 字段中文名（调试用）；prop = API 字段名；url = 后端接口地址
  ▼
接口二：接口结构定义 ──→ 给定 url，返回该接口的 {method, inputParams}
  │                        method = HTTP 方法；inputParams = 入参字段名列表
  ▼
接口三：日志文件获取 ──→ 返回应用日志文件（DemoHeadIntercept 拦截器产出的 API 报文）
  │                        JS-gen 解析日志 → 按 URI 筛选 → 提取 Request Body
  ▼
字段映射 ──→ 用结构化方法（非值匹配）将报文字段映射到表单元素
                          → 生成自动化填写数据
```

**核心要点**：我们不需要自己发现「页面元素触发了哪个接口」——接口一的返回值里，每个元素自带 `url` 字段，直接就是该元素触发的后端接口地址。JS-gen 拿到这个 `url` 后，用于接口二（获取接口结构）和接口三（从日志中按 URI 筛选目标接口的报文）。

**字段最小化原则**：三个接口只提供 JS-gen 无法自行获取的信息（元素→接口映射、接口方法、历史报文），其余表单运行时信息由 JS-gen 自行从页面获取。

这三个接口由**被测系统开发人员实现**（在被测系统侧暴露），JS-gen 作为消费方调用。

---

## 2. 接口一：页面元素定义接口

### 2.1 用途

给定一个页面路由（hash URL），返回该页面**所有表单元素**的定义。

每个元素定义含三个字段：显示名称（`name`）、API 字段名（`prop`）和**该元素触发的后端接口地址（`url`）**。

> **`name` 字段用于调试**：开发人员在调试字段映射时，需要知道每个 `prop` 对应的业务含义（如 `cstNo` 是「客户编号」）。`name` 提供人类可读的字段标签，不参与自动化映射逻辑。

> **`url` 字段是核心**：SUT 直接告诉我们每个元素触发哪个后端接口。JS-gen 不需要自己发现元素与接口的触发关系——接口一直接提供。`prop` 则是连接 DOM 与 API 的映射主键（Element UI `el-form-item[prop]` 属性同名）。

### 2.2 请求

```
GET {sutBaseUrl}/api/element-definitions?pageUrl={encodedPageUrl}
```

| 参数 | 类型 | 是否必需 | 说明 |
|------|------|---------|------|
| `pageUrl` | string | 是 | 页面路由（hash URL），如 `http://test.creditv5p2.tansun.com.cn/#/cstMgt/csinfMntSubDmn/cpctMgt/crtCpctInf/hostCstmgrCrtCpctInf/FS00004007HostCstmgrCrtCpctInf` |

### 2.3 响应

```json
{
  "code": 200,
  "data": [
    {
      "name": "客户编号",
      "prop": "cstNo",
      "url": "/prod-api/tansun-tcp-app-pc/tansun-tcp-cst/custCorporat/saveCustCorporat"
    },
    {
      "name": "客户类别",
      "prop": "cpctTp",
      "url": "/prod-api/tansun-tcp-app-pc/tansun-tcp-cst/custCorporat/saveCustCorporat"
    },
    {
      "name": "最终评级等级",
      "prop": "fnlRtgGrd",
      "url": "/prod-api/tansun-tcp-app-pc/tansun-tcp-rtg/IRtgAplyRsltInfApi/getRatingResult"
    }
  ]
}
```

> **`url` 的含义**：该元素参与触发的后端接口地址。同一表单内多个元素共享同一个 `url`（如 `cstNo` 和 `cpctTp` 都指向 `saveCustCorporat`）；不同分区的元素可能指向不同接口（如评级信息的元素指向 `getRatingResult`）。JS-gen 用这个 `url` 作为接口二和接口三的入参。

### 2.4 字段说明

**入参：**

| 字段 | 类型 | 是否必需 | 说明 |
|------|------|---------|------|
| `pageUrl` | string | 是 | 页面路由（hash URL） |

**出参 data[] 每个元素的字段：**

| 字段 | 类型 | 是否必需 | 说明 |
|------|------|---------|------|
| `name` | string | 是 | 字段的中文显示名称（如「客户编号」），供开发人员调试时理解 prop 的业务含义。不参与自动化映射逻辑 |
| `prop` | string | 是 | API 请求体中的字段名（camelCase 缩写），对应 Element UI `el-form-item` 的 `prop` 属性。JS-gen 用它作为映射主键，同时用 CSS 选择器 `el-form-item[prop="{prop}"]` 定位 DOM 控件 |
| `url` | string | 是 | **该元素触发的后端接口地址**（相对路径）。JS-gen 用此字段调用接口二，并在日志中按 URI 筛选该接口的报文，无需自行发现元素-接口触发关系 |

### 2.5 示例（对公客户概况页）

请求：
```
GET /api/element-definitions?pageUrl=http%3A%2F%2Ftest.creditv5p2.tansun.com.cn%2F%23%2FcstMgt%2FcsinfMntSubDmn%2FcpctMgt%2FcrtCpctInf%2FhostCstmgrCrtCpctInf%2FFS00004007HostCstmgrCrtCpctInf
```

响应包含 ~120 个元素定义。其中大部分元素的 `url` 指向 `saveCustCorporat`（保存接口），评级信息区的元素 `url` 指向 `getRatingResult`（评级查询接口）。JS-gen 按 `url` 去重后得到该页面的接口列表，再逐个调用接口二和接口三。

---

## 3. 接口二：接口结构定义接口

### 3.1 用途

给定一个接口 URL（来自接口一返回的 `url` 字段），返回该接口的结构定义：HTTP 方法、入参字段名列表。

这告诉自动化系统**该接口接收哪些字段**——`inputParams` 中的字段名与接口一的 `prop` 对应，构成完整的字段映射验证关系。

### 3.2 请求

```
GET {sutBaseUrl}/api/interface-structure?url={interfaceUrl}
```

| 参数 | 类型 | 是否必需 | 说明 |
|------|------|---------|------|
| `url` | string | 是 | 接口地址（来自接口一返回的元素 `url` 字段），如 `/prod-api/.../custCorporat/saveCustCorporat` |

### 3.3 响应

```json
{
  "code": 200,
  "data": [
    {
      "method": "POST",
      "inputParams": ["cstNo", "cstNm", "cpctTp", "crdtTp", "crdtNo"]
    }
  ]
}
```

### 3.4 字段说明

**入参：**

| 字段 | 类型 | 是否必需 | 说明 |
|------|------|---------|------|
| `url` | string | 是 | 接口地址，来自接口一返回的元素 `url` 字段 |

**出参 data[] 每个接口的字段：**

| 字段 | 类型 | 是否必需 | 说明 |
|------|------|---------|------|
| `method` | string | 是 | HTTP 方法：`POST` / `GET` / `PUT` / `DELETE`。JS-gen 用它区分同一地址下不同方法的请求（GET 查询 vs POST 保存） |
| `inputParams` | string[] | 是 | 入参字段名列表。每个元素是字段名字符串（与接口一的 `prop` 对应）。JS-gen 用它验证接口一的 prop 集合是否完整，并识别接口接收但页面不可见的隐藏/系统字段 |

### 3.5 示例（对公客户概况页）

接口一返回的元素 `url` 去重后得到该页面的接口列表，逐个调用接口二：

| method | url |
|--------|-----|
| POST | `/prod-api/.../custCorporat/saveCustCorporat` |
| POST | `/prod-api/.../custCorporat/getCustCorporat` |
| POST | `/prod-api/.../IRtgAplyRsltInfApi/getRatingResult` |

`inputParams` 包含 ~120 个字段名（与接口一的 `prop` 集合一致）。

---

## 4. 接口三：日志文件获取接口

### 4.1 用途

被测系统提供应用日志文件，JS-gen 从日志文件中解析历史 API 请求/响应报文。

被测系统已集成 `com.tansun.intercept.DemoHeadIntercept` 拦截器，每次 API 调用都会在应用日志中记录完整的请求体和响应体。SUT 只需提供日志文件访问，JS-gen 负责解析、筛选和提取。

> **设计变更说明**：原方案为 SUT 暴露结构化 API 返回 `requestBody`，现改为 SUT 提供日志文件、JS-gen 自行解析。这样 SUT 侧无需开发额外的报文查询接口，只需开放已有的应用日志文件访问——拦截器已在开发环境中集成并持续产出日志。

### 4.2 请求

```
GET {sutBaseUrl}/api/app-log
```

| 参数 | 类型 | 是否必需 | 默认 | 说明 |
|------|------|---------|------|------|
| `appName` | string | 否 | - | 应用名称（如 `tansun-tcp-cst`）。多应用部署时指定日志来源；单应用可不传 |
| `from` | string | 否 | 日志文件头部 | 起始时间（`yyyy-MM-dd HH:mm:ss.SSS`），截取时间范围内的日志，避免传输过大文件 |
| `to` | string | 否 | 日志文件尾部 | 截止时间（`yyyy-MM-dd HH:mm:ss.SSS`） |

> 三个参数均可选。不传时返回完整日志文件。JS-gen 侧自行按 URI 筛选目标接口的报文，SUT 无需按接口地址过滤。

### 4.3 响应

日志文件内容（`Content-Type: text/plain`），为 `DemoHeadIntercept` 拦截器产出的 API 请求/响应日志条目。

**单条完整报文示例**（实际为单行，此处折行展示）：

```
[2026-08-25 15:33:31.950][INFO ][http-nio-20203-exec-8][http-nio-20203-exec-8raceId][tansun-tcp-cst,01a037d6aeb37e64bc767ac06d61a053,01a037d6b025707cb1f83c4f41dbc610,01a037d6b025707cb1f83c4f41dbc610][com.tansun.intercept.DemoHeadIntercept] - ===== API Request ===== Method : POST URI : /custCorporat/getCustCorporat Content-Type : application/json Request Body : {"cstNo":"26042910350833605"} Response Body : {"status":200,"description":"操作成功","data":{...}} Status : 200 ===== API Request End =====
```

**报文格式说明**：

| 片段 | 是否必需 | 说明 |
|------|---------|------|
| `[2026-08-25 15:33:31.950]` | 是 | 日志时间戳（`yyyy-MM-dd HH:mm:ss.SSS`），JS-gen 按此排序取最新 N 条 |
| `[INFO ]` | 是 | 日志级别 |
| `[http-nio-20203-exec-8]` | 是 | 线程名 |
| `[http-nio-20203-exec-8raceId]` | 是 | traceId |
| `[tansun-tcp-cst,globalTraceNo,localTraceNo,parentTraceNo]` | 是 | appAndTrace（应用名 + 三个 trace 号，逗号分隔） |
| `[com.tansun.intercept.DemoHeadIntercept]` | 是 | 拦截器类名（固定值，可用于筛选 API 报文条目） |
| `===== API Request =====` | 是 | 报文开始标记 |
| `Method : POST` | 是 | HTTP 方法 |
| `URI : /custCorporat/getCustCorporat` | 是 | 接口路径（应用内路径，不含网关前缀） |
| `Content-Type : application/json` | 是 | 请求内容类型 |
| `Request Body : {JSON}` | 是 | 请求体（JSON 字符串），**自动化填写的数据来源** |
| `Response Body : {JSON}` | 否 | 响应体（JSON 字符串），回填流程不依赖 |
| `Status : 200` | 否 | HTTP 状态码 |
| `===== API Request End =====` | 是 | 报文结束标记（标记完整条目） |

> **不完整条目**：部分日志条目可能只有 `===== API Request =====` 而没有 `===== API Request End =====`（请求已记录但响应未记录，如长查询未返回）。JS-gen 解析时跳过不完整条目，只保留含 Request Body 且有 End 标记的完整报文。

### 4.4 JS-gen 侧解析逻辑

JS-gen 收到日志文件后，按以下步骤解析：

1. **筛选报文条目**：按 `com.tansun.intercept.DemoHeadIntercept` 类名筛选出 API 拦截器条目
2. **分割完整条目**：按 `===== API Request =====` 和 `===== API Request End =====` 分割出完整的报文条目
3. **提取字段**：从每个完整条目中正则提取 URI、Method、Request Body、Response Body、Status
4. **URI 匹配**：用接口一返回的 `url` 匹配日志条目的 URI。注意路径差异——接口一的 `url` 含网关前缀（如 `/prod-api/tansun-tcp-app-pc/tansun-tcp-cst/custCorporat/saveCustCorporat`），日志中的 URI 是应用内路径（如 `/custCorporat/saveCustCorporat`），JS-gen 按路径后缀匹配（去掉网关前缀后比较）
5. **排序取最新**：按日志时间戳降序排序，取最近 N 条（默认 5）
6. **解析 requestBody**：将 Request Body 字符串解析为 JSON 对象
7. **过滤消费型字段**：结合当前页面元素定义（接口一），排除验证码/一次性 token 等消费型字段

### 4.5 字段说明

**入参：**

| 字段 | 类型 | 是否必需 | 说明 |
|------|------|---------|------|
| `appName` | string | 否 | 应用名称，多应用部署时指定日志来源 |
| `from` | string | 否 | 起始时间，截取时间范围内的日志 |
| `to` | string | 否 | 截止时间 |

**响应内容：**

| 内容 | 是否必需 | 说明 |
|------|---------|------|
| 日志文件文本 | 是 | 包含 `DemoHeadIntercept` 拦截器产出的 API 请求/响应日志条目。每条完整条目以 `===== API Request =====` 开始、`===== API Request End =====` 结束 |

### 4.6 非消费型字段过滤（JS-gen 侧负责）

**SUT 只需返回完整日志文件，不要在 SUT 侧做任何过滤。**

非消费型字段的判断由 JS-gen 负责：判断一个字段是否属于消费型字段，需要结合当前页面的情况进行判断，SUT 侧无法获得页面上下文，不适合做这个判断。筛选、解析、过滤全部由 JS-gen 侧处理。

---

## 5. 三个接口的协作流程

```
┌──────────────────────────────────────────────────────────────────────────┐
│  JS-gen 自动化填写流程                                                     │
│                                                                          │
│  1. 页面路由（hash URL）                                                  │
│     ↓                                                                    │
│  2. 调用接口一 → 获取页面所有元素定义                                      │
│     返回 [{name, prop, url}, ...]                                        │
│     每个 url = 该元素触发的后端接口地址（SUT 直接提供）                     │
│     ↓                                                                    │
│  3. 按 url 去重 → 得到该页面涉及的接口列表                                 │
│     ↓                                                                    │
│  4. 逐个接口调用接口二 → 获取接口结构                                      │
│     返回 {method, inputParams: [字段名]}                                  │
│     inputParams 与接口一的 prop 对应                                      │
│     ↓                                                                    │
│  5. 调用接口三 → 获取应用日志文件                                         │
│     返回日志文本（DemoHeadIntercept 拦截器产出的 API 请求/响应条目）        │
│     ↓                                                                    │
│  6. 日志解析（JS-gen 侧）                                                 │
│     筛选 DemoHeadIntercept 条目 → 按 URI 匹配目标接口                      │
│     → 提取 Request Body → 按时间戳取最近 5 条 → 解析为 JSON               │
│     ↓                                                                    │
│  7. 字段映射（结构化方法，非值匹配）                                       │
│     接口一 prop ↔ 接口二 inputParams ↔ 日志 Request Body 的 key            │
│     + JS-gen 从 DOM 获取控件类型/选项/禁用/必填                            │
│     → 生成填写数据                                                        │
│     ↓                                                                    │
│  8. 自动化填写表单                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

**字段映射的生成（结构化方法，非值匹配）**：

字段映射通过 `prop` 字段名关联，不依赖任何当前表单值：

| 信号来源 | 提供的信息 | 用于 |
|---------|-----------|------|
| 接口一 `prop` | API 字段名 | 映射主键 + DOM 定位锚点 |
| 接口一 `url` | 元素触发的接口地址 | 确定该字段属于哪个接口的入参 |
| 接口二 `inputParams` | 入参字段名列表 | 验证 prop 集合、识别隐藏字段 |
| 接口三 日志 Request Body | 历史样本的字段 key + 值 | 提供填写值（空表单场景也能从历史报文取值） |
| DOM（JS-gen 获取） | 填写方式信息 | 决定填写方式和填写顺序 |

**为什么不用值匹配**：空表单场景下 DOM 控件没有值，无法与 API 请求体做值比对。结构化方法通过 `prop` 字段名直接关联，不依赖值是否存在。

---

## 6. 认证与安全

| 项 | 说明 |
|----|------|
| 认证 | 复用被测系统现有 token 机制（`token` 请求头，JWT） |
| 权限 | 需要被测系统开放元数据查询权限和日志文件读取权限（只读，不涉及业务数据修改） |
| 数据脱敏 | 日志中 Request Body 的字段需为真实值（自动化填写需要实际值）。拦截器已在生产日志中脱敏部分敏感字段（如身份证号 `430304****6128919`、手机号 `136****3636`），JS-gen 会将脱敏值填入表单并标注待人工校正 |

---

## 7. 对被测系统开发人员的要求

1. **实现三个 GET 接口**，按本文定义的请求/响应格式返回数据
2. **接口一**：从被测系统的表单配置 / 页面 schema 中提取元素定义，确保 `prop` 与实际 API 请求体字段名一致。每个元素提供 `name`、`prop` 和 `url` 三个字段
3. **接口二**：从被测系统的接口文档 / Swagger / 代码注解中提取接口结构，返回 `method` 和 `inputParams`（字段名列表）
4. **接口三**：开放应用日志文件访问（`DemoHeadIntercept` 拦截器已集成并持续产出 API 请求/响应日志，SUT 只需提供日志文件读取接口，JS-gen 自行解析报文）。**返回完整日志，不要在 SUT 侧过滤消费型字段，过滤由 JS-gen 侧负责**
5. 接口一与接口二返回数据需保持**字段名一致性**：接口一的 `prop` = 接口二的 `inputParams[]`；日志中 Request Body 的 key 也应与 prop 同名

---

## 8. 与 JS-gen 报文捞取 MVP 的关系

JS-gen 侧的报文捞取 MVP（spec `2026-08-25-message-capture-mvp-spec.md`）实现了**被动监听 + 持久化**路径：录制时自动捕获表单相关接口的请求/响应，存入 `system_ref_data` / `system_ref_entry`。

三个 SUT 侧接口是**补充路径**：当被测系统能主动提供元数据时，JS-gen 可以更精确地做字段映射，而不依赖 AI 推断。两条路径互补：

| 路径 | 数据来源 | 字段映射方式 | 精度 |
|------|---------|-------------|------|
| 被动监听（JS-gen MVP） | 录制时抓取 XHR/fetch | AI 分析请求体 ↔ DOM | 中 |
| SUT 主动供给（三接口） | 接口一/二元数据 + 接口三日志文件 | 接口一直接映射 prop ↔ url，日志提取填写值 | 高 |

长期目标是 SUT 侧三接口为主、被动监听为辅。

**历史数据回填支持度**：三个接口的数据完全足够支持历史数据回填，所有边界场景（级联下拉、条件显隐、重复子表、选项不完整）均由 JS-gen 侧逻辑兜底。详见 `2026-08-25-historical-data-backfill-assessment.md`。
