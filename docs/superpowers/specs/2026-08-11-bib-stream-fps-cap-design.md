# BiB 画面推流限帧（保分辨率）设计

**日期：** 2026-08-11  
**状态：** Implemented 2026-08-11 — plan docs/superpowers/plans/2026-08-11-bib-stream-fps-cap.md  
**范围：** 执行机 `BibBridge` + 控制面 `remote-bridge` screencast 转发节奏与背压；不改点击坐标协议。

## 1. 背景与问题

产品 BiB 画布推流路径为：

```
Chrome Page.startScreencast (JPEG)
  → 立刻 Page.screencastFrameAck
  → 打包 RSCF → 执行机 WS → 控制面 /ws → 前端画布
```

默认编码跟 session 视口走（常见 **1600×900**）、`quality≈65`、`everyNthFrame=1`、转发间隔 `MIN_FORWARD_MS=33`（约 **30fps**）。

在阿里云同机部署（执行机 + 控制面）、本机经公网看画布时，**空闲挂看**即出现「帧率低 + 画面落后」。现场排查（`47.101.58.49`，`/data/app/JS-gen`）要点：

| 观察 | 含义 |
|------|------|
| 8 核 / 29G，`CHROME_HEADLESS=true` | 不是机器太弱，也不是「忘记关有头」 |
| Chrome 合计 CPU ≈ **133%**（gpu≈60% 含 `--use-angle=swiftshader-webgl`） | 无头仍合成 + JPEG 编码；SwiftShader 为无头常见软渲染，非业务显式必填 |
| eth0 出网采样 ≈ **6.5 Mbps** | 全帧 JPEG 公网推流偏重，易导致丢帧与缓冲落后 |
| `Xvfb :99` 在跑但当前 Session Chrome 为 ozone headless | 无头**不需要** Xvfb（可运维关闭）；关 Xvfb 不消除 SwiftShader，也治不好公网带宽 |

Chrome 官方推流接口即 `Page.startScreencast`；无更轻的「一键视频流」CDP API。WebRTC 为后续大改，本轮不做。

## 2. 目标与非目标

### 目标

- **分辨率不变**：`maxWidth` / `maxHeight` 仍跟当前 viewport（默认 1600×900；上限仍 `STREAM_MAX_*`），不降清晰度档位的分辨率。
- **可降帧率**：目标约 **10–12fps**（优先流畅、减少落后）。
- **quality 不变**（约 65），本轮不以降 JPEG 质量换带宽。
- 点击坐标仍按 viewport CSS 像素归一化，行为不变。
- 执行机路径与本地 `remote-bridge` 旁路使用**同一套限帧语义**。

### 非目标

- 不降 `maxWidth` / `maxHeight`。
- 不引入 WebRTC / H264。
- 不强制改 SwiftShader / 有头+Xvfb（可选运维：无头时可关遗留 Xvfb）。
- 不改 RSCF 包头格式、不改 `remote:input` 协议。

### 成功标准

- 空闲挂看：主观更顺，落后感明显下降。
- 同场景出网相对基线（约 6.5 Mbps）大致降到约 **1/2～1/3**（同分辨率、约 1/3 帧率的量级预期）。
- Chrome CPU 有下降即可（SwiftShader 仍在，不会归零）。
- 画布点击仍准确。

## 3. 方案选择

| 方案 | 内容 | 结论 |
|------|------|------|
| A. 限帧 + 丢旧保新 | 保分辨率/quality；抬高 `MIN_FORWARD_MS`；提高 `everyNthFrame`；背压丢帧 | **本轮采用** |
| B. A + 按 session 订阅 | 减少无差别 `broadcastBinary` | 单路公网收益次要；可不阻塞 A，有余力再做 |
| C. WebRTC | 同分辨率更省带宽 | 工期大，本轮不做 |

## 4. 设计细节

### 4.1 参数

| 参数 | 现在 | 目标默认 |
|------|------|----------|
| 编码分辨率 | 跟 viewport | **不变** |
| `quality` | ≈65 | **不变** |
| `MIN_FORWARD_MS` | 33（~30fps） | **90**（~11fps） |
| `everyNthFrame` | 1 | **2**（若仍偏密可调到 3） |
| 背压 | 缓冲过大跳过 | **明确丢旧保新** |

建议命名常量（两处对齐）：

- `TARGET_FPS = 11`（文档/注释用）
- `MIN_FORWARD_MS = 90`
- `EVERY_NTH_FRAME = 2`

可选环境变量（便于服务器试参，无 UI）：

- `BIB_STREAM_MIN_FORWARD_MS`（默认 90）
- `BIB_STREAM_EVERY_NTH_FRAME`（默认 2）

解析失败或越界时回退默认；建议合理夹紧（例如 forward ms ∈ [50, 500]，everyNth ∈ [1, 5]）。

### 4.2 数据流行为

1. 收到 `Page.screencastFrame` → **立刻** `screencastFrameAck`（限帧不得推迟 Ack）。
2. 若 `now - lastForwardAt < MIN_FORWARD_MS` → **不转发**（丢帧）。
3. 执行机 `sendBinary`：`bufferedAmount` 超限 → **不发送**。
4. 控制面 fan-out：慢客户端跳过，不拖住整路。
5. stall watchdog 仍按「CDP 无回调」计时；**不得**因「少转发」误判为 stall 而频繁 `restartScreencast`。

### 4.3 代码落点

| 文件 | 变更 |
|------|------|
| `executor/bib-bridge.js` | 产品主路径：常量/`everyNthFrame`/`MIN_FORWARD_MS`、env 覆盖、转发节流 |
| `src/cdp/remote-bridge/state.js` | 共享常量默认值与（若适用）env 读取 |
| `src/cdp/remote-bridge/screencast.js` | `startScreencast` 传入 `everyNthFrame`；转发间隔与执行机一致 |
| `src/dashboard/api-docs/groups/websocket.js` | 文档：约 30fps → 约 10–12fps；分辨率仍跟视口 |

`Page.startScreencast` 调用处必须带上更新后的 `everyNthFrame`；仅改 `MIN_FORWARD_MS` 而不改 CDP 出帧，仍会浪费 Chrome 编码 CPU。

### 4.4 容错

- attach / restart / tab switch 后沿用同一套限帧参数。
- 背压丢帧不抛错、不触发重连风暴。
- 现有 stall restart / click nudge 逻辑保留，仅确认与「少转发」不冲突。

## 5. 测试与验收

- **表征/单测（轻量）**：断言 `startScreencast` 使用预期 `everyNthFrame`；或对转发节流（间隔内第二帧不转发）做单元级验证。
- **服务器手测**：空闲挂看 1–2 分钟；对比改前出网与主观延迟；点画布确认坐标。
- **文档**：`/api/docs` WS 说明与实现一致。

## 6. 运维附注（非本变更必做）

- 无头模式下 **可以关闭 Xvfb**（Chrome 官方：Headless 不需要 display server）。本仓库 `start-all.sh` 在 `CHROME_HEADLESS=true` 时已不启 Xvfb；服务器上遗留的 `Xvfb :99` 可安全杀掉，对推流卡顿帮助很小。
- `--use-angle=swiftshader-webgl` 非业务代码写入，多为无头无 GPU 时 Chromium/Playwright 自动路径；本轮不强制去除。

## 7. 实现顺序建议

1. 统一常量 + env 覆盖（executor + remote-bridge）。
2. `startScreencast` 应用 `everyNthFrame`；转发用 `MIN_FORWARD_MS=90`。
3. 核对 stall watchdog 与背压行为。
4. 更新 api-docs；跑轻量表征；服务器手测对比基线。
