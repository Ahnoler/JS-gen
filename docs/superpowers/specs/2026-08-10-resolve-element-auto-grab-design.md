# Design: Resolve-Element Auto-Grab (相对 xpath + 动作感知)

**Date:** 2026-08-10  
**Status:** approved (brainstorm)  
**Branch target:** `V2.1_dev`  
**Repos:** `D:\dev\JS-gen` + Vue `D:\dev\ui-auto-recording-agent-vue-master\vue-project\src`

## Problem

新增步骤「自动抓取」`POST /api/v2/trajectories/{id}/resolve-element` 已失效。典型错误：

> 页上找不到「对公客户管理」对应的控件（请确认弹窗已打开且目标可见）

根因（产品侧）：

1. Vue 只传 `{ labelText }`，不传 `actionType` / `params`。
2. 后端菜单分支仅在 `actionType=click_menu_item` 或 `params.menu_text` 时进入；通用 clickable 不含侧栏 `.menu-item` / `.el-menu-item`。
3. 录制/回放已约束相对 `xpath_smart`；自动抓取未同步为「动作感知 + 严格相对 xpath + 重名消歧」。

AI 录制 / 人工录制路径仍可用；本次只修自动抓取。

## Goals

- 三种新增步骤动作可自动抓取，并返回**已校验**相对 `xpath_smart`。
- 同名多匹配时返回候选列表，由用户自选（不静默择一）。
- 前后端契约对齐：请求带 `actionType` + `params`。

## Non-goals

- 不改 AI 录制 / 人工录制 CDP 主路径。
- 不在本轮专门实现「点击菜单」等其它动作的自动抓取 UI（点击元素的 text 搜索会顺带覆盖侧栏节点）。
- 不重做 `POST/PATCH trajectory-steps` 的 locator-capture-error 门禁（已有则沿用）。

## Decisions

| Topic | Choice |
|-------|--------|
| Approach | **A** — 动作感知 resolve + 严格相对 xpath + Vue 消歧 |
| Actions in scope | `fill_form_field`、`select_option`、`click_element_by_index` |
| Relative xpath | 必须有 **verified** `xpath_smart`；否则该候选丢弃；全无则 404 |
| Ambiguity | HTTP 200 `{ ambiguous: true, matches: [...] }`，用户选择 |
| Frontend | Vue 传 `actionType` + `params` + `labelText` |

## Architecture

```
OperationDialog「自动抓取」
  → POST resolve-element { actionType, params, labelText }
  → resolveTrajectoryElement
       ├─ executor: session.bib_resolve_element → resolveElementByLabel
       └─ local: remoteBridge → resolveElementByLabel
            → buildResolveExpression (action-aware DOM match)
            → filter: locator_verified + xpath_smart
            → 0 / 1 / N matches
  → Vue: 唯一写入 locator；多匹配弹候选；失败提示
```

执行机与本地共用 `src/cdp/resolve-by-label.js`（一处修复两边受益）。

---

## 1. API contract

**Endpoint:** `POST /api/v2/trajectories/{id}/resolve-element`  
**Precondition:** trajectory attached (`record/prepare` + BiB).

### Request

| Field | Required | Notes |
|-------|----------|--------|
| `actionType` | yes | Must be one of the three in-scope values for auto-grab |
| `params` | yes | fill/select: `label_text`; click: `text` |
| `labelText` | recommended | same needle as params; kept as redundant needle |

Needle resolution: `params.label_text` / `params.text` first, else `labelText`.

**Missing / out-of-scope `actionType`:** return **400** with a clear message (do **not** fall back to the old label-only broad search). Vue disables the button for other actions in this iteration.

### Success — unique

```json
{
  "trajectoryId": 42,
  "matchedLabel": "客户名称",
  "element": {
    "xpath": "<xpath_smart>",
    "xpath_smart": "<verified relative>",
    "xpath_full": "<absolute fallback>",
    "locator_strategy": "xpath_smart",
    "locator_verified": true,
    "target_kind": "form_input"
  }
}
```

Primary `xpath` MUST equal verified `xpath_smart`.

### Success — ambiguous

HTTP **200**:

```json
{
  "trajectoryId": 42,
  "ambiguous": true,
  "matches": [
    {
      "matchedLabel": "…",
      "element": { "...": "verified xpath_smart required" },
      "preview": { "formLabel": "", "target_kind": "", "xpath_smart": "", "text": "" }
    }
  ]
}
```

Never silently pick the first match.

### Errors

| Status | When |
|--------|------|
| 400 | Not attached / BiB unavailable / missing actionType+needle for supported path |
| 404 | No DOM match, **or** matches exist but none yield verified `xpath_smart` (message distinguishes「找不到」vs「无可用相对定位」) |

---

## 2. Backend matching rules

Shared helpers in page script (`PAGE_LOCATOR_HELPERS` / `buildLocatorSnap`):

- Exact match before fuzzy.
- Fuzzy: element text may contain needle; **do not** match when needle contains element text (avoid 客户管理 stealing 对公客户管理).
- After snap: keep candidate only if `locator_verified === true` and `xpath_smart` non-empty.
- Dedupe by `xpath_smart` (fallback absolute xpath if needed before filter).

### `fill_form_field` / `select_option`

- Match visible `.el-form-item` by label.
- Prefer topmost visible `.el-dialog` / `.el-drawer` when multiple overlays.
- `pickControl`: select prefers `.el-select`; fill prefers input/textarea.
- `target_kind`: `form_input` / `form_select` (retain existing date/tree inference if already present).
- Select grabs the **field trigger**, not a dropdown option row (`option_text` stays in params only).

### `click_element_by_index`

- Match by `params.text` / `labelText`.
- Search set: buttons, links, tree node contents, **and sidebar/menu nodes** (`.menu-item`, `.submenu-item`, `.el-menu-item`, `.el-submenu__title`, etc.).
- Collapsed submenu: exact title/text hits may include non-visible nodes (same spirit as current menu branch), but still require verified relative xpath.
- Frontend continues to force `index: -1`; location is xpath-based.

### Collapse

- 0 usable → 404  
- 1 → single `element`  
- >1 → `ambiguous` + `matches`

---

## 3. Vue changes

**Paths:** `vue-project/src/api/recording.ts`, `.../OperationDialog.vue` (+ small types if needed).

### Auto-grab enablement

- Enabled only when `actionType` ∈ the three and needle non-empty and prepare ready.
- Other action types: disable/hide auto-grab for this iteration.

### Request

```ts
resolveElement(trajectoryId, {
  labelText,
  actionType,
  params: buildParams(),
})
```

### Response handling

- Unique → `resolvedElement` + locator input shows **`xpath_smart`**.
- Ambiguous → secondary dialog / radio list: `matchedLabel`, `target_kind`, optional scope hint, truncated `xpath_smart`; confirm writes same fields; cancel leaves prior locator unchanged.
- Errors → existing request interceptor messaging.

### Save

- Unchanged `buildElement()` path; persist grabbed `element` with relative xpath.
- `click_element_by_index`: keep `index: -1`.

---

## 4. Testing & docs

### JS-gen

- Characterization: action branches + needle from params; click search includes menu selectors; unverified candidates dropped; multi-match → ambiguous.
- Update `/api/docs` recording group examples and notes.
- CHANGELOG `[Unreleased]`: resolve-element action-aware + strict xpath_smart + ambiguous; Vue contract; Python sync 无（可选对齐请求体）.

### Vue

- Types/call site send `actionType`/`params`.
- Manual or light test checklist: unique / multi-select / cancel / 404 / non-scoped action disabled.

### Verification scenarios

1. 填写字段「客户名称」→ 唯一相对 xpath。  
2. 选择下拉同 label → 触发器 xpath_smart。  
3. 点击元素「对公客户管理」→ 侧栏命中或 ambiguous 列表可选。  
4. 两处同名 label → ambiguous，用户选一。  
5. 仅绝对路径可建、相对失败 → 404「无可用相对定位」。

---

## Files (expected)

| Repo | Files |
|------|--------|
| JS-gen | `src/cdp/resolve-by-label.js`, locator helpers if needed, `src/dashboard/api-docs/groups/recording.js`, CHANGELOG, characterization |
| Vue | `src/api/recording.ts`, `OperationDialog.vue` |

`resolveTrajectoryElement` / executor bridge stay thin; logic stays in `resolveElementByLabel`.
