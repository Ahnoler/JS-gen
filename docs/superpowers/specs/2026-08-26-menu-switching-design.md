# 菜单切换功能设计

> 状态：设计中
> 日期：2026-08-26
> 范围：JS-gen（AI 录制工具）侧三个模块 + 推送契约；手动录制工具和自动化平台为独立系统，不在本次实现范围内

---

## 1. 需求来源

需求文件 `菜单切换-功能需求.xlsx` 描述了跨三个工具的菜单切换功能：

| 工具 | 模块 | 核心需求 |
|------|------|----------|
| AI 录制工具 | 系统树配置 | 上传被测系统提供的 JSON，解析菜单结构 + 菜单 ID + 页面 ID |
| | 菜单录制 | 录制每个菜单 xpath，导出文件（菜单名/层级/xpath/页面 ID） |
| | 交易录制 | 记录交易首页面 ID，无 ID 时自动生成（前缀区分工具来源），推送时带页面 ID |
| 手动录制工具 | 交易录制 | 同上，ID 前缀区分来源 |
| 自动化平台 | 系统管理 | 上传 AI 录制导出的文件，解析存储菜单信息 |
| | 交易管理 | 批量导入改手动录制输出，加"所属菜单"查询/列表/编辑，加"页面 ID"字段 |
| | 执行 | 交易前自动调用菜单切换，同菜单连续跳过，空菜单直接执行 |

本次实现 JS-gen（AI 录制工具）侧的三个模块 + 推送契约。

---

## 2. 数据来源分析

### 2.1 被测系统 JSON（`全部领域-建模组件关系.json`）

被测系统提供的 UML 建模组件关系树，261230 行，顶层两个 key：

**`umlRelInfo`** — 树形层级：

```
子领域 (umlType=2, 306个) ── 多级嵌套（最深 4 级），对应菜单层级
  └── 活动 (umlType=3, 390个) ── 最底层菜单，每个都有 managePage
      ├── managePage: { pdCmptEcd, pdCmptNm, resPath }  ← 页面唯一 ID + 页面名 + 资源路径
      ├── guidePages: [{ pdCmptEcd, pdCmptNm }]          ← 向导页（也有页面 ID）
      ├── scenes → tasks → steps                         ← 场景/任务/步骤（也含 pdCmptEcd）
      └── children: [任务页(umlType=4) → 步骤页(umlType=5)]
```

**`comptEvInfoList`** — 2062 条组件事件信息（按 pdCmptEcd 索引）。

关键字段：
- **`umlEcd`**：每个节点都有，全 6797 个唯一（UML 编码）
- **`pdCmptEcd`**：组件编号，managePage + guidePages 合计 411 个全唯一（格式 `ZJJK00066153`）
- **`pdCmptNm`**：页面名称（如"对公客户管理页"）
- **`resPath`**：资源路径（如 `/cstMgt/csinfMnt/cpctMgt/cpctMgtPg`）

### 2.2 菜单抓取 xlsx（`menu_crawl_no_system.xlsx`）

之前已抓取的系统实际菜单 DOM 数据，411 行（含表头），3 列：

| 系统树节点名称 | 父节点路径 | 菜单Xpath |
|---|---|---|
| 客户管理 | | `//li[@data-id='RES000000001']` |
| 对公客户管理 | 客户管理 | `//li[@data-id='RES000000101']` |

- 一级菜单 24 个（无父路径），二级菜单 386 个（父路径=一级菜单名）
- 全部为 2 级，无更深嵌套
- xpath 格式统一：`//li[@data-id='RES...']`（409 个）+ `//li[@data-url='/home']`（1 个）

### 2.3 JSON 与 xlsx 的关系

两者是**互补**关系，不是同源数据：

| 维度 | JSON | xlsx |
|------|------|------|
| 来源 | 被测系统 UML 建模数据 | JS-gen 抓取的系统实际菜单 DOM |
| 视角 | 业务建模（子领域→活动→任务页→步骤页） | 系统实际菜单（一级→二级） |
| 层级 | 4 级（306→390→757→5344） | 2 级（24→386） |
| 菜单 ID | `umlEcd` / `pdCmptEcd` | `data-id`（在 xpath 中） |
| 页面 ID | `pdCmptEcd` | 无 |
| 菜单 xpath | 无 | 有 |

**匹配率**：xlsx 菜单名精确匹配 JSON 活动 `umlNm` 仅 11 个；匹配 JSON 子领域 `umlNm` 135 个；完全未匹配 264 个。匹配率低是正常的——JSON 是业务建模视角，xlsx 是系统实际菜单视角，名称体系不同。找不到的菜单 `pdCmptEcd` 置空并提醒用户。

---

## 3. 设计方案

### 3.1 核心思路

**以实际系统菜单为准，JSON 做反向查找。**

1. 在实际系统上录制菜单 xpath（模块级 + 功能级，共两级）
2. 用菜单文本 grep JSON 的 `umlNm` / `pdCmptNm`，找到 `pdCmptEcd` 则存入，找不到则置空
3. `pdCmptEcd` 作为锚定 ID——菜单名称变了但 `pdCmptEcd` 不变，可保持交易父子关系
4. 交易执行前按 `menu_xpath` 自动导航（仿照 `runDefaultLogin`）

### 3.2 菜单 JSON 导入 — 两种场景

#### 首次导入（第一次录入菜单）

```
实际系统菜单（已录制 xpath）
  → 用菜单文本 grep JSON（umlNm / pdCmptNm）
  → 找到 pdCmptEcd → 存入 system.pd_cmpt_ecd
  → 找不到 → 置空，记录日志提醒用户"JSON 缺少此菜单"
```

#### 更新导入（第二次及以上）

```
对每个已有菜单节点：

P1（优先）：已有菜单的 pdCmptEcd → 去新 JSON 中查找
  → 找到 → 更新菜单名称等字段（菜单改名但锚定不变，交易父子关系不受影响）
  → 找不到 → 进入 P2

P2（退回）：用菜单文本 grep 新 JSON
  → (a) 文本找到 pdCmptEcd → 存入（可能是新菜单，也可能是其他 pdCmptEcd 替代了原菜单名）
  → (b) 文本也找不到 → pdCmptEcd 置空，提醒用户
```

P1 是**反向查找**——已有菜单的 `pdCmptEcd` 去新 JSON 里找，找到说明菜单在版本迭代中仍存在（可能改了名），直接更新名称即可。

### 3.3 菜单录制

只录制两级：模块（一级菜单）+ 功能（二级菜单）。

流程（仿照 prepare 的自动登录 `runDefaultLogin`）：
1. 打开被测系统，自动登录（复用 `runDefaultLogin`）
2. 遍历实际系统菜单树
3. 对每个菜单，捕获 xpath（`//li[@data-id='...']`）
4. 用菜单文本 grep JSON，获取 `pdCmptEcd`
5. 存入 system 表（`menu_xpath` + `pd_cmpt_ecd`）

导出格式（在现有 xlsx 三列基础上增加 pdCmptEcd 列）：

| 系统树节点名称 | 父节点路径 | 菜单Xpath | pdCmptEcd |
|---|---|---|---|
| 客户管理 | | `//li[@data-id='RES000000001']` | |
| 对公客户管理 | 客户管理 | `//li[@data-id='RES000000101']` | ZJJK00066153 |

（导出格式暂定，后续可调整）

### 3.4 交易执行前的自动菜单导航

仿照 `runDefaultLogin`（`src/services/trajectory/trajectory-record-lifecycle.js:237`）：

```
执行交易前：
  1. 查 trajectory → function_id → system 表的 menu_xpath
  2. 如果有 menu_xpath：
     runtime.suppressStepPersist = true
     runtime.isReplay = true
     execSession.forwardStdin('replay_actions', [{click_menu_item, {xpath}}])
     等 replay_done
  3. 连续交易同菜单 → 跳过（缓存上一次菜单路径）
  4. menu_xpath 为空 → 直接执行
```

菜单导航动作不入步骤表（`suppressStepPersist = true`），与自动登录行为一致。

---

## 4. 数据模型变更

### 4.1 system 表（已有，加列）

```sql
ALTER TABLE system
  ADD COLUMN menu_xpath   VARCHAR(2048) DEFAULT '' COMMENT '菜单xpath（菜单录制产物）',
  ADD COLUMN pd_cmpt_ecd  VARCHAR(64)   DEFAULT '' COMMENT '组件编号（锚定ID，仅活动级有）';
```

- `menu_xpath`：菜单录制时填入，如 `//li[@data-id='RES000000101']`
- `pd_cmpt_ecd`：从 JSON 的 `managePage.pdCmptEcd` 提取；仅功能级（type=3）节点有值；模块级（type=2）通常无值
- **菜单迁移**：重新导入 JSON 时，按 `pd_cmpt_ecd` 匹配已有节点 → 更新名称，保持父子关系不变

### 4.2 system_page 表（新建）

```sql
CREATE TABLE system_page (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  system_node_id BIGINT UNSIGNED NOT NULL COMMENT 'FK→system.id（活动节点）',
  page_id        VARCHAR(64)   NOT NULL COMMENT 'pdCmptEcd 页面唯一ID',
  page_name      VARCHAR(255)  DEFAULT '' COMMENT '页面名称（pdCmptNm）',
  res_path       VARCHAR(2048) DEFAULT '' COMMENT '资源路径（managePage.resPath）',
  page_type      VARCHAR(32)   DEFAULT 'managePage' COMMENT 'managePage/guidePage',
  created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_page_id (page_id),
  KEY idx_system_node (system_node_id),
  CONSTRAINT fk_page_system_node FOREIGN KEY (system_node_id) REFERENCES system (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统页面（菜单对应的页面信息）';
```

### 4.3 trajectory 表（已有，加列）

```sql
ALTER TABLE trajectory
  ADD COLUMN page_id VARCHAR(64) DEFAULT '' COMMENT '交易首页面ID（pdCmptEcd 或自动生成）';
```

---

## 5. 接口设计

### 5.1 JSON 上传解析（新增）

```
POST /api/v2/system-mgmt/import-json
Content-Type: multipart/form-data
Body: file=<JSON文件>

Response:
{
  "imported": 411,          // JSON 中解析出的页面总数
  "matched": 56,            // 匹配到 pdCmptEcd 的菜单数
  "unmatched": 354,         // 未匹配的菜单数
  "unmatchedList": [        // 未匹配菜单列表（供用户排查）
    { "menuName": "工作台", "parentPath": "" },
    ...
  ]
}
```

解析逻辑：
1. 解析 JSON，提取 `umlRelInfo` 树中所有活动节点的 `managePage` / `guidePages`，建立 `pdCmptEcd → {umlNm, pdCmptNm, resPath}` 索引
2. 遍历已有 system 表中的菜单节点
3. 首次导入：用菜单名 grep JSON 索引（`umlNm` 精确匹配 + `pdCmptNm` 去掉"页"字后匹配）
4. 更新导入：P1 用 `pd_cmpt_ecd` 查 JSON 索引；P2 用菜单名 grep
5. 将页面信息存入 `system_page` 表
6. 返回匹配/未匹配统计

### 5.2 菜单录制（新增）

```
POST /api/v2/system-mgmt/menu-record/start
Body: { "systemId": "<系统节点UUID>" }

→ 开启浏览器，自动登录，进入菜单录制模式
→ 逐个点击菜单，捕获 xpath
→ 用菜单文本 grep JSON，获取 pdCmptEcd
→ 写回 system 表的 menu_xpath + pd_cmpt_ecd

POST /api/v2/system-mgmt/menu-record/stop
→ 结束录制，返回结果
```

### 5.3 菜单导出（新增）

```
GET /api/v2/system-mgmt/menu-export?systemId=<UUID>&format=xlsx

→ 导出 xlsx：系统树节点名称 | 父节点路径 | 菜单Xpath | pdCmptEcd
```

### 5.4 推送契约扩展

V3 payload 交易级增加 `pageId` 字段：

```json
{
  "transcationProperties": [
    {
      "propertiesID": "...",
      "propertiesPID": "...",
      "type": "page",
      "pageId": "ZJJK00066153"
    }
  ]
}
```

---

## 6. 实现文件清单

| 层 | 文件 | 改动 |
|----|------|------|
| 迁移 | `migrations/20260826xxxxxx_add_menu_xpath_and_page.sql` | system 加列 + 新建 system_page + trajectory 加列 |
| DAO | `src/dao/system-page-dao.js` | 新增 |
| DAO | `src/dao/system-dao.js` | 加 menu_xpath / pd_cmpt_ecd 字段读写 |
| Service | `src/services/menu-json-import.js` | 新增：JSON 解析 + pdCmptEcd 匹配 |
| Service | `src/services/menu-record.js` | 新增：菜单录制编排 |
| Service | `src/services/menu-export.js` | 新增：导出 xlsx |
| Route | `src/routes/v2/system-mgmt.js` | 加 import-json / menu-record / menu-export 路由 |
| Route | `src/routes/v2/trajectory-record.js` | 录制时记录 page_id |
| Export | `src/services/transaction-export-v3.js` | V3 payload 加 pageId |
| Export | `src/services/partner-platform.js` | 推送契约加 pageId |
| Replay | `src/services/trajectory/replay-batch-runner.js` | 交易前菜单导航前置动作 |
| Python | `scripts/controller/actions/_navigation.py` | 菜单录制时 xpath 捕获 |
| API docs | `src/dashboard/api-docs/groups/system-mgmt.js` | 新接口文档 |

---

## 7. 验证

```bash
# 迁移
node migrations/20260826xxxxxx_add_menu_xpath_and_page.js

# JSON 导入
curl -X POST http://localhost:4097/api/v2/system-mgmt/import-json \
  -F "file=@全部领域-建模组件关系.json"

# 菜单导出
curl http://localhost:4097/api/v2/system-mgmt/menu-export?systemId=xxx -o menu_export.xlsx

# V3 推送 dry-run（确认 pageId 在 payload 中）
curl -X POST http://localhost:4097/api/v2/export/transactions-v3 \
  -d '{"trajectoryIds":[182],"dryRun":true}'

# verify-all
bash scripts/refactor/verify-all.sh
```

---

## 8. 待确认问题

1. **自动生成页面 ID 规则**：需求说"从 ID 上要能看出是自动生成的，区分工具来源"。暂定 `AI_` + UUID 去横线前 12 位（如 `AI_a3f2b1c4d5e6`），手动录制用 `MAN_` 前缀。待用户最终确认。

2. **导出文件格式**：暂定 xlsx（沿用现有系统树 Excel 模板风格 + pdCmptEcd 列）。待用户确认是否需要 JSON 格式。

3. **菜单录制是全自动还是半自动**：全自动 = 程序自动遍历所有菜单并点击录制；半自动 = 人工逐个点击菜单，程序捕获 xpath。全自动需要处理菜单展开/折叠逻辑。待用户确认。

4. **执行侧位置**：菜单导航前置动作放在 JS-gen 的回放引擎里（`replay-batch-runner.js`），还是放在自动化平台侧？如果放自动化平台侧，JS-gen 只需在推送 payload 中携带 `menu_xpath`。待确认。
