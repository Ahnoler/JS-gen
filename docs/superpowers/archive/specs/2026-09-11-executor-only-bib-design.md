# Design: Executor-only BiB / session（取消控制面本机兜底）

**Date:** 2026-09-11  
**Status:** approved (Lead: 先 1+2，然后 3)

## Problem

控制面保留 `USE_EXECUTOR=false` 本机 BiB / `ensureGlobalBrowser` 旁路，造成：

- `resolve-element` 等 CDP 能力看似「控制面也有一套扫描」；
- 开发与产品双路径，同仓却要维护两套挂载语义。

同仓开发应直接起执行机（`npm run executor`），不需要本机兜底。

## Doctrine

1. **浏览器 CDP / BiB / prepare·record·attach 一律走在线执行机。**
2. **`src/cdp/*` 定位库仍保留**——由执行机 `bib-bridge` import（同仓共享源，不是控制面再连 Chrome）。
3. **`USE_EXECUTOR=false` 不再是支持模式**：相关 API 返回 **503**，文案明确要求起执行机。

## Scope

### Phase 1+2（本刀）

- `config.js`：`USE_EXECUTOR` 默认改为 `true`（与 `.env.example` 对齐）。
- `resolveTrajectoryElement`：删除 `remoteBridge.resolveElementByLabelText` 本地分支；`!USE_EXECUTOR` → 503。
- README / `.env.example` / api-docs：写明「必须执行机；false 不支持」。
- 冷测：pin resolve 在 `!USE_EXECUTOR` 时抛 503、不再引用本地 bridge 分支。

### Phase 3（紧随）

- `attach` / `prepare` / `attachLive` / 本机会话入口：`!USE_EXECUTOR` → 503（不再走 `ensureGlobalBrowser` / 本地 `remote-bridge.attachLive`）。
- broadcasts / status 字段可保留 `useExecutor` 标志，但本机 CDP 路径视为不可达。
- **不在本刀物理删除** `global-browser.js` / remote-bridge 全部实现（避免一次大爆炸）；标记为 dead path + 503 门闩。后续清理另开。

## Out of scope

- 修复「搜索关键字」placeholder inventory（独立 bug，另刀）。
- 删除 Python `scan_*`（Agent 录制线，职责不同）。
- 物理删除 `src/cdp/remote-bridge` 整树。

## Risks

- 本地仅起控制面、不起执行机的旧习惯会 503——符合预期。
- characterization 若假设 false 路径，需改 pin。
