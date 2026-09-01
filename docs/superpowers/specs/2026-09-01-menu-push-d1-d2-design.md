# 推送菜单 D1+D2 设计（partner stub）

> 状态：已评审（2026-09-01）  
> 日期：2026-09-01  
> 范围：JS-gen 组包推送菜单 API + 本仓推送状态机；partner 接收 HTTP **留空**  
> 契约样例：`docs/需求评审-菜单切换/push-menu-v1.2.sample.json`  
> 关联待办：周一清单 D1 / D2（D3–D5 不在本期）

## 1. 背景

菜单切换闭环卡在「推送到自动化平台」。v1.2 样例已锁定报文形状；平台接收接口仍在编写。本仓需先交付：

- **D1**：按系统组包并暴露推送入口（代调平台处 stub）
- **D2**：推送中禁用所需的状态（落库 + 可轮询）；平台完成回传未就绪前，用本仓短时 auto-sync 模拟完成

## 2. 已拍板决策

| 项 | 决策 |
|----|------|
| 范围 | D1 + D2 |
| 完成态（stub 期） | 进入 `pushing` 后默认 **5s** 本仓自动改为 `synced`（可 env 覆盖） |
| menus 过滤 | **全量**推送，带 `unmatched` / `removed` 布尔，本仓不静默剔除 |
| 状态存放 | **落库**（系统节点列），非仅内存 |
| 架构 | 轻量方案 A：system 列 + menu-push service + partner stub |

## 3. 非目标

- 平台真实接收 URL / 鉴权 / 回调 ack
- D3–D5（交易推送 pageId、同步闸门、菜单归属）
- 前端推送按钮 UI（本仓只提供 API）
- 手建节点 `source` 补写为 `manual`（另议）
- 修改历史 `trajectory.page_id`

## 4. API

### 4.1 `POST /api/v2/system-mgmt/nodes/:id/push-menu`

- `:id` 必须为系统节点（type=1），否则 400
- 若 `menu_push_status === 'pushing'` 且未过期 → **409**（防连点）
- 组装 v1.2 业务 body（见 §5）
- 调用 `pushMenusToPartner(payload, { accessToken })`（本期 stub）
- 落库：`pushing` + `menu_push_at` + `menu_push_version`
- 调度 auto-sync 定时器
- 响应 **202**：

```json
{
  "status": "pushing",
  "menuVersion": 8,
  "menuCount": 492,
  "partner": { "skipped": true, "reason": "partner_endpoint_pending" },
  "autoSyncMs": 5000
}
```

### 4.2 `GET /api/v2/system-mgmt/nodes/:id/push-menu/status`

- 返回当前状态；若发现过期的 `pushing`，纠偏为 `synced` 再返回
- 形状：

```json
{
  "status": "idle|pushing|synced|failed",
  "menuVersion": 8,
  "pushedAt": "<iso|null>",
  "syncedAt": "<iso|null>",
  "error": ""
}
```

- `status`：库空串视为 `idle`

## 5. 组包规则（对齐 v1.2）

推送 wire body **不含** 样例文档字段（`notes` / `fieldDefinitions` / `examples` / `_meta` / `sampleRevision`）。

| 字段 | 规则 |
|------|------|
| `schemaVersion` | 固定 `1` |
| `systemNodeId` | 系统节点 id |
| `systemName` | 系统名称 |
| `menuVersion` | `system_menu_snapshot` 该系统最大 version；无快照为 `0` |
| `menus[]` | 该系统下全部 type=2\|3（含 unmatched/removed） |
| `umlEcd` | `system.uml_ecd` |
| `type` | 2 或 3 |
| `name` | 节点名 |
| `parentPath` | 模块=`name`；功能=`父名-子名` |
| `parentUmlEcd` | 模块=`""`；功能=父模块 `uml_ecd` |
| `xpath` | `menu_xpath` |
| `source` | `json_import` \| `ai` \| `manual` \| `""` |
| `unmatched` / `removed` | 布尔（来自 flag） |
| `pageId` | 模块 `""`；功能=`pd_cmpt_ecd`（单值 string） |

排序：`sort_order` asc，`id` asc。

## 6. 状态机（本仓）

```
idle ──POST──► pushing ──autoSyncMs──► synced
                  │
                  └──(未来 partner 失败)──► failed
```

- `synced` 后再 POST：允许（视为新一次推送，重新进入 `pushing`）
- 进程重启：定时器丢失；**GET status**（或下次 POST 前）将「`pushing` 且 `now - menu_push_at > autoSyncMs`」纠偏为 `synced`
- 环境变量：`MENU_PUSH_AUTO_SYNC_MS`（默认 5000）

## 7. Partner stub

```js
async function pushMenusToPartner(payload, { accessToken } = {}) {
  // TODO: 平台接收菜单 HTTP 就绪后实现
  console.log('[partner] pushMenus skipped', {
    systemNodeId: payload.systemNodeId,
    menuVersion: payload.menuVersion,
    menuCount: Array.isArray(payload.menus) ? payload.menus.length : 0,
  });
  return { skipped: true, reason: 'partner_endpoint_pending' };
}
```

不发起 HTTP；真接时只改此函数体。

## 8. 落库（migration）

`system` 表新增（系统节点使用）：

| 列 | 类型建议 | 默认 |
|----|----------|------|
| `menu_push_status` | varchar(16) | `''` |
| `menu_push_version` | int | `0` |
| `menu_push_at` | datetime null | null |
| `menu_push_synced_at` | datetime null | null |
| `menu_push_error` | varchar(512) | `''` |

`system-dao` create/update/toApi 透传上述字段（camelCase）。

## 9. 实现触点

| 文件 | 变更 |
|------|------|
| `src/services/menu-push.js` | 组包 + push + status + auto-sync / 纠偏 |
| `src/services/partner-platform.js` | 导出 `pushMenusToPartner` stub |
| `src/routes/v2/system-mgmt.js` | 注册 POST/GET |
| `src/dashboard/api-docs/groups/overview.js` | 文档 |
| `src/dao/system-dao.js` | 新列读写 |
| `migrations/YYYYMMDDHHMMSS_menu_push_status.js` | 加列 |
| `scripts/characterization/characterize-menu-push.mjs` | 组包/wiring/stub pin |
| `CHANGELOG.md` | `[Unreleased]` |

## 10. 验证

- `node scripts/characterization/characterize-menu-push.mjs`
  - 对公客户管理 `pageId=ZJJK00066153`，无 guidePage 数组语义
  - payload 含 `source`
  - stub 返回 `partner_endpoint_pending`；源码 cue 无真实菜单接收 URL（或 pin skipped reason）
- 湿测：POST → GET `pushing` → ~5s → GET `synced`

## 11. 风险

- 定时器进程内：多实例部署时可能双触发 sync——本期单控面可接受；真回调上线后以平台完成为准、弱化 auto-sync
- `menuVersion=0`（从未 JSON 导入）仍允许推扫描菜单——产品可接受；文档注明
- 前端未合入时，状态列仅 API 可见
