# 画面推流优化调研（更流畅 + 执行机更低负载）

日期：2026-09-05 · 线：BiB 画面推流（30fps 调整后续）
资料源：CDP 官方协议文档（Page.startScreencast）、Chromium 源码 `content/browser/devtools/protocol/page_handler.cc`（screencast 实现）、Puppeteer issues（已知痛点）。

## 1. 现状（本仓事实）

两条推流链共用 `src/cdp/screencast-timing.js`：

| 链路 | 入口 | 参数 |
|------|------|------|
| 执行机 BiB | `executor/bib-bridge.js:227` startScreencast | jpeg q65、max≤1920×1080、everyNthFrame=1 |
| 控制面 remote-bridge | `src/cdp/remote-bridge/screencast.js:150` | 同上 |

- **节流位置错了**：`everyNthFrame=1`，Chrome 对**每一个合成帧**都抓取+JPEG 编码（60–144fps 源全收），Node 侧再用 `minForwardMs=33` 丢弃超频帧（`_onScreencastFrame` bib-bridge.js:479 / `onScreencastFrame` screencast.js:189）。**被丢的帧 Chrome 端已经花 CPU 编码过了**——这是执行机最大的无效负载。
- **立即 ack**（bib-bridge.js:472 / screencast.js:180）：in-flight 永不满 3，Chrome 全速产帧。
- **零观众照推**：执行机侧 `sendBinary` 无条件发控制面（订阅者数只在控制面侧可知）；控制面侧仅在收到 `remote:stop` 时停推（ws-router.js:315），后台标签页/无人观看时 30fps×1080p 仍在跑。
- 带宽量级：1080p q65 文本 UI 约 80–200KB/帧 × 30fps ≈ **3–6 MB/s** 出站（执行机→控制面→浏览器两级转发）。

## 2. Chromium 机制要点（page_handler.cc）

- 帧生产来自 **compositor FrameSink 视频消费者**——只有页面内容变化（damage）才产帧，静止页面几乎零成本；动画/spinner 页面按显示器刷新率全速产帧。
- 编码是 **CPU 线程池上的 Skia 编码器**（`optimize_for_speed=true`，JPEG 默认 q80），无 GPU 编码路径；成本 ∝ 分辨率 × 质量 × 帧数。
- `everyNthFrame` 是 Chrome 端**采样节流**：被跳过的帧不抓取不编码（`++frame_counter_ % n`）。
- `maxFramesInFlight=3` 流控：in-flight 满且 `sendLastFrame=false` 时**连抓取都跳过**（源码注释："a choice for performance over latency"）；ack 释放槽位后才继续产帧。`sendLastFrame=true` 是"性能换延迟"，默认 false。

## 3. 优化方案（按收益排序）

### A. ack 定速产帧（首选，不加延迟降 CPU 最多）
利用 in-flight 流控反向节流：**延迟 ack 到 minForwardMs 间隔**（距上次 ack <33ms 就不 ack），in-flight 满时 Chrome 自动跳过抓取+编码。效果：Chrome 端产帧率被精确钉在 ~30fps，无论显示器 60/144Hz；跳过的帧零成本。
- 配置：`maxFramesInFlight=3` 保持默认；`sendLastFrame=false` 保持（我们要性能不要额外内存）。
- 注意点：stall watchdog（2.5s 无帧重启）语义不变——ack 延迟最多 33ms，不影响 lastFrameAt 节奏；两个入口（bib-bridge / remote-bridge）同步改。
- 风险低：ack 是纯节流不丢消息，异常路径 catch 忽略即可。

### B. 零观众停推（次选，收益在空闲期）
控制面已把订阅者数做在 `bridge.subscribers`；把它**下推给执行机**（现有 JSON 控制消息带 viewer 计数），执行机在 0 观众时 `Page.stopScreencast`、有观众再 start（首帧 <100ms，加上控制面缓存最后一帧供秒开）。控制面侧当前已停推但只在 `remote:stop` 时触发——改为订阅归零即停。
- 收益场景：录制/回放执行中无人盯屏（常态）、后台标签页切换。

### C. 质量与分辨率下调（可配置，立竿见影）
- q65→q55：Element UI 文本界面肉眼几乎无差，JPEG 体积 −25~35%（等比降带宽与转发 CPU）。
- 若可接受，流上限 1920×1080→1600×900（viewport 900p 时本来就 ≤900p，仅 1080p 会话受益）：编码成本 ∝ 像素数，−25%。
- 均做成 env 可调（`BIB_STREAM_QUALITY` / `BIB_STREAM_MAX_W/H`），默认值用户拍板。

### D. 保持不变的
- `format: 'jpeg'`（PNG 无 GPU 路径，FastEncode 仍远大于 JPEG，文本 UI JPEG 是正解）。
- `sendLastFrame=false`。
- 控制面侧 minForwardMs 丢帧逻辑可保留为最后防线（A 生效后它不再频繁命中）。

## 4. 建议落地批

| 批 | 内容 | 改动面 |
|----|------|--------|
| 第一批 | A（ack 定速）+ C（quality/maxWH env 化） | `screencast-timing.js`、bib-bridge.js、remote-bridge/screencast.js、characterize-screencast-timing.mjs |
| 第二批 | B（观众计数下推 + 零观众停推 + 控制面末帧缓存） | ws-router.js、session-manager.js/ws-client.js、remote-bridge |
