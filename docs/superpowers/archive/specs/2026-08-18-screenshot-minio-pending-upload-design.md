# 截图 MinIO 上传失败本地暂存设计（Spec）

> 状态：待评审  
> 日期：2026-08-18  
> 范围：Node 控制面截图上传链路

---

## 1. 背景与问题

当前截图上传 MinIO 的流程是：

```
收到 step_screenshot(base64)
      ↓
解码 Buffer
      ↓
删除旧 MinIO 对象
      ↓
上传新对象到 MinIO
      ↓
写 screenshot 表（storage_type=minio, storage_path, image_url）
```

如果 MinIO 暂时不可用或网络抖动，上传会失败，当前实现会直接丢弃这张截图。  
对于录制中的步骤截图/阶段长图来说，这是不可接受的：**截图丢了就补不回来**。

因此提出：**上传失败时，先把 base64/PNG 暂存在本地磁盘，等 MinIO 恢复后再自动补传**。

---

## 2. 目标

- MinIO 暂时不可用时，截图不丢失。
- 数据库仍然不存 base64 / 图片二进制。
- 上传成功后自动清理本地暂存文件。
- 服务重启后，未上传成功的截图仍可继续补传。
- 不改变“替换截图前先删除旧 MinIO 对象”的既有约束。

---

## 3. 非目标

- 不做多机房 / 分布式文件存储。
- 不做 MinIO 数据双写。
- 不处理本地磁盘也写失败的情况（此时只能记录错误日志并告警）。
- 不改变前端 API 的既有字段语义。

---

## 4. 总体设计

采用 **本地暂存目录 + 待上传标记 + 后台重试任务** 的 Outbox 模式。

```
收到截图 base64
      ↓
写入本地暂存文件 tmp/pending-screenshots/{id}.png
      ↓
尝试上传 MinIO
      ↓
成功 → 删除本地文件 + 更新 DB storage_type=minio
失败 → 保留本地文件 + 更新 DB storage_type=local
      ↓
后台重试任务定期扫描 storage_type='local' 记录
      ↓
补传成功 → 删除本地文件 + 更新 DB storage_type=minio
```

---

## 5. 数据模型

### 5.1 screenshot 表扩展

**不引入 `storage_status` 字段**，直接使用：

- `storage_type = 'minio'`：图片已上传 MinIO
- `storage_type = 'local'`：图片仍暂存在本地，等待补传

为了支持“3 分钟重试、最多 3 次”，额外增加：

```sql
ALTER TABLE screenshot
  ADD COLUMN retry_count INT NOT NULL DEFAULT 0
    COMMENT '本地暂存后的补传重试次数',
  ADD COLUMN last_retry_at DATETIME(3) NULL
    COMMENT '最后一次补传尝试时间';
```

字段取值：

| storage_type | retry_count | 含义 |
|---|---|---|
| `minio` | 0 | 正常，图片已在 MinIO |
| `local` | 0 | 图片暂存在本地，尚未补传 |
| `local` | 1~3 | 已补传失败 N 次，等待下一次重试 |
| `local` | 3 | 已超过最大重试次数，停止自动补传，进入“待补传截图”列表 |

### 5.2 本地暂存文件

目录：

```
tmp/pending-screenshots/
  {screenshotId}.png
```

文件命名建议直接使用 `screenshot.id`，方便重试时定位。

---

## 6. 上传流程设计

### 6.1 正常上传（MinIO 可用）

1. 收到 `step_screenshot` base64。
2. 先删除旧 MinIO 对象（如果存在）。
3. 将新图片写入本地暂存文件（先落盘，作为兜底）。
4. 调用 MinIO 上传。
5. 上传成功：
   - 更新 DB：
     - `storage_type = 'minio'`
     - `storage_path = <objectKey>`
     - `image_url = <presignedUrl>`
   - 删除本地暂存文件。
6. 返回成功。

### 6.2 上传失败（MinIO 不可用）

1. 图片已写入本地暂存文件。
2. 更新 DB：
   - `storage_type = 'local'`
   - `storage_path = null` 或本地相对路径
   - `image_url = /api/v2/screenshots/{id}/image`
   - `retry_count = 0`
   - `last_retry_at = null`
3. 不删除本地文件。
4. 返回给调用方“已暂存，稍后自动补传”，不阻断录制主流程。

### 6.3 替换截图时的顺序

保持用户要求：

```
1. 删除旧 MinIO 对象
2. 新图写入本地暂存
3. 上传新图到 MinIO
4. 更新 DB 指向新对象
5. 删除本地暂存
```

如果第 3 步失败，则 DB 仍指向旧的 MinIO 对象（旧对象已删），此时会短暂处于“本地有图但 DB 指向已删除旧对象”的状态。  
因此建议：

- 失败后 DB 立即改为 `storage_type='local'`，`image_url` 指向本服务代理地址。
- 后台补传成功后，再改为 `minio`。

---

## 7. 读取/访问设计

### 7.1 当 `storage_type = 'minio'`

- `GET /api/v2/screenshots/:id/image`
  - 从 MinIO 读取并返回二进制。
- 列表/树接口
  - 返回 MinIO 预签名 URL。

### 7.2 当 `storage_type = 'local'`

- `GET /api/v2/screenshots/:id/image`
  - 从本地暂存文件读取并返回二进制。
- 列表/树接口
  - `imageUrl` 返回 `/api/v2/screenshots/{id}/image`，由后端从本地读取。

这样前端无感知，不需要知道图片到底在 MinIO 还是本地。

---

## 8. 后台重试任务

### 8.1 触发方式

- 启动时扫描一次。
- 定时扫描，固定间隔 **3 分钟**。
- 也可以在上传新截图前顺带扫描。

### 8.2 重试逻辑

```
扫描 screenshot 表
  WHERE storage_type = 'local'
    AND retry_count < 3
    AND (last_retry_at IS NULL OR last_retry_at <= now - 3分钟)

对每条：
  1. 检查本地文件是否存在
     - 不存在 → 记录 warn，retry_count 直接 +1，等待最终失败
  2. 尝试上传 MinIO
  3. 成功 → 更新 DB：
       storage_type='minio'
       storage_path=<objectKey>
       image_url=<presignedUrl>
       retry_count=0
       last_retry_at=null
     删除本地文件
  4. 失败 → retry_count + 1，last_retry_at=now
     - retry_count >= 3 → 停止自动补传，保留在“待补传截图”列表
```

### 8.3 重试次数与冷却

- 固定 **每 3 分钟** 重试一次。
- 最多重试 **3 次**。
- 超过 3 次后不再自动重试，但数据仍保留在本地，可通过“待补传截图”列表人工介入。

---

## 9. 清理机制

- 上传成功：立即删除本地文件。
- 服务启动：扫描 `tmp/pending-screenshots/`，清理：
  - 不属于任何 `storage_type='local'` 记录的文件。
  - 超过 7 天且 `retry_count >= 3` 的本地文件。
- 目录权限：`chmod 700 tmp/pending-screenshots`。

---

## 10. 删除逻辑适配

删除截图/步骤/阶段/轨迹时：

- 如果图片在 MinIO：删除 MinIO 对象。
- 如果图片在本地暂存：删除本地文件。
- 然后删除 DB 行。

---

## 11. 配置项

新增配置：

```env
# 本地暂存目录，默认 {PROJECT_DIR}/tmp/pending-screenshots
SCREENSHOT_PENDING_DIR=

# 重试扫描间隔（毫秒），默认 180000（3 分钟）
SCREENSHOT_RETRY_INTERVAL_MS=180000

# 最大重试次数，默认 3
SCREENSHOT_MAX_RETRY=3

# 本地暂存文件保留时间（毫秒），默认 7 天
SCREENSHOT_PENDING_TTL_MS=604800000
```

---

## 12. 接口/行为变化

| 场景 | 变化 |
|---|---|
| 上传成功 | 无外部感知 |
| 上传失败 | 不再直接丢图，先本地暂存，后台补传 |
| 截图列表 | `storageType` 可能返回 `local`，`imageUrl` 为本服务代理地址 |
| 待补传截图列表 | 新增 `GET /api/v2/screenshots/pending`，返回 `storage_type='local'` 的截图 |
| 图片读取 | 后端自动判断从 MinIO 或本地读取 |
| 删除 | 同时清理 MinIO 或本地文件 |

---

## 13. 边界情况

1. **本地磁盘也满了/写入失败**
   - 记录 error 日志，标记该截图上传失败且未暂存，只能告警。
2. **服务在“已写本地文件、尚未更新 DB”时崩溃**
   - 启动扫描时发现孤儿文件，但 DB 没有对应记录。
   - 处理：如果文件存在但 DB 无 `storage_type='local'` 记录，则按孤儿文件清理或尝试反查 step 重建记录。
3. **旧 MinIO 对象已删，新图上传失败**
   - DB 改为 `storage_type='local'`，图片从本地可读，不会丢。
4. **补传成功但删除本地文件失败**
   - 记录 warn，本地文件由后续清理任务删除。
5. **同一 step 反复产生新截图**
   - 每次替换都先删除旧本地文件 / 旧 MinIO 对象，避免多个本地暂存文件残留。

---

## 14. 实施拆分建议

### Phase 1：基础暂存
- 新增 `SCREENSHOT_PENDING_DIR` 配置。
- 上传前先写本地文件。
- 上传失败时写 DB `storage_type='local'`，并维护 `retry_count` / `last_retry_at`。
- 图片读取接口支持从本地读取。

### Phase 2：后台重试
- 新增重试扫描任务。
- 补传成功更新 DB + 删除本地文件。
- 失败达到阈值（3 次）后停止自动重试，保留在“待补传截图”列表。

### Phase 3：清理与运维
- 启动扫描孤儿文件。
- 过期文件清理。
- 增加日志与告警。

---

## 15. 已确认决策

1. **不引入 `storage_status`**，使用 `storage_type='local'` 表示图片仍在本地。
2. **不需要加密**，本地暂存的是测试数据。
3. **重试策略**：每 3 分钟重试一次，最多 3 次。
4. **待补传列表**：通过 API `GET /api/v2/screenshots/pending` 提供。

---

## 16. 结论

这个设计可以保证：

- MinIO 短暂不可用时截图不丢失。
- 数据库不存 base64。
- 前端无需感知图片在 MinIO 还是本地。
- 提供“待补传截图”列表便于人工介入。
- 替换截图时仍然“先删旧、再传新”。
