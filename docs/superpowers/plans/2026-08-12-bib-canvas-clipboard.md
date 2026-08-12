# BiB Canvas Local Clipboard (Ctrl+C / Ctrl+V) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the product BiB canvas, Ctrl/Cmd+C copies the remote selection into the **local** clipboard, and Ctrl/Cmd+V pastes **local** clipboard text into the remote focused field.

**Architecture:** Frontend intercepts C/V (no more `kind:key` for those). Paste reuses `remote:input` `kind:text`. Copy adds `kind:clipboard` `action:getSelection`; executor/local CDP evaluates selection; control plane returns `remote:clipboard` with `requestId` (same reply pattern as `session.bib_resolve_element_result` → mapped event).

**Tech Stack:** Node ESM (JS-gen executor + control plane), Vue 3 + TS (`useRemoteCanvas`), CDP `Runtime.evaluate` / `Input.insertText`, product `/ws`.

**Spec:** `docs/superpowers/specs/2026-08-12-bib-canvas-clipboard-design.md`

## Global Constraints

- Local clipboard semantics only (not remote OS clipboard sync).
- Intercept **both** Ctrl and Meta (⌘) + `c` / `v`.
- Do **not** fall back to fake `kind:key` Ctrl+C/V on clipboard API failure.
- Empty selection on copy: do **not** `writeText('')` (leave local clipboard unchanged).
- Only when `streaming && inputEnabled && keyboardArmed`; skip `isEditableOther` targets.
- v1: no images/HTML, no Ctrl+X, no cross-iframe deep selection.
- Paste after insert: update IME mirror by **appending** text to `syncedPrefix` / `ime.value` (do not only `resetImeMirror`).
- TDD: characterization fail → implement → green where feasible; Vue path hand-test.
- Commit only when the user asks.
- Dual path: **executor** BiB and **local** `remote-bridge` must both support `kind:clipboard` getSelection.
- CHANGELOG `[Unreleased]` for WS protocol; Python sync note: align if Python control plane has BiB WS.

## File map

| File | Role |
|------|------|
| `src/cdp/clipboard-selection.js` | **Create** — shared page expression + normalize evaluate result |
| `scripts/characterization/characterize-clipboard-selection.mjs` | **Create** — unit tests for expression contract / normalize |
| `executor/bib-bridge.js` | `handleInput` branch `kind:clipboard` |
| `executor/agent.mjs` | Reply `session.bib_clipboard` when bib_input returns clipboard payload |
| `src/executor-ws.js` | Map `session.bib_clipboard` → broadcast `remote:clipboard` |
| `src/cdp/remote-bridge/cdp-input.js` | Local bridge same clipboard branch |
| `src/cdp/remote-bridge/ws-router.js` | On clipboard result, `ws.send(remote:clipboard)` |
| `src/dashboard/api-docs/groups/websocket.js` | Document kind + downlink |
| `CHANGELOG.md` | Unreleased Changed |
| `d:/dev/ui-auto-recording-agent-vue-master/vue-project/src/composables/useRemoteCanvas.ts` | Intercept C/V; paste text; copy wait + write |
| Spec + `docs/superpowers/todo-list.md` | Status → implemented / 本仓库+前端已修 |

```text
Ctrl+V: keydown → clipboard.readText → remote:input kind:text → Input.insertText
Ctrl+C: keydown → remote:input kind:clipboard getSelection
        → executor evaluate → session.bib_clipboard
        → control plane remote:clipboard → clipboard.writeText
```

---

### Task 1: Shared selection helper + failing characterization

**Files:**
- Create: `src/cdp/clipboard-selection.js`
- Create: `scripts/characterization/characterize-clipboard-selection.mjs`
- Test: `scripts/characterization/characterize-clipboard-selection.mjs`

**Interfaces:**
- Consumes: none (pure helpers)
- Produces:
  - `CLIPBOARD_GET_SELECTION_EXPRESSION: string` — IIFE source for `Runtime.evaluate`
  - `normalizeClipboardSelectionResult(raw: unknown): { ok: boolean, text: string, reason?: string }`

- [ ] **Step 1: Write the failing characterization**

Create `scripts/characterization/characterize-clipboard-selection.mjs`:

```javascript
import assert from 'node:assert/strict';
import {
  CLIPBOARD_GET_SELECTION_EXPRESSION,
  normalizeClipboardSelectionResult,
} from '../../src/cdp/clipboard-selection.js';

assert.equal(typeof CLIPBOARD_GET_SELECTION_EXPRESSION, 'string');
assert.match(CLIPBOARD_GET_SELECTION_EXPRESSION, /selectionStart/);
assert.match(CLIPBOARD_GET_SELECTION_EXPRESSION, /getSelection/);
assert.match(CLIPBOARD_GET_SELECTION_EXPRESSION, /INPUT|TEXTAREA/);

assert.deepEqual(normalizeClipboardSelectionResult({ ok: true, text: 'ab' }), {
  ok: true,
  text: 'ab',
});
assert.deepEqual(normalizeClipboardSelectionResult({ ok: true, text: '' }), {
  ok: true,
  text: '',
});
assert.equal(normalizeClipboardSelectionResult(null).ok, false);
assert.equal(normalizeClipboardSelectionResult({ ok: false, reason: 'evaluate_error' }).reason, 'evaluate_error');

// Expression must be runnable as function body returning { ok, text }
const fn = new Function(`return (${CLIPBOARD_GET_SELECTION_EXPRESSION})`);
// jsdom-less: only check it parses; runtime shape tested via normalize + string cues
assert.equal(typeof fn, 'function');

console.log('characterize-clipboard-selection: OK');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/characterization/characterize-clipboard-selection.mjs`  
Expected: FAIL — module not found / export missing

- [ ] **Step 3: Write minimal implementation**

Create `src/cdp/clipboard-selection.js`:

```javascript
/**
 * Shared BiB clipboard getSelection helpers (executor + local remote-bridge).
 * Page expression returns { ok: true, text: string }.
 */
export const CLIPBOARD_GET_SELECTION_EXPRESSION = `(() => {
  try {
    const el = document.activeElement;
    if (el) {
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        const start = Number(el.selectionStart);
        const end = Number(el.selectionEnd);
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
          return { ok: true, text: String(el.value || '').slice(start, end) };
        }
      }
      if (typeof el.value === 'string'
          && typeof el.selectionStart === 'number'
          && typeof el.selectionEnd === 'number') {
        return {
          ok: true,
          text: String(el.value).slice(el.selectionStart, el.selectionEnd),
        };
      }
    }
    const sel = window.getSelection && window.getSelection();
    return { ok: true, text: sel ? String(sel.toString() || '') : '' };
  } catch (e) {
    return { ok: false, text: '', reason: 'evaluate_error' };
  }
})()`;

/**
 * @param {unknown} raw
 * @returns {{ ok: boolean, text: string, reason?: string }}
 */
export function normalizeClipboardSelectionResult(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, text: '', reason: 'evaluate_error' };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (o.ok === false) {
    return {
      ok: false,
      text: '',
      reason: typeof o.reason === 'string' ? o.reason : 'evaluate_error',
    };
  }
  return { ok: true, text: o.text == null ? '' : String(o.text) };
}
```

- [ ] **Step 4: Run characterization — expect PASS**

Run: `node scripts/characterization/characterize-clipboard-selection.mjs`  
Expected: `characterize-clipboard-selection: OK`

- [ ] **Step 5: Commit** (only if user asked)

```bash
git add src/cdp/clipboard-selection.js scripts/characterization/characterize-clipboard-selection.mjs
git commit -m "feat(bib): shared clipboard getSelection helper"
```

---

### Task 2: Executor `kind:clipboard` + `session.bib_clipboard` reply

**Files:**
- Modify: `executor/bib-bridge.js` (`handleInput`)
- Modify: `executor/agent.mjs` (reply branch after `bib_input`)
- Test: extend `scripts/characterization/characterize-clipboard-selection.mjs` with source cues OR a small `characterize-bib-clipboard-reply.mjs` that only greps/parses agent.mjs + bib-bridge (no live CDP)

**Interfaces:**
- Consumes: `CLIPBOARD_GET_SELECTION_EXPRESSION`, `normalizeClipboardSelectionResult` from `src/cdp/clipboard-selection.js`  
  (Executor may import via relative path `../src/cdp/clipboard-selection.js` — same pattern as other shared `src/cdp/*` if already used; if executor cannot import `src/`, **duplicate the expression string** in bib-bridge and keep normalize only in characterization of the shared module — prefer import if `executor` already imports from `../src/`.)
- Produces: `handleInput` return for clipboard:
  `{ clipboard: true, requestId, ok, text, reason?, sessionId? }`  
  `agent.mjs` sends `session.bib_clipboard` with those fields.

- [ ] **Step 1: Write failing source-cue characterization**

Add to `characterize-clipboard-selection.mjs` (or new file):

```javascript
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bib = readFileSync(path.join(root, 'executor/bib-bridge.js'), 'utf8');
const agent = readFileSync(path.join(root, 'executor/agent.mjs'), 'utf8');
assert.match(bib, /kind\s*===\s*['"]clipboard['"]|kind === \"clipboard\"/);
assert.match(bib, /getSelection/);
assert.match(agent, /session\.bib_clipboard/);
assert.match(agent, /session\.bib_input/);
```

Run once — expect FAIL on missing cues.

- [ ] **Step 2: Implement `bib-bridge.handleInput` clipboard branch**

Inside `handleInput`, before the final `unknown input kind` return, add:

```javascript
if (kind === 'clipboard') {
  const action = String(payload.action || '');
  const requestId = payload.requestId || null;
  if (action !== 'getSelection') {
    return {
      clipboard: true,
      requestId,
      ok: false,
      text: '',
      reason: 'unknown_clipboard_action',
    };
  }
  try {
    const { CLIPBOARD_GET_SELECTION_EXPRESSION, normalizeClipboardSelectionResult } =
      await import('../src/cdp/clipboard-selection.js');
    const evaluated = await this.client.send('Runtime.evaluate', {
      expression: CLIPBOARD_GET_SELECTION_EXPRESSION,
      returnByValue: true,
    });
    const normalized = normalizeClipboardSelectionResult(evaluated?.result?.value);
    return { clipboard: true, requestId, ...normalized };
  } catch (e) {
    return {
      clipboard: true,
      requestId,
      ok: false,
      text: '',
      reason: 'evaluate_error',
    };
  }
}
```

If dynamic import from executor fails in your layout, static-import at top of `bib-bridge.js` instead.

- [ ] **Step 3: Implement `agent.mjs` reply**

After the `session.bib_resolve_element` branch (same `onMessage` try block):

```javascript
} else if (msg.type === 'session.bib_input' && result?.clipboard) {
  client.send('session.bib_clipboard', {
    sessionId: msg.payload?.sessionId,
    requestId: result.requestId || msg.payload?.requestId || null,
    ok: !!result.ok,
    text: result.text == null ? '' : String(result.text),
    reason: result.reason || null,
  });
}
```

When BiB missing, `bibInput` currently returns `undefined` — ensure clipboard requests still reply:

In `session-manager.js` `bibInput`:

```javascript
async bibInput(sessionId, payload = {}) {
  const bib = this.bibs.get(sessionId);
  if (!bib) {
    if (payload?.kind === 'clipboard') {
      return {
        clipboard: true,
        requestId: payload.requestId || null,
        ok: false,
        text: '',
        reason: 'not_attached',
      };
    }
    return;
  }
  return bib.handleInput(payload);
}
```

- [ ] **Step 4: Re-run characterization — expect PASS**

Run: `node scripts/characterization/characterize-clipboard-selection.mjs`  
Expected: OK

- [ ] **Step 5: Commit** (if user asked)

```bash
git add executor/bib-bridge.js executor/agent.mjs executor/session-manager.js scripts/characterization/characterize-clipboard-selection.mjs
git commit -m "feat(executor): BiB clipboard getSelection reply"
```

---

### Task 3: Control plane → `remote:clipboard` (executor + local bridge)

**Files:**
- Modify: `src/executor-ws.js` (broadcast map)
- Modify: `src/cdp/remote-bridge/cdp-input.js` (clipboard branch)
- Modify: `src/cdp/remote-bridge/ws-router.js` (send result to requesting `ws`)
- Test: source cues in characterization for `remote:clipboard` + `executor-ws`

**Interfaces:**
- Consumes: `session.bib_clipboard` from executor
- Produces: dashboard `/ws` event `remote:clipboard` payload  
  `{ requestId, ok, text, reason?, sessionId }`

- [ ] **Step 1: Failing cues**

Extend characterization:

```javascript
const execWs = readFileSync(path.join(root, 'src/executor-ws.js'), 'utf8');
assert.match(execWs, /session\.bib_clipboard/);
assert.match(execWs, /remote:clipboard/);
const cdpInput = readFileSync(path.join(root, 'src/cdp/remote-bridge/cdp-input.js'), 'utf8');
assert.match(cdpInput, /clipboard/);
const router = readFileSync(path.join(root, 'src/cdp/remote-bridge/ws-router.js'), 'utf8');
assert.match(router, /remote:clipboard/);
```

Run — expect FAIL.

- [ ] **Step 2: `executor-ws.js` broadcast**

Next to the `session.bib_tabs` block:

```javascript
if (type === 'session.bib_clipboard') {
  broadcast('remote:clipboard', {
    sessionId: payload.sessionId,
    requestId: payload.requestId || null,
    ok: !!payload.ok,
    text: payload.text == null ? '' : String(payload.text),
    reason: payload.reason || null,
  });
}
```

Confirm `broadcast` already fans out to product SPA sockets (same as `remote:tabs`).

- [ ] **Step 3: Local `cdp-input.js` clipboard branch**

Mirror executor evaluate using shared helper; return:

```javascript
{
  ok: normalized.ok, // keep existing ok for agent_busy checks
  clipboard: true,
  requestId: payload.requestId || null,
  text: normalized.text,
  reason: normalized.reason,
}
```

When not attached / no client: `{ ok: false, clipboard: true, requestId, text: '', reason: 'not_attached' }`.

- [ ] **Step 4: Local `ws-router.js`**

Replace the bare `remote:input` local handler end with:

```javascript
if (type === 'remote:input') {
  const result = await handleInput(msg.payload || {});
  if (!result.ok && result.reason === 'agent_busy') {
    ws.send(JSON.stringify({ type: 'remote:status', payload: getRemoteStatus() }));
  }
  if (result?.clipboard) {
    ws.send(JSON.stringify({
      type: 'remote:clipboard',
      payload: {
        requestId: result.requestId || msg.payload?.requestId || null,
        ok: !!result.ok && result.reason !== 'not_attached'
          ? !!result.ok
          : !!result.ok,
        text: result.text == null ? '' : String(result.text),
        reason: result.reason || null,
      },
    }));
  }
  return;
}
```

Simplify `ok` to: `ok: !!result.ok` after normalize already set ok false on errors. Prefer:

```javascript
ok: result.ok !== false && !result.reason,
```

Actually use the same shape as executor: `ok: !!result.ok` where clipboard branch sets `ok` from normalize.

- [ ] **Step 5: Characterization PASS**

Run: `node scripts/characterization/characterize-clipboard-selection.mjs`

- [ ] **Step 6: Commit** (if user asked)

```bash
git add src/executor-ws.js src/cdp/remote-bridge/cdp-input.js src/cdp/remote-bridge/ws-router.js scripts/characterization/characterize-clipboard-selection.mjs
git commit -m "feat(ws): broadcast remote:clipboard for BiB selection"
```

---

### Task 4: Vue `useRemoteCanvas` Ctrl/Cmd+C and Ctrl/Cmd+V

**Files:**
- Modify: `d:/dev/ui-auto-recording-agent-vue-master/vue-project/src/composables/useRemoteCanvas.ts`
- Optional UX: `setStatus('无法访问剪贴板', 'bad')` (already in composable) — no ElMessage required

**Interfaces:**
- Consumes: `sendRemote`, `onWs('remote:clipboard')`, `sendTextChunk`
- Produces: intercept behavior only (no new exports required)

- [ ] **Step 1: Add clipboard pending state + WS listener inside `bindInput` / `bindWs`**

In `bindWs` (alongside other `onWs`):

```typescript
offs.push(onWs('remote:clipboard', (p) => {
  const payload = (p || {}) as {
    requestId?: string | null
    ok?: boolean
    text?: string
    reason?: string | null
  }
  const pending = clipboardPending
  if (!pending) return
  if (payload.requestId && pending.requestId && payload.requestId !== pending.requestId) return
  clearTimeout(pending.timer)
  clipboardPending = null
  pending.resolve({
    ok: !!payload.ok,
    text: payload.text == null ? '' : String(payload.text),
  })
}))
```

Declare near other lets in `useRemoteCanvas`:

```typescript
let clipboardPending: {
  requestId: string
  resolve: (r: { ok: boolean; text: string }) => void
  timer: ReturnType<typeof setTimeout>
} | null = null
```

Helper:

```typescript
function requestRemoteSelection(timeoutMs = 3000): Promise<{ ok: boolean; text: string }> {
  const requestId = (globalThis.crypto?.randomUUID?.() || `clip-${Date.now()}`)
  return new Promise((resolve) => {
    if (clipboardPending) {
      clearTimeout(clipboardPending.timer)
      clipboardPending.resolve({ ok: false, text: '' })
      clipboardPending = null
    }
    const timer = setTimeout(() => {
      if (clipboardPending?.requestId === requestId) {
        clipboardPending = null
        resolve({ ok: false, text: '' })
      }
    }, timeoutMs)
    clipboardPending = { requestId, resolve, timer }
    sendRemote('remote:input', {
      kind: 'clipboard',
      action: 'getSelection',
      requestId,
    })
  })
}
```

- [ ] **Step 2: Intercept in `onKeyDown` before generic control-key forward**

After the composing / printable early returns, before `e.preventDefault()` for all control keys:

```typescript
const mod = e.ctrlKey || e.metaKey
const key = (e.key || '').toLowerCase()
if (mod && (key === 'c' || key === 'v') && !e.altKey) {
  e.preventDefault()
  e.stopPropagation()
  if (key === 'v') {
    void (async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (!text) return
        sendTextChunk(text)
        syncedPrefix += text
        const ime = imeEl()
        if (ime) ime.value = syncedPrefix
      } catch {
        setStatus('无法访问剪贴板', 'bad')
      }
    })()
    return
  }
  // copy
  void (async () => {
    try {
      const { ok, text } = await requestRemoteSelection(3000)
      if (!ok || !text) return
      await navigator.clipboard.writeText(text)
    } catch {
      setStatus('无法访问剪贴板', 'bad')
    }
  })()
  return
}
```

Ensure `sendTextChunk` / `syncedPrefix` / `imeEl` are in scope (they already are inside `bindInput`). If `requestRemoteSelection` is defined outside `bindInput`, pass `sendRemote` or define it inside `bindInput` / share via closure on the composable.

**Note:** `onKeyUp` for c/v with mod should **not** forward keyUp either — add the same mod+c/v early return (no sendKey) to avoid stray keyUp on remote.

- [ ] **Step 3: Typecheck / lint if the Vue project has a script**

Run (from Vue project root): `npm run typecheck` or `npx vue-tsc --noEmit` if available.  
Expected: no errors in `useRemoteCanvas.ts`.

- [ ] **Step 4: Hand-test checklist (executor attached)**

1. Select text in remote input → Ctrl+C → paste in local Notepad → match.  
2. Copy Chinese locally → click remote input → Ctrl+V → appears remotely.  
3. Empty selection Ctrl+C → local clipboard unchanged.  
4. Before first canvas click (`keyboardArmed` false) → V does nothing.  
5. Deny clipboard permission → status shows `无法访问剪贴板`; no remote key spam.

- [ ] **Step 5: Commit in Vue repo** (if user asked)

```bash
cd d:/dev/ui-auto-recording-agent-vue-master/vue-project
git add src/composables/useRemoteCanvas.ts
git commit -m "feat(canvas): local clipboard Ctrl+C/V for BiB"
```

---

### Task 5: api-docs, CHANGELOG, todo/spec status

**Files:**
- Modify: `src/dashboard/api-docs/groups/websocket.js`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-12-bib-canvas-clipboard-design.md` (status → Implemented)
- Modify: `docs/superpowers/todo-list.md` (`canvas-copy` → 本仓库已修 / 转前端完成)

- [ ] **Step 1: Update websocket docs**

In `remote:input` notes, change kind list to include `clipboard`, and add downlink entry:

```javascript
{
  method: 'WS', path: 'remote:clipboard',
  summary: 'BiB 远端选区文本（供本机 Ctrl+C）',
  tryable: false,
  respExample: J({
    type: 'remote:clipboard',
    payload: { requestId: 'uuid', ok: true, text: 'selected', sessionId: 'uuid' },
  }),
  notes: [
    '响应 remote:input kind:clipboard action:getSelection',
    '执行机 session.bib_clipboard → 控制面广播 remote:clipboard',
    '空选区 ok:true text:"" — 前端不得 writeText 空串覆盖本机剪贴板',
  ],
},
```

Also update `remote:input` notes:

```text
'kind: mouse | key | text | navigate | clipboard',
'clipboard：{ action: getSelection, requestId } — 取远端选区；结果见 remote:clipboard',
'Ctrl/Cmd+C/V 由 SPA 拦截：V→kind:text；C→kind:clipboard（勿再 kind:key 透传）',
```

- [ ] **Step 2: CHANGELOG `[Unreleased]` Changed**

```markdown
### Changed
- **BiB 画布本机剪贴板**：`remote:input` 新增 `kind:clipboard`（`getSelection`）；下行 `remote:clipboard`；产品画布 Ctrl/Cmd+C/V 走本机剪贴板语义（不再把 C/V 当远端键透传）。
  - 影响：`/ws` BiB 协议；executor `session.bib_clipboard`；Vue `useRemoteCanvas`
  - Python 同步提示：若 Python 控制面转发 BiB `remote:input`，对齐 `clipboard` 与 `remote:clipboard` 广播
```

- [ ] **Step 3: Mark todo + spec**

- Spec status: `已实现`  
- Todo `canvas-copy`: move to 本仓库已修（备注含 Vue 仓改动路径）

- [ ] **Step 4: Final characterization**

Run: `node scripts/characterization/characterize-clipboard-selection.mjs`  
Expected: OK

- [ ] **Step 5: Commit** (if user asked)

```bash
git add src/dashboard/api-docs/groups/websocket.js CHANGELOG.md docs/superpowers/specs/2026-08-12-bib-canvas-clipboard-design.md docs/superpowers/todo-list.md
git commit -m "docs: BiB canvas clipboard protocol and todo"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Ctrl/Cmd+V local → remote via kind:text | Task 4 |
| Ctrl/Cmd+C remote selection → local clipboard | Tasks 2–4 |
| No fake key fallback | Task 4 |
| Empty selection does not clear local clipboard | Task 4 |
| Only when streaming/inputEnabled/keyboardArmed | Task 4 |
| Executor getSelection evaluate order | Tasks 1–2 |
| `remote:clipboard` + requestId | Tasks 2–3 |
| Local remote-bridge parity | Task 3 |
| api-docs + CHANGELOG | Task 5 |
| IME mirror append on paste | Task 4 |
| Non-goals (images, X, iframe) | out of plan |

**Placeholder scan:** none intentional.  
**Type consistency:** `session.bib_clipboard` / `remote:clipboard` / `{ requestId, ok, text, reason? }` aligned across tasks.
