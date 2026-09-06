# 弹窗独立截图采集方案（Spec）

> 状态：待评审  
> 日期：2026-08-18  
> 前置：批量推送 V3 优化 spec `2026-08-18-batch-push-v3-dedup-design.md`

---

## 1. 背景

V3 推送中，弹窗控件需要独立截图用于“元素点亮”。

当前限制：

- 只有阶段长图（`phase_highlight`），没有弹窗独立截图。
- 弹窗控件的 `rect` 目前相对阶段长图。
- `payload.screenshots` 只输出 `type:'page'`，没有 `type:'dialog'`。

目标：**在录制时实时采集弹窗独立截图**，并在 V3 推送中输出：

```jsonc
{
  "phaseNumber": 2,
  "bucket": "uara",
  "type": "dialog",
  "key": "page-2|dialog:地址选择器",
  "name": "地址选择器",
  "url": "/api/v2/screenshots/456/image",
  "expires": 3600
}
```

弹窗内控件通过 `pid` 关联该截图，`rect` 相对弹窗截图。

---

## 2. 目标

- 录制时检测到弹窗操作，实时采集弹窗截图。
- 支持同一阶段多个弹窗（同标题不同实例通过 `dialog_key` 区分）。
- 弹窗控件坐标相对弹窗截图。
- V3 `payload.screenshots` 输出 `type:'dialog'`。
- 不破坏现有阶段长图逻辑。
- **不新增数据库字段 / 不新增 kind**，尽量复用现有 `screenshot` 表。

---

## 3. 非目标

- 第一版不做弹窗内部滚动拼接截图。
- 不处理历史数据回填。
- 不改变 V2 接口。
- 不做弹窗录屏 / 视频。

---

## 4. 数据存储方案（不新增字段）

为了不新增 `dialog_highlight` kind 和 `dialog_key` 等字段，采用**复用现有 `screenshot` 表**的方式：

- 弹窗截图仍然使用 `kind = 'phase_highlight'`。
- `trajectory_phase_id` 设为 `NULL`。
- `trajectory_step_id` 指向**该弹窗的锚点步骤 / 第一个弹窗操作步骤**。
- 在 `metadata_json` 中标记：
  ```jsonc
  {
    "dialog": true,
    "dialogKey": "page-2|dialog:地址选择器",
    "dialogTitle": "地址选择器",
    "anchorXpath": "//button[normalize-space()='选择']"
  }
  ```

这样：

- 不需要修改 `screenshot.kind` 枚举。
- 不需要新增 `dialog_key` / `dialog_title` / `anchor_xpath` 列。
- 利用现有 `uk_ss_step_kind (trajectory_step_id, kind)` 唯一键，一个锚点步骤最多一张弹窗截图。
- 如果同一个锚点步骤会打开多个不同弹窗，可用不同 `trajectory_step_id`（例如第一个弹窗内操作步骤）区分。

### 读取方式

查询弹窗截图：

```sql
SELECT *
FROM screenshot
WHERE kind = 'phase_highlight'
  AND trajectory_step_id IS NOT NULL
  AND trajectory_phase_id IS NULL
  AND JSON_EXTRACT(metadata_json, '$.dialog') = true;
```

---

## 5. 弹窗截图元数据

`metadata_json` 建议结构：

```jsonc
{
  "dialog": true,
  "imageWidth": 600,
  "imageHeight": 400,
  "contentWidth": 600,
  "contentHeight": 400,
  "dialogKey": "page-2|dialog:地址选择器",
  "dialogTitle": "地址选择器",
  "anchorXpath": "//button[normalize-space()='选择']",
  "elements": [
    {
      "index": 0,
      "kind": "form_select",
      "label": "省份",
      "layers": [],
      "regionId": "overlay:地址选择器",
      "parentRegionId": null,
      "rect": { "x1": 20, "y1": 50, "x2": 300, "y2": 80 },
      "outsideRoot": false
    }
  ]
}
```

`rect` 为相对弹窗左上角的内容坐标。

---

## 6. 录制时实时采集方案

### 6.1 触发时机

- 检测到步骤 `element_json.region_id` 含 `overlay:` 时。
- 在该步骤执行后、弹窗仍处于打开状态时立即采集。
- 同一弹窗只采集一次；关闭后再次打开同一弹窗可重新采集覆盖。

### 6.2 采集流程

```
检测到 overlay 步骤
      ↓
找到弹窗根元素
（.el-dialog / .el-drawer / .el-message-box / 包含 overlay region 的最近弹窗容器）
      ↓
获取弹窗 boundingRect
      ↓
Page.captureScreenshot(clip=弹窗区域)
      ↓
生成 metadata（弹窗内元素 rect 相对弹窗）
      ↓
写入 screenshot 表
  kind = 'phase_highlight'
  trajectory_step_id = 锚点步骤 / 第一个弹窗操作步骤
  trajectory_phase_id = NULL
  metadata_json.dialog = true
```

### 6.3 弹窗根元素识别

```js
function findDialogHost(el) {
  let cur = el;
  while (cur && cur !== document.body) {
    const cls = String(cur.className || '');
    if (/(^|\s)(el-dialog|el-drawer|el-message-box)(\s|$)/.test(cls)) return cur;
    cur = cur.parentElement;
  }
  return null;
}
```

### 6.4 第一版范围

- 只截弹窗当前可视区域。
- 不做弹窗内部滚动拼接。
- 如果弹窗内容超出可视区域，第一版只保证可视部分；后续有需要再支持滚动拼接。

---

## 7. 历史数据

### 7.1 历史数据定义

历史数据指：

- 在本功能上线之前已经录制完成的交易。
- 这些交易只有阶段长图，没有弹窗独立截图。
- 它们的 `element_json` 可能已经带有 `overlay:` 分层信息，但截图没有单独保存。

### 7.2 第一版策略

- **不回填历史数据**。
- 历史交易继续使用旧逻辑：
  - 弹窗控件 `rect` 相对阶段长图。
  - `payload.screenshots` 不输出 `type:'dialog'`。
- 后续如果业务需要，再单独做历史数据裁剪回填。

---

## 8. V3 推送集成

### 8.1 `payload.screenshots`

`buildV3Screenshots` 增加读取弹窗截图：

```jsonc
{
  "phaseNumber": 2,
  "bucket": "uara",
  "type": "dialog",
  "key": "page-2|dialog:地址选择器",
  "name": "地址选择器",
  "url": "/api/v2/screenshots/456/image",
  "expires": 3600
}
```

### 8.2 `transcationProperties`

弹窗内控件：

- `pid` 使用弹窗 `key`
- `rect` 相对弹窗截图（如果存在弹窗截图）
- 如果不存在弹窗截图，`rect` 继续相对阶段长图

---

## 9. 实施影响

| 模块 | 影响 |
|---|---|
| 数据库 | **无 schema 变更**，复用现有 `screenshot` 表 |
| 采集 | 新增弹窗截图采集函数，接入录制链路 |
| 存储 | `screenshot-service` 支持保存/读取 dialog 截图（通过 metadata 标记） |
| V3 推送 | `buildV3Screenshots` 输出 dialog 截图；`buildV3Properties` 的 dialog rect 语义按截图类型切换 |
| API 文档 | 更新 `payload.screenshots` 支持 `type:'dialog'` |
| 前端/消费方 | 根据 `pid` 找到 dialog 截图和对应 rect |

---

## 10. 已确认决策

1. 弹窗截图在**录制时实时采集**。
2. **不新增数据库字段 / kind**，复用现有 `screenshot` 表 + `metadata_json.dialog` 标记。
3. 历史数据第一版**不回填**，继续使用阶段长图。
4. 第一版**不做弹窗内部滚动截图**。

---

## 11. 结论

采用：

- **新数据**：录制时实时采集弹窗可视区域截图。
- **存储**：复用 `screenshot` 表，`kind='phase_highlight'` + `trajectory_step_id` + `metadata_json.dialog=true`。
- **推送**：V3 `payload.screenshots` 输出 `type:'dialog'`，弹窗控件 `rect` 相对弹窗截图。
- **历史数据**：暂不回填，继续使用阶段长图。
