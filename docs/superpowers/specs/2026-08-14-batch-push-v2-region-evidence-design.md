# Design: 批量推送 V2.0 — step 层级作证 + 阶段截图元数据

**Date:** 2026-08-14  
**Status:** Approved (brainstorming 全五节通过，待写实现计划)  
**Trigger:** 产品需求三条：①批量推送 step 附 id + parent id 作层级关系作证；②推送 V2.0 前先完善分区分层算法；③阶段截图 V2.0 去掉烘焙高亮，改记截图长宽 + 所有元素坐标，前端按需动态高亮。  
**Related:** [PR-PART compose](2026-08-13-partition-tab-wizard-titlebox-design.md); [PR-LAYER layers](2026-08-14-pr-layer-region-layers-design.md)（其「整页大树 TODO」即本设计需求②）; [transaction export V2](2026-08-10-transaction-export-v2-design.md); [PR-LOC 阶段长图](2026-08-13-phase-highlight-long-screenshot-design.md); [todo-list](../todo-list.md)

## 需求溯源

| # | 产品需求 | 设计落点 |
|---|----------|----------|
| 1 | 批量推送 step 附 id + parent id 作层级关系作证 | §推送 payload：每步 `regionId`/`parentRegionId`（轻量字段，无状态推导） |
| 2 | 先完善分区分层算法（= PR-LAYER 整页大树 TODO） | §分区分层：`assembleRegionTree` + 扫描/阶段两处挂载 |
| 3 | 阶段截图 V2.0：移除烘焙高亮；记截图长宽 + 所有元素坐标，前端动态高亮 | §阶段截图：干净捕获 + `metadata_json`（长宽/元素 rect/树） |

## Goals

1. `assembleRegionTree(items, { pageLabel })` 产出 `region_tree`（森林），节点 id 复用 `region_id` 段（`role:label`），parentId 为上一层段；扫描/resolve 列表挂当前页树，phase_done 生成阶段树落库。
2. 推送 envelope 每步附 `regionId` + `parentRegionId`；每交易附 `phases[]`（阶段截图引用 + 元数据）。旧字段拼写一律不动。
3. 阶段截图改为干净图（删 mark/unmark），元数据（宽高 + 全部可见 L2 控件左上/右下坐标 + region 信息 + 阶段树）存 `screenshot.metadata_json`，前端拉图后按坐标动态高亮。
4. 消费方为产品前端（现有导出链路），图片经现有截图 API 另拉（不内嵌 base64）。

## Non-goals

- 不改 envelope 旧字段语义与拼写（`transcation*`/`mothed`/`elementType` 等）；不新增 partner 推送目标（外部对接方消费不在本设计）。
- 不改 `region_id` / `layers[]` 现有形状；不回填旧数据。
- Vue 画树、前端动态高亮实现（另仓，本仓只给契约）。
- 步骤级高亮截图 PR-LOC-HL（仍挂起，与本设计无关）。
- 部分导出（stepIds/phaseIds）——原 TODO 不变。

## 方案选择

**方案 A：替换式 V2.0（已选）**——直接把 `phase_highlight` 捕获升级为干净截图 + 元数据；旧图保留不回填。否决双轨并行（新 kind 两套管线，性能翻倍、留死代码）。

## 1. 分区分层完善：`assembleRegionTree`

### 输入/输出

输入：带 `layers[]` 的控件列表（phase_done 扫描结果或扫描接口控件列表）+ 可选 `pageLabel`。
输出：`regionTree`（森林）。

```js
// 区域节点
{
  id: 'tab:客户基本信息',          // = region_id 段（role:label）
  parentId: 'section:对公客户概况' | null,
  role: 'tab', label: '客户基本信息',
  children: [ /* 区域节点 */ ],
  controls: [ { elementIndex: 3 } ] // 叶：引用 elements[] 下标，不重复存数据
}
// 控件不单独造 id：elements[index] 自带 rect/layers/regionId/parentRegionId
```

### 组装算法（前缀 trie 合并）

1. 逐控件取 `layers[]`；空 layers 的控件进合成节点 `{ id:'other', role:'other', label:'其他' }`（对齐 `assignRegion` 的 other 兜底）。
2. 段 id = `role:label`；`page` 段只当根（内层 page 丢弃）；有 `pageLabel` 时作根页，控件无自身 page 段时挂其下；不同 page label = 不同根。
3. 其余层按段前缀逐层合并：**同一前缀同一节点**（PR-LAYER 锁定规则）。节点身份以 label 为键——同 label 的不同分支会合并成同一节点，为框架固有语义，作已知限制记录。
4. 叶：`controls: [{ elementIndex }]`。

### 挂载点（两处共用同一函数）

- **扫描/resolve 列表**：inventory 扫描（`resolve-by-label` `mode=inventory` 响应）与全页可见控件扫描的列表响应加 `regionTree`（PR-LAYER TODO 补上；每项已带 `layers`）。
- **phase_done**：全量扫描结果 + `assembleRegionTree` → 阶段树与截图元数据同写 `screenshot.metadata_json`（§3 形状），不另建表。

### 遵守 PR-LAYER 已锁规则

page 不套 page（page 只在根，内层丢弃）；其余 role 可互相嵌套（组装器允许 `tab→overlay`，生产路径仍受 assignRegion 短路限制）；`display_group` 不变。

## 2. 推送 payload V2.0

### 每步（`transcationProperties[]` 项）新增字段

| 字段 | 规则 |
|------|------|
| `regionId` | 最内层段 id（如 `titlebox:基本信息`）；无数据空串，**不丢步** |
| `parentRegionId` | 上一层段 id（如 `section:对公客户概况`）；已是根则空串 |

**推导链（无状态，导出时即时算）**：`element.layers` → 回退 `region_id` 按 `|` 拆分 → 回退 `display_group`/`region_label` 按 ` / ` 拆分（无 role 前缀，id 用 label 本身）→ 空串。

### 每交易（`transcationEventTypeList[]` 项）新增 `phases[]`

```js
phases: [{
  phaseId, phaseNumber,
  screenshotId,            // screenshot 表 id（引用）；无截图 null
  stitchScreenshotUrl,     // 沿用现有下载 URL，前端另拉 PNG
  metadata: {              // 读 screenshot.metadata_json；旧截图 null
    imageWidth, imageHeight,
    truncated: false,
    elements: [{ index, kind, label, layers, regionId, parentRegionId,
                 rect: { x1, y1, x2, y2 }, outsideRoot }],   // 拼接图坐标
    regionTree: { pageLabel, roots: [...] }                  // 组装失败时 null
  }
}]
```

### 其余约定

- envelope 旧字段**一律不动**；新字段 camelCase；`schemaVersion` 1 → **2**。
- 无截图/无 metadata 的阶段照常出 `phases[]` 项（`screenshotId:null, metadata:null`），前端跳过。
- `/api/v2/export/transaction/schema` 与 `src/dashboard/api-docs/catalog.js`（前端唯一契约）同步新字段。
- 单轨导出（`GET|POST /api/v2/export/trajectories/:id/transaction`）与批量共用 `buildTransactionPayload`，形状一致。

## 3. 阶段截图 V2.0（干净图 + 元数据）

### 捕获管线改动

落点：`src/cdp/phase-highlight-capture.js` / `phase-highlight-page.js` → 改名 `phase-screenshot-capture.js` / `phase-screenshot-page.js`。

1. **删除**：`buildPhaseHighlightMarkExpression` / `buildPhaseHighlightUnmarkExpression` 及调用（不再注入 `data-jsgen-phase-hl` 蒙层样式）。
2. **保留**：`pickScrollRoot`（`.el-main/.app-main` 可滚者优先，否则 `document.scrollingElement`）、`OVERLAP=48`、`MAX_SLICES=30`、`stitchPngSlices` 拼接。
3. **新增**：逐片 rect 收集——每次滚到 `top_i` 后 evaluate 收集表达式：取该片**可见** L2 控件（复用 `collectL2Hosts` 选择器与 `classifyOperable`/`inventoryTextOf` 判定），输出 `{rect:{left,top,right,bottom}, kind, text, layers, region_id, region_label}`；已收元素打标记跨片去重（只记第一次）。

### 坐标空间契约（定死）

- 拼接图 = 主滚动区内容；`imageWidth` = 片宽（视口宽），`imageHeight` = stitch 后 PNG 的 IHDR 实际高度。
- 元素坐标 = **内容坐标**：`x1=rect.left`、`y1=rect.top + top_i`、`x2=rect.right`、`y2=rect.bottom + top_i`（`top_i` 为该片 scrollTop）。
- 不在主滚动容器内的元素（固定头/侧栏/弹层）：记首次出现片位置并标 `outsideRoot:true`；stitch 图里它们会重复出现——**已知限制**，前端自行决定怎么画。
- 超过 30 片截断：`metadata.truncated:true`。

### 存储

- 迁移：`screenshot` 表加 `metadata_json JSON NULL`。
- `screenshot-dao.replaceForPhase` 写入 image_data 的同时写 `metadata_json`（UPSERT）。
- `kind` **沿用 `phase_highlight`**（不迁移 enum；语义改为「阶段长图」，旧行同 kind 无 metadata 天然区分新旧）；`trajectory_phase.stitch_screenshot_id`、`stitchScreenshotUrl` 下载链路全不动。
- `src/services/trajectory/phase-highlight-screenshot.js` 改名 phase-screenshot；`collectHighlightTargets`（按步骤元素找高亮目标）**弃用**，改为全量扫描当前可见 L2 控件。

## 4. 兼容矩阵与错误处理

| 场景 | 行为 |
|------|------|
| 旧截图（无 metadata_json） | phases 项 `metadata:null`，前端跳过动态高亮；旧图仍带高亮，接受 |
| 旧步骤无 layers/region 数据 | `regionId`/`parentRegionId` 空串，不丢步 |
| 无阶段 / 阶段无截图 | `phases:[]` 或 `screenshotId:null, metadata:null` |
| 截图失败（录制中） | 保持现状 `warn + skip`，不阻塞 phase_done |
| 树组装失败 | 截图与元素坐标仍落库，`regionTree:null` |
| 导出推导异常 | 回退空串，不抛错 |

原则：全部**加法式**——老字段拼写不动、老行为不变；`schemaVersion` 2 声明。

## 5. 测试与验收

1. `assembleRegionTree` 表征：前缀合并、page 不套 page、other 兜底、同前缀同节点（对公客户修改 / 评级向导 fixture）。
2. 捕获：图干净（无 outline 残留）；`imageWidth/imageHeight` == PNG IHDR；坐标换算 `y = rect.top + sliceTop` 用 mock 片验证；跨片去重。
3. 导出：三层回退链逐级验证 + 空串兜底。
4. payload：schemaVersion 2、旧字段原样、phases 形状（有/无截图、旧数据）。
5. 回归：`bash scripts/refactor/verify-all.sh` + 现有 characterization 全绿（dedup/ctrl/partition-compose/form 等）。
6. 湿测（9242 对公客户修改 / 评级向导）：录制 → phase_done 干净图+元数据 → 导出 payload → 前端动态高亮验收（前端另仓配合）。
7. 旧数据轨迹导出不报错。

## 6. 实现草图（供 writing-plans 展开）

- 迁移：`migrations/20260814100000_screenshot_metadata_json.js`（`ALTER TABLE screenshot ADD COLUMN metadata_json JSON NULL`；具体时间戳以执行日为准，遵守仓库 YYYYMMDDHHmmss 命名）。
- 新 `src/services/region-tree.js`：`assembleRegionTree(items, { pageLabel })`。
- 改 `src/cdp/phase-screenshot-page.js`（删 mark/unmark；加 rect 收集表达式）、`phase-screenshot-capture.js`（逐片收集+去重+坐标换算）、`png-stitch` 侧取 IHDR 宽高。
- 改 `src/services/trajectory/phase-highlight-screenshot.js`（全量扫描 + 树 + 元数据写入；沿用 replaceForPhase 入口扩展）。
- 改 `src/services/transaction-export.js`：每步 `regionId`/`parentRegionId` 推导；每交易 phases 装载（`trajectoryDao.getById` 不带 phases/截图，导出路径需专门 loader：按 trajectory_id 查 trajectory_phase + kind=phase_highlight 的 screenshot 行含 metadata_json）。
- 改 `src/routes/v2/export-mgmt.js`（schema 接口 + payload 透传）、`src/dashboard/api-docs/catalog.js`。
- 扫描/resolve 列表挂 `regionTree`（PR-LAYER TODO 落点）。
- 表征：`scripts/characterization/characterize-region-tree.mjs`、`characterize-phase-screenshot-meta.mjs`；导出回退链表征。

## 同步义务（AGENTS.md）

- CHANGELOG `[Unreleased]`：migrations（screenshot.metadata_json）、routes（export envelope schemaVersion 2 + 新字段）、services（export/截图语义变更），带 Python 同步提示（envelope 形状变化；截图捕获在 Node CDP 侧，Python 无对应迁移）。
- `src/dashboard/api-docs/catalog.js` 是前端唯一契约，必须同步。

## 已知限制（写文档，不在本刀解决）

1. 节点 id 以 label 为键：同 label 不同分支合并为同一节点（框架固有语义）。
2. stitch 对固定元素（弹层/固定头）重复绘制；其坐标只记首次出现片位置（`outsideRoot:true`）。
3. 30 片截断上限沿用（`truncated` 标记）。
4. 旧数据不回填（旧图无元数据、旧步无层级字段）。

## Open TODOs（非阻塞）

- 部分导出（stepIds/phaseIds）——沿用 export V2 原 TODO。
- `placeholder` 字段——沿用 export V2 原 TODO。
- 前端动态高亮 + Vue 画树——另仓，本仓只提供契约。

## Approval

Brainstorming 五节设计 2026-08-14 会话内通过（需求澄清 + 方案 A 选定 + 各节逐节确认）。本 spec 待用户文件审阅后进入 writing-plans。
