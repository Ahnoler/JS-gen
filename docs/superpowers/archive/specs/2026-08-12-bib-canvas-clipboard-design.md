# BiB 画布本机剪贴板（Ctrl+C / Ctrl+V）设计

日期：2026-08-12  
状态：已实现  
Todo：`canvas-copy`  
相关：`vue-project/src/composables/useRemoteCanvas.ts`、`executor/bib-bridge.js`、`src/cdp/remote-bridge/ws-router.js`

## 背景

产品 SPA 通过 BiB 画布把键鼠透传到执行机 Chrome。当前 Ctrl/Cmd+C/V 走 `remote:input` `kind:key` → CDP `Input.dispatchKeyEvent`，操作的是**远端**剪贴板。本机 `Ctrl+V` 粘不到远端内容；本机剪贴板内容也无法可靠贴进远端输入框。

产品确认：**本机剪贴板语义**；**C 与 V 都做**（方案 A：前端拦截 + 文本通道）。

## 目标

画布已附着、`inputEnabled`、且键盘已武装（曾点击画布）时：

| 快捷键 | 行为 |
|--------|------|
| Ctrl/Cmd+V | 读本机剪贴板文本 → 插入远端当前焦点 |
| Ctrl/Cmd+C | 读远端当前选区 → 写入本机剪贴板 |

Mac 使用 Meta（⌘），Windows/Linux 使用 Ctrl。

## 非目标

- 图片 / HTML 富文本 / 多格式剪贴板
- 远端 OS 剪贴板与本机双向实时同步
- Ctrl/Cmd+X 剪切
- 无选区时整页/整框默认全选再复制
- 在 `inputEnabled=false`（只读观看）时启用剪贴板快捷键

## 方案概要（A）

1. **前端**在 `useRemoteCanvas` 的 keydown 路径拦截 C/V + ctrl/meta，`preventDefault`，**不再**把这对键当 `kind:key` 透传。
2. **粘贴**：`navigator.clipboard.readText()` → 已有 `remote:input` `{ kind: 'text', text }`（执行端 `Input.insertText`）。
3. **复制**：新增取选区往返；成功后 `navigator.clipboard.writeText(text)`。

## 协议

### 粘贴（无新 kind）

客户端 → 控制面 → 执行机（现有路径）：

```json
{
  "type": "remote:input",
  "payload": {
    "kind": "text",
    "text": "<local clipboard text>",
    "trajectoryId": 36
  }
}
```

路由字段与其它 `remote:*` 一致（`trajectoryId` / `sessionId` / `remoteSessionId`）。

### 复制：取选区

**请求**（客户端 → 控制面 → `session.bib_input`）：

```json
{
  "type": "remote:input",
  "payload": {
    "kind": "clipboard",
    "action": "getSelection",
    "requestId": "<uuid>",
    "trajectoryId": 36
  }
}
```

**执行机行为**（`bib-bridge.handleInput`）：CDP `Runtime.evaluate`，逻辑顺序：

1. `activeElement` 为 `INPUT` / `TEXTAREA`（或可读写 `value`+`selectionStart`/`selectionEnd`）→ `value.slice(selectionStart, selectionEnd)`
2. 否则 `window.getSelection()?.toString()`（必要时可再试 shadow/iframe 同页简单路径；v1 不做跨 iframe 深挖）
3. 返回字符串（可为空）

**响应**（执行机 → 控制面 → 客户端）：

```json
{
  "type": "remote:clipboard",
  "payload": {
    "requestId": "<uuid>",
    "ok": true,
    "text": "selected text",
    "sessionId": "<agent-session-uuid>"
  }
}
```

失败时：`ok: false`，`text: ""`，可选 `reason`（如 `not_attached` / `evaluate_error`）。

控制面：`ws-router` 将 `kind:clipboard` 与其它 `bib_input` 一样路由到执行机；执行机回包映射为 `remote:clipboard`（或执行机直接经现有 session 事件桥转发，控制面透传 payload）。须带上 `requestId` 以便前端配对。

## 前端行为细则

前置条件：`streaming && inputEnabled && keyboardArmed`；目标不是页面其它可编辑控件（沿用现有 `isEditableOther` 跳过）。

| 事件 | 动作 |
|------|------|
| Ctrl/Cmd+V | `preventDefault`；`readText()`；非空则 `sendRemote(..., { kind:'text', text })`；同步本地 IME mirror（追加或 `reset` 后按现有约定，避免 mirror 严重漂移——v1：粘贴后可 `resetImeMirror()` 或把 text 追加到 `syncedPrefix`，实现时择一并在 plan 写明） |
| Ctrl/Cmd+C | `preventDefault`；发 `getSelection`；等待 `remote:clipboard`（超时 ~3s）；`ok && text` → `writeText(text)`；空选区不写、不报错（或极轻 toast，产品可选） |

**权限**：`clipboard.readText` / `writeText` 失败（非安全上下文、用户拒绝）→ toast「无法访问剪贴板」；**不**回退为 `kind:key` 假透传。

**并发**：同一时刻一个未完成的 `getSelection`（新请求可取消/忽略旧 `requestId`）。

## 执行机 / 控制面

| 模块 | 变更 |
|------|------|
| `executor/bib-bridge.js` `handleInput` | 识别 `kind:'clipboard'` + `action:'getSelection'`；evaluate；结果经 session 事件回传 |
| `executor/session-handler.js` | 确保 `bib_input` 异步结果能带回 `requestId`（若今日 `handleInput` 仅 `{ok:true}`，需扩展回传通道） |
| `src/cdp/remote-bridge/ws-router.js`（及本地 bridge 若仍用） | 透传 clipboard 请求；广播/单播 `remote:clipboard` |
| `/api/docs` websocket 组 | 文档：`kind:clipboard`、下行 `remote:clipboard` |
| `CHANGELOG.md` | `[Unreleased]` Changed；Python 同步提示：若 Python 控制面有 BiB 对齐则跟 `remote:input`/`remote:clipboard` |

Vue 仓：`useRemoteCanvas.ts`（产品主改动）。

## 验收

1. 远端 input 中选中文字 → 画布 Ctrl+C → 本机记事本 Ctrl+V 得到相同文本。  
2. 本机复制一段中文 → 画布点击远端 input → Ctrl+V → 远端出现该文本（含 CJK）。  
3. 无选区 Ctrl+C → 本机剪贴板不被清空成空串（保持原内容或不变）。  
4. 只读/未武装键盘时 Ctrl+V 不插入。  
5. 剪贴板 API 拒绝时有提示且无错误透传 key。

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 焦点不在可编辑元索，insertText 无效 | 与今日打字相同：先要求用户点击远端输入框 |
| 跨 iframe 选区读不到 | v1 文档说明；后续可加 frame tree evaluate |
| `readText` 需用户手势 | 在 keydown 同步链路内发起 read（保持用户手势） |
| 执行机回包丢失 | 前端超时；可重试一次 |

## 实现顺序（计划阶段展开）

1. Executor：`getSelection` + 回包  
2. 控制面：路由与 `remote:clipboard`  
3. Vue：拦截 C/V + 粘贴 text + 复制 write  
4. api-docs + CHANGELOG  
5. 手测验收清单
