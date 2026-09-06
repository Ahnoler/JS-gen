# 弹窗独立截图采集 · 实施计划

日期：2026-08-18 · 前置：spec `docs/superpowers/specs/2026-08-18-dialog-screenshot-capture-design.md`

## 目标

在录制过程中，当检测到弹窗（`overlay:`）操作时，实时采集弹窗可视区域截图，并在 V3 推送中输出 `payload.screenshots[].type='dialog'`。

**不新增数据库字段 / 不新增 kind**，复用现有 `screenshot` 表：

- `kind = 'phase_highlight'`
- `trajectory_step_id = 锚点步骤 / 第一个弹窗操作步骤`
- `trajectory_phase_id = NULL`
- `metadata_json.dialog = true`

---

## 任务拆分

### Task 1: Python 侧弹窗截图采集

文件：
- `scripts/state.py`
- `scripts/controller/service.py`
- `scripts/manual_recorder/recorder.py`

内容：
- 新增 `capture_dialog_png_b64(page, element)`：
  - 从 `element` 向上找到弹窗根元素（`.el-dialog` / `.el-drawer` / `.el-message-box`）。
  - 使用 Playwright 对弹窗元素截图（只截可视区域，不做内部滚动拼接）。
  - 返回 `{ dialogB64, dialogMeta }`。
- 扩展 `emit_step_screenshot(entry_id, before_b64, after_b64, dialog_b64=None, dialog_meta=None)`：
  - 当 `dialog_b64` 存在时，在 `data` 中增加：
    ```jsonc
    "dialog": "base64...",
    "dialogMeta": {
      "dialogKey": "page-2|dialog:地址选择器",
      "dialogTitle": "地址选择器",
      "anchorXpath": "..."
    }
    ```
- 在 `_wrap_action_with_screenshots` 中：
  - 执行动作后，如果 `_ACTION_LOG[-1].element` 的 `region_id` 含 `overlay:`，则调用弹窗截图。
  - 将弹窗截图传给 `emit_step_screenshot`。
- 在 `manual_recorder` 的 `_record_mapped_async` 中同样处理。

验证：
- Python 单测 / characterization：
  - 构造 overlay element，能识别弹窗根。
  - `emit_step_screenshot` 输出包含 `dialog` 字段。
  - 非 overlay 步骤不输出 `dialog`。

---

### Task 2: Node 侧保存弹窗截图

文件：
- `src/dao/screenshot-dao.js`
- `src/services/screenshot-service.js`

内容：
- 新增 DAO 方法 `replaceDialogForStep(screenshot)`：
  - 使用 `trajectory_step_id` + `kind='phase_highlight'` 作为唯一维度。
  - 写入：
    - `storage_type`
    - `storage_path`
    - `image_url`
    - `trajectory_step_id`
    - `trajectory_phase_id = NULL`
    - `kind = 'phase_highlight'`
    - `metadata_json`（含 `dialog: true`）
- 新增 service 方法 `replaceDialogScreenshot(trajectoryStepId, { trajectoryId, buffer, mimeType, metadataJson })`：
  - 先删除旧的同步骤 dialog 截图对象（MinIO/本地）。
  - 上传新图到 MinIO。
  - 调用 DAO 保存。
- 扩展 `getScreenshotImage` / 删除逻辑，支持 `metadata_json.dialog=true` 的截图。

验证：
- 能保存/读取 dialog 截图。
- 同一 step 重复保存会覆盖。
- 删除 step 时 dialog 截图同步清理。

---

### Task 3: Node 接收 Python 弹窗截图事件

文件：
- `src/routes/browser-session/persist-live.js`
- `src/services/trajectory/trajectory-recording-runner.js`

内容：
- `writeShotsForStep` 增加 `dialogB64` / `dialogMeta` 参数。
- `stashOrApplyStepScreenshot` 的 pending 数据增加 `dialog` / `dialogMeta`。
- `flushPendingStepScreenshot` 传递 dialog 数据。
- 收到 `step_screenshot` 时，如果 `payload.dialog` 存在，调用 `replaceDialogScreenshot` 保存。

验证：
- 模拟 `step_screenshot` 带 `dialog` 字段，能正确落库。
- 不带 `dialog` 的旧事件不受影响。

---

### Task 4: V3 推送集成

文件：
- `src/services/transaction-export-v3.js`

内容：
- `buildV3Screenshots` 增加读取 dialog 截图：
  - 查询 `kind='phase_highlight'` 且 `metadata_json.dialog=true` 的截图。
  - 输出：
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
- `buildV3Properties`：
  - 如果某个弹窗存在 dialog 截图，则弹窗内控件的 `rect` 使用 dialog 截图元数据中的相对坐标。
  - 如果没有 dialog 截图，`rect` 继续相对阶段长图。

验证：
- 构造含 dialog 截图的数据，V3 输出 `type:'dialog'` 的 screenshot。
- 弹窗控件 `pid` 与 dialog screenshot `key` 一致。
- 有 dialog 截图时，`rect` 使用 dialog 相对坐标。

---

### Task 5: API 文档 / characterization / CHANGELOG

文件：
- `src/dashboard/api-docs/groups/export-mgmt.js`
- `scripts/characterization/characterize-export-v3.mjs`
- `scripts/characterization/characterize-dialog-screenshot.mjs`（新增）
- `CHANGELOG.md`

内容：
- API 文档补充 `payload.screenshots[].type='dialog'` 说明。
- characterization 增加：
  - Python 弹窗截图采集纯函数。
  - Node 保存/读取 dialog 截图。
  - V3 输出 dialog screenshot。
- CHANGELOG 新增条目。

验证：
- `node --check` 所有新增/修改文件。
- 相关 characterization 跑绿。
- `verify-all.sh` 全绿。

---

## 验收标准

1. 录制时检测到弹窗操作，能实时采集弹窗截图。
2. 弹窗截图保存到 `screenshot` 表，`metadata_json.dialog=true`，不新增字段。
3. V3 `payload.screenshots` 输出 `type:'dialog'`。
4. 弹窗控件 `pid` 与 dialog screenshot `key` 对应。
5. 有 dialog 截图时，弹窗控件 `rect` 相对 dialog 截图；没有时回退阶段长图。
6. 历史数据不回填，继续使用阶段长图。
7. `verify-all.sh` 全绿。

---

## 实施方式

主线程实现，按 Task 1 → Task 5 顺序推进。每个 Task 先写验证脚本/characterization，再实现，最后跑绿。
