# 批量推送 V3 数据结构去重优化设计（Spec）

> 状态：待评审  
> 日期：2026-08-18  
> 范围：`/api/v2/export/*transaction-v3`、`/transactions-v3` 的响应/推送体

---

## 1. 背景与问题

当前 V3 单条交易 JSON 约 300KB，主要问题：

- `result.groups` 与 `transcationProperties` 两套结构重复表达同一批步骤。
- 每个控件节点携带大量冗余字段，例如 `recorded`、`manualRecord`、`targetType`、`group`、`anchor` 等。
- 体积大，传输慢、不稳定。

目标：**保留 `transcationProperties` 作为唯一业务事件数组**，把 V3 的 `result` 树信息合并进每条 `transcationProperty`，同时把页面/弹窗截图信息提升到 `payload.screenshots` 统一维护。

---

## 2. 目标

- 去掉独立的 `result.groups` 树。
- 保留 `transcationProperties`，并在每条属性中合并：
  - 页面/弹窗归属：`id`、`pid`、`type`
  - 控件顺序：`scanIndex`
  - 元素分层：`regionId`、`regionLabel`、`layers`
  - 元素点亮：`rect`、`url`
- 新增 `payload.screenshots`：统一存放页面/弹窗截图元数据。
- 删除无用字段，例如：
  - `recorded`
  - `manualRecord`
  - `targetType`
  - 冗余的 `group` 对象
  - 冗余的 `anchorTarget` / `anchorPropertiesName`
- 直接替换当前 V3，不新增版本端点。
- 不引入短字段名，保持可读性。
- 暂不引入 gzip。
- `screenshots[].bucket` 通过 `.env` 配置，不写死。

---

## 3. 非目标

- 不做字典/索引压缩（当前阶段先做结构合并和字段裁剪）。
- 不保留旧 V3.0 兼容端点。
- 不改变 V2 接口。

---

## 3.1 V3 基线说明

- 已确认当前分支 `uara_V1.2` 上 V3 相关文件与端点均存在：
  - `src/services/transaction-export-v3.js`
  - `src/routes/v2/export-mgmt.js` 中的 V3 端点
  - `src/dashboard/api-docs/groups/export-mgmt.js` 中的 V3 文档
  - `scripts/characterization/characterize-export-v3.mjs`
- 后续实施直接基于当前工作区改造，无需从 Git 历史恢复。

---

## 4. 目标数据结构

### 4.1 整体结构

```jsonc
{
  "trajectoryId": 157,
  "schemaVersion": 3,
  "payload": {
    "screenshots": [
      {
        "phaseNumber": 1,
        "bucket": "uara",
        "type": "page",
        "key": "page-1",
        "name": "页面1 · 点击客户管理，点击对公客户管理。预期结果",
        "url": "test1....jpg",
        "expires": 3600
      },
      {
        "phaseNumber": 2,
        "bucket": "uara",
        "type": "dialog",
        "key": "page-2|dialog:地址选择器",
        "name": "地址选择器",
        "url": "test2....jpg",
        "expires": 3600
      }
    ],
    "transcationEventTypeList": [
      {
        "transcId": "157",
        "transcationName": "信贷潜在客户批量新增1.by李淼一",
        "systemId": "98",
        "projectId": "31",
        "transcationType": "web",
        "testFrame": "playwright",
        "transcationProperties": [
          {
            "options": "",
            "elementType": "//li[@title='对公客户管理']",
            "eventTypeName": "点击",
            "eventTypeValue": "click",
            "transcationType": "playwright",
            "objectValue": "",
            "propertiesName": "点击对公客户管理",
            "label": "对公客户管理",
            "mothed": "By.XPATH",
            "scanIndex": 15,
            "type": "ele",
            "id": "step-3",
            "pid": "page-2",
            "regionId": "tab:客户管理",
            "regionLabel": "客户管理",
            "rect": {
              "x1": 100,
              "y1": 100,
              "x2": 200,
              "y2": 200
            }
          }
        ]
      }
    ]
  },
  "count": 30,
  "skipped": {
    "metaActions": 3
  },
  "stats": {
    "absoluteFallback": 0,
    "missingOptions": 1,
    "noRectControls": 0
  }
}
```

### 4.2 `payload.screenshots`

页面/弹窗截图统一放在这里，不再在 `result` 里单独维护。

```jsonc
{
  "phaseNumber": 1,
  "bucket": "uara",
  "type": "page",
  "key": "page-1",
  "name": "页面1 · 点击客户管理",
  "url": "test1....jpg",
  "expires": 3600
}
```

字段说明：

| 字段 | 说明 |
|---|---|
| `phaseNumber` | 阶段序号 |
| `bucket` | 存储桶标识，从 `.env` 配置读取，例如 `PUSH_V3_SCREENSHOT_BUCKET=uara` |
| `type` | 截图类型：`page` 或 `dialog` |
| `key` | 页面/弹窗唯一 key，例如 `page-1`、`page-2|dialog:地址选择器` |
| `name` | 页面/弹窗展示名 |
| `url` | 图片访问 URL（MinIO 预签名 URL 或 API 代理 URL） |
| `expires` | URL 有效期（秒），可选 |
| `trajectoryId` | 批量推送时用于区分不同交易；单条推送可省略 |

### 4.3 `transcationProperties`

每条属性 = V2 原有事件字段 + V3 控件树/元素分层/点亮字段。

#### 保留的 V2 核心字段

以 V2 的五个核心字段为基础扩展：

| 字段 | 说明 |
|---|---|
| `elementType` | 定位表达式（xpath） |
| `eventTypeName` | 中文事件名，如“点击” |
| `eventTypeValue` | 英文事件类型，如 `click` |
| `objectValue` | 操作值 |
| `propertiesName` | 属性/控件展示名（需唯一，给其他后端的关键数据） |
| `label` | 原始控件标签，用于元素点亮/匹配，不与 `propertiesName` 唯一化绑定 |

同时保留既有辅助字段：

| 字段 | 说明 |
|---|---|
| `options` | 下拉/单选选项，空字符串表示无 |
| `transcationType` | 固定 `playwright` |
| `mothed` | 定位方式，固定 `By.XPATH` |

#### 新增字段

| 字段 | 说明 |
|---|---|
| `scanIndex` | 全局顺序，从 0 开始，按 `transcationProperties` 数组顺序递增 |
| `type` | 节点类型：`ele` / `page` / `dialog`（事件属性中一般为 `ele`） |
| `id` | 控件节点 ID，如 `step-3` |
| `pid` | 父节点 ID，如 `page-2` 或弹窗 key，用于关联 `payload.screenshots` |
| `regionId` | 元素分层 ID，如 `tab:客户管理` |
| `regionLabel` | 元素分层展示名 |
| `rect` | 点亮坐标 `{x1,y1,x2,y2}`，可选 |

---

## 5. 与旧 V3.0 的差异

| 项目 | 旧 V3.0 | 新 V3 |
|---|---|---|
| 业务事件 | `transcationProperties` + `result.groups` 双轨 | 只有 `transcationProperties` |
| 页面截图 | `result.groups[].screenshots` | `payload.screenshots` |
| 弹窗截图 | 无 | `payload.screenshots` 支持 `type:'dialog'` |
| 元素分层 | 分散在 groups / metadata | 直接在 `transcationProperties` 输出 `regionId` / `regionLabel` / `layers` |
| 元素点亮 | `result.groups` 中的 `ele.rect` | 合并进 `transcationProperties.rect` |
| 冗余字段 | `recorded`、`manualRecord`、`targetType`、`group`、`anchor` 等 | 删除或最小化 |
| 体积 | ~300KB | 预计显著下降 |

---

## 6. 字段裁剪规则

### 6.1 删除字段

以下字段不再输出：

- `recorded`
- `manualRecord`
- `targetType`
- 复杂 `group` 对象
- `anchorTarget` / `anchorPropertiesName`
- 非必需的 `placeholder` / `title` / `disabled` / `required` / `readonly` / `value`

### 6.2 可选字段

- `rect`：仅当存在合法 bbox 时输出。
- `layers`：默认不输出；如后续需要完整分层，再加回（当前用 `regionId` / `regionLabel` 表达简洁分层）。
- `expires`：仅当截图 URL 为预签名 URL 时输出。

---

## 7. 页面/弹窗表达方式

### 7.1 页面

- 每个阶段对应一个页面，`pid` 为该页面 key。
- 页面截图信息统一在 `payload.screenshots` 中，`transcationProperties` 里的控件通过 `pid` 关联到对应截图，不在属性里重复输出 `url`。

### 7.2 弹窗

- 弹窗需要独立截图。
- `payload.screenshots` 中新增 `type:'dialog'` 的截图条目。
- 弹窗内控件的 `pid` 使用弹窗 key，例如：
  ```
  page-2|dialog:地址选择器
  ```
- 弹窗内控件通过 `pid` 关联到 `payload.screenshots` 中对应的 `dialog` 截图，不在属性里重复输出 `url`。
- 弹窗 key 可由页面 key + 弹窗标题组成，必要时追加 anchor 信息。

---

## 7.3 弹窗截图开发说明

- 当前系统还没有弹窗独立截图数据。
- 新 V3 结构先支持 `payload.screenshots[].type='dialog'`。
- 实际弹窗截图采集/生成需要单独开发，本期如果拿不到 dialog 截图，则先不输出 dialog 截图条目。

---

## 8. 配置项

新增 `.env` 配置：

```env
# 批量推送 V3 截图存储桶
PUSH_V3_SCREENSHOT_BUCKET=uara

# 截图 URL 有效期（秒），默认 3600
PUSH_V3_SCREENSHOT_EXPIRES=3600
```

- `PUSH_V3_SCREENSHOT_BUCKET` 对应 `payload.screenshots[].bucket`。
- 不写死，允许不同环境配置。

---

## 9. 兼容与发布策略

- **直接替换 V3**，不新增 V3.1 端点。
- 由于 V3 尚未进入测试环境，允许破坏性结构调整。
- 同步修改：
  - `src/services/transaction-export-v3.js`
  - `src/routes/v2/export-mgmt.js`
  - `src/dashboard/api-docs/groups/export-mgmt.js`
  - `scripts/characterization/characterize-export-v3.mjs`

---

## 10. 预期收益

| 项 | 旧 V3.0 | 新 V3 |
|---|---|---|
| 结构 | 双轨 | 单轨 |
| 单条大小 | ~300KB | 预计 100KB 左右或更低 |
| 无用字段 | 多 | 少 |
| 元素分层 | 需从 metadata/groups 解析 | 直接字段输出 |
| 元素点亮 | 需理解 groups 树 | `transcationProperties` 直接带 `rect`，通过 `pid` 关联截图 |
| 消费方解析 | 复杂 | 简单 |

---

## 11. 边界与鲁棒性

- 无 `rect` 的控件：省略 `rect`，不影响事件推送。
- 无截图阶段：`payload.screenshots` 为空数组，属性中不输出 `url`。
- 无分层数据：`regionId` / `regionLabel` / `layers` 省略或为空。
- 弹窗 key 过长：如果 `pid` 超过长度限制，可只保留 `dialog:<标题>`，anchor 信息后续再补。
- 字段缺失：消费方应按“缺省兼容”处理，不应因缺少可选字段报错。

---

## 12. 待确认问题

1. ✅ 已确认使用 `bucket` 字段名。
2. ✅ 已确认从 Git 历史恢复 V3 基线再改造。
3. ✅ 已确认 `propertiesName` 保留给其他后端，新增 `label` 用于点亮匹配。
4. ✅ 弹窗独立截图需要开发；新结构先支持 `type:'dialog'`，实际截图数据由后续开发补齐。
5. ✅ `transcationProperty` 只保留 `pid`，不重复输出 `url`；消费方通过 `pid` 到 `payload.screenshots` 查 `url`。
6. ✅ `scanIndex` 设计为全局顺序，从 0 开始，按 `transcationProperties` 数组顺序递增。
7. ✅ `layers` 默认不输出，保持简洁；分层用 `regionId` / `regionLabel` 表达。

---

## 13. 结论

采用“**保留 `transcationProperties`，合并 `result` 进入属性数组，页面/弹窗截图提升到 `payload.screenshots`**”的简化结构。  
在 V2 五个核心字段基础上增加元素分层与点亮所需字段，删除无用字段，直接替换当前 V3。
