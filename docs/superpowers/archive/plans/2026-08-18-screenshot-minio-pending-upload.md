# 截图 MinIO 上传失败本地暂存 · 实施计划

日期：2026-08-18 · 前置：spec `docs/superpowers/specs/2026-08-18-screenshot-minio-pending-upload-design.md`

## 目标

在现有“截图上传 MinIO”链路上增加本地暂存兜底：

- 上传失败时，先把 PNG 写入本地 `tmp/pending-screenshots/`。
- DB 使用 `storage_type='local'` 表示图片仍在本地。
- 后台每 3 分钟扫描一次，最多重试 3 次。
- 补传成功后删除本地文件并更新为 `storage_type='minio'`。
- 提供 `GET /api/v2/screenshots/pending` 待补传列表。

## 现状基础

已完成的基础能力（本轮之前）：

- `minio` SDK 已安装。
- `screenshot` 表已有 `storage_type` / `storage_path` / `image_url`，并移除 `image_data`。
- 截图上传、读取、删除已接入 MinIO。
- 删除步骤/阶段/轨迹时会同步清理 MinIO 对象。

本轮只增加“本地暂存 + 自动补传 + 待补传列表”，不改变上述已有能力。

---

## 任务拆分（TDD：先 characterization / 验证，后实现）

### Task 1: 数据库迁移增加重试字段

- 新增迁移，例如 `migrations/20260819000001_screenshot_pending_upload.js`：
  ```sql
  ALTER TABLE screenshot
    ADD COLUMN retry_count INT NOT NULL DEFAULT 0,
    ADD COLUMN last_retry_at DATETIME(3) NULL;
  ```
- 同步更新 `schemas/init.sql`。
- 验证：
  - `node --check` 迁移文件。
  - 静态断言 migration 包含 `retry_count` / `last_retry_at`。
  - `schemas/init.sql` 包含新字段。

### Task 2: 本地暂存目录与文件服务

- 新增 `src/services/screenshot-pending-store.js`（或并入 `screenshot-service.js`）：
  - `getPendingDir()`：读取 `SCREENSHOT_PENDING_DIR`，默认 `{PROJECT_DIR}/tmp/pending-screenshots`。
  - `writePendingFile(screenshotId, buffer)`：写入 `{id}.png`，确保目录存在。
  - `readPendingFile(screenshotId)`：读取本地 PNG Buffer。
  - `deletePendingFile(screenshotId)`：删除本地文件。
  - `listPendingFiles()`：列出目录中的文件，用于清理。
- 验证：
  - 单元/characterization：写入 → 读取 → 删除。
  - 目录不存在时自动创建。
  - 删除不存在文件不报错。

### Task 3: 修改上传流程（先本地落盘，再传 MinIO）

- 修改 `replaceStepScreenshot` / `replacePhaseHighlightScreenshot`：
  1. 先删除旧 MinIO 对象（保持既有约束）。
  2. 将新图写入本地暂存文件。
  3. 尝试上传 MinIO。
  4. 成功：
     - 更新 DB `storage_type='minio'`，`storage_path` / `image_url`。
     - `retry_count=0`，`last_retry_at=null`。
     - 删除本地暂存文件。
  5. 失败：
     - 更新 DB `storage_type='local'`，`storage_path=null`，`image_url=/api/v2/screenshots/{id}/image`。
     - `retry_count=0`，`last_retry_at=null`。
     - 保留本地文件，不阻断调用方。
- 需要 DAO 支持：
  - `replaceForStep` / `replaceForPhase` 接收并写入 `retryCount` / `lastRetryAt`。
  - 或新增 `markLocal(screenshotId)` / `markUploaded(screenshotId, storagePath, imageUrl)` 方法。
- 验证：
  - 模拟 MinIO 上传失败时，DB 变为 `local`，本地文件存在。
  - 模拟上传成功时，DB 变为 `minio`，本地文件被删除。

### Task 4: 图片读取支持本地文件

- 修改 `getScreenshotImage(id)`：
  - `storage_type='minio'`：从 MinIO 读取。
  - `storage_type='local'`：从本地暂存文件读取。
- 修改列表/树 URL 生成：
  - `storage_type='local'` 时 `imageUrl` 返回 `/api/v2/screenshots/{id}/image`。
  - `storage_type='minio'` 时返回 MinIO 预签名 URL。
- 验证：
  - 本地模式下 `GET /api/v2/screenshots/:id/image` 能返回图片。
  - 列表接口 `imageUrl` 正确区分 local / minio。

### Task 5: 后台重试任务

- 新增 `src/services/screenshot-pending-retry.js`：
  - 启动时扫描一次。
  - 定时任务每 `SCREENSHOT_RETRY_INTERVAL_MS`（默认 180000）扫描。
  - 查询条件：
    ```sql
    WHERE storage_type = 'local'
      AND retry_count < 3
      AND (last_retry_at IS NULL OR last_retry_at <= NOW() - INTERVAL 3 MINUTE)
    ```
  - 对每条：
    - 读取本地文件；不存在则 `retry_count + 1`，记录 warn。
    - 尝试上传 MinIO。
    - 成功：更新 DB 为 `minio`，清空重试字段，删除本地文件。
    - 失败：`retry_count + 1`，`last_retry_at = now`。
    - 达到 3 次后停止自动重试，保留在待补传列表。
- 在 `server.mjs` 或独立模块中启动。
- 验证：
  - 构造 local 记录，触发扫描后成功转为 minio。
  - 模拟连续失败 3 次后不再自动重试。

### Task 6: 待补传截图列表 API

- 新增 `GET /api/v2/screenshots/pending`：
  - 返回 `storage_type='local'` 的截图列表。
  - 字段建议：`id`、`trajectoryId`、`trajectoryStepId`、`trajectoryPhaseId`、`kind`、`fileSize`、`mimeType`、`retryCount`、`lastRetryAt`、`imageUrl`。
- 在 `src/routes/v2/screenshot.js` 注册。
- 在 `src/dashboard/api-docs/groups/remote.js` 登记该端点。
- 验证：
  - API 能返回 pending 列表。
  - 空列表返回 `[]`。
  - API docs 包含该端点。

### Task 7: 删除逻辑适配本地文件

- 修改删除相关逻辑：
  - `deleteScreenshot(id)`：
    - `storage_type='minio'`：删除 MinIO 对象。
    - `storage_type='local'`：删除本地文件。
    - 然后删除 DB 行。
  - `deleteScreenshotsByStepIds` / `deleteScreenshotsByPhaseIds` / `deleteScreenshotsByTrajectory`：
    - 同时清理 MinIO 对象或本地文件。
- 验证：
  - 删除 local 截图时本地文件被删除。
  - 删除轨迹时关联的本地文件也被清理。

### Task 8: 清理与启动扫描

- 服务启动时扫描 `tmp/pending-screenshots/`：
  - 删除不属于任何 `storage_type='local'` 记录的孤儿文件。
  - 删除超过 `SCREENSHOT_PENDING_TTL_MS`（默认 7 天）且 `retry_count >= 3` 的本地文件。
- 目录权限：确保 `tmp/pending-screenshots` 权限为 `700`。
- 验证：
  - 构造孤儿文件，启动扫描后被清理。
  - 过期文件被清理。

### Task 9: 配置、CHANGELOG、验证收尾

- `config/config.js` 新增：
  - `SCREENSHOT_PENDING_DIR`
  - `SCREENSHOT_RETRY_INTERVAL_MS`
  - `SCREENSHOT_MAX_RETRY`
  - `SCREENSHOT_PENDING_TTL_MS`
- `config/.env.example` 增加示例配置。
- `CHANGELOG.md` `[Unreleased]` 增加条目。
- 运行：
  - `node --check` 所有新增/修改文件。
  - 相关 characterization 全绿。
  - 手动验证：模拟 MinIO 不可用 → 本地暂存 → 恢复 MinIO → 自动补传。

---

## 验收标准

1. MinIO 不可用时，截图不丢失，DB 标记 `storage_type='local'`。
2. MinIO 恢复后，后台 3 分钟内自动补传，成功后本地文件删除。
3. 同一截图最多自动重试 3 次，超过后进入“待补传截图”列表。
4. `GET /api/v2/screenshots/pending` 能列出待补传截图。
5. 本地暂存图片可通过 `/api/v2/screenshots/:id/image` 正常访问。
6. 删除截图/步骤/阶段/轨迹时，本地暂存文件同步清理。
7. 启动扫描能清理孤儿文件。
8. `verify-all.sh` 或相关 characterization 全绿。

---

## 实施方式

主线程实现，按 Task 1 → Task 9 顺序推进。每个 Task 先写验证脚本/characterization，再实现，最后跑绿。
涉及文件：

- `migrations/*`、`schemas/init.sql`
- `src/dao/screenshot-dao.js`
- `src/services/screenshot-service.js`
- 新增 `src/services/screenshot-pending-store.js`
- 新增 `src/services/screenshot-pending-retry.js`
- `src/routes/v2/screenshot.js`
- `src/dashboard/api-docs/groups/remote.js`
- `src/server.mjs`（启动重试任务）
- `config/config.js`、`config/.env.example`
- `CHANGELOG.md`
