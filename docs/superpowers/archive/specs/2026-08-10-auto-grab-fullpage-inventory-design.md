# Auto-grab: fullpage inventory + optional filters — Design

**Date:** 2026-08-10  
**Status:** Implemented 2026-08-10 — plan `docs/superpowers/plans/2026-08-10-auto-grab-fullpage-inventory.md`. Characterization inventory + collision titlebox PASS; Vue landed (sibling repo). **Caveats:** BiB/UI smoke pending; executor reload needed for attached sessions.  
**Backlog ID:** **AG-fullpage**  
**Related:** [TODO](../todos/2026-08-10-auto-grab-fullpage-same-name.md); [fullpage L2](2026-08-10-fullpage-visible-controls-scan-design.md); [L1 region preview](2026-08-10-resolve-ambiguous-section-preview-design.md); [titlebox collision refine](2026-08-10-resolve-collision-finer-l1-titlebox-design.md); product `POST …/resolve-element`

## Product decisions (locked)

| # | Decision |
|---|----------|
| 1 | 形态 **B**：点「自动抓取」走全页可见可操作控件池（可过滤），不是只靠针搜 |
| 2 | 路径 **甲**：扩展现有 `resolve-element`，不新开 URL |
| 3 | **`actionType` 与 `labelText` 均为可选查询条件**（非点按钮前置必填） |
| 4 | **无 `labelText`** → 不过滤文案；结果 **一律弹选择器**（含仅 1 条），都给用户看 |
| 5 | **有 `labelText`** → 1 条直写；≥2 弹选择器；0 提示找不到 |
| 6 | 有 `actionType` → 按 kind 白名单收窄；无 → **全 kind** |
| 7 | 选中控件后若步骤尚未选操作类型 → **系统按控件 `target_kind` 自动填入对应 `actionType`**（及必要文案 params） |
| 8 | 同名：L1 `region_*` + titlebox 碰撞细化 + 锚定 `xpath_smart`；算法 B 不丢匹配 |
| 9 | 保存路径已保留 `xpath_smart`（Vue `buildElement` + enrich 相对 xpath）；本刀不回退 |

## Goals

1. 自动抓取以 **fullpage L2** 同源池为候选面。  
2. 操作类型、文案作 **可选过滤**；空条件 = 更宽清单。  
3. 歧义 / 无文案浏览统一走现有选择器 UX（可加本地过滤）。  
4. 选中后补齐 `actionType` + 定位器，减少手工填参。  
5. `mode=needle` 保留旧针搜兼容。

## Non-goals

- 清单触发 auto-fill 写页  
- 用 `region_*` 作回放主定位（仍靠 `xpath_smart`）  
- BiB 高亮 / 缩略图  
- L1c-LLM  
- 新 REST 路径（乙）或只靠 `scan_editable_summary`（丙）

## §1 — API 契约

**`POST /api/v2/trajectories/:id/resolve-element`**

| 字段 | 必填 | 语义 |
|------|------|------|
| `mode` | 否 | 默认 **`inventory`**（产品自动抓取）；`needle` = 旧针搜 |
| `actionType` | 否 | 有则 kind 白名单；无则全 kind |
| `labelText` / params 文案 | 否 | 有则预过滤；无则不过滤 |
| `params` | 否 | 与今日一致，可带辅助文案 |

**响应（形状不变）**

- `{ element, matchedLabel }` — 仅 **有 labelText 且唯一** 时直写  
- `{ ambiguous: true, matches: [...] }` — 无 labelText（任意条数≥1）或有 labelText 且 ≥2  
- 0 命中 → 错误（区分「无控件」vs「过滤过严」文案可选）  
- 可选：`truncated: true` 当超过硬顶（建议 **120**）

**`matches[]` / `preview`：** 继续 `region_role` / `region_id` / `region_label` / `xpath_smart` / `target_kind` 等。

### kind 白名单（有 actionType 时）

| actionType | kinds（草案） |
|------------|----------------|
| `fill_form_field` | input / date / radio / checkbox / 现有 form_* |
| `select_option` | select / form_select |
| `click_element_by_index` | button / icon / menu |
| `click_menu_item` | menu |
| 其它可抓取（若扩展） | 按现有 resolve 面 |

无 `actionType`：上述 kind **并集**（fullpage 可操作 taxonomy）。

## §2 — CDP 收集与过滤

1. `Runtime.evaluate`：fullpage L2 池 + `assignRegion`（与 scan / helpers 共享）。  
2. `mode=inventory`：**不**走旧针搜 fallthrough。  
3. 可选 kind 过滤 → 可选文案过滤（归一后 **包含** 匹配；空针跳过文案滤）。  
4. ≥2 或（无 labelText 且 ≥1）：`refineCollidingRegions` 后组装 `matches`。  
5. 有 labelText 且唯一：单 `element` + snap（可锚 xpath）。  
6. Python `_locator_helpers_js` / `page-locator-helpers` 同步。

## §3 — Vue 交互

**「自动抓取」启用：** `prepareReady` 且未在抓取中；**不**因缺 `actionType` / 缺文案禁用。

**请求：** `mode: 'inventory'` + 当前可选的 `actionType` / `labelText` / `params`。

**响应处理**

| 条件 | UI |
|------|-----|
| 无 labelText 且 matches≥1 | 必开选择器（标题「选择控件」） |
| 有 labelText 且 ambiguous | 开选择器 |
| 有 labelText 且单 element | `applyResolvedMatch` 直写 |
| 0 | toast 找不到 |

**选择器：** 复用现有列表；可加本地过滤框。行：`region · label · kind` + xpath。

**选中后自动填类型（锁定）**

若 `form.actionType` 为空，根据所选 `element` / `preview.target_kind`（及 tag）映射并写入，例如：

| target_kind（示意） | 自动 actionType |
|---------------------|-----------------|
| form_input / form_date / form_radio / … | `fill_form_field` |
| form_select / select | `select_option` |
| menu | `click_menu_item` |
| button / icon / 其它可点 | `click_element_by_index` |

并写入对应 params 文案（`label_text` / `text` / `menu_text` / `button_text` 择一，用 `matchedLabel`）。  
若用户**已选** actionType，**不覆盖**（仅写入定位器；params 文案空则可补）。

**保存：** 继续 `buildElement` 持久化 `xpath_smart`。

## §4 — 验收

1. 无类型无文案：多 kind 全量清单，必弹选择器。  
2. 仅类型无文案：仅该 kind，必弹选择器。  
3. 仅文案且唯一：直写；`xpath_smart` 保存不被裸 leaf 覆盖。  
4. 同名 ≥2：`region_label` / 锚定 xpath 可区分。  
5. 未选类型时选中控件 → 自动出现对应 `actionType` + 文案 params。  
6. `mode=needle` 回归旧行为。  
7. Characterization + 湿测（对公编辑页多「新增」）。

## Implementation sketch（非计划细则）

- JS-gen：`resolve-by-label` inventory 分支；route/service 透传 `mode`；api-docs；CHANGELOG。  
- Vue：`canAutoGrab` / `handleAutoGrab` / 选中后 `inferActionType`；选择器标题。  
- Char：`characterize-resolve-*` 或新建 inventory 表征。

## Open points (non-blocking P0)

- 硬顶 120 是否对「无过滤」提示更醒目 — 实现时定文案即可。  
- kind→actionType 表与 schema 选项严格对齐时以 `step-action-schema` 为准微调。
